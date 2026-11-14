// Erzeugt die PDFs zum Herunterladen aus handbuch.html:
//   pdf/black-in-notfall-handbuch.pdf   alles in einem
//   pdf/black-in-<thema>.pdf            je ein PDF pro Thema aus wissen.html
// Aufruf: npm run pdf   (nach jeder inhaltlichen Änderung neu ausführen)
const fs = require('fs');
const path = require('path');
const { WURZEL, serverStarten, browser } = require('./browser');

(async () => {
  const wissen = fs.readFileSync(path.join(WURZEL, 'wissen.html'), 'utf8');
  const themen = [...wissen.matchAll(/<article class="topic" id="([a-z0-9-]+)"/g)].map(m => m[1]);
  const ordner = path.join(WURZEL, 'pdf');
  fs.mkdirSync(ordner, { recursive: true });

  const auftraege = [{ datei: 'black-in-notfall-handbuch.pdf', seite: 'handbuch.html' }]
    .concat(themen.map(t => ({ datei: `black-in-${t}.pdf`, seite: `handbuch.html?thema=${t}` })));

  // Alte PDFs von Themen entfernen, die es nicht mehr gibt
  const erwartet = new Set(auftraege.map(a => a.datei));
  for (const f of fs.readdirSync(ordner)) if (f.endsWith('.pdf') && !erwartet.has(f)) fs.rmSync(path.join(ordner, f));

  const { server, basis } = await serverStarten();
  try {
    for (const a of auftraege) {
      const ziel = path.join(ordner, a.datei);
      await browser([
        `--print-to-pdf=${ziel}`, '--no-pdf-header-footer', '--virtual-time-budget=15000',
        `${basis}/${a.seite}`,
      ], ziel);
      const inhalt = fs.readFileSync(ziel);
      const seiten = (inhalt.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      console.log(`✓ pdf/${a.datei}  (${seiten} Seiten, ${Math.round(inhalt.length / 1024)} KB)`);
    }
  } finally {
    server.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
