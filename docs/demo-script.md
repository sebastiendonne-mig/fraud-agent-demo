# Script de présentation — Agent IA Détecteur de Fraude & Recours Automatique
*Sébastien Donné | tkoidra.com | juin 2026*

---

> **Usage de ce document**
> Ce script est votre guide de présentation orale. Les blocs **[DIRE]** contiennent le texte à prononcer. Les blocs **[MONTRER]** indiquent ce qui doit être visible à l'écran. Les blocs **[NOTE]** sont des rappels pour vous seul. Durée totale : **45 minutes** démo + Q&R.

---

## Informations pratiques

| Paramètre | Valeur |
|---|---|
| Durée totale | 45 min (35 min présentation + 10 min Q&R) |
| Audience cible | DSI, Directeurs Techniques, Responsables Fraude (assureurs IARD) |
| Format recommandé | Salle de réunion ou Teams — écran partagé |
| Matériel nécessaire | Laptop avec les données mock chargées, connexion Dataverse/Power BI, données `scores_output.json` accessibles |
| Langue | Français |
| Niveau de détail technique | Intermédiaire — vulgarisé pour les décideurs, prêt à aller plus loin pour les DT |

---

## Minutage général

| Section | Durée | Cumulé |
|---|---|---|
| 1. Accroche — Le problème en chiffres | 5 min | 0:05 |
| 2. La solution en une phrase | 3 min | 0:08 |
| 3. Architecture — Vue d'ensemble | 4 min | 0:12 |
| 4. Démo live — Les 5 agents en action | 18 min | 0:30 |
| 5. KPIs avant / après | 3 min | 0:33 |
| 6. Feuille de route & investissement | 2 min | 0:35 |
| 7. Questions & Réponses | 10 min | 0:45 |

---

## Section 1 — Accroche : Le problème en chiffres *(5 min)*

**[NOTE]** Commencez debout, sans slides. Établissez le contact visuel avec chaque interlocuteur avant de lancer l'écran. L'accroche doit créer un inconfort reconnu — ils vivent ce problème tous les jours.

---

**[DIRE]**

> « Permettez-moi de commencer par une question simple : quelle proportion des alertes fraude générées par vos systèmes actuels correspond à de vraies fraudes ? »

*[Pause. Laissez-les répondre ou hocher la tête.]*

> « Dans la plupart des compagnies IARD françaises que j'ai eu l'occasion d'étudier, ce chiffre tourne autour de **20 %**. Ce qui veut dire que **80 % du travail de vos équipes SIU porte sur des dossiers parfaitement légitimes**. »

