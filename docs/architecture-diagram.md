# Architecture — Agent IA Détecteur de Fraude & Recours Automatique
*fraud-agent-demo | Sébastien Donné — tkoidra.com | juin 2026*

> Ce fichier contient **4 diagrammes Mermaid** couvrant des vues complémentaires du pipeline, plus un schéma ASCII de référence rapide. Rendu natif sur GitHub, GitLab, Notion, et tout éditeur Mermaid.

---

## Diagramme 1 — Pipeline complet (vue décisionnaire)

> Vue principale destinée aux DSI et Responsables Fraude. Montre les 5 agents, les flux de données, les branchements conditionnels et les systèmes de stockage/visualisation.

```mermaid
flowchart TD
    %% ── Entrée ──────────────────────────────────────────────
    SIN(["📋 Sinistre entrant\nTeams · Portail web · Formulaire"])

    %% ── Agent 1 — Copilot Studio ────────────────────────────
    subgraph AG1["🤖  Agent 1 · Copilot Studio  —  Orchestrateur"]
        direction TB
        A1_SAISIE["Saisie interactive\npolicetypedate montant réparateur"]
        A1_ENRICH["Enrichissement pré-scoring\n_reparateur_count_90d ← Dataverse 90j\n_ip_count_30d ← Dataverse 30j"]
        A1_SAISIE --> A1_ENRICH
    end

    %% ── Agent 2 — Azure ML ──────────────────────────────────
    subgraph AG2["⚙️  Agent 2 · Azure ML  —  Scoring Fraude"]
        direction TB
        A2_MODEL["score_single(sinistre, police)\nRégression logistique + Règles métier"]
        A2_OUT["score_fraude 0–100\nscore_ml 0–50 · score_regles 0–50\nReason Codes explicables"]
        A2_MODEL --> A2_OUT
    end

    %% ── Routing ─────────────────────────────────────────────
    ROUTE{{"Score fraude ?"}}

    STP["✅ STP automatique\nCircuit standard · 5j ouvrés\n72 % des dossiers"]

    %% ── Agent 3 — Synapse ───────────────────────────────────
    subgraph AG3["🔗  Agent 3 · Azure Synapse  —  Analyse de Réseau"]
        direction TB
        A3_SQL["graph-query.sql\n7 patterns détectés"]
        A3_P1["P1 · Réseau réparateur 90j\nP2 · Anneau IP 30j\nP3 · Multi-sinistres 12m"]
        A3_VIEWS["vw_graph_alerts\nvw_centralite_noeuds\nvw_composantes_connexes"]
        A3_SQL --> A3_P1 --> A3_VIEWS
    end

    %% ── Agent 4 — Azure OpenAI ──────────────────────────────
    subgraph AG4["🧠  Agent 4 · Azure OpenAI GPT-4o  —  Analyse Sémantique"]
        direction TB
        A4_RAPPORT["analyse-rapport-police.md\nResponsable · % responsabilité\nÉléments clés recours · Certitude"]
        A4_TIERS["identification-tiers.md\nViabilité recours · Fondement L121-12\nMontant récupérable · Actions J+5/15/30"]
        A4_RAPPORT --> A4_TIERS
    end

    %% ── Branchement recours ─────────────────────────────────
    RECOURS{{"Recours viable\nET montant ≥ 500 € ?"}}

    FRAUDE["🚨 Alerte SIU\nDashboard Power BI\nReason Codes · Confirmation manuelle"]

    %% ── Agent 5 — Power Automate ────────────────────────────
    subgraph AG5["📧  Agent 5 · Power Automate  —  Recours Automatique"]
        direction TB
        A5_KV["Clé AOAI ← Azure Key Vault\n(Managed Identity)"]
        A5_LETTRE["Lettre mise en demeure\nGPT-4o · temp 0.2"]
        A5_EMAIL["Email → Service Juridique\nCC: SIU · Priorité selon urgence"]
        A5_KV --> A5_LETTRE --> A5_EMAIL
    end

    %% ── Stockage central ────────────────────────────────────
    DV[("🗄️ Microsoft Dataverse\ncr_sinistres · cr_polices\ncr_dossiers_recours")]

    %% ── Visualisation ───────────────────────────────────────
    PBI["📊 Power BI Dashboard SIU\n6 pages · 40 mesures DAX\nRLS 3 rôles · Alertes auto"]

    %% ── Sécurité transversale ───────────────────────────────
    AAD(["🔐 Azure AD / Entra ID\nSSO · Rôles assure · agent_siu · admin"])
    KV(["🔑 Azure Key Vault\nManaged Identity · Rotation auto"])

    %% ── Flux principaux ─────────────────────────────────────
    SIN --> AG1
    AG1 <-->|"GET police\nGET counts 90j/30j"| DV
    AG1 --> AG2
    AG2 --> ROUTE

    ROUTE -->|"score < 30\n72 %"| STP
    ROUTE -->|"score 30–59\n26 %"| AG3
    ROUTE -->|"score ≥ 60\n2 %"| AG3

    STP -->|"CREATE sinistre"| DV

    AG3 -->|"score ≥ 30"| AG4
    AG3 --> DV

    AG4 --> RECOURS
    AG4 --> FRAUDE

    RECOURS -->|"Non → statut\nrecours_non_viable"| DV
    RECOURS -->|"Oui"| AG5

    AG5 -->|"CREATE cr_dossiers_recours\nUPDATE cr_sinistres"| DV
    AG5 --> FRAUDE

    DV --> PBI
    DV -->|"cr_analyse_rapport_json\ncr_identification_tiers_json"| AG5

    AAD -.->|"Auth SSO"| AG1
    AAD -.->|"Auth SSO"| PBI
    KV -.->|"aoai-api-key"| AG5

    %% ── Styles ──────────────────────────────────────────────
    classDef agent    fill:#0078d4,color:#fff,stroke:#004578,stroke-width:2px
    classDef storage  fill:#004578,color:#fff,stroke:#002050,stroke-width:2px
    classDef visu     fill:#f2c811,color:#1a1a1a,stroke:#c09a00,stroke-width:2px
    classDef security fill:#d13438,color:#fff,stroke:#a00,stroke-width:2px
    classDef route    fill:#f8f9fa,color:#1a1a1a,stroke:#767676,stroke-width:1px
    classDef endpoint fill:#107c10,color:#fff,stroke:#004b00,stroke-width:2px

    class AG1,AG2,AG3,AG4,AG5 agent
    class DV storage
    class PBI visu
    class AAD,KV security
    class ROUTE,RECOURS route
    class STP,FRAUDE endpoint
```

