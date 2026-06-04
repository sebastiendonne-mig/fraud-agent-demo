-- =============================================================================
-- ANALYSE DE GRAPHES — Détection de connexions suspectes inter-dossiers
-- Azure Synapse Analytics — Dedicated SQL Pool
-- Agent 3 du pipeline agentique fraude
-- =============================================================================
--
-- Modèle de graphe :
--   Nœuds  : Sinistre · Assuré · Réparateur · IP · Police
--   Arêtes : Assuré ──a_déclaré──► Sinistre
--            Sinistre ──utilisé──► Réparateur
--            Sinistre ──déclaré_depuis──► IP
--            Assuré ──détient──► Police
--
-- Patterns détectés :
--   [P1] Réseau réparateur   — même réparateur, N sinistres sur 90 jours
--   [P2] Anneau d'IP         — même IP partagée par des assurés distincts
--   [P3] Assuré multi-claim  — même assuré, plusieurs sinistres en 12 mois
--   [P4] Liens croisés       — assurés connectés par 2+ nœuds communs
--   [P5] Centralité nœud     — degré de connexion de chaque nœud du graphe
--   [P6] Composantes connexes — clusters d'assurés liés (fraude en anneau)
--   [P7] Fenêtre temporelle  — rafales de sinistres dans un cluster (< 30 j)
--
-- Toutes les requêtes sont paramétrables via les déclarations DECLARE en tête.
-- Sortie finale : vue [fraud].[vw_graph_alerts] consommée par Power BI.
-- =============================================================================


-- =============================================================================
-- 0. PARAMÈTRES GLOBAUX
-- =============================================================================

DECLARE @fenetre_reparateur_jours   INT = 90;   -- [P1] fenêtre cluster réparateur
DECLARE @seuil_reparateur_sinistres INT = 3;    -- [P1] nb min de sinistres pour alerte
DECLARE @fenetre_ip_jours           INT = 30;   -- [P2] fenêtre cluster IP
DECLARE @fenetre_multiclaim_mois    INT = 12;   -- [P3] fenêtre assuré multi-sinistres
DECLARE @seuil_multiclaim           INT = 2;    -- [P3] nb min de sinistres pour alerte
DECLARE @seuil_centralite           INT = 3;    -- [P5] degré min pour classer un nœud « hub »
DECLARE @fenetre_rafale_jours       INT = 30;   -- [P7] fenêtre de rafale temporelle


-- =============================================================================
-- 1. VUES DE BASE DU GRAPHE
--    Matérialisation des arêtes dans des CTE réutilisables.
--    En production : remplacer par des vues permanentes dans le schéma [fraud].
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a. Arêtes Sinistre ──► Réparateur
-- -----------------------------------------------------------------------------
-- CREATE OR ALTER VIEW fraud.vw_edge_sinistre_reparateur AS
WITH edge_sinistre_reparateur AS (
    SELECT
        s.id_sinistre,
        s.id_assure,
        s.id_reparateur,
        s.date_declaration,
        s.type                  AS type_sinistre,
        s.montant_reclame,
        s.score_fraude,
        s.statut
    FROM fraud.sinistres s
    WHERE s.id_reparateur IS NOT NULL
),

-- -----------------------------------------------------------------------------
-- 1b. Arêtes Sinistre ──► IP
-- -----------------------------------------------------------------------------
edge_sinistre_ip AS (
    SELECT
        s.id_sinistre,
        s.id_assure,
        s.adresse_ip_declaration AS ip,
        s.date_declaration
    FROM fraud.sinistres s
    WHERE s.adresse_ip_declaration IS NOT NULL
),

-- -----------------------------------------------------------------------------
-- 1c. Arêtes Assuré ──► Police
-- -----------------------------------------------------------------------------
edge_assure_police AS (
    SELECT
        p.id_assure,
        p.id_police,
        p.date_souscription,
        p.plafond_garantie,
        p.franchise,
        p.type_contrat
    FROM fraud.polices p
    WHERE p.statut_police = 'active'
),


