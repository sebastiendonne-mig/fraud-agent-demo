// Scénarios de démonstration (données entièrement fictives).
// Source unique, partagée par le navigateur (chargé avant app.js), le script
// d'enregistrement des rejeux et les tests : les rejeux correspondent ainsi
// exactement aux pastilles de la page.
(function (racine) {
  "use strict";

  // Date locale « AAAA-MM-JJ », n jours avant aujourd'hui
  function joursAvant(n, aujourdHui = new Date()) {
    const d = new Date(aujourdHui.getFullYear(), aujourdHui.getMonth(), aujourdHui.getDate());
    d.setDate(d.getDate() - n);
    const deux = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
  }

  // "AAAA-MM-JJ" → "JJ/MM/AAAA"
  function dateFr(iso) {
    const [a, m, j] = iso.split("-");
    return `${j}/${m}/${a}`;
  }

  // PV du scénario recours : daté du jour du sinistre (2 jours avant la déclaration),
  // pour rester cohérent avec les dates du dossier.
  function pvRecours(dateSinistreIso) {
    const annee = dateSinistreIso.slice(0, 4);
    return `PROCÈS-VERBAL N° PV-${annee}-0012
Service : Unité fictive de démonstration
Date : ${dateFr(dateSinistreIso)} — 09h47

CIRCONSTANCES : Collision en intersection réglementée par feux tricolores.
Le véhicule de M. Laurent MARTIN (assuré, plaque DEMO-101) circulait sur voie principale,
feu vert. Le véhicule de M. Karim BENALI (tiers, plaque DEMO-102, assuré Mutuelle Fictive d'Assurance n°0000000)
a grillé le feu rouge en tournant à gauche et a percuté l'avant droit du véhicule assuré.

TÉMOINS : Mme Sophie ROUSSEAU confirme que M. BENALI a brûlé le feu rouge.

RESPONSABILITÉ : M. BENALI (tiers) responsable à 100 %. Aucun partage de responsabilité.
Dommages matériels : 5 652 € (devis du réparateur REP-031). Dommages corporels : néant.

Signé : Agent fictif — Unité fictive de démonstration`;
  }

  function scenarios(aujourdHui = new Date()) {
    const j = (n) => joursAvant(n, aujourdHui);
    return {
      stp: {
        circonstances: "En quittant le parking d'un supermarché, un gravillon projeté par un camion a frappé le pare-brise de mon véhicule. L'impact est apparu tout de suite, côté conducteur, sous la forme d'un petit éclat. Je n'ai constaté aucun autre dégât. J'ai pris une photo sur place et je l'ai envoyée à mon réparateur le jour même.",
        id_police: "POL-12901", type_sinistre: "bris_de_glace", montant_reclame: 280, montant_plafond: 5000,
        franchise: 150, date_declaration: j(20), date_souscription: j(730),
        id_reparateur: "REP-042", reparateur_count_90d: 0, ip_count_30d: 0, rapport_police: "",
      },
      reseau: {
        circonstances: "Mon véhicule a été heurté à l'arrière à un feu rouge par un conducteur qui a pris la fuite sans laisser ses coordonnées. Aucun témoin n'était présent. Je dois pouvoir circuler sans délai pour mon travail : je demande donc une indemnisation immédiate et je ne peux pas attendre l'expertise. Mon réparateur habituel est déjà prévenu et prêt à intervenir.",
        id_police: "POL-78234", type_sinistre: "accident_auto", montant_reclame: 4800, montant_plafond: 15000,
        franchise: 500, date_declaration: j(5), date_souscription: j(400),
        id_reparateur: "REP-007", reparateur_count_90d: 9, ip_count_30d: 1, rapport_police: "",
      },
      precoce: {
        circonstances: "Une canalisation a cédé dans la salle de bain pendant mon absence et l'eau a envahi le logement. En rentrant le soir, j'ai trouvé le sol inondé. Je précise que je n'ai pas quitté le logement de la journée. Le parquet et le mobilier du salon sont abîmés.",
        id_police: "POL-55401", type_sinistre: "degat_des_eaux", montant_reclame: 10362, montant_plafond: 20000,
        franchise: 300, date_declaration: j(10), date_souscription: j(10),
        id_reparateur: "REP-019", reparateur_count_90d: 1, ip_count_30d: 0, rapport_police: "",
      },
      recours: {
        circonstances: "Je circulais sur la voie principale et le feu était vert pour moi. Un véhicule a tourné à gauche sans s'arrêter au feu rouge et a heurté l'avant droit de mon véhicule. Un témoin a assisté à la scène et confirme que l'autre conducteur a brûlé le feu rouge. Je considère l'autre conducteur comme entièrement responsable. Les forces de l'ordre ont établi un procès-verbal.",
        id_police: "POL-78901", type_sinistre: "accident_auto", montant_reclame: 5652, montant_plafond: 25000,
        franchise: 500, date_declaration: j(12), date_souscription: j(900),
        id_reparateur: "REP-031", reparateur_count_90d: 1, ip_count_30d: 0, rapport_police: pvRecours(j(14)),
      },
    };
  }

  const api = { scenarios, joursAvant, pvRecours };
  if (typeof module === "object" && module.exports) module.exports = api;
  else racine.ScenariosDemo = api;
})(typeof window !== "undefined" ? window : globalThis);
