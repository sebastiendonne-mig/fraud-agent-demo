# Spécification — Dashboard Power BI Investigateurs SIU
*Version 1.0 — juin 2026 | fraud-agent-demo*

> **Note d'implémentation :** Les fichiers `.pbix` étant des archives binaires non générables programmatiquement, ce fichier constitue la spécification complète permettant de reconstruire le dashboard dans Power BI Desktop. Chaque section correspond à un onglet ou une configuration du rapport.

---

## 1. Architecture des données

### 1.1 Sources de données

| Source | Technologie | Mode | Périmètre |
|---|---|---|---|
| `vw_graph_alerts` | Azure Synapse Dedicated Pool | DirectQuery | Alertes réseau inter-dossiers (patterns P1–P7) |
| `vw_centralite_noeuds` | Azure Synapse Dedicated Pool | DirectQuery | Acteurs centraux des réseaux suspects |
| `vw_composantes_connexes` | Azure Synapse Dedicated Pool | DirectQuery | Clusters de dossiers connectés |
| `cr_sinistres` | Microsoft Dataverse | Import (refresh 15 min) | Dossiers sinistres avec scores, statuts, reason codes |
| `cr_polices` | Microsoft Dataverse | Import (refresh 15 min) | Contrats associés (franchise, plafond) |
| `cr_dossiers_recours` | Microsoft Dataverse | Import (refresh 15 min) | Dossiers de subrogation générés par Agent 5 |
| `DimDate` | Calculée (DAX) | Import | Table de dates pour time intelligence |

### 1.2 Paramètres de connexion (Power BI Parameters)

```
Paramètre : SynapseServer
Valeur par défaut : synapse-fraude-demo.sql.azuresynapse.net
Type : Text

Paramètre : SynapseDatabase
Valeur par défaut : fraude_demo_db
Type : Text

Paramètre : DataverseOrg
Valeur par défaut : https://orgXXXXXXXX.crm.dynamics.com
Type : Text
```

Authentification Synapse : **Azure Active Directory (SSO)** — jamais de credentials hardcodés.

### 1.3 Requêtes Power Query (M)

**Table `sinistres`** — depuis Dataverse, nettoyage et typage :
```m
let
    Source = CommonDataService.Database(DataverseOrg),
    cr_sinistres = Source{[Schema="dbo", Item="cr_sinistres"]}[Data],
    #"Types corrigés" = Table.TransformColumnTypes(cr_sinistres, {
        {"cr_date_declaration", type date},
        {"cr_score_fraude", Int64.Type},
        {"cr_score_ml", Int64.Type},
        {"cr_score_regles", Int64.Type},
        {"cr_montant_reclame", Int64.Type}
    }),
    #"Colonne catégorie" = Table.AddColumn(#"Types corrigés", "categorie_risque",
        each if [cr_score_fraude] >= 60 then "Élevé"
             else if [cr_score_fraude] >= 30 then "Moyen"
             else "Faible"),
    #"Colonnes renommées" = Table.RenameColumns(#"Colonne catégorie", {
        {"cr_id_sinistre", "id_sinistre"},
        {"cr_id_police", "id_police"},
        {"cr_id_assure", "id_assure"},
        {"cr_date_declaration", "date_declaration"},
        {"cr_type", "type_sinistre"},
        {"cr_montant_reclame", "montant_reclame"},
        {"cr_score_fraude", "score_fraude"},
        {"cr_score_ml", "score_ml"},
        {"cr_score_regles", "score_regles"},
        {"cr_statut", "statut"},
        {"cr_reason_codes", "reason_codes_json"},
        {"cr_recours_possible", "recours_possible"},
        {"cr_ref_recours", "ref_recours"},
        {"cr_id_reparateur", "id_reparateur"},
        {"cr_adresse_ip_declaration", "adresse_ip"},
        {"cr_flag_fraude_suspect", "flag_fraude_suspect"}
    })
in
    #"Colonnes renommées"
```

**Table `graph_alerts`** — depuis Synapse DirectQuery :
```m
let
    Source = Sql.Database(SynapseServer, SynapseDatabase),
    vw_graph_alerts = Source{[Schema="dbo", Item="vw_graph_alerts"]}[Data]
in
    vw_graph_alerts
```

