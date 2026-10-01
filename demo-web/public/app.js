// Front de la démo « agent fraude & recours ».
// Le navigateur n'envoie que les données du dossier (et l'identifiant du
// scénario si une pastille est utilisée) : aucun prompt, modèle ni clé ici.
// Sécurité : le DOM est construit uniquement avec createElement et
// textContent : aucune insertion de HTML brut (anti-XSS). Un rapport de
// police contenant des balises s'affiche donc comme du texte.
"use strict";

const API = { analyse: "/api/analyze", finalisation: "/api/finalize", quota: "/api/quota" };
// maxDuration de vercel.json + 5 s : au-delà, le client abandonne et passe au repli
const DELAI_MS = { analyse: 245000, finalisation: 185000, quota: 10000, rejeu: 10000 };
// PROVISOIRE jusqu'à la vérification en prévisualisation. Mesures du 01/10/2026 :
// 6 à 10 s pour l'analyse, 3 à 6 s pour la finalisation, jusqu'à ~18 s à cache froid.
const DUREE_ANNONCEE = "généralement 10 à 20 secondes";
const MESSAGE_NEUTRE = "Analyse en direct momentanément indisponible. Réessayez plus tard.";
const AVERTISSEMENT_BROUILLON = "Brouillon — aucun envoi réel.";
const SCENARIO_REPLI = "recours";

const ROUTAGES = {
  STP: { libelle: "Traitement automatique (STP)", symbole: "✓", classe: "stp" },
  INVESTIGATION: { libelle: "Investigation", symbole: "◐", classe: "investigation" },
  ALERTE_SIU: { libelle: "Alerte SIU", symbole: "▲", classe: "siu" },
};
const STATUTS_FINAUX = {
  CLOS_STP: "Clos en traitement automatique",
  INSTRUCTION_A_POURSUIVRE: "Instruction à poursuivre",
  TRANSMIS_SIU: "Transmis au SIU",
  RECOURS_A_ENGAGER: "Recours à engager",
  REJETE_PAR_GESTIONNAIRE: "Proposition rejetée par le gestionnaire",
};
const MOTIFS_REPLI = {
  quota_atteint: "Le nombre d'analyses réelles du jour est atteint.",
  stockage_indisponible: "Le stockage de session est indisponible.",
  configuration: "L'analyse en direct n'est pas configurée.",
  budget_temps: "L'analyse a dépassé le temps imparti.",
  refus: "Le modèle a décliné la demande.",
  erreur_fournisseur: "Le service du modèle n'a pas répondu.",
};
const LIBELLES_CHAMPS = {
  id_police: "Numéro de police", type_sinistre: "Type de sinistre", montant_reclame: "Montant réclamé",
  montant_plafond: "Plafond de la police", franchise: "Franchise", date_declaration: "Date de déclaration",
  date_souscription: "Date de souscription", id_reparateur: "Réparateur", reparateur_count_90d: "Dossiers du même réparateur",
  ip_count_30d: "Déclarations depuis la même IP", rapport_police: "Rapport de police", motif: "Motif",
};

// ── Scénarios de démonstration : source unique dans scenarios.js ───────────
const { joursAvant } = window.ScenariosDemo;
const SCENARIOS = window.ScenariosDemo.scenarios();

// ── État de la page ────────────────────────────────────────────────────────
const etat = { scenario: null, runId: null, mode: null, rejeuScenario: null, proposition: null, trace: null, regles: null };

