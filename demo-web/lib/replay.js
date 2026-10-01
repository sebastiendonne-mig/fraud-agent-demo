// Rejeux : exécutions réelles enregistrées (jalon 1c), servies en repli
// signalé quand l'analyse en direct n'est pas possible (quota, stockage,
// erreur du fournisseur, refus, plafonds).
// Chemins littéraux dans require() : ils permettent à Vercel d'embarquer les
// fichiers dans la fonction (analyse statique des require). Les rejeux vivent dans
// public/replays/ : ils sont aussi servis au navigateur pour le repli côté client.
// Un fichier absent (ex. stp : aucun appel IA) donne null.
const CHARGEURS = Object.freeze({
  stp: () => require("../public/replays/stp.json"),
  reseau: () => require("../public/replays/reseau.json"),
  precoce: () => require("../public/replays/precoce.json"),
  recours: () => require("../public/replays/recours.json"),
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