**Table `DimDate`** — calculée :
```m
let
    StartDate = #date(2024, 1, 1),
    EndDate = Date.From(DateTime.LocalNow()),
    NbJours = Duration.Days(EndDate - StartDate) + 1,
    Dates = List.Dates(StartDate, NbJours, #duration(1, 0, 0, 0)),
    Table = Table.FromList(Dates, Splitter.SplitByNothing(), {"Date"}),
    #"Typage" = Table.TransformColumnTypes(Table, {{"Date", type date}}),
    #"Année" = Table.AddColumn(#"Typage", "Année", each Date.Year([Date])),
    #"Mois" = Table.AddColumn(#"Année", "Mois", each Date.Month([Date])),
    #"NomMois" = Table.AddColumn(#"Mois", "Nom Mois", each Date.ToText([Date], "MMMM", "fr-FR")),
    #"Semaine" = Table.AddColumn(#"NomMois", "Semaine ISO", each Date.WeekOfYear([Date])),
    #"Trimestre" = Table.AddColumn(#"Semaine", "Trimestre", each "T" & Text.From(Date.QuarterOfYear([Date])))
in
    #"Trimestre"
```

---

## 2. Modèle de données (schéma en étoile)

```
                    ┌──────────────┐
                    │   DimDate    │
                    │  (date)      │
                    └──────┬───────┘
                           │ 1:N (date_declaration)
          ┌────────────────┼────────────────┐
          │                │                │
  ┌───────▼──────┐  ┌──────▼───────┐  ┌────▼──────────────┐
  │  cr_polices  │  │  sinistres   │  │  graph_alerts      │
  │  (id_police) │  │  (FAIT)      │  │  (vw Synapse)      │
  └───────┬──────┘  └──────┬───────┘  └────────────────────┘
          │ N:1             │ 1:N
          └────────┐  ┌────┘
                   │  │
          ┌────────▼──▼──────┐     ┌──────────────────────┐
          │ cr_dossiers_     │     │ centralite_noeuds    │
          │ recours          │     │ (vw Synapse)         │
          └──────────────────┘     └──────────────────────┘
```

**Relations :**

| Table From | Colonne | Table To | Colonne | Cardinalité | Direction filtre |
|---|---|---|---|---|---|
| `sinistres` | `id_police` | `cr_polices` | `id_police` | N:1 | Single (→ polices) |
| `sinistres` | `date_declaration` | `DimDate` | `Date` | N:1 | Single (→ DimDate) |
| `sinistres` | `id_sinistre` | `graph_alerts` | `id_sinistre` | 1:N | Single (→ alerts) |
| `sinistres` | `id_sinistre` | `cr_dossiers_recours` | `id_sinistre` | 1:1 | Single |

---

## 3. Mesures DAX

### 3.1 Mesures de volumétrie

```dax
-- Nombre total de sinistres dans le contexte de filtre
Total Sinistres =
COUNTROWS(sinistres)

-- Sinistres à risque élevé (score ≥ 60)
Sinistres Élevé Risque =
CALCULATE(
    COUNTROWS(sinistres),
    sinistres[score_fraude] >= 60
)

-- Sinistres à risque moyen (30 ≤ score < 60)
Sinistres Moyen Risque =
CALCULATE(
    COUNTROWS(sinistres),
    sinistres[score_fraude] >= 30,
    sinistres[score_fraude] < 60
)

-- Sinistres à risque faible (score < 30)
Sinistres Faible Risque =
CALCULATE(
    COUNTROWS(sinistres),
    sinistres[score_fraude] < 30
)
```

### 3.2 Mesures de scoring

```dax
-- Score fraude moyen (contexte de filtre courant)
Score Fraude Moyen =
AVERAGE(sinistres[score_fraude])

-- Score fraude moyen — dossiers à risque élevé seulement
Score Moyen Élevé =
CALCULATE(
    AVERAGE(sinistres[score_fraude]),
    sinistres[score_fraude] >= 60
)

-- Contribution moyenne des règles métier au score total
Contribution Règles Moy =
DIVIDE(
    AVERAGE(sinistres[score_regles]),
    AVERAGE(sinistres[score_fraude]),
    0
)

-- Contribution moyenne du modèle ML au score total
Contribution ML Moy =
DIVIDE(
    AVERAGE(sinistres[score_ml]),
    AVERAGE(sinistres[score_fraude]),
    0
)

-- Taux de dossiers déclenchant une investigation (score ≥ 30)
Taux Investigation =
DIVIDE(
    [Sinistres Moyen Risque] + [Sinistres Élevé Risque],
    [Total Sinistres],
    0
)
```

### 3.3 Mesures financières

