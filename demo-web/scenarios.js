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

  const PV_RECOURS = `PROCÈS-VERBAL N° PV-2024-0012
Service : Unité fictive de démonstration
Date : 14/03/2024 — 09h47

CIRCONSTANCES : Collision en intersection réglementée par feux tricolores.
Le véhicule de M. Laurent MARTIN (assuré, plaque DEMO-101) circulait sur voie principale,
feu vert. Le véhicule de M. Karim BENALI (tiers, plaque DEMO-102, assuré Mutuelle Fictive d'Assurance n°0000000)
a grillé le feu rouge en tournant à gauche et a percuté l'avant droit du véhicule assuré.

TÉMOINS : Mme Sophie ROUSSEAU confirme que M. BENALI a brûlé le feu rouge.

RESPONSABILITÉ : M. BENALI (tiers) responsable à 100 %. Aucun partage de responsabilité.
Dommages matériels : 5 652 € (devis garage MARTIN & Fils). Dommages corporels : néant.

Signé : Agent fictif — Unité fictive de démonstration`;

  function scenarios(aujourdHui = new Date()) {
    const j = (n) => joursAvant(n, aujourdHui);
    return {
      stp: {
        id_police: "POL-12901", type_sinistre: "bris_de_glace", montant_reclame: 280, montant_plafond: 5000,
        franchise: 150, date_declaration: j(20), date_souscription: j(730),
        id_reparateur: "REP-042", reparateur_count_90d: 0, ip_count_30d: 0, rapport_police: "",
      },
      reseau: {
        id_police: "POL-78234", type_sinistre: "accident_auto", montant_reclame: 4800, montant_plafond: 15000,
        franchise: 500, date_declaration: j(5), date_souscription: j(400),
        id_reparateur: "REP-007", reparateur_count_90d: 9, ip_count_30d: 1, rapport_police: "",
      },
      precoce: {
        id_police: "POL-55401", type_sinistre: "degat_des_eaux", montant_reclame: 10362, montant_plafond: 20000,
        franchise: 300, date_declaration: j(10), date_souscription: j(10),
        id_reparateur: "REP-019", reparateur_count_90d: 1, ip_count_30d: 0, rapport_police: "",
      },
      recours: {
        id_police: "POL-78901", type_sinistre: "accident_auto", montant_reclame: 5652, montant_plafond: 25000,
        franchise: 500, date_declaration: j(12), date_souscription: j(900),
        id_reparateur: "REP-031", reparateur_count_90d: 1, ip_count_30d: 0, rapport_police: PV_RECOURS,
      },
    };
  }

  const api = { scenarios, joursAvant, PV_RECOURS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else racine.ScenariosDemo = api;
})(typeof window !== "undefined" ? window : globalThis);
