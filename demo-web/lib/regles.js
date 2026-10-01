// Règles de scoring fraude : port JavaScript à l'identique de
// ml/scoring-model.py (compute_rule_score, l. 191-232), seule source de vérité.
// Code déterministe : aucun appel au modèle, aucun accès réseau.
const REGLES = require("../config/regles.json");
const PORTEFEUILLE = require("../data/portefeuille.json");

const MS_PAR_JOUR = 86400000;

// "AAAA-MM-JJ" → millisecondes UTC (évite les décalages de fuseau)
function dateUTC(iso) {
  const [a, m, j] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, j);
}

function joursEntre(dateFin, dateDebut) {
  return Math.round((dateUTC(dateFin) - dateUTC(dateDebut)) / MS_PAR_JOUR);
}

// Délai souscription → déclaration, borné à 0 comme clip(lower=0) en Python
function joursDepuisSouscription(dateDeclaration, dateSouscription) {
  return Math.max(0, joursEntre(dateDeclaration, dateSouscription));
}

// Moyenne et écart-type d'échantillon (ddof = 1, comme pandas) par type de sinistre
function statsParType(dossiers) {
  const groupes = {};
  for (const d of dossiers) (groupes[d.type] ||= []).push(d.montant_reclame);
  const stats = {};
  for (const [type, montants] of Object.entries(groupes)) {
    const n = montants.length;
    const moyenne = montants.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? montants.reduce((a, b) => a + (b - moyenne) ** 2, 0) / (n - 1) : NaN;
    stats[type] = { n, moyenne, ecartType: Math.sqrt(variance) };
  }
  return stats;
}

// Formatage à une décimale identique à Python f"{x:.1f}" : arrondi au plus
// proche sur la valeur binaire exacte, et au pair en cas d'égalité exacte
// (2.25 → "2.2" en Python, alors que (2.25).toFixed(1) donne "2.3").
// Une égalité exacte à une décimale n'existe en binaire que pour x = n + 0.25
// ou n + 0.75 : x * 4 est alors entier (calcul exact, puissance de 2). Hors de
// ce cas, toFixed arrondit déjà sur la valeur binaire exacte, comme Python.
function uneDecimale(x) {
  const egaliteExacte = Number.isInteger(x * 4) && !Number.isInteger(x * 2);
  if (egaliteExacte) {
    const bas = Math.floor(x * 10);
    return ((bas % 2 === 0 ? bas : bas + 1) / 10).toFixed(1);
  }
  return x.toFixed(1);
}

// Z-score du montant : écart-type nul remplacé par 1, écart-type indéfini → 0
// (équivalent de .replace(0, 1) puis .fillna(0) en Python)
function zscoreMontant(montant, type, stats) {
  const s = stats[type];
  if (!s || Number.isNaN(s.ecartType)) return 0;
  const ecart = s.ecartType === 0 ? 1 : s.ecartType;
  return (montant - s.moyenne) / ecart;
}

// Features de regroupement sur un portefeuille (fenêtres glissantes), port de
// compute_cluster_features. Sert à la parité avec Python sur la base fictive.
function featuresPortefeuille(sinistres, polices, config = REGLES) {
  const policeParId = Object.fromEntries(polices.map((p) => [p.id_police, p]));
  const stats = statsParType(sinistres);
  const compter = (s, champ, fenetre) =>
    sinistres.filter((autre) => {
      if (autre.id_sinistre === s.id_sinistre || autre[champ] !== s[champ]) return false;
      const ecart = joursEntre(s.date_declaration, autre.date_declaration);
      return ecart >= 0 && ecart <= fenetre;
    }).length;

  return sinistres.map((s) => ({
    id_sinistre: s.id_sinistre,
    type: s.type,
    montant_reclame: s.montant_reclame,
    id_reparateur: s.id_reparateur,
    adresse_ip: s.adresse_ip_declaration,
    reparateur_count_90d: compter(s, "id_reparateur", config.fenetres_jours.reparateur),
    ip_count_30d: compter(s, "adresse_ip_declaration", config.fenetres_jours.ip),
    jours_depuis_souscription: joursDepuisSouscription(
      s.date_declaration,
      policeParId[s.id_police].date_souscription
    ),
    montant_zscore: zscoreMontant(s.montant_reclame, s.type, stats),
  }));
}

