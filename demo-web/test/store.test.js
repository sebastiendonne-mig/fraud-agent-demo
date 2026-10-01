const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/store.js");
const { chargerRejeu } = require("../lib/replay.js");
const { creerFauxRedis } = require("./helpers/faux-redis.js");
const { creerHorloge } = require("./helpers/faux-anthropic.js");
const CONFIG = require("../config/agent.json");

// 30/09/2026 à 12:00 heure de Paris
const MIDI_PARIS = Date.UTC(2026, 8, 30, 10, 0, 0);

test("préfixe VERCEL_ENV : quota de la prévisualisation indépendant de celui de la production", async () => {
  const redis = creerFauxRedis();
  const prod = S.creerStore({ redis, env: "production" });
  const preview = S.creerStore({ redis, env: "preview" });
  for (let i = 0; i < CONFIG.quota_jour.preview; i++) await preview.incrementerQuota(MIDI_PARIS);
  assert.equal((await preview.incrementerQuota(MIDI_PARIS)).autorise, false, "preview épuisé");
  assert.equal((await prod.incrementerQuota(MIDI_PARIS)).autorise, true, "prod intacte");
  assert.deepEqual(redis.cles().sort(), ["preview:quota:2026-09-30", "production:quota:2026-09-30"]);
  assert.equal((await prod.lireQuota(MIDI_PARIS)).utilisees, 1);
});

test("préfixe VERCEL_ENV : clés de session séparées, environnement inconnu ou absent → development", async () => {
  const redis = creerFauxRedis();
  await S.creerStore({ redis, env: "production" }).sauverRun("abc", { x: 1 });
  assert.equal(await S.creerStore({ redis, env: "preview" }).prendreRun("abc"), null);
  assert.deepEqual(redis.cles(), ["production:run:abc"]);
  assert.equal(S.environnement(undefined), "development");
  assert.equal(S.environnement("staging"), "development");
  assert.equal(S.creerStore({ redis, env: undefined }).cle("quota", "j"), "development:quota:j");
});

test("quota : autorisé jusqu'à la limite, refusé au-delà, expiration posée au premier incrément", async () => {
  const redis = creerFauxRedis();
  const store = S.creerStore({ redis, env: "production" });
  const limite = CONFIG.quota_jour.production;
  const resultats = [];
  for (let i = 0; i < limite + 1; i++) resultats.push((await store.incrementerQuota(MIDI_PARIS)).autorise);
  assert.deepEqual(resultats, [...Array(limite).fill(true), false]);
  assert.equal(redis.ttl("production:quota:2026-09-30"), CONFIG.ttl_quota_s);
  assert.deepEqual(await store.lireQuota(MIDI_PARIS), { utilisees: limite + 1, restantes: 0, limite });
});

test("lecture du quota : lecture seule, zéro si aucune analyse", async () => {
  const redis = creerFauxRedis();
  const store = S.creerStore({ redis, env: "production" });
  const limite = CONFIG.quota_jour.production;
  assert.deepEqual(await store.lireQuota(MIDI_PARIS), { utilisees: 0, restantes: limite, limite });
  assert.deepEqual(redis.cles(), [], "la lecture ne crée aucune clé");
});

test("jour du quota en heure de Paris (bascule à minuit Paris, pas à minuit UTC)", () => {
  assert.equal(S.jourDuQuota(Date.UTC(2026, 8, 30, 21, 59), "Europe/Paris"), "2026-09-30");
  assert.equal(S.jourDuQuota(Date.UTC(2026, 8, 30, 22, 0), "Europe/Paris"), "2026-10-01");
});

test("run_id à usage unique : getdel, puis null ; expiration après 30 min", async () => {
  const horloge = creerHorloge();
  const redis = creerFauxRedis({ horloge });
  const store = S.creerStore({ redis, env: "production" });
  await store.sauverRun("r1", { etat: "pause" });
  assert.equal(redis.ttl("production:run:r1"), CONFIG.ttl_run_s);
  assert.deepEqual(await store.prendreRun("r1"), { etat: "pause" });
  assert.equal(await store.prendreRun("r1"), null);
  await store.sauverRun("r2", { etat: "pause" });
  horloge.avancer(CONFIG.ttl_run_s * 1000);
  assert.equal(await store.prendreRun("r2"), null);
});

