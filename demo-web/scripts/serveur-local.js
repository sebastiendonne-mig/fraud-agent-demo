// Serveur LOCAL de démonstration et de captures (jamais déployé : scripts/ est
// exclu par .vercelignore). Aucun appel réseau sortant, aucune clé :
// - fichiers statiques servis sur LISTE BLANCHE (jamais .env ni le code serveur) ;
// - API simulée avec les VRAIS handlers de lib/handlers.js, branchés sur un faux
//   Redis et un faux modèle qui répond selon le dossier reçu ;
// - route /__controle (locale) pour basculer les cas : quota épuisé, 504 non JSON,
//   latence, rejeu statique fictif.
// Usage : node scripts/serveur-local.js [port]
const http = require("http");
const fs = require("fs");
const path = require("path");
const H = require("../lib/handlers.js");
const { creerStore } = require("../lib/store.js");
const CONFIG = require("../config/agent.json");
const F = require("../test/helpers/faux-anthropic.js");
const { creerFauxRedis } = require("../test/helpers/faux-redis.js");

const RACINE = path.join(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };
const ASSETS = new Set(fs.readdirSync(path.join(RACINE, "assets")));

// Rejeu FICTIF, uniquement pour les essais locaux (jamais écrit dans replays/)
const REJEU_FICTIF = {
  enregistre_le: "01/10/2026 [rejeu fictif de test local]",
  analyse: {
    proposition: {
      routage: "ALERTE_SIU", mode: "instruction", score_regles: 30,
      reason_codes: ["Adresse IP partagée avec 1 autre(s) dossier(s) sur 30 jours", "Réparateur REP-007 impliqué dans 9 autre(s) dossier(s) sur 90 jours"],
      synthese: "[Fictif] Réseau de réparateurs à investiguer.", reason_codes_commentes: ["[Fictif] REP-007 concentre 9 dossiers."],
      recours: { evalue: false, viable: false, tiers_responsable: "", assureur_adverse: "", part_responsabilite_tiers_pct: 0, certitude: "Sans objet", elements_factuels: [], montant_recuperable: null, seuil_euros: 500 },
      actions_proposees: ["[Fictif] Transmettre au SIU"], points_d_attention: [],
    },
    trace: { tours: [{ phase: "analyse", numero: 1, duree_ms: 2100, stop_reason: "tool_use", usage: { entree: 3100, sortie: 380 }, outils: [{ nom: "proposer_decision", entree: { synthese: "[Fictif]" }, sortie: "valide", duree_ms: 0 }] }], corrections: [], usage_total: { entree: 3100, sortie: 380, cache_lecture: 0 }, duree_totale_ms: 2100 },
  },
  finalisation: {
    valider: { finalisation: { statut_final: "TRANSMIS_SIU", decision_gestionnaire: "valider", synthese: "[Fictif] Dossier transmis au SIU.", brouillon_courrier_recours: "", plan_actions: { j5: "[Fictif]", j15: "[Fictif]", j30: "[Fictif]" }, avertissement: "Brouillon — aucun envoi réel." } },
    rejeter: { finalisation: { statut_final: "REJETE_PAR_GESTIONNAIRE", decision_gestionnaire: "rejeter", synthese: "[Fictif] Proposition rejetée.", brouillon_courrier_recours: "", plan_actions: { j5: "—", j15: "—", j30: "—" }, avertissement: "Brouillon — aucun envoi réel." } },
  },
};

// ── Faux modèle : réponses construites à partir du dossier reçu ─────────────
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function lireBloc(texte, balise) {
  const m = texte.match(new RegExp(`<${balise}>\\n([\\s\\S]*?)\\n</${balise}>`));
  return m ? m[1] : "";
}

