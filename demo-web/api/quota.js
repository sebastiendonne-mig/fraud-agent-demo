// Analyses réelles restantes aujourd'hui, en lecture seule, mis en cache 60 s (lib/handlers.js).
const { creerHandlerQuota, depsReelles } = require("../lib/handlers.js");

module.exports = creerHandlerQuota(depsReelles());