-- =============================================================================
-- 2. [P1] CLUSTERS RÉPARATEUR
--    Détecte les réparateurs impliqués dans plusieurs sinistres sur une fenêtre
--    glissante de @fenetre_reparateur_jours jours.
--    Signal : réseau de réparateurs complices.
-- =============================================================================
cluster_reparateur AS (
    SELECT
        a.id_reparateur,
        a.id_sinistre                                   AS id_sinistre_pivot,
        a.id_assure                                     AS id_assure_pivot,
        a.date_declaration                              AS date_pivot,
        b.id_sinistre                                   AS id_sinistre_lie,
        b.id_assure                                     AS id_assure_lie,
        b.date_declaration                              AS date_lie,
        DATEDIFF(DAY, a.date_declaration, b.date_declaration) AS ecart_jours
    FROM edge_sinistre_reparateur a
    JOIN edge_sinistre_reparateur b
        ON  a.id_reparateur    = b.id_reparateur
        AND a.id_sinistre     <> b.id_sinistre          -- exclure auto-jointure
        AND a.id_assure       <> b.id_assure            -- assurés distincts
        AND ABS(DATEDIFF(DAY, a.date_declaration, b.date_declaration))
            <= @fenetre_reparateur_jours
),

-- Compter les sinistres distincts par réparateur dans la fenêtre
cluster_reparateur_summary AS (
    SELECT
        id_reparateur,
        COUNT(DISTINCT id_sinistre_lie) AS nb_sinistres_lies,
        COUNT(DISTINCT id_assure_lie)   AS nb_assures_distincts,
        MIN(ecart_jours)                AS ecart_min_jours,
        MAX(ABS(ecart_jours))           AS ecart_max_jours,
        STRING_AGG(DISTINCT id_sinistre_lie, ', ')
            WITHIN GROUP (ORDER BY id_sinistre_lie)     AS sinistres_lies
    FROM cluster_reparateur
    GROUP BY id_reparateur
    HAVING COUNT(DISTINCT id_sinistre_lie) >= @seuil_reparateur_sinistres - 1
),

-- Alerte finale P1
alerte_p1_reparateur AS (
    SELECT
        'P1_RESEAU_REPARATEUR'          AS pattern_code,
        r.id_reparateur                 AS noeud_central,
        'Réparateur'                    AS type_noeud,
        crs.nb_sinistres_lies + 1       AS nb_sinistres_impliques,
        crs.nb_assures_distincts        AS nb_assures_distincts,
        crs.ecart_min_jours             AS ecart_min_jours,
        crs.ecart_max_jours             AS ecart_max_jours,
        crs.sinistres_lies              AS sinistres_lies,
        CASE
            WHEN crs.nb_sinistres_lies >= 5 THEN 'Critique'
            WHEN crs.nb_sinistres_lies >= 3 THEN 'Élevé'
            ELSE 'Moyen'
        END                             AS niveau_alerte,
        CONCAT(
            'Réparateur ', r.id_reparateur,
            ' associé à ', crs.nb_sinistres_lies + 1, ' sinistres ',
            'sur ', crs.ecart_max_jours, ' jours (',
            crs.nb_assures_distincts, ' assurés distincts)'
        )                               AS description_alerte
    FROM cluster_reparateur_summary crs
    JOIN (SELECT DISTINCT id_reparateur FROM edge_sinistre_reparateur) r
        ON crs.id_reparateur = r.id_reparateur
),


