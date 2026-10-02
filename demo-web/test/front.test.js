const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../scripts/contrastes.js");

const RACINE = path.join(__dirname, "..");
const PUBLIC = path.join(RACINE, "public");
const HTML = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
const VERCEL = JSON.parse(fs.readFileSync(path.join(RACINE, "vercel.json"), "utf8"));
const texteSeul = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

test("anti-XSS : aucun innerHTML, outerHTML, insertAdjacentHTML ni document.write dans app.js", () => {
  assert.doesNotMatch(APP, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(APP, /textContent/);
});

test("vocabulaire interdit absent (ML, probabilité, Azure, régression, zéro stockage)", () => {
  assert.doesNotMatch(HTML, /\bML\b|azure|régression|zéro stockage/i, "index.html");
  assert.doesNotMatch(APP, /\bML\b|probabil|azure|régression|zéro stockage/i, "app.js");
});

test("code mort et reliquats supprimés (proxy, step-synapse, couleurs Fluent, onclick, styles en ligne)", () => {
  for (const motif of [/\/api\/anthropic/, /step-synapse/, /--azure/, /#107c10|#ca5010|#d13438|#dff6dd|#fff4ce|#fde7e9|#edebe9|#c8c6c4/i, /setTimeout\(r,/]) {
    assert.doesNotMatch(HTML + APP, motif, String(motif));
  }
  assert.doesNotMatch(HTML, /\son[a-z]+=/i, "aucun gestionnaire d'événement en ligne");
  assert.doesNotMatch(HTML, /\sstyle="/, "aucun style en ligne");
  assert.doesNotMatch(APP, /claude-|sk-ant|system:|max_tokens/, "aucun modèle, clé ni prompt côté client");
  assert.equal((HTML.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).length, 0, "aucun script en ligne");
});

test("bloc d'information du visiteur : 6 phrases exactes, placé avant le bouton d'envoi, liens officiels", () => {
  const debut = HTML.indexOf('id="infoVisiteur"');
  const bouton = HTML.indexOf('id="boutonAnalyser"');
  assert.ok(debut > 0 && debut < bouton);
  const bloc = texteSeul(HTML.slice(debut, HTML.indexOf("</aside>", debut)));
  for (const phrase of [
    "Données fictives uniquement : n'entrez aucune donnée réelle (nom, plaque, téléphone…).",
    "Vous interagissez avec des IA (Claude, d'Anthropic, et Jev, de TypeSafe AI). Les propositions de l'agent sont soumises à une validation humaine.",
    "Traitement par Anthropic, qui conserve les données jusqu'à 30 jours, sauf exceptions (application de la politique d'usage, obligations légales).",
    "Hébergement aux États-Unis : fonctions Vercel, Anthropic et Upstash.",
    "Conservation temporaire : l'état de l'analyse est gardé 30 minutes pour permettre la validation, puis supprimé.",
    "TypeSafe AI ne fixe pas de durée de conservation : sa politique prévoit de conserver les données aussi longtemps que raisonnablement nécessaire à ses services ou à ses activités",
  ]) assert.ok(bloc.includes(phrase), phrase);
  assert.match(HTML.slice(debut, bouton), /href="https:\/\/platform\.claude\.com\/docs\/en\/manage-claude\/api-and-data-retention"/);
  assert.match(HTML.slice(debut, bouton), /href="https:\/\/typesafe\.ai\/legal\/privacy-policy"/);
});

test("« Comment ça marche » : 6 points dont « Limites », seuils présentés comme un choix de démo", () => {
  const bloc = HTML.slice(HTML.indexOf('class="etapes-explication"'), HTML.indexOf("</ol>", HTML.indexOf('class="etapes-explication"')));
  assert.equal((bloc.match(/<li>/g) || []).length, 7);
  assert.match(bloc, /Limites\./);
  assert.match(texteSeul(bloc), /choix de démonstration, non calibrés/);
  assert.match(texteSeul(bloc), /pas un outil de production/);
  assert.match(texteSeul(bloc), /rejeu signalé/);
});

test("délais du client = maxDuration de vercel.json + 5 s ; durée annoncée marquée provisoire", () => {
  const delais = APP.match(/DELAI_MS = \{ analyse: (\d+), finalisation: (\d+)/);
  assert.equal(Number(delais[1]), VERCEL.functions["api/analyze.js"].maxDuration * 1000 + 5000);
  assert.equal(Number(delais[2]), VERCEL.functions["api/finalize.js"].maxDuration * 1000 + 5000);
  assert.match(APP, /PROVISOIRE jusqu'à la vérification en prévisualisation[\s\S]*?\nconst DUREE_ANNONCEE = "généralement 10 à 20 secondes";/);
  assert.match(APP, /`Analyse en cours — \$\{DUREE_ANNONCEE\}\.`/);
});

test("mentions obligatoires présentes : brouillon sans envoi, badges, motif limité à 500 caractères", () => {
  assert.match(APP, /Brouillon — aucun envoi réel\./);
  assert.match(APP, /Règles seules — aucun appel IA/);
  assert.match(APP, /Exécution réelle · /);
  assert.match(APP, /"Rejeu"/);
  assert.match(HTML, /<textarea id="motif"[^>]*maxlength="500"/);
});

test("contraste WCAG 2.1 : chaque couple déclaré atteint 4,5:1 (texte) ou 3:1 (graphique)", () => {
  const liste = C.couples(C.lireSources());
  assert.ok(liste.length >= 20);
  for (const c of liste) {
    assert.ok(c.ratio !== null, `${c.couple} : couleur ou fond introuvable`);
    assert.ok(c.ratio >= c.seuil, `${c.couple} : ${c.ratio.toFixed(2)}:1 < ${c.seuil}:1`);
  }
});

test("contraste : hors des couples déclarés, aucune couleur directe (hex, rgb, token de couleur de la charte)", () => {
  const { tokens, style, racine } = C.lireSources();
  const couleursCharte = Object.keys(tokens).filter((n) => C.resoudre(`var(--${n})`, [tokens]));
  const regles = style.replace(/:root\s*\{[\s\S]*?\}/, "");
  assert.doesNotMatch(regles, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  for (const n of couleursCharte) assert.equal(regles.includes(`var(--${n})`), false, `--${n} utilisé directement`);
  for (const m of regles.matchAll(/var\(--([cgd]-[a-z0-9-]+)\)/g)) assert.ok(racine[m[1]], `--${m[1]} non déclaré`);
  const corps = HTML.replace(/<style>[\s\S]*?<\/style>/, "");
  assert.doesNotMatch(corps, /(stroke|fill|color)="#/i, "aucune couleur en attribut");
  assert.doesNotMatch(APP, /#[0-9a-f]{6}\b/i);
});

test("formule de contraste conforme aux valeurs de référence (noir/blanc 21:1)", () => {
  assert.equal(C.ratio("#000000", "#FFFFFF").toFixed(2), "21.00");
  assert.equal(C.ratio("#FFFFFF", "#FFFFFF").toFixed(2), "1.00");
});

test("scénarios : source unique scenarios.js, chargée avant app.js", () => {
  const iScenarios = HTML.indexOf('<script src="scenarios.js"');
  const iApp = HTML.indexOf('<script src="app.js"');
  assert.ok(iScenarios > 0 && iScenarios < iApp);
  assert.match(APP, /window\.ScenariosDemo\.scenarios\(\)/);
  assert.doesNotMatch(APP, /PROCÈS-VERBAL/, "aucune copie des scénarios dans app.js");
});

test("montant de recours libellé brut, franchise non traitée annoncée ; compteurs simulés", () => {
  assert.match(APP, /\["Montant récupérable \(brut\)", montant\]/);
  assert.match(APP, /montant brut, franchise non traitée dans cette démo/);
  assert.match(texteSeul(HTML), /Le montant de recours affiché est un montant brut : la franchise n'est pas traitée dans cette démo\./);
  assert.match(HTML, /Dossiers du même réparateur sur 90&nbsp;jours \(compteur simulé\)/);
  assert.match(HTML, /Déclarations depuis la même IP sur 30&nbsp;jours \(compteur simulé\)/);
});

test("« Chiffres mesurés » : coût agent + Jev datés, durées agent + Jev, dans « Comment ça marche »", () => {
  const bloc = texteSeul(HTML.slice(HTML.indexOf('class="etapes-explication"'), HTML.indexOf("</ol>", HTML.indexOf('class="etapes-explication"'))));
  assert.match(bloc, /Chiffres mesurés\. Analyse complète par l'agent : environ 0,0205 \$ \(3 analyses, 02\/10\/2026\), 6 à 10 s pour l'analyse et 3 à 6 s pour la finalisation \(01 et 02\/10\/2026\), 1 à 2 tours selon le dossier\. Lecture par Jev : 0,00003 à 0,000047 \$ et moins d'une seconde par appel \(4 appels, 02\/10\/2026\)\./);
});

test("budgets de temps inchangés : 180 / 120 s, maxDuration 240 / 180 s", () => {
  const CONFIG = require("../config/agent.json");
  assert.equal(CONFIG.temps.analyse.budget_ms, 180000);
  assert.equal(CONFIG.temps.finalisation.budget_ms, 120000);
  assert.equal(VERCEL.functions["api/analyze.js"].maxDuration, 240);
  assert.equal(VERCEL.functions["api/finalize.js"].maxDuration, 180);
});
