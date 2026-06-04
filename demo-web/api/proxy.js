// Proxy serverless Vercel → API Anthropic
// La clé API transite uniquement en mémoire (header x-api-key du navigateur →
// ce handler → Anthropic). Elle n'est jamais loggée ni stockée.

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-api-key");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const apiKey = (
    req.headers["x-api-key"] ||
    process.env.ANTHROPIC_API_KEY ||
    ""
  ).trim();

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