```dax
-- Montant total réclamé — tous dossiers
Montant Total Réclamé =
SUM(sinistres[montant_reclame])

-- Montant réclamé — dossiers à risque élevé uniquement
Montant En Jeu Élevé =
CALCULATE(
    SUM(sinistres[montant_reclame]),
    sinistres[score_fraude] >= 60
)

-- Montant moyen par sinistre
Montant Moyen Sinistre =
AVERAGE(sinistres[montant_reclame])

-- Montant total récupérable via recours (Agent 5 output)
Montant Récupérable Total =
SUM(cr_dossiers_recours[cr_montant_recuperable])

-- Nombre de dossiers recours initiés
Nb Recours Initiés =
CALCULATE(
    COUNTROWS(cr_dossiers_recours),
    cr_dossiers_recours[cr_statut] = "initie"
)

-- Taux de récupération estimé (récupérable / réclamé élevé risque)
Taux Récupération Estimé =
DIVIDE(
    [Montant Récupérable Total],
    [Montant En Jeu Élevé],
    0
)

-- Économies estimées — fraudes bloquées (hypothèse : 100% des dossiers Élevé sont des fraudes)
-- À affiner avec les données de confirmation SIU
Économies Estimées =
CALCULATE(
    SUM(sinistres[montant_reclame]),
    sinistres[score_fraude] >= 60,
    sinistres[flag_fraude_suspect] = TRUE()
)
```

### 3.4 Mesures de performance détection

```dax
-- Hit rate : fraudes confirmées / total alertes élevées
-- (nécessite champ cr_fraude_confirmee booléen mis à jour par SIU)
Hit Rate Détection =
DIVIDE(
    CALCULATE(COUNTROWS(sinistres), sinistres[statut] = "fraude_confirmee"),
    [Sinistres Élevé Risque],
    0
)

-- Faux positifs estimés parmi les alertes élevées
Faux Positifs Élevé =
CALCULATE(
    COUNTROWS(sinistres),
    sinistres[score_fraude] >= 60,
    sinistres[statut] IN {"clos_sans_suite", "indemnise_normal"}
)

-- Taux de faux positifs
Taux Faux Positifs =
DIVIDE(
    [Faux Positifs Élevé],
    [Sinistres Élevé Risque],
    0
)

-- Délai moyen de traitement agent (en jours)
-- (nécessite cr_date_traitement_agent5 dans Dataverse)
Délai Moyen Traitement J =
AVERAGEX(
    sinistres,
    DATEDIFF(sinistres[date_declaration], sinistres[date_traitement_agent5], DAY)
)
```

### 3.5 Mesures Time Intelligence

```dax
-- Sinistres élevé risque — mois précédent
Sinistres Élevé M-1 =
CALCULATE(
    [Sinistres Élevé Risque],
    PREVIOUSMONTH(DimDate[Date])
)

-- Variation mois sur mois — alertes élevées
Variation MoM Élevé =
DIVIDE(
    [Sinistres Élevé Risque] - [Sinistres Élevé M-1],
    [Sinistres Élevé M-1],
    0
)

-- Score fraude moyen — 30 derniers jours glissants
Score Moyen 30J =
CALCULATE(
    AVERAGE(sinistres[score_fraude]),
    DATESINPERIOD(DimDate[Date], LASTDATE(DimDate[Date]), -30, DAY)
)

-- Montant récupéré cumulatif YTD
Montant Récupérable YTD =
CALCULATE(
    [Montant Récupérable Total],
    DATESYTD(DimDate[Date])
)
```

### 3.6 Mesures Réseau (Synapse)

```dax
-- Nombre d'alertes réseau actives
Alertes Réseau Actives =
CALCULATE(
    COUNTROWS(graph_alerts),
    graph_alerts[pattern_type] <> BLANK()
)

-- Dossiers impliqués dans un réseau réparateur (P1)
Dossiers Réseau Réparateur =
CALCULATE(
    DISTINCTCOUNT(graph_alerts[id_sinistre]),
    graph_alerts[pattern_type] = "P1_RESEAU_REPARATEUR"
)

-- Dossiers impliqués dans un anneau IP (P2)
Dossiers Anneau IP =
CALCULATE(
    DISTINCTCOUNT(graph_alerts[id_sinistre]),
    graph_alerts[pattern_type] = "P2_ANNEAU_IP"
)

-- Score de centralité max (acteur le plus central du réseau)
Centralité Max =
MAXX(centralite_noeuds, centralite_noeuds[degree_centralite])
```

---

## 4. Pages du rapport

### Page 1 — Vue d'ensemble (Home)

**Audience :** Tous rôles | **Actualisation :** Temps réel (15 min)

