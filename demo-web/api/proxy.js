// Proxy serverless Vercel → API Anthropic
// La clé API transite uniquement en mémoire (header x-api-key du navigateur →
// ce handler → Anthropic). Elle n'est jamais loggée ni stockée.

// ── Rate limiting ────────────────────────────────────────────────────────────
// Stockage en mémoire : partagé au sein d'une même instance chaude Vercel.
// Suffisant pour un démo portfolio (protège contre l'abus sur la clé serveur).
const MAX_REQUESTS = 5;
const WINDOW_MS = 60 * 60 * 1000; // 1 heure

const ipStore = new Map(); // ip → { count, resetAt }

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (forwarded ? forwarded.split(",")[0] : req.socket?.remoteAddress || "unknown").trim();
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipStore.get(ip);

  if (!entry || now >= entry.resetAt) {
    ipStore.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetAt: now + WINDOW_MS };
  }

  if (entry.count >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, resetAt: entry.resetAt };
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-api-key");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  // Appliquer le rate limit uniquement quand c'est la clé serveur qui est utilisée
  const clientKey = req.headers["x-api-key"]?.trim();
  const usingServerKey = !clientKey && !!process.env.ANTHROPIC_API_KEY;

  if (usingServerKey) {
    const ip = getClientIp(req);
    const { allowed, remaining, resetAt } = checkRateLimit(ip);

    res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));

    if (!allowed) {
      const retryAfterSec = Math.ceil((resetAt - Date.now()) / 1000);
      res.setHeader("Retry-After", retryAfterSec);
      return res.status(429).json({
        error: {
          type: "rate_limit_error",
          message: `Limite atteinte — 5 analyses par heure maximum. Réessayez dans ${Math.ceil(retryAfterSec / 60)} min.`,
        },
      });
    }
  }

  const apiKey = (clientKey || process.env.ANTHROPIC_API_KEY || "").trim();

  if (!apiKey) {
    return res.status(401).json({
      error: {
        type: "authentication_error",
        message:
          "Clé API manquante — saisissez-la dans le formulaire ou définissez ANTHROPIC_API_KEY dans les variables d'environnement Vercel.",
      },
    });
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
      "content-type": "application/json",
    },
    body: JSON.stringify(req.body),
  });

  const data = await upstream.json();
  return res.status(upstream.status).json(data);
};
