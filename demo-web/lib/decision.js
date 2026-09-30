// Normalisation déterministe des sorties terminales de l'agent.
// Le modèle propose ; le serveur impose ce qui relève des règles métier :
// routage fraude, montant du recours, seuil, cohérence du statut final.
// Chaque écart corrigé est consigné pour la trace (transparence).
const REGLES = require("../config/regles.json");
const { calculerMontantRecours } = require("./tools.js");

function normaliserProposition(entree, contexte, config = REGLES) {
  const corrections = [];
  const recours = { ...entree.recours };
  const aRapport = Boolean(contexte.dossier.rapport_police && contexte.dossier.rapport_police.trim());

  if (recours.evalue && !aRapport) {
    corrections.push({ champ: "recours.evalue", motif: "aucun rapport de police : recours non évaluable" });
    recours.evalue = false;
  }
  let montant = null;
  if (recours.evalue) {
    montant = calculerMontantRecours(
      { part_responsabilite_tiers_pct: recours.part_responsabilite_tiers_pct }, contexte, null, config
    ).montant_recuperable;
    if (recours.viable && montant < config.recours.seuil_euros) {
      corrections.push({ champ: "recours.viable", motif: `montant récupérable ${montant} € sous le seuil de ${config.recours.seuil_euros} €` });
      recours.viable = false;
    }
  } else if (recours.viable) {
    corrections.push({ champ: "recours.viable", motif: "recours non évalué" });
    recours.viable = false;
  }

  return {
    proposition: {
      routage: contexte.routage,
      mode: contexte.mode,
      score_regles: contexte.regles.score,
      reason_codes: contexte.regles.reason_codes,
      synthese: entree.synthese,
      reason_codes_commentes: entree.reason_codes_commentes,
      recours: { ...recours, montant_recuperable: montant, seuil_euros: config.recours.seuil_euros },
      actions_proposees: entree.actions_proposees,
      points_d_attention: entree.points_d_attention,
    },
    corrections,
  };
}

const STATUT_PAR_ROUTAGE = Object.freeze({
  STP: "CLOS_STP",
  INVESTIGATION: "INSTRUCTION_A_POURSUIVRE",
  ALERTE_SIU: "TRANSMIS_SIU",
});

function statutsAutorises(decision, proposition) {
  if (decision.action === "rejeter") return ["REJETE_PAR_GESTIONNAIRE"];
  const autorises = [STATUT_PAR_ROUTAGE[proposition.routage]];
  if (proposition.recours.viable) autorises.unshift("RECOURS_A_ENGAGER");
  return autorises;
}

function normaliserFinalisation(entree, decision, proposition) {
  const corrections = [];
  const autorises = statutsAutorises(decision, proposition);
  let statut = entree.statut_final;
  if (!autorises.includes(statut)) {
    corrections.push({ champ: "statut_final", motif: `statut ${statut} incohérent avec la décision et le routage` });
    statut = autorises[0];
  }
  let brouillon = entree.brouillon_courrier_recours;
  if (brouillon && statut !== "RECOURS_A_ENGAGER") {
    corrections.push({ champ: "brouillon_courrier_recours", motif: "aucun recours à engager : brouillon retiré" });
    brouillon = "";
  }
  return {
    finalisation: {
      statut_final: statut,
      decision_gestionnaire: decision.action,
      synthese: entree.synthese,
      brouillon_courrier_recours: brouillon,
      plan_actions: entree.plan_actions,
      avertissement: "Brouillon — aucun envoi réel.",
    },
    corrections,
  };
}

module.exports = { normaliserProposition, normaliserFinalisation, statutsAutorises };