#### Layout (1440 × 900 px)

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER : "Agent Détecteur de Fraude — Dashboard SIU"           │
│  [Logo assureur]        [Date last refresh]    [Filtre période] │
├───────────┬───────────┬───────────┬────────────────────────────┤
│ KPI CARD  │ KPI CARD  │ KPI CARD  │ KPI CARD                   │
│ Total     │ Élevé     │ Montant   │ Recours                     │
│ Sinistres │ Risque    │ En Jeu    │ Initiés                     │
│ [N]       │ [N] ▲▼%  │ [NNN k€]  │ [N] — [NNN k€]             │
├───────────┴───────────┴───────────┴────────────────────────────┤
│ GRAPHIQUE BARRES EMPILÉES (60%)      │ JAUGE Hit Rate (40%)     │
│ Sinistres par catégorie de risque    │                          │
│ et par mois (12 derniers mois)       │  Hit Rate : X%           │
│ Légende : Faible/Moyen/Élevé         │  (fraudes confirmées /   │
│ Axe X : Mois | Axe Y : Nb sinistres  │   alertes élevées)       │
├──────────────────────────────────────┼──────────────────────────┤
│ TABLEAU — Dernières alertes élevées  │ DONUT — Répartition      │
│ Colonnes : id_sinistre, type,        │ par type de sinistre     │
│ score_fraude, date, statut,          │ (accident_auto, DDO,     │
│ [Voir détail →]                      │  vol, incendie, etc.)    │
│ Tri : score_fraude DESC, 10 lignes   │                          │
└──────────────────────────────────────┴──────────────────────────┘
```

**Visuels :**

| # | Type | Mesure(s) | Config |
|---|---|---|---|
| 1 | Card | `[Total Sinistres]` | Format : nombre entier, icône dossier |
| 2 | Card | `[Sinistres Élevé Risque]`, `[Variation MoM Élevé]` | Couleur conditionnelle rouge si > seuil |
| 3 | Card | `[Montant En Jeu Élevé]` | Format : `#,##0 "€"`, icône alerte |
| 4 | Card | `[Nb Recours Initiés]`, `[Montant Récupérable Total]` | Couleur verte |
| 5 | Stacked Bar | `[Total Sinistres]` par `categorie_risque` et `DimDate[Nom Mois]` | Légende : Faible=#107c10, Moyen=#f7630c, Élevé=#d13438 |
| 6 | Gauge | `[Hit Rate Détection]` | Min=0, Target=60%, Max=100%, rouge < 40%, vert > 60% |
| 7 | Table | colonnes sélectionnées | Formatage conditionnel sur score_fraude (gradient blanc→rouge) |
| 8 | Donut | `[Total Sinistres]` par `type_sinistre` | Légende colorée par type |

**Slicers (filtres interactifs) :**
- Période : `DimDate[Date]` — boutons Aujourd'hui / 7J / 30J / 90J / Personnalisé
- Catégorie risque : `sinistres[categorie_risque]` — checkboxes Faible/Moyen/Élevé
- Type sinistre : `sinistres[type_sinistre]` — liste déroulante

---

### Page 2 — Alertes Fraude (Score ≥ 60)

**Audience :** Agent SIU, Superviseur, Admin | **Vue principale des investigateurs**

#### Layout

```
┌────────────────────────────────────────────────────────────────┐
│ FILTRE RAPIDE : [Tous] [Non traités] [En cours] [Clos]        │
│ Slicers : Type | Date | Score min (slider 60–100)              │
├────────────────────────────────────────────────────────────────┤
│ TABLE PRINCIPALE — Dossiers à risque élevé                     │
│ Colonnes :                                                     │
│  id_sinistre | type | date_décl. | score_fraude | score_règles │
│  score_ml | montant_reclame | statut | reason_codes (tooltip)  │
│ Formatage conditionnel :                                       │
│  - score_fraude : data bar rouge (60→100)                      │
│  - statut : couleur (en_cours=jaune, fraude=rouge, clos=gris)  │
│ Actions : clic → drill-through vers Page 3 (détail dossier)    │
├─────────────────────────┬──────────────────────────────────────┤
│ WATERFALL — Décomposi-  │ BAR CHART HORIZONTAL                 │
│ tion score moyen        │ Top Reason Codes                     │
│  +Règles IP             │ Axe X : nb occurrences               │
│  +Règles Réparateur     │ Axe Y : libellé reason code          │
│  +Règles Précoce        │ (top 5 parmi tous les élevés)        │
│  +Règles Montant        │                                      │
│  +Score ML              │                                      │
│  = Score Total          │                                      │
└─────────────────────────┴──────────────────────────────────────┘
```

**Visuels :**

