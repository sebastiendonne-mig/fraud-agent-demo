const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const H = require("../lib/handlers.js");
const { creerStore } = require("../lib/store.js");
const CONFIG = require("../config/agent.json");
const F = require("./helpers/faux-anthropic.js");
const { creerFauxRedis } = require("./helpers/faux-redis.js");
const { scenarios } = require("./helpers/scenarios.js");

// ── Outillage ────────────────────────────────────────────────────────────
function fauxRes() {
  return {
    statusCode: 0, headers: {}, corps: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(texte) { this.corps = texte; },
    json() { return JSON.parse(this.corps); },
  };
}
async function appeler(handler, corps, methode = "POST") {
  const res = fauxRes();
  await handler({ method: methode, body: corps }, res);
  return res;
}

// Monte les deux handlers sur les mêmes faux (horloge, Redis, client scripté)
function monter({ script = [], env = "production", sansClient = false, sansStore = false } = {}) {
  const horloge = F.creerHorloge(Date.UTC(2026, 8, 30, 10, 0, 0));
  const redis = creerFauxRedis({ horloge });
  const client = F.creerFauxClient(script, horloge);
  const compteurs = { client: 0, store: 0 };
  let n = 0;
  const deps = {
    now: horloge.now,
    uuid: () => `00000000-0000-4000-8000-00000000000${++n}`,
    store: () => { compteurs.store++; return sansStore ? null : creerStore({ redis, env }); },
    client: () => { compteurs.client++; return sansClient ? null : client; },
  };
  return {
    horloge, redis, client, compteurs,
    analyse: H.creerHandlerAnalyse(deps), finalise: H.creerHandlerFinalisation(deps), quota: H.creerHandlerQuota(deps),
  };
}

const dossier = (nom) => ({ ...scenarios()[nom], scenario: nom });
const scriptRecours = () => [
  { duree_ms: 2000, reponse: F.reponse([F.reflexion("SIG-SECRETE"), F.appelOutil("calculer_montant_recours", { part_responsabilite_tiers_pct: 100 })]) },
  { duree_ms: 2000, reponse: F.reponse([F.appelOutil("proposer_decision", F.propositionValide())]) },
];
const rejeuFactice = {
  enregistre_le: "2026-10-01",
  analyse: { proposition: { synthese: "rejeu" }, trace: { tours: [] } },
  finalisation: { valider: { finalisation: { statut_final: "RECOURS_A_ENGAGER" }, trace: { tours: [] } } },
};

test.afterEach(() => H._definirChargeurRejeu(null));

// ── Analyse ──────────────────────────────────────────────────────────────
test("STP sans rapport : 0 appel au modèle, quota non consommé, aucune session créée", async () => {
  const m = monter();
  const res = await appeler(m.analyse, dossier("stp"));
  const r = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(r.mode, "regles_seules");
  assert.equal(r.routage, "STP");
  assert.equal(m.client.appels.length, 0);
  assert.equal(m.compteurs.client, 0);
  assert.equal(m.compteurs.store, 0);
  assert.deepEqual(m.redis.cles(), []);
});

