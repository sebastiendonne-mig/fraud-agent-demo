// Le paquet `ai` (v7) est ESM uniquement ; le code du dépôt est en CommonJS.
// Ce test vérifie, sans réseau, que l'import dynamique fonctionne et que
// l'API d'évaluation et son faux modèle sont présents dans la version figée.
const test = require("node:test");
const assert = require("node:assert/strict");

test("filet réseau actif : fetch et sockets sont interdits", () => {
  assert.throws(() => globalThis.fetch("https://example.invalid"), /Accès réseau interdit/);
  assert.throws(() => require("net").connect(80, "127.0.0.1"), /Accès réseau interdit/);
  assert.throws(() => require("tls").connect(443, "127.0.0.1"), /Accès réseau interdit/);
});

test("import(\"ai\") depuis CommonJS : experimental_evaluate et createGateway exposés", async () => {
  const ai = await import("ai");
  assert.equal(typeof ai.experimental_evaluate, "function");
  assert.equal(typeof ai.createGateway, "function");
});

test("ai/test : Experimental_EvaluationMockModelV4 exposé", async () => {
  const t = await import("ai/test");
  assert.equal(typeof t.Experimental_EvaluationMockModelV4, "function");
});

test("version d'ai figée, 7.x au moins 7.0.105", () => {
  const { version } = require("ai/package.json");
  const [maj, min, patch] = version.split(".").map(Number);
  assert.equal(maj, 7);
  assert.ok(min > 0 || patch >= 105, `version ${version}`);
});

// Constat consigné : require() d'un module ESM, sous Node 24, sans await de haut niveau.
// Le code de production n'en dépend pas (il utilise import()).
test("require(\"ai\") sous cette version de Node : résultat consigné (n'influence pas le code)", () => {
  let ok = true;
  try { require("ai"); } catch { ok = false; }
  console.log(`# require("ai") sous Node ${process.version} : ${ok ? "fonctionne" : "échoue"}`);
  assert.equal(typeof ok, "boolean");
});