| # | Type | Mesure(s) / Champs | Config |
|---|---|---|---|
| 1 | Table | Tous champs clés sinistres | Tri desc score_fraude, pagination 20 lignes, clic → drill-through |
| 2 | Waterfall | Mesures décomposition score par catégorie de règle | Couleurs : positif=rouge (fraude), négatif=gris |
| 3 | Bar Chart | `[Total Sinistres]` par reason_code (après expand JSON) | Sort desc, top 5, couleur unique rouge |

**Tooltip Page (hover sur une ligne de la table) :**
- Score fraude : gauge 0–100
- Reason codes : liste bullet points
- Montant réclamé vs plafond garantie
- Nb jours depuis souscription

---

### Page 3 — Analyse Réseau (Graph)

**Audience :** Agent SIU, Superviseur, Admin | **Connexion directe Synapse**

#### Layout

```
┌────────────────────────────────────────────────────────────────┐
│ Slicer : Pattern type [P1_RESEAU_REPARATEUR | P2_ANNEAU_IP |   │
│          P3_MULTI_SINISTRES | P4_LIEN_CROISE | ...]            │
│ Slicer : Score min (slider) | Slicer : Période (date_alerte)   │
├────────────────────────────────────────────────────────────────┤
│ KPI CARDS (ligne)                                              │
│ [Alertes Réseau] [Dossiers Réparateur] [Dossiers IP] [Clusters]│
├─────────────────────────────────┬──────────────────────────────┤
│ TABLE — vw_graph_alerts          │ TABLE — vw_centralite_noeuds│
│ Colonnes :                       │ Colonnes :                  │
│  id_sinistre | pattern_type     │  type_noeud | id_noeud      │
│  id_sinistre_lie | score_lien   │  degree_centralite          │
│  description_alerte             │  nb_sinistres_impliques     │
│  date_alerte                    │  score_risque_noeud         │
│                                  │ Tri : centralite DESC       │
│ Icône pattern_type (couleur)    │ Badge rouge si centralite>3 │
├─────────────────────────────────┴──────────────────────────────┤
│ SCATTER PLOT — Clustering réparateurs                          │
│ Axe X : nb sinistres vers ce réparateur (90j)                  │
│ Axe Y : montant moyen réclamé                                  │
│ Taille bulle : score_fraude moyen des dossiers liés            │
│ Couleur : rouge si reparateur_suspicious, gris sinon           │
│ Tooltip : id_reparateur, nb dossiers, pattern détecté          │
└────────────────────────────────────────────────────────────────┘
```

**Visuels :**

| # | Type | Source | Config |
|---|---|---|---|
| 1–4 | Card | Mesures réseau DAX | Icônes : réseau, voiture, IP, cluster |
| 5 | Table | `vw_graph_alerts` (DirectQuery) | Icône couleur par pattern_type |
| 6 | Table | `vw_centralite_noeuds` (DirectQuery) | Formatage conditionnel degré centralité |
| 7 | Scatter | `sinistres` groupé par id_reparateur | Animation possible par mois |

**Drill-through disponible :**
- Clic sur `id_sinistre` dans la table alerts → Page 2 (détail dossier)
- Clic sur `id_reparateur` dans scatter → Page filtré sur ce réparateur

---

### Page 4 — Détail Dossier (Drill-through)

**Audience :** Agent SIU, Superviseur, Admin | **Accessible uniquement par drill-through**

#### Layout

```
┌────────────────────────────────────────────────────────────────┐
│ ← RETOUR | DOSSIER : {id_sinistre} | Score : {score_fraude}/100│
├──────────────────────────────┬─────────────────────────────────┤
│ FICHE SINISTRE               │ GAUGE — Score Fraude            │
│ id_sinistre                  │ Décomposé règles + ML           │
│ id_police / id_assure        │                                 │
│ Date déclaration             │ WATERFALL — Détail score        │
│ Type sinistre                │  Règles : IP / Réparateur /     │
│ Montant réclamé              │  Précoce / Montant Anormal      │
│ Statut actuel                │  + Score ML                     │
│ Catégorie risque             │  = Total                        │
├──────────────────────────────┼─────────────────────────────────┤
│ REASON CODES                 │ ALERTES RÉSEAU LIÉES            │
│ Liste bullet points          │ Table : patterns détectés       │
│ (expand depuis reason_codes_ │ pour ce dossier spécifique      │
│  json) :                     │ (filtre sur id_sinistre courant)│
│ • Adresse IP partagée…       │                                 │
│ • Réparateur REP-XXX…        │                                 │
│ • Sinistre déclaré N jours…  │                                 │
├──────────────────────────────┴─────────────────────────────────┤
│ SECTION RECOURS (si recours_possible = true)                   │
│ ref_recours | tiers | montant_recuperable | statut | actions   │
│ Bouton → Power Automate : "Relancer Agent 5" (Power Automate)  │
└────────────────────────────────────────────────────────────────┘
```