-- =============================================================================
-- 3. [P2] ANNEAUX D'IP PARTAGÉE
--    Détecte les adresses IP utilisées par plusieurs assurés distincts
--    sur une fenêtre de @fenetre_ip_jours jours.
--    Signal : déclarations coordonnées depuis un même point de connexion.
-- =============================================================================
cluster_ip AS (
    SELECT
        a.ip,
        a.id_sinistre                                   AS id_sinistre_a,
        a.id_assure                                     AS id_assure_a,
        a.date_declaration                              AS date_a,
        b.id_sinistre                                   AS id_sinistre_b,
        b.id_assure                                     AS id_assure_b,
        b.date_declaration                              AS date_b,
        ABS(DATEDIFF(DAY, a.date_declaration, b.date_declaration)) AS ecart_jours
    FROM edge_sinistre_ip a
    JOIN edge_sinistre_ip b
        ON  a.ip          = b.ip
        AND a.id_sinistre <> b.id_sinistre
        AND a.id_assure   <> b.id_assure               -- assurés distincts obligatoire
        AND ABS(DATEDIFF(DAY, a.date_declaration, b.date_declaration))
            <= @fenetre_ip_jours
),

alerte_p2_ip AS (
    SELECT
        'P2_ANNEAU_IP'                  AS pattern_code,
        ip                              AS noeud_central,
        'IP'                            AS type_noeud,
        COUNT(DISTINCT id_sinistre_b) + 1 AS nb_sinistres_impliques,
        COUNT(DISTINCT id_assure_b)     AS nb_assures_distincts,
        MIN(ecart_jours)                AS ecart_min_jours,
        MAX(ecart_jours)                AS ecart_max_jours,
        STRING_AGG(DISTINCT id_sinistre_b, ', ')
            WITHIN GROUP (ORDER BY id_sinistre_b)       AS sinistres_lies,
        CASE
            WHEN COUNT(DISTINCT id_assure_b) >= 4 THEN 'Critique'
            WHEN COUNT(DISTINCT id_assure_b) >= 2 THEN 'Élevé'
            ELSE 'Moyen'
        END                             AS niveau_alerte,
        CONCAT(
            'IP ', ip,
            ' partagée par ', COUNT(DISTINCT id_assure_b) + 1, ' assurés distincts ',
            'sur ', MAX(ecart_jours), ' jours'
        )                               AS description_alerte
    FROM cluster_ip
    GROUP BY ip
),


-- =============================================================================
-- 4. [P3] ASSURÉ MULTI-SINISTRES
--    Détecte les assurés ayant déclaré plusieurs sinistres sur 12 mois.
--    Signal : comportement de sinistralité anormale ou fraude en série.
-- =============================================================================
multiclaim AS (
    SELECT
        s.id_assure,
        COUNT(s.id_sinistre)            AS nb_sinistres,
        MIN(s.date_declaration)         AS premier_sinistre,
        MAX(s.date_declaration)         AS dernier_sinistre,
        DATEDIFF(DAY,
            MIN(s.date_declaration),
            MAX(s.date_declaration))    AS amplitude_jours,
        SUM(s.montant_reclame)          AS montant_total_reclame,
        STRING_AGG(s.id_sinistre, ', ')
            WITHIN GROUP (ORDER BY s.date_declaration) AS sinistres_lies
    FROM fraud.sinistres s
    WHERE s.date_declaration >= DATEADD(MONTH, -@fenetre_multiclaim_mois, GETDATE())
    GROUP BY s.id_assure
    HAVING COUNT(s.id_sinistre) >= @seuil_multiclaim
),

alerte_p3_multiclaim AS (
    SELECT
        'P3_ASSURE_MULTI_SINISTRES'     AS pattern_code,
        m.id_assure                     AS noeud_central,
        'Assuré'                        AS type_noeud,
        m.nb_sinistres                  AS nb_sinistres_impliques,
        1                               AS nb_assures_distincts,
        0                               AS ecart_min_jours,
        m.amplitude_jours               AS ecart_max_jours,
        m.sinistres_lies                AS sinistres_lies,
        CASE
            WHEN m.nb_sinistres >= 4 THEN 'Critique'
            WHEN m.nb_sinistres >= 3 THEN 'Élevé'
            ELSE 'Moyen'
        END                             AS niveau_alerte,
        CONCAT(
            'Assuré ', m.id_assure,
            ' a déclaré ', m.nb_sinistres, ' sinistres en ',
            m.amplitude_jours, ' jours',
            ' (total réclamé : ', FORMAT(m.montant_total_reclame, 'N0'), ' €)'
        )                               AS description_alerte
    FROM multiclaim m
),