---

## Diagramme 2 — Flux de données détaillé (vue technique)

> Vue pour les Directeurs Techniques. Montre précisément quelles données transitent entre chaque agent, avec les noms de champs réels et les formats.

```mermaid
flowchart LR
    %% ── Entrée ──────────────────────────────────────────────
    subgraph INPUT["Données entrantes"]
        D_SIN["sinistre\nid_sinistre · id_police\ntype · date · montant\nid_reparateur · adresse_ip"]
        D_POL["police\ndate_souscription\nfranchise · plafond_garantie\ntype_contrat"]
    end

    %% ── Enrichissement Dataverse ────────────────────────────
    subgraph ENRICH["Enrichissement Dataverse (avant scoring)"]
        E1["_reparateur_count_90d\nCOUNT sinistres\nmême id_reparateur / 90j"]
        E2["_ip_count_30d\nCOUNT sinistres\nmême adresse_ip / 30j"]
    end

    %% ── Payload score_single ────────────────────────────────
    subgraph PAYLOAD["Payload score_single — 14 champs"]
        P_SIN["sinistre dict\nid · police · type · date\nmontant · reparateur · ip\n_reparateur_count_90d\n_ip_count_30d"]
        P_POL["police dict\nid · date_souscription\nfranchise · plafond\ntype_contrat"]
    end

    %% ── Sortie Azure ML ─────────────────────────────────────
    subgraph ML_OUT["Sortie score_single — 5 champs"]
        O1["score_fraude 0–100"]
        O2["score_ml 0–50\nproba × 50"]
        O3["score_regles 0–50\nRègles IP+Rép+Précoce+Montant"]
        O4["categorie_risque\nFaible · Moyen · Élevé"]
        O5["reason_codes list\ntexte naturel FR"]
    end

    %% ── Features ML ────────────────────────────────────────
    subgraph FEATURES["11 features ML"]
        F1["days_since_subscription"]
        F2["montant_sur_plafond"]
        F3["montant_zscore"]
        F4["declaration_weekday"]
        F5["type_encoded"]
        F6["reparateur_count_90d"]
        F7["ip_count_30d"]
        F8["ip_suspicious bool"]
        F9["reparateur_suspicious bool"]
        F10["precoce_flag bool"]
        F11["franchise"]
    end

    %% ── Sortie Synapse ──────────────────────────────────────
    subgraph SYN_OUT["Vues Synapse — sorties"]
        S1["vw_graph_alerts\nid_sinistre · pattern_type\ndescription · score_lien"]
        S2["vw_centralite_noeuds\ntype_noeud · id_noeud\ndegree_centralite"]
        S3["vw_composantes_connexes\ncomposante_id · taille\nsinistres_membres"]
    end

    %% ── Sortie OpenAI ───────────────────────────────────────
    subgraph OAI_OUT["Sorties Azure OpenAI — 2 JSON"]
        A1["analyse_rapport\nreference_rapport\nparties_responsables\npart_responsabilite_pct\nelements_cles_recours\nrecours_possible\nniveau_certitude"]
        A2["identification_tiers\nrecours_viable\nfondement_juridique\nmontant_estimé_récuperable\nactions_prioritaires J+5/15/30\npriorite_recours"]
    end

    %% ── Dataverse — champs écrits ───────────────────────────
    subgraph DV_WRITE["Dataverse — champs écrits"]
        DW1["cr_sinistres\nscore_fraude · score_ml · score_regles\ncategorie_risque · reason_codes\nstatut · recours_possible\nanalyse_rapport_json\nidentification_tiers_json"]
        DW2["cr_dossiers_recours\nref_recours · tiers_nom · immat\nmontant_recuperable\nfondement_type · lettre_recours\nactions_json · date_prescription"]
    end

    %% ── Flux ────────────────────────────────────────────────
    D_SIN & D_POL --> ENRICH
    ENRICH --> PAYLOAD
    PAYLOAD --> FEATURES
    FEATURES --> ML_OUT
    ML_OUT --> SYN_OUT
    SYN_OUT --> OAI_OUT
    OAI_OUT --> A1 & A2
    A1 & A2 --> DW1
    A2 --> DW2
    DW2 -->|"cr_lettre_recours\ncr_actions_json"| EMAIL(["📧 Email juridique\nCC: SIU"])

    %% ── Styles ──────────────────────────────────────────────
    classDef group  fill:#f3f6fb,stroke:#0078d4,color:#1a1a1a
    classDef output fill:#107c10,color:#fff,stroke:#004b00
    class ML_OUT,SYN_OUT,OAI_OUT,DV_WRITE group
    class EMAIL output
```

