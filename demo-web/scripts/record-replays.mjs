// Enregistrement des rejeux (jalon 1c) : exécutions RÉELLES et PAYANTES.
//
// - Vrais handlers (lib/handlers.js), vrai client Anthropic construit comme en
//   production, mais stockage EN MÉMOIRE (jamais Upstash) et quota neutralisé.
// - Pour réseau, précoce et recours : appel 1, puis Valider et Rejeter, rejoués
//   depuis une copie du même état (un run_id est à usage unique) : 9 exécutions.
// - Écrit public/replays/<scenario>.json (date, propositions, finalisations, trace
//   client : jamais de blocs de réflexion ni de messages bruts) et les mesures
//   HORS du dépôt.
//
// Jev n'est PAS utilisé : les rejeux sont des exécutions de l'agent sur le routage des
// règles. Les dépendances passées aux handlers contiennent `jev: null` (voir
// construireDeps) : aucun appel à Jev, aucun jeton OIDC nécessaire, aucun quota Jev.
//
// Sécurité : refuse de démarrer sans --yes et sans ANTHROPIC_API_KEY dans
// l'environnement. Ne lit aucun fichier .env. N'affiche jamais la clé.
//
// Usage : node scripts/record-replays.mjs [--fumee] [--yes] [--mesures <fichier>] [--replays <dossier>]
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const H = require("../lib/handlers.js");
const { creerStore } = require("../lib/store.js");
const { PROMPT_VERSION } = require("../lib/prompts.js");
const CONFIG = require("../config/agent.json");
const { scenarios } = require("../public/scenarios.js");
const { creerFauxRedis } = require("../test/helpers/faux-redis.js");

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER_REPLAYS = path.join(ICI, "..", "public", "replays");
const FICHIER_MESURES = path.join(os.homedir(), "Documents", "dev", "tkoidra", "_captures", "fraud-1c", "mesures.json");
const SCENARIOS_AGENT = ["reseau", "precoce", "recours"];
const SCENARIO_FUMEE = "recours";
const MOTIF_REJET = "Motif fictif d'enregistrement : pièces justificatives insuffisantes.";
const INTERDITS = ['"thinking"', '"signature"', '"messages"'];

// Marques réelles d'assureurs et de mutuelles françaises à signaler dans les rejeux
export const MARQUES_REELLES = [
  "AXA", "Allianz", "MAIF", "MACIF", "MAAF", "Groupama", "Generali", "MMA", "Matmut", "GMF", "Covéa",
  "Crédit Agricole Assurances", "CNP", "Aviva", "Swiss Life", "Pacifica", "Direct Assurance",
];
const PLAQUE_SIV = /(?<![A-Z0-9-])[A-Z]{2}-\d{3}-[A-Z]{2}(?![A-Z0-9-])/gi;

// ── Calculs ─────────────────────────────────────────────────────────────────
export function cout(usage, tarif = CONFIG.tarif_usd_par_million) {
  return (
    (usage.entree * tarif.entree + usage.cache_ecriture * tarif.cache_ecriture_5min +
      usage.cache_lecture * tarif.cache_lecture + usage.sortie * tarif.sortie) / 1e6
  );
}

// Borne haute d'un couple analyse + finalisation : plafonds de tokens, entrée au prix le plus cher
export function borneParCouple(config = CONFIG) {
  const t = config.tarif_usd_par_million;
  const p = config.plafond_tokens_analyse;
  return (p.entree * Math.max(t.entree, t.cache_ecriture_5min) + p.sortie * t.sortie) / 1e6;
}

