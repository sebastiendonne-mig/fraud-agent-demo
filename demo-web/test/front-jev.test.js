const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const APP = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

test("MOTIFS_JEV_REPLI : 7 motifs présents, chacun se termine par la phrase de repli", () => {
  const motifs = [
    "jev_non_configure",
    "jev_acces_refuse",
    "jev_budget_atteint",
    "jev_quota_atteint",
    "jev_reseau",
    "jev_reponse_invalide",
    "jev_erreur",
  ];
  for (const m of motifs) {
    assert.match(APP, new RegExp(m + ":"), `motif manquant : ${m}`);
    assert.match(
      APP,
      /le routage est calculé par les règles seules\./,
      "phrase de repli absente"
    );
  }
});

test("MOTIFS_JEV_REPLI : messages distincts, aucune valeur vide", () => {
  const bloc = APP.slice(APP.indexOf("MOTIFS_JEV_REPLI"), APP.indexOf("};", APP.indexOf("MOTIFS_JEV_REPLI")));
  const valeurs = [...bloc.matchAll(/"([^"]{10,})"/g)].map((m) => m[1]);
  assert.ok(valeurs.length >= 7, "moins de 7 chaînes dans MOTIFS_JEV_REPLI");
  const uniques = new Set(valeurs);
  assert.equal(uniques.size, valeurs.length, "deux messages Jev identiques");
});

test("badge conditionnel regles_seules : 3 variantes présentes dans app.js", () => {
  assert.match(APP, /Règles \+ Jev — sans agent/);
  assert.match(APP, /Règles seules — Jev indisponible/);
  assert.match(APP, /Règles seules — aucun appel IA/);
});

test("badge exécution directe : ' · Jev' ajouté uniquement si d.jev est présent", () => {
  assert.match(APP, /jevLabel = d\.jev \? " · Jev" : ""/);
  assert.match(APP, /tokens\$\{jevLabel\}/);
});

test("sourceRoutageTexte : 4 cas couverts", () => {
  assert.match(APP, /Routage relevé d'un niveau par Jev/);
  assert.match(APP, /Jev n'a relevé aucun niveau\. L'agent ne peut pas le modifier\./);
  assert.match(APP, /Routage calculé par les règles \(triage Jev indisponible\)\./);
  assert.match(APP, /aucun texte à analyser\. L'agent ne peut pas le modifier\./);
});

test("LIBELLES_JEV : 4 questions avec libellés exacts", () => {
  assert.match(APP, /contradiction_interne: "Contradiction interne"/);
  assert.match(APP, /divergence_recit_rapport: "Divergence récit \/ rapport de police"/);
  assert.match(APP, /cause_evoquee: "Cause évoquée : acte volontaire"/);
  assert.match(APP, /pression_indemnisation: "Pression à l'indemnisation"/);
});

test("COMPARAISON_JEV : mesures du 02/10/2026 présentes, deux tâches distinctes", () => {
  assert.match(APP, /COMPARAISON_JEV = "/);
  assert.match(APP, /02\/10\/2026/);
  assert.match(APP, /0,00003 à 0,000047 \$/);
  assert.match(APP, /0,0205 \$/);
  assert.match(APP, /Jev trie, l'agent enquête et rédige : ce ne sont pas les mêmes tâches\./);
});

test("afficherCarteJev : aucun innerHTML (DOM-only)", () => {
  const bloc = APP.slice(APP.indexOf("function afficherCarteJev"), APP.indexOf("\nfunction ", APP.indexOf("function afficherCarteJev") + 1));
  assert.doesNotMatch(bloc, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(bloc, /createElement|el\(/);
});

test("bandeauRejeu : mentionne l'absence de triage Jev", () => {
  assert.match(APP, /sans triage Jev : en direct, le routage peut différer\./);
});
