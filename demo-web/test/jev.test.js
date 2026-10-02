const test = require("node:test");
const assert = require("node:assert/strict");
const J = require("../lib/jev.js");
const CONFIG = require("../config/jev.json");
const F = require("./helpers/faux-jev.js");
const { scenarios } = require("./helpers/scenarios.js");

const JETON = "JETON-OIDC-SENTINELLE-123";
const TEXTES = { circonstances: "Un récit fictif.", rapport_police: "" };
const sansJournal = { journal: () => {} };

// ── State et questions ───────────────────────────────────────────────────
test("state : uniquement les textes, étiquetés ; clés absentes si texte vide ; aucun texte → null", () => {
  assert.deepEqual(J.construireState({ circonstances: " récit ", rapport_police: "PV" }), { circonstances_declarees: "récit", rapport_police: "PV" });
  assert.deepEqual(J.construireState({ circonstances: "récit", rapport_police: "  " }), { circonstances_declarees: "récit" });
  assert.deepEqual(J.construireState({ circonstances: "", rapport_police: "PV" }), { rapport_police: "PV" });
  assert.equal(J.construireState({ circonstances: "", rapport_police: "" }), null);
  assert.equal(J.construireState({}), null);
  // Un dossier complet ne laisse passer aucun montant, date ni compteur
  const d = { ...scenarios().recours, scenario: "recours" };
  const s = J.construireState(d);
  assert.deepEqual(Object.keys(s).sort(), ["circonstances_declarees", "rapport_police"]);
  assert.equal(JSON.stringify(s).includes(String(d.montant_reclame)), false);
  assert.equal(JSON.stringify(s).includes(d.date_declaration), false);
});

test("questions : la divergence récit/rapport n'est posée que si les deux textes existent", () => {
  const un = Object.keys(J.questionsPour({ circonstances_declarees: "a" }));
  const deux = Object.keys(J.questionsPour({ circonstances_declarees: "a", rapport_police: "b" }));
  assert.deepEqual(un, ["contradiction_interne", "cause_evoquee", "pression_indemnisation"]);
  assert.deepEqual(deux, ["contradiction_interne", "divergence_recit_rapport", "cause_evoquee", "pression_indemnisation"]);
});

test("questions : types attendus, aucune ne porte sur une date, un montant ou un comptage", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(J.QUESTIONS).map(([id, q]) => [id, q.type])), {
    contradiction_interne: "boolean", divergence_recit_rapport: "boolean", cause_evoquee: "choice", pression_indemnisation: "score",
  });
  const texte = JSON.stringify(J.QUESTIONS).toLowerCase();
  for (const interdit of ["date", "montant", "combien", "nombre", "euro", "€", "jour", "durée", "compte"]) {
    assert.equal(texte.includes(interdit), false, `mot interdit : ${interdit}`);
  }
  assert.equal(/\d/.test(texte), false, "aucun chiffre dans les questions");
  assert.equal(J.QUESTIONS.cause_evoquee.criteria.acte_volontaire, "un acte volontaire de l'assuré ou d'une personne de son entourage est décrit comme cause");
  assert.match(J.QUESTIONS.pression_indemnisation.instructions, /^Les textes fournis demandent-ils/);
});

// ── Classement des réponses (seuils) ─────────────────────────────────────
function classer(modifs, config) {
  const state = { circonstances_declarees: "a", rapport_police: "b" };
  const questions = J.questionsPour(state);
  return J.classerQuestions(questions, F.filtrer(F.reponses(modifs), questions), undefined, config);
}

test("seuils d'un booléen : ≤ 0,2 neutre ; entre les deux incertain ; ≥ 0,8 signal", () => {
  const attendu = [[0.19, "neutre"], [0.2, "neutre"], [0.21, "incertain"], [0.5, "incertain"], [0.79, "incertain"], [0.8, "signal"], [0.81, "signal"], [1, "signal"], [0, "neutre"]];
  for (const [p, statut] of attendu) {
    assert.equal(classer({ contradiction_interne: F.boolean(p) }).contradiction_interne.statut, statut, `p = ${p}`);
  }
  assert.equal(CONFIG.seuils.monte_a_partir_de, 0.8);
  assert.match(CONFIG._seuils, /démo, non calibrés/);
});

