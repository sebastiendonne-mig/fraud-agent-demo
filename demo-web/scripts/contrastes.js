// Calcule le contraste WCAG 2.1 des couples de couleurs déclarés dans public/index.html.
// Les couleurs sont résolues à partir de public/assets/tokens.css (charte TKoidra).
// Usage : node scripts/contrastes.js   (affiche le tableau des ratios)
const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..", "public");
const SEUILS = { c: 4.5, g: 3 }; // texte normal ; élément graphique ou gros texte

function luminance(hex) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(hexA, hexB) {
  const [clair, sombre] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (clair + 0.05) / (sombre + 0.05);
}

// Variables CSS d'un bloc : { nom: valeur }
function variables(texte) {
  const vars = {};
  for (const m of texte.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) vars[m[1]] = m[2].trim();
  return vars;
}

function resoudre(valeur, tables, profondeur = 0) {
  const v = valeur.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  const m = v.match(/^var\(--([a-z0-9-]+)\)$/i);
  if (!m || profondeur > 5) return null;
  for (const t of tables) if (t[m[1]] !== undefined) return resoudre(t[m[1]], tables, profondeur + 1);
  return null;
}

function lireSources() {
  const tokens = variables(fs.readFileSync(path.join(RACINE, "assets", "tokens.css"), "utf8"));
  const html = fs.readFileSync(path.join(RACINE, "index.html"), "utf8");
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const blocRacine = style.match(/:root\s*\{([\s\S]*?)\}/)[1];
  return { tokens, html, style, racine: variables(blocRacine), blocRacine };
}

// Couples déclarés : --c-<nom>-texte/--c-<nom>-fond et --g-<nom>-trait/--g-<nom>-fond
function couples({ tokens, racine }) {
  const resultat = [];
  for (const nom of Object.keys(racine)) {
    const m = nom.match(/^(c|g)-(.+)-(texte|trait)$/);
    if (!m) continue;
    const [, type, base] = m;
    const fond = racine[`${type}-${base}-fond`];
    const avant = resoudre(racine[nom], [racine, tokens]);
    const arriere = fond ? resoudre(fond, [racine, tokens]) : null;
    resultat.push({
      couple: `${type}-${base}`, type, avant, arriere,
      ratio: avant && arriere ? ratio(avant, arriere) : null, seuil: SEUILS[type],
    });
  }
  return resultat;
}

if (require.main === module) {
  for (const c of couples(lireSources())) {
    const ok = c.ratio !== null && c.ratio >= c.seuil;
    console.log(`${ok ? "OK " : "KO "} ${c.couple.padEnd(24)} ${c.avant} sur ${c.arriere}  ${c.ratio ? c.ratio.toFixed(2) : "?"}:1 (seuil ${c.seuil})`);
  }
}

module.exports = { luminance, ratio, variables, resoudre, lireSources, couples, SEUILS };
