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

module.exports = { ROUTAGES, trier, modeAgent };