test("choice : on lit la probabilité d'acte_volontaire ; score : celle du niveau 2 (jamais la valeur interpolée)", () => {
  assert.equal(classer({ cause_evoquee: F.choixVolontaire(0.85) }).cause_evoquee.statut, "signal");
  assert.equal(classer({ cause_evoquee: F.choixVolontaire(0.5) }).cause_evoquee.statut, "incertain");
  assert.equal(classer({ pression_indemnisation: F.scorePression(0.9) }).pression_indemnisation.statut, "signal");
  // score interpolé élevé, mais distribution concentrée sur le niveau 1 : pas de signal
  const trompeur = { type: "score", score: 1.9, probabilities: { 0: 0, 1: 0.9, 2: 0.1 } };
  assert.equal(classer({ pression_indemnisation: trompeur }).pression_indemnisation.statut, "neutre");
});

test("confiance : basse → incertain ; absente ou illisible → probabilité seule, tracée « non_disponible »", () => {
  const state = { circonstances_declarees: "a" };
  const questions = J.questionsPour(state);
  const reps = F.filtrer(F.reponses({ cause_evoquee: F.choixVolontaire(0.9) }), questions);
  const sans = J.classerQuestions(questions, reps, undefined);
  assert.equal(sans.cause_evoquee.statut, "signal");
  assert.equal(sans.cause_evoquee.confiance, "non_disponible");
  assert.equal(sans.contradiction_interne.confiance, null, "pas de confiance pour un booléen");
  const illisible = J.classerQuestions(questions, reps, { typesafe: { confidence: "élevée" } });
  assert.equal(illisible.cause_evoquee.confiance, "non_disponible");
  const basse = J.classerQuestions(questions, reps, { typesafe: { confidence: 0.59 } });
  assert.equal(basse.cause_evoquee.statut, "incertain");
  assert.equal(basse.cause_evoquee.motif, "confiance_basse");
  const limite = J.classerQuestions(questions, reps, { typesafe: { confidence: 0.6 } });
  assert.equal(limite.cause_evoquee.statut, "signal");
  const parQuestion = J.classerQuestions(questions, reps, { typesafe: { confidence: { cause_evoquee: 0.2, pression_indemnisation: 0.9 } } });
  assert.equal(parQuestion.cause_evoquee.statut, "incertain");
  assert.equal(parQuestion.pression_indemnisation.confiance, 0.9);
});

test("réponses invalides : type, option, probabilité, distribution, question non demandée", () => {
  const state = { circonstances_declarees: "a" };
  const q = J.questionsPour(state);
  const ok = () => F.filtrer(F.reponses(), q);
  assert.doesNotThrow(() => J.verifierReponses(q, ok()));
  const cas = {
    "question manquante": (r) => { delete r.cause_evoquee; },
    "mauvais type": (r) => { r.contradiction_interne = { type: "score", score: 1, probabilities: { 0: 1, 1: 0 } }; },
    "probabilité hors bornes": (r) => { r.contradiction_interne.probability = 1.2; },
    "probabilité non finie": (r) => { r.contradiction_interne.probability = NaN; },
    "option inconnue": (r) => { r.cause_evoquee.choice = "autre"; },
    "distribution absente (choice)": (r) => { delete r.cause_evoquee.probabilities; },
    "distribution incomplète (score)": (r) => { delete r.pression_indemnisation.probabilities["2"]; },
    "réponse non demandée": (r) => { r.divergence_recit_rapport = F.boolean(0.9); },
  };
  for (const [nom, mod] of Object.entries(cas)) {
    const r = ok(); mod(r);
    assert.throws(() => J.verifierReponses(q, r), /./, nom);
  }
});

// ── OIDC ─────────────────────────────────────────────────────────────────
test("jeton OIDC : en-tête de la requête, sinon VERCEL_OIDC_TOKEN ; AI_GATEWAY_API_KEY jamais lue", () => {
  assert.equal(J.lireJetonOidc({ headers: { "x-vercel-oidc-token": " abc " } }, {}), "abc");
  assert.equal(J.lireJetonOidc({ headers: { "x-vercel-oidc-token": ["tab"] } }, {}), "tab");
  assert.equal(J.lireJetonOidc({ headers: {} }, { VERCEL_OIDC_TOKEN: "env" }), "env");
  assert.equal(J.lireJetonOidc({ headers: { "x-vercel-oidc-token": "entete" } }, { VERCEL_OIDC_TOKEN: "env" }), "entete");
  assert.equal(J.lireJetonOidc({ headers: {} }, { AI_GATEWAY_API_KEY: "CLE-API-SENTINELLE" }), null);
  assert.equal(J.lireJetonOidc(null, {}), null);
  assert.equal(require("fs").readFileSync(require("path").join(__dirname, "..", "lib", "jev.js"), "utf8").includes("process.env.AI_GATEWAY"), false);
});