test("champs refusés : model, system, messages → 400 sans appel au modèle ni quota", async () => {
  const m = monter({ script: scriptRecours() });
  for (const intrus of ["model", "system", "messages"]) {
    const res = await appeler(m.analyse, { ...dossier("recours"), [intrus]: "x" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().erreur, "donnees_invalides");
  }
  assert.equal(m.client.appels.length, 0);
  assert.deepEqual(m.redis.cles(), []);
});

test("méthode, JSON invalide, corps trop volumineux : réponses JSON propres", async () => {
  const m = monter();
  assert.equal((await appeler(m.analyse, undefined, "GET")).statusCode, 405);
  assert.equal((await appeler(m.analyse, "{pas du json")).statusCode, 400);
  assert.equal((await appeler(m.analyse, "x".repeat(20000))).statusCode, 413);
  const chaine = await appeler(m.analyse, JSON.stringify(dossier("stp")));
  assert.equal(chaine.json().mode, "regles_seules", "corps reçu en chaîne JSON");
  assert.equal(chaine.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(chaine.headers["cache-control"], "no-store");
});

test("STP + rapport : agent en mode recours seul, routage STP immuable, session stockée sous le préfixe", async () => {
  const m = monter({ script: scriptRecours() });
  const r = (await appeler(m.analyse, dossier("recours"))).json();
  assert.equal(r.mode, "direct");
  assert.equal(r.routage, "STP");
  assert.equal(r.mode_agent, "recours_seul");
  assert.equal(r.proposition.routage, "STP");
  assert.equal(r.modele, "claude-sonnet-5-5");
  assert.deepEqual(m.redis.cles().sort(), ["production:quota:2026-09-30", `production:run:${r.run_id}`]);
  assert.equal(r.trace.tours.length, 2);
  assert.equal(r.trace.duree_totale_ms, 4000);
});

test("réponse au navigateur : ni blocs de réflexion, ni messages bruts", async () => {
  const m = monter({ script: scriptRecours() });
  const res = await appeler(m.analyse, dossier("recours"));
  assert.equal(res.corps.includes("SIG-SECRETE"), false);
  assert.equal(res.corps.includes("\"thinking\""), false);
  assert.equal(res.corps.includes("\"messages\""), false);
  const stocke = JSON.stringify(m.redis.donnees.get(`production:run:${res.json().run_id}`));
  assert.ok(stocke.includes("SIG-SECRETE"), "la réflexion reste côté serveur pour la reprise");
});

test("quota atteint : rejeu signalé, sans appel au modèle ; sans rejeu → indisponible, règles conservées", async () => {
  const m = monter();
  for (let i = 0; i < CONFIG.quota_jour; i++) await m.redis.incr("production:quota:2026-09-30");
  H._definirChargeurRejeu((s) => ({ scenario: s || "recours", contenu: rejeuFactice }));
  const r = (await appeler(m.analyse, dossier("reseau"))).json();
  assert.equal(r.mode, "rejeu");
  assert.equal(r.motif, "quota_atteint");
  assert.match(r.bandeau, /Rejeu d'une exécution réelle du 2026-10-01 — ce n'est pas l'analyse de votre saisie/);
  assert.equal(r.routage, "ALERTE_SIU", "le résultat des règles sur la saisie reste renvoyé");
  assert.equal(m.client.appels.length, 0);

  H._definirChargeurRejeu(() => null);
  const r2 = (await appeler(m.analyse, dossier("reseau"))).json();
  assert.equal(r2.mode, "indisponible");
  assert.equal(r2.message, H.MESSAGE_INDISPONIBLE);
});

test("stockage en panne ou absent : repli, sans appel au modèle", async () => {
  const m = monter({ script: scriptRecours() });
  m.redis.tomberEnPanne();
  const r = (await appeler(m.analyse, dossier("recours"))).json();
  assert.equal(r.mode, "indisponible");
  assert.equal(r.motif, "stockage_indisponible");
  assert.equal(m.client.appels.length, 0);
  const sans = monter({ sansStore: true });
  assert.equal((await appeler(sans.analyse, dossier("reseau"))).json().motif, "stockage_indisponible");
});

test("clé Anthropic absente : repli « configuration » sans consommer de quota", async () => {
  const m = monter({ sansClient: true });
  const r = (await appeler(m.analyse, dossier("reseau"))).json();
  assert.equal(r.motif, "configuration");
  assert.deepEqual(m.redis.cles(), []);
});

test("préfixe VERCEL_ENV via le handler : la prévisualisation écrit sous preview:", async () => {
  const m = monter({ script: scriptRecours(), env: "preview" });
  const r = (await appeler(m.analyse, dossier("recours"))).json();
  assert.deepEqual(m.redis.cles().sort(), ["preview:quota:2026-09-30", `preview:run:${r.run_id}`]);
});

test("exception imprévue du fournisseur : repli JSON, jamais d'erreur brute", async () => {
  const m = monter({ script: [{ erreur: new TypeError("boom interne") }] });
  const res = await appeler(m.analyse, dossier("reseau"));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().motif, "erreur_fournisseur");
  assert.equal(res.corps.includes("boom interne"), false);
});

test("exception imprévue hors du modèle : repli « erreur_interne »", async () => {
  const m = monter();
  const handler = H.creerHandlerAnalyse({
    now: m.horloge.now, uuid: () => "x",
    store: () => ({ incrementerQuota: async () => ({ autorise: true }), sauverRun: async () => {} }),
    client: () => ({ messages: { create: async () => { throw new Error("jamais atteint"); } } }),
    config: { ...CONFIG, temps: null }, // configuration corrompue → exception
  });
  const res = await appeler(handler, dossier("reseau"));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().motif, "erreur_interne");
});

// ── Quota ────────────────────────────────────────────────────────────────
test("quota : lecture seule, mise en cache CDN 60 s, aucune clé créée", async () => {
  const m = monter();
  const res = await appeler(m.quota, undefined, "GET");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { restantes: CONFIG.quota_jour, limite: CONFIG.quota_jour });
  assert.equal(res.headers["cache-control"], "public, max-age=0, s-maxage=60");
  assert.deepEqual(m.redis.cles(), []);
  assert.equal((await appeler(m.quota, {}, "POST")).statusCode, 405);
});