---

## Diagramme 3 — Séquence temporelle (vue opérationnelle)

> Montre la chronologie précise d'un dossier à risque élevé, de la déclaration à l'email de recours. Utile pour la présentation des KPIs de délai.

```mermaid
sequenceDiagram
    actor Assuré
    participant CS  as Agent 1<br/>Copilot Studio
    participant DV  as Dataverse
    participant AML as Agent 2<br/>Azure ML
    participant SYN as Agent 3<br/>Synapse
    participant OAI as Agent 4<br/>Azure OpenAI
    participant PA  as Agent 5<br/>Power Automate
    participant SIU as Équipe SIU
    participant JUR as Service Juridique

    Note over Assuré,JUR: ⏱ T+0 — Déclaration du sinistre

    Assuré->>CS: Déclare sinistre via Teams / portail
    CS->>CS: Saisie interactive<br/>(police, type, montant, date, réparateur)
    CS->>DV: GET police (franchise, plafond, date_souscription)
    DV-->>CS: Données police
    CS->>DV: COUNT sinistres même réparateur / 90j
    CS->>DV: COUNT sinistres même IP / 30j
    DV-->>CS: _reparateur_count_90d, _ip_count_30d

    Note over CS,AML: ⏱ T+15s — Scoring temps réel

    CS->>AML: score_single(sinistre + police + enrichissement)
    AML->>AML: Compute 11 features<br/>Régression logistique + Règles métier
    AML-->>CS: score_fraude=63 · categorie=Élevé<br/>reason_codes=[déclaration précoce 10j]
    CS->>DV: CREATE cr_sinistres (score, statut=analyse_complete)
    CS->>Assuré: Confirmation dossier (message neutre)

    Note over CS,SIU: ⏱ T+30s — Escalade SIU (score ≥ 60)

    CS->>SIU: 🚨 Notification Teams<br/>Score 63 · Reason codes · Lien Power BI
    CS-->>SYN: Déclenche analyse réseau (asynchrone)
    CS-->>OAI: Déclenche analyse rapport police (asynchrone)

    Note over SYN: ⏱ T+1–2 min — Analyse réseau

    SYN->>DV: Lecture portefeuille sinistres 90j
    DV-->>SYN: Historique complet
    SYN->>SYN: CTEs P1–P7<br/>Patterns réseau réparateur, IP, multi-sinistres
    SYN->>DV: UPDATE vw_graph_alerts (9 sinistres REP-007)

    Note over OAI: ⏱ T+2–3 min — Analyse sémantique

    OAI->>DV: GET rapport_police (RAPPORT-0012)
    DV-->>OAI: Texte PV de police
    OAI->>OAI: analyse-rapport-police.md<br/>Responsable: Bensalem DT-456-AB · 100%
    OAI->>OAI: identification-tiers.md<br/>Recours viable · 5 652 € · Priorité Normale
    OAI->>DV: UPDATE cr_sinistres<br/>(analyse_rapport_json, identification_tiers_json, recours_possible=true)

    Note over PA,JUR: ⏱ T+3–5 min — Génération dossier recours

    PA->>DV: Lecture sinistre (trigger recours_possible=true)
    DV-->>PA: Sinistre + JSONs Agent 4
    PA->>PA: Récupère clé AOAI ← Key Vault (Managed Identity)
    PA->>OAI: Rédiger lettre mise en demeure (GPT-4o)
    OAI-->>PA: Lettre formelle art. L121-12 C.ass.
    PA->>DV: CREATE cr_dossiers_recours (REC-2026-XXXXXX)
    PA->>DV: UPDATE cr_sinistres (statut=recours_initie)
    PA->>JUR: 📧 Email HTML · [RECOURS NORMALE] REC-2026-XXXXXX<br/>5 652 € à récupérer · Actions J+5/15/30
    PA->>SIU: CC email recours

    Note over SIU: ⏱ T+5 min — Dashboard Power BI mis à jour

    SIU->>SIU: 📊 Power BI refreshed<br/>Score · Reason codes · Réseau REP-007<br/>Dossier recours initié

    Note over Assuré,JUR: ✅ Durée totale : < 10 minutes<br/>vs. 2–3 semaines en traitement manuel
```

