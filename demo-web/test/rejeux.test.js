// Les rejeux enregistrés (public/replays/*.json) sont servis au visiteur en repli :
// ce test vérifie leur forme, leur cohérence avec les règles et l'absence de
// contenu interdit. Il se déclenche si les règles ou les scénarios changent sans
// ré-enregistrement.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { chargerRejeu } = require("../lib/replay.js");
const { evaluerDossier } = require("../lib/regles.js");
const { trier } = require("../lib/triage.js");
const { scenarios } = require("../public/scenarios.js");
const { PROMPT_VERSION } = require("../lib/prompts.js");

const ATTENDU = {
  reseau: { routage: "ALERTE_SIU", score: 30, mode: "instruction" },
  precoce: { routage: "INVESTIGATION", score: 15, mode: "instruction" },
  recours: { routage: "STP", score: 0, mode: "recours_seul" },
};
const DOSSIER = path.join(__dirname, "..", "public", "replays");

for (const [nom, attendu] of Object.entries(ATTENDU)) {
  test(`rejeu ${nom} : forme, routage des règles, finalisations, aucun contenu interdit`, () => {
    const texte = fs.readFileSync(path.join(DOSSIER, `${nom}.json`), "utf8");
    for (const interdit of ['"thinking"', '"signature"', '"messages"', "sk-ant"]) assert.equal(texte.includes(interdit), false, interdit);
    const r = JSON.parse(texte);
    assert.deepEqual(Object.keys(r).sort(), ["analyse", "enregistre_le", "finalisation"]);
    assert.match(r.enregistre_le, /^\d{2}\/\d{2}\/\d{4}$/);
    assert.deepEqual(Object.keys(r.finalisation).sort(), ["rejeter", "valider"]);

    // La proposition enregistrée reprend le routage et le score calculés par les règles
    const p = r.analyse.proposition;
    assert.equal(p.routage, attendu.routage);
    assert.equal(p.score_regles, attendu.score);
    assert.equal(p.mode, attendu.mode);
    const regles = evaluerDossier(scenarios()[nom]);
    assert.equal(regles.score, attendu.score, "les règles actuelles donnent toujours ce score : sinon, ré-enregistrer");
    assert.equal(trier(regles).routage, attendu.routage);
    assert.deepEqual(p.reason_codes, regles.reason_codes);

    // Trace client : tours, outils, usage ; aucune correction du serveur sur ces enregistrements
    assert.ok(r.analyse.trace.tours.length >= 1);
    assert.deepEqual(r.analyse.trace.corrections, []);
    assert.equal(r.analyse.trace.tours.at(-1).outils.at(-1).nom, "proposer_decision");
    assert.equal(r.finalisation.valider.finalisation.decision_gestionnaire, "valider");
    assert.equal(r.finalisation.rejeter.finalisation.statut_final, "REJETE_PAR_GESTIONNAIRE");
    assert.equal(r.finalisation.rejeter.finalisation.brouillon_courrier_recours, "");
    assert.equal(r.finalisation.valider.finalisation.avertissement, "Brouillon — aucun envoi réel.");
  });
}

test("rejeu recours : montant calculé par le code (5 652 €), courrier brouillon, PV cohérent avec les dates", () => {
  const r = JSON.parse(fs.readFileSync(path.join(DOSSIER, "recours.json"), "utf8"));
  const rec = r.analyse.proposition.recours;
  assert.equal(rec.evalue, true);
  assert.equal(rec.viable, true);
  assert.equal(rec.montant_recuperable, 5652);
  assert.equal(r.finalisation.valider.finalisation.statut_final, "RECOURS_A_ENGAGER");
  assert.ok(r.finalisation.valider.finalisation.brouillon_courrier_recours.length > 100);
  const texte = JSON.stringify(r);
  assert.equal(texte.includes("MARTIN & Fils"), false);
  assert.equal(texte.includes("14/03/2024"), false);
});

test("rejeux réseau et précoce : recours non évalué, aucun brouillon", () => {
  for (const nom of ["reseau", "precoce"]) {
    const r = JSON.parse(fs.readFileSync(path.join(DOSSIER, `${nom}.json`), "utf8"));
    assert.equal(r.analyse.proposition.recours.evalue, false);
    assert.equal(r.analyse.proposition.recours.montant_recuperable, null);
    assert.equal(r.finalisation.valider.finalisation.brouillon_courrier_recours, "");
  }
});

test("rejeux : lisibles par le chargeur du serveur, un par scénario à agent ; version du prompt courante", () => {
  for (const nom of Object.keys(ATTENDU)) {
    const c = chargerRejeu(nom);
    assert.equal(c.scenario, nom);
    assert.ok(c.contenu.analyse.proposition);
  }
  assert.equal(chargerRejeu("inconnu").scenario, "recours");
});

// Rejeux réenregistrés le 02/10/2026 sous le prompt 2026-10-02 (circonstances transmises à l'agent).
test("rejeux : enregistrés avec la version courante du prompt", () => {
  assert.equal(PROMPT_VERSION, "2026-10-02", "le prompt a changé depuis l'enregistrement : ré-enregistrer les rejeux");
});
