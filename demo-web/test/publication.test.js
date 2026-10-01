// Ce qui est servi publiquement par Vercel : uniquement public/ (outputDirectory).
// Le code serveur, la configuration, les données et les manifestes de dépendances
// restent hors de public/ : jamais servis, mais empaquetés dans les fonctions.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..");
const PUBLIC = path.join(RACINE, "public");
const VERCEL = JSON.parse(fs.readFileSync(path.join(RACINE, "vercel.json"), "utf8"));

function lister(dossier, base = dossier) {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = path.join(dossier, e.name);
    return e.isDirectory() ? lister(chemin, base) : [path.relative(base, chemin)];
  }).sort();
}

test("vercel.json : seule la racine publique est servie (outputDirectory = public)", () => {
  assert.equal(VERCEL.outputDirectory, "public");
});

test("public/ ne contient que la page, ses scripts, ses ressources et les rejeux", () => {
  const fichiers = lister(PUBLIC);
  const autorises = [
    /^index\.html$/, /^app\.js$/, /^scenarios\.js$/,
    /^assets\/[a-z0-9.-]+\.(svg|css)$/, /^replays\/(reseau|precoce|recours)\.json$/,
  ];
  for (const f of fichiers) assert.ok(autorises.some((re) => re.test(f)), `fichier inattendu dans public/ : ${f}`);
  for (const f of ["index.html", "app.js", "scenarios.js", "assets/tokens.css", "replays/recours.json"]) {
    assert.ok(fichiers.includes(f), `${f} doit être public`);
  }
});

test("fichiers internes hors de public/ : lib, config, data, api, manifestes, tests, scripts", () => {
  for (const interne of ["lib", "config", "data", "api", "test", "scripts", "package.json", "package-lock.json", "vercel.json", ".env"]) {
    assert.equal(fs.existsSync(path.join(PUBLIC, interne)), false, `${interne} ne doit pas être dans public/`);
  }
  for (const present of ["lib/prompts.js", "config/agent.json", "data/portefeuille.json", "package.json", "package-lock.json"]) {
    assert.ok(fs.existsSync(path.join(RACINE, present)), `${present} reste dans le projet`);
  }
});

test("les fonctions empaquettent ce dont elles ont besoin : chaque require littéral de api/ et lib/ existe", () => {
  // Vercel empaquette les fichiers des fonctions par analyse statique des require (Node File Trace).
  // Seul stp.json est volontairement absent (aucun rejeu pour STP : aucun appel IA), géré par lib/replay.js.
  const absentsVoulus = new Set(["public/replays/stp.json"]);
  const manquants = [];
  for (const dossier of ["api", "lib"]) {
    for (const f of fs.readdirSync(path.join(RACINE, dossier))) {
      const fichier = path.join(RACINE, dossier, f);
      const code = fs.readFileSync(fichier, "utf8").replace(/^\s*\/\/.*$/gm, "");
      for (const m of code.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
        const cible = path.resolve(path.dirname(fichier), m[1]);
        const candidats = [cible, `${cible}.js`, `${cible}.json`];
        if (!candidats.some((c) => fs.existsSync(c))) {
          const rel = path.relative(RACINE, cible);
          if (!absentsVoulus.has(rel)) manquants.push(`${dossier}/${f} → ${m[1]}`);
        }
      }
    }
  }
  assert.deepEqual(manquants, []);
});

test("les rejeux lus par les fonctions sont ceux servis au navigateur (un seul dossier : public/replays)", () => {
  const code = fs.readFileSync(path.join(RACINE, "lib", "replay.js"), "utf8");
  const chemins = [...code.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(chemins.length >= 3);
  for (const c of chemins) assert.match(c, /^\.\.\/public\/replays\/[a-z]+\.json$/);
  assert.equal(fs.existsSync(path.join(RACINE, "replays")), false, "plus de dossier replays/ à la racine");
});
