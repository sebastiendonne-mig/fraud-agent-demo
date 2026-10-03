// Faux Jev : réponses scriptées, aucune requête réseau.
// - modeleFaux : modèle d'évaluation `Experimental_EvaluationMockModelV4` (ai/test), pour tester lib/jev.js
// - fauxFetch : remplace le client HTTP de la Gateway (vérifie URL, en-têtes et corps réellement envoyés)
const REPONSES_NEUTRES = {
  contradiction_interne: { type: "boolean", probability: 0.02 },
  divergence_recit_rapport: { type: "boolean", probability: 0.03 },
  cause_evoquee: {
    type: "choice", choice: "accident_soudain",
    probabilities: { accident_soudain: 0.95, usure_ou_defaut: 0.03, acte_volontaire: 0.01, cause_non_precisee: 0.01 },
  },
  pression_indemnisation: { type: "score", score: 0.05, probabilities: { 0: 0.96, 1: 0.03, 2: 0.01 } },
};

// Réponses neutres, avec modifications ; les questions absentes de `questions` sont retirées par l'appelant.
function reponses(modifs = {}) {
  return structuredClone({ ...REPONSES_NEUTRES, ...modifs });
}

const boolean = (p) => ({ type: "boolean", probability: p });
const choixVolontaire = (p) => ({
  type: "choice", choice: p >= 0.5 ? "acte_volontaire" : "accident_soudain",
  probabilities: { accident_soudain: +(1 - p).toFixed(2), usure_ou_defaut: 0, acte_volontaire: p, cause_non_precisee: 0 },
});
const scorePression = (p) => ({
  type: "score", score: 2 * p, probabilities: { 0: +(1 - p).toFixed(2), 1: 0, 2: p },
});

// Ne garde que les réponses aux questions demandées (le vrai Jev ne répond qu'à celles-ci)
function filtrer(answers, questions) {
  return Object.fromEntries(Object.entries(answers).filter(([id]) => id in questions));
}

async function modeleFaux({ answers, metadata, usage, erreur, duree, appels = [] } = {}) {
  const { Experimental_EvaluationMockModelV4: Mock } = await import("ai/test");
  return new Mock({
    provider: "gateway",
    modelId: "typesafe-ai/jev",
    async doEvaluate(options) {
      appels.push(options);
      if (duree) await new Promise((r) => setTimeout(r, duree));
      if (erreur) throw erreur;
      return {
        answers: filtrer(typeof answers === "function" ? answers(options.questions) : answers || reponses(), options.questions),
        usage: usage || { inputTokens: 300, outputTokens: 20 },
        warnings: [],
        providerMetadata: metadata || {
          gateway: { cost: "0.0000126", routing: { finalProvider: "typesafe-ai" }, generationId: "gen_TEST" },
        },
      };
    },
  });
}

// Faux client HTTP pour createGateway({ fetch }) : enregistre chaque requête.
function fauxFetch({ answers, statut = 200, corps, erreur, attendre } = {}) {
  const appels = [];
  const f = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    appels.push({ url: String(url), headers: { ...(init.headers || {}) }, body });
    if (erreur) throw erreur;
    if (attendre) {
      await new Promise((resolve, reject) => {
        if (init.signal) init.signal.addEventListener("abort", () => reject(init.signal.reason));
        setTimeout(resolve, attendre);
      });
    }
    const questions = body ? body.questions : {};
    const contenu = corps || {
      model: "typesafe-ai/jev",
      answers: filtrer(answers || reponses(), questions),
      usage: { inputTokens: 300, outputTokens: 20 },
      providerMetadata: { gateway: { cost: "0.0000126", routing: { finalProvider: "typesafe-ai" }, generationId: "gen_TEST" } },
    };
    return new Response(JSON.stringify(contenu), { status: statut, headers: { "content-type": "application/json" } });
  };
  f.appels = appels;
  return f;
}

module.exports = { reponses, boolean, choixVolontaire, scorePression, modeleFaux, fauxFetch, filtrer };
