// ── Scénarios de démonstration rapide ──────────────────────────────────────
const DEMO_SCENARIOS = {
  stp: {
    id_police: "POL-12901",
    type_sinistre: "bris_de_glace",
    montant_reclame: 280,
    montant_plafond: 5000,
    franchise: 150,
    date_declaration: daysAgo(20),
    date_souscription: daysAgo(730),
    id_reparateur: "REP-042",
    reparateur_count_90d: 0,
    ip_count_30d: 0,
    rapport_police: "",
  },
  reseau: {
    id_police: "POL-78234",
    type_sinistre: "accident_auto",
    montant_reclame: 4800,
    montant_plafond: 15000,
    franchise: 500,
    date_declaration: daysAgo(5),
    date_souscription: daysAgo(400),
    id_reparateur: "REP-007",
    reparateur_count_90d: 9,
    ip_count_30d: 1,
    rapport_police: "",
  },
  precoce: {
    id_police: "POL-55401",
    type_sinistre: "degat_des_eaux",
    montant_reclame: 10362,
    montant_plafond: 20000,
    franchise: 300,
    date_declaration: daysAgo(10),
    date_souscription: daysAgo(10),
    id_reparateur: "REP-019",
    reparateur_count_90d: 1,
    ip_count_30d: 0,
    rapport_police: "",
  },
  recours: {
    id_police: "POL-78901",
    type_sinistre: "accident_auto",
    montant_reclame: 5652,
    montant_plafond: 25000,
    franchise: 500,
    date_declaration: daysAgo(12),
    date_souscription: daysAgo(900),
    id_reparateur: "REP-031",
    reparateur_count_90d: 1,
    ip_count_30d: 0,
    rapport_police: `PROCÈS-VERBAL N° PV-2024-0012
Service : Brigade Territoriale de Gendarmerie — Metz Est
Date : 14/03/2024 — 09h47

CIRCONSTANCES : Collision en intersection réglementée par feux tricolores.
Le véhicule de M. Laurent MARTIN (assuré, plaque EF-456-GH) circulait sur voie principale,
feu vert. Le véhicule de M. Karim BENALI (tiers, plaque AB-123-CD, assuré MACIF n°9821034)
a grillé le feu rouge en tournant à gauche et a percuté l'avant droit du véhicule assuré.

TÉMOINS : Mme Sophie ROUSSEAU (08 12 34 56 78) confirme que M. BENALI a brûlé le feu rouge.

RESPONSABILITÉ : M. BENALI (tiers) responsable à 100 %. Aucun partage de responsabilité.
Dommages matériels : 5 652 € (devis garage MARTIN & Fils). Dommages corporels : néant.

Signé : Adjudant-Chef DUPONT — Gendarmerie Metz Est`,
  },
};

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fillDemo(scenario) {
  const s = DEMO_SCENARIOS[scenario];
  if (!s) return;
  document.getElementById("id_police").value = s.id_police;
  document.getElementById("type_sinistre").value = s.type_sinistre;
  document.getElementById("montant_reclame").value = s.montant_reclame;
  document.getElementById("montant_plafond").value = s.montant_plafond;
  document.getElementById("franchise").value = s.franchise;
  document.getElementById("date_declaration").value = s.date_declaration;
  document.getElementById("date_souscription").value = s.date_souscription;
  document.getElementById("id_reparateur").value = s.id_reparateur;
  document.getElementById("reparateur_count_90d").value = s.reparateur_count_90d;
  document.getElementById("ip_count_30d").value = s.ip_count_30d;
  document.getElementById("rapport_police").value = s.rapport_police;
}

