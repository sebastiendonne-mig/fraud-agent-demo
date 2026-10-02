// Captures Jev : 4 cas × 2 largeurs, Chrome headless, profil temporaire supprimé.
// Harnais local mocké : aucun appel réseau réel, aucun quota Jev ni analyse consommé.
// Cas : montee (signal → montée d'un niveau), plafond (signal, ALERTE_SIU déjà max),
//        incertain (incertains ignorés), repli (Jev indisponible, règles seules).
// Usage : node scripts/captures-front-jev.js [<dossier de sortie>]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { demarrer } = require("./serveur-local.js");

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LARGEURS = [{ largeur: 1440, hauteur: 900, mobile: false }, { largeur: 390, hauteur: 844, mobile: true }];
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
  const sortie = path.resolve(process.argv[2] || "captures-jev");
  fs.mkdirSync(sortie, { recursive: true });

  const serveur = await demarrer();
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-captures-jev-"));
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
    await cdp.envoyer("Page.enable");
    await cdp.envoyer("Runtime.enable");
    await cdp.envoyer("Network.enable");
    await cdp.envoyer("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*/_vercel/*"] });

    const evaluer = async (expression) => {
      const r = await cdp.envoyer("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`Erreur page : ${r.exceptionDetails.text}`);
      return r.result.value;
    };
    const attendreQue = async (expression, delai = 20000) => {
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
    const cliquer = (sel) => evaluer(`document.querySelector(${JSON.stringify(sel)}).click()`);
    const visible = (id) => `!document.getElementById('${id}').hidden`;
    const capturer = async (nom, largeur) => {
      await evaluer("window.scrollTo(0, 0)");
      await pause(150);
      // captureBeyondViewport répète les éléments sticky à chaque hauteur de viewport :
      // on retire le comportement sticky le temps de la capture, puis on le restaure.
      await evaluer("document.querySelector('.tk-header') && (document.querySelector('.tk-header').style.position = 'relative')");
      const { cssContentSize } = await cdp.envoyer("Page.getLayoutMetrics");
      const { data } = await cdp.envoyer("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: largeur, height: Math.ceil(cssContentSize.height), scale: 1 },
      });
      await evaluer("document.querySelector('.tk-header') && (document.querySelector('.tk-header').style.position = '')");
      const fichier = `${nom}-${largeur}.png`;
      fs.writeFileSync(path.join(sortie, fichier), Buffer.from(data, "base64"));
      fichiers.push(fichier);
    };
    const verifier = (nom, ok, detail = "") => verifs.push({ nom, ok: Boolean(ok), detail });

    // Cas 1 : montée — precoce (INVESTIGATION) + signal Jev → ALERTE_SIU
    // Cas 2 : plafond — reseau (ALERTE_SIU) + signal Jev → reste ALERTE_SIU
    // Cas 3 : incertain — precoce (INVESTIGATION) + incertains → reste INVESTIGATION
    // Cas 4 : repli — stp + Jev échoue → RÈGLES SEULES, badge "Jev indisponible"
    const CAS = [
      { nom: "jev-montee",    scenario: "precoce", jevMode: "releve",   agent: true  },
      { nom: "jev-plafond",   scenario: "reseau",  jevMode: "plafond",  agent: true  },
      { nom: "jev-incertain", scenario: "precoce", jevMode: "incertain",agent: true  },
      { nom: "jev-repli",     scenario: "stp",     jevMode: "repli",    agent: false },
    ];

    for (const { largeur, hauteur, mobile } of LARGEURS) {
      await cdp.envoyer("Emulation.setDeviceMetricsOverride", { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile });

      for (const { nom, scenario, jevMode, agent } of CAS) {
        await controle(`jev_mode=${jevMode}&quota=normal&latence=400&panne504=0`);
        await ouvrir();
        await cliquer(`[data-scenario="${scenario}"]`);
        await cliquer("#boutonAnalyser");

        if (agent) {
          await attendreQue(visible("carteProposition"), 25000);
        } else {
          await attendreQue(visible("resultat"), 10000);
        }
        await pause(200);

        // Vérification 1 : carteJev visible
        const jevVisible = await evaluer(visible("carteJev"));
        verifier(`${nom}-${largeur} : carteJev visible`, jevVisible);

        // Vérification 2 : badge selon le cas
        const badge = await evaluer("document.getElementById('badge').textContent");
        if (jevMode === "repli") {
          verifier(`${nom}-${largeur} : badge repli`, badge === "Règles seules — Jev indisponible", badge);
        } else {
          verifier(`${nom}-${largeur} : badge agent + Jev`, badge.includes("· Jev"), badge);
        }

        // Vérification 3 : section carteJev contient du texte (pas vide)
        const jevTexte = await evaluer("document.getElementById('carteJev').textContent.trim().length > 0");
        verifier(`${nom}-${largeur} : carteJev non vide`, jevTexte);

        await capturer(nom, largeur);
      }
    }

    // Remettre jev_mode à null après les captures
    await controle("jev_mode=");
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
  console.log(JSON.stringify({ sortie, fichiers, verifs, profil_temporaire_supprime: profilSupprime }, null, 2));
  if (verifs.some((v) => !v.ok) || !profilSupprime) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
