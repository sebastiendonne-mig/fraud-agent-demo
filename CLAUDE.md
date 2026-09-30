# CLAUDE.md — Agent de détection de fraude & recours (fraud-agent-demo)

Vitrine de prospection de Sébastien Donné (tkoidra.com). Public visé : recruteurs et décideurs IA. Détail : voir le README.

## État réel du projet (30/09/2026)

- La démo web (`demo-web/`, https://fraud.tkoidra.com) tourne sur **Claude uniquement**. Aucun composant Microsoft n'est exécuté.
- L'analyse en direct est **suspendue** pendant la refonte (lot 0, fait).
- Le scoring déterministe (`ml/scoring-model.py`) fonctionne hors ligne. Il n'est pas encore branché sur la démo web.
- Refonte en lots, chacun sur sa branche et sa PR, **fusionnée par Sébastien** (jamais par Claude) :
  - **0b** : nettoyage du dépôt, données et libellés neutralisés (en cours) ;
  - **1** : agent côté serveur. Règles déterministes → triage → agent Claude à outils bornés, seulement si le dossier n'est pas STP ou si un rapport de police est fourni → décision proposée, validation humaine, puis finalisation ;
  - **2** : triage probabiliste ; **3** : évaluation sur 6 dossiers.
- Le routage fraude est une règle métier calculée par du code, jamais une opinion du modèle.

## Structure

- `data-mock/` — données fictives (sinistres, polices, procès-verbaux, scores)
- `demo-web/` — page statique et fonctions Vercel
- `docs/` — audit du 30/09/2026
- `ml/` — scoring (règles + régression logistique) et features documentées
- `prompts/` — prompts versionnés
- `scripts/` — générateur de données, test des prompts

## Règles de développement

- Commentaires du code Python en **français**, variables et fonctions en **anglais** (snake_case).
- Aucune clé API dans le code ni dans git : variables d'environnement uniquement (hook gitleaks au commit).
- Les prompts sont versionnés dans `prompts/` ; ne pas les modifier sans test.
- Les règles de scoring ont une **seule source de vérité** : `ml/scoring-model.py`.
- Chaque brique est testée individuellement avant intégration.
- On travaille avec Claude Code dans le terminal.

## Données

- **Uniquement des données fictives.** Jamais de données personnelles réelles, même partielles.
- Identifiants manifestement fictifs : adresses IP des plages de documentation (RFC 5737), plaques `DEMO-xxx`, noms de garages « … Démo X », aucune marque réelle d'assureur.
- `scripts/generate-mock-data.py` est reproductible (graine 42) : modifier l'ordre des tirages aléatoires change les montants.

## Ce que je ne veux pas

- Aucune affirmation non vérifiée dans la démo ou la documentation (chiffres, KPI, promesses de confidentialité).
- Pas de « zéro stockage » ni de « jamais envoyée ailleurs » : les données saisies sont traitées par Anthropic (conservation jusqu'à 30 jours, source officielle à citer).
- Pas de fusion ni de déploiement en production par Claude.

*Contact : sebastien@tkoidra.com*
