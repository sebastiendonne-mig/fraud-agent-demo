// Faux DOM minimal pour exécuter public/app.js dans un contexte vm, sans navigateur.
// Les contrôles de formulaire (valeurs initiales, liste de pastilles) sont lus dans le
// VRAI public/index.html : le test porte donc sur les valeurs par défaut réelles de la page.
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "..", "..", "public");

class Elt {
  constructor(id, { value = "", dataset = {} } = {}) {
    this._valeur = String(value);
    this.id = id; this.initial = String(value); this.dataset = dataset;
    this.hidden = false; this.disabled = false; this.textContent = ""; this.className = "";
    this.attrs = {}; this.listeners = {}; this.children = []; this.style = {}; this.open = false;
  }
  // Comme un vrai champ de formulaire : toute valeur affectée est convertie en texte
  get value() { return this._valeur; }
  set value(v) { this._valeur = String(v); }
  addEventListener(type, f) { (this.listeners[type] ||= []).push(f); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...c) { this.children.push(...c); }
  replaceChildren() { this.children = []; }
  scrollIntoView() {}
  click() { for (const f of this.listeners.click || []) f(); }
}

function lireControles(html) {
  const valeurs = {};
  for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
    const id = (m[1].match(/\bid="([^"]+)"/) || [])[1];
    if (id) valeurs[id] = ((m[1].match(/\bvalue="([^"]*)"/) || [])[1]) ?? "";
  }
  for (const m of html.matchAll(/<textarea\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) valeurs[m[1]] = m[2];
  for (const m of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const options = [...m[2].matchAll(/<option\b([^>]*)>/g)].map((o) => ({ v: (o[1].match(/value="([^"]*)"/) || [])[1], sel: /\bselected\b/.test(o[1]) }));
    valeurs[m[1]] = (options.find((o) => o.sel) || options[0]).v;
  }
  return valeurs;
}

// Charge scenarios.js puis app.js dans un contexte isolé et renvoie de quoi piloter la page
function chargerPage({ aujourdHui } = {}) {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const initiales = lireControles(html);
  const elements = new Map();
  const controles = new Set(Object.keys(initiales));
  const obtenir = (id) => {
    if (!elements.has(id)) elements.set(id, new Elt(id, { value: initiales[id] ?? "" }));
    return elements.get(id);
  };
  const pastilles = [...html.matchAll(/<button\b[^>]*class="pastille"[^>]*data-scenario="([^"]+)"/g)]
    .map((m) => new Elt(`pastille-${m[1]}`, { dataset: { scenario: m[1] } }));

  const formulaire = obtenir("formulaire");
  formulaire.reset = () => { for (const id of controles) obtenir(id).value = obtenir(id).initial; };

  const envois = [];
  const documentFaux = {
    getElementById: obtenir,
    querySelectorAll: (sel) => (sel === ".pastille" ? pastilles : []),
    createElement: () => new Elt("cree"),
    addEventListener(type, f) { (this.ecouteurs[type] ||= []).push(f); },
    ecouteurs: {},
  };
  const contexte = {
    document: documentFaux, console, AbortController, Intl, Node: Elt,
    setTimeout: () => 0, clearTimeout: () => {},
    // Capture les envois ; la réponse n'arrive jamais (le test s'arrête au dossier envoyé)
    fetch: (url, options = {}) => {
      envois.push({ url, methode: options.method || "GET", corps: options.body ? JSON.parse(options.body) : null });
      return new Promise(() => {});
    },
  };
  contexte.window = contexte;
  vm.createContext(contexte);
  if (aujourdHui) {
    const RealDate = Date;
    contexte.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [aujourdHui.getTime()])); } };
  }
  vm.runInContext(fs.readFileSync(path.join(PUBLIC, "scenarios.js"), "utf8"), contexte);
  vm.runInContext(fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"), contexte);
  for (const f of documentFaux.ecouteurs.DOMContentLoaded || []) f();

  return {
    elements, obtenir, pastilles, envois,
    pastille: (nom) => pastilles.find((p) => p.dataset.scenario === nom),
    valeur: (id) => obtenir(id).value,
    soumettre() { obtenir("formulaire").listeners.submit[0]({ preventDefault() {} }); return envois.filter((e) => e.methode === "POST").at(-1).corps; },
    reinitialiser() { obtenir("boutonReinitialiser").click(); },
  };
}

module.exports = { chargerPage, lireControles };