test("quota : stockage en panne ou absent → 503 sans mise en cache", async () => {
  const m = monter();
  m.redis.tomberEnPanne();
  const res = await appeler(m.quota, undefined, "GET");
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal((await appeler(monter({ sansStore: true }).quota, undefined, "GET")).statusCode, 503);
});

test("analyse en direct : la réponse donne le quota restant après l'incrément", async () => {
  const m = monter({ script: scriptRecours() });
  const r = (await appeler(m.analyse, dossier("recours"))).json();
  assert.deepEqual(r.quota, { restantes: CONFIG.quota_jour - 1, limite: CONFIG.quota_jour });
  const q = (await appeler(m.quota, undefined, "GET")).json();
  assert.equal(q.restantes, CONFIG.quota_jour - 1);
});

// ── Finalisation ─────────────────────────────────────────────────────────
test("finalisation : valider → termine ; le même run_id réutilisé → 410", async () => {
  const m = monter({ script: [...scriptRecours(), { reponse: F.reponse([F.appelOutil("finaliser_dossier", F.finalisationValide())]) }] });
  const a = (await appeler(m.analyse, dossier("recours"))).json();
  const res = await appeler(m.finalise, { run_id: a.run_id, action: "valider" });
  const f = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(f.mode, "direct");
  assert.equal(f.finalisation.statut_final, "RECOURS_A_ENGAGER");
  assert.equal(f.routage, "STP");
  assert.equal(res.corps.includes("SIG-SECRETE"), false);
  assert.equal(m.redis.cles().some((k) => k.includes(":run:")), false, "session supprimée");

  const encore = await appeler(m.finalise, { run_id: a.run_id, action: "valider" });
  assert.equal(encore.statusCode, 410);
  assert.equal(encore.json().message, "Session expirée, relancez l'analyse.");
});

test("finalisation : run_id inconnu ou expiré → 410 ; rejet sans motif → 400", async () => {
  const m = monter({ script: scriptRecours() });
  const inconnu = await appeler(m.finalise, { run_id: "11111111-2222-4333-8444-555555555555", action: "valider" });
  assert.equal(inconnu.statusCode, 410);
  const a = (await appeler(m.analyse, dossier("recours"))).json();
  assert.equal((await appeler(m.finalise, { run_id: a.run_id, action: "rejeter", motif: " " })).statusCode, 400);
  m.horloge.avancer(CONFIG.ttl_run_s * 1000);
  assert.equal((await appeler(m.finalise, { run_id: a.run_id, action: "valider" })).statusCode, 410);
});

test("finalisation : budget de temps dépassé → repli JSON (motif budget_temps), pas d'erreur brute", async () => {
  const lent = { duree_ms: 70000, reponse: F.reponse([F.appelOutil("calculer_montant_recours", { part_responsabilite_tiers_pct: 100 })]) };
  const m = monter({ script: [...scriptRecours(), lent] });
  const a = (await appeler(m.analyse, dossier("recours"))).json();
  H._definirChargeurRejeu((s) => ({ scenario: s, contenu: rejeuFactice }));
  const res = await appeler(m.finalise, { run_id: a.run_id, action: "valider" });
  const r = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(r.motif, "budget_temps");
  assert.equal(r.mode, "rejeu");
  assert.equal(r.rejeu.scenario, "recours");
  assert.equal(r.rejeu.finalisation.statut_final, "RECOURS_A_ENGAGER");
});

