// Étape de triage : décide du routage fraude à partir du résultat des règles.
// Lot 1 : règles seules. Lot 2 : un triage probabiliste pourra être branché ici,
// avec la même interface (entrée : résultat des règles ; sortie : { routage, source }).
// Le routage est une règle métier : le modèle ne peut jamais le modifier.
const REGLES = require("../config/regles.json");

const ROUTAGES = Object.freeze(["STP", "INVESTIGATION", "ALERTE_SIU"]);

function trier(resultatRegles, config = REGLES) {
  const { investigation_a_partir_de: seuilInv, alerte_siu_a_partir_de: seuilSiu } = config.routage;
  const s = resultatRegles.score;
  const routage = s >= seuilSiu ? "ALERTE_SIU" : s >= seuilInv ? "INVESTIGATION" : "STP";
  return { routage, source: "regles" };
}

// L'agent ne tourne que s'il apporte quelque chose : dossier à instruire,
// ou rapport de police à examiner pour un recours. STP sans rapport → aucun appel IA.
function modeAgent(routage, rapportPolice) {
  const aRapport = typeof rapportPolice === "string" && rapportPolice.trim().length > 0;
  if (routage !== "STP") return "instruction";
  return aRapport ? "recours_seul" : null;
}

// ── Triage avec Jev (lot 2) ──────────────────────────────────────────────
// Jev ne peut que faire MONTER le routage, d'un niveau au maximum au-dessus de
// celui des règles (STP → INVESTIGATION → ALERTE_SIU), jamais descendre.
// Le routage final est calculé ici, par le code, à partir des réponses typées.
const aTexte = (t) => typeof t === "string" && t.trim().length > 0;

// Pure : un seul signal suffit pour monter d'un niveau ; ALERTE_SIU est le plafond.
function combinerRoutage(routageRegles, signaux) {
  const rang = ROUTAGES.indexOf(routageRegles);
  if (rang === -1) throw new Error(`routage inconnu : ${routageRegles}`);
  const plancher = Array.isArray(signaux) && signaux.length > 0 ? Math.min(rang + 1, ROUTAGES.length - 1) : rang;
  const final = Math.max(rang, plancher);
  return { routage: ROUTAGES[final], releve: final > rang };
}

// deps.jev     : { disponible(): boolean, evaluer(textes): Promise<résultat de lib/jev.js> }
// deps.quotaJev: async () => { autorise, utilisees, limite }   (compté avant l'appel)
// Sans texte, ou sans moyen d'appeler Jev, rien n'est appelé ni compté. Toute erreur
// (quota, stockage, fournisseur) rend le routage des règles seules, avec un motif.
async function trierAvecJev(resultatRegles, dossier, deps = {}, config = REGLES) {
  const base = trier(resultatRegles, config);
  const sortie = (extra = {}) => ({
    routage: base.routage, routage_regles: base.routage, source: base.source, jev: null, repli_jev: null, quota_jev: null, ...extra,
  });
  const textes = { circonstances: dossier && dossier.circonstances, rapport_police: dossier && dossier.rapport_police };
  if (!aTexte(textes.circonstances) && !aTexte(textes.rapport_police)) return sortie();
  if (!deps.jev || !deps.jev.disponible()) return sortie({ repli_jev: "jev_non_configure" });

  let quota;
  try {
    quota = await deps.quotaJev();
  } catch {
    return sortie({ repli_jev: "jev_stockage_indisponible" });
  }
  const quota_jev = { restantes: Math.max(0, quota.limite - quota.utilisees), limite: quota.limite };
  if (!quota.autorise) return sortie({ repli_jev: "jev_quota_atteint", quota_jev });

  let r;
  try {
    r = await deps.jev.evaluer(textes);
  } catch {
    return sortie({ repli_jev: "jev_erreur", quota_jev });
  }
  if (!r || !r.ok) return sortie({ repli_jev: (r && r.motif) || "jev_erreur", quota_jev });

  const { routage, releve } = combinerRoutage(base.routage, r.signaux);
  return {
    routage, routage_regles: base.routage, source: "regles+jev", repli_jev: null, quota_jev,
    jev: {
      modele: r.modele, reponses: r.reponses, statuts: r.statuts, signaux: r.signaux, incertains: r.incertains, releve,
      latence_ms: r.latence_ms, cout_usd: r.cout_usd, fournisseur: r.fournisseur, generation_id: r.generation_id,
      tokens_entree: r.tokens_entree, tokens_sortie: r.tokens_sortie,
    },
  };
}

module.exports = { ROUTAGES, trier, modeAgent, combinerRoutage, trierAvecJev };
