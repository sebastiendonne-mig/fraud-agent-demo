// Régénère data/portefeuille.json à partir de ../data-mock/sinistres_mock.json.
// Pourquoi une copie : Vercel ne déploie que demo-web/, donc data-mock/ n'est
// pas accessible aux fonctions. On ne garde que les champs utiles aux outils et
// aux statistiques : ni adresse IP, ni étiquette de fraude.
const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "..", "data-mock", "sinistres_mock.json");
const CIBLE = path.join(__dirname, "..", "data", "portefeuille.json");

function construirePortefeuille(sinistres) {
  return sinistres.map((s) => ({
    id_sinistre: s.id_sinistre,
    date_declaration: s.date_declaration,
    type: s.type,
    montant_reclame: s.montant_reclame,
    id_reparateur: s.id_reparateur,
  }));
}

if (require.main === module) {
  const sinistres = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  fs.writeFileSync(CIBLE, JSON.stringify(construirePortefeuille(sinistres), null, 2) + "\n");
  console.log(`portefeuille.json : ${sinistres.length} dossiers`);
}

module.exports = { construirePortefeuille, SOURCE, CIBLE };
