// Appel 1 : règles, triage, puis agent si nécessaire (logique dans lib/handlers.js).
const { creerHandlerAnalyse, depsReelles } = require("../lib/handlers.js");

module.exports = creerHandlerAnalyse(depsReelles());