---

## Diagramme 4 — Infrastructure Azure (vue DSI)

> Vue des services Azure utilisés, leurs interconnexions et les contrôles de sécurité. Destinée aux DSI et architectes cloud.

```mermaid
flowchart TB
    %% ── Entrée utilisateurs ─────────────────────────────────
    subgraph USERS["👥 Utilisateurs"]
        U_ASSURE["Assuré\nTeams / Portail"]
        U_SIU["Agent SIU\nTeams / Power BI"]
        U_JUR["Service Juridique\nOutlook"]
    end

    %% ── Sécurité ────────────────────────────────────────────
    subgraph SEC["🔐 Sécurité — Azure AD / Entra ID"]
        AAD["Entra ID\nSSO · Rôles · MFA"]
        KV["Key Vault\naoai-api-key\nManaged Identity"]
    end

    %% ── Power Platform ──────────────────────────────────────
    subgraph PP["⚡ Microsoft Power Platform"]
        CS["Copilot Studio\nAgent 1 Orchestrateur\nCanaux : Teams · DirectLine"]
        PA["Power Automate\nAgent 5 Recours\nflow-recours.json"]
        PBI["Power BI Premium\nDashboard SIU\n6 pages · RLS · Alertes"]
        DV[("Dataverse\ncr_sinistres\ncr_polices\ncr_dossiers_recours")]
        CS <--> DV
        PA <--> DV
        PBI <--> DV
    end

    %% ── Azure AI + Data ─────────────────────────────────────
    subgraph AZAI["☁️ Azure AI + Data — France Central"]
        AML["Azure ML\nManaged Endpoint\nscoring-model.py\nfraud-scoring-v1"]
        OAI["Azure OpenAI\ngpt-4o-2024-11-20\nTempérature 0.1–0.2"]
        SYN["Azure Synapse\nDedicated SQL Pool\ngraph-query.sql"]
        AFSC["Azure Storage\nModel Artifacts\nfraud_pipeline.joblib"]
        AML --> AFSC
    end

    %% ── Communication ───────────────────────────────────────
    subgraph COMM["📬 Communication"]
        TEAMS["Microsoft Teams\nCanal SIU Alertes\nAdaptive Cards"]
        O365["Office 365 Outlook\nEmail juridique HTML"]
    end

    %% ── Flux utilisateurs ───────────────────────────────────
    U_ASSURE -->|"HTTPS / Teams"| CS
    U_SIU -->|"HTTPS"| PBI
    U_SIU -->|"Teams"| TEAMS
    U_JUR -->|"Email"| O365

    %% ── Flux authentification ───────────────────────────────
    AAD -.->|"OAuth 2.0 SSO"| CS
    AAD -.->|"OAuth 2.0 SSO"| PBI
    AAD -.->|"OAuth 2.0 SSO"| SYN
    KV -.->|"GET aoai-api-key\nManaged Identity"| PA

    %% ── Flux agents ─────────────────────────────────────────
    CS -->|"POST /score\nAzure ML endpoint"| AML
    CS -->|"Trigger async"| SYN
    CS -->|"Trigger async"| OAI
    OAI -->|"Prompt analyse rapport"| OAI
    PA -->|"POST chat/completions\nGPT-4o"| OAI
    SYN -->|"DirectQuery"| PBI

    %% ── Flux notifications ──────────────────────────────────
    CS -->|"Adaptive Card\nscore + reason codes"| TEAMS
    PA -->|"SendEmailV2\nHTML dossier recours"| O365

    %% ── Styles ──────────────────────────────────────────────
    classDef msblue   fill:#0078d4,color:#fff,stroke:#004578,stroke-width:2px
    classDef purple   fill:#742774,color:#fff,stroke:#4a0048,stroke-width:2px
    classDef green    fill:#107c10,color:#fff,stroke:#004b00,stroke-width:2px
    classDef yellow   fill:#f2c811,color:#1a1a1a,stroke:#c09a00,stroke-width:2px
    classDef red      fill:#d13438,color:#fff,stroke:#a00,stroke-width:2px
    classDef teal     fill:#008575,color:#fff,stroke:#005a4e,stroke-width:2px
    classDef storage  fill:#004578,color:#fff,stroke:#002050,stroke-width:2px
    classDef neutral  fill:#f8f9fa,color:#1a1a1a,stroke:#dee2e6,stroke-width:1px

    class CS,PA msblue
    class PBI yellow
    class DV storage
    class AML purple
    class OAI green
    class SYN teal
    class AAD,KV red
    class TEAMS,O365,AFSC neutral
```