---

### Page 5 — Dossiers Recours

**Audience :** Agent SIU (lecture), Superviseur, Admin | **Vue pipeline subrogation**

#### Layout

```
┌────────────────────────────────────────────────────────────────┐
│ KPI : [Recours Initiés] [Montant Récupérable Total]            │
│       [Taux Récupération] [Recours Urgents]                    │
├────────────────────────────────────────────────────────────────┤
│ FUNNEL — Pipeline recours                                      │
│ analyse_complete → recours_possible → initié → en_cours →     │
│ accord_amiable / jugement → récupéré                           │
├─────────────────────────┬──────────────────────────────────────┤
│ TABLE — Dossiers recours │ BAR CHART HORIZONTAL                │
│ Colonnes :               │ Montant récupérable par priorité    │
│  ref_recours             │ Urgente | Normale | Faible          │
│  id_sinistre             │ (couleurs alignées priorité)        │
│  tiers_nom               │                                     │
│  montant_recuperable     │ TIMELINE                            │
│  priorite (badge couleur)│ Actions prioritaires (J+5/15/30)   │
│  certitude               │ Par dossier — vue Gantt simplifiée  │
│  date_echeance_prescript.│                                     │
│  statut                  │                                     │
│  [Ouvrir lettre]         │                                     │
└─────────────────────────┴──────────────────────────────────────┘
```

**Visuels :**

| # | Type | Source | Config |
|---|---|---|---|
| 1–4 | Card | Mesures DAX recours | Montant récupérable en vert |
| 5 | Funnel | `cr_dossiers_recours[cr_statut]` COUNT | Couleur dégradée bleu→vert |
| 6 | Table | `cr_dossiers_recours` | Badge priorité coloré, tri date_echeance ASC |
| 7 | Bar | `[Montant Récupérable Total]` par priorite | Seuil 500 € visible |
| 8 | Gantt (custom visual) | `actions_prioritaires` expandé | Depuis Power BI AppSource : Gantt Chart |

---

### Page 6 — Tableau de Bord Superviseur *(restreint)*

**Audience :** Superviseur, Admin uniquement (RLS)

#### Layout

```
┌────────────────────────────────────────────────────────────────┐
│ KPIs AVANT / APRÈS — Impact de l'agent                         │
│                                                                │
│  Faux positifs          Hit Rate           Délai recours       │
│  AVANT : ~80%           AVANT : 1/5        AVANT : 2-3 semaines│
│  APRÈS : {taux_fp}      APRÈS : {hit_rate} APRÈS : {delai_moy}│
│  [−N pts]               [+N pts]           [−N jours]          │
├──────────────────────────────┬─────────────────────────────────┤
│ LINE CHART — Évolution       │ BAR CHART — Distribution scores │
│ score fraude moyen / semaine │ Histogramme 0-100 par tranche 5 │
│ 12 dernières semaines        │ Courbe normale superposée       │
│ Ref line : seuil 60          │ (visualise la bimodalité)       │
├──────────────────────────────┼─────────────────────────────────┤
│ TABLE — Performance agents   │ GAUGE STACK — KPIs business     │
│ (si champ cr_agent_siu)      │ Charge SIU petits dossiers :    │
│ Nb dossiers traités          │ Target < 15% (vs 60% baseline)  │
│ Taux confirmation fraude     │                                 │
│ Délai moyen traitement       │ Montant Récupérable YTD :       │
│                              │ target budget juridique          │
└──────────────────────────────┴─────────────────────────────────┘
```

---

## 5. Sécurité au niveau des lignes (Row-Level Security)

### 5.1 Rôles définis

```
Rôle : Agent_SIU
Description : Investigateurs — voient uniquement les dossiers à risque moyen ou élevé,
              et uniquement leurs propres dossiers si cr_agent_siu est renseigné.

Rôle : Superviseur
Description : Responsables SIU — voient tous les dossiers, toutes les pages,
              y compris la Page 6 Superviseur et les KPIs agrégés.

Rôle : Admin
Description : Administrateurs BI et équipe data — voient tout sans restriction,
              y compris les métriques techniques (tokens AOAI, délais pipeline).
```

### 5.2 Règles DAX de filtrage