-- =============================================================================
-- 5. [P4] LIENS CROISÉS — ASSURÉS CONNECTÉS PAR PLUSIEURS NŒUDS COMMUNS
--    Identifie les paires d'assurés qui partagent à la fois un réparateur
--    ET une IP suspecte : signal fort de fraude organisée.
-- =============================================================================
assures_par_reparateur AS (
    SELECT id_reparateur, id_assure
    FROM edge_sinistre_reparateur
    GROUP BY id_reparateur, id_assure
),

assures_par_ip AS (
    SELECT ip, id_assure
    FROM edge_sinistre_ip
    GROUP BY ip, id_assure
),

liens_croises AS (
    -- Paires d'assurés partageant un réparateur
    SELECT
        ar1.id_assure   AS id_assure_a,
        ar2.id_assure   AS id_assure_b,
        ar1.id_reparateur AS noeud_commun_reparateur,
        NULL            AS noeud_commun_ip
    FROM assures_par_reparateur ar1
    JOIN assures_par_reparateur ar2
        ON  ar1.id_reparateur = ar2.id_reparateur
        AND ar1.id_assure     < ar2.id_assure       -- éviter les doublons (a,b) et (b,a)

    UNION ALL

    -- Paires d'assurés partageant une IP
    SELECT
        ai1.id_assure   AS id_assure_a,
        ai2.id_assure   AS id_assure_b,
        NULL            AS noeud_commun_reparateur,
        ai1.ip          AS noeud_commun_ip
    FROM assures_par_ip ai1
    JOIN assures_par_ip ai2
        ON  ai1.ip        = ai2.ip
        AND ai1.id_assure < ai2.id_assure
),

-- Paires connectées par les DEUX types de nœuds simultanément
paires_double_lien AS (
    SELECT
        id_assure_a,
        id_assure_b,
        COUNT(DISTINCT noeud_commun_reparateur) AS nb_reparateurs_communs,
        COUNT(DISTINCT noeud_commun_ip)         AS nb_ip_communes,
        COUNT(*)                                AS nb_liens_totaux
    FROM liens_croises
    GROUP BY id_assure_a, id_assure_b
    HAVING
        COUNT(DISTINCT noeud_commun_reparateur) >= 1
        AND COUNT(DISTINCT noeud_commun_ip) >= 1
),

alerte_p4_liens_croises AS (
    SELECT
        'P4_LIEN_CROISE'                AS pattern_code,
        CONCAT(id_assure_a, ' ↔ ', id_assure_b) AS noeud_central,
        'Paire Assurés'                 AS type_noeud,
        NULL                            AS nb_sinistres_impliques,
        2                               AS nb_assures_distincts,
        NULL                            AS ecart_min_jours,
        NULL                            AS ecart_max_jours,
        NULL                            AS sinistres_lies,
        'Critique'                      AS niveau_alerte,
        CONCAT(
            'Assurés ', id_assure_a, ' et ', id_assure_b,
            ' partagent ', nb_reparateurs_communs, ' réparateur(s) commun(s) ',
            'ET ', nb_ip_communes, ' IP commune(s) — lien fort de fraude organisée'
        )                               AS description_alerte
    FROM paires_double_lien
),


