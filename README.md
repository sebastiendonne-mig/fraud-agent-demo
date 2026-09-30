# Agent IA — Détection de fraude & recours (IARD)

Démonstrateur d'un agent IA de triage de sinistres pour assureurs IARD : règles de scoring explicables, lecture d'un rapport de police par Claude, décision proposée puis validée par un humain.

**Sébastien Donné** — [tkoidra.com](https://tkoidra.com) · [sebastien@tkoidra.com](mailto:sebastien@tkoidra.com)

> **État (30/09/2026) : refonte en cours.**
> L'analyse en direct de la [démo web](https://fraud.tkoidra.com) est **suspendue** pendant la refonte. La version précédente enchaînait deux appels à Claude pilotés par le navigateur ; elle est remplacée par un vrai agent côté serveur (outils bornés, validation humaine, quota et repli signalé). Ce dépôt contient l'état intermédiaire.

**Toutes les données sont entièrement fictives.** Aucune donnée personnelle réelle n'a été utilisée.

---

## Le problème

- Les alertes de fraude fondées sur des règles fixes fatiguent les équipes d'investigation.
- Les recours en subrogation sont identifiés tard, parfois jamais.
- Les montages en réseau (même réparateur, même adresse IP, déclarations groupées) sont invisibles sans croisement entre dossiers.

## Ce que le dépôt contient aujourd'hui

| Élément | Où | Ce que c'est |
|---|---|---|
| Base fictive | `data-mock/` | 50 sinistres IARD dont 8 avec des schémas de fraude détectables, 50 polices, 5 procès-verbaux fictifs |
| Scoring | `ml/scoring-model.py` | 4 règles métier explicables (score sur 50) + une régression logistique entraînée sur la base fictive. Fonctionne hors ligne |
| Prompts | `prompts/` | Deux prompts versionnés : analyse d'un rapport de police, identification du tiers et viabilité du recours |
| Test des prompts | `scripts/test-prompts.py` | Script manuel qui appelle l'API Claude (payante) sur les 5 procès-verbaux |
| Générateur | `scripts/generate-mock-data.py` | Régénère `data-mock/` de façon reproductible (graine fixe) |
| Démo web | `demo-web/` | Page statique + fonctions Vercel. Analyse en direct suspendue |

### Les 4 règles de scoring (`ml/scoring-model.py`)

| Règle | Points |
|---|---|
| Même adresse IP sur ≥ 1 autre dossier (30 jours) | `min(20, 10 × n)` |
| Même réparateur sur ≥ 2 autres dossiers (90 jours) | `min(20, 7 × n)` |
| Sinistre déclaré moins de 30 jours après la souscription | +15 |
| Montant supérieur de plus de 1,8 écart-type à la moyenne de son type | +10 |

Total des règles plafonné à 50.

Sur la base fictive actuelle, le scoring du script Python donne la répartition suivante : 36 dossiers « Faible », 13 « Moyen », 1 « Élevé » (score maximal : 63), pour un montant total de 437 k€. Ces chiffres décrivent la base fictive, pas la performance d'un modèle sur des dossiers réels.

## Feuille de route de la refonte

| Lot | Contenu | État |
|---|---|---|
| 0 | Couper le proxy, suspendre l'analyse en direct | fait |
| 0b | Nettoyage du dépôt, données et libellés neutralisés | en cours |
| 1 | Agent côté serveur : règles déterministes → triage → agent Claude à outils bornés → décision validée par un humain | à faire |
| 2 | Triage probabiliste | à faire |
| 3 | Évaluation sur 6 dossiers | à faire |

## Lancer en local

Prérequis : Python 3.10+, `pip install scikit-learn pandas numpy joblib anthropic`.

```bash
# 1. Régénérer les données fictives
python scripts/generate-mock-data.py

# 2. (Ré)entraîner le modèle
python ml/scoring-model.py --mode train

# 3. Scorer les 50 sinistres
python ml/scoring-model.py --mode score --output data-mock/scores_output.json

# 4. Tester les prompts (appels payants à l'API Claude, clé requise)
export ANTHROPIC_API_KEY=...
python scripts/test-prompts.py
```

## Structure

```
fraud-agent-demo/
├── CLAUDE.md
├── README.md
├── data-mock/        données fictives (sinistres, polices, procès-verbaux, scores)
├── demo-web/         démo web (analyse en direct suspendue)
├── docs/             audit du 30/09/2026
├── ml/               scoring : règles + régression logistique, features documentées
├── prompts/          prompts versionnés
└── scripts/          générateur de données, test des prompts
```

## Historique

Une première version décrivait un pipeline sur une stack Microsoft (Copilot Studio, Azure ML, Synapse, Power Automate, Power BI). Ces composants n'ont jamais été exécutés dans la démo web, qui reposait sur Claude. Leurs fichiers de conception ont été archivés hors du dépôt ; ils restent dans l'historique git.
