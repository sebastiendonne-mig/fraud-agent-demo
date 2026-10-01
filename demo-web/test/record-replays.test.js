// Tests du script d'enregistrement des rejeux : UNIQUEMENT avec le faux modèle.
// Aucun test ne lance le script avec --yes ET une clé.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { creerFauxModele } = require("../scripts/serveur-local.js");
const { chargerRejeu } = require("../lib/replay.js");
const { scenarios, PV_RECOURS } = require("../scenarios.js");
const H = require("../lib/handlers.js");
const F = require("./helpers/faux-anthropic.js");

const SCRIPT = path.join(__dirname, "..", "scripts", "record-replays.mjs");
const charger = () => import(SCRIPT);
const dossierTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rejeux-test-"));
const silencieux = () => {};
const fauxClient = () => creerFauxModele({ latence_ms: 0 });

function lancer(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8", timeout: 20000 });
}

test("CLI sans --yes : arrêt (code 2), plan et borne haute affichés, clé jamais affichée", () => {
  const home = dossierTemp();
  const r = lancer([], { PATH: process.env.PATH, HOME: home, ANTHROPIC_API_KEY: "SENTINELLE-CLE-NE-PAS-AFFICHER" });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /exécutions RÉELLES et PAYANTES/);
  assert.match(r.stdout, /9 exécutions/);
  assert.match(r.stdout, /Borne haute de coût : 2\.76 \$/);
  assert.match(r.stdout, /ajoutez --yes/);
  assert.equal((r.stdout + r.stderr).includes("SENTINELLE"), false);
  assert.equal(fs.existsSync(path.join(home, "Documents")), false, "aucun fichier écrit");
});

test("CLI avec --yes mais sans clé dans l'environnement : arrêt (code 2)", () => {
  const home = dossierTemp();
  const r = lancer(["--yes", "--fumee"], { PATH: process.env.PATH, HOME: home }); // environnement sans ANTHROPIC_API_KEY
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Mode fumée/);
  assert.match(r.stdout, /Borne haute de coût : 0\.46 \$/);
  assert.match(r.stdout, /ANTHROPIC_API_KEY absente/);
});

test("CLI : argument inconnu refusé", () => {
  const r = lancer(["--oui"], { PATH: process.env.PATH, HOME: dossierTemp() });
  assert.equal(r.status, 2);
});

test("enregistrement complet (faux modèle) : 3 rejeux propres, 9 exécutions mesurées", async () => {
  const { executer, cout } = await charger();
  const dossier = dossierTemp();
  const fichierMesures = path.join(dossierTemp(), "mesures.json");
  const m = await executer({ client: fauxClient(), dossierReplays: dossier, fichierMesures, journal: silencieux });

  assert.deepEqual(fs.readdirSync(dossier).sort(), ["precoce.json", "recours.json", "reseau.json"]);
  for (const f of fs.readdirSync(dossier)) {
    const texte = fs.readFileSync(path.join(dossier, f), "utf8");
    const r = JSON.parse(texte);
    assert.deepEqual(Object.keys(r).sort(), ["analyse", "enregistre_le", "finalisation"]);
    assert.deepEqual(Object.keys(r.analyse).sort(), ["proposition", "trace"]);
    assert.deepEqual(Object.keys(r.finalisation).sort(), ["rejeter", "valider"]);
    assert.match(r.enregistre_le, /^\d{2}\/\d{2}\/\d{4}$/);
    for (const interdit of ['"thinking"', '"signature"', '"messages"', "SIGNATURE-LOCALE"]) {
      assert.equal(texte.includes(interdit), false, `${f} contient ${interdit}`);
    }
    assert.equal(r.finalisation.rejeter.finalisation.statut_final, "REJETE_PAR_GESTIONNAIRE");
    assert.notEqual(r.finalisation.valider.finalisation.statut_final, "REJETE_PAR_GESTIONNAIRE");
  }

  const ecrit = JSON.parse(fs.readFileSync(fichierMesures, "utf8"));
  assert.equal(ecrit.executions.length, 9);
  assert.deepEqual(ecrit.echecs, []);
  assert.deepEqual(ecrit.mentions_reelles, []);
  for (const e of ecrit.executions) {
    assert.ok(e.nombre_tours >= 1 && e.durees_tours_ms.length === e.nombre_tours);
    assert.equal(e.cout_usd, Number(cout(e.usage).toFixed(6)));
    assert.equal(typeof e.duree_bout_en_bout_ms, "number");
  }
  assert.equal(m.synthese.analyses_completes, 3);
  assert.ok(m.synthese.cout_moyen_par_analyse_usd > 0);
  assert.equal(ecrit.modele, "claude-sonnet-5-5");
});

test("mode fumée : appel 1 + Valider seulement, aucun rejeu écrit", async () => {
  const { executer } = await charger();
  const dossier = path.join(dossierTemp(), "replays");
  const fichierMesures = path.join(dossierTemp(), "mesures-fumee.json");
  const m = await executer({ client: fauxClient(), fumee: true, dossierReplays: dossier, fichierMesures, journal: silencieux });
  assert.deepEqual(m.executions.map((e) => [e.scenario, e.appel]), [["recours", "analyse"], ["recours", "valider"]]);
  assert.equal(fs.existsSync(dossier), false);
  assert.deepEqual(m.fichiers_ecrits, []);
});

