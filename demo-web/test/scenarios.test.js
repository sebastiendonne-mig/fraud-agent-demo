const test = require("node:test");
const assert = require("node:assert/strict");
const { scenarios, pvRecours } = require("../public/scenarios.js");

// "JJ/MM/AAAA" → "AAAA-MM-JJ"
const iso = (fr) => fr.split("/").reverse().join("-");

test("PV du recours : daté entre la souscription et la déclaration, quelle que soit la date du jour", () => {
  for (const jour of [new Date(2026, 9, 1), new Date(2027, 0, 5), new Date(2026, 1, 28), new Date()]) {
    const r = scenarios(jour).recours;
    const datePv = iso(r.rapport_police.match(/Date : (\d{2}\/\d{2}\/\d{4})/)[1]);
    assert.ok(datePv > r.date_souscription, `${datePv} après la souscription ${r.date_souscription}`);
    assert.ok(datePv < r.date_declaration, `${datePv} avant la déclaration ${r.date_declaration}`);
    assert.equal(r.rapport_police.match(/PV-(\d{4})-0012/)[1], datePv.slice(0, 4), "numéro du PV aligné sur l'année");
  }
});

test("PV du recours : réparateur du dossier (REP-031), plus de garage incohérent", () => {
  const r = scenarios().recours;
  assert.match(r.rapport_police, /devis du réparateur REP-031/);
  assert.equal(r.rapport_police.includes("MARTIN & Fils"), false);
  assert.equal(r.id_reparateur, "REP-031");
});

test("pvRecours : format de date français", () => {
  assert.match(pvRecours("2026-09-17"), /Date : 17\/09\/2026 — 09h47/);
});

// Récits `circonstances` : fictifs, sans date, montant, nombre, plaque ni nom (le triage ne doit rien tirer d'un chiffre).
test("circonstances des scénarios : présentes, courtes, sans chiffre, sans identifiant fictif", () => {
  const { CIRCONSTANCES_MAX } = require("../lib/validate.js");
  for (const [nom, s] of Object.entries(scenarios())) {
    assert.ok(s.circonstances.length > 100 && s.circonstances.length <= CIRCONSTANCES_MAX, nom);
    assert.equal(/\d/.test(s.circonstances), false, `${nom} : aucun chiffre`);
    assert.equal(/DEMO-|REP-|POL-|MARTIN|BENALI|ROUSSEAU/.test(s.circonstances), false, `${nom} : aucun identifiant ni nom`);
  }
});

test("circonstances du recours : cause, responsable et témoin cohérents avec le PV", () => {
  const { circonstances, rapport_police } = scenarios().recours;
  assert.match(circonstances, /feu était vert/);
  assert.match(rapport_police, /feu vert/);
  assert.match(circonstances, /tourné à gauche sans s'arrêter au feu rouge/);
  assert.match(rapport_police, /grillé le feu rouge en tournant à gauche/);
  assert.match(circonstances, /avant droit/);
  assert.match(rapport_police, /avant droit/);
  assert.match(circonstances, /Un témoin a assisté à la scène et confirme que l'autre conducteur a brûlé le feu rouge/);
  assert.match(rapport_police, /TÉMOINS : .* confirme que .* a brûlé le feu rouge/);
  assert.match(circonstances, /entièrement responsable/);
  assert.match(rapport_police, /tiers\) responsable à 100 %/);
});

test("circonstances des scénarios « stp » et « precoce » : texte validé mot à mot", () => {
  const s = scenarios();
  assert.match(s.stp.circonstances, /^En quittant le parking d'un supermarché, /);
  assert.equal(s.precoce.circonstances,
    "Une canalisation a cédé dans la salle de bain pendant mon absence et l'eau a envahi le logement. En rentrant le soir, j'ai trouvé le sol inondé. Je précise que je n'ai pas quitté le logement de la journée. Le parquet et le mobilier du salon sont abîmés.");
});