// ── Appel avec le faux modèle (ai/test) ──────────────────────────────────
test("appel : options gateway transmises, maxRetries 0, délai borné, state réduit aux textes", async () => {
  const appels = [];
  const modele = await F.modeleFaux({ appels });
  const r = await J.evaluer({ ...TEXTES, montant_reclame: 4800 }, { deps: { modele, ...sansJournal } });
  assert.equal(r.ok, true);
  assert.equal(appels.length, 1);
  assert.deepEqual(appels[0].providerOptions, { gateway: { only: ["typesafe-ai"], disallowPromptTraining: true } });
  assert.equal("zeroDataRetention" in appels[0].providerOptions.gateway, false, "ZDR indisponible en Hobby");
  assert.deepEqual(appels[0].state, { circonstances_declarees: "Un récit fictif." });
  assert.ok(appels[0].abortSignal instanceof AbortSignal);
  assert.deepEqual(Object.keys(appels[0].questions), ["contradiction_interne", "cause_evoquee", "pression_indemnisation"]);
});

test("appel : résultat (signaux, incertains, latence, coût, fournisseur) et ligne d'audit sans contenu", async () => {
  const lignes = [];
  let t = 1000;
  const modele = await F.modeleFaux({ answers: F.reponses({ contradiction_interne: F.boolean(0.9), pression_indemnisation: F.scorePression(0.5) }) });
  const r = await J.evaluer({ circonstances: "SECRET-TEXTE-FICTIF", rapport_police: "" }, {
    jeton: JETON, deps: { modele, now: () => (t += 250), journal: (l) => lignes.push(l) },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.signaux, ["contradiction_interne"]);
  assert.deepEqual(r.incertains, ["pression_indemnisation"]);
  assert.equal(r.latence_ms, 250);
  assert.equal(r.cout_usd, 0.0000126);
  assert.equal(r.fournisseur, "typesafe-ai");
  assert.equal(r.generation_id, "gen_TEST");
  assert.equal(lignes.length, 1);
  assert.deepEqual(Object.keys(lignes[0]).sort(), ["cout_usd", "evt", "fournisseur", "generation_id", "latence_ms", "modele", "tokens_entree", "tokens_sortie"]);
  assert.equal(lignes[0].tokens_entree, 300);
  const texte = JSON.stringify(lignes) + JSON.stringify(r);
  assert.equal(texte.includes("SECRET-TEXTE-FICTIF"), false);
  assert.equal(texte.includes(JETON), false);
});

test("appel : aucun texte → rien n'est appelé ; pas de jeton ni de modèle → jev_non_configure", async () => {
  const fetchFaux = F.fauxFetch();
  assert.deepEqual(await J.evaluer({ circonstances: "", rapport_police: "" }, { jeton: JETON, deps: { fetch: fetchFaux } }), { ok: false, motif: "jev_aucun_texte" });
  assert.deepEqual(await J.evaluer(TEXTES, { deps: { fetch: fetchFaux } }), { ok: false, motif: "jev_non_configure" });
  assert.equal(fetchFaux.appels.length, 0);
});

test("appel : réponse invalide → repli jev_reponse_invalide", async () => {
  const modele = await F.modeleFaux({ answers: () => ({ contradiction_interne: { type: "boolean", probability: 0.1 } }) });
  const r = await J.evaluer(TEXTES, { deps: { modele, ...sansJournal } });
  assert.deepEqual({ ok: r.ok, motif: r.motif }, { ok: false, motif: "jev_reponse_invalide" });
});

// ── Vrai client Gateway, faux client HTTP : ce qui part réellement ────────
test("client Gateway : URL, jeton OIDC en Authorization, options gateway dans le corps ; la clé API de l'environnement est ignorée", async () => {
  const avant = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "CLE-API-SENTINELLE";
  try {
    const f = F.fauxFetch();
    const r = await J.evaluer({ circonstances: "Un récit.", rapport_police: "Un PV." }, { jeton: JETON, deps: { fetch: f, ...sansJournal } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(f.appels.length, 1);
    const a = f.appels[0];
    assert.equal(a.url, "https://ai-gateway.vercel.sh/v4/ai/evaluation-model");
    const auth = Object.entries(a.headers).find(([k]) => k.toLowerCase() === "authorization")[1];
    assert.equal(auth, `Bearer ${JETON}`);
    assert.equal(JSON.stringify(a.headers).includes("CLE-API-SENTINELLE"), false);
    assert.equal(a.headers["ai-gateway-auth-method"], "oidc", "le jeton est annoncé comme OIDC");
    assert.deepEqual(a.body.providerOptions.gateway, { only: ["typesafe-ai"], disallowPromptTraining: true });
    assert.deepEqual(a.body.state, { circonstances_declarees: "Un récit.", rapport_police: "Un PV." });
    assert.deepEqual(Object.keys(a.body.questions).length, 4);
    assert.equal(JSON.stringify(r).includes(JETON), false);
  } finally {
    if (avant === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = avant;
  }
});

test("erreurs → motif de repli, un seul essai (maxRetries 0), aucun détail brut ni jeton", async () => {
  const cas = [
    [{ statut: 402, corps: { error: { message: `Quota ${JETON}`, type: "quota_for_entity_exceeded" } } }, "jev_budget_atteint"],
    [{ statut: 403, corps: { error: { message: "customer_verification_required", type: "customer_verification_required" } } }, "jev_acces_refuse"],
    [{ statut: 401, corps: { error: { message: "unauthorized" } } }, "jev_acces_refuse"],
    [{ statut: 429, corps: { error: { message: "Rate limit exceeded", type: "rate_limit_exceeded" } } }, "jev_limite_debit"],
    [{ statut: 500, corps: { error: { message: "boom" } } }, "jev_erreur"],
    [{ erreur: new TypeError("fetch failed") }, "jev_reseau"],
    [{ corps: { n_importe: "quoi" } }, "jev_reponse_invalide"],
  ];
  for (const [options, motif] of cas) {
    const f = F.fauxFetch(options);
    const r = await J.evaluer(TEXTES, { jeton: JETON, deps: { fetch: f, ...sansJournal } });
    assert.deepEqual({ ok: r.ok, motif: r.motif }, { ok: false, motif }, JSON.stringify(options).slice(0, 60));
    assert.equal(f.appels.length, 1, "aucune relance");
    assert.equal(JSON.stringify(r).includes(JETON), false);
    assert.deepEqual(Object.keys(r).sort(), ["latence_ms", "motif", "ok"]);
  }
});

test("délai dépassé → jev_timeout (délai configurable)", async () => {
  const f = F.fauxFetch({ attendre: 500 });
  const r = await J.evaluer(TEXTES, { jeton: JETON, config: { ...CONFIG, timeout_ms: 30 }, deps: { fetch: f, ...sansJournal } });
  assert.deepEqual({ ok: r.ok, motif: r.motif }, { ok: false, motif: "jev_timeout" });
  assert.equal(CONFIG.timeout_ms, 10000, "10 s par défaut");
});

// ── Filet réseau : sans client factice, aucun appel réel ne peut partir ───
test("filet : sans client factice, le vrai client est bloqué par sans-reseau.js → repli jev_reseau", async () => {
  assert.throws(() => globalThis.fetch("https://ai-gateway.vercel.sh"), /Accès réseau interdit/, "le filet doit être actif avant tout essai");
  const r = await J.evaluer(TEXTES, { jeton: JETON, deps: sansJournal });
  assert.deepEqual({ ok: r.ok, motif: r.motif }, { ok: false, motif: "jev_reseau" });
});

test("config/jev.json : modèle, fournisseur épinglé, quotas, calcul daté de l'estimation", () => {
  assert.equal(CONFIG.modele, "typesafe-ai/jev");
  assert.deepEqual(CONFIG.fournisseurs, ["typesafe-ai"]);
  assert.equal(CONFIG.refus_entrainement, true);
  assert.deepEqual(CONFIG.quota_jour, { production: 30, preview: 6, development: 6 });
  assert.match(CONFIG._quota_jour, /02\/10\/2026/);
  assert.match(CONFIG._quota_jour, /ESTIMATION/);
  assert.match(CONFIG._quota_jour, /0,000126/);
  assert.equal(CONFIG.tarif_usd_par_million_entree, 0.042);
});
