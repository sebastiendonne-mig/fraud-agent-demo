// Captures du front en Chrome headless, piloté par le protocole DevTools
// (WebSocket natif de Node 24 : aucune dépendance). Jamais l'extension
// claude-in-chrome : un profil Chrome TEMPORAIRE est créé puis supprimé.
// L'API est simulée par scripts/serveur-local.js (aucun appel réseau sortant :
// polices Google et scripts externes sont bloqués).
// Usage : node scripts/captures-front.js <dossier de sortie> [<dossier de copie>]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { demarrer } = require("./serveur-local.js");

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LARGEURS = [{ largeur: 1440, hauteur: 900, mobile: false }, { largeur: 390, hauteur: 844, mobile: true }];
const XSS = "<img src=x onerror=alert(1)>";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function attendreFichier(fichier, delai = 15000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (fs.existsSync(fichier)) {
      const contenu = fs.readFileSync(fichier, "utf8");
      if (contenu.includes("\n")) return contenu;
    }
    await pause(100);
  }
  throw new Error("Chrome n'a pas ouvert son port de débogage");
}

// Client minimal du protocole DevTools
function connecter(urlWs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(urlWs);
    let id = 0;
    const attentes = new Map();
    const ecouteurs = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && attentes.has(msg.id)) {
        const { ok, ko } = attentes.get(msg.id);
        attentes.delete(msg.id);
        msg.error ? ko(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) ecouteurs.forEach((f) => f(msg));
    };
    ws.onerror = reject;
    ws.onopen = () => resolve({
      envoyer: (method, params = {}) => new Promise((ok, ko) => {
        const n = ++id;
        attentes.set(n, { ok, ko });
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
      ecouter: (f) => ecouteurs.push(f),
      fermer: () => ws.close(),
    });
  });
}