// ── Outils DOM sûrs ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Crée un élément ; le texte passe toujours par textContent
function el(tag, options = {}, ...enfants) {
  const n = document.createElement(tag);
  if (options.classe) n.className = options.classe;
  if (options.texte !== undefined && options.texte !== null) n.textContent = String(options.texte);
  for (const enfant of enfants) if (enfant) n.append(enfant);
  return n;
}
function vider(n) { n.replaceChildren(); }
function montrer(id, visible = true) { $(id).hidden = !visible; }
function euros(n) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
function secondes(ms) {
  return `${(ms / 1000).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}
function nombre(n) { return Number(n || 0).toLocaleString("fr-FR"); }
function liste(textes, classe = "liste") {
  const ul = el("ul", { classe });
  for (const t of textes || []) ul.append(el("li", { texte: t }));
  return ul;
}
function champs(couples) {
  const dl = el("dl", { classe: "champs" });
  for (const [terme, valeur] of couples) {
    dl.append(el("dt", { texte: terme }));
    dl.append(valeur instanceof Node ? el("dd", {}, valeur) : el("dd", { texte: valeur }));
  }
  return dl;
}

// ── Réseau : délai borné, jamais d'exception vers l'interface ───────────────
async function envoyer(url, methode, corps, delaiMs) {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), delaiMs);
  try {
    const reponse = await fetch(url, {
      method: methode,
      headers: corps ? { "content-type": "application/json" } : undefined,
      body: corps ? JSON.stringify(corps) : undefined,
      signal: controleur.signal,
    });
    let donnees = null;
    try {
      donnees = await reponse.json();
    } catch {
      donnees = null; // réponse non JSON (ex. 504 de la plateforme)
    }
    return { ok: reponse.ok, statut: reponse.status, donnees };
  } catch {
    return { ok: false, statut: 0, donnees: null }; // abandon, coupure réseau
  } finally {
    clearTimeout(minuterie);
  }
}

// ── Formulaire ─────────────────────────────────────────────────────────────
const CHAMPS_TEXTE = ["id_police", "type_sinistre", "date_declaration", "date_souscription", "id_reparateur", "rapport_police"];
const CHAMPS_NOMBRE = ["montant_reclame", "montant_plafond", "franchise", "reparateur_count_90d", "ip_count_30d"];

function remplirScenario(nom) {
  const s = SCENARIOS[nom];
  if (!s) return;
  for (const [cle, valeur] of Object.entries(s)) $(cle).value = valeur;
  etat.scenario = nom;
  for (const b of document.querySelectorAll(".pastille")) b.setAttribute("aria-pressed", String(b.dataset.scenario === nom));
}

function lireDossier() {
  const dossier = {};
  for (const cle of CHAMPS_TEXTE) dossier[cle] = $(cle).value.trim();
  for (const cle of CHAMPS_NOMBRE) {
    const v = $(cle).value;
    dossier[cle] = v === "" ? null : Number(v);
  }
  if (dossier.franchise === null) delete dossier.franchise;
  for (const cle of ["reparateur_count_90d", "ip_count_30d"]) if (dossier[cle] === null) delete dossier[cle];
  if (etat.scenario) dossier.scenario = etat.scenario;
  return dossier;
}

function reinitialiser() {
  $("formulaire").reset();
  $("date_declaration").value = joursAvant(5);
  $("date_souscription").value = joursAvant(400);
  etat.scenario = null;
  for (const b of document.querySelectorAll(".pastille")) b.setAttribute("aria-pressed", "false");
  montrer("resultat", false);
  montrer("message", false);
}

// ── Messages ───────────────────────────────────────────────────────────────
function afficherMessage(texte, details) {
  const zone = $("message");
  vider(zone);
  zone.append(el("p", { texte }));
  if (details && details.length) zone.append(liste(details));
  montrer("message", true);
}

function afficherErreursChamps(erreurs) {
  const lignes = (erreurs || []).map((e) => `${LIBELLES_CHAMPS[e.champ] || e.champ || "Formulaire"} : ${e.message}`);
  afficherMessage("Vérifiez les champs suivants :", lignes);
}

// ── Quota ──────────────────────────────────────────────────────────────────
function afficherQuota(restantes) {
  const zone = $("quotaRestant");
  if (!Number.isInteger(restantes) || restantes < 0) return; // rien en cas de doute
  zone.textContent = `Analyses réelles restantes aujourd'hui : ${restantes}`;
  zone.hidden = false;
}

async function chargerQuota() {
  const r = await envoyer(API.quota, "GET", null, DELAI_MS.quota);
  if (r.ok && r.donnees) afficherQuota(r.donnees.restantes);
}

// ── Rendu : score et routage ──────────────────────────────────────────────
function afficherScore(regles, routage, titre) {
  const info = ROUTAGES[routage] || ROUTAGES.STP;
  const score = Math.max(0, Math.min(50, Number(regles.score) || 0));
  const decalage = String(100 - (score / 50) * 100);
  $("jaugeContour").setAttribute("stroke-dashoffset", decalage);
  const remplissage = $("jaugeRemplissage");
  remplissage.setAttribute("stroke-dashoffset", decalage);
  remplissage.setAttribute("class", `remplissage ${info.classe}`);
  $("titreScore").textContent = titre;
  $("scoreValeur").textContent = String(score);
  const pastille = $("routage");
  pastille.className = `routage ${info.classe}`;
  pastille.textContent = `${info.symbole} ${info.libelle}`;
  $("sourceRoutage").textContent = "Routage calculé par les règles métier : l'agent ne peut pas le modifier.";
  const codes = $("reasonCodes");
  vider(codes);
  const lignes = regles.reason_codes && regles.reason_codes.length ? regles.reason_codes : ["Aucun signal déclenché."];
  for (const t of lignes) codes.append(el("li", { texte: t }));
}

