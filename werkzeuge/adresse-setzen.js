// Stellt die Website-Adresse in allen Dateien um, z. B. beim Umzug auf die eigene Domain.
// Aufruf: npm run adresse -- https://www.black-in.at
// Betrifft: Google-/Vorschau-Angaben in allen Seiten, sitemap.xml, robots.txt.
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');

const neu = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+(\/[a-z0-9._-]+)*$/i.test(neu)) {
  console.error('Bitte die neue Adresse angeben, z. B.: npm run adresse -- https://www.black-in.at');
  process.exit(1);
}
const index = fs.readFileSync(path.join(WURZEL, 'index.html'), 'utf8');
const alt = (index.match(/<link rel="canonical" href="([^"]+)\/">/) || [])[1];
if (!alt) { console.error('Alte Adresse nicht gefunden (canonical in index.html).'); process.exit(1); }
if (alt === neu) { console.log('Adresse ist bereits', neu); process.exit(0); }

const dateien = fs.readdirSync(WURZEL).filter(f => f.endsWith('.html')).concat(['sitemap.xml', 'robots.txt']);
let anzahl = 0;
for (const datei of dateien) {
  const voll = path.join(WURZEL, datei);
  if (!fs.existsSync(voll)) continue;
  const inhalt = fs.readFileSync(voll, 'utf8');
  const ersetzt = inhalt.split(alt).join(neu);
  if (ersetzt !== inhalt) { fs.writeFileSync(voll, ersetzt); anzahl++; console.log('✓', datei); }
}
console.log(`${anzahl} Dateien von ${alt} auf ${neu} umgestellt.`);
