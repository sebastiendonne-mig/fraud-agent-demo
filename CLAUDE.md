# CLAUDE.md — Agent Détecteur de Fraude & Recours Automatique
## Projet portfolio — Sébastien Donné | tkoidra.com

---

## Contexte produit

Use case de démonstration des compétences en **IA agentique Microsoft** destiné à être présenté à des assureurs (IARD, Prévoyance).

**Problème adressé :**
- Les systèmes de détection fraude basés sur des règles fixes génèrent 80%+ de faux positifs
- Les équipes SIU (Special Investigation Units) sont saturées de faux dossiers
- Les opportunités de recours (subrogation) ne sont pas systématiquement identifiées → fuite financière

**Solution démontrée :**
Un pipeline agentique multi-étapes qui score chaque dossier sinistre entrant, détecte des connexions suspectes entre dossiers, identifie les tiers responsables et génère automatiquement un dossier de recours.

**Public cible de la démo :** DSI, Directeurs Techniques, Responsables Fraude dans les compagnies d'assurance françaises.

---

## Stack technique

| Composant | Technologie | Rôle |
|---|---|---|
| Orchestrateur agent | **Copilot Studio** | Point d'entrée, routing des dossiers entrants |
| Scoring ML fraude | **Azure Machine Learning** | Modèle de scoring probabiliste par dossier |
| Analyse de graphes | **Azure Synapse Analytics** | Détection de connexions suspectes inter-dossiers |
| Analyse sémantique | **Azure OpenAI (GPT-4o)** | Lecture rapports de police, identification responsabilité |
| Workflow recours | **Power Automate** | Génération automatique du dossier de subrogation |
| Base de données | **Dataverse** | Stockage dossiers, polices, historiques, flagging |
| Visualisation SIU | **Power BI** | Dashboard investigateurs avec Reason Codes |
| Authentification | **Azure AD / Entra ID** | Gestion des rôles (agent SIU, superviseur, admin) |

---

## Architecture agentique (flux principal)

```
Sinistre entrant (formulaire / Teams)
        │
        ▼
[Agent 1 — Copilot Studio]
  Réception + extraction données structurées
        │
        ▼
[Agent 2 — Azure ML]
  Score fraude (0–100) + catégorie de risque
        │
   ┌────┴────┐
Score < 30   Score ≥ 30
(STP normal)  (Investigation)
              │
              ▼
     [Agent 3 — Azure Synapse]
       Graph Analysis : connexions
       entre dossiers, acteurs, IP
              │
              ▼
     [Agent 4 — Azure OpenAI]
       Lecture sémantique rapports
       Identification tiers responsable
              │
         ┌────┴────┐
      Fraude      Recours possible
      confirmée   identifié
         │              │
         ▼              ▼
  [Alerte SIU]   [Agent 5 — Power Automate]
  Power BI        Génération dossier recours
  Reason Codes    Email juridique automatique
```

---

## Structure du repo

```
fraud-agent-demo/
├── CLAUDE.md                      ← ce fichier
├── README.md                      ← présentation publique du projet
│
├── /data-mock/                    ← données fictives pour la démo
│   ├── sinistres_mock.json        ← 50 dossiers sinistres simulés
│   ├── polices_mock.json          ← contrats associés
│   └── rapports_police_mock.txt   ← rapports texte pour analyse LLM
│
├── /agents/
│   ├── copilot-studio/
│   │   └── agent-config.json      ← export config Copilot Studio
│   ├── azure-ml/
│   │   ├── scoring-model.py       ← script d'entraînement/scoring
│   │   └── features.md            ← liste des features du modèle
│   ├── synapse/
│   │   └── graph-query.sql        ← requêtes analyse de graphes
│   └── openai/
│       └── prompts/
│           ├── analyse-rapport-police.md
│           └── identification-tiers.md
│
├── /power-automate/
│   └── flow-recours.json          ← export du flow Power Automate
│
├── /power-bi/
│   └── dashboard-siu.pbix         ← dashboard investigators
│
├── /docs/
│   ├── architecture-diagram.png   ← schéma visuel du pipeline
│   ├── demo-script.md             ← script de présentation orale
│   └── kpis.md                    ← métriques avant/après
│
└── /scripts/
    └── generate-mock-data.py      ← génère les données fictives IARD
```

---

## Données de démonstration

