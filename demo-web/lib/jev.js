// Triage par Jev (TypeSafe) via Vercel AI Gateway : questions typées sur les seuls
// textes du dossier (circonstances et rapport de police).
//
// Principes :
// - Jev lit des textes ; il ne reçoit AUCUN montant, date ni compteur (jev-1.13 :
//   dates, comptage et nombres sont ses points faibles). Le code garde les chiffres.
// - Jev ne peut que faire MONTER le routage (voir triage.js) : ce module ne
//   décide de rien, il classe chaque réponse en « signal », « neutre » ou « incertain ».
// - Toute erreur donne un motif de repli ; jamais d'erreur brute, jamais de secret.
// - Authentification OIDC uniquement : AI_GATEWAY_API_KEY n'est ni exigée ni lue ici.
// - `ai` (v7) est ESM : import() dynamique depuis ce code CommonJS.
const CONFIG_JEV = require("../config/jev.json");

const SIGNAL = "signal";
const NEUTRE = "neutre";
const INCERTAIN = "incertain";

// ── Questions ────────────────────────────────────────────────────────────
// Formulées littéralement. Aucune sur des dates, des montants ou des comptages.
// `indicateur` dit comment lire la probabilité qui compte pour chaque question.
const QUESTIONS = Object.freeze({
  contradiction_interne: {
    type: "boolean",
    instructions: "Dans l'ensemble des textes fournis, y a-t-il au moins deux affirmations qui ne peuvent pas être vraies en même temps ? Réponds uniquement d'après ce qui est écrit dans les textes.",
    criteria: {
      true: "deux affirmations écrites dans les textes s'excluent mutuellement",
      false: "aucune affirmation écrite ne contredit une autre affirmation écrite",
    },
  },
  divergence_recit_rapport: {
    type: "boolean",
    instructions: "Le texte circonstances_declarees et le texte rapport_police décrivent-ils deux déroulements différents du même événement (cause, responsable ou témoin différents) ?",
    criteria: {
      true: "les deux textes donnent des faits incompatibles sur la cause, le responsable ou les témoins",
      false: "les deux textes décrivent le même déroulement, ou l'un ne contredit pas l'autre",
    },
  },
  cause_evoquee: {
    type: "choice",
    instructions: "D'après les textes fournis, quelle cause du dommage est décrite ?",
    criteria: {
      accident_soudain: "un événement soudain et involontaire est décrit comme cause",
      usure_ou_defaut: "une dégradation progressive ou un défaut d'entretien est décrit comme cause",
      acte_volontaire: "un acte volontaire de l'assuré ou d'une personne de son entourage est décrit comme cause",
      cause_non_precisee: "aucune cause n'est décrite",
    },
  },
  pression_indemnisation: {
    type: "score",
    instructions: "Les textes fournis demandent-ils un traitement accéléré de l'indemnisation ?",
    criteria: [
      "aucune demande de traitement accéléré",
      "un besoin de rapidité est mentionné sans être exigé",
      "un paiement immédiat est exigé ou une vérification est refusée",
    ],
  },
});

// Indicateur de suspicion : la probabilité surveillée pour chaque question.
const INDICATEUR = Object.freeze({
  contradiction_interne: (a) => a.probability,
  divergence_recit_rapport: (a) => a.probability,
  cause_evoquee: (a) => a.probabilities.acte_volontaire,
  pression_indemnisation: (a) => a.probabilities["2"], // jamais la valeur interpolée (jev-1.13)
});

const aTexte = (t) => typeof t === "string" && t.trim().length > 0;

// State : uniquement les textes, étiquetés, sans autre champ du dossier.
function construireState({ circonstances, rapport_police } = {}) {
  const state = {};
  if (aTexte(circonstances)) state.circonstances_declarees = circonstances.trim();
  if (aTexte(rapport_police)) state.rapport_police = rapport_police.trim();
  return Object.keys(state).length ? state : null;
}

// La comparaison récit/rapport n'a de sens que si les deux textes existent.
function questionsPour(state) {
  const q = { ...QUESTIONS };
  if (!(state.circonstances_declarees && state.rapport_police)) delete q.divergence_recit_rapport;
  return q;
}

