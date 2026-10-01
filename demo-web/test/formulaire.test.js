// Formulaire : les pastilles et les valeurs par défaut produisent le dossier voulu.
// Exécute le vrai public/app.js sur un faux DOM bâti à partir du vrai public/index.html,
// puis évalue le dossier réellement envoyé avec les règles et le triage du serveur.
const test = require("node:test");
const assert = require("node:assert/strict");
const { chargerPage } = require("./helpers/faux-dom.js");
const { scenarios } = require("../public/scenarios.js");
const { validerDossier } = require("../lib/validate.js");
const { evaluerDossier } = require("../lib/regles.js");
const { trier, modeAgent } = require("../lib/triage.js");

const CHAMPS = ["id_police", "type_sinistre", "montant_reclame", "montant_plafond", "franchise",
  "date_declaration", "date_souscription", "id_reparateur", "reparateur_count_90d", "ip_count_30d", "rapport_police"];

// Évalue un dossier envoyé comme le fait le serveur : validation, règles, triage, mode de l'agent
function evaluerEnvoye(corps) {
  const v = validerDossier(corps);
  assert.equal(v.ok, true, JSON.stringify(v.erreurs));
  const regles = evaluerDossier(v.valeur);
  const { routage } = trier(regles);
  return { score: regles.score, routage, mode: modeAgent(routage, v.valeur.rapport_police), codes: regles.reason_codes };
}

const ATTENDU = {
  stp: { score: 0, routage: "STP", mode: null },
  reseau: { score: 30, routage: "ALERTE_SIU", mode: "instruction" },
  precoce: { score: 15, routage: "INVESTIGATION", mode: "instruction" },
  recours: { score: 0, routage: "STP", mode: "recours_seul" },
};

for (const [nom, attendu] of Object.entries(ATTENDU)) {
  test(`pastille « ${nom} » : tous les champs renseignés, dossier envoyé → ${attendu.score}/50, ${attendu.routage}`, () => {
    const page = chargerPage();
    page.pastille(nom).click();
    const voulu = page.pastille ? scenarios()[nom] : null;
    for (const champ of CHAMPS) assert.equal(page.valeur(champ), String(voulu[champ]), `champ ${champ}`);
    const corps = page.soumettre();
    assert.equal(corps.scenario, nom);
    for (const champ of ["reparateur_count_90d", "ip_count_30d"]) assert.equal(corps[champ], voulu[champ], champ);
    assert.deepEqual(evaluerEnvoye(corps), { ...attendu, codes: evaluerEnvoye(corps).codes });
  });
}

test("chaque scénario définit tous les champs du formulaire (aucune pastille ne laisse de valeur résiduelle)", () => {
  for (const [nom, s] of Object.entries(scenarios())) {
    assert.deepEqual(Object.keys(s).sort(), [...CHAMPS].sort(), nom);
  }
});

test("enchaîner les pastilles n'hérite d'aucune valeur de la précédente (réseau puis STP)", () => {
  const page = chargerPage();
  page.pastille("reseau").click();
  assert.equal(page.valeur("reparateur_count_90d"), "9");
  page.pastille("stp").click();
  assert.equal(page.valeur("reparateur_count_90d"), "0");
  assert.equal(page.valeur("ip_count_30d"), "0");
  assert.deepEqual(evaluerEnvoye(page.soumettre()), { score: 0, routage: "STP", mode: null, codes: [] });
});

test("formulaire par défaut : compteurs à 0, dossier à 0/50 en STP, l'agent n'est pas déclenché", () => {
  const page = chargerPage();
  assert.equal(page.valeur("reparateur_count_90d"), "0");
  assert.equal(page.valeur("ip_count_30d"), "0");
  const corps = page.soumettre();
  assert.equal(corps.scenario, undefined, "aucun scénario sans pastille");
  assert.deepEqual(evaluerEnvoye(corps), { score: 0, routage: "STP", mode: null, codes: [] });
});

test("après « Réinitialiser » : compteurs à 0, plus de scénario, l'agent n'est pas déclenché", () => {
  const page = chargerPage();
  page.pastille("reseau").click();
  page.reinitialiser();
  assert.equal(page.valeur("reparateur_count_90d"), "0");
  assert.equal(page.valeur("ip_count_30d"), "0");
  assert.equal(page.valeur("id_reparateur"), "");
  assert.equal(page.valeur("rapport_police"), "");
  const corps = page.soumettre();
  assert.equal(corps.scenario, undefined);
  assert.deepEqual(evaluerEnvoye(corps), { score: 0, routage: "STP", mode: null, codes: [] });
});

test("valeurs par défaut du HTML : aucun compteur ne dépasse 0 (un visiteur ne déclenche jamais l'agent sans le vouloir)", () => {
  const { lireControles } = require("./helpers/faux-dom.js");
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "public", "index.html"), "utf8");
  const v = lireControles(html);
  assert.equal(v.reparateur_count_90d, "0");
  assert.equal(v.ip_count_30d, "0");
  assert.equal(v.id_reparateur, "");
  assert.equal(v.rapport_police, "");
});