-- =============================================================================
-- 6. [P5] CENTRALITÉ DES NŒUDS (degré entrant + sortant)
--    Classe chaque réparateur et IP par leur degré de connexion dans le graphe.
--    Les nœuds à fort degré sont les « hubs » du réseau frauduleux.
-- =============================================================================
centralite_reparateur AS (
    SELECT
        id_reparateur                   AS noeud_id,
        'Réparateur'                    AS type_noeud,
        COUNT(DISTINCT id_sinistre)     AS degre_sinistres,
        COUNT(DISTINCT id_assure)       AS degre_assures,
        COUNT(DISTINCT id_sinistre)
        + COUNT(DISTINCT id_assure)     AS degre_total,
        SUM(montant_reclame)            AS volume_financier,
        MIN(date_declaration)           AS premiere_connexion,
        MAX(date_declaration)           AS derniere_connexion
    FROM edge_sinistre_reparateur
    GROUP BY id_reparateur
),

centralite_ip AS (
    SELECT
        ip                              AS noeud_id,
        'IP'                            AS type_noeud,
        COUNT(DISTINCT id_sinistre)     AS degre_sinistres,
        COUNT(DISTINCT id_assure)       AS degre_assures,
        COUNT(DISTINCT id_sinistre)
        + COUNT(DISTINCT id_assure)     AS degre_total,
        NULL                            AS volume_financier,
        MIN(date_declaration)           AS premiere_connexion,
        MAX(date_declaration)           AS derniere_connexion
    FROM edge_sinistre_ip
    GROUP BY ip
),

centralite_noeuds AS (
    SELECT * FROM centralite_reparateur WHERE degre_total >= @seuil_centralite
    UNION ALL
    SELECT * FROM centralite_ip         WHERE degre_total >= @seuil_centralite
),


-- =============================================================================
-- 7. [P6] COMPOSANTES CONNEXES (approximation par propagation de labels)
--    Regroupe les assurés reliés transitivevement (A→B via réparateur,
--    B→C via IP → A, B, C appartiennent au même cluster).
--    Implémentation : two-hop join (équivalent BFS limité à 2 niveaux).
--    Pour une traversée complète, utiliser Azure Synapse Spark (GraphFrames).
-- =============================================================================
-- Étape 1 : construire le graphe bipartite assuré–nœud
graphe_bipartite AS (
    SELECT id_assure, id_reparateur AS noeud_partage, 'REP' AS type_noeud
    FROM edge_sinistre_reparateur
    GROUP BY id_assure, id_reparateur

    UNION ALL

    SELECT id_assure, ip AS noeud_partage, 'IP' AS type_noeud
    FROM edge_sinistre_ip
    GROUP BY id_assure, ip
),

-- Étape 2 : paires d'assurés à distance 2 (même nœud partagé)
assures_voisins AS (
    SELECT DISTINCT
        g1.id_assure    AS assure_source,
        g2.id_assure    AS assure_voisin,
        g1.noeud_partage,
        g1.type_noeud
    FROM graphe_bipartite g1
    JOIN graphe_bipartite g2
        ON  g1.noeud_partage = g2.noeud_partage
        AND g1.type_noeud    = g2.type_noeud
        AND g1.id_assure     < g2.id_assure
),

-- Étape 3 : attribuer un label de composante = MIN(id_assure) dans le voisinage
-- (approximation valide pour des clusters peu profonds ; Spark pour graphes profonds)
composantes AS (
    SELECT
        assure_source                   AS id_assure,
        MIN(assure_voisin)              AS composante_id,
        COUNT(DISTINCT assure_voisin)   AS taille_composante,
        STRING_AGG(DISTINCT assure_voisin, ', ')
            WITHIN GROUP (ORDER BY assure_voisin) AS membres
    FROM assures_voisins
    GROUP BY assure_source
    HAVING COUNT(DISTINCT assure_voisin) >= 1
),


-- =============================================================================
-- 8. [P7] RAFALES TEMPORELLES DANS UN CLUSTER
--    Détecte les sinistres d'un même cluster réparateur concentrés
--    sur une fenêtre courte (@fenetre_rafale_jours jours).
--    Signal : vague de fraudes coordonnée (événement organisé).
-- =============================================================================
sinistres_avec_lag AS (
    SELECT
        s.id_sinistre,
        s.id_assure,
        s.id_reparateur,
        s.date_declaration,
        s.montant_reclame,
        LAG(s.date_declaration) OVER (
            PARTITION BY s.id_reparateur
            ORDER BY s.date_declaration
        )                               AS date_precedente,
        LEAD(s.date_declaration) OVER (
            PARTITION BY s.id_reparateur
            ORDER BY s.date_declaration
        )                               AS date_suivante
    FROM fraud.sinistres s
),

