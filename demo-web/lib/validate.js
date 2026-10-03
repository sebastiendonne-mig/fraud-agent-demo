// Validation stricte des entrées du navigateur. Le client n'envoie que des
// données de dossier : tout champ inconnu (model, system, messages…) est refusé.
const TYPES_SINISTRE = Object.freeze([
  "degat_des_eaux", "bris_de_glace", "accident_auto", "incendie", "vol", "catastrophe_naturelle",
]);
const SCENARIOS = Object.freeze(["stp", "reseau", "precoce", "recours"]);
const RAPPORT_MAX = 4000;
const CIRCONSTANCES_MAX = 2000; // récit déclaré par l'assuré : un récit court suffit, et un state trop gros dégrade le triage
const MOTIF_MAX = 500;
const IDENTIFIANT = /^[A-Za-z0-9_-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function estObjetSimple(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function dateValide(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, j] = v.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return a >= 2000 && a <= 2100 && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

// Vérifie un champ selon sa règle ; renvoie un message d'erreur ou null
const CHAMPS_DOSSIER = {
  id_police: { requis: true, verifier: (v) => (typeof v === "string" && IDENTIFIANT.test(v) ? null : "identifiant invalide") },
  type_sinistre: { requis: true, verifier: (v) => (TYPES_SINISTRE.includes(v) ? null : "type de sinistre inconnu") },
  montant_reclame: { requis: true, verifier: nombreEntre(0, 500000) },
  montant_plafond: { requis: true, verifier: nombreEntre(0, 500000) },
  franchise: { requis: false, defaut: 0, verifier: nombreEntre(0, 5000) },
  date_declaration: { requis: true, verifier: (v) => (dateValide(v) ? null : "date invalide (AAAA-MM-JJ)") },
  date_souscription: { requis: true, verifier: (v) => (dateValide(v) ? null : "date invalide (AAAA-MM-JJ)") },
  id_reparateur: {
    requis: false, defaut: null,
    verifier: (v) => (v === null || v === "" || (typeof v === "string" && IDENTIFIANT.test(v)) ? null : "identifiant invalide"),
  },
  reparateur_count_90d: { requis: false, defaut: 0, verifier: entierEntre(0, 50) },
  ip_count_30d: { requis: false, defaut: 0, verifier: entierEntre(0, 50) },
  rapport_police: {
    requis: false, defaut: "",
    verifier: (v) => (typeof v === "string" && v.length <= RAPPORT_MAX ? null : `texte de ${RAPPORT_MAX} caractères maximum`),
  },
  circonstances: {
    requis: false, defaut: "",
    verifier: (v) => (typeof v === "string" && v.length <= CIRCONSTANCES_MAX ? null : `texte de ${CIRCONSTANCES_MAX} caractères maximum`),
  },
  scenario: { requis: false, defaut: null, verifier: (v) => (v === null || SCENARIOS.includes(v) ? null : "scénario inconnu") },
};

function nombreEntre(min, max) {
  return (v) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? null : `nombre entre ${min} et ${max}`);
}
function entierEntre(min, max) {
  return (v) => (Number.isInteger(v) && v >= min && v <= max ? null : `entier entre ${min} et ${max}`);
}

function valider(corps, champs) {
  if (!estObjetSimple(corps)) return { ok: false, erreurs: [{ champ: null, message: "objet JSON attendu" }] };
  const erreurs = [];
  for (const cle of Object.keys(corps)) {
    if (!Object.hasOwn(champs, cle)) erreurs.push({ champ: cle, message: "champ non autorisé" });
  }
  const valeur = {};
  for (const [cle, regle] of Object.entries(champs)) {
    if (!Object.hasOwn(corps, cle) || corps[cle] === undefined) {
      if (regle.requis) erreurs.push({ champ: cle, message: "champ obligatoire" });
      else valeur[cle] = regle.defaut;
      continue;
    }
    const message = regle.verifier(corps[cle]);
    if (message) erreurs.push({ champ: cle, message });
    else valeur[cle] = corps[cle];
  }
  return erreurs.length ? { ok: false, erreurs } : { ok: true, valeur };
}

function validerDossier(corps) {
  const r = valider(corps, CHAMPS_DOSSIER);
  if (r.ok && r.valeur.id_reparateur === "") r.valeur.id_reparateur = null;
  return r;
}

const CHAMPS_FINALISATION = {
  run_id: { requis: true, verifier: (v) => (typeof v === "string" && UUID.test(v) ? null : "identifiant de session invalide") },
  action: { requis: true, verifier: (v) => (v === "valider" || v === "rejeter" ? null : "action inconnue") },
  motif: {
    requis: false, defaut: "",
    verifier: (v) => (typeof v === "string" && v.length <= MOTIF_MAX ? null : `texte de ${MOTIF_MAX} caractères maximum`),
  },
};

function validerFinalisation(corps) {
  const r = valider(corps, CHAMPS_FINALISATION);
  if (r.ok && r.valeur.action === "rejeter" && !r.valeur.motif.trim()) {
    return { ok: false, erreurs: [{ champ: "motif", message: "motif obligatoire en cas de rejet" }] };
  }
  return r;
}

module.exports = { validerDossier, validerFinalisation, TYPES_SINISTRE, SCENARIOS, RAPPORT_MAX, CIRCONSTANCES_MAX, MOTIF_MAX };
