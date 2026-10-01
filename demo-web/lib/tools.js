// Outils de l'agent.
//
// RÈGLE DE SÉCURITÉ : AUCUN OUTIL N'A D'EFFET RÉEL.
// - pas d'envoi (ni courrier, ni e-mail, ni notification) ;
// - pas d'écriture en dehors du stockage de session, qui est géré par le
//   serveur et jamais par un outil ;
// - pas d'accès réseau, pas de système de fichiers.
// Chaque outil est une fonction pure sur des données locales (portefeuille
// fictif, configuration, dossier en cours). C'est ce qui borne le risque
// d'injection de consignes via le rapport de police ou le motif du
// gestionnaire : même manipulé, le modèle ne peut rien déclencher d'autre
// qu'un calcul ou une lecture. Un test vérifie ces propriétés
// (test/tools.test.js) : ne pas ajouter d'import réseau ici.
//
// Les 4 outils sont déclarés dès le premier appel et restent identiques à
// l'appel de finalisation : modifier la liste invaliderait les blocs de
// réflexion de Sonnet 5.5 (guide de migration Sonnet 5.5, « Breaking change 3 »).
const REGLES = require("../config/regles.json");
const PORTEFEUILLE = require("../data/portefeuille.json");

const CERTITUDES = ["Faible", "Moyen", "Élevé", "Sans objet"];
const STATUTS_FINAUX = [
  "CLOS_STP", "INSTRUCTION_A_POURSUIVRE", "TRANSMIS_SIU", "RECOURS_A_ENGAGER", "REJETE_PAR_GESTIONNAIRE",
];
const listeDeTextes = { type: "array", items: { type: "string" } };

const DEFINITIONS = [
  {
    name: "rechercher_historique_reparateur",
    description:
      "Liste les dossiers passés d'un réparateur dans le portefeuille fictif (date, type, montant). " +
      "Lecture seule, sans effet. À utiliser quand le réseau de réparateurs est un signal du dossier.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { id_reparateur: { type: "string", description: "Identifiant, ex. REP-007" } },
      required: ["id_reparateur"],
      additionalProperties: false,
    },
  },
  {
    name: "calculer_montant_recours",
    description:
      "Calcule le montant récupérable auprès du tiers : montant réclamé du dossier × part de responsabilité " +
      "du tiers, et le compare au seuil minimal de recours. Calcul pur, sans effet. " +
      "Ne calcule jamais ce montant toi-même.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        part_responsabilite_tiers_pct: { type: "integer", description: "Part du tiers, entre 0 et 100" },
      },
      required: ["part_responsabilite_tiers_pct"],
      additionalProperties: false,
    },
  },
  {
    name: "proposer_decision",
    description:
      "Termine l'analyse en proposant une décision au gestionnaire humain, puis s'arrête. " +
      "N'agit sur rien : un humain valide ou rejette ensuite. Le routage fraude n'en fait pas partie.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        synthese: { type: "string", description: "2 à 3 phrases pour le gestionnaire" },
        reason_codes_commentes: listeDeTextes,
        recours: {
          type: "object",
          properties: {
            evalue: { type: "boolean" },
            viable: { type: "boolean" },
            tiers_responsable: { type: "string", description: "Chaîne vide si non identifié" },
            assureur_adverse: { type: "string", description: "Chaîne vide si non mentionné" },
            part_responsabilite_tiers_pct: { type: "integer" },
            certitude: { type: "string", enum: CERTITUDES },
            elements_factuels: listeDeTextes,
          },
          required: [
            "evalue", "viable", "tiers_responsable", "assureur_adverse",
            "part_responsabilite_tiers_pct", "certitude", "elements_factuels",
          ],
          additionalProperties: false,
        },
        actions_proposees: listeDeTextes,
        points_d_attention: listeDeTextes,
      },
      required: ["synthese", "reason_codes_commentes", "recours", "actions_proposees", "points_d_attention"],
      additionalProperties: false,
    },
  },
  {
    name: "finaliser_dossier",
    description:
      "Termine le dossier après la décision du gestionnaire. Produit un brouillon : aucun envoi réel.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        statut_final: { type: "string", enum: STATUTS_FINAUX },
        synthese: { type: "string" },
        brouillon_courrier_recours: { type: "string", description: "Chaîne vide si aucun recours" },
        plan_actions: {
          type: "object",
          properties: { j5: { type: "string" }, j15: { type: "string" }, j30: { type: "string" } },
          required: ["j5", "j15", "j30"],
          additionalProperties: false,
        },
      },
      required: ["statut_final", "synthese", "brouillon_courrier_recours", "plan_actions"],
      additionalProperties: false,
    },
  },
];

const OUTIL_TERMINAL = Object.freeze({ analyse: "proposer_decision", finalisation: "finaliser_dossier" });

