// Boucle d'agent écrite à la main avec le SDK Anthropic (choix du plan v3).
//
// Deux niveaux :
// - executerTour(etat, deps) : UN seul appel au modèle, à partir d'un état
//   sérialisable (JSON). Permettra plus tard de passer à « une étape par
//   requête » avec trace en direct, sans changer la logique.
// - runLoop(etat, deps) : enchaîne les tours tant que l'état est « en_cours ».
//
// Garde-fous vérifiés AVANT chaque tour : nombre de tours, budget de temps,
// plafond de tokens de sortie puis d'entrée. Tout dépassement, refus, erreur
// du fournisseur ou arrêt inattendu donne l'état « repli » (le handler sert
// alors un rejeu signalé) : jamais d'erreur brute vers le visiteur.
//
// L'historique n'est jamais réécrit (ajouts seulement) et les blocs de
// réflexion sont renvoyés tels quels (guide de migration Sonnet 5.5,
// « Breaking change 3 »). La trace destinée au navigateur ne les contient pas.
const CONFIG_AGENT = require("../config/agent.json");
const { DEFINITIONS, OUTIL_TERMINAL, EXECUTABLES, ErreurOutil, validerEntreeTerminale } = require("./tools.js");
const P = require("./prompts.js");
const { normaliserProposition, normaliserFinalisation } = require("./decision.js");

const OUTILS_TERMINAUX = Object.values(OUTIL_TERMINAL);
const MARGE_ESTIMATION_TOKENS = 500;
const CARACTERES_PAR_TOKEN = 3; // approximation prudente (pas une mesure)

function creerEtat({ dossier, regles, routage, mode }, now) {
  const contenu = P.messageAnalyse({ dossier, regles, routage, mode });
  return {
    v: 1,
    phase: "analyse",
    statut: "en_cours",
    motif_repli: null,
    contexte: { dossier, regles, routage, mode },
    messages: [{ role: "user", content: [{ type: "text", text: contenu }] }],
    tours: { analyse: 0, finalisation: 0 },
    relances: { analyse: 0, finalisation: 0 },
    usage: { entree: 0, sortie: 0, cache_lecture: 0, cache_creation: 0 },
    dernier: { entree_requete: 0, sortie: 0, caracteres_ajoutes: contenu.length },
    en_attente: null,
    decision_humaine: null,
    proposition: null,
    finalisation: null,
    trace: { origine_ms: now(), tours: [], phases: [], corrections: [] },
  };
}

function paramsRequete(etat, maxTokens, config) {
  return {
    model: config.modele,
    max_tokens: maxTokens,
    system: [{ type: "text", text: P.SYSTEME, cache_control: { type: "ephemeral" } }],
    tools: DEFINITIONS,
    messages: etat.messages,
    thinking: { type: "adaptive" },
    output_config: { effort: config.effort },
    cache_control: { type: "ephemeral" },
  };
}

// Estimation des tokens d'entrée de la prochaine requête (approximation)
function estimerEntree(etat) {
  if (etat.dernier.entree_requete === 0) {
    const tout = JSON.stringify({ s: P.SYSTEME, t: DEFINITIONS, m: etat.messages });
    return Math.ceil(tout.length / CARACTERES_PAR_TOKEN);
  }
  return (
    etat.dernier.entree_requete + etat.dernier.sortie +
    Math.ceil(etat.dernier.caracteres_ajoutes / CARACTERES_PAR_TOKEN) + MARGE_ESTIMATION_TOKENS
  );
}

function replier(etat, motif, detail) {
  etat.statut = "repli";
  etat.motif_repli = motif;
  if (detail) etat.trace.corrections.push({ champ: "repli", motif: `${motif} : ${detail}` });
  return etat;
}

function executerOutil(bloc, etat) {
  const nom = bloc.name;
  if (EXECUTABLES[nom]) {
    try {
      return { sortie: EXECUTABLES[nom](bloc.input, etat.contexte) };
    } catch (e) {
      return { erreur: e instanceof ErreurOutil ? e.message : "Erreur interne de l'outil." };
    }
  }
  if (OUTILS_TERMINAUX.includes(nom)) return { erreur: "Outil non disponible à cette étape." };
  return { erreur: `Outil inconnu : ${nom}.` };
}

function resultat(bloc, r) {
  return r.erreur !== undefined
    ? { type: "tool_result", tool_use_id: bloc.id, content: r.erreur, is_error: true }
    : { type: "tool_result", tool_use_id: bloc.id, content: JSON.stringify(r.sortie) };
}