// ── Rendu : déroulé construit à partir de la trace réelle ──────────────────
function etapesDepuisTrace(regles, routage, trace, suite) {
  const etapes = [
    { titre: "Règles", detail: `Score ${regles.score} / 50`, statut: "fait" },
    { titre: "Triage", detail: (ROUTAGES[routage] || ROUTAGES.STP).libelle, statut: "fait" },
  ];
  for (const t of (trace && trace.tours) || []) {
    const outils = (t.outils || []).map((o) => o.nom).join(", ") || "réponse sans outil";
    const phase = t.phase === "finalisation" ? "Finalisation" : "Analyse";
    etapes.push({ titre: `${phase} — tour ${t.numero}`, detail: `${outils} · ${secondes(t.duree_ms || 0)}`, statut: "fait" });
  }
  return etapes.concat(suite || []);
}

const SYMBOLES_ETAPE = { fait: "✓", en_cours: "…", a_venir: "○" };
const LIBELLES_ETAPE = { fait: "terminé", en_cours: "en cours", a_venir: "à venir" };

function afficherStepper(etapes) {
  const ol = $("stepper");
  vider(ol);
  for (const e of etapes) {
    const li = el("li", { classe: e.statut });
    li.append(el("span", { classe: "pastille-etape", texte: SYMBOLES_ETAPE[e.statut] }));
    const corps = el("div", {}, el("div", { classe: "titre-etape", texte: e.titre }));
    corps.append(el("div", { classe: "detail-etape", texte: [e.detail, LIBELLES_ETAPE[e.statut]].filter(Boolean).join(" · ") }));
    li.append(corps);
    ol.append(li);
  }
}

// ── Rendu : proposition typée ──────────────────────────────────────────────
function afficherProposition(p, corrections, titre) {
  const zone = $("proposition");
  vider(zone);
  $("titreProposition").textContent = titre;
  zone.append(el("p", { texte: p.synthese }));
  if (p.reason_codes_commentes && p.reason_codes_commentes.length) {
    zone.append(el("h3", { texte: "Commentaires de l'agent sur les signaux" }), liste(p.reason_codes_commentes));
  }
  const r = p.recours || {};
  zone.append(el("h3", { texte: "Recours" }));
  if (!r.evalue) {
    zone.append(el("p", { texte: "Recours non évalué (aucun rapport de police exploitable)." }));
  } else {
    const montant = el("span", { texte: r.montant_recuperable === null || r.montant_recuperable === undefined ? "—" : euros(r.montant_recuperable) });
    montant.append(el("span", { classe: "note-code", texte: " (calculé par le code ; montant brut, franchise non traitée dans cette démo)" }));
    zone.append(champs([
      ["Recours viable", r.viable ? "Oui" : "Non"],
      ["Tiers responsable", r.tiers_responsable || "Non identifié"],
      ["Assureur adverse", r.assureur_adverse || "Non mentionné"],
      ["Part de responsabilité du tiers", `${r.part_responsabilite_tiers_pct} %`],
      ["Montant récupérable (brut)", montant],
      ["Seuil minimal de recours", r.seuil_euros ? euros(r.seuil_euros) : "—"],
      ["Certitude", r.certitude || "—"],
    ]));
    if (r.elements_factuels && r.elements_factuels.length) {
      zone.append(el("h3", { texte: "Éléments factuels" }), liste(r.elements_factuels));
    }
  }
  if (p.actions_proposees && p.actions_proposees.length) zone.append(el("h3", { texte: "Actions proposées" }), liste(p.actions_proposees));
  if (p.points_d_attention && p.points_d_attention.length) zone.append(el("h3", { texte: "Points d'attention" }), liste(p.points_d_attention));
  const corr = (corrections || []).filter((c) => c.champ !== "repli");
  if (corr.length) {
    zone.append(el("h3", { texte: "Corrigé par le serveur" }), liste(corr.map((c) => `${c.champ} : ${c.motif}`)));
  }
  montrer("carteProposition", true);
}