Utiliser uniquement des **données fictives** (jamais de vraies données assureur).

**Jeu de données mock à créer :**
- 50 sinistres IARD fictifs (dégâts des eaux, bris de glace, accidents auto)
- Dont 8 cas frauduleux avec patterns détectables (même garagiste, même adresse IP, dates suspectes)
- Dont 5 cas avec responsabilité tiers identifiable dans un rapport de police fictif
- Polices et assurés fictifs cohérents (noms, numéros de contrat, montants réalistes)

**Format JSON standard pour un sinistre :**
```json
{
  "id_sinistre": "SIN-2024-0042",
  "id_police": "POL-78234",
  "date_declaration": "2024-03-15",
  "type": "degat_des_eaux",
  "montant_reclame": 3200,
  "id_assure": "ASS-1091",
  "id_reparateur": "REP-007",
  "adresse_ip_declaration": "185.23.14.X",
  "rapport_police": null,
  "score_fraude": null,
  "statut": "en_cours"
}
```

---

## Prompts Azure OpenAI (à ne pas modifier sans test)

### Analyse rapport de police
```
Système : Tu es un assistant juridique spécialisé en droit des assurances français.
Analyse le rapport de police suivant et identifie :
1. La ou les parties responsables de l'accident
2. La part de responsabilité estimée (%) si partagée
3. Les éléments factuels clés à retenir pour un recours
4. Le niveau de certitude de ton analyse (Faible / Moyen / Élevé)

Réponds uniquement en JSON structuré. Ne jamais inventer de faits non présents dans le texte.
```

### Génération Reason Codes fraude
```
Système : Tu es un analyste fraude assurance.
Sur la base du score de fraude et des connexions identifiées, génère 3 à 5 "Reason Codes"
explicables pour l'investigateur SIU.
Format : liste courte, factuelle, sans jargon technique.
Chaque reason code commence par un verbe d'action.
```

---

## Règles de développement

- Tout le code Python utilise des commentaires en **français**
- Les variables et fonctions sont nommées en **anglais** (snake_case)
- Les prompts OpenAI sont versionnés dans `/agents/openai/prompts/` avec date de modification
- Ne jamais hardcoder de clés API — utiliser les variables d'environnement Azure Key Vault
- Les exports Copilot Studio et Power Automate sont sauvegardés après chaque modification majeure
- Chaque agent est testé individuellement avant intégration dans le pipeline complet
-on utilise claude code avec le terminal

---

## Ce que je ne veux pas

- Pas de données personnelles réelles, même anonymisées partiellement
- Pas de librairies Python non disponibles dans Azure ML (vérifier la liste des packages supportés)
- Pas de dépendances à des APIs tierces payantes hors écosystème Microsoft
- Pas de logique métier assurance codée en dur : tout passe par Dataverse ou des fichiers de configuration

---

## Prochaines étapes (ordre de build)

- [ ] **Étape 1** — Générer les données mock (`generate-mock-data.py`)
- [ ] **Étape 2** — Créer le modèle de scoring ML simple (règles + logistic regression) dans Azure ML
- [ ] **Étape 3** — Construire les requêtes graph dans Synapse avec les données mock
- [ ] **Étape 4** — Tester les prompts OpenAI sur les rapports de police fictifs
- [ ] **Étape 5** — Assembler le flow Power Automate pour la subrogation
- [ ] **Étape 6** — Construire le dashboard Power BI SIU
- [ ] **Étape 7** — Créer l'agent Copilot Studio orchestrateur
- [ ] **Étape 8** — Rédiger le demo-script.md pour la présentation client
- [ ] **Étape 9** — Créer le schéma d'architecture (architecture-diagram.png)
- [ ] **Étape 10** — Publier sur GitHub public avec README soigné

---

## KPIs de démonstration à mettre en avant

| Métrique | Avant (baseline) | Après (agent) |
|---|---|---|
| Faux positifs fraude | ~80% des alertes | < 20% |
| Hit rate investigation | 1 fraude / 5 alertes | 3+ fraudes / 5 alertes |
| Délai identification recours | Manuel, 2-3 semaines | Automatique, < 1h |
| Charge SIU sur petits dossiers | 60% du temps | < 15% du temps |

---

*Dernière mise à jour : juin 2026 — Sébastien Donné*
*Contact : sebastien@tkoidra.com*