// ── Un tour ────────────────────────────────────────────────────────────────
async function executerTour(etatEntree, deps) {
  const etat = structuredClone(etatEntree);
  const config = deps.config || CONFIG_AGENT;
  const { now, client, deadline } = deps;
  const phase = etat.phase;
  if (etat.statut !== "en_cours") return etat;

  // Garde-fous, avant l'appel
  if (etat.tours[phase] >= config.tours_max[phase]) return replier(etat, "plafond_tours");
  const restant = deadline - now();
  const reserve = config.temps[phase].reserve_par_tour_ms;
  if (restant < reserve) return replier(etat, "budget_temps", `${restant} ms restantes, ${reserve} ms requises`);
  const plafond = config.plafond_tokens_analyse;
  const maxTokens = Math.min(config.max_tokens_par_tour, plafond.sortie - etat.usage.sortie);
  if (maxTokens < config.max_tokens_min_par_tour) return replier(etat, "plafond_tokens_sortie");
  if (etat.usage.entree + estimerEntree(etat) > plafond.entree) return replier(etat, "plafond_tokens_entree");

  // Appel au modèle : pas de relance automatique, délai borné par le budget
  const debut = now();
  let reponse;
  try {
    reponse = await client.messages.create(paramsRequete(etat, maxTokens, config), {
      timeout: Math.max(1, restant - config.temps.marge_timeout_ms),
      maxRetries: 0,
    });
  } catch (e) {
    const tour = { phase, numero: etat.tours[phase] + 1, debut_ms: debut - etat.trace.origine_ms, duree_ms: now() - debut,
      stop_reason: null, erreur: { type: e && e.constructor ? e.constructor.name : "Erreur", status: e && e.status } };
    etat.trace.tours.push(tour);
    return replier(etat, "erreur_fournisseur");
  }
  const fin = now();
  etat.tours[phase] += 1;

  const u = reponse.usage || {};
  const entreeRequete = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  etat.usage.entree += entreeRequete;
  etat.usage.sortie += u.output_tokens || 0;
  etat.usage.cache_lecture += u.cache_read_input_tokens || 0;
  etat.usage.cache_creation += u.cache_creation_input_tokens || 0;
  etat.dernier.entree_requete = entreeRequete;
  etat.dernier.sortie = u.output_tokens || 0;

  const tour = {
    phase, numero: etat.tours[phase], debut_ms: debut - etat.trace.origine_ms, fin_ms: fin - etat.trace.origine_ms,
    duree_ms: fin - debut, stop_reason: reponse.stop_reason,
    usage: { entree: u.input_tokens || 0, sortie: u.output_tokens || 0,
      cache_lecture: u.cache_read_input_tokens || 0, cache_creation: u.cache_creation_input_tokens || 0 },
    outils: [],
  };
  etat.trace.tours.push(tour);

  // Arrêts à ne pas exploiter : on lit stop_reason AVANT le contenu
  if (reponse.stop_reason === "refusal") return replier(etat, "refus");
  if (reponse.stop_reason === "max_tokens") return replier(etat, "max_tokens");
  if (!["tool_use", "end_turn", "stop_sequence"].includes(reponse.stop_reason)) {
    return replier(etat, "arret_inattendu", String(reponse.stop_reason));
  }

  const contenu = reponse.content || [];
  etat.messages.push({ role: "assistant", content: contenu }); // tel quel, réflexion comprise
  const appels = contenu.filter((b) => b.type === "tool_use");
  const terminalAttendu = OUTIL_TERMINAL[phase];

  if (appels.length === 0) {
    if (etat.relances[phase] >= 1) return replier(etat, "sans_decision");
    etat.relances[phase] += 1;
    const texte = P.messageRelance(terminalAttendu);
    etat.messages.push({ role: "user", content: [{ type: "text", text: texte }] });
    etat.dernier.caracteres_ajoutes = texte.length;
    return etat;
  }

  // Tous les appels du tour sont traités ; leurs résultats partent ensemble
  const resultats = [];
  let terminal = null;
  for (const bloc of appels) {
    const t0 = now();
    if (bloc.name === terminalAttendu && !terminal) {
      const erreurs = validerEntreeTerminale(bloc.name, bloc.input);
      if (erreurs.length === 0) {
        terminal = bloc;
        tour.outils.push({ nom: bloc.name, entree: bloc.input, sortie: "valide", duree_ms: now() - t0 });
        continue;
      }
      const r = { erreur: `Entrée invalide : ${erreurs.join(" ; ")}` };
      resultats.push(resultat(bloc, r));
      tour.outils.push({ nom: bloc.name, entree: bloc.input, erreur: r.erreur, duree_ms: now() - t0 });
      continue;
    }
    const r = bloc.name === terminalAttendu
      ? { erreur: "Un seul appel à cet outil par étape." }
      : executerOutil(bloc, etat);
    resultats.push(resultat(bloc, r));
    tour.outils.push({ nom: bloc.name, entree: bloc.input, ...(r.erreur !== undefined ? { erreur: r.erreur } : { sortie: r.sortie }), duree_ms: now() - t0 });
  }

  if (terminal && phase === "analyse") {
    const { proposition, corrections } = normaliserProposition(terminal.input, etat.contexte);
    etat.proposition = proposition;
    etat.trace.corrections.push(...corrections);
    etat.en_attente = { id_terminal: terminal.id, resultats_voisins: resultats };
    etat.statut = "pause"; // l'agent propose puis s'arrête : un humain décide
    return etat;
  }
  if (terminal && phase === "finalisation") {
    const { finalisation, corrections } = normaliserFinalisation(terminal.input, etat.decision_humaine, etat.proposition);
    etat.finalisation = finalisation;
    etat.trace.corrections.push(...corrections);
    etat.statut = "termine";
    return etat;
  }
  etat.messages.push({ role: "user", content: resultats });
  etat.dernier.caracteres_ajoutes = JSON.stringify(resultats).length;
  return etat;
}

