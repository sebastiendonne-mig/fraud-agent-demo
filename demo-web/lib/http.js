// Utilitaires HTTP des fonctions Vercel (runtime Node, sans framework).
const TAILLE_MAX_CORPS = 16 * 1024; // un dossier complet (rapport ≤ 4 000 caractères) tient largement
const CORPS_INVALIDE = Symbol("corps_invalide");
const CORPS_TROP_GROS = Symbol("corps_trop_gros");

// Le corps peut arriver déjà analysé (objet), en chaîne, en Buffer, ou pas du
// tout (flux à lire) : le comportement exact de Vercel sans framework sera
// confirmé en prévisualisation (jalon 1c), d'où la prise en charge des 4 cas.
async function lireCorps(req) {
  let brut = req.body;
  if (brut !== undefined && brut !== null && typeof brut === "object" && !Buffer.isBuffer(brut)) return brut;
  if (brut === undefined || brut === null) {
    if (typeof req[Symbol.asyncIterator] !== "function") return CORPS_INVALIDE;
    const morceaux = [];
    let taille = 0;
    for await (const m of req) {
      taille += m.length;
      if (taille > TAILLE_MAX_CORPS) return CORPS_TROP_GROS;
      morceaux.push(Buffer.from(m));
    }
    brut = Buffer.concat(morceaux);
  }
  const texte = Buffer.isBuffer(brut) ? brut.toString("utf8") : String(brut);
  if (Buffer.byteLength(texte) > TAILLE_MAX_CORPS) return CORPS_TROP_GROS;
  try {
    return JSON.parse(texte);
  } catch {
    return CORPS_INVALIDE;
  }
}

function repondre(res, statut, donnees) {
  res.statusCode = statut;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(donnees));
}

module.exports = { lireCorps, repondre, CORPS_INVALIDE, CORPS_TROP_GROS, TAILLE_MAX_CORPS };
