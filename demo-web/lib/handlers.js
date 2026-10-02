// Logique des deux fonctions HTTP, construite à partir de dépendances
// injectées (horloge, stockage, client Anthropic, rejeux) : testable avec des
// faux, sans réseau. api/analyze.js et api/finalize.js y branchent les vraies.
//
// Principe : jamais d'erreur brute vers le visiteur. Tout ce qui empêche
// l'analyse en direct (quota, stockage, configuration, fournisseur, plafonds,
// exception imprévue) donne une réponse JSON de repli, signalée comme telle.
const crypto = require("crypto");
const CONFIG_AGENT = require("../config/agent.json");
const { validerDossier, validerFinalisation } = require("./validate.js");
const { evaluerDossier } = require("./regles.js");
const { trier, modeAgent, trierAvecJev } = require("./triage.js");
const jev = require("./jev.js");
const { creerEtat, runLoop, reprendreApresDecision, traceClient } = require("./agent.js");
const { creerStore, creerRedisDepuisEnv } = require("./store.js");
const { chargerRejeu } = require("./replay.js");
const { lireCorps, repondre, CORPS_INVALIDE, CORPS_TROP_GROS } = require("./http.js");

const MESSAGE_INDISPONIBLE = "Analyse en direct momentanément indisponible. Réessayez plus tard.";

// Réponse de repli : rejeu signalé s'il existe, sinon « indisponible ».
function reponseRepli(motif, scenario, extraire, commun = {}) {
  let rejeu = null;
  try {
    rejeu = chargerRejeuSur(scenario);
  } catch {
    rejeu = null;
  }
  const partie = rejeu ? extraire(rejeu.contenu) : null;
  if (!partie) return { mode: "indisponible", motif, message: MESSAGE_INDISPONIBLE, ...commun };
  return {
    mode: "rejeu",
    motif,
    bandeau: `Rejeu d'une exécution réelle du ${rejeu.contenu.enregistre_le} — ce n'est pas l'analyse de votre saisie.`,
    rejeu: { scenario: rejeu.scenario, ...partie },
    ...commun,
  };
}
let chargerRejeuSur = chargerRejeu;

function refuserCorps(res, corps) {
  if (corps === CORPS_TROP_GROS) return repondre(res, 413, { erreur: "corps_trop_volumineux" }), true;
  if (corps === CORPS_INVALIDE) return repondre(res, 400, { erreur: "json_invalide" }), true;
  return false;
}

// Triage avec Jev, sans jamais laisser remonter d'erreur : au pire, les règles seules.
// Le quota Jev est compté (avant l'appel) par trierAvecJev, uniquement si Jev va être appelé.
async function trierSansErreur(regles, dossier, req, deps, ms) {
  try {
    return await trierAvecJev(regles, dossier, {
      jev: deps.jev ? { disponible: () => deps.jev.disponible(req), evaluer: (textes) => deps.jev.evaluer(textes, req) } : null,
      async quotaJev() {
        const store = deps.store();
        if (!store) throw new Error("stockage absent");
        return store.incrementerQuotaJev(ms);
      },
    });
  } catch {
    const base = trier(regles);
    return { routage: base.routage, routage_regles: base.routage, source: base.source, jev: null, repli_jev: "jev_erreur", quota_jev: null };
  }
}

// ── Appel 1 : analyse ────────────────────────────────────────────────────
function creerHandlerAnalyse(deps) {
  const config = deps.config || CONFIG_AGENT;
  return async function analyse(req, res) {
    const debut = deps.now();
    let scenario = null;
    let commun = {};
    const repli = (motif) =>
      repondre(res, 200, reponseRepli(motif, scenario, (c) => c.analyse && { proposition: c.analyse.proposition, trace: c.analyse.trace }, commun));
    try {
      if (req.method !== "POST") return repondre(res, 405, { erreur: "methode_non_autorisee" });
      const corps = await lireCorps(req);
      if (refuserCorps(res, corps)) return;
      const v = validerDossier(corps);
      if (!v.ok) return repondre(res, 400, { erreur: "donnees_invalides", details: v.erreurs });

      const dossier = v.valeur;
      scenario = dossier.scenario;
      // Règles : déterministes, toujours calculées et renvoyées
      const regles = evaluerDossier(dossier);
      // Triage : les règles fixent le plancher ; Jev (si des textes existent) ne peut que le relever d'un niveau.
      const triage = await trierSansErreur(regles, dossier, req, deps, debut);
      const { routage } = triage;
      const mode = modeAgent(routage, dossier.rapport_police);
      commun = {
        regles: { score: regles.score, reason_codes: regles.reason_codes, detail: regles.detail },
        routage, routage_regles: triage.routage_regles, source_routage: triage.source,
        jev: triage.jev, repli_jev: triage.repli_jev, quota_jev: triage.quota_jev,
      };

      if (!mode) {
        return repondre(res, 200, {
          mode: "regles_seules", ...commun,
          message: triage.jev
            ? "Dossier en traitement automatique (STP), sans rapport de police : l'agent n'est pas appelé (triage Jev effectué)."
            : "Dossier en traitement automatique (STP), sans rapport de police : aucun appel à l'IA.",
        });
      }

      const client = deps.client();
      if (!client) return repli("configuration");
      const store = deps.store();
      if (!store) return repli("stockage_indisponible");
      let quota;
      try {
        quota = await store.incrementerQuota(debut);
      } catch {
        return repli("stockage_indisponible");
      }
      if (!quota.autorise) return repli("quota_atteint");
      const quotaRestant = { restantes: Math.max(0, quota.limite - quota.utilisees), limite: quota.limite };

      const etat = await runLoop(
        creerEtat({ dossier, regles: { score: regles.score, reason_codes: regles.reason_codes }, routage, mode }, deps.now),
        { client, now: deps.now, deadline: debut + config.temps.analyse.budget_ms, config }
      );
      if (etat.statut !== "pause") return repli(etat.motif_repli);

      const runId = deps.uuid();
      try {
        await store.sauverRun(runId, etat);
      } catch {
        return repli("stockage_indisponible");
      }
      return repondre(res, 200, {
        mode: "direct", ...commun, mode_agent: mode, modele: config.modele,
        run_id: runId, quota: quotaRestant, proposition: etat.proposition, trace: traceClient(etat),
      });
    } catch {
      return repli("erreur_interne");
    }
  };
}