// Score des règles (0-50) et reason codes aux gabarits exacts du script Python.
// `adresse_ip` est facultative : le formulaire web ne fournit qu'un compteur.
function scoreRegles(f, config = REGLES) {
  const r = config.regles;
  const fen = config.fenetres_jours;
  let score = 0;
  const reasonCodes = [];
  const detail = { ip: 0, reparateur: 0, precoce: 0, montant: 0 };

  if (f.ip_count_30d >= r.ip.seuil) {
    detail.ip = Math.min(r.ip.plafond, Math.trunc(f.ip_count_30d) * r.ip.points_par_occurrence);
    const suffixe = f.adresse_ip ? ` (${f.adresse_ip})` : "";
    reasonCodes.push(
      `Adresse IP partagée avec ${Math.trunc(f.ip_count_30d)} autre(s) dossier(s) sur ${fen.ip} jours${suffixe}`
    );
  }
  // Sans réparateur renseigné, la règle ne s'applique pas : le compteur n'a pas de sens
  // (en lot, Python donne alors un compteur de 0). Évite aussi un reason code « Réparateur null ».
  if (f.id_reparateur && f.reparateur_count_90d >= r.reparateur.seuil) {
    detail.reparateur = Math.min(
      r.reparateur.plafond,
      Math.trunc(f.reparateur_count_90d) * r.reparateur.points_par_occurrence
    );
    reasonCodes.push(
      `Réparateur ${f.id_reparateur} impliqué dans ${Math.trunc(f.reparateur_count_90d)} autre(s) dossier(s) sur ${fen.reparateur} jours`
    );
  }
  if (f.jours_depuis_souscription < r.precoce.jours_max_exclus) {
    detail.precoce = r.precoce.points;
    reasonCodes.push(
      `Sinistre déclaré ${Math.trunc(f.jours_depuis_souscription)} jours après la souscription de la police (< ${r.precoce.jours_max_exclus} jours)`
    );
  }
  if (f.montant_zscore > r.montant.zscore_min_exclus) {
    detail.montant = r.montant.points;
    reasonCodes.push(
      `Montant réclamé (${Math.trunc(f.montant_reclame)} €) supérieur de ${uneDecimale(f.montant_zscore)}σ à la moyenne du type '${f.type}'`
    );
  }
  score = detail.ip + detail.reparateur + detail.precoce + detail.montant;
  return { score: Math.min(score, config.plafond_score), reason_codes: reasonCodes, detail };
}

// Évaluation d'un dossier web : features calculées côté serveur à partir des
// dates et du montant saisis, statistiques de montant prises sur le portefeuille fictif.
function evaluerDossier(dossier, portefeuille = PORTEFEUILLE, config = REGLES) {
  const features = {
    type: dossier.type_sinistre,
    montant_reclame: dossier.montant_reclame,
    id_reparateur: dossier.id_reparateur,
    adresse_ip: null,
    reparateur_count_90d: dossier.reparateur_count_90d,
    ip_count_30d: dossier.ip_count_30d,
    jours_depuis_souscription: joursDepuisSouscription(dossier.date_declaration, dossier.date_souscription),
    montant_zscore: zscoreMontant(dossier.montant_reclame, dossier.type_sinistre, statsParType(portefeuille)),
  };
  return { features, ...scoreRegles(features, config) };
}

module.exports = {
  joursEntre,
  joursDepuisSouscription,
  uneDecimale,
  statsParType,
  zscoreMontant,
  featuresPortefeuille,
  scoreRegles,
  evaluerDossier,
};
