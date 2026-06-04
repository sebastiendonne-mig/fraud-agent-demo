// Indique au frontend si ANTHROPIC_API_KEY est configurée côté serveur.
// N'expose jamais la clé elle-même — uniquement un booléen.
module.exports = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({ configured: !!process.env.ANTHROPIC_API_KEY });
};