async function main() {
  const sortie = path.resolve(process.argv[2] || "captures");
  const copie = process.argv[3] ? path.resolve(process.argv[3]) : null;
  fs.mkdirSync(sortie, { recursive: true });
  if (copie) fs.mkdirSync(copie, { recursive: true });

  const serveur = await demarrer();
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-captures-fraud-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--disable-sync", "--disable-component-update", "--hide-scrollbars",
    `--user-data-dir=${profil}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: "ignore" });

  const verifs = [];
  const fichiers = [];
  let cdp;
  try {
    const port = (await attendreFichier(path.join(profil, "DevToolsActivePort"))).split("\n")[0].trim();
    const cibles = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    cdp = await connecter(cibles.find((c) => c.type === "page").webSocketDebuggerUrl);
    const dialogues = [];
    cdp.ecouter((m) => {
      if (m.method === "Page.javascriptDialogOpening") {
        dialogues.push(m.params.message);
        cdp.envoyer("Page.handleJavaScriptDialog", { accept: false });
      }
    });
    await cdp.envoyer("Page.enable");
    await cdp.envoyer("Runtime.enable");
    await cdp.envoyer("Network.enable");
    await cdp.envoyer("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*/_vercel/*"] });

    const evaluer = async (expression) => {
      const r = await cdp.envoyer("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`Erreur page : ${r.exceptionDetails.text}`);
      return r.result.value;
    };
    const attendreQue = async (expression, delai = 15000) => {
      const fin = Date.now() + delai;
      while (Date.now() < fin) {
        if (await evaluer(expression)) return;
        await pause(100);
      }
      throw new Error(`Délai dépassé : ${expression}`);
    };
    const controle = (q) => fetch(`${serveur.adresse}/__controle?${q}`);
    const ouvrir = async () => {
      await cdp.envoyer("Page.navigate", { url: `${serveur.adresse}/` });
      await attendreQue("document.readyState === 'complete' && !!document.getElementById('formulaire')");
      await pause(300);
    };
    const cliquer = (selecteur) => evaluer(`document.querySelector(${JSON.stringify(selecteur)}).click()`);
    const visible = (id) => `!document.getElementById('${id}').hidden`;
    const capturer = async (etat, largeur) => {
      // En-tête collant : on remonte en haut pour qu'il soit capturé à sa place
      await evaluer("window.scrollTo(0, 0)");
      await pause(150);
      const { cssContentSize } = await cdp.envoyer("Page.getLayoutMetrics");
      const { data } = await cdp.envoyer("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: largeur, height: Math.ceil(cssContentSize.height), scale: 1 },
      });
      const nom = `${etat}-${largeur}.png`;
      fs.writeFileSync(path.join(sortie, nom), Buffer.from(data, "base64"));
      if (copie) fs.copyFileSync(path.join(sortie, nom), path.join(copie, nom));
      fichiers.push(nom);
    };
    const verifier = (nom, ok, detail = "") => verifs.push({ nom, ok: Boolean(ok), detail });

    for (const { largeur, hauteur, mobile } of LARGEURS) {
      await cdp.envoyer("Emulation.setDeviceMetricsOverride", { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile });
      await controle("quota=normal&latence=400&panne504=0&rejeuStatique=0");

      // 1. Formulaire
      await ouvrir();
      await attendreQue(visible("quotaRestant"));
      await capturer("formulaire", largeur);

      // 1 bis. Pastilles : chacune renseigne TOUS les champs, compteurs simulés compris,
      // et le dossier envoyé donne le score et le routage attendus.
      const ATTENDUS = { stp: [0, "Traitement automatique"], reseau: [30, "Alerte SIU"], precoce: [15, "Investigation"], recours: [0, "Traitement automatique"] };
      for (const [nom, [score, routage]] of Object.entries(ATTENDUS)) {
        await ouvrir();
        await cliquer(`[data-scenario="${nom}"]`);
        const champs = await evaluer("['reparateur_count_90d', 'ip_count_30d', 'id_reparateur'].map((i) => document.getElementById(i).value).join('|')");
        await cliquer("#boutonAnalyser");
        await attendreQue(visible("resultat"));
        const s = await evaluer("document.getElementById('scoreValeur').textContent");
        const r = await evaluer("document.getElementById('routage').textContent");
        verifier(`pastille ${nom}-${largeur} : ${score}/50, ${routage}`, s === String(score) && r.includes(routage), `compteurs|réparateur=${champs} score=${s} routage=${r}`);
      }
      await controle("quota=normal");

      // 1 ter. Formulaire par défaut et après « Réinitialiser » : compteurs à 0, l'agent n'est pas déclenché
      for (const etapeReset of [false, true]) {
        await ouvrir();
        if (etapeReset) {
          await cliquer('[data-scenario="reseau"]');
          await cliquer("#boutonReinitialiser");
        }
        const compteurs = await evaluer("['reparateur_count_90d', 'ip_count_30d'].map((i) => document.getElementById(i).value).join('|')");
        verifier(`defaut${etapeReset ? "-apres-reinitialiser" : ""}-${largeur} : compteurs à 0`, compteurs === "0|0", `compteurs=${compteurs}`);
        await cliquer("#boutonAnalyser");
        await attendreQue(visible("resultat"));
        const badge = await evaluer("document.getElementById('badge').textContent");
        verifier(`defaut${etapeReset ? "-apres-reinitialiser" : ""}-${largeur} : règles seules, aucun appel IA`, badge === "Règles seules — aucun appel IA", badge);
      }
      await controle("quota=normal");

      // 2. Attente (latence allongée)
      await controle("latence=5000");
      await cliquer('[data-scenario="reseau"]');
      await cliquer("#boutonAnalyser");
      await attendreQue(visible("attente"));
      await pause(400);
      await capturer("attente", largeur);
      await attendreQue(visible("resultat"), 30000);
      await controle("latence=400");

      // 3. Règles seules (STP sans rapport : aucun appel IA)
      await ouvrir();
      await cliquer('[data-scenario="stp"]');
      await cliquer("#boutonAnalyser");
      await attendreQue(visible("resultat"));
      verifier(`regles_seules-${largeur} : badge`, (await evaluer("document.getElementById('badge').textContent")) === "Règles seules — aucun appel IA");
      await capturer("regles-seules", largeur);

      // 4. Proposition (recours), puis 5. validation et finalisation
      await ouvrir();
      await cliquer('[data-scenario="recours"]');
      await cliquer("#boutonAnalyser");
      await attendreQue(visible("carteProposition"));
      verifier(`proposition-${largeur} : badge réel`, (await evaluer("document.getElementById('badge').textContent")).startsWith("Exécution réelle · "));
      verifier(`proposition-${largeur} : signature de réflexion absente`, !(await evaluer("document.body.innerText.includes('SIGNATURE')")));
      await capturer("proposition", largeur);
      await cliquer("#boutonValider");
      await attendreQue(visible("carteFinalisation"));
      await evaluer("document.querySelector('details.journal').open = true");
      verifier(`validation-${largeur} : mention brouillon`, await evaluer("document.getElementById('finalisation').textContent.includes('Brouillon — aucun envoi réel.')"));
      await capturer("validation", largeur);

      // 6. Rejeu signalé (quota épuisé, rejeu fictif local)
      await controle("quota=epuise");
      await ouvrir();
      await cliquer('[data-scenario="reseau"]');
      await cliquer("#boutonAnalyser");
      await attendreQue(visible("resultat"));
      verifier(`rejeu-${largeur} : bandeau`, await evaluer("document.getElementById('bandeau').textContent.includes('ce n\\u2019est pas') || document.getElementById('bandeau').textContent.includes(\"ce n'est pas l'analyse de votre saisie\")"));
      verifier(`rejeu-${largeur} : quota à 0`, (await evaluer("document.getElementById('quotaRestant').textContent")).endsWith(": 0"));
      await capturer("rejeu", largeur);
      await controle("quota=normal");

      // 7. Rapport de police contenant une charge XSS
      await ouvrir();
      await cliquer('[data-scenario="recours"]');
      await evaluer(`(() => { const t = document.getElementById('rapport_police'); t.value = ${JSON.stringify(XSS + "\n")} + t.value; })()`);
      await cliquer("#boutonAnalyser");
      await attendreQue(visible("carteProposition"));
      await evaluer("document.querySelector('details.journal').open = true");
      await pause(300);
      verifier(`xss-${largeur} : aucun <img src=x> dans le DOM`, (await evaluer("document.querySelectorAll('img[src=\"x\"]').length")) === 0);
      verifier(`xss-${largeur} : charge affichée comme texte`, await evaluer(`document.getElementById('proposition').textContent.includes(${JSON.stringify(XSS)})`));
      verifier(`xss-${largeur} : aucune boîte de dialogue`, dialogues.length === 0, dialogues.join(" | "));
      await capturer("xss", largeur);

      // Contrôle supplémentaire : 504 non JSON → message neutre (pas de rejeu statique)
      await controle("panne504=1");
      await ouvrir();
      await cliquer('[data-scenario="reseau"]');
      await cliquer("#boutonAnalyser");
      await attendreQue(visible("message"));
      const message = await evaluer("document.getElementById('message').textContent");
      verifier(`repli-client-${largeur} : message neutre sur 504`, message === "Analyse en direct momentanément indisponible. Réessayez plus tard.", message);
      verifier(`repli-client-${largeur} : aucune erreur brute`, !(await evaluer("document.body.innerText.includes('FUNCTION_INVOCATION_TIMEOUT')")));
      await controle("panne504=0");
    }
  } finally {
    if (cdp) {
      try { await cdp.envoyer("Browser.close"); } catch { /* déjà fermé */ }
      cdp.fermer();
    }
    chrome.kill();
    await pause(500);
    fs.rmSync(profil, { recursive: true, force: true });
    await serveur.fermer();
  }

  const profilSupprime = !fs.existsSync(profil);
  console.log(JSON.stringify({ sortie, copie, fichiers, verifs, profil_temporaire_supprime: profilSupprime }, null, 2));
  if (verifs.some((v) => !v.ok) || !profilSupprime) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
