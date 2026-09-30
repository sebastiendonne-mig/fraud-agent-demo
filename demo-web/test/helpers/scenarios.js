// Les 4 scénarios de démonstration de app.js (dates relatives à la date du test).
function joursAvant(n, aujourdHui = new Date()) {
  const d = new Date(Date.UTC(aujourdHui.getUTCFullYear(), aujourdHui.getUTCMonth(), aujourdHui.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const PV_RECOURS = `PROCÈS-VERBAL N° PV-2024-0012
Service : Unité fictive de démonstration
CIRCONSTANCES : Collision en intersection réglementée par feux tricolores.
Le véhicule de M. Laurent MARTIN (assuré, plaque DEMO-101) circulait sur voie principale,
feu vert. Le véhicule de M. Karim BENALI (tiers, plaque DEMO-102, assuré Mutuelle Fictive d'Assurance n°0000000)
a grillé le feu rouge en tournant à gauche et a percuté l'avant droit du véhicule assuré.
RESPONSABILITÉ : M. BENALI (tiers) responsable à 100 %. Aucun partage de responsabilité.
Dommages matériels : 5 652 €.`;

function scenarios() {
  return {
    stp: {
      id_police: "POL-12901", type_sinistre: "bris_de_glace", montant_reclame: 280, montant_plafond: 5000,
      franchise: 150, date_declaration: joursAvant(20), date_souscription: joursAvant(730),
      id_reparateur: "REP-042", reparateur_count_90d: 0, ip_count_30d: 0, rapport_police: "",
    },
    reseau: {
      id_police: "POL-78234", type_sinistre: "accident_auto", montant_reclame: 4800, montant_plafond: 15000,
      franchise: 500, date_declaration: joursAvant(5), date_souscription: joursAvant(400),
      id_reparateur: "REP-007", reparateur_count_90d: 9, ip_count_30d: 1, rapport_police: "",
    },
    precoce: {
      id_police: "POL-55401", type_sinistre: "degat_des_eaux", montant_reclame: 10362, montant_plafond: 20000,
      franchise: 300, date_declaration: joursAvant(10), date_souscription: joursAvant(10),
      id_reparateur: "REP-019", reparateur_count_90d: 1, ip_count_30d: 0, rapport_police: "",
    },
    recours: {
      id_police: "POL-78901", type_sinistre: "accident_auto", montant_reclame: 5652, montant_plafond: 25000,
      franchise: 500, date_declaration: joursAvant(12), date_souscription: joursAvant(900),
      id_reparateur: "REP-031", reparateur_count_90d: 1, ip_count_30d: 0, rapport_police: PV_RECOURS,
    },
  };
}

module.exports = { scenarios, joursAvant, PV_RECOURS };
