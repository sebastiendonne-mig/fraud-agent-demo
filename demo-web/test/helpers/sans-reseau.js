// Chargé avant chaque fichier de test (--require) : tout accès réseau échoue.
// Garantit qu'aucun test ne peut appeler Anthropic ou Upstash, même par erreur.
const http = require("http");
const https = require("https");

function interdit(nom) {
  return function () {
    throw new Error(`Accès réseau interdit pendant les tests (${nom})`);
  };
}

globalThis.fetch = interdit("fetch");
http.request = interdit("http.request");
https.request = interdit("https.request");
http.get = interdit("http.get");
https.get = interdit("https.get");