// ── Rendu : finalisation ───────────────────────────────────────────────────
function afficherFinalisation(f) {
  const zone = $("finalisation");
  vider(zone);
  zone.append(champs([
    ["Statut final", STATUTS_FINAUX[f.statut_final] || f.statut_final],
    ["Décision du gestionnaire", f.decision_gestionnaire === "rejeter" ? "Rejetée" : "Validée"],
  ]));
  zone.append(el("h3", { texte: "Synthèse" }), el("p", { texte: f.synthese }));
  if (f.brouillon_courrier_recours) {
    zone.append(el("h3", { texte: "Brouillon de courrier de recours" }), el("pre", { texte: f.brouillon_courrier_recours }));
  }
  const plan = f.plan_actions || {};
  zone.append(el("h3", { texte: "Plan d'actions" }), champs([["J+5", plan.j5 || "—"], ["J+15", plan.j15 || "—"], ["J+30", plan.j30 || "—"]]));
  zone.append(el("p", { classe: "avertissement", texte: AVERTISSEMENT_BROUILLON }));
  montrer("carteFinalisation", true);
}

// ── Rendu : journal de l'agent ─────────────────────────────────────────────
function json(valeur) {
  return typeof valeur === "string" ? valeur : JSON.stringify(valeur, null, 2);
}

function afficherJournal(trace) {
  const zone = $("journal");
  vider(zone);
  if (!trace || !trace.tours || !trace.tours.length) {
    montrer("carteJournal", false);
    return;
  }
  if (trace.usage_total) {
    const u = trace.usage_total;
    zone.append(el("p", { classe: "tour-meta", texte:
      `Durée totale : ${secondes(trace.duree_totale_ms || 0)} · tokens en entrée : ${nombre(u.entree)} · en sortie : ${nombre(u.sortie)} · lus en cache : ${nombre(u.cache_lecture)}` }));
  }
  for (const t of trace.tours) {
    const bloc = el("div", { classe: "tour" });
    const phase = t.phase === "finalisation" ? "Finalisation" : "Analyse";
    bloc.append(el("div", { classe: "tour-entete", texte: `${phase} · tour ${t.numero}` }));
    const u = t.usage || {};
    bloc.append(el("div", { classe: "tour-meta", texte:
      `Durée ${secondes(t.duree_ms || 0)} · arrêt : ${t.stop_reason || "—"} · tokens ${nombre(u.entree)} en entrée / ${nombre(u.sortie)} en sortie` }));
    for (const o of t.outils || []) {
      bloc.append(el("p", { classe: "libelle", texte: `Outil ${o.nom} · ${secondes(o.duree_ms || 0)}` }));
      bloc.append(el("pre", { texte: `Entrée :\n${json(o.entree)}` }));
      bloc.append(el("pre", { texte: o.erreur !== undefined ? `Erreur renvoyée au modèle :\n${o.erreur}` : `Sortie :\n${json(o.sortie)}` }));
    }
    zone.append(bloc);
  }
  if (trace.corrections && trace.corrections.length) {
    zone.append(el("h3", { texte: "Corrigé par le serveur" }), liste(trace.corrections.map((c) => `${c.champ} : ${c.motif}`)));
  }
  montrer("carteJournal", true);
}

// ── Rendu : en-tête du résultat ────────────────────────────────────────────
function afficherBadge(classe, texte, bandeau) {
  const b = $("badge");
  b.className = `badge ${classe}`;
  b.textContent = texte;
  const ban = $("bandeau");
  ban.textContent = bandeau || "";
  ban.hidden = !bandeau;
}

function bandeauRejeu(date) {
  return `Rejeu d'une exécution réelle du ${date} — ce n'est pas l'analyse de votre saisie.`;
}

function preparerResultat() {
  for (const id of ["carteProposition", "carteDecision", "carteFinalisation", "carteJournal", "carteScore"]) montrer(id, false);
  montrer("message", false);
  $("motif").value = "";
  majCompteurMotif();
  montrer("resultat", true);
}

