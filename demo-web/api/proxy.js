// Lot 0-urgence : le proxy ne relaie plus rien.
// Toute requête, quelle que soit la méthode, reçoit une réponse 503 neutre.
// Aucun appel sortant, aucune lecture de variable d'environnement.
module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(503).json({
    error: {
      type: "service_unavailable",
      message: "Service temporairement indisponible.",
    },
  });
};