**Rôle `Agent_SIU` — filtre sur `sinistres` :**
```dax
-- Règle appliquée à la table sinistres
-- L'agent SIU ne voit que les dossiers nécessitant une investigation
[score_fraude] >= 30
```

**Rôle `Agent_SIU` — filtre sur `cr_dossiers_recours` :**
```dax
-- Lecture seule — pas de filtre ligne (tous les recours visibles en lecture)
TRUE()
```

**Rôle `Agent_SIU` — filtre sur `graph_alerts` :**
```dax
-- Uniquement les alertes liées aux dossiers visibles (filtre propagé par relation)
TRUE()
-- Note : la relation sinistres → graph_alerts propage le filtre score_fraude >= 30
```

**Rôle `Superviseur` — aucun filtre ligne :**
```dax
-- Accès complet sans restriction de ligne
TRUE()
```

**Rôle `Admin` — aucun filtre ligne :**
```dax
TRUE()
```

### 5.3 Restriction de pages par rôle

Power BI ne supporte pas nativement le masquage de pages par rôle.
**Solution recommandée :** Bookmarks + boutons de navigation conditionnels.

```
Page 6 Superviseur → visible uniquement si :
  USERPRINCIPALNAME() IN {liste emails superviseurs}
  
Implémentation : mesure booléenne + formatage conditionnel sur le bouton nav.

[Est Superviseur] =
IF(
    OR(
        USERPRINCIPALNAME() = "chef-siu@assureur-demo.fr",
        USEROBJECTID() IN VALUES(rôles_superviseurs[object_id])
    ),
    TRUE(),
    FALSE()
)
```

### 5.4 Assignation des rôles (Power BI Service)

```
Dans Power BI Service → Sécurité du jeu de données :

Rôle Agent_SIU    → Groupe Azure AD : grp-siu-agents@assureur-demo.fr
Rôle Superviseur  → Groupe Azure AD : grp-siu-superviseurs@assureur-demo.fr
Rôle Admin        → Groupe Azure AD : grp-bi-admins@assureur-demo.fr
```

---

## 6. Formatage et charte graphique

### 6.1 Palette de couleurs

```
Risque Élevé    : #D13438  (rouge Microsoft Fluent)
Risque Moyen    : #F7630C  (orange)
Risque Faible   : #107C10  (vert)
Neutre / STP    : #767676  (gris)
Recours viable  : #0078D4  (bleu Microsoft)
Fond header     : #1B1B3A  (bleu marine)
Fond cards      : #F8F9FA
Accent positif  : #107C10
```

### 6.2 Typographie

```
Titre rapport   : Segoe UI Semibold 20px
Titre page      : Segoe UI Semibold 16px
Titre visuel    : Segoe UI 13px #444444
Corps table     : Segoe UI 12px
KPI valeur      : Segoe UI Light 28px
KPI label       : Segoe UI 11px #767676
```

### 6.3 Thème JSON Power BI

```json
{
  "name": "Fraude Agent SIU Theme",
  "dataColors": ["#0078D4", "#D13438", "#F7630C", "#107C10", "#767676", "#004578", "#A4262C"],
  "background": "#FFFFFF",
  "foreground": "#1A1A1A",
  "tableAccent": "#0078D4",
  "visualStyles": {
    "card": {
      "*": {
        "labels": [{ "color": { "solid": { "color": "#767676" } }, "fontSize": 11 }],
        "calloutValue": [{ "fontSize": 28, "fontFamily": "Segoe UI Light" }]
      }
    },
    "table": {
      "*": {
        "stylePreset": [{ "name": "None" }],
        "grid": [{ "gridVertical": false, "rowPadding": 6 }]
      }
    }
  }
}
```

---

## 7. Alertes et abonnements automatiques

### 7.1 Alertes Power BI Service

```
Alerte 1 : "Pic d'alertes élevées"
  Mesure  : [Sinistres Élevé Risque] (valeur instantanée)
  Seuil   : > 5 nouveaux en 24h
  Action  : Notification email → siu@assureur-demo.fr
  Canal   : Power BI mobile + email

Alerte 2 : "Réseau suspecté actif"
  Mesure  : [Alertes Réseau Actives]
  Seuil   : > 0 (nouveau pattern réseau détecté)
  Action  : Notification push + email superviseur

Alerte 3 : "Score fraude moyen élevé"
  Mesure  : [Score Moyen 30J]
  Seuil   : > 45 (dérive détectée)
  Action  : Email admin BI — investigation dérive modèle
```

### 7.2 Abonnements automatiques (rapports planifiés)