// ── Rendu des réponses d'analyse ───────────────────────────────────────────
function rendreAnalyse(d) {
  preparerResultat();
  etat.mode = d.mode;
  etat.regles = d.regles || null;

  if (d.mode === "regles_seules") {
    afficherBadge("regles", "Règles seules — aucun appel IA");
    afficherScore(d.regles, d.routage, "Score des règles");
    montrer("carteScore", true);
    afficherStepper(etapesDepuisTrace(d.regles, d.routage, null, [
      { titre: "Agent", detail: "non appelé : traitement automatique sans rapport de police", statut: "fait" },
    ]));
    afficherMessage(d.message || "Dossier en traitement automatique : aucun appel à l'IA.");
    return;
  }

  if (d.mode === "direct") {
    const tours = (d.trace && d.trace.tours) || [];
    const u = (d.trace && d.trace.usage_total) || {};
    afficherBadge("reel", `Exécution réelle · ${d.modele} · ${tours.length} tour${tours.length > 1 ? "s" : ""} · ${nombre((u.entree || 0) + (u.sortie || 0))} tokens`);
    if (d.quota) afficherQuota(d.quota.restantes);
    etat.runId = d.run_id;
    etat.proposition = d.proposition;
    etat.trace = d.trace;
    afficherScore(d.regles, d.routage, "Score des règles");
    montrer("carteScore", true);
    afficherStepper(etapesDepuisTrace(d.regles, d.routage, d.trace, [
      { titre: "Proposition", detail: "décision typée de l'agent", statut: "fait" },
      { titre: "Décision humaine", detail: "à vous de valider ou de rejeter", statut: "en_cours" },
      { titre: "Finalisation", statut: "a_venir" },
    ]));
    afficherProposition(d.proposition, d.trace && d.trace.corrections, "Proposition de l'agent");
    afficherJournal(d.trace);
    montrer("carteDecision", true);
    return;
  }

  // Rejeu signalé ou indisponibilité : le résultat des règles sur la saisie reste affiché
  if (d.motif === "quota_atteint") afficherQuota(0);
  const motif = MOTIFS_REPLI[d.motif] || "";
  if (d.regles && d.routage) {
    afficherScore(d.regles, d.routage, "Votre dossier : score des règles");
    montrer("carteScore", true);
  }
  if (d.mode === "rejeu" && d.rejeu) {
    etat.rejeuScenario = d.rejeu.scenario;
    afficherBadge("rejeu", "Rejeu", [motif, d.bandeau].filter(Boolean).join(" "));
    const trace = d.rejeu.trace || null;
    const regles = d.regles || { score: (d.rejeu.proposition && d.rejeu.proposition.score_regles) || 0 };
    afficherStepper(etapesDepuisTrace(regles, d.routage || (d.rejeu.proposition && d.rejeu.proposition.routage) || "STP", trace, [
      { titre: "Proposition", detail: "rejouée", statut: "fait" },
      { titre: "Décision humaine", detail: "à vous de valider ou de rejeter", statut: "en_cours" },
      { titre: "Finalisation", statut: "a_venir" },
    ]));
    if (d.rejeu.proposition) afficherProposition(d.rejeu.proposition, trace && trace.corrections, "Proposition rejouée (autre dossier)");
    afficherJournal(trace);
    montrer("carteDecision", true);
    return;
  }
  afficherBadge("rejeu", "Indisponible", motif || null);
  afficherStepper(d.regles && d.routage ? etapesDepuisTrace(d.regles, d.routage, null, [
    { titre: "Agent", detail: "analyse en direct indisponible", statut: "a_venir" },
  ]) : []);
  afficherMessage(MESSAGE_NEUTRE);
}

// ── Repli côté client : rejeu statique, sinon message neutre ───────────────
async function chargerRejeuStatique(scenario) {
  const nom = scenario || SCENARIO_REPLI;
  const r = await envoyer(`/replays/${encodeURIComponent(nom)}.json`, "GET", null, DELAI_MS.rejeu);
  return r.ok && r.donnees ? { scenario: nom, contenu: r.donnees } : null;
}

async function repliClientAnalyse() {
  const rejeu = await chargerRejeuStatique(etat.scenario);
  if (!rejeu || !rejeu.contenu.analyse) {
    preparerResultat();
    montrer("resultat", false);
    afficherMessage(MESSAGE_NEUTRE);
    return;
  }
  rendreAnalyse({
    mode: "rejeu",
    bandeau: bandeauRejeu(rejeu.contenu.enregistre_le),
    rejeu: { scenario: rejeu.scenario, proposition: rejeu.contenu.analyse.proposition, trace: rejeu.contenu.analyse.trace },
  });
}

// ── Analyse ────────────────────────────────────────────────────────────────
function attente(visible) {
  $("attenteTexte").textContent = `Analyse en cours — ${DUREE_ANNONCEE}.`;
  montrer("attente", visible);
  $("boutonAnalyser").disabled = visible;
}

