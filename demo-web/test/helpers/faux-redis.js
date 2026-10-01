// Faux Redis en mémoire : sous-ensemble utilisé par lib/store.js.
// Les valeurs passent par JSON, comme la (dé)sérialisation automatique d'Upstash.
function creerFauxRedis({ horloge } = {}) {
  const donnees = new Map(); // clé → { valeur, expire_a }
  let enPanne = false;
  const now = () => (horloge ? horloge.now() : 0);
  const verifier = () => { if (enPanne) throw new Error("Redis indisponible (simulé)"); };
  const lire = (k) => {
    const e = donnees.get(k);
    if (!e) return undefined;
    if (e.expire_a !== null && now() >= e.expire_a) { donnees.delete(k); return undefined; }
    return e;
  };

  return {
    donnees,
    tomberEnPanne(v = true) { enPanne = v; },
    cles: () => [...donnees.keys()].filter((k) => lire(k)),
    ttl: (k) => { const e = lire(k); return e && e.expire_a !== null ? (e.expire_a - now()) / 1000 : -1; },
    async incr(k) {
      verifier();
      const e = lire(k);
      const v = (e ? Number(JSON.parse(e.valeur)) : 0) + 1;
      donnees.set(k, { valeur: JSON.stringify(v), expire_a: e ? e.expire_a : null });
      return v;
    },
    async expire(k, s) { verifier(); const e = lire(k); if (e) e.expire_a = now() + s * 1000; return e ? 1 : 0; },
    async get(k) { verifier(); const e = lire(k); return e ? JSON.parse(e.valeur) : null; },
    async set(k, v, opts = {}) {
      verifier();
      donnees.set(k, { valeur: JSON.stringify(v), expire_a: opts.ex ? now() + opts.ex * 1000 : null });
      return "OK";
    },
    async getdel(k) { verifier(); const e = lire(k); donnees.delete(k); return e ? JSON.parse(e.valeur) : null; },
  };
}

module.exports = { creerFauxRedis };