// ── Authentification OIDC ────────────────────────────────────────────────
// En-tête de la requête (documenté pour les Vercel Functions), à défaut variable
// d'environnement. AI_GATEWAY_API_KEY n'est volontairement jamais lue.
function lireJetonOidc(req, env = process.env) {
  const brut = req && req.headers ? req.headers["x-vercel-oidc-token"] : null;
  const entete = Array.isArray(brut) ? brut[0] : brut;
  if (typeof entete === "string" && entete.trim()) return entete.trim();
  const v = env.VERCEL_OIDC_TOKEN;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ── Lecture et validation des réponses ───────────────────────────────────
const probaValide = (p) => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;

class ReponseInvalide extends Error {}

function verifierReponses(questions, answers) {
  if (answers === null || typeof answers !== "object") throw new ReponseInvalide("réponses absentes");
  for (const [id, q] of Object.entries(questions)) {
    const a = answers[id];
    if (!a || a.type !== q.type) throw new ReponseInvalide(`${id} : réponse absente ou de mauvais type`);
    if (q.type === "boolean" && !probaValide(a.probability)) throw new ReponseInvalide(`${id} : probabilité invalide`);
    if (q.type === "choice") {
      if (typeof a.choice !== "string" || !Object.hasOwn(q.criteria, a.choice)) throw new ReponseInvalide(`${id} : option inconnue`);
      const p = a.probabilities;
      if (!p || Object.keys(q.criteria).some((k) => !probaValide(p[k])) || Object.keys(p).some((k) => !Object.hasOwn(q.criteria, k))) {
        throw new ReponseInvalide(`${id} : distribution invalide`);
      }
    }
    if (q.type === "score") {
      const p = a.probabilities;
      if (!p || q.criteria.some((_, i) => !probaValide(p[String(i)])) || Object.keys(p).length !== q.criteria.length) {
        throw new ReponseInvalide(`${id} : distribution invalide`);
      }
    }
  }
  for (const id of Object.keys(answers)) if (!Object.hasOwn(questions, id)) throw new ReponseInvalide(`${id} : réponse non demandée`);
}

// Confiance TypeSafe : nombre global ou nombre par question ; toute autre forme est ignorée.
function confianceDe(metadonnees, id) {
  const c = metadonnees && metadonnees.typesafe ? metadonnees.typesafe.confidence : undefined;
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (c && typeof c === "object" && typeof c[id] === "number" && Number.isFinite(c[id])) return c[id];
  return null;
}

// Classe chaque question. Pure : aucun accès réseau, aucune décision de routage.
function classerQuestions(questions, answers, metadonnees, config = CONFIG_JEV) {
  const { monte_a_partir_de: haut, neutre_jusqu_a: bas, confiance_min: confMin } = config.seuils;
  const resultat = {};
  for (const [id, q] of Object.entries(questions)) {
    const p = INDICATEUR[id](answers[id]);
    let statut = p >= haut ? SIGNAL : p <= bas ? NEUTRE : INCERTAIN;
    let confiance = null;
    let motif = null;
    if (q.type !== "boolean") {
      confiance = confianceDe(metadonnees, id);
      if (confiance === null) {
        confiance = "non_disponible";
      } else if (confiance < confMin) {
        statut = INCERTAIN;
        motif = "confiance_basse";
      }
    }
    resultat[id] = { type: q.type, p, statut, confiance, ...(motif ? { motif } : {}) };
  }
  return resultat;
}

// ── Erreurs → motif de repli (jamais de message brut) ────────────────────
function statutHttp(e) {
  for (let x = e, i = 0; x && i < 4; x = x.cause, i++) {
    if (Number.isInteger(x.statusCode)) return x.statusCode;
    if (Number.isInteger(x.status)) return x.status;
  }
  return null;
}

// Le client Gateway enveloppe une coupure réseau dans une erreur « 500 » sans réponse HTTP
// derrière : sans erreur d'appel d'API (AI_APICallError) dans la chaîne, c'est le réseau.
function aReponseHttp(e) {
  for (let x = e, i = 0; x && i < 4; x = x.cause, i++) if (x.name === "AI_APICallError") return true;
  return false;
}

// Une réponse HTTP 200 dont le corps ne respecte pas le schéma arrive enveloppée (erreur de validation de type).
function aNom(e, noms) {
  for (let x = e, i = 0; x && i < 5; x = x.cause, i++) if (noms.includes(x.name)) return true;
  return false;
}

function classerErreur(e, { expire = false } = {}) {
  if (expire) return "jev_timeout";
  if (e instanceof ReponseInvalide || aNom(e, ["AI_InvalidResponseDataError", "AI_TypeValidationError", "AI_JSONParseError"])) return "jev_reponse_invalide";
  const texte = `${e && e.message ? e.message : ""} ${e && e.type ? e.type : ""}`;
  const code = statutHttp(e);
  // Une erreur de budget peut remonter sous un autre statut côté SDK (doc budgets) : on reconnaît aussi son type.
  if (code === 402 || /quota_for_entity_exceeded/.test(texte)) return "jev_budget_atteint";
  if (code === 401 || code === 403) return "jev_acces_refuse";
  if (code === 429) return "jev_limite_debit";
  if (code !== null && code >= 400) return aReponseHttp(e) ? "jev_erreur" : "jev_reseau";
  if (e && (e.name === "TimeoutError" || e.name === "AbortError")) return "jev_timeout";
  return "jev_reseau";
}

// ── Appel ────────────────────────────────────────────────────────────────
// deps (tests) : modele (modèle d'évaluation déjà construit), fetch (client HTTP du
// fournisseur), now, journal. En production, aucune n'est fournie.
function lireCoutEtRoute(metadonnees) {
  const g = metadonnees && metadonnees.gateway ? metadonnees.gateway : {};
  const cout = Number(g.cost);
  const route = g.routing || {};
  return {
    cout_usd: Number.isFinite(cout) ? cout : null,
    fournisseur: typeof route.finalProvider === "string" ? route.finalProvider : null,
    generation_id: typeof g.generationId === "string" ? g.generationId : null,
  };
}

async function evaluer(textes, { jeton, config = CONFIG_JEV, deps = {} } = {}) {
  const now = deps.now || Date.now;
  const journal = deps.journal || ((ligne) => console.log(JSON.stringify(ligne)));
  const state = construireState(textes);
  if (!state) return { ok: false, motif: "jev_aucun_texte" };
  const questions = questionsPour(state);
  if (!deps.modele && !jeton) return { ok: false, motif: "jev_non_configure" };

  const debut = now();
  const signal = AbortSignal.timeout(config.timeout_ms);
  try {
    const ai = deps.ai || (await import("ai"));
    const modele = deps.modele || ai.createGateway({
      apiKey: jeton, // le jeton OIDC, transmis explicitement (jamais AI_GATEWAY_API_KEY)
      headers: { "ai-gateway-auth-method": "oidc" }, // sans cela, le SDK annoncerait « api-key » pour ce jeton
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    }).evaluationModel(config.modele);
    const r = await ai.experimental_evaluate({
      model: modele,
      state,
      questions,
      maxRetries: 0,
      abortSignal: signal,
      providerOptions: { gateway: { only: [...config.fournisseurs], disallowPromptTraining: config.refus_entrainement } },
    });
    verifierReponses(questions, r.answers);
    const statuts = classerQuestions(questions, r.answers, r.providerMetadata, config);
    const latence_ms = now() - debut;
    const { cout_usd, fournisseur, generation_id } = lireCoutEtRoute(r.providerMetadata);
    const tokens_entree = r.usage && Number.isFinite(r.usage.inputTokens) ? r.usage.inputTokens : null;
    const tokens_sortie = r.usage && Number.isFinite(r.usage.outputTokens) ? r.usage.outputTokens : null;
    // Ligne d'audit : jamais de contenu (ni textes, ni réponses, ni jeton).
    journal({ evt: "jev_appel", modele: config.modele, fournisseur, generation_id, tokens_entree, tokens_sortie, cout_usd, latence_ms });
    return {
      ok: true,
      modele: config.modele,
      reponses: r.answers,
      statuts,
      signaux: Object.keys(statuts).filter((id) => statuts[id].statut === SIGNAL),
      incertains: Object.keys(statuts).filter((id) => statuts[id].statut === INCERTAIN),
      latence_ms, cout_usd, fournisseur, generation_id, tokens_entree, tokens_sortie,
    };
  } catch (e) {
    return { ok: false, motif: classerErreur(e, { expire: signal.aborted }), latence_ms: now() - debut };
  }
}

module.exports = {
  QUESTIONS, INDICATEUR, SIGNAL, NEUTRE, INCERTAIN,
  construireState, questionsPour, lireJetonOidc, verifierReponses, classerQuestions, classerErreur, evaluer,
};