async function analyser(evenement) {
  evenement.preventDefault();
  montrer("message", false);
  montrer("resultat", false);
  etat.runId = null;
  attente(true);
  const r = await envoyer(API.analyse, "POST", lireDossier(), DELAI_MS.analyse);
  attente(false);
  if (r.statut === 400 && r.donnees) return afficherErreursChamps(r.donnees.details);
  if (!r.ok || !r.donnees) return repliClientAnalyse();
  rendreAnalyse(r.donnees);
  $("resultat").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Décision humaine et finalisation ───────────────────────────────────────
function majCompteurMotif() {
  const longueur = $("motif").value.length;
  $("compteurMotif").textContent = `${longueur} / 500`;
  $("boutonRejeter").disabled = $("motif").value.trim().length === 0;
}

function boutonsDecision(actifs) {
  $("boutonValider").disabled = !actifs;
  $("boutonRejeter").disabled = !actifs || $("motif").value.trim().length === 0;
  $("motif").disabled = !actifs;
  montrer("attenteFinalisation", !actifs);
}

function majDeroule(trace, action, final) {
  const regles = etat.regles || { score: (etat.proposition && etat.proposition.score_regles) || 0 };
  const routage = (etat.proposition && etat.proposition.routage) || "STP";
  afficherStepper(etapesDepuisTrace(regles, routage, trace, [
    { titre: "Proposition", detail: "décision typée de l'agent", statut: "fait" },
    { titre: "Décision humaine", detail: action === "rejeter" ? "rejetée" : "validée", statut: "fait" },
    { titre: "Finalisation", detail: final ? "brouillon produit" : "indisponible", statut: final ? "fait" : "a_venir" },
  ]));
}

async function decider(action) {
  const motif = $("motif").value.trim();
  if (action === "rejeter" && !motif) return afficherErreursChamps([{ champ: "motif", message: "motif obligatoire pour rejeter" }]);
  montrer("message", false);
  boutonsDecision(false);

  // Rejeu : la finalisation rejouée vient du fichier statique, aucun appel au serveur d'analyse
  if (etat.mode === "rejeu" || !etat.runId) {
    const rejeu = await chargerRejeuStatique(etat.rejeuScenario || etat.scenario);
    boutonsDecision(true);
    const partie = rejeu && rejeu.contenu.finalisation && rejeu.contenu.finalisation[action];
    if (!partie) return afficherMessage(MESSAGE_NEUTRE);
    montrer("carteDecision", false);
    afficherFinalisation(partie.finalisation);
    return;
  }

  const r = await envoyer(API.finalisation, "POST", { run_id: etat.runId, action, motif }, DELAI_MS.finalisation);
  boutonsDecision(true);
  if (r.statut === 400 && r.donnees) return afficherErreursChamps(r.donnees.details);
  if (r.statut === 410) {
    etat.runId = null;
    montrer("carteDecision", false);
    return afficherMessage((r.donnees && r.donnees.message) || "Session expirée, relancez l'analyse.");
  }
  etat.runId = null; // session à usage unique côté serveur
  montrer("carteDecision", false);
  if (!r.ok || !r.donnees) {
    majDeroule(etat.trace, action, false);
    return afficherMessage(MESSAGE_NEUTRE);
  }
  const d = r.donnees;
  if (d.mode === "direct") {
    majDeroule(d.trace, action, true);
    afficherJournal(d.trace);
    afficherFinalisation(d.finalisation);
    return;
  }
  majDeroule(etat.trace, action, false);
  if (d.mode === "rejeu" && d.rejeu && d.rejeu.finalisation) {
    afficherBadge("rejeu", "Rejeu", [MOTIFS_REPLI[d.motif], d.bandeau].filter(Boolean).join(" "));
    afficherFinalisation(d.rejeu.finalisation);
    return;
  }
  afficherMessage(MESSAGE_NEUTRE);
}

// ── Démarrage ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  $("date_declaration").value = joursAvant(5);
  $("date_souscription").value = joursAvant(400);
  for (const b of document.querySelectorAll(".pastille")) b.addEventListener("click", () => remplirScenario(b.dataset.scenario));
  $("formulaire").addEventListener("submit", analyser);
  $("boutonReinitialiser").addEventListener("click", reinitialiser);
  $("motif").addEventListener("input", majCompteurMotif);
  $("boutonValider").addEventListener("click", () => decider("valider"));
  $("boutonRejeter").addEventListener("click", () => decider("rejeter"));
  chargerQuota();
});
