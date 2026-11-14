// Hilfsfunktionen für die Werkzeuge: kleiner lokaler Webserver und Edge/Chrome ohne Fenster.
// Wird nur auf dem eigenen PC verwendet, nicht online ausgeliefert.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const WURZEL = path.join(__dirname, '..');
const TYPEN = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.pdf': 'application/pdf',
};

// Startet einen Webserver auf einem freien Port und liefert die Basis-Adresse zurück.
function serverStarten() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const datei = path.join(WURZEL, path.normalize(p));
      if (!datei.startsWith(WURZEL)) { res.writeHead(403); return res.end(); }
      fs.readFile(datei, (fehler, inhalt) => {
        if (fehler) { res.writeHead(404); return res.end('Nicht gefunden'); }
        res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
        res.end(inhalt);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, basis: `http://127.0.0.1:${server.address().port}` }));
  });
}

function browserFinden() {
  const kandidaten = [
    process.env.BROWSER_PFAD,
    // Chrome zuerst: Edge schreibt im unsichtbaren Modus auf manchen PCs keine Dateien
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean);
  const gefunden = kandidaten.find(p => fs.existsSync(p));
  if (!gefunden) throw new Error('Kein Edge oder Chrome gefunden. Pfad mit der Umgebungsvariable BROWSER_PFAD angeben.');
  return gefunden;
}

// Ruft den Browser ohne Fenster auf (eigenes Profil, damit ein offenes Fenster nicht stört).
// `ziel` ist die Datei, die entstehen muss – fehlt sie danach, gibt es einen Fehler.
// Asynchron, damit der Webserver im selben Programm währenddessen Seiten ausliefern kann.
async function browser(argumente, ziel) {
  if (ziel) fs.rmSync(ziel, { force: true });
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'black-in-browser-'));
  try {
    await new Promise((resolve, reject) => {
      const kind = execFile(browserFinden(), [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--hide-scrollbars', '--run-all-compositor-stages-before-draw',
        `--user-data-dir=${profil}`, ...argumente,
      ], { timeout: 120000 }, fehler => (fehler && fehler.killed ? reject(new Error('Browser-Zeitüberschreitung')) : resolve()));
      kind.stdout && kind.stdout.resume();
    });
  } finally {
    try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) { /* Browser hält Dateien evtl. noch kurz */ }
  }
  if (ziel && !fs.existsSync(ziel)) throw new Error(`Browser hat ${path.relative(WURZEL, ziel)} nicht erzeugt.`);
}

module.exports = { WURZEL, serverStarten, browser };
