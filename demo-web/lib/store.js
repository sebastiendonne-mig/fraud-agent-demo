// Stockage de session et quota (Upstash Redis, via l'intégration Vercel).
//
// Toutes les clés sont préfixées par l'environnement Vercel (VERCEL_ENV) :
//   production:quota:AAAA-MM-JJ   production:run:<uuid>
//   preview:quota:AAAA-MM-JJ      preview:run:<uuid>
//   production:quota_jev:AAAA-MM-JJ   (évaluations Jev, compteur séparé)
// Le quota de la prévisualisation est ainsi indépendant de celui de la prod.
//
// Secrets : KV_REST_API_URL et KV_REST_API_TOKEN servent UNIQUEMENT à créer le
// client ; ils ne sont jamais affichés, journalisés, ni renvoyés.
// On n'utilise pas Redis.fromEnv() : dans @upstash/redis 1.39.0, il lit
// d'abord UPSTASH_REDIS_REST_URL/TOKEN puis retombe sur KV_REST_API_URL/TOKEN
// (vérifié dans node_modules/@upstash/redis/nodejs.js). Le constructeur
// explicite lève toute ambiguïté sur la variable utilisée.
const CONFIG_AGENT = require("../config/agent.json");
const CONFIG_JEV = require("../config/jev.json");

const ENVIRONNEMENTS = Object.freeze(["production", "preview", "development"]);

function environnement(valeur) {
  return ENVIRONNEMENTS.includes(valeur) ? valeur : "development";
}

// Client réel, créé à la demande. Renvoie null si la configuration manque
// (le handler sert alors le repli), sans jamais afficher de valeur.
function creerRedisDepuisEnv(env = process.env) {
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) return null;
  const { Redis } = require("@upstash/redis");
  return new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN, enableTelemetry: false });
}

// Date du jour dans le fuseau du quota (Europe/Paris), au format AAAA-MM-JJ
function jourDuQuota(ms, fuseau) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms));
}

// Limite quotidienne de l'environnement. `quota_jour` est un objet par
// environnement (production, preview, development) ; un nombre est accepté pour
// les essais (tests, enregistrement des rejeux).
function limiteQuota(config, prefixe) {
  const q = config.quota_jour;
  if (typeof q === "number") return q;
  return q[prefixe] ?? q.development;
}

function creerStore({ redis, env, config = CONFIG_AGENT, configJev = CONFIG_JEV }) {
  const prefixe = environnement(env);
  const limite = limiteQuota(config, prefixe);
  const limiteJev = limiteQuota(configJev, prefixe);
  const cle = (type, id) => `${prefixe}:${type}:${id}`;

  return {
    prefixe,
    cle,

    // Compte une analyse avec agent. Renvoie autorise = false au-delà du quota.
    async incrementerQuota(ms) {
      const k = cle("quota", jourDuQuota(ms, config.fuseau_quota));
      const utilisees = await redis.incr(k);
      if (utilisees === 1) await redis.expire(k, config.ttl_quota_s);
      return { autorise: utilisees <= limite, utilisees, limite };
    },

    // Lecture seule du compteur (pour l'affichage des analyses restantes, jalon 1b)
    async lireQuota(ms) {
      const k = cle("quota", jourDuQuota(ms, config.fuseau_quota));
      const utilisees = Number((await redis.get(k)) ?? 0);
      return { utilisees, restantes: Math.max(0, limite - utilisees), limite };
    },

    // Second compteur, séparé de celui des analyses : évaluations Jev (clé `quota_jev`).
    // Compté AVANT l'appel ; jamais compté si Jev n'est pas appelé ; non remboursé.
    async incrementerQuotaJev(ms) {
      const k = cle("quota_jev", jourDuQuota(ms, config.fuseau_quota));
      const utilisees = await redis.incr(k);
      if (utilisees === 1) await redis.expire(k, config.ttl_quota_s);
      return { autorise: utilisees <= limiteJev, utilisees, limite: limiteJev };
    },

    async lireQuotaJev(ms) {
      const k = cle("quota_jev", jourDuQuota(ms, config.fuseau_quota));
      const utilisees = Number((await redis.get(k)) ?? 0);
      return { utilisees, restantes: Math.max(0, limiteJev - utilisees), limite: limiteJev };
    },

    async sauverRun(id, etat) {
      await redis.set(cle("run", id), etat, { ex: config.ttl_run_s });
    },

    // Lecture ET suppression atomiques : un run_id ne sert qu'une fois
    async prendreRun(id) {
      return (await redis.getdel(cle("run", id))) ?? null;
    },
  };
}

module.exports = { creerStore, creerRedisDepuisEnv, environnement, jourDuQuota, limiteQuota, ENVIRONNEMENTS };