test("client réel : non créé si la configuration manque, jamais journalisé", () => {
  const journal = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => journal.push(a.join(" "));
  try {
    assert.equal(S.creerRedisDepuisEnv({}), null);
    assert.equal(S.creerRedisDepuisEnv({ KV_REST_API_URL: "https://sentinelle.invalid" }), null);
    const client = S.creerRedisDepuisEnv({ KV_REST_API_URL: "https://sentinelle-url.invalid", KV_REST_API_TOKEN: "SENTINELLE-TOKEN" });
    assert.ok(client, "client créé sans aucun appel réseau");
  } finally {
    Object.assign(console, orig);
  }
  assert.equal(journal.join("\n").includes("SENTINELLE"), false);
});

test("rejeu : fichier absent → null, scénario inconnu → scénario par défaut", () => {
  const absent = () => { throw Object.assign(new Error("absent"), { code: "MODULE_NOT_FOUND" }); };
  assert.equal(chargerRejeu("reseau", { reseau: absent }), null);
  const faux = { recours: () => ({ enregistre_le: "2026-10-01" }), reseau: () => ({ enregistre_le: "x" }) };
  assert.deepEqual(chargerRejeu("inconnu", faux), { scenario: "recours", contenu: { enregistre_le: "2026-10-01" } });
  assert.equal(chargerRejeu("reseau", faux).scenario, "reseau");
  assert.throws(() => chargerRejeu("reseau", { reseau: () => { throw new SyntaxError("JSON cassé"); } }), SyntaxError);
});

test("quota par environnement : 15 en production, 3 en preview et en development", () => {
  assert.deepEqual(CONFIG.quota_jour, { production: 15, preview: 3, development: 3 });
  for (const [env, limite] of [["production", 15], ["preview", 3], ["development", 3]]) {
    assert.equal(S.limiteQuota(CONFIG, S.environnement(env)), limite, env);
  }
});

test("quota : un environnement inconnu ou absent prend la limite de development", async () => {
  for (const env of ["staging", undefined, ""]) {
    assert.equal(S.limiteQuota(CONFIG, S.environnement(env)), CONFIG.quota_jour.development);
  }
  const redis = creerFauxRedis();
  const inconnu = S.creerStore({ redis, env: "staging" });
  const r = [];
  for (let i = 0; i < 4; i++) r.push((await inconnu.incrementerQuota(MIDI_PARIS)).autorise);
  assert.deepEqual(r, [true, true, true, false]);
});

test("quota : la production n'est pas bloquée par l'épuisement de la prévisualisation (limites distinctes)", async () => {
  const redis = creerFauxRedis();
  const prod = S.creerStore({ redis, env: "production" });
  const preview = S.creerStore({ redis, env: "preview" });
  for (let i = 0; i < 4; i++) await preview.incrementerQuota(MIDI_PARIS);
  assert.equal((await preview.lireQuota(MIDI_PARIS)).restantes, 0);
  const lectures = [];
  for (let i = 0; i < 15; i++) lectures.push((await prod.incrementerQuota(MIDI_PARIS)).autorise);
  assert.ok(lectures.every(Boolean), "15 analyses de production autorisées");
  assert.equal((await prod.incrementerQuota(MIDI_PARIS)).autorise, false, "la 16e est refusée");
});

test("quota : un nombre simple reste accepté (essais et enregistrement des rejeux)", async () => {
  const redis = creerFauxRedis();
  const s = S.creerStore({ redis, env: "production", config: { ...CONFIG, quota_jour: 2 } });
  assert.deepEqual([(await s.incrementerQuota(MIDI_PARIS)).autorise, (await s.incrementerQuota(MIDI_PARIS)).autorise, (await s.incrementerQuota(MIDI_PARIS)).autorise], [true, true, false]);
});