test("repli pendant l'enregistrement (refus) : rejeu du scénario non écrit, motif consigné, autres écrits", async () => {
  const { executer } = await charger();
  const base = fauxClient();
  const client = {
    messages: {
      async create(params, options) {
        if (params.messages[0].content[0].text.includes("POL-55401")) {
          return F.reponse([F.texte("…")], { stop_reason: "refusal" });
        }
        return base.messages.create(params, options);
      },
    },
  };
  const dossier = dossierTemp();
  H._definirChargeurRejeu(() => null); // indépendant des rejeux réels présents dans replays/
  let m;
  try {
    m = await executer({ client, dossierReplays: dossier, fichierMesures: path.join(dossierTemp(), "m.json"), journal: silencieux });
  } finally {
    H._definirChargeurRejeu(null);
  }
  assert.deepEqual(fs.readdirSync(dossier).sort(), ["recours.json", "reseau.json"]);
  assert.deepEqual(m.echecs, [{ scenario: "precoce", appel: "analyse", mode: "indisponible", motif: "refus" }]);
});

test("détection des marques réelles et des plaques SIV dans les rejeux (signalées, sans bloquer)", async () => {
  const { executer } = await charger();
  const lesScenarios = scenarios();
  lesScenarios.recours.rapport_police =
    "Assuré AXA, plaque AB-123-CD. Covéa et Crédit Agricole Assurances cités.\n" + PV_RECOURS;
  const dossier = dossierTemp();
  const m = await executer({ client: fauxClient(), lesScenarios, dossierReplays: dossier, fichierMesures: path.join(dossierTemp(), "m.json"), journal: silencieux });
  assert.equal(m.fichiers_ecrits.length, 3, "la détection ne bloque pas l'écriture");
  const trouvees = m.mentions_reelles.filter((x) => x.fichier === "recours.json").map((x) => x.valeur).sort();
  assert.deepEqual(trouvees, ["AB-123-CD", "AXA", "Covéa", "Crédit Agricole Assurances"]);
  assert.equal(m.mentions_reelles.some((x) => x.fichier !== "recours.json"), false);
});

test("détection : pas de faux positif sur les identifiants fictifs ni dans les mots", async () => {
  const { detecterMentionsReelles } = await charger();
  assert.deepEqual(detecterMentionsReelles("plaques DEMO-101, PV-2024-0012, POL-78901 ; Mutuelle Fictive d'Assurance ; commande, gramma, maxima"), []);
  assert.deepEqual(detecterMentionsReelles("macif et Swiss  Life").map((x) => x.valeur).sort(), ["MACIF", "Swiss Life"]);
  assert.deepEqual(detecterMentionsReelles("ab-123-cd").map((x) => x.valeur), ["AB-123-CD"]);
});

test("format produit : lisible par chargerRejeu et rendu par le repli du serveur", async () => {
  const { executer } = await charger();
  const dossier = dossierTemp();
  await executer({ client: fauxClient(), dossierReplays: dossier, fichierMesures: path.join(dossierTemp(), "m.json"), journal: silencieux });
  const contenu = JSON.parse(fs.readFileSync(path.join(dossier, "reseau.json"), "utf8"));
  assert.equal(chargerRejeu("reseau", { reseau: () => contenu }).contenu, contenu);

  // Repli serveur (quota épuisé) avec ce rejeu : bandeau daté et proposition rejouée
  const { creerStore } = require("../lib/store.js");
  const { creerFauxRedis } = require("./helpers/faux-redis.js");
  const redis = creerFauxRedis();
  const store = creerStore({ redis, env: "production", config: { ...require("../config/agent.json"), quota_jour: 0 } });
  H._definirChargeurRejeu((s) => ({ scenario: s, contenu }));
  try {
    const handler = H.creerHandlerAnalyse({ now: () => Date.now(), uuid: () => "x", store: () => store, client: () => fauxClient() });
    const res = { corps: "", setHeader() {}, end(t) { this.corps = t; } };
    await handler({ method: "POST", body: { ...scenarios().reseau, scenario: "reseau" } }, res);
    const r = JSON.parse(res.corps);
    assert.equal(r.mode, "rejeu");
    assert.match(r.bandeau, new RegExp(`du ${contenu.enregistre_le.replace(/\//g, "\\/")} — ce n'est pas`));
    assert.deepEqual(r.rejeu.proposition, contenu.analyse.proposition);
  } finally {
    H._definirChargeurRejeu(null);
  }
});

test("coût et borne haute : calcul exact au tarif de config/agent.json", async () => {
  const { cout, borneParCouple } = await charger();
  assert.equal(cout({ entree: 1e6, sortie: 1e6, cache_lecture: 1e6, cache_ecriture: 1e6 }).toFixed(4), "14.7000");
  assert.equal(cout({ entree: 3000, sortie: 400, cache_lecture: 0, cache_ecriture: 0 }).toFixed(6), "0.010000");
  assert.equal(borneParCouple().toFixed(2), "0.46");
});

test("code source : aucune lecture de .env, aucun affichage de l'environnement", () => {
  const code = fs.readFileSync(SCRIPT, "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /dotenv|readFileSync\([^)]*\.env|\.env["'`]/);
  assert.doesNotMatch(code, /console\.(log|error|warn)\([^)]*process\.env/);
  assert.equal((code.match(/process\.env\.ANTHROPIC_API_KEY/g) || []).length, 2, "lue uniquement pour le test de présence et la construction du client");
});