```
Abonnement 1 : "Rapport SIU Quotidien"
  Fréquence : Lundi–Vendredi à 08h00
  Destinataires : siu@assureur-demo.fr, chef-siu@assureur-demo.fr
  Page exportée : Page 1 (Vue d'ensemble) + Page 2 (Alertes)
  Format : PDF

Abonnement 2 : "Rapport Recours Hebdomadaire"
  Fréquence : Lundi à 09h00
  Destinataires : recours@assureur-demo.fr, direction@assureur-demo.fr
  Page exportée : Page 5 (Dossiers Recours)
  Format : PDF + Excel (données brutes)
```

---

## 8. Connexions Synapse — Instructions de configuration

### 8.1 Connexion depuis Power BI Desktop

1. **Obtenir les données** → Azure → Azure Synapse Analytics SQL
2. **Serveur :** `synapse-fraude-demo.sql.azuresynapse.net`
3. **Base de données :** `fraude_demo_db`
4. **Mode de connectivité :** DirectQuery *(obligatoire pour les vues graph — données temps réel)*
5. **Authentification :** Compte Microsoft (Azure AD SSO)
6. **Tables/vues à importer :**
   - `dbo.vw_graph_alerts`
   - `dbo.vw_centralite_noeuds`
   - `dbo.vw_composantes_connexes`

### 8.2 Vue Synapse utilisée par chaque visuel

| Page | Visuel | Vue Synapse | Colonnes clés utilisées |
|---|---|---|---|
| Page 3 | Table Alertes réseau | `vw_graph_alerts` | `id_sinistre`, `pattern_type`, `id_sinistre_lie`, `score_lien`, `description_alerte` |
| Page 3 | Table Centralité | `vw_centralite_noeuds` | `type_noeud`, `id_noeud`, `degree_centralite`, `nb_sinistres_impliques` |
| Page 3 | Scatter réparateurs | `vw_graph_alerts` + `sinistres` | jointure sur `id_sinistre` |
| Page 1 | KPI Alertes réseau | `vw_graph_alerts` | `COUNT(DISTINCT id_sinistre)` |

### 8.3 Optimisation DirectQuery

```sql
-- Vue allégée pour Power BI (évite les CTE complexes en DirectQuery)
-- À créer dans Synapse si les vues originales sont trop lentes :
CREATE VIEW dbo.vw_graph_alerts_pbi AS
SELECT
    id_sinistre,
    pattern_type,
    id_sinistre_lie,
    score_lien,
    description_alerte,
    date_alerte,
    -- Champ calculé pour étiquette visuelle
    CASE pattern_type
        WHEN 'P1_RESEAU_REPARATEUR' THEN '🔧 Réseau réparateur'
        WHEN 'P2_ANNEAU_IP'         THEN '🌐 Anneau IP'
        WHEN 'P3_ASSURE_MULTI'      THEN '👤 Multi-sinistres'
        WHEN 'P4_LIEN_CROISE'       THEN '🔗 Lien croisé'
        ELSE pattern_type
    END AS pattern_label
FROM dbo.vw_graph_alerts
WHERE score_lien IS NOT NULL;
```

---

## 9. Checklist de déploiement Power BI Service

- [ ] Publier le rapport sur l'espace de travail `Fraude-Agent-Demo`
- [ ] Configurer la passerelle de données (Data Gateway) pour Synapse (si réseau privé)
- [ ] Planifier l'actualisation du dataset Dataverse : toutes les 15 minutes
- [ ] Assigner les rôles RLS (Agent_SIU, Superviseur, Admin) via Azure AD groups
- [ ] Activer les alertes (Section 7.1) sur le dataset publié
- [ ] Configurer les abonnements automatiques (Section 7.2)
- [ ] Partager le rapport en lecture avec le groupe `grp-siu-agents`
- [ ] Tester le drill-through Page 2 → Page 4 avec un compte `Agent_SIU`
- [ ] Vérifier que la Page 6 Superviseur est masquée pour les agents SIU
- [ ] Activer le Mode Q&R (Questions & Réponses) avec synonymes FR : "sinistre", "fraude", "score", "recours"

---

## 10. Extension recommandée — Copilot Power BI

Activer **Copilot pour Power BI** (preview) dans les paramètres de l'espace de travail pour permettre aux agents SIU de poser des questions en langage naturel :

> *"Montre-moi les sinistres de type vol avec un score supérieur à 70 ce mois-ci"*
> *"Quel réparateur est impliqué dans le plus de dossiers suspects ?"*
> *"Quel est le montant total récupérable pour les recours urgents ?"*

Pré-requis : capacité Power BI Premium (F64 minimum) ou Fabric Trial.
