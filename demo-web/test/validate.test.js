const test = require("node:test");
const assert = require("node:assert/strict");
const { validerDossier, validerFinalisation } = require("../lib/validate.js");
const { scenarios } = require("./helpers/scenarios.js");

const base = () => scenarios().reseau;
const champsEnErreur = (r) => r.erreurs.map((e) => e.champ);

test("les 4 scénarios de démonstration sont valides", () => {
  for (const [nom, d] of Object.entries(scenarios())) {
    assert.equal(validerDossier({ ...d, scenario: nom }).ok, true, nom);
  }
});

test("champs refusés : model, system, messages et tout champ inconnu", () => {
  for (const intrus of ["model", "system", "messages", "max_tokens", "tools", "inconnu"]) {
    const r = validerDossier({ ...base(), [intrus]: "x" });
    assert.equal(r.ok, false, intrus);
    assert.deepEqual(champsEnErreur(r), [intrus]);
  }
});

test("corps non objet refusé (tableau, chaîne, null)", () => {
  for (const corps of [[], "texte", null, 42]) assert.equal(validerDossier(corps).ok, false);
});

test("circonstances : facultatives (défaut vide), limitées à 2 000 caractères, texte uniquement", () => {
  const { circonstances, ...sans } = base();
  assert.equal(validerDossier(sans).valeur.circonstances, "");
  assert.equal(validerDossier({ ...base(), circonstances: "x".repeat(2000) }).ok, true);
  assert.deepEqual(champsEnErreur(validerDossier({ ...base(), circonstances: "x".repeat(2001) })), ["circonstances"]);
  for (const mauvais of [42, null, ["a"], { a: 1 }, true]) {
    assert.deepEqual(champsEnErreur(validerDossier({ ...base(), circonstances: mauvais })), ["circonstances"], JSON.stringify(mauvais));
  }
});

test("rapport de police limité à 4 000 caractères", () => {
  assert.equal(validerDossier({ ...base(), rapport_police: "x".repeat(4000) }).ok, true);
  assert.deepEqual(champsEnErreur(validerDossier({ ...base(), rapport_police: "x".repeat(4001) })), ["rapport_police"]);
});

test("dates invalides refusées (format, date impossible, hors bornes)", () => {
  for (const d of ["2026-02-30", "30/09/2026", "1999-12-31", "2026-13-01", 20260101]) {
    assert.deepEqual(champsEnErreur(validerDossier({ ...base(), date_declaration: d })), ["date_declaration"], String(d));
  }
});

test("bornes des montants et des compteurs, types stricts", () => {
  const cas = [
    ["montant_reclame", -1], ["montant_reclame", 500001], ["montant_reclame", "4800"], ["montant_reclame", NaN],
    ["franchise", 5001], ["reparateur_count_90d", 1.5], ["reparateur_count_90d", 51], ["ip_count_30d", -1],
    ["type_sinistre", "tempete"], ["id_police", "<script>"], ["id_reparateur", "REP 007"], ["scenario", "autre"],
  ];
  for (const [champ, v] of cas) {
    assert.deepEqual(champsEnErreur(validerDossier({ ...base(), [champ]: v })), [champ], `${champ}=${v}`);
  }
});

test("champs facultatifs : valeurs par défaut et réparateur vide → null", () => {
  const { reparateur_count_90d, ip_count_30d, rapport_police, franchise, ...minimal } = base();
  const r = validerDossier({ ...minimal, id_reparateur: "" });
  assert.equal(r.ok, true);
  assert.equal(r.valeur.id_reparateur, null);
  assert.equal(r.valeur.reparateur_count_90d, 0);
  assert.equal(r.valeur.rapport_police, "");
  assert.equal(r.valeur.scenario, null);
});

test("finalisation : run_id UUID, action connue, motif obligatoire en cas de rejet", () => {
  const id = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";
  assert.equal(validerFinalisation({ run_id: id, action: "valider" }).ok, true);
  assert.equal(validerFinalisation({ run_id: id, action: "rejeter", motif: "Tiers non identifiable" }).ok, true);
  assert.deepEqual(champsEnErreur(validerFinalisation({ run_id: id, action: "rejeter", motif: "  " })), ["motif"]);
  assert.deepEqual(champsEnErreur(validerFinalisation({ run_id: "run:123", action: "valider" })), ["run_id"]);
  assert.deepEqual(champsEnErreur(validerFinalisation({ run_id: id, action: "supprimer" })), ["action"]);
  assert.deepEqual(champsEnErreur(validerFinalisation({ run_id: id, action: "rejeter", motif: "x".repeat(501) })), ["motif"]);
  assert.deepEqual(champsEnErreur(validerFinalisation({ run_id: id, action: "valider", system: "x" })), ["system"]);
});
