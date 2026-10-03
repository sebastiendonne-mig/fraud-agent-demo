# CLAUDE.md — Agent de détection de fraude & recours (fraud-agent-demo)

Vitrine de prospection de Sébastien Donné (tkoidra.com). Public visé : recruteurs et décideurs IA. Détail et usage : voir le README.

## Ce que fait le projet (état au 01/10/2026)

Démo web (`demo-web/`, https://fraud.tkoidra.com) : un sinistre fictif passe par des règles déterministes, un triage (règles, puis un avis de Jev sur les textes — lot 2, en cours : branche `lot2-jev`, non déployée), puis — seulement si c'est utile — un agent Claude à outils sans effet réel ; l'agent propose une décision typée, **un humain valide ou rejette**, puis le dossier est finalisé en brouillon (aucun envoi réel).

```
dossier ──▶ validation stricte ──▶ règles (score /50) ──▶ routage des règles (plancher)
                                                              │
                      circonstances ou rapport non vides ──▶ quota Jev ──▶ Jev (Gateway, OIDC)
                                                              │        monte d'UN niveau au plus, jamais ne descend
                                                              ▼        (repli signalé : règles seules)
        routage final ≠ STP  OU  rapport de police fourni ◀── routage final (calculé par le code)
                │                                     STP sans rapport : l'agent n'est pas appelé
                ▼
   quota du jour ──▶ agent (outils sans effet) ──▶ proposer_decision  [PAUSE]
                                                          │
                          gestionnaire : Valider / Rejeter (motif) 
                                                          ▼
                                       finaliser_dossier ──▶ brouillon, aucun envoi
   Tout empêchement (quota, stockage, refus, plafonds, temps, erreur) ──▶ rejeu signalé
```

- **Le routage est une règle métier** calculée par du code (`demo-web/lib/regles.js`, `lib/triage.js`) : seuils 15 / 30 sur un score de 0 à 50. Le modèle ne peut pas le modifier (aucun champ de routage dans ses outils) ; le serveur recalcule aussi les montants de recours. Les seuils sont un choix de démo, non calibrés sur des données réelles.
- **Triage Jev (lot 2)** : `lib/jev.js` (questions, appel, lecture des réponses), `config/jev.json` (modèle, seuils, quota, délai), `trierAvecJev()` et `combinerRoutage()` dans `lib/triage.js` (`trier()` est inchangé). Jev (TypeSafe, modèle `typesafe-ai/jev`, via Vercel AI Gateway, `experimental_evaluate` du paquet `ai` exact) ne lit que les textes (`circonstances`, `rapport_police`), jamais un montant, une date ni un compteur. Quatre questions typées ; une réponse à probabilité ≥ 0,8 est un « signal », ≤ 0,2 « neutre », entre les deux « incertain » (ignoré, mentionné). Au moins un signal fait monter le routage d'UN niveau au-dessus de celui des règles (plafond ALERTE_SIU), jamais de baisse. Seuils de démo, non calibrés (`config/jev.json`).
- **Accès Jev** : authentification OIDC uniquement (jeton lu dans l'en-tête `x-vercel-oidc-token` ou `VERCEL_OIDC_TOKEN`, passé explicitement au client Gateway ; `AI_GATEWAY_API_KEY` n'est jamais lue). `providerOptions.gateway` : `only: ["typesafe-ai"]` et `disallowPromptTraining: true` ; pas de `zeroDataRetention` (indisponible en Hobby). `maxRetries: 0`, délai de 10 s (`abortSignal`). `ai` est ESM : import dynamique depuis le code CommonJS.
- **Repli Jev** : toute erreur (402, 403, 429, réseau, délai, réponse invalide, quota, stockage, absence de jeton OIDC) → routage des règles seules, motif `jev_*` dans la réponse (`repli_jev`), aucune erreur brute. Quota Jev séparé (clé `quota_jev`, 30 / 6 / 6 par jour), compté avant l'appel, jamais compté si Jev n'est pas appelé, non remboursé. Une ligne d'audit par appel, sans contenu : modèle, fournisseur, generationId, tokens, coût, latence.
- **Réponse de l'API (analyse)** : `routage_regles`, `routage` (final), `source_routage` (`regles` ou `regles+jev`), `jev` (réponses, probabilités, signaux, incertains, latence, coût, fournisseur, generationId) ou `null`, `repli_jev`, `quota_jev`.
- **Une seule source de vérité pour les règles** : `ml/scoring-model.py`. Le port JavaScript est testé à l'identique (50 dossiers de la base + 11 cas synthétiques générés par Python).
- **Agent** : `claude-sonnet-5-5`, SDK Anthropic natif, boucle écrite à la main (`lib/agent.js`). Réflexion adaptive, effort `low`. 4 outils `strict`, **sans effet réel** (lecture du portefeuille fictif, calcul, et 2 outils terminaux) : c'est ce qui borne le risque d'injection via le rapport de police ou le motif saisi.
- **Prompt** : `demo-web/lib/prompts.js`, version datée (`PROMPT_VERSION`, actuellement 2026-10-01), **identique aux deux appels** (analyse et finalisation) : en modifier un octet entre deux tours invaliderait la réflexion du modèle. Le dossier `prompts/` de la première version a été supprimé (l'historique git le garde).
- **Validation humaine en 2 appels** : l'appel 1 s'arrête sur `proposer_decision` ; l'état est gardé 30 min dans Upstash sous un `run_id` à usage unique ; l'appel 2 reprend la conversation (ajout seul) avec la décision du gestionnaire. Le motif saisi est placé hors des `tool_result`.

## Garde-fous (chacun a son test, `npm test`)

- champs inconnus refusés (`model`, `system`…), bornes strictes, rapport ≤ 4 000 caractères, circonstances ≤ 2 000, motif ≤ 500 ;
- ni rapport ni circonstances (STP) : 0 appel à Jev et à l'agent, aucun quota consommé ; circonstances sans rapport, Jev neutre : Jev appelé, agent non appelé, quota d'analyses non consommé ;
- plafonds : 6 tours (analyse) / 3 (finalisation), 120 000 tokens d'entrée et 16 000 de sortie par analyse ; `max_tokens` dynamique ≤ 4 096 ;
- budget de temps vérifié avant chaque tour (180 s / 120 s, `maxDuration` Vercel 240 s / 180 s), `timeout` de la requête borné, `maxRetries: 0` : un timeout Vercel n'atteint jamais le visiteur ;
- refus, `max_tokens`, `end_turn` sans outil terminal (une relance), erreur du fournisseur → **rejeu signalé** ; aucune erreur brute affichée ;
- quota quotidien (heure de Paris) **par environnement** : production 15, preview 3, development 3. Calcul daté du 01/10/2026 dans `config/agent.json` (pire cas observé 0,031 $, plafond 18 $ par mois du workspace dédié) ;
- clés Redis préfixées par `VERCEL_ENV` (le quota de la prévisualisation est indépendant de la production) ;
- secrets : `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `ANTHROPIC_API_KEY` ne sont lus que pour construire les clients ; le jeton OIDC de la requête ne sert qu'au client Gateway ; jamais affichés ni journalisés (tests avec valeurs sentinelles) ;
- tests sans réseau : `test/helpers/sans-reseau.js` interdit `fetch`, `http(s)`, sockets TCP/TLS et DNS ; Jev est testé avec `Experimental_EvaluationMockModelV4` (`ai/test`) et avec le vrai client Gateway branché sur un `fetch` factice ;
- front : DOM construit par `createElement` / `textContent` uniquement (aucun `innerHTML`) ; couples de couleurs tirés de la charte, contraste WCAG 2.1 vérifié par test.

## Rejeux, coûts et durées mesurés (01/10/2026)

- `demo-web/public/replays/{reseau,precoce,recours}.json` : exécutions **réelles** enregistrées par `demo-web/scripts/record-replays.mjs` (modèle `claude-sonnet-5-5`, prompt 2026-10-01, effort `low`). Elles ne contiennent que la proposition, les finalisations et la trace client (jamais de blocs de réflexion). Servies en repli, avec un bandeau daté. Le script est **payant** : refuse de démarrer sans `--yes` et sans clé dans l'environnement, ne lit aucun `.env`.
- Mesures (3 scénarios fictifs) : environ 0,02 $ par analyse complète (0,0219 $ en moyenne ; pire cas observé 0,0307 $ au premier appel après inactivité, cache de prompt froid), 6 à 10 s pour l'analyse (jusqu'à ~18 s à cache froid), 3 à 6 s pour la finalisation, 1 à 2 tours selon le dossier.
- Durée annoncée au visiteur : « généralement 10 à 20 secondes », **provisoire** jusqu'à la vérification en prévisualisation.
- Tarif de référence : `config/agent.json` (source citée) ; à revérifier avant toute décision budgétaire.

## Structure

- `demo-web/public/` — **seule partie servie publiquement** (`outputDirectory` de `vercel.json`) : `index.html`, `app.js`, `scenarios.js`, `assets/`, `replays/`. Tout ce qui est hors de `public/` (`lib/`, `config/`, `data/`, `package.json`…) n'est jamais servi ; les fonctions Vercel (`api/analyze.js`, `api/finalize.js`, `api/quota.js`, à la racine de `demo-web/`) en embarquent leur copie par analyse statique des `require`. Ne rien mettre de privé dans `public/` (un test le vérifie).
- `demo-web/` — aussi `lib/` (règles, triage, Jev, outils, agent, stockage, handlers), `config/` (`agent.json`, `regles.json`, `jev.json`), `data/`, `test/`, `scripts/`
- `ml/` — scoring de référence (règles + régression logistique) et features documentées. La régression logistique n'est ni exécutée ni affichée par la démo (partie probabiliste prévue au lot 2)
- `data-mock/` — données fictives (sinistres, polices, procès-verbaux, scores)
- `scripts/` — générateur de données reproductible (l'ancien `test-prompts.py`, prototype appelant l'API payante, a été supprimé ; l'historique git le garde)
- `docs/` — audit du 30/09/2026 (état d'origine)

## Commandes (depuis `demo-web/`)

- `npm test` — tous les tests, sans réseau ni clé (faux client Anthropic, faux Redis, faux Jev, horloge simulée)
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
- Pas de « zéro stockage » ni de « jamais envoyée ailleurs » : les saisies sont traitées par Anthropic (conservation jusqu'à 30 jours, sauf exceptions) ; si un récit ou rapport est saisi, ces textes sont transmis à Jev (TypeSafe AI, via Vercel AI Gateway) — durée de conservation non fixée par TypeSafe AI (aussi longtemps que raisonnablement nécessaire à ses services ou à ses activités). Jamais : « zéro stockage », ZDR (indisponible en Hobby), « données en Europe ». L'état de session est gardé 30 min dans Upstash. Hébergement aux États-Unis.
- Pas de fusion ni de déploiement en production par Claude.

## Suite prévue

Lot 2 : triage Jev (TypeSafe). Sous-lot 2.1 fait sur la branche `lot2-jev` (implémentation mockée, aucun appel réel testé). 2.2 fait : rejeux réenregistrés le 02/10/2026 sous le prompt 2026-10-02 (sans Jev : `jev: null` dans `scripts/record-replays.mjs`). Reste : 2.3 textes visiteur (dont les chiffres mesurés, à mettre à jour avec cet enregistrement) (bloc d'information, « Comment ça marche », badge « Règles seules — aucun appel IA », mention de TypeSafe/Gateway dans la confidentialité), puis test en prévisualisation (OIDC, fournisseur, budget Gateway). Non vérifié à ce jour : forme de `providerMetadata.typesafe.confidence`, comportement réel de la Gateway face à `only` et `disallowPromptTraining`, OIDC dans une Function sans framework. Lot 3 : évaluation sur 6 dossiers, dont un dossier « fraude documentaire » avec incohérence assumée. Lot 4 : vitrine (autre dépôt).

*Contact : sebastien@tkoidra.com*
