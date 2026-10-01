# CLAUDE.md — Agent de détection de fraude & recours (fraud-agent-demo)

Vitrine de prospection de Sébastien Donné (tkoidra.com). Public visé : recruteurs et décideurs IA. Détail et usage : voir le README.

## Ce que fait le projet (état au 01/10/2026)

Démo web (`demo-web/`, https://fraud.tkoidra.com) : un sinistre fictif passe par des règles déterministes, un triage, puis — seulement si c'est utile — un agent Claude à outils sans effet réel ; l'agent propose une décision typée, **un humain valide ou rejette**, puis le dossier est finalisé en brouillon (aucun envoi réel).

```
dossier ──▶ validation stricte ──▶ règles (score /50) ──▶ triage (routage)
                                                              │
        routage ≠ STP  OU  rapport de police fourni ◀─────────┤
                │                                     STP sans rapport : AUCUN appel IA
                ▼
   quota du jour ──▶ agent (outils sans effet) ──▶ proposer_decision  [PAUSE]
                                                          │
                          gestionnaire : Valider / Rejeter (motif) 
                                                          ▼
                                       finaliser_dossier ──▶ brouillon, aucun envoi
   Tout empêchement (quota, stockage, refus, plafonds, temps, erreur) ──▶ rejeu signalé
```

- **Le routage est une règle métier** calculée par du code (`demo-web/lib/regles.js`, `lib/triage.js`) : seuils 15 / 30 sur un score de 0 à 50. Le modèle ne peut pas le modifier (aucun champ de routage dans ses outils) ; le serveur recalcule aussi les montants de recours. Les seuils sont un choix de démo, non calibrés sur des données réelles.
- **Une seule source de vérité pour les règles** : `ml/scoring-model.py`. Le port JavaScript est testé à l'identique (50 dossiers de la base + 11 cas synthétiques générés par Python).
- **Agent** : `claude-sonnet-5-5`, SDK Anthropic natif, boucle écrite à la main (`lib/agent.js`). Réflexion adaptive, effort `low`. 4 outils `strict`, **sans effet réel** (lecture du portefeuille fictif, calcul, et 2 outils terminaux) : c'est ce qui borne le risque d'injection via le rapport de police ou le motif saisi.
- **Prompt** : `demo-web/lib/prompts.js`, version datée (`PROMPT_VERSION`, actuellement 2026-10-01), **identique aux deux appels** (analyse et finalisation) : en modifier un octet entre deux tours invaliderait la réflexion du modèle. Le dossier `prompts/` de la première version a été supprimé (l'historique git le garde).
- **Validation humaine en 2 appels** : l'appel 1 s'arrête sur `proposer_decision` ; l'état est gardé 30 min dans Upstash sous un `run_id` à usage unique ; l'appel 2 reprend la conversation (ajout seul) avec la décision du gestionnaire. Le motif saisi est placé hors des `tool_result`.

## Garde-fous (chacun a son test, `npm test`)

- champs inconnus refusés (`model`, `system`…), bornes strictes, rapport ≤ 4 000 caractères, motif ≤ 500 ;
- STP sans rapport de police : 0 appel au modèle, quota non consommé ;
- plafonds : 6 tours (analyse) / 3 (finalisation), 120 000 tokens d'entrée et 16 000 de sortie par analyse ; `max_tokens` dynamique ≤ 4 096 ;
- budget de temps vérifié avant chaque tour (180 s / 120 s, `maxDuration` Vercel 240 s / 180 s), `timeout` de la requête borné, `maxRetries: 0` : un timeout Vercel n'atteint jamais le visiteur ;
- refus, `max_tokens`, `end_turn` sans outil terminal (une relance), erreur du fournisseur → **rejeu signalé** ; aucune erreur brute affichée ;
- quota quotidien (heure de Paris) **par environnement** : production 15, preview 3, development 3. Calcul daté du 01/10/2026 dans `config/agent.json` (pire cas observé 0,031 $, plafond 18 $ par mois du workspace dédié) ;
- clés Redis préfixées par `VERCEL_ENV` (le quota de la prévisualisation est indépendant de la production) ;
- secrets : `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `ANTHROPIC_API_KEY` ne sont lus que pour construire les clients ; jamais affichés ni journalisés (test avec valeurs sentinelles) ;
- front : DOM construit par `createElement` / `textContent` uniquement (aucun `innerHTML`) ; couples de couleurs tirés de la charte, contraste WCAG 2.1 vérifié par test.

## Rejeux, coûts et durées mesurés (01/10/2026)

- `demo-web/replays/{reseau,precoce,recours}.json` : exécutions **réelles** enregistrées par `demo-web/scripts/record-replays.mjs` (modèle `claude-sonnet-5-5`, prompt 2026-10-01, effort `low`). Elles ne contiennent que la proposition, les finalisations et la trace client (jamais de blocs de réflexion). Servies en repli, avec un bandeau daté. Le script est **payant** : refuse de démarrer sans `--yes` et sans clé dans l'environnement, ne lit aucun `.env`.
- Mesures (3 scénarios fictifs) : environ 0,02 $ par analyse complète (0,0219 $ en moyenne ; pire cas observé 0,0307 $ au premier appel après inactivité, cache de prompt froid), 6 à 10 s pour l'analyse (jusqu'à ~18 s à cache froid), 3 à 6 s pour la finalisation, 1 à 2 tours selon le dossier.
- Durée annoncée au visiteur : « généralement 10 à 20 secondes », **provisoire** jusqu'à la vérification en prévisualisation.
- Tarif de référence : `config/agent.json` (source citée) ; à revérifier avant toute décision budgétaire.

## Structure

- `demo-web/` — page statique (`index.html`, `app.js`, `scenarios.js`) et fonctions Vercel (`api/analyze.js`, `api/finalize.js`, `api/quota.js`) ; `lib/` (règles, triage, outils, agent, stockage, handlers), `config/`, `data/`, `replays/`, `test/`, `scripts/`
- `ml/` — scoring de référence (règles + régression logistique) et features documentées. La régression logistique n'est ni exécutée ni affichée par la démo (partie probabiliste prévue au lot 2)
- `data-mock/` — données fictives (sinistres, polices, procès-verbaux, scores)
- `scripts/` — générateur de données reproductible ; `test-prompts.py` est un ancien script de test du prototype, conservé pour mémoire, non utilisé par la démo
- `docs/` — audit du 30/09/2026 (état d'origine)

## Commandes (depuis `demo-web/`)

- `npm test` — tous les tests, sans réseau ni clé (faux client Anthropic, faux Redis, horloge simulée)
- `node scripts/serveur-local.js` — démo locale avec API simulée (aucun appel payant)
- `node scripts/captures-front.js <dossier>` — captures Chrome headless 1440 / 390 px
- `node scripts/record-replays.mjs` — enregistrement des rejeux (appels payants, voir ci-dessus)
- Aucun script `dev` ni `vercel dev` dans `package.json` : piège de récursion connu sur nos projets sans framework.

## Règles de développement

- Commentaires du code en **français**, noms de variables et fonctions : snake_case anglais en Python ; le code JavaScript du dépôt suit le français (voir l'existant).
- Aucune clé dans le code ni dans git : variables d'environnement uniquement (hook gitleaks au commit). `demo-web/.env` local est ignoré par git.
- Versions des dépendances figées (sans `^`).
- Une branche et une PR par lot, **fusionnée par Sébastien** ; Claude ne fusionne ni ne déploie jamais en production. Les commits restent locaux tant que Sébastien n'a pas relu.
- Aucun appel payant lancé par Claude : les enregistrements de rejeux sont lancés par Sébastien.
- On travaille avec Claude Code dans le terminal.

## Données

- **Uniquement des données fictives.** Jamais de données personnelles réelles, même partielles.
- Identifiants manifestement fictifs : IP des plages de documentation (RFC 5737), plaques `DEMO-xxx`, « Mutuelle Fictive d'Assurance », « Unité fictive de démonstration ». Le script d'enregistrement signale toute marque d'assureur réelle ou plaque au format SIV dans les rejeux.
- `scripts/generate-mock-data.py` est reproductible (graine 42) : modifier l'ordre des tirages aléatoires change les montants.
- Pas d'incohérence volontaire dans les scénarios actuels : une incohérence assumée et annoncée sera conçue au lot 3 (dossier « fraude documentaire »).

## Ce que je ne veux pas

- Aucune affirmation non vérifiée dans la démo ou la documentation (chiffres, KPI, promesses de confidentialité).
- Pas de « zéro stockage » ni de « jamais envoyée ailleurs » : les saisies sont traitées par Anthropic (conservation jusqu'à 30 jours, sauf exceptions), l'état de session est gardé 30 min dans Upstash, hébergement aux États-Unis.
- Pas de fusion ni de déploiement en production par Claude.

## Suite prévue

Lot 2 : triage probabiliste (Jev, TypeSafe), branché dans `lib/triage.js` avec la même interface. Lot 3 : évaluation sur 6 dossiers, dont un dossier « fraude documentaire » avec incohérence assumée. Lot 4 : vitrine (autre dépôt).

*Contact : sebastien@tkoidra.com*