rafales AS (
    SELECT
        sl.id_reparateur,
        sl.id_sinistre,
        sl.id_assure,
        sl.date_declaration,
        sl.montant_reclame,
        DATEDIFF(DAY, sl.date_precedente, sl.date_declaration) AS jours_depuis_precedent,
        DATEDIFF(DAY, sl.date_declaration, sl.date_suivante)   AS jours_avant_suivant,
        -- Fenêtre glissante : nb de sinistres du même réparateur dans les N jours
        COUNT(*) OVER (
            PARTITION BY sl.id_reparateur
            ORDER BY sl.date_declaration
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        )                               AS sinistres_dans_fenetre_7
    FROM sinistres_avec_lag sl
    WHERE
        DATEDIFF(DAY, sl.date_precedente, sl.date_declaration) <= @fenetre_rafale_jours
        OR DATEDIFF(DAY, sl.date_declaration, sl.date_suivante) <= @fenetre_rafale_jours
)

-- =============================================================================
-- 9. VUE CONSOLIDÉE DES ALERTES — consommée par Power BI et l'Agent 4
-- =============================================================================
-- En production : CREATE OR ALTER VIEW fraud.vw_graph_alerts AS …
SELECT
    pattern_code,
    noeud_central,
    type_noeud,
    nb_sinistres_impliques,
    nb_assures_distincts,
    ecart_min_jours,
    ecart_max_jours,
    sinistres_lies,
    niveau_alerte,
    description_alerte,
    GETDATE()                           AS horodatage_calcul
FROM alerte_p1_reparateur

UNION ALL SELECT pattern_code, noeud_central, type_noeud,
    nb_sinistres_impliques, nb_assures_distincts, ecart_min_jours,
    ecart_max_jours, sinistres_lies, niveau_alerte, description_alerte,
    GETDATE()
FROM alerte_p2_ip

UNION ALL SELECT pattern_code, noeud_central, type_noeud,
    nb_sinistres_impliques, nb_assures_distincts, ecart_min_jours,
    ecart_max_jours, sinistres_lies, niveau_alerte, description_alerte,
    GETDATE()
FROM alerte_p3_multiclaim

UNION ALL SELECT pattern_code, noeud_central, type_noeud,
    nb_sinistres_impliques, nb_assures_distincts, ecart_min_jours,
    ecart_max_jours, sinistres_lies, niveau_alerte, description_alerte,
    GETDATE()
FROM alerte_p4_liens_croises

ORDER BY
    CASE niveau_alerte
        WHEN 'Critique' THEN 1
        WHEN 'Élevé'    THEN 2
        WHEN 'Moyen'    THEN 3
        ELSE 4
    END,
    nb_sinistres_impliques DESC;


-- =============================================================================
-- 10. VUE CENTRALITÉ — pour le dashboard SIU (top nœuds à investiguer)
-- =============================================================================
-- En production : CREATE OR ALTER VIEW fraud.vw_centralite_noeuds AS …
SELECT
    noeud_id,
    type_noeud,
    degre_sinistres,
    degre_assures,
    degre_total,
    FORMAT(volume_financier, 'N0')      AS volume_financier_eur,
    premiere_connexion,
    derniere_connexion,
    DATEDIFF(DAY, premiere_connexion, derniere_connexion) AS duree_activite_jours,
    CASE
        WHEN degre_total >= 8  THEN 'Hub critique'
        WHEN degre_total >= 5  THEN 'Hub majeur'
        WHEN degre_total >= 3  THEN 'Nœud suspect'
        ELSE 'Nœud mineur'
    END                                 AS classification_hub
