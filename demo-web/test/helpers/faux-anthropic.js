// Horloge simulée et faux client Anthropic : réponses scriptées, aucune requête réseau.
function creerHorloge(depart = 1_000_000) {
  let t = depart;
  return { now: () => t, avancer: (ms) => { t += ms; } };
}

// Chaque étape du script : { reponse, duree_ms } ou { erreur, duree_ms }.
// Le client enregistre une copie des paramètres et des options de chaque appel.
function creerFauxClient(script, horloge) {
  const etapes = [...script];
  const appels = [];
  return {
    appels,
    restantes: () => etapes.length,
    messages: {
      async create(params, options) {
        appels.push({ params: structuredClone(params), options: structuredClone(options) });
        const etape = etapes.shift();
        if (!etape) throw new Error("script épuisé : appel au modèle non prévu");
        if (etape.duree_ms && horloge) horloge.avancer(etape.duree_ms);
        if (etape.erreur) throw etape.erreur;
        return structuredClone(etape.reponse);
      },
    },
  };
}

// Constructeurs de blocs et de réponses
let compteur = 0;
const reflexion = (signature = "sig-secrete") => ({ type: "thinking", thinking: "", signature });
const texte = (t) => ({ type: "text", text: t });
const appelOutil = (name, input, id = `toolu_${++compteur}`) => ({ type: "tool_use", id, name, input });

function reponse(content, { stop_reason, entree = 1000, sortie = 200, cacheLecture = 0, cacheCreation = 0 } = {}) {
  const aOutil = content.some((b) => b.type === "tool_use");
  return {
    id: `msg_${++compteur}`, type: "message", role: "assistant", model: "claude-sonnet-5-5",
    content,
    stop_reason: stop_reason || (aOutil ? "tool_use" : "end_turn"),
    stop_details: null,
    usage: { input_tokens: entree, output_tokens: sortie, cache_read_input_tokens: cacheLecture, cache_creation_input_tokens: cacheCreation },
  };
}

// Entrées valides des outils terminaux
function propositionValide(recours = {}) {
  return {
    synthese: "Tiers responsable identifié dans le rapport.",
    reason_codes_commentes: [],
    recours: {
      evalue: true, viable: true, tiers_responsable: "M. BENALI", assureur_adverse: "Mutuelle Fictive d'Assurance",
      part_responsabilite_tiers_pct: 100, certitude: "Élevé", elements_factuels: ["Feu rouge grillé par le tiers"],
      ...recours,
    },
    actions_proposees: ["Ouvrir le dossier de recours"],
    points_d_attention: [],
  };
}

function finalisationValide(statut_final = "RECOURS_A_ENGAGER", brouillon = "Madame, Monsieur, …") {
  return {
    statut_final,
    synthese: "Dossier finalisé.",
    brouillon_courrier_recours: brouillon,
    plan_actions: { j5: "Envoyer la mise en demeure", j15: "Relancer", j30: "Saisir la convention" },
  };
}

module.exports = {
  creerHorloge, creerFauxClient, reflexion, texte, appelOutil, reponse, propositionValide, finalisationValide,
};