// ── Appel 2 : finalisation après décision humaine ─────────────────────────
function creerHandlerFinalisation(deps) {
  const config = deps.config || CONFIG_AGENT;
  return async function finalisation(req, res) {
    const debut = deps.now();
    let scenario = null;
    let action = null;
    const repli = (motif) =>
      repondre(res, 200, reponseRepli(motif, scenario,
        (c) => c.finalisation && c.finalisation[action] && { finalisation: c.finalisation[action].finalisation, trace: c.finalisation[action].trace }));
    try {
      if (req.method !== "POST") return repondre(res, 405, { erreur: "methode_non_autorisee" });
      const corps = await lireCorps(req);
      if (refuserCorps(res, corps)) return;
      const v = validerFinalisation(corps);
      if (!v.ok) return repondre(res, 400, { erreur: "donnees_invalides", details: v.erreurs });
      action = v.valeur.action;

      const store = deps.store();
      if (!store) return repli("stockage_indisponible");
      let etat;
      try {
        etat = await store.prendreRun(v.valeur.run_id); // usage unique
      } catch {
        return repli("stockage_indisponible");
      }
      if (!etat) {
        return repondre(res, 410, { erreur: "session_expiree", message: "Session expirée, relancez l'analyse." });
      }
      scenario = etat.contexte && etat.contexte.dossier ? etat.contexte.dossier.scenario : null;

      const client = deps.client();
      if (!client) return repli("configuration");
      const fin = await runLoop(
        reprendreApresDecision(etat, { action, motif: v.valeur.motif }),
        { client, now: deps.now, deadline: debut + config.temps.finalisation.budget_ms, config }
      );
      if (fin.statut !== "termine") return repli(fin.motif_repli);
      return repondre(res, 200, {
        mode: "direct", routage: fin.contexte.routage, modele: config.modele,
        proposition: fin.proposition, finalisation: fin.finalisation, trace: traceClient(fin),
      });
    } catch {
      return repli("erreur_interne");
    }
  };
}

// ── Quota restant (lecture seule) ─────────────────────────────────────────
// Mis en cache 60 s par le CDN de Vercel (s-maxage) : au plus une lecture
// Redis par minute et par région, jamais une par chargement de page.
// En cas d'échec : 503 sans cache, et le front n'affiche rien.
const CACHE_QUOTA = "public, max-age=0, s-maxage=60";

function creerHandlerQuota(deps) {
  return async function quota(req, res) {
    try {
      if (req.method !== "GET") return repondre(res, 405, { erreur: "methode_non_autorisee" });
      const store = deps.store();
      if (!store) return repondre(res, 503, { erreur: "indisponible" });
      const { restantes, limite } = await store.lireQuota(deps.now());
      const reponse = { restantes, limite };
      try {
        const j = await store.lireQuotaJev(deps.now());
        reponse.jev = { restantes: j.restantes, limite: j.limite };
      } catch {
        // le compteur Jev est secondaire : son absence n'empêche pas d'afficher le quota des analyses
      }
      return repondre(res, 200, reponse, { cache: CACHE_QUOTA });
    } catch {
      return repondre(res, 503, { erreur: "indisponible" });
    }
  };
}

// Dépendances réelles, créées à la demande (aucun accès réseau au chargement).
// Les secrets ne servent qu'à construire les clients : jamais affichés ni journalisés.
function depsReelles(env = process.env) {
  let store;
  let client;
  return {
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    store() {
      if (store === undefined) {
        const redis = creerRedisDepuisEnv(env);
        store = redis ? creerStore({ redis, env: env.VERCEL_ENV }) : null;
      }
      return store;
    },
    // Jev : jeton OIDC de la requête (jamais AI_GATEWAY_API_KEY). Sans jeton, Jev n'est pas appelé.
    jev: {
      disponible: (req) => jev.lireJetonOidc(req, env) !== null,
      evaluer: (textes, req) => jev.evaluer(textes, { jeton: jev.lireJetonOidc(req, env) }),
    },
    client() {
      if (client === undefined) {
        if (!env.ANTHROPIC_API_KEY) client = null;
        else {
          const Anthropic = require("@anthropic-ai/sdk").default;
          client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
        }
      }
      return client;
    },
  };
}

// Pour les tests uniquement : remplacer la source des rejeux
function _definirChargeurRejeu(f) {
  chargerRejeuSur = f || chargerRejeu;
}

module.exports = { creerHandlerAnalyse, creerHandlerFinalisation, creerHandlerQuota, CACHE_QUOTA, depsReelles, MESSAGE_INDISPONIBLE, _definirChargeurRejeu };
