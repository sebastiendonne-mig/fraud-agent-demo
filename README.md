# Agent IA — Détection de fraude & recours (IARD)

Démonstrateur d'un agent IA de triage de sinistres pour assureurs IARD : des **règles déterministes** décident du routage, un **agent Claude à outils sans effet réel** n'intervient que si c'est utile, et **un humain valide** avant toute finalisation.

**Sébastien Donné** — [tkoidra.com](https://tkoidra.com) · [sebastien@tkoidra.com](mailto:sebastien@tkoidra.com)
Démo : [fraud.tkoidra.com](https://fraud.tkoidra.com)

**Toutes les données sont entièrement fictives.** Aucune donnée personnelle réelle n'a été utilisée. C'est un démonstrateur, pas un outil de production.

---

## Pourquoi ce projet

- Les alertes de fraude fondées sur des règles fixes fatiguent les équipes d'investigation.
- Les recours en subrogation sont identifiés tard, parfois jamais.
- Les montages en réseau (même réparateur, même adresse IP, déclarations groupées) sont invisibles sans croisement entre dossiers.

Ce dépôt montre une réponse **sous contrôle** : le modèle raisonne et rédige, le code calcule et décide du routage, l'humain tranche.

## Comment ça marche

```
dossier ──▶ validation stricte ──▶ règles (score /50) ──▶ triage (routage)
                                                              │
        routage ≠ STP  OU  rapport de police fourni ◀─────────┤
                │                                     STP sans rapport : aucun appel IA
                ▼
   quota du jour ──▶ agent à outils sans effet ──▶ proposition typée  [pause]
                                                          │
                              gestionnaire : Valider / Rejeter (motif)
                                                          ▼
                                    dossier finalisé : brouillon, aucun envoi réel
   Quota atteint, erreur, refus, dépassement de temps ou de tokens ──▶ rejeu signalé
```

1. **Règles déterministes** — quatre règles explicables (adresse IP partagée, réseau de réparateurs, déclaration précoce, montant atypique) donnent un score sur 50. Port JavaScript fidèle du script Python [`ml/scoring-model.py`](ml/scoring-model.py), testé à l'identique.
2. **Triage** — traitement automatique (STP) sous 15, investigation de 15 à 29, alerte SIU à partir de 30. **Ces seuils sont un choix de démonstration, non calibrés sur des données réelles.** Le modèle ne peut pas modifier le routage.
3. **Agent Claude** (`claude-sonnet-5-5`) — appelé seulement si le dossier n'est pas en STP ou si un rapport de police est fourni (examen du recours). Ses outils ne font que lire le portefeuille fictif ou calculer : aucun envoi, aucune écriture. Les montants de recours sont recalculés par le code.
4. **Décision typée** — l'agent termine par une proposition structurée ; le serveur signale toute correction.
5. **Validation humaine** — rien n'est finalisé sans décision du gestionnaire ; le résultat est un **brouillon**.

## Garde-fous

Chacun est couvert par un test automatisé (`npm test`, 124 tests, sans réseau ni clé) :

- entrées strictement validées (champs inconnus refusés, bornes, longueurs) ;
- STP sans rapport de police : **aucun appel au modèle**, aucun quota consommé ;
- plafonds de tours, de tokens et de temps vérifiés avant chaque tour ; aucun timeout brut pour le visiteur ;
- refus du modèle, erreur du fournisseur, quota atteint : **rejeu signalé** d'une exécution réelle enregistrée, jamais d'erreur brute ;
- session de validation à **usage unique** (`run_id`), expirée au bout de 30 minutes ;
- quota quotidien par environnement (production 15, prévisualisation 3, développement 3) ;
- secrets jamais affichés ni journalisés ; affichage sans insertion de HTML brut (un rapport piégé s'affiche comme du texte) ;
- contraste des couleurs conforme à WCAG 2.1, vérifié par test.

## Coûts et durées mesurés (01/10/2026)

Mesurés sur 3 scénarios fictifs (réseau, déclaration précoce, recours), exécutions réelles :

| | Mesure |
|---|---|
| Coût d'une analyse complète (analyse + une issue) | environ 0,02 $ (moyenne 0,0219 $) |
| Pire cas observé | 0,0307 $, au premier appel après une période d'inactivité (cache de prompt froid) |
| Durée de l'analyse | 6 à 10 s (jusqu'à environ 18 s à cache froid) |
| Durée de la finalisation | 3 à 6 s |
| Tours de l'agent | 1 à 2 selon le dossier |

Tarif de référence : celui de `demo-web/config/agent.json`, à revérifier avant toute décision budgétaire. La durée annoncée au visiteur (« généralement 10 à 20 secondes ») est **provisoire** jusqu'à la vérification en prévisualisation.

## Confidentialité

Les données saisies sont envoyées à Anthropic, qui les conserve **jusqu'à 30 jours** (sauf exceptions : application de la politique d'usage, obligations légales — [page officielle](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)). L'état d'une analyse est gardé 30 minutes dans une base Upstash pour permettre la validation, puis supprimé. Hébergement aux États-Unis. **N'entrez aucune donnée réelle.**

## Structure

```
fraud-agent-demo/
├── demo-web/       démo : page (index.html, app.js, scenarios.js), fonctions Vercel (api/),
│                   lib/ (règles, triage, outils, agent, stockage), config/, replays/, test/, scripts/
├── ml/             scoring de référence (règles + régression logistique) et features
├── data-mock/      données fictives (sinistres, polices, procès-verbaux, scores)
├── scripts/        générateur de données reproductible
└── docs/           audit du 30/09/2026 (état d'origine)
```

La régression logistique de `ml/` n'est ni exécutée ni affichée par la démo ; une partie probabiliste est prévue au lot 2.

## Lancer en local

Prérequis : Node 24 et npm (démo) ; Python 3.10+ avec `scikit-learn pandas numpy joblib` (scoring de référence).

```bash
cd demo-web
npm install
npm test                          # 124 tests, aucun accès réseau
node scripts/serveur-local.js     # démo locale, API simulée, sans clé ni coût
```

Autres commandes (depuis `demo-web/`) :

```bash
node scripts/captures-front.js ./captures      # captures Chrome headless 1440 et 390 px (réseau externe bloqué)
node scripts/record-replays.mjs                # affiche le plan et la borne de coût, puis s'arrête
```

`record-replays.mjs` lance des **appels réels payants** : il refuse de démarrer sans `--yes` et sans `ANTHROPIC_API_KEY` dans l'environnement, ne lit aucun fichier `.env` et n'affiche jamais la clé. Il enregistre les rejeux et écrit les mesures hors du dépôt.

Données et scoring de référence :

```bash
python scripts/generate-mock-data.py                                  # régénère data-mock/ (graine fixe)
python ml/scoring-model.py --mode score --output data-mock/scores_output.json
```

## Historique

Une première version décrivait un pipeline sur une stack Microsoft (Copilot Studio, Azure ML, Synapse, Power Automate, Power BI). Ces composants n'ont jamais été exécutés dans la démo web, qui reposait sur Claude ; leurs fichiers de conception ont été archivés hors du dépôt (ils restent dans l'historique git). La démo a ensuite été reconstruite en vrai agent côté serveur.
