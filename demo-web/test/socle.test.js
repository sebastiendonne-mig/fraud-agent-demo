const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { construirePortefeuille, SOURCE } = require("../scripts/sync-portefeuille.js");

test("aucun accès réseau possible pendant les tests", () => {
  assert.throws(() => fetch("https://example.invalid"), /Accès réseau interdit/);
});

test("data/portefeuille.json est synchronisé avec data-mock/sinistres_mock.json", () => {
  const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const copie = require("../data/portefeuille.json");
  assert.deepEqual(copie, construirePortefeuille(source));
});

test("le portefeuille ne contient ni IP ni étiquette de fraude", () => {
  const copie = require("../data/portefeuille.json");
  for (const s of copie) {
    assert.deepEqual(Object.keys(s).sort(), ["date_declaration", "id_reparateur", "id_sinistre", "montant_reclame", "type"]);
  }
});

test("package.json : versions figées et aucun script dev", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  for (const v of Object.values(pkg.dependencies)) assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.scripts.dev, undefined);
});