FROM centralite_noeuds
ORDER BY degre_total DESC;


-- =============================================================================
-- 11. VUE COMPOSANTES CONNEXES — pour visualisation réseau Power BI
-- =============================================================================
-- En production : CREATE OR ALTER VIEW fraud.vw_composantes_connexes AS …
SELECT
    c.id_assure,
    c.composante_id,
    c.taille_composante,
    c.membres,
    -- Enrichissement avec les métriques de sinistralité du cluster
    agg.nb_sinistres_cluster,
    agg.montant_total_cluster,
    agg.score_fraude_max
FROM composantes c
JOIN (
    SELECT
        s.id_assure,
        COUNT(s.id_sinistre)        AS nb_sinistres_cluster,
        SUM(s.montant_reclame)      AS montant_total_cluster,
        MAX(s.score_fraude)         AS score_fraude_max
    FROM fraud.sinistres s
    GROUP BY s.id_assure
) agg ON c.id_assure = agg.id_assure
ORDER BY c.taille_composante DESC, c.composante_id;


-- =============================================================================
-- 12. VUE RAFALES TEMPORELLES — export vers l'Agent 4 (Azure OpenAI)
-- =============================================================================
-- En production : CREATE OR ALTER VIEW fraud.vw_rafales AS …
SELECT
    r.id_reparateur,
    r.id_sinistre,
    r.id_assure,
    r.date_declaration,
    r.montant_reclame,
    r.jours_depuis_precedent,
    r.jours_avant_suivant,
    r.sinistres_dans_fenetre_7,
    CASE
        WHEN r.sinistres_dans_fenetre_7 >= 4 THEN 'Rafale critique'
        WHEN r.sinistres_dans_fenetre_7 >= 2 THEN 'Rafale modérée'
        ELSE 'Sinistre isolé'
    END                             AS classification_rafale
FROM rafales r
WHERE r.sinistres_dans_fenetre_7 >= 2
ORDER BY r.id_reparateur, r.date_declaration;


-- =============================================================================
-- 13. REQUÊTE DE SCORING ENRICHI POUR DATAVERSE
--    Enrichit chaque sinistre avec ses métriques de graphe pour alimenter
--    le champ score_fraude dans Dataverse (appelée par l'Agent 2 Azure ML).
-- =============================================================================
SELECT
    s.id_sinistre,
    s.id_assure,
    s.id_reparateur,
    s.date_declaration,
    s.score_fraude,

    -- Métriques graphe réparateur
    COALESCE(cr.degre_sinistres, 1)     AS reparateur_sinistres_total,
    COALESCE(cr.degre_assures,   1)     AS reparateur_assures_distincts,

    -- Métriques graphe IP
    COALESCE(ci.degre_sinistres, 1)     AS ip_sinistres_total,
    COALESCE(ci.degre_assures,   1)     AS ip_assures_distincts,

    -- Appartenance à une composante connexe
    COALESCE(comp.taille_composante, 1) AS taille_composante_connexe,

    -- Score de risque graphe composite (0-30 pts, complémentaire au score ML)
    LEAST(30,
        COALESCE(cr.degre_sinistres - 1, 0) * 5    -- 5 pts par sinistre extra réparateur
        + COALESCE(ci.degre_assures - 1, 0)  * 10  -- 10 pts par assuré IP distincte extra
        + COALESCE(comp.taille_composante - 1, 0) * 3  -- 3 pts par membre de cluster
    )                                   AS score_graphe

FROM fraud.sinistres s
LEFT JOIN centralite_reparateur cr ON s.id_reparateur = cr.noeud_id
LEFT JOIN centralite_ip          ci ON s.adresse_ip_declaration = ci.noeud_id
LEFT JOIN composantes           comp ON s.id_assure = comp.id_assure
ORDER BY score_graphe DESC, s.score_fraude DESC;