// ── Outils exécutables : fonctions pures sur des données locales ─────────────
function rechercherHistoriqueReparateur(entree, _contexte, portefeuille = PORTEFEUILLE) {
  const dossiers = portefeuille
    .filter((d) => d.id_reparateur === entree.id_reparateur)
    .sort((a, b) => (a.date_declaration < b.date_declaration ? 1 : -1))
    .map(({ id_sinistre, date_declaration, type, montant_reclame }) => ({
      id_sinistre, date_declaration, type, montant_reclame,
    }));
  return {
    id_reparateur: entree.id_reparateur,
    nombre_dossiers: dossiers.length,
    dossiers: dossiers.slice(0, 15),
    source: "portefeuille fictif de démonstration",
    periode: "2024 — portefeuille fictif historique, non aligné sur la date du dossier",
  };
}

function calculerMontantRecours(entree, contexte, _portefeuille, config = REGLES) {
  const pct = entree.part_responsabilite_tiers_pct;
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    throw new ErreurOutil("part_responsabilite_tiers_pct doit être un entier entre 0 et 100");
  }
  const montant = contexte.dossier.montant_reclame;
  const recuperable = Math.round((montant * pct) / 100);
  return {
    montant_reclame: montant,
    part_responsabilite_tiers_pct: pct,
    montant_recuperable: recuperable,
    seuil_recours_euros: config.recours.seuil_euros,
    au_dessus_du_seuil: recuperable >= config.recours.seuil_euros,
    franchise: "non traitée dans cette démo (montant brut)",
  };
}

const EXECUTABLES = Object.freeze({
  rechercher_historique_reparateur: rechercherHistoriqueReparateur,
  calculer_montant_recours: calculerMontantRecours,
});

class ErreurOutil extends Error {}

// ── Validation des entrées des outils terminaux (défense en profondeur) ─────
// `strict: true` garantit déjà le schéma ; on revérifie et on plafonne les longueurs.
const LONGUEUR_MAX = { defaut: 1500, brouillon_courrier_recours: 4000 };
const ELEMENTS_MAX = 8;

function verifier(valeur, schema, chemin, erreurs) {
  const cle = chemin.split(".").pop();
  switch (schema.type) {
    case "object": {
      if (valeur === null || typeof valeur !== "object" || Array.isArray(valeur)) {
        erreurs.push(`${chemin} : objet attendu`);
        return;
      }
      for (const k of Object.keys(valeur)) {
        if (!Object.hasOwn(schema.properties, k)) erreurs.push(`${chemin}.${k} : champ non autorisé`);
      }
      for (const k of schema.required) {
        if (!Object.hasOwn(valeur, k)) erreurs.push(`${chemin}.${k} : champ obligatoire`);
        else verifier(valeur[k], schema.properties[k], `${chemin}.${k}`, erreurs);
      }
      return;
    }
    case "array":
      if (!Array.isArray(valeur)) return void erreurs.push(`${chemin} : liste attendue`);
      if (valeur.length > ELEMENTS_MAX) erreurs.push(`${chemin} : ${ELEMENTS_MAX} éléments maximum`);
      valeur.forEach((v, i) => verifier(v, schema.items, `${chemin}[${i}]`, erreurs));
      return;
    case "string": {
      if (typeof valeur !== "string") return void erreurs.push(`${chemin} : texte attendu`);
      const max = LONGUEUR_MAX[cle] ?? LONGUEUR_MAX.defaut;
      if (valeur.length > max) erreurs.push(`${chemin} : ${max} caractères maximum`);
      if (schema.enum && !schema.enum.includes(valeur)) erreurs.push(`${chemin} : valeur non autorisée`);
      return;
    }
    case "integer":
      if (!Number.isInteger(valeur)) erreurs.push(`${chemin} : entier attendu`);
      return;
    case "boolean":
      if (typeof valeur !== "boolean") erreurs.push(`${chemin} : booléen attendu`);
      return;
    default:
      erreurs.push(`${chemin} : type non géré`);
  }
}

function validerEntreeTerminale(nom, entree) {
  const def = DEFINITIONS.find((d) => d.name === nom);
  const erreurs = [];
  verifier(entree, def.input_schema, nom, erreurs);
  if (nom === "proposer_decision" && erreurs.length === 0) {
    const pct = entree.recours.part_responsabilite_tiers_pct;
    if (pct < 0 || pct > 100) erreurs.push("recours.part_responsabilite_tiers_pct : entre 0 et 100");
  }
  return erreurs;
}

module.exports = {
  DEFINITIONS,
  OUTIL_TERMINAL,
  EXECUTABLES,
  CERTITUDES,
  STATUTS_FINAUX,
  ErreurOutil,
  validerEntreeTerminale,
  rechercherHistoriqueReparateur,
  calculerMontantRecours,
};
