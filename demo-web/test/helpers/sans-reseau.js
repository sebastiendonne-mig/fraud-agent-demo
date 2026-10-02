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

// Filet de bas niveau : même un client qui aurait capturé `fetch` avant ce
// fichier ne peut pas ouvrir de connexion (TCP, TLS, résolution DNS).
const net = require("net");
const tls = require("tls");
const dns = require("dns");
net.connect = interdit("net.connect");
net.createConnection = interdit("net.createConnection");
net.Socket.prototype.connect = interdit("net.Socket.connect");
tls.connect = interdit("tls.connect");
dns.lookup = interdit("dns.lookup");
dns.promises.lookup = interdit("dns.promises.lookup");
