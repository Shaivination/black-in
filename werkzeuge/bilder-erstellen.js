// Erzeugt die PNG-Bilder aus den SVG-Logos:
//   img/vorschau.png          1200 × 630  Vorschaubild für Google, WhatsApp, Facebook
//   img/logo-512.png          512 × 512   Logo für Google (strukturierte Daten)
//   img/logo-192.png          192 × 192   Favicon für Google und Android
//   img/apple-touch-icon.png  180 × 180   Symbol für iPhone/iPad-Startbildschirm
// Aufruf: npm run bilder
const fs = require('fs');
const path = require('path');
const { WURZEL, serverStarten, browser } = require('./browser');

const ICON_SEITE = (groesse, hintergrund) => `<!doctype html><html><head><style>
html,body{margin:0;width:${groesse}px;height:${groesse}px;overflow:hidden;background:${hintergrund}}
img{display:block;width:${groesse}px;height:${groesse}px}</style></head>
<body><img src="/img/logo.svg" alt=""></body></html>`;

(async () => {
  const tmp = path.join(WURZEL, 'werkzeuge', '_icon.html');
  const { server, basis } = await serverStarten();
  try {
    const vorschau = path.join(WURZEL, 'img', 'vorschau.png');
    await browser([`--screenshot=${vorschau}`, '--window-size=1200,630', `${basis}/werkzeuge/vorschau-bild.html`], vorschau);
    console.log('✓ img/vorschau.png');

    for (const [name, groesse, hintergrund] of [
      ['logo-512.png', 512, 'transparent'],
      ['logo-192.png', 192, 'transparent'],
      ['apple-touch-icon.png', 180, '#07080a'],   // iOS mag keine Transparenz
    ]) {
      fs.writeFileSync(tmp, ICON_SEITE(groesse, hintergrund));
      const ziel = path.join(WURZEL, 'img', name);
      await browser([
        `--screenshot=${ziel}`, `--window-size=${groesse},${groesse}`,
        '--default-background-color=00000000', `${basis}/werkzeuge/_icon.html`,
      ], ziel);
      console.log(`✓ img/${name}`);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
    server.close();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