// ── La boucle ──────────────────────────────────────────────────────────────
async function runLoop(etatEntree, deps) {
  const debut = deps.now();
  let etat = etatEntree;
  while (etat.statut === "en_cours") etat = await executerTour(etat, deps);
  if (etat === etatEntree) etat = structuredClone(etatEntree);
  const fin = deps.now();
  etat.trace.phases.push({ phase: etat.phase, debut_ms: debut - etat.trace.origine_ms, duree_ms: fin - debut, issue: etat.statut });
  return etat;
}

// Reprise après la décision du gestionnaire : la conversation est seulement
// étendue. Le tool_result de proposer_decision ne contient que le statut ;
// le motif saisi par l'humain va dans un bloc texte APRÈS les tool_result
// (guide Sonnet 5.5 : jamais de texte utilisateur dans un tool_result).
function reprendreApresDecision(etatEntree, decision) {
  if (etatEntree.statut !== "pause" || etatEntree.phase !== "analyse" || !etatEntree.en_attente) {
    throw new Error("état non repris : aucune proposition en attente");
  }
  const etat = structuredClone(etatEntree);
  const { id_terminal, resultats_voisins } = etat.en_attente;
  const texte = P.texteFinalisation(decision.action, decision.motif);
  const message = {
    role: "user",
    content: [
      ...resultats_voisins,
      { type: "tool_result", tool_use_id: id_terminal, content: P.resultatDecisionHumaine(decision.action) },
      { type: "text", text: texte },
    ],
  };
  etat.messages.push(message);
  etat.phase = "finalisation";
  etat.statut = "en_cours";
  etat.en_attente = null;
  etat.decision_humaine = { action: decision.action, motif: decision.motif || "" };
  etat.dernier.caracteres_ajoutes = JSON.stringify(message).length;
  return etat;
}

// Trace pour le navigateur : tours, stop_reason, outils, usage, durées.
// Construite champ par champ : aucun bloc de réflexion, aucun message brut.
function traceClient(etat) {
  return {
    tours: etat.trace.tours.map((t) => ({
      phase: t.phase, numero: t.numero, debut_ms: t.debut_ms, fin_ms: t.fin_ms, duree_ms: t.duree_ms,
      stop_reason: t.stop_reason, usage: t.usage, outils: t.outils,
      ...(t.erreur ? { erreur: { type: t.erreur.type, status: t.erreur.status } } : {}),
    })),
    phases: etat.trace.phases,
    corrections: etat.trace.corrections,
    usage_total: etat.usage,
    duree_totale_ms: etat.trace.phases.reduce((s, p) => s + p.duree_ms, 0),
  };
}

module.exports = { creerEtat, executerTour, runLoop, reprendreApresDecision, traceClient, estimerEntree, paramsRequete };