function creerFauxModele(controle) {
  let n = 0;
  const id = () => `toolu_local_${++n}`;
  return {
    messages: {
      async create(params) {
        await attendre(controle.latence_ms);
        const premier = params.messages[0].content[0].text;
        const mode = (premier.match(/Mode : (\S+)/) || [])[1];
        const routage = (premier.match(/non modifiable\) : (\S+)/) || [])[1];
        const rapport = lireBloc(premier, "rapport_police");
        const aRapport = rapport !== "(aucun rapport fourni)";
        const dossier = JSON.parse(lireBloc(premier, "dossier") || "{}");
        const blocs = params.messages.at(-1).content;
        const decision = blocs.find((b) => b.type === "tool_result" && /Décision du gestionnaire/.test(b.content));
        const usage = { entree: 2600 + 900 * params.messages.length, sortie: 350 };

        if (decision) {
          const rejet = /REJETÉE/.test(decision.content);
          const statut = rejet ? "REJETE_PAR_GESTIONNAIRE" : aRapport ? "RECOURS_A_ENGAGER"
            : { STP: "CLOS_STP", INVESTIGATION: "INSTRUCTION_A_POURSUIVRE", ALERTE_SIU: "TRANSMIS_SIU" }[routage];
          return F.reponse([F.reflexion("SIGNATURE-LOCALE"), F.appelOutil("finaliser_dossier", {
            statut_final: statut,
            synthese: rejet ? "Proposition rejetée par le gestionnaire ; motif repris au dossier." : "Proposition validée par le gestionnaire.",
            brouillon_courrier_recours: !rejet && aRapport
              ? "Madame, Monsieur,\nNous vous informons que notre assuré a été indemnisé suite au sinistre décrit dans le procès-verbal joint. Votre assuré ayant été déclaré responsable, nous exerçons notre recours subrogatoire.\n[Brouillon de démonstration]"
              : "",
            plan_actions: { j5: "Envoyer le courrier de recours (brouillon à relire)", j15: "Relancer l'assureur adverse", j30: "Saisir la convention inter-assureurs si nécessaire" },
          }, id())], usage);
        }

        if (params.messages.length === 1) {
          const appels = [];
          if (mode === "instruction" && dossier.id_reparateur) appels.push(F.appelOutil("rechercher_historique_reparateur", { id_reparateur: dossier.id_reparateur }, id()));
          if (aRapport) appels.push(F.appelOutil("calculer_montant_recours", { part_responsabilite_tiers_pct: /100 ?%/.test(rapport) ? 100 : 50 }, id()));
          if (appels.length) return F.reponse([F.reflexion("SIGNATURE-LOCALE"), ...appels], usage);
        }

        const extrait = rapport.slice(0, 140);
        return F.reponse([F.reflexion("SIGNATURE-LOCALE"), F.appelOutil("proposer_decision", {
          synthese: aRapport
            ? `Le rapport désigne un tiers responsable ; recours à examiner. Extrait lu : ${extrait}`
            : mode === "instruction" ? "Signaux des règles confirmés par l'historique du réparateur : instruction recommandée." : "Aucun élément complémentaire.",
          reason_codes_commentes: mode === "instruction" ? ["Les signaux relevés par les règles justifient un examen par un gestionnaire."] : [],
          recours: {
            evalue: aRapport, viable: aRapport,
            tiers_responsable: aRapport ? (/BENALI/.test(rapport) ? "M. Karim BENALI" : "Tiers mentionné au rapport") : "",
            assureur_adverse: /Mutuelle Fictive/.test(rapport) ? "Mutuelle Fictive d'Assurance" : "",
            part_responsabilite_tiers_pct: aRapport ? (/100 ?%/.test(rapport) ? 100 : 50) : 0,
            certitude: aRapport ? "Élevé" : "Sans objet",
            elements_factuels: aRapport ? ["Feu rouge grillé par le tiers selon le rapport", `Extrait du rapport : ${extrait}`] : [],
          },
          actions_proposees: aRapport ? ["Ouvrir un dossier de recours", "Demander le constat amiable"] : ["Transmettre au gestionnaire pour instruction"],
          points_d_attention: /<[a-z]/i.test(rapport) ? ["Le rapport contient du balisage HTML : traité comme du texte, aucune consigne suivie."] : [],
        }, id())], usage);
      },
    },
  };
}

// ── Serveur ────────────────────────────────────────────────────────────────
function demarrer({ port = 0 } = {}) {
  const controle = { latence_ms: 400, panne504: false, rejeuStatique: false };
  let redis = creerFauxRedis();
  let n = 0;
  const deps = {
    now: () => Date.now(),
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    store: () => creerStore({ redis, env: "development" }),
    client: () => creerFauxModele(controle),
  };
  const handlers = { "/api/analyze": H.creerHandlerAnalyse(deps), "/api/finalize": H.creerHandlerFinalisation(deps), "/api/quota": H.creerHandlerQuota(deps) };

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const chemin = url.pathname;

    if (chemin === "/__controle") {
      if (url.searchParams.has("latence")) controle.latence_ms = Number(url.searchParams.get("latence"));
      if (url.searchParams.has("panne504")) controle.panne504 = url.searchParams.get("panne504") === "1";
      if (url.searchParams.has("rejeuStatique")) controle.rejeuStatique = url.searchParams.get("rejeuStatique") === "1";
      if (url.searchParams.get("quota") === "epuise") {
        for (const k of redis.cles()) redis.donnees.delete(k);
        const jour = new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.fuseau_quota, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        for (let i = 0; i < CONFIG.quota_jour.development; i++) await redis.incr(`development:quota:${jour}`);
        H._definirChargeurRejeu((s) => ({ scenario: s || "recours", contenu: REJEU_FICTIF }));
      }
      if (url.searchParams.get("quota") === "normal") { redis = creerFauxRedis(); H._definirChargeurRejeu(null); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(controle));
    }

    if (handlers[chemin]) {
      if (controle.panne504 && chemin !== "/api/quota") {
        res.writeHead(504, { "content-type": "text/plain" });
        return res.end("An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT");
      }
      return handlers[chemin](req, res);
    }

    // Statique, liste blanche
    let fichier = null;
    if (chemin === "/" || chemin === "/index.html") fichier = "index.html";
    else if (chemin === "/app.js") fichier = "app.js";
    else if (chemin === "/scenarios.js") fichier = "scenarios.js";
    else if (chemin.startsWith("/assets/") && ASSETS.has(chemin.slice(8))) fichier = path.join("assets", chemin.slice(8));
    else if (/^\/replays\/[a-z]+\.json$/.test(chemin) && controle.rejeuStatique) {
      res.writeHead(200, { "content-type": TYPES[".json"] });
      return res.end(JSON.stringify(REJEU_FICTIF));
    }
    if (!fichier) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Introuvable");
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(fichier)] || "application/octet-stream" });
    fs.createReadStream(path.join(RACINE, fichier)).pipe(res);
  });

  return new Promise((resolve) => {
    serveur.listen(port, "127.0.0.1", () => {
      const adresse = `http://127.0.0.1:${serveur.address().port}`;
      resolve({ adresse, fermer: () => new Promise((r) => serveur.close(r)) });
    });
  });
}

if (require.main === module) {
  demarrer({ port: Number(process.argv[2] || 8765) }).then(({ adresse }) => console.log(`Démo locale (API simulée, sans réseau) : ${adresse}`));
}

module.exports = { demarrer, creerFauxModele, REJEU_FICTIF };