---

## Schéma ASCII — Référence rapide

> Version texte pour les contextes sans rendu Mermaid (email, terminal, documentation PDF).

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║          PIPELINE AGENT IA — DÉTECTION FRAUDE & RECOURS AUTOMATIQUE            ║
║                     fraud-agent-demo | tkoidra.com | 2026                      ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  CANAL D'ENTRÉE                           SÉCURITÉ TRANSVERSALE
  ┌──────────────────┐                     ┌──────────────────────┐
  │ Teams · Portail  │                     │  Azure AD / Entra ID │
  │ Formulaire web   │                     │  SSO · Rôles · MFA   │
  └────────┬─────────┘                     └──────────────────────┘
           │                               ┌──────────────────────┐
           ▼                               │  Azure Key Vault     │
  ┌─────────────────────────────────┐      │  Managed Identity    │
  │   AGENT 1 · COPILOT STUDIO      │      └──────────────────────┘
  │   Orchestrateur                 │
  │  ┌──────────────────────────┐   │◄────► DATAVERSE (cr_polices)
  │  │ Saisie interactive       │   │       GET franchise · plafond
  │  │ police · type · montant  │   │       date_souscription
  │  │ date · réparateur        │   │
  │  └──────────────────────────┘   │◄────► DATAVERSE (cr_sinistres)
  │  ┌──────────────────────────┐   │       COUNT réparateur / 90j
  │  │ Enrichissement           │   │       COUNT IP / 30j
  │  │ _reparateur_count_90d    │   │       → _reparateur_count_90d
  │  │ _ip_count_30d            │   │       → _ip_count_30d
  │  └──────────────────────────┘   │
  └───────────────┬─────────────────┘
                  │  Payload : sinistre (9 champs) + police (5 champs)
                  ▼
  ┌─────────────────────────────────┐
  │   AGENT 2 · AZURE ML            │
  │   Scoring Fraude                │
  │  ┌──────────────────────────┐   │
  │  │ 11 features calculées    │   │
  │  │ Régression logistique    │   │
  │  │ + Règles métier (4)      │   │
  │  └──────────────────────────┘   │
  │  Sortie : score_fraude 0–100    │
  │           score_ml + regles     │
  │           categorie_risque      │
  │           reason_codes (FR)     │
  └───────────────┬─────────────────┘
                  │
        ┌─────────┴──────────┐
        │   Routing          │
        │   Score fraude ?   │
        └──┬──────────┬──────┘
           │          │          │
         < 30       30–59      ≥ 60
         72%        26%         2%
           │          │          │
           ▼          ▼          ▼
  ┌──────────┐  ┌─────────────────────────────────┐
  │   STP    │  │   AGENT 3 · AZURE SYNAPSE        │
  │ Standard │  │   Analyse de Graphe              │
  │ 5j ouvrés│  │  ┌──────────────────────────┐   │
  └────┬─────┘  │  │ graph-query.sql — 7 CTEs │   │
       │        │  │ P1 Réseau réparateur 90j  │   │
       │        │  │ P2 Anneau IP 30j          │   │
       │        │  │ P3 Multi-sinistres 12m    │   │
       │        │  │ P4 Liens croisés          │   │
       │        │  │ P5 Centralité réseau      │   │
       │        │  │ P6 Composantes connexes   │   │
       │        │  │ P7 Rafales temporelles    │   │
       │        │  └──────────────────────────┘   │
       │        │  Vues : vw_graph_alerts          │
       │        │         vw_centralite_noeuds     │◄──► POWER BI
       │        │         vw_composantes_connexes  │     DirectQuery
       │        └─────────────┬───────────────────┘
       │                      │
       │                      ▼
       │        ┌─────────────────────────────────┐
       │        │   AGENT 4 · AZURE OPENAI GPT-4o  │
       │        │   Analyse Sémantique             │
       │        │  ┌──────────────────────────┐   │
       │        │  │ analyse-rapport-police.md │   │◄── DATAVERSE
       │        │  │ → Responsable identifié   │   │    rapport_police
       │        │  │ → % responsabilité        │   │    (texte PV)
       │        │  │ → Éléments recours        │   │
       │        │  │ → Certitude Élevé         │   │
       │        │  └──────────────────────────┘   │
       │        │  ┌──────────────────────────┐   │
       │        │  │ identification-tiers.md   │   │
       │        │  │ → Recours viable : oui    │   │
       │        │  │ → L121-12 C.ass.          │   │
       │        │  │ → Montant récupérable €   │   │
       │        │  │ → Actions J+5 / J+15 / J+30│  │
       │        │  └──────────────────────────┘   │
       │        └─────────────┬───────────────────┘
       │                      │
       │              ┌───────┴────────┐
       │              │ Recours viable │
       │              │ ET montant     │
       │              │ ≥ 500 € ?      │
       │              └───┬────────┬───┘
       │                  │        │
       │                 OUI      NON
       │                  │        │
       │                  ▼        ▼
       │  ┌───────────────────┐  ┌──────────────────┐
       │  │  AGENT 5          │  │  Alerte SIU      │
       │  │  POWER AUTOMATE   │  │  Power BI        │
       │  │  Recours auto     │  │  Reason Codes    │
       │  │ ┌───────────────┐ │  │  Confirmation    │
       │  │ │Key Vault      │ │  │  manuelle        │
       │  │ │→ aoai-api-key │ │  └──────────────────┘
       │  │ └───────────────┘ │
       │  │ ┌───────────────┐ │
       │  │ │GPT-4o         │ │
       │  │ │Lettre formelle│ │
       │  │ │art. L121-12   │ │
       │  │ └───────────────┘ │
       │  │ ┌───────────────┐ │
       │  │ │Email HTML     │ │──► Service Juridique
       │  │ │→ Juridique    │ │    CC: SIU
       │  │ │→ SIU (CC)     │ │    Importance: High
       │  │ └───────────────┘ │    si Urgente
       │  └────────┬──────────┘
       │           │
       ▼           ▼
  ┌─────────────────────────────────────────────────┐
  │            MICROSOFT DATAVERSE                   │
  │   cr_sinistres    cr_polices    cr_dossiers_     │
  │   score_fraude    franchise     recours          │
  │   reason_codes    plafond       ref_recours      │
  │   statut          date_souscr.  montant_recup.   │
  │   recours_possible             lettre_recours    │
  └─────────────────────────────────────────────────┘
                        │
                        ▼
  ┌─────────────────────────────────────────────────┐
  │           POWER BI — DASHBOARD SIU               │
  │  Page 1 Vue d'ensemble    Page 4 Détail dossier  │
  │  Page 2 Alertes Fraude    Page 5 Dossiers recours│
  │  Page 3 Analyse Réseau    Page 6 Superviseur ⚿  │
  │                                                   │
  │  40 mesures DAX · 3 rôles RLS · 3 alertes auto  │
  │  DirectQuery Synapse + Import Dataverse 15 min   │
  └─────────────────────────────────────────────────┘

  LÉGENDE
  ──────────────────────────────────────────────────
  ─────►  Flux de données principal
  ◄────►  Lecture/écriture bidirectionnelle
  - - ->  Flux de sécurité (auth / secrets)
  ⚿       Accès restreint par rôle (RLS)