// ── Configuration Vercel et entrées réelles ──────────────────────────────
test("vercel.json : maxDuration au-dessus du budget interne et ≤ 300 s, plus de réécriture vers le proxy", () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  const a = v.functions["api/analyze.js"].maxDuration;
  const f = v.functions["api/finalize.js"].maxDuration;
  assert.ok(a * 1000 > CONFIG.temps.analyse.budget_ms && a <= 300);
  assert.ok(f * 1000 > CONFIG.temps.finalisation.budget_ms && f <= 300);
  assert.ok(v.functions["api/quota.js"].maxDuration <= 10);
  assert.equal(v.rewrites, undefined);
  for (const ancien of ["api/proxy.js", "api/check.js", "server.py"]) {
    assert.equal(fs.existsSync(path.join(__dirname, "..", ancien)), false, ancien);
  }
});

test("aucun secret exposé : valeurs sentinelles absentes des réponses et de la console", async () => {
  const SENTINELLES = { KV_REST_API_URL: "https://SENTINELLE-URL.invalid", KV_REST_API_TOKEN: "SENTINELLE-TOKEN", ANTHROPIC_API_KEY: "SENTINELLE-CLE" };
  const journal = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = console.warn = console.error = console.info = (...a) => journal.push(a.map(String).join(" "));
  const reponses = [];
  try {
    // Dépendances réelles : clients créés, mais aucun appel réseau pour STP ni en cas de 400
    const deps = H.depsReelles({ ...SENTINELLES, VERCEL_ENV: "preview" });
    assert.ok(deps.client(), "client Anthropic construit sans réseau");
    assert.ok(deps.store(), "client Redis construit sans réseau");
    const analyse = H.creerHandlerAnalyse(deps);
    reponses.push((await appeler(analyse, dossier("stp"))).corps);
    reponses.push((await appeler(analyse, { ...dossier("reseau"), model: "x" })).corps);
    // Sans configuration : repli propre, sans réseau
    const sansConfig = H.creerHandlerAnalyse(H.depsReelles({}));
    reponses.push((await appeler(sansConfig, dossier("reseau"))).corps);
  } finally {
    Object.assign(console, orig);
  }
  const tout = reponses.join("\n") + journal.join("\n");
  for (const valeur of Object.values(SENTINELLES)) assert.equal(tout.includes(valeur), false, valeur);
  assert.equal(JSON.parse(reponses[2]).motif, "configuration");
});

test("les secrets ne sont lus qu'à la construction des clients (lib/ et api/)", () => {
  const dossiers = [path.join(__dirname, "..", "lib"), path.join(__dirname, "..", "api")];
  const lectures = [];
  for (const d of dossiers) {
    for (const f of fs.readdirSync(d)) {
      const code = fs.readFileSync(path.join(d, f), "utf8").replace(/\/\/.*$/gm, "");
      for (const m of code.matchAll(/(?:env|process\.env)\.(KV_[A-Z_]+|ANTHROPIC_[A-Z_]+)/g)) lectures.push(`${f}:${m[1]}`);
      assert.doesNotMatch(code, /console\.(log|warn|error|info)\([^)]*(KV_|ANTHROPIC_|token|apiKey)/i, f);
    }
  }
  assert.deepEqual([...new Set(lectures)].sort(), [
    "handlers.js:ANTHROPIC_API_KEY", "store.js:KV_REST_API_TOKEN", "store.js:KV_REST_API_URL",
  ]);
});

test("les points d'entrée api/ se chargent sans réseau ni variables d'environnement", async () => {
  const analyse = require("../api/analyze.js");
  const finalise = require("../api/finalize.js");
  assert.equal(typeof require("../api/quota.js"), "function");
  assert.equal(typeof analyse, "function");
  assert.equal(typeof finalise, "function");
  const r = (await appeler(analyse, dossier("stp"))).json();
  assert.equal(r.mode, "regles_seules");
});