export function detecterMentionsReelles(texte) {
  const trouvees = [];
  for (const marque of MARQUES_REELLES) {
    const motif = new RegExp(`(?<![\\p{L}\\p{N}])${marque.replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu");
    const n = (texte.match(motif) || []).length;
    if (n) trouvees.push({ type: "marque", valeur: marque, occurrences: n });
  }
  for (const m of new Set((texte.match(PLAQUE_SIV) || []).map((p) => p.toUpperCase()))) {
    trouvees.push({ type: "plaque_siv", valeur: m, occurrences: (texte.match(new RegExp(m, "gi")) || []).length });
  }
  return trouvees;
}

// Somme des tours d'une phase (tokens d'entrée hors cache, sortie, cache)
function usagePhase(trace, phase) {
  const tours = ((trace && trace.tours) || []).filter((t) => t.phase === phase);
  const u = { entree: 0, sortie: 0, cache_lecture: 0, cache_ecriture: 0 };
  for (const t of tours) {
    u.entree += t.usage?.entree || 0;
    u.sortie += t.usage?.sortie || 0;
    u.cache_lecture += t.usage?.cache_lecture || 0;
    u.cache_ecriture += t.usage?.cache_creation || 0;
  }
  return { usage: u, durees_tours_ms: tours.map((t) => t.duree_ms), nombre_tours: tours.length };
}

function dateFr(ms) {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ms));
}

// ── Appel d'un handler en mémoire ───────────────────────────────────────────
async function appeler(handler, corps) {
  const res = {
    statusCode: 0, corps: "",
    setHeader() {},
    end(texte) { this.corps = texte; },
  };
  await handler({ method: "POST", body: corps }, res);
  let donnees = null;
  try { donnees = JSON.parse(res.corps); } catch { donnees = null; }
  return { statut: res.statusCode, donnees };
}

// Copie champ par champ : seuls les champs destinés au navigateur sont gardés
function propre(objet) {
  return objet === undefined ? undefined : JSON.parse(JSON.stringify(objet));
}
function construireRejeu(date, analyse, finalisations) {
  return {
    enregistre_le: date,
    analyse: { proposition: propre(analyse.proposition), trace: propre(analyse.trace) },
    finalisation: {
      valider: { finalisation: propre(finalisations.valider.finalisation), trace: propre(finalisations.valider.trace) },
      rejeter: { finalisation: propre(finalisations.rejeter.finalisation), trace: propre(finalisations.rejeter.trace) },
    },
  };
}

// Dépendances des handlers. `jev: null` est écrit explicitement : le triage par Jev est
// désactivé pour l'enregistrement (repli « jev_non_configure », sans réseau ni quota).
export function construireDeps({ client, redis, config, now, uuid }) {
  return {
    now,
    uuid,
    store: () => creerStore({ redis, env: "development", config }),
    client: () => client,
    jev: null,
  };
}

// ── Exécution (testable avec un faux client) ────────────────────────────────
export async function executer({
  client, fumee = false, dossierReplays = DOSSIER_REPLAYS, fichierMesures = FICHIER_MESURES,
  now = () => Date.now(), lesScenarios = scenarios(), journal = console.log,
}) {
  const redis = creerFauxRedis();
  const config = { ...CONFIG, quota_jour: 1_000_000 }; // quota neutralisé pour l'enregistrement
  let n = 0;
  const deps = construireDeps({ client, redis, config, now, uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  const analyse = H.creerHandlerAnalyse(deps);
  const finalise = H.creerHandlerFinalisation(deps);
  const liste = fumee ? [SCENARIO_FUMEE] : SCENARIOS_AGENT;
  const actions = fumee ? ["valider"] : ["valider", "rejeter"];

  const mesures = { enregistre_le: new Date(now()).toISOString(), modele: CONFIG.modele, prompt_version: PROMPT_VERSION,
    jev: "non utilisé", effort: CONFIG.effort, tarif_usd_par_million: CONFIG.tarif_usd_par_million, fumee, executions: [], echecs: [], fichiers_ecrits: [], mentions_reelles: [] };

  const mesurer = (scenario, appel, reponse, phase, debut, fin) => {
    const { usage, durees_tours_ms, nombre_tours } = usagePhase(reponse.trace, phase);
    const phaseTrace = ((reponse.trace && reponse.trace.phases) || []).filter((p) => p.phase === phase).at(-1);
    const e = { scenario, appel, nombre_tours, usage, cout_usd: Number(cout(usage).toFixed(6)),
      durees_tours_ms, duree_handler_ms: phaseTrace ? phaseTrace.duree_ms : null, duree_bout_en_bout_ms: fin - debut };
    mesures.executions.push(e);
    journal(`  ${scenario} · ${appel} : ${nombre_tours} tour(s), ${(e.duree_bout_en_bout_ms / 1000).toFixed(1)} s, ` +
      `${usage.entree + usage.cache_lecture + usage.cache_ecriture} tokens en entrée / ${usage.sortie} en sortie, ${e.cout_usd.toFixed(4)} $`);
  };
  const echec = (scenario, appel, r) => {
    const motif = (r.donnees && (r.donnees.motif || r.donnees.erreur)) || `statut ${r.statut}`;
    mesures.echecs.push({ scenario, appel, mode: r.donnees && r.donnees.mode, motif });
    journal(`  ${scenario} · ${appel} : ÉCHEC (${motif}) — rejeu non écrit pour ce scénario`);
  };

  for (const scenario of liste) {
    const dossier = { ...lesScenarios[scenario], scenario };
    let debut = now();
    const r1 = await appeler(analyse, dossier);
    if (r1.statut !== 200 || !r1.donnees || r1.donnees.mode !== "direct") { echec(scenario, "analyse", r1); continue; }
    mesurer(scenario, "analyse", r1.donnees, "analyse", debut, now());

    // Copie de l'état sauvegardé : chaque issue repart du même état
    const cle = `development:run:${r1.donnees.run_id}`;
    const etat = await redis.get(cle);
    const finalisations = {};
    for (const action of actions) {
      await redis.set(cle, etat, { ex: CONFIG.ttl_run_s });
      debut = now();
      const r2 = await appeler(finalise, { run_id: r1.donnees.run_id, action, motif: action === "rejeter" ? MOTIF_REJET : "" });
      if (r2.statut !== 200 || !r2.donnees || r2.donnees.mode !== "direct") { echec(scenario, action, r2); break; }
      mesurer(scenario, action, r2.donnees, "finalisation", debut, now());
      finalisations[action] = r2.donnees;
    }

    if (fumee || !finalisations.valider || !finalisations.rejeter) continue;
    const rejeu = construireRejeu(dateFr(now()), r1.donnees, finalisations);
    const texte = JSON.stringify(rejeu, null, 2);
    const interdit = INTERDITS.find((m) => texte.includes(m));
    if (interdit) {
      mesures.echecs.push({ scenario, appel: "ecriture", motif: `contenu interdit détecté (${interdit})` });
      journal(`  ${scenario} : contenu interdit (${interdit}) — rejeu NON écrit`);
      continue;
    }
    fs.mkdirSync(dossierReplays, { recursive: true });
    const fichier = path.join(dossierReplays, `${scenario}.json`);
    fs.writeFileSync(fichier, texte + "\n");
    mesures.fichiers_ecrits.push(fichier);
  }

  // Recherche de marques réelles et de plaques au format SIV dans les rejeux écrits (sans bloquer)
  for (const fichier of mesures.fichiers_ecrits) {
    for (const m of detecterMentionsReelles(fs.readFileSync(fichier, "utf8"))) {
      mesures.mentions_reelles.push({ fichier: path.basename(fichier), ...m });
    }
  }

  // Synthèse : coût moyen d'une analyse (appel 1 + moyenne des issues) et durée moyenne de l'appel 1
  const parScenario = {};
  for (const e of mesures.executions) (parScenario[e.scenario] ||= []).push(e);
  const analyses = [];
  for (const execs of Object.values(parScenario)) {
    const a = execs.find((e) => e.appel === "analyse");
    const issues = execs.filter((e) => e.appel !== "analyse");
    if (a && issues.length) analyses.push({ cout: a.cout_usd + issues.reduce((s, e) => s + e.cout_usd, 0) / issues.length, duree: a.duree_bout_en_bout_ms });
  }
  const moyenne = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const coutMoyen = moyenne(analyses.map((a) => a.cout));
  mesures.synthese = {
    analyses_completes: analyses.length,
    cout_total_usd: Number(mesures.executions.reduce((s, e) => s + e.cout_usd, 0).toFixed(6)),
    cout_moyen_par_analyse_usd: coutMoyen === null ? null : Number(coutMoyen.toFixed(6)),
    duree_moyenne_appel1_ms: moyenne(analyses.map((a) => a.duree)),
    duree_max_appel1_ms: analyses.length ? Math.max(...analyses.map((a) => a.duree)) : null,
    quota_indicatif_pour_18_usd_par_mois: coutMoyen ? Math.floor(18 / (30 * coutMoyen)) : null,
  };

  fs.mkdirSync(path.dirname(fichierMesures), { recursive: true });
  fs.writeFileSync(fichierMesures, JSON.stringify(mesures, null, 2) + "\n");
  return mesures;
}

// ── Ligne de commande ───────────────────────────────────────────────────────
function lireArguments(argv) {
  const a = { yes: false, fumee: false, mesures: null, replays: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--yes") a.yes = true;
    else if (argv[i] === "--fumee") a.fumee = true;
    else if (argv[i] === "--mesures") a.mesures = argv[++i];
    else if (argv[i] === "--replays") a.replays = argv[++i];
    else throw new Error(`Argument inconnu : ${argv[i]}`);
  }
  return a;
}

export function planExecution(fumee, fichierMesures = FICHIER_MESURES, dossierReplays = DOSSIER_REPLAYS) {
  const couples = fumee ? 1 : SCENARIOS_AGENT.length * 2;
  const borne = borneParCouple() * couples;
  return [
    "Enregistrement des rejeux — exécutions RÉELLES et PAYANTES (Claude API)",
    `  Modèle : ${CONFIG.modele} · effort ${CONFIG.effort} · max_tokens ${CONFIG.max_tokens_par_tour} par tour`,
    fumee
      ? `  Mode fumée : scénario « ${SCENARIO_FUMEE} », appel 1 + Valider (2 exécutions). Aucun rejeu écrit.`
      : `  Scénarios : ${SCENARIOS_AGENT.join(", ")} — appel 1 + Valider + Rejeter chacun (9 exécutions).`,
    `  Stockage : en mémoire (aucun accès à Upstash).`,
    `  Jev : non utilisé (les rejeux sont des exécutions de l'agent sur le routage des règles).`,
    `  Borne haute de coût : ${borne.toFixed(2)} $ (${couples} × ${borneParCouple().toFixed(2)} $, plafonds de tokens au prix le plus élevé).`,
    fumee ? "" : `  Rejeux écrits dans : ${dossierReplays}`,
    `  Mesures écrites dans : ${fumee ? fichierMesures.replace(/mesures\.json$/, "mesures-fumee.json") : fichierMesures}`,
  ].filter(Boolean).join("\n");
}

async function main() {
  let args;
  try {
    args = lireArguments(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  let fichierMesures = args.mesures ? path.resolve(args.mesures) : FICHIER_MESURES;
  if (args.fumee && !args.mesures) fichierMesures = fichierMesures.replace(/mesures\.json$/, "mesures-fumee.json");
  const dossierReplays = args.replays ? path.resolve(args.replays) : DOSSIER_REPLAYS;

  console.log(planExecution(args.fumee, fichierMesures, dossierReplays));
  if (!args.yes) {
    console.log("\nArrêt : ajoutez --yes pour confirmer ces appels payants.");
    process.exitCode = 2;
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("\nArrêt : ANTHROPIC_API_KEY absente de l'environnement (aucun fichier .env n'est lu).");
    process.exitCode = 2;
    return;
  }

  // Client construit exactement comme en production (maxRetries: 0) ; la clé n'est jamais affichée
  const client = H.depsReelles({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }).client();
  console.log("\nDémarrage…");
  const mesures = await executer({ client, fumee: args.fumee, dossierReplays, fichierMesures });

  console.log("\nSynthèse :");
  console.log(`  Coût total mesuré : ${mesures.synthese.cout_total_usd.toFixed(4)} $`);
  if (mesures.synthese.cout_moyen_par_analyse_usd !== null) console.log(`  Coût moyen par analyse (appel 1 + appel 2) : ${mesures.synthese.cout_moyen_par_analyse_usd.toFixed(4)} $`);
  if (mesures.synthese.duree_moyenne_appel1_ms !== null) console.log(`  Durée moyenne de l'appel 1 : ${(mesures.synthese.duree_moyenne_appel1_ms / 1000).toFixed(1)} s (max ${(mesures.synthese.duree_max_appel1_ms / 1000).toFixed(1)} s)`);
  for (const f of mesures.fichiers_ecrits) console.log(`  Rejeu écrit : ${f}`);
  if (mesures.mentions_reelles.length) {
    console.log("\nATTENTION — mentions réelles détectées dans les rejeux (à neutraliser avant commit) :");
    for (const m of mesures.mentions_reelles) console.log(`  ${m.fichier} : ${m.type} « ${m.valeur} » × ${m.occurrences}`);
  } else if (mesures.fichiers_ecrits.length) {
    console.log("\nAucune marque réelle d'assureur ni plaque au format SIV détectée dans les rejeux.");
  }
  if (mesures.echecs.length) {
    console.log(`\n${mesures.echecs.length} échec(s) : voir ${fichierMesures}`);
    process.exitCode = 1;
  }
  console.log(`\nMesures : ${fichierMesures}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Erreur : ${e && e.message ? e.message : "inconnue"}`);
    process.exitCode = 1;
  });
}