```

---

## Métriques clés du pipeline

| Agent | Latence P95 | Mode | Déclencheur |
|---|---|---|---|
| Agent 1 — Copilot Studio | ~15 s (saisie) | Synchrone | Canal Teams / DirectLine |
| Agent 2 — Azure ML | ~800 ms | Synchrone | Appel API depuis Agent 1 |
| Agent 3 — Azure Synapse | ~5–30 s | **Asynchrone** | Power Automate (score ≥ 30) |
| Agent 4 — Azure OpenAI | ~3–8 s | **Asynchrone** | Power Automate (score ≥ 60) |
| Agent 5 — Power Automate | ~10–15 s | **Asynchrone** | Dataverse trigger (recours_possible=true) |
| **Total T0 → Email juridique** | **< 10 min** | — | vs. 2–3 semaines manuel |

| Catégorie | Dossiers | Volume | Traitement |
|---|---|---|---|
| Faible (score < 30) | 72 % | STP automatique | Aucune intervention humaine |
| Moyen (30–59) | 26 % | Investigation | Contrôle documentaire léger + Synapse |
| Élevé (≥ 60) | 2 % | Alerte SIU | Pipeline complet 5 agents |

---

*Diagrammes générés en Mermaid — rendus natifs sur GitHub, GitLab, Notion, VS Code (extension Mermaid Preview)*
*Pour export PNG : `mmdc -i architecture-diagram.md -o architecture-diagram.png` (mermaid-cli)*
