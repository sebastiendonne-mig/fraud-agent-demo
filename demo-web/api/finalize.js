// Appel 2 : finalisation après la décision du gestionnaire (logique dans lib/handlers.js).
const { creerHandlerFinalisation, depsReelles } = require("../lib/handlers.js");

module.exports = creerHandlerFinalisation(depsReelles());