// Pré-remplir les dates par défaut
// true si ANTHROPIC_API_KEY est configurée côté serveur Vercel
let serverKeyConfigured = false;

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("date_declaration").value = daysAgo(5);
  document.getElementById("date_souscription").value = daysAgo(400);

  try {
    const res = await fetch("/api/check");
    if (res.ok) {
      const { configured } = await res.json();
      if (configured) {
        serverKeyConfigured = true;
        document.getElementById("apiKeySection").classList.add("hidden");
        document.getElementById("apiKeyConfigured").classList.remove("hidden");
      }
    }
  } catch (_) {
    // /api/check indisponible (dev local sans serverless) — on garde le champ
  }
});

// ── Utilitaires ─────────────────────────────────────────────────────────────
function setStep(stepId, state) {
  const el = document.getElementById(stepId);
  if (!el) return;
  el.className = "pipeline-step " + state;
}

function setStatus(text) {
  document.getElementById("statusText").textContent = text;
}

function show(id) { document.getElementById(id).classList.remove("hidden"); }
function hide(id) { document.getElementById(id).classList.add("hidden"); }

function formatEuros(n) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(n);
}

function sinistresId() {
  return "SIN-" + new Date().getFullYear() + "-" +
    String(Math.floor(Math.random() * 9000) + 1000);
}

// ── Anthropic API call (direct depuis navigateur) ───────────────────────────
// Endpoint du proxy local (server.py) — évite le blocage CORS navigateur
const PROXY_URL = "/api/anthropic";

