const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const R = require("../lib/regles.js");
const { trier, modeAgent } = require("../lib/triage.js");
const { scenarios } = require("./helpers/scenarios.js");

const DATA = path.join(__dirname, "..", "..", "data-mock");
const sinistres = require(path.join(DATA, "sinistres_mock.json"));
const polices = require(path.join(DATA, "polices_mock.json"));
const scoresPython = require(path.join(DATA, "scores_output.json"));

test("parité avec Python : score_regles et reason codes identiques sur les 50 dossiers", () => {
  const features = R.featuresPortefeuille(sinistres, polices);
  const attendu = Object.fromEntries(scoresPython.map((s) => [s.id_sinistre, s]));
  assert.equal(features.length, 50);
  for (const f of features) {
    const r = R.scoreRegles(f);
    assert.equal(r.score, attendu[f.id_sinistre].score_regles, `score ${f.id_sinistre}`);
    assert.deepEqual(r.reason_codes, attendu[f.id_sinistre].reason_codes, `reason codes ${f.id_sinistre}`);
  }
});

test("parité avec Python sur des cas synthétiques (règle du montant, arrondis du z-score)", () => {
  // Générés par scripts/generer-fixtures-regles.py avec compute_rule_score (Python)
  const cas = require("./fixtures/regles-python.json");
  assert.ok(cas.some((c) => c.reason_codes.some((r) => r.startsWith("Montant"))));
  for (const c of cas) {
    const e = c.entree;
    const r = R.scoreRegles({
      ...e, adresse_ip: e.adresse_ip_declaration, jours_depuis_souscription: e.days_since_subscription,
    });
    assert.equal(r.score, c.score, JSON.stringify(e));
    assert.deepEqual(r.reason_codes, c.reason_codes);
  }
});

test("formatage du z-score conforme à Python (égalité exacte arrondie au pair)", () => {
  assert.equal(R.uneDecimale(2.25), "2.2");
  assert.equal(R.uneDecimale(2.75), "2.8");
  assert.equal(R.uneDecimale(2.35), "2.4");
  assert.equal(R.uneDecimale(1.95), "1.9");
});

test("jours depuis la souscription bornés à 0 (souscription postérieure à la déclaration)", () => {
  assert.equal(R.joursDepuisSouscription("2026-01-10", "2026-01-20"), 0);
  assert.equal(R.joursDepuisSouscription("2026-03-01", "2026-02-01"), 28);
});

test("z-score : écart-type d'échantillon, cas limites n = 1 et écart-type nul", () => {
  const stats = R.statsParType([
    { type: "a", montant_reclame: 10 }, { type: "a", montant_reclame: 20 },
    { type: "b", montant_reclame: 5 },
    { type: "c", montant_reclame: 7 }, { type: "c", montant_reclame: 7 },
  ]);
  assert.ok(Math.abs(stats.a.ecartType - Math.sqrt(50)) < 1e-12);
  assert.equal(R.zscoreMontant(99, "b", stats), 0);
  assert.equal(R.zscoreMontant(9, "c", stats), 2);
  assert.equal(R.zscoreMontant(1, "inconnu", stats), 0);
});

// Features minimales neutres, pour isoler une règle
const neutre = { type: "vol", montant_reclame: 100, id_reparateur: "REP-1", ip_count_30d: 0,
  reparateur_count_90d: 0, jours_depuis_souscription: 400, montant_zscore: 0 };

test("seuils des règles (valeurs Python : IP ≥ 1, réparateur ≥ 2, précoce < 30 j, z > 1,8)", () => {
  assert.equal(R.scoreRegles({ ...neutre, ip_count_30d: 1 }).detail.ip, 10);
  assert.equal(R.scoreRegles({ ...neutre, ip_count_30d: 5 }).detail.ip, 20);
  assert.equal(R.scoreRegles({ ...neutre, reparateur_count_90d: 1 }).detail.reparateur, 0);
  assert.equal(R.scoreRegles({ ...neutre, reparateur_count_90d: 2 }).detail.reparateur, 14);
  assert.equal(R.scoreRegles({ ...neutre, reparateur_count_90d: 9 }).detail.reparateur, 20);
  assert.equal(R.scoreRegles({ ...neutre, jours_depuis_souscription: 29 }).detail.precoce, 15);
  assert.equal(R.scoreRegles({ ...neutre, jours_depuis_souscription: 30 }).detail.precoce, 0);
  assert.equal(R.scoreRegles({ ...neutre, montant_zscore: 1.8 }).detail.montant, 0);
  assert.equal(R.scoreRegles({ ...neutre, montant_zscore: 1.81 }).detail.montant, 10);
});

test("plafond du score à 50", () => {
  const r = R.scoreRegles({ ...neutre, ip_count_30d: 9, reparateur_count_90d: 9, jours_depuis_souscription: 0, montant_zscore: 5 });
  assert.equal(r.score, 50);
});

test("reason code IP sans adresse quand le dossier web n'en fournit pas", () => {
  const r = R.scoreRegles({ ...neutre, ip_count_30d: 1 });
  assert.equal(r.reason_codes[0], "Adresse IP partagée avec 1 autre(s) dossier(s) sur 30 jours");
});

test("bornes du routage : 14 → STP, 15 → INVESTIGATION, 29 → INVESTIGATION, 30 → ALERTE_SIU", () => {
  assert.equal(trier({ score: 14 }).routage, "STP");
  assert.equal(trier({ score: 15 }).routage, "INVESTIGATION");
  assert.equal(trier({ score: 29 }).routage, "INVESTIGATION");
  assert.equal(trier({ score: 30 }).routage, "ALERTE_SIU");
  assert.equal(trier({ score: 30 }).source, "regles");
});

test("les 4 scénarios restent distincts (STP / SIU / Investigation / STP + recours)", () => {
  const sc = scenarios();
  const attendu = {
    stp: [0, "STP", null],
    reseau: [30, "ALERTE_SIU", "instruction"],
    precoce: [15, "INVESTIGATION", "instruction"],
    recours: [0, "STP", "recours_seul"],
  };
  for (const [nom, [score, routage, mode]] of Object.entries(attendu)) {
    const r = R.evaluerDossier(sc[nom]);
    const t = trier(r);
    assert.equal(r.score, score, `score ${nom}`);
    assert.equal(t.routage, routage, `routage ${nom}`);
    assert.equal(modeAgent(t.routage, sc[nom].rapport_police), mode, `mode ${nom}`);
  }
});

test("mode de l'agent : STP sans rapport → aucun agent ; rapport blanc = pas de rapport", () => {
  assert.equal(modeAgent("STP", ""), null);
  assert.equal(modeAgent("STP", "   \n "), null);
  assert.equal(modeAgent("STP", "PV"), "recours_seul");
  assert.equal(modeAgent("INVESTIGATION", ""), "instruction");
});