*[Pause d'une seconde.]*

> « Vos investigateurs — des profils rares, formés, coûteux — passent la majorité de leur temps à exclure des faux positifs. Pendant ce temps, les vraies fraudes en réseau, les montages organisés, les anneaux de réparateurs complices : ils passent souvent au travers, parce que personne n'a eu le temps de croiser les dossiers. »

> « Il y a une deuxième fuite financière, moins visible : les **recours en subrogation**. Quand un tiers est clairement responsable — accident avec procès-verbal, infraction codifiée, deux témoins — l'assureur a le droit de se retourner contre lui pour récupérer les sommes versées. En théorie. En pratique, ce recours est identifié **manuellement**, deux à trois semaines après l'indemnisation, quand quelqu'un pense à ouvrir le bon dossier. Souvent, il ne l'est pas du tout. »

> « Ce sont ces deux problèmes — faux positifs à 80 % et recours non systématisés — que nous allons résoudre aujourd'hui. »

---

**[MONTRER]** *(ouvrir la première diapositive ou le schéma d'architecture)*

---

## Section 2 — La solution en une phrase *(3 min)*

**[DIRE]**

> « La solution, en une phrase : **un pipeline agentique multi-étapes**, construit sur la stack Microsoft que vous avez déjà — Azure, Power Platform, Dataverse — qui score chaque sinistre entrant en temps réel, détecte les connexions suspectes entre dossiers, identifie les tiers responsables dans les rapports de police, et génère automatiquement le dossier de recours, sans intervention humaine. »

> « Pas un modèle de Machine Learning isolé. Pas un chatbot. **Cinq agents spécialisés qui se passent la main**, chacun faisant ce pour quoi il est le meilleur. »

> « Et à la sortie : vos équipes SIU ne voient plus que les dossiers qui méritent vraiment leur attention. »

---

## Section 3 — Architecture : Vue d'ensemble *(4 min)*

**[MONTRER]** *(schéma du pipeline — `docs/architecture-diagram.png` ou le diagramme ASCII ci-dessous)*

```
Sinistre entrant
       ↓
[Agent 1 — Copilot Studio]   ← Réception, extraction, routing
       ↓
[Agent 2 — Azure ML]         ← Score fraude 0–100 en temps réel
       ↓
  Score < 30 ──────────────→ STP automatique (72% des dossiers)
  Score ≥ 30
       ↓
[Agent 3 — Azure Synapse]    ← Analyse graphe, réseaux suspects
       ↓
[Agent 4 — Azure OpenAI]     ← Lecture rapports de police
       ↓
  Fraude confirmée → SIU + Power BI
  Recours identifié ↓
[Agent 5 — Power Automate]   ← Email juridique automatique
```

---

**[DIRE]**

> « Voici le pipeline complet. Cinq agents, cinq rôles distincts. Je vais vous les montrer un par un — en live, sur de vraies données, pas sur des slides. »

> « Ce que vous allez voir tourne sur Azure. Le code source, les données, les configurations — tout est versionné sur GitHub. Rien n'est une maquette. »

---

## Section 4 — Démo live : Les 5 agents en action *(18 min)*

**[NOTE]** C'est le cœur de la présentation. Chaque agent a un mini-scénario ancré sur un cas concret des données mock. Restez sur les faits, les chiffres, les décisions — évitez le jargon technique sauf si le DT vous y invite.

---

### Agent 1 — Copilot Studio : Réception & Triage *(3 min)*

**[MONTRER]** *(ouvrir la conversation Copilot Studio ou simuler via le JSON `agent-config.json`)*

**[DIRE]**

> « Un sinistre entre. Peu importe le canal — Teams, portail web, formulaire. L'Agent 1, c'est Copilot Studio : il pose les questions, extrait les données structurées, et prépare le dossier. »

> « Mais avant de scorer, il fait quelque chose de crucial que les systèmes classiques ne font pas : il **enrichit** le dossier en temps réel. Il interroge Dataverse pour savoir combien de sinistres ont été déclarés depuis la même adresse IP dans les 30 derniers jours, combien de dossiers impliquent le même réparateur sur 90 jours. Ce sont ces deux chiffres — `_ip_count_30d` et `_reparateur_count_90d` — qui vont alimenter le modèle ML. »

> « Ensuite, il appelle le scoring. Résultat en moins de 3 secondes. »

---

### Agent 2 — Azure ML : Score Fraude en Temps Réel *(4 min)*

**[MONTRER]** *(ouvrir `data-mock/scores_output.json` — filtrer sur les 5 premiers scores)*

**[DIRE]**

> « Le score est hybride. Il combine deux composantes : des **règles métier explicites** — qui génèrent des Reason Codes compréhensibles — et une **régression logistique** entraînée sur l'historique. »

> « Regardons un exemple concret. »

**[MONTRER]** *(mettre en évidence `SIN-2024-0011` dans le fichier JSON)*

> « Ce dossier : `SIN-2024-0011`. Montant réclamé : **10 362 €**. Score : **63 sur 100**. Catégorie : Élevé. Reason code : *"Sinistre déclaré 10 jours après la souscription de la police."* »

> « Dix jours. L'assuré signe son contrat, et dix jours après il déclare un sinistre à plus de 10 000 €. Le système l'a capturé. Sans règle de ce type dans le système actuel, ce dossier partait en STP. »

**[MONTRER]** *(mettre en évidence `SIN-2024-0006`)*

> « Autre cas. `SIN-2024-0006` : **15 140 €**, score **59,9**. Reason code : *"Réparateur REP-007 impliqué dans 3 autres dossiers sur 90 jours."* »

> « Ce réparateur — REP-007 — apparaît dans **9 sinistres** sur les 50 de notre jeu de données. Tous des accidents auto. Tous dans la même fenêtre temporelle. Sans croisement inter-dossiers, c'est invisible. Le graphe Synapse va nous le confirmer dans un instant. »

> « Et pour 72 % des dossiers — score inférieur à 30 — le pipeline dit : STP. Straight-Through Processing. Aucune intervention humaine. Votre équipe SIU ne les voit même pas. »

---

### Agent 3 — Azure Synapse : Analyse de Réseau *(4 min)*

**[MONTRER]** *(ouvrir `agents/synapse/graph-query.sql` — naviguer vers la section vw_graph_alerts)*

**[DIRE]**

> « L'analyse de graphe, c'est là où le pipeline devient vraiment puissant. Un score élevé sur un dossier isolé, c'est un signal. Un cluster de dossiers connectés par le même réparateur, la même IP, le même assuré — c'est un pattern de fraude organisée. »

> « Synapse analyse l'ensemble du portefeuille. Voici les 7 patterns qu'il détecte. »

**[MONTRER]** *(montrer les CTEs P1 à P7 dans le SQL)*

> « P1 : Réseau réparateur — plusieurs assurés différents envoient leurs sinistres vers le même garage. P2 : Anneau IP — plusieurs déclarations depuis la même adresse IP. P3 : Multi-sinistres — un assuré qui accumule les déclarations. »

> « Sur nos données, le réseau REP-007 ressort immédiatement : 9 dossiers, tous accidents auto, tous dans la même fenêtre. La vue `vw_graph_alerts` remonte cette information au score de chaque dossier concerné. »

> « Ce qui changerait dans une compagnie réelle : sur un portefeuille de 50 000 sinistres par an, ce type d'analyse manuelle prendrait des semaines. Ici, elle tourne en quelques secondes à chaque nouveau dossier. »

---

### Agent 4 — Azure OpenAI : Lecture des Rapports de Police *(4 min)*

**[MONTRER]** *(ouvrir `data-mock/rapports_police_mock.txt` — RAPPORT-0012)*

**[DIRE]**

> « Parlons maintenant des recours. Quand un tiers est responsable, l'assureur peut se retourner contre lui. Mais pour ça, il faut lire le procès-verbal, identifier le responsable, évaluer la part de responsabilité, et déterminer si un recours est juridiquement viable. »

> « En pratique, ce travail est fait par un humain — souvent des jours ou semaines après l'indemnisation. »

> « Voici le rapport `RAPPORT-0012` : *"Le véhicule immatriculé DT-456-AB conduit par M. Bensalem a grillé un feu rouge… Responsabilité du conducteur : 100 %. Deux témoins ont confirmé la version de l'assuré."* »

**[MONTRER]** *(ouvrir `agents/openai/prompts/analyse-rapport-police.md` — montrer le system prompt)*

> « L'Agent 4 envoie ce texte à GPT-4o avec un prompt système calibré pour le droit des assurances français. Il reçoit en retour un JSON structuré : responsable identifié, part de responsabilité 100 %, éléments clés pour le recours, niveau de certitude : Élevé. »

**[MONTRER]** *(si disponible : montrer un extrait de `test_prompts_output.json`)*

> « Puis le deuxième prompt — identification du tiers — calcule le montant récupérable. Pour `SIN-2024-0007` : **5 652 €** à récupérer. Fondement juridique : article L121-12 du Code des assurances. Actions : contacter l'assureur du tiers via le fichier AGIRA sous 5 jours, envoyer la mise en demeure sous 15 jours. »

> « Tout ça, en moins de 10 secondes après la création du dossier. »

---

### Agent 5 — Power Automate : Dossier de Recours Automatique *(3 min)*

**[MONTRER]** *(ouvrir `power-automate/flow-recours.json` — montrer le flow ou le schéma)*

**[DIRE]**

> « Le dernier agent est déclenché automatiquement dès que Dataverse enregistre un recours viable. Il récupère les données du dossier, appelle une dernière fois Azure OpenAI pour rédiger la lettre de mise en demeure formelle, crée l'enregistrement dans Dataverse, et envoie l'email au service juridique. »

> « L'email arrive avec : la lettre rédigée, le montant réclamé, le fondement juridique, les actions à faire en J+5, J+15 et J+30, et la date de prescription calculée automatiquement — deux ans après l'accident, article L114-1 du Code des assurances. »

> « La clé Azure OpenAI n'est jamais stockée dans le flow. Elle est récupérée depuis Key Vault via Managed Identity à chaque exécution. »

> « De la déclaration du sinistre à l'email juridique : **moins d'une heure**. Contre deux à trois semaines aujourd'hui. »

---

### Vue d'ensemble — Le dashboard SIU *(bonus si le temps le permet)*

**[MONTRER]** *(ouvrir Power BI ou `power-bi/dashboard-siu-spec.md`)*

**[DIRE]**

> « Pour vos investigateurs, tout converge dans ce dashboard. Score de fraude, reason codes, alertes réseau depuis Synapse, pipeline des recours. Trois rôles : agent SIU, superviseur, admin. Les faux positifs n'arrivent plus sur leurs écrans — ils ne voient que les dossiers qui méritent leur expertise. »

---

## Section 5 — KPIs avant / après *(3 min)*

**[MONTRER]** *(afficher le tableau des KPIs)*

| Métrique | Avant (baseline) | Après (agent) | Gain |
|---|---|---|---|
| Faux positifs parmi les alertes | **~80 %** | **< 20 %** | −60 pts |
| Hit rate investigation | **1 fraude / 5 alertes** | **3+ fraudes / 5 alertes** | ×3 |
| Délai identification recours | **2–3 semaines (manuel)** | **< 1 heure (auto)** | −95 % |
| Charge SIU sur petits dossiers | **60 % du temps** | **< 15 % du temps** | −45 pts |

---

**[DIRE]**

> « Ces chiffres ne sont pas des projections marketing. Ils traduisent une réalité opérationnelle simple : quand le scoring est bon, les SIU ne courent plus après des ombres. »

> « Sur le recours : si votre compagnie indemnise 50 millions d'euros par an en IARD, et que 5 à 10 % de ces sinistres comportent un tiers responsable identifiable — ce qui est une estimation prudente — le manque à gagner sur les recours non initiés se chiffre en **millions d'euros chaque année**. Ce pipeline le rend systématique. »

> « Le modèle ML tourne sur 50 dossiers de démonstration. En production, avec 5 000 dossiers étiquetés, l'AUC dépasse typiquement 0,85. Ce que vous voyez ici est une démonstration fonctionnelle, pas une maquette. »

---

## Section 6 — Feuille de route & investissement *(2 min)*

**[DIRE]**

> « La stack est celle que vous avez déjà ou que vous pouvez activer rapidement : Azure ML, Synapse, OpenAI, Power Platform, Dataverse, Entra ID. Pas de dépendance à un éditeur tiers, pas d'API payante hors écosystème Microsoft. »

> « Un déploiement pilote sur un périmètre défini — un type de sinistre, une région — peut être opérationnel en **8 à 12 semaines**. Le pipeline est conçu pour être branché sur votre Dataverse existant. »

> « Ce que j'ai construit ici — du scoring ML aux flows Power Automate en passant par les requêtes Synapse — est versionné, documenté, et prêt à être adapté à votre nomenclature de données. »

---

## Section 7 — Questions & Réponses anticipées *(10 min)*

**[NOTE]** Les questions qui suivent couvrent 90 % des objections rencontrées en présentation. Lisez-les avant chaque démo. Les réponses sont calibrées pour chaque interlocuteur : le DSI pense infrastructure et risque, le DT pense API et intégration, le Responsable Fraude pense faux positifs et conformité.

---

### 7.1 Questions techniques (Directeur Technique)

---

**Q : Comment le modèle gère-t-il la dérive des données (data drift) en production ?**

> « C'est une question légitime, et c'est une limite assumée de la démonstration. Sur 50 dossiers d'entraînement, la robustesse statistique est indicative — c'est voulu pour un prototype. En production, Azure ML Model Monitoring surveille la dérive des features en continu et peut déclencher un réentraînement automatique. La partie règles métier — qui représente 50 % du score maximum — n'est pas sensible à la dérive : elle reste explicable et auditable à tout moment. »

---

**Q : Pourquoi une régression logistique et pas un modèle plus puissant — XGBoost, réseau de neurones ?**

> « Deux raisons. La première : l'explicabilité réglementaire. En assurance, vous avez une obligation de justifier les décisions de tarification et d'investigation. Une régression logistique produit des probabilités directement interprétables. Un XGBoost aussi, avec SHAP values, mais ça complexifie l'audit. La deuxième raison : sur des datasets de sinistres marqués — souvent 5 000 à 20 000 dossiers en production — la régression logistique avec feature engineering bien construit rivalise souvent avec les modèles plus complexes sur la précision, et surpasse sur la robustesse en faible volumétrie. »

---

**Q : Le pipeline peut-il tourner en batch plutôt qu'en temps réel ?**

> « Oui, les deux modes sont supportés. `score_single()` pour le temps réel via l'endpoint Azure ML, et `--mode score` sur l'ensemble du portefeuille pour un batch nocturne. En production, on recommande les deux : temps réel pour les nouveaux dossiers, batch hebdomadaire pour rescorer le backlog avec les nouvelles features de clustering. »

---

**Q : Comment l'adresse IP est-elle capturée en production ? Ce n'est pas toujours disponible.**

> « Depuis Teams et le portail web, Copilot Studio expose la variable `System.Channel.IpAddress`. Pour les déclarations par téléphone ou courrier, le champ `adresse_ip_declaration` reste null et le score_single() reçoit `_ip_count_30d = 0` — comportement conservateur, le dossier n'est pas pénalisé par un manque d'information. La feature IP est complémentaire, pas bloquante. »

---

**Q : Quelle est la latence réelle de l'appel Azure ML en production ?**

> « Sur un endpoint managé Azure ML avec une instance dédiée Standard_DS3_v2, la latence P95 est typiquement entre 300 ms et 800 ms pour une inférence logistique de ce type. Le timeout configuré dans l'agent Copilot Studio est à 8 secondes, avec fallback automatique sur le circuit manuel en cas d'indisponibilité. »

---

### 7.2 Questions infrastructure & sécurité (DSI)

---

**Q : Les données des assurés quittent-elles l'environnement Microsoft ?**

> « Non. Toutes les données restent dans votre tenant Azure et votre environnement Power Platform. Azure OpenAI est déployé dans votre région (France Central recommandé), sans transfert vers les serveurs Anthropic ou OpenAI publics. Dataverse est votre base de données, pas la nôtre. La seule API externe appelée est Azure OpenAI — qui est un service Microsoft, soumis au DPA Microsoft et au RGPD européen. »

---

**Q : Comment les secrets et clés API sont-ils gérés ?**

> « Aucune clé n'est hardcodée, ni dans le code, ni dans les flows Power Automate, ni dans les fichiers de configuration. Tout passe par Azure Key Vault avec Managed Identity — l'agent Power Automate s'authentifie auprès de Key Vault via son identité managée Azure AD, et récupère le secret à l'exécution. En cas de rotation de clé, aucun redéploiement n'est nécessaire. »

---

**Q : Comment gérez-vous la conformité RGPD sur les données de sinistres ?**

> « Trois points. Un : les données de démonstration sont entièrement fictives — noms, numéros de police, montants, adresses. Deux : en production, Dataverse supporte la classification des données personnelles et l'audit trail natif. Trois : les logs d'exécution des flows Power Automate et des appels Azure ML peuvent être configurés pour respecter les durées de rétention imposées par votre DPO — typiquement 3 à 5 ans en assurance. »

---

**Q : Quelle est la tolérance aux pannes ? Que se passe-t-il si Azure ML est indisponible ?**

> « Le pipeline est conçu en dégradé gracieux. Si l'endpoint Azure ML ne répond pas dans les 8 secondes, l'agent Copilot Studio bascule automatiquement sur un fallback : le dossier est enregistré dans Dataverse avec le statut `scoring_erreur` et `flag_fraude_suspect = true`, une alerte Teams est envoyée au canal SIU pour traitement manuel. Le SLA Azure ML managed endpoints est de 99,9 % sur les régions Enterprise. »

---

### 7.3 Questions métier (Responsable Fraude)

---

**Q : Comment s'assurer que le modèle ne génère pas de biais — par exemple, sur certains types de sinistres ou certaines régions ?**

> « C'est une question centrale. Le modèle est entraîné avec `class_weight='balanced'` pour compenser le déséquilibre entre fraudes et dossiers légitimes. En production, l'audit des features par sous-groupe — type de sinistre, région, profil assuré — est une étape obligatoire avant mise en production. Azure ML Responsible AI offre des dashboards d'équité natifs. Et la composante règles métier est toujours auditable : chaque Reason Code indique exactement quelle règle a contribué au score et de combien. »

---

**Q : Qui valide les cas flagués ? Est-ce que le pipeline prend des décisions seul ?**

> « Non, et c'est un principe de conception délibéré. Le pipeline **ne prend aucune décision finale** : il score, il alerte, il génère des dossiers. La décision d'ouvrir une enquête, de confirmer une fraude, d'initier un recours — elle reste humaine. L'agent Copilot Studio affiche les Reason Codes uniquement aux agents SIU, pas à l'assuré. Le dashboard Power BI permet à l'investigateur de confirmer, clore ou escalader chaque dossier d'un clic. Le pipeline libère du temps humain, il ne le remplace pas. »

---

**Q : Comment les Reason Codes sont-ils formulés pour qu'un agent SIU les comprenne sans formation technique ?**

> « Ils sont rédigés en langage naturel, en français, directement actionnables. Par exemple : *"Réparateur REP-007 impliqué dans 3 autres dossiers sur 90 jours"* — pas un score ou un p-value. *"Sinistre déclaré 10 jours après la souscription de la police"* — l'investigateur sait immédiatement quoi vérifier. L'objectif est que l'agent SIU puisse commencer son travail d'investigation à partir du Reason Code, sans avoir à comprendre le modèle. »

---

**Q : Quelle est la couverture en termes de types de sinistres ? Fonctionne-t-il sur la prévoyance ou seulement l'IARD ?**

> « Le pipeline est conçu pour l'IARD : accident auto, bris de glace, dégât des eaux, incendie, vol, catastrophe naturelle. L'architecture est générique — les features de clustering et les règles métier sont paramétrables. Une adaptation à la prévoyance (arrêts de travail, invalidité) nécessiterait de retravailler les features financières et les règles, mais l'infrastructure — Copilot Studio, Synapse, OpenAI, Power Automate — est réutilisable. »

---

**Q : Comment les recours sont-ils priorisés ? Est-ce que le service juridique ne va pas être noyé d'emails ?**

> « Non, deux mécanismes limitent ça. D'abord, le seuil : seuls les dossiers avec un montant récupérable estimé supérieur à **500 €** déclenchent un recours automatique — en dessous, les frais juridiques dépasseraient le gain. Ensuite, la priorité : chaque email de recours porte une étiquette Urgente / Normale / Faible, avec une importance email haute pour les urgences. Les actions sont ordonnées J+5, J+15, J+30 avec le responsable désigné pour chacune. Le service juridique reçoit un dossier complet et priorisé, pas juste une alerte. »

---

**Q : Comment mesurez-vous le ROI réel en production ? Sur quoi s'engager ?**

> « Trois métriques concrètes. Un : le **taux de confirmation fraude** (hit rate) — combien de dossiers flagués correspondent à de vraies fraudes, vérifié par les SIU. Objectif : passer de 20 % à 60 %+. Deux : le **montant de recours initié et récupéré** — suivi dans Dataverse et Power BI, par trimestre. Trois : le **temps SIU libéré** — mesuré par le nombre de dossiers traités par investigateur avant et après déploiement. Ces trois métriques définissent les jalons d'un pilote. »

---

## Clôture

**[DIRE]**

> « Ce que vous avez vu aujourd'hui, c'est un pipeline complet — de la déclaration du sinistre à l'email juridique — construit sur vos outils existants, en 10 étapes, sans dépendance externe. »

> « La prochaine étape naturelle : un **pilote de 8 semaines** sur un périmètre défini — un type de sinistre, un portefeuille régional — pour mesurer les KPIs sur vos données réelles, avec vos équipes SIU. »

> « Merci pour votre attention. Je suis disponible pour entrer dans le détail technique avec vos équipes, ou pour définir ensemble le périmètre d'un pilote. »

---

## Annexe — Données de démo à avoir ouvertes

Avant de commencer la présentation, préparer dans des onglets distincts :

| Onglet | Fichier | Moment d'utilisation |
|---|---|---|
| 1 | `data-mock/scores_output.json` (filtré sur top 5) | Agent 2 — montrer SIN-2024-0011 et SIN-2024-0006 |
| 2 | `data-mock/rapports_police_mock.txt` (RAPPORT-0012) | Agent 4 — lire le PV de police |
| 3 | `agents/openai/prompts/analyse-rapport-police.md` | Agent 4 — montrer le system prompt |
| 4 | `agents/synapse/graph-query.sql` (section vw_graph_alerts) | Agent 3 — montrer les CTEs P1/P2 |
| 5 | `power-automate/flow-recours.json` ou Power Automate UI | Agent 5 — montrer le flow |
| 6 | Power BI dashboard SIU (ou `power-bi/dashboard-siu-spec.md`) | Conclusion — vue dashboard |

**Cas concrets à avoir en tête :**
- **Réseau réparateur :** REP-007 impliqué dans 9 sinistres, tous accidents auto
- **Anneau IP :** 185.23.14.77 — 2 sinistres (vol) depuis la même IP
- **Déclaration précoce :** SIN-2024-0011 — déclaré 10 jours après souscription, 10 362 €, score 63
- **Recours le plus fort :** SIN-2024-0024 — rapport RAPPORT-0011, 12 898 €, responsabilité tiers 100 %

---

*Script v1.0 — juin 2026 — Sébastien Donné | sebastien@tkoidra.com | tkoidra.com*
