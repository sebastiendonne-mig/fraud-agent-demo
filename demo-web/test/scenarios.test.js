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
