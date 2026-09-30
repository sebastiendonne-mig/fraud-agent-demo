// Rejeux : exécutions réelles enregistrées (jalon 1c), servies en repli
// signalé quand l'analyse en direct n'est pas possible (quota, stockage,
// erreur du fournisseur, refus, plafonds).
// Chemins littéraux dans require() : ils permettent à Vercel d'embarquer les
// fichiers dans la fonction. Un fichier absent donne null (avant le jalon 1c).
const CHARGEURS = Object.freeze({
  stp: () => require("../replays/stp.json"),
  reseau: () => require("../replays/reseau.json"),
  precoce: () => require("../replays/precoce.json"),
  recours: () => require("../replays/recours.json"),
});
const SCENARIO_PAR_DEFAUT = "recours";

function chargerRejeu(scenario, chargeurs = CHARGEURS) {
  const nom = Object.hasOwn(chargeurs, scenario) ? scenario : SCENARIO_PAR_DEFAUT;
  try {
    return { scenario: nom, contenu: chargeurs[nom]() };
  } catch (e) {
    if (e && e.code === "MODULE_NOT_FOUND") return null;
    throw e;
  }
}

module.exports = { chargerRejeu, SCENARIO_PAR_DEFAUT };