async function callClaude({ apiKey, system, userMsg }) {
  const response = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${response.status}`;
    const error = new Error(msg);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  // Extraire le texte (ignorer les blocs thinking)
  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Pas de réponse texte reçue de Claude.");
  return textBlock.text;
}

function extractJSON(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                text.match(/(\{[\s\S]*\})/);
  if (!match) throw new Error("Réponse JSON introuvable dans la réponse Claude.");
  return JSON.parse(match[1]);
}

// ── Prompt 1 : Scoring fraude ────────────────────────────────────────────────
const SYSTEM_SCORING = `Tu es un système de scoring fraude pour assureur IARD français.
Tu simules le pipeline Azure ML + règles métier du projet fraud-agent-demo.

RÈGLES DE SCORING (score_regles, 0–50 pts) :
- IP suspecte (ip_count_30d ≥ 3) : +10 à +20 pts selon count
- Réseau réparateur (reparateur_count_90d ≥ 5) : +7 à +20 pts selon count
- Déclaration précoce (jours_depuis_souscription < 30) : +15 pts
- Montant anormal (montant_reclame / montant_plafond > 0.6 ET > 3000 €) : +10 pts

MODÈLE ML (score_ml, 0–50 pts) : estime un score ML réaliste basé sur les features fournies.

ROUTING :
- score_fraude < 30 → "STP" (Straight-Through Processing)
- 30 ≤ score_fraude ≤ 59 → "INVESTIGATION"
- score_fraude ≥ 60 → "ALERTE_SIU"

REASON CODES (3 à 5 items, en français, commençant par un verbe d'action, factuels) :
Exemples : "Détecte 9 sinistres liés au réparateur REP-007 sur 90 jours"
           "Identifie une déclaration le jour même de la souscription"
           "Calcule un montant réclamé anormalement élevé (69 % du plafond)"

Réponds UNIQUEMENT en JSON valide, sans texte autour :
{
  "score_fraude": <0-100>,
  "score_regles": <0-50>,
  "score_ml": <0-50>,
  "categorie_risque": "Faible" | "Moyen" | "Élevé",
  "routing": "STP" | "INVESTIGATION" | "ALERTE_SIU",
  "reason_codes": ["<RC1>", "<RC2>", ...],
  "synthese": "<phrase courte d'explication pour l'investigateur SIU>"
}`;

async function runScoring(apiKey, sinistre) {
  const userMsg = `Analyse ce sinistre et produis le scoring fraude :\n\n${JSON.stringify(sinistre, null, 2)}`;
  const text = await callClaude({ apiKey, system: SYSTEM_SCORING, userMsg });
  return extractJSON(text);
}

// ── Prompt 2 : Analyse rapport de police + recours ───────────────────────────
const SYSTEM_POLICE = `Tu es un assistant juridique spécialisé en droit des assurances français.
Analyse le rapport de police fourni et identifie les éléments de recours en subrogation (art. L121-12 C.ass.).

Produis une analyse structurée avec :
1. Le tiers responsable identifié (nom, compagnie adverse si mentionnée)
2. La part de responsabilité estimée (% entre 0 et 100)
3. Le niveau de certitude (Faible / Moyen / Élevé)
4. Les éléments factuels clés (liste de 2-4 points)
5. La viabilité du recours (true/false)
6. Le montant estimé récupérable = montant_reclame × (part_responsabilite_pct / 100)
7. Le plan d'actions J+5 / J+15 / J+30

Seuil minimum de recours : 500 €. Ne jamais inventer de faits non présents dans le texte.
Réponds UNIQUEMENT en JSON valide :
{
  "responsable": "<nom tiers>",
  "assureur_adverse": "<compagnie ou null>",
  "part_responsabilite_pct": <0-100>,
  "certitude": "Faible" | "Moyen" | "Élevé",
  "elements_factuels": ["<elem1>", "<elem2>"],
  "recours_viable": true | false,
  "montant_recouperable": <nombre>,
  "actions": {
    "j5": "<action>",
    "j15": "<action>",
    "j30": "<action>"
  },
  "synthese_juridique": "<phrase courte>"
}`;

async function runRecours(apiKey, rapportPolice, montantReclame) {
  const userMsg = `Rapport de police :\n\n${rapportPolice}\n\nMontant réclamé : ${montantReclame} €`;
  const text = await callClaude({ apiKey, system: SYSTEM_POLICE, userMsg });
  return extractJSON(text);
}

// ── Affichage du score ────────────────────────────────────────────────────────
function displayScore(scoring) {
  const score = scoring.score_fraude;
  const arc = 188.5;
  const offset = arc - (score / 100) * arc;

  const fillEl = document.getElementById("gaugeFill");
  const color = score < 30 ? "#107c10" : score < 60 ? "#ca5010" : "#d13438";
  fillEl.style.strokeDashoffset = offset;
  fillEl.style.stroke = color;

  document.getElementById("gaugeValue").textContent = score;
  document.getElementById("scoreRegles").textContent = scoring.score_regles ?? "—";
  document.getElementById("scoreMl").textContent = scoring.score_ml ?? "—";
  document.getElementById("categorie").textContent = scoring.categorie_risque ?? "—";

  const routing = scoring.routing;
  let routingLabel = routing;
  if (routing === "STP") routingLabel = "✅ STP";
  else if (routing === "INVESTIGATION") routingLabel = "🔍 Investigation";
  else routingLabel = "🚨 Alerte SIU";
  document.getElementById("routing").textContent = routingLabel;

  const badge = document.getElementById("categoryBadge");
  badge.textContent = "";
  if (routing === "STP") {
    badge.className = "category-badge stp";
    badge.textContent = "✅ Traitement automatique (STP)";
  } else if (routing === "INVESTIGATION") {
    badge.className = "category-badge investigation";
    badge.textContent = "🔍 Investigation SIU requise";
  } else {
    badge.className = "category-badge alerte";
    badge.textContent = "🚨 Alerte SIU — Fraude probable";
  }

  if (routing === "STP") {
    show("stpBanner");
  } else {
    hide("stpBanner");
  }
}

// ── Affichage des reason codes ────────────────────────────────────────────────
const RC_ICONS = {
  Réseau: "🕸️", Identifie: "🔍", Détecte: "📡", Calcule: "📊",
  Trouve: "🔎", Constate: "⚠️", Signal: "🚩", Observe: "👁️",
};

function iconForRC(text) {
  for (const [kw, ico] of Object.entries(RC_ICONS)) {
    if (text.startsWith(kw)) return ico;
  }
  return "⚠️";
}

function displayReasonCodes(codes) {
  const list = document.getElementById("reasonCodesList");
  list.innerHTML = "";
  codes.forEach((rc) => {
    const div = document.createElement("div");
    div.className = "rc-item";
    div.innerHTML = `<div class="rc-icon">${iconForRC(rc)}</div><div class="rc-text">${rc}</div>`;
    list.appendChild(div);
  });
}

// ── Affichage du dossier de recours ──────────────────────────────────────────
function displayRecours(recours, sinistreId) {
  document.getElementById("recoursId").textContent =
    "Dossier " + sinistreId + " · Généré automatiquement";

  document.getElementById("montantRecouperable").textContent =
    formatEuros(recours.montant_recouperable);

  const meta = document.getElementById("recoursMeta");
  meta.innerHTML = `
    <div class="recours-field">
      <div class="rf-label">Tiers responsable</div>
      <div class="rf-value">${recours.responsable ?? "Non identifié"}</div>
    </div>
    <div class="recours-field">
      <div class="rf-label">Assureur adverse</div>
      <div class="rf-value">${recours.assureur_adverse ?? "Non mentionné"}</div>
    </div>
    <div class="recours-field">
      <div class="rf-label">Part de responsabilité</div>
      <div class="rf-value">${recours.part_responsabilite_pct ?? "—"} %</div>
    </div>
    <div class="recours-field">
      <div class="rf-label">Certitude analyse</div>
      <div class="rf-value">
        <span class="certitude-badge ${recours.certitude}">● ${recours.certitude}</span>
      </div>
    </div>
    <div class="recours-field full">
      <div class="rf-label">Éléments factuels clés</div>
      <div class="rf-value" style="font-weight:400;line-height:1.6">
        ${(recours.elements_factuels ?? []).map((e) => `• ${e}`).join("<br/>")}
      </div>
    </div>
    <div class="recours-field full">
      <div class="rf-label">Synthèse juridique</div>
      <div class="rf-value" style="font-weight:400">${recours.synthese_juridique ?? "—"}</div>
    </div>
  `;

  const tl = document.getElementById("timeline");
  const actions = recours.actions ?? {};
  tl.innerHTML = `
    <div class="timeline-item">
      <div class="timeline-dot"></div>
      <div><div class="ti-label">J+5</div><div class="ti-text">${actions.j5 ?? "—"}</div></div>
    </div>
    <div class="timeline-item">
      <div class="timeline-dot"></div>
      <div><div class="ti-label">J+15</div><div class="ti-text">${actions.j15 ?? "—"}</div></div>
    </div>
    <div class="timeline-item">
      <div class="timeline-dot"></div>
      <div><div class="ti-label">J+30</div><div class="ti-text">${actions.j30 ?? "—"}</div></div>
    </div>
  `;
}

// ── Gestion du formulaire ─────────────────────────────────────────────────────
function resetForm() {
  hide("resultScoring");
  hide("resultReasonCodes");
  hide("resultRecours");
  hide("statusBar");
  ["step-scoring", "step-synapse", "step-police", "step-recours"].forEach((s) =>
    setStep(s, "")
  );
  document.getElementById("submitBtn").disabled = false;
  document.getElementById("submitIcon").textContent = "▶";
  document.getElementById("submitLabel").textContent = "Analyser ce sinistre";
  hide("errorBanner");
}

function showError(msg) {
  const banner = document.getElementById("errorBanner");
  document.getElementById("errorText").textContent = msg;
  banner.classList.remove("hidden");
  show("resultScoring");
}

document.getElementById("sinistreForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const apiKey = serverKeyConfigured
    ? ""
    : document.getElementById("apiKey").value.trim();

  if (!serverKeyConfigured && (!apiKey || !apiKey.startsWith("sk-ant-"))) {
    alert("Veuillez saisir une clé Anthropic API valide (sk-ant-…)");
    return;
  }

  // Récupérer les valeurs du formulaire
  const dateDecl = new Date(document.getElementById("date_declaration").value);
  const dateSousc = new Date(document.getElementById("date_souscription").value);
  const daysSinceSouscription = Math.round((dateDecl - dateSousc) / 86400000);

  const sinistre = {
    id_sinistre: sinistresId(),
    id_police: document.getElementById("id_police").value,
    type_sinistre: document.getElementById("type_sinistre").value,
    montant_reclame: Number(document.getElementById("montant_reclame").value),
    montant_plafond: Number(document.getElementById("montant_plafond").value),
    franchise: Number(document.getElementById("franchise").value),
    date_declaration: document.getElementById("date_declaration").value,
    date_souscription: document.getElementById("date_souscription").value,
    jours_depuis_souscription: daysSinceSouscription,
    id_reparateur: document.getElementById("id_reparateur").value || null,
    _reparateur_count_90d: Number(document.getElementById("reparateur_count_90d").value),
    _ip_count_30d: Number(document.getElementById("ip_count_30d").value),
  };
  const rapportPolice = document.getElementById("rapport_police").value.trim();

  // UI : désactiver le bouton, afficher spinner
  document.getElementById("submitBtn").disabled = true;
  document.getElementById("submitIcon").innerHTML = '<span class="spinner"></span>';
  document.getElementById("submitLabel").textContent = "Analyse en cours…";
  show("statusBar");
  hide("resultScoring");
  hide("resultReasonCodes");
  hide("resultRecours");

  try {
    // ── Étape 1 : Scoring ──
    setStep("step-scoring", "active");
    setStatus("Azure ML — Calcul du score fraude…");
    const scoring = await runScoring(apiKey, sinistre);
    setStep("step-scoring", "done");

    show("resultScoring");
    displayScore(scoring);

    // ── Étape 2 : Synapse (simulé visuellement) ──
    if (scoring.routing !== "STP") {
      setStep("step-synapse", "active");
      setStatus("Azure Synapse — Analyse réseau inter-dossiers…");
      await new Promise((r) => setTimeout(r, 800)); // simulation latence Synapse
      setStep("step-synapse", "done");

      if (scoring.reason_codes && scoring.reason_codes.length) {
        show("resultReasonCodes");
        displayReasonCodes(scoring.reason_codes);
      }
    } else {
      setStep("step-synapse", "skipped");
      setStep("step-police", "skipped");
      setStep("step-recours", "skipped");
    }

    // ── Étape 3 & 4 : Rapport police + Recours ──
    if (scoring.routing !== "STP" && rapportPolice) {
      setStep("step-police", "active");
      setStatus("Azure OpenAI — Analyse sémantique du rapport de police…");
      const recours = await runRecours(apiKey, rapportPolice, sinistre.montant_reclame);
      setStep("step-police", "done");

      if (recours.recours_viable) {
        setStep("step-recours", "active");
        setStatus("Power Automate — Génération du dossier de recours…");
        await new Promise((r) => setTimeout(r, 600)); // simulation envoi email
        setStep("step-recours", "done");

        show("resultRecours");
        displayRecours(recours, sinistre.id_sinistre);
      } else {
        setStep("step-recours", "skipped");
      }
    } else if (scoring.routing !== "STP") {
      setStep("step-police", "skipped");
      setStep("step-recours", "skipped");
    }

    setStatus("Analyse terminée.");
    hide("statusBar");
  } catch (err) {
    setStep("step-scoring", "");
    const prefix = err.status === 429 ? "⏱️" : "⚠️";
    showError(`${prefix} ${err.message}`);
    hide("statusBar");
  } finally {
    document.getElementById("submitBtn").disabled = false;
    document.getElementById("submitIcon").textContent = "▶";
    document.getElementById("submitLabel").textContent = "Analyser ce sinistre";
  }
});
