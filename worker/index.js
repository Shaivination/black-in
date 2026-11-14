// Black-In – Cloudflare Worker
// - liefert die statische Website aus (Cloudflare "Static Assets")
// - nimmt Anmeldungen zu Veranstaltungen an und speichert sie in D1
// - verschickt Bestätigungsmails und den wöchentlichen Bericht (über Brevo)
// - bietet einen passwortgeschützten Admin-Bereich mit CSV-Export
//
// Zugangsdaten kommen ausschließlich aus Umgebungsvariablen (siehe LIESMICH.md).

import veranstaltungen from '../daten/veranstaltungen.json';

const ZEITZONE = 'Europe/Vienna';
const MAX_PERSONEN = 10;
const MAX_VERSUCHE_PRO_STUNDE = 8;
const LOESCHEN_NACH_TAGEN = 90;   // Anmeldungen 3 Monate nach der Veranstaltung löschen

// =====================================================================
//  Einstieg
// =====================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/veranstaltungen' && request.method === 'GET') return await apiVeranstaltungen(env);
      if (url.pathname === '/api/anmeldung' && request.method === 'POST') return await apiAnmeldung(request, env, ctx);
      if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) return await admin(request, env, url);
      if (url.pathname.startsWith('/api/')) return json({ ok: false, meldung: 'Nicht gefunden' }, 404);
    } catch (fehler) {
      console.error('Fehler bei', url.pathname, fehler && fehler.stack || fehler);
      return json({ ok: false, meldung: 'Interner Fehler. Bitte versuchen Sie es später noch einmal.' }, 500);
    }
    return env.ASSETS.fetch(request);
  },

  // Cron läuft montags um 04:00 und 05:00 UTC. Je nach Sommer-/Winterzeit
  // ist genau einer davon 06:00 Uhr in Wien – nur dann wird gesendet.
  async scheduled(event, env, ctx) {
    const wien = wienJetzt();
    if (wien.wochentag === 'Mon' && wien.stunde === 6) {
      const letzter = await letzterBericht(env);
      const vorStunden = letzter ? (Date.now() - Date.parse(letzter)) / 36e5 : Infinity;
      if (vorStunden > 20) await berichtSenden(env);
    }
    await aufraeumen(env);
  },
};

// =====================================================================
//  Hilfsfunktionen
// =====================================================================
function json(daten, status = 200) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Aktuelle Zeit in Wien als Text "YYYY-MM-DDTHH:MM" (zum Vergleichen mit Terminen)
function wienJetzt(datum = new Date()) {
  const teile = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ZEITZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(datum).forEach(t => { teile[t.type] = t.value; });
  const tag = `${teile.year}-${teile.month}-${teile.day}`;
  return {
    tag,
    text: `${tag}T${teile.hour}:${teile.minute}`,
    stunde: Number(teile.hour),
    wochentag: teile.weekday,   // Mon, Tue, ...
    anzeige: `${teile.day}.${teile.month}.${teile.year}`,
    anzeigeMitZeit: `${teile.day}.${teile.month}.${teile.year} ${teile.hour}:${teile.minute}`,
  };
}

function datumLang(datum) {
  const [j, m, t] = datum.split('-').map(Number);
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(j, m - 1, t)));
}

function datumKurz(datum) {
  const [j, m, t] = datum.split('-');
  return `${t}.${m}.${j}`;
}

async function sha256(text) {
  const daten = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', daten);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// =====================================================================
//  Veranstaltungen
// =====================================================================
function veranstaltungFinden(id) {
  return veranstaltungen.find(v => v.id === id);
}

async function belegtePlaetze(env) {
  const { results } = await env.DB.prepare(
    'SELECT veranstaltung_id AS id, COUNT(*) AS anmeldungen, COALESCE(SUM(personen), 0) AS personen FROM anmeldungen GROUP BY veranstaltung_id'
  ).all();
  const karte = {};
  for (const r of results) karte[r.id] = r;
  return karte;
}

function status(v, personen, jetzt) {
  const beginn = `${v.datum}T${v.uhrzeit || '00:00'}`;
  const vorbei = beginn <= jetzt.text;
  const schluss = v.anmeldeschluss
    ? (v.anmeldeschluss.length === 10 ? `${v.anmeldeschluss}T23:59` : v.anmeldeschluss)
    : beginn;
  const schlussVorbei = jetzt.text > schluss;
  const max = Number.isInteger(v.max_teilnehmer) && v.max_teilnehmer > 0 ? v.max_teilnehmer : null;
  const frei = max === null ? null : Math.max(0, max - personen);
  let grund = null;
  if (!v.aktiv) grund = 'inaktiv';
  else if (vorbei) grund = 'vorbei';
  else if (schlussVorbei) grund = 'anmeldeschluss';
  else if (frei === 0) grund = 'ausgebucht';
  return { vorbei, max, frei, offen: grund === null, grund };
}

// Öffentliche Liste: nur aktive, kommende Termine – ohne personenbezogene Daten
async function apiVeranstaltungen(env) {
  const jetzt = wienJetzt();
  const belegt = await belegtePlaetze(env);
  const liste = veranstaltungen
    .filter(v => v.aktiv)
    .map(v => ({ v, s: status(v, (belegt[v.id] || {}).personen || 0, jetzt) }))
    .filter(({ s }) => !s.vorbei)
    .sort((a, b) => (a.v.datum + a.v.uhrzeit).localeCompare(b.v.datum + b.v.uhrzeit))
    .map(({ v, s }) => ({
      id: v.id, titel: v.titel, datum: v.datum, uhrzeit: v.uhrzeit || '', ort: v.ort || '',
      beschreibung: v.beschreibung || '', anmeldeschluss: v.anmeldeschluss || null,
      max_teilnehmer: s.max, frei: s.frei, offen: s.offen, grund: s.grund,
    }));
  return json({ ok: true, veranstaltungen: liste });
}

// =====================================================================
//  Anmeldung
// =====================================================================
function pruefen(d) {
  const fehler = {};
  const text = (wert, max) => String(wert == null ? '' : wert).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max + 1);
  const daten = {
    veranstaltung: text(d.veranstaltung, 100),
    vorname: text(d.vorname, 60),
    nachname: text(d.nachname, 60),
    email: text(d.email, 254).toLowerCase(),
    telefon: text(d.telefon, 30),
    personen: Number(d.personen),
    anmerkung: String(d.anmerkung == null ? '' : d.anmerkung).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim(),
    datenschutz: d.datenschutz === true,
  };
  if (!daten.veranstaltung) fehler.veranstaltung = 'Bitte wählen Sie eine Veranstaltung.';
  if (!daten.vorname) fehler.vorname = 'Bitte geben Sie Ihren Vornamen an.';
  else if (daten.vorname.length > 60) fehler.vorname = 'Der Vorname darf höchstens 60 Zeichen lang sein.';
  if (!daten.nachname) fehler.nachname = 'Bitte geben Sie Ihren Nachnamen an.';
  else if (daten.nachname.length > 60) fehler.nachname = 'Der Nachname darf höchstens 60 Zeichen lang sein.';
  if (!daten.email) fehler.email = 'Bitte geben Sie Ihre E-Mail-Adresse an.';
  else if (daten.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(daten.email)) fehler.email = 'Bitte geben Sie eine gültige E-Mail-Adresse an, z. B. name@beispiel.at.';
  if (daten.telefon && (daten.telefon.length > 30 || !/^[0-9+()\/\-\s]{6,30}$/.test(daten.telefon))) fehler.telefon = 'Bitte geben Sie eine gültige Telefonnummer an (nur Ziffern, Leerzeichen und + ( ) / -).';
  if (!Number.isInteger(daten.personen) || daten.personen < 1 || daten.personen > MAX_PERSONEN) fehler.personen = `Bitte geben Sie eine Anzahl zwischen 1 und ${MAX_PERSONEN} an.`;
  if (daten.anmerkung.length > 1000) fehler.anmerkung = 'Die Anmerkung darf höchstens 1000 Zeichen lang sein.';
  if (!daten.datenschutz) fehler.datenschutz = 'Bitte bestätigen Sie die Datenschutzerklärung.';
  return { daten, fehler };
}

async function apiAnmeldung(request, env, ctx) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    return json({ ok: false, meldung: 'Ungültige Anfrage.' }, 415);
  }
  const roh = await request.text();
  if (roh.length > 10000) return json({ ok: false, meldung: 'Anfrage zu groß.' }, 413);
  let d;
  try { d = JSON.parse(roh); } catch (e) { return json({ ok: false, meldung: 'Ungültige Anfrage.' }, 400); }
  if (!d || typeof d !== 'object') return json({ ok: false, meldung: 'Ungültige Anfrage.' }, 400);

  // Spamschutz 1: Honeypot. Menschen sehen das Feld nicht, Bots füllen es aus.
  // Wir tun so, als wäre alles gut gegangen, speichern aber nichts.
  if (d.website) return json({ ok: true });

  // Spamschutz 2: Rate-Limit pro (gehashter) IP-Adresse
  const ip = request.headers.get('CF-Connecting-IP') || 'unbekannt';
  const ipHash = await sha256((env.IP_SALZ || 'black-in') + ip);
  const jetztMs = Date.now();
  const { versuche } = await env.DB.prepare('SELECT COUNT(*) AS versuche FROM rate_limit WHERE ip_hash = ? AND zeit > ?')
    .bind(ipHash, jetztMs - 3600e3).first();
  if (versuche >= MAX_VERSUCHE_PRO_STUNDE) {
    return json({ ok: false, meldung: 'Zu viele Anmeldeversuche. Bitte versuchen Sie es in einer Stunde noch einmal.' }, 429);
  }
  await env.DB.prepare('INSERT INTO rate_limit (ip_hash, zeit) VALUES (?, ?)').bind(ipHash, jetztMs).run();

  // Eingaben prüfen
  const { daten, fehler } = pruefen(d);
  if (Object.keys(fehler).length) return json({ ok: false, meldung: 'Bitte prüfen Sie die markierten Felder.', fehler }, 400);

  // Veranstaltung prüfen
  const v = veranstaltungFinden(daten.veranstaltung);
  if (!v) return json({ ok: false, meldung: 'Diese Veranstaltung gibt es nicht.', fehler: { veranstaltung: 'Bitte wählen Sie eine Veranstaltung.' } }, 400);
  const jetzt = wienJetzt();
  const belegt = (await belegtePlaetze(env))[v.id] || { personen: 0 };
  const s = status(v, belegt.personen, jetzt);
  if (!s.offen) {
    const texte = {
      inaktiv: 'Für diese Veranstaltung ist keine Anmeldung möglich.',
      vorbei: 'Diese Veranstaltung hat bereits stattgefunden.',
      anmeldeschluss: 'Der Anmeldeschluss für diese Veranstaltung ist vorbei.',
      ausgebucht: 'Diese Veranstaltung ist leider ausgebucht.',
    };
    return json({ ok: false, meldung: texte[s.grund], grund: s.grund }, 409);
  }
  if (s.frei !== null && daten.personen > s.frei) {
    const text = s.frei === 1 ? 'Es ist nur noch 1 Platz frei.' : `Es sind nur noch ${s.frei} Plätze frei.`;
    return json({ ok: false, meldung: text, fehler: { personen: text } }, 409);
  }

  // Speichern – die Platzprüfung passiert in derselben Anweisung, damit
  // zwei gleichzeitige Anmeldungen das Limit nicht überschreiten können.
  const ergebnis = await env.DB.prepare(
    `INSERT INTO anmeldungen (veranstaltung_id, vorname, nachname, email, telefon, personen, anmerkung, erstellt_am)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
     WHERE ?9 IS NULL OR (SELECT COALESCE(SUM(personen), 0) FROM anmeldungen WHERE veranstaltung_id = ?1) + ?6 <= ?9`
  ).bind(v.id, daten.vorname, daten.nachname, daten.email, daten.telefon || null, daten.personen,
         daten.anmerkung || null, new Date().toISOString(), s.max).run();
  if (!ergebnis.meta.changes) {
    return json({ ok: false, meldung: 'Diese Veranstaltung ist gerade ausgebucht worden.', grund: 'ausgebucht' }, 409);
  }

  // Bestätigungsmail im Hintergrund verschicken (Anmeldung ist schon gespeichert)
  ctx.waitUntil(bestaetigungSenden(env, v, daten).catch(e => console.error('Bestätigungsmail fehlgeschlagen:', e)));

  return json({
    ok: true,
    veranstaltung: { titel: v.titel, datum: datumLang(v.datum), uhrzeit: v.uhrzeit || '', ort: v.ort || '' },
  });
}

// =====================================================================
//  E-Mails (Brevo)
// =====================================================================
async function mailSenden(env, { an, betreff, text, html }) {
  if (!env.BREVO_API_KEY || !env.MAIL_ABSENDER) {
    // Lokal/ohne Zugangsdaten: nichts verschicken, nur protokollieren
    console.log(`[Mail NICHT gesendet – BREVO_API_KEY oder MAIL_ABSENDER fehlt]\nAn: ${an}\nBetreff: ${betreff}\n\n${text}`);
    return { simuliert: true };
  }
  const antwort = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: env.MAIL_ABSENDER, name: env.MAIL_ABSENDER_NAME || 'Black-In' },
      to: [{ email: an }],
      subject: betreff,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!antwort.ok) throw new Error(`Brevo antwortet ${antwort.status}: ${await antwort.text()}`);
  return { gesendet: true };
}

function mailRahmen(inhalt) {
  return `<!doctype html><html lang="de-AT"><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#1d1d1f">
<div style="max-width:600px;margin:0 auto;padding:24px">
<div style="background:#07080a;color:#f3e6d0;padding:16px 20px;border-radius:10px 10px 0 0;font-weight:bold;letter-spacing:.08em">BLACK<span style="color:#f5c518">-IN</span> · Verein zur Krisenvorsorge</div>
<div style="background:#ffffff;padding:20px;border-radius:0 0 10px 10px;line-height:1.55">${inhalt}</div>
</div></body></html>`;
}

async function bestaetigungSenden(env, v, d) {
  const wann = `${datumLang(v.datum)}${v.uhrzeit ? `, ${v.uhrzeit} Uhr` : ''}`;
  const betreff = `Anmeldung bestätigt: ${v.titel}`;
  const text = [
    `Guten Tag ${d.vorname} ${d.nachname},`,
    '',
    'vielen Dank für Ihre Anmeldung. Wir haben folgende Angaben erhalten:',
    '',
    `Veranstaltung: ${v.titel}`,
    `Wann: ${wann}`,
    v.ort ? `Wo: ${v.ort}` : null,
    `Personen: ${d.personen}`,
    d.anmerkung ? `Ihre Anmerkung: ${d.anmerkung}` : null,
    '',
    'Falls Sie doch nicht kommen können, antworten Sie bitte kurz auf diese E-Mail.',
    '',
    'Herzliche Grüße',
    'Black-In – Verein zur Krisenvorsorge',
  ].filter(z => z !== null).join('\n');
  const html = mailRahmen(`
<p>Guten Tag ${esc(d.vorname)} ${esc(d.nachname)},</p>
<p>vielen Dank für Ihre Anmeldung. Wir haben folgende Angaben erhalten:</p>
<table style="border-collapse:collapse">
<tr><td style="padding:4px 12px 4px 0;color:#666">Veranstaltung</td><td style="padding:4px 0"><b>${esc(v.titel)}</b></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#666">Wann</td><td style="padding:4px 0">${esc(wann)}</td></tr>
${v.ort ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Wo</td><td style="padding:4px 0">${esc(v.ort)}</td></tr>` : ''}
<tr><td style="padding:4px 12px 4px 0;color:#666">Personen</td><td style="padding:4px 0">${d.personen}</td></tr>
${d.anmerkung ? `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Anmerkung</td><td style="padding:4px 0">${esc(d.anmerkung)}</td></tr>` : ''}
</table>
<p>Falls Sie doch nicht kommen können, antworten Sie bitte kurz auf diese E-Mail.</p>
<p>Herzliche Grüße<br>Black-In – Verein zur Krisenvorsorge</p>`);
  return mailSenden(env, { an: d.email, betreff, text, html });
}

// =====================================================================
//  Wöchentlicher Bericht
// =====================================================================
async function letzterBericht(env) {
  const zeile = await env.DB.prepare('SELECT gesendet_am FROM berichte ORDER BY id DESC LIMIT 1').first();
  return zeile ? zeile.gesendet_am : null;
}

async function berichtErstellen(env) {
  const jetzt = wienJetzt();
  const seit = await letzterBericht(env);
  const belegt = await belegtePlaetze(env);
  const neu = {};
  const { results } = await env.DB.prepare(
    'SELECT veranstaltung_id AS id, COUNT(*) AS anzahl FROM anmeldungen WHERE erstellt_am > ? GROUP BY veranstaltung_id'
  ).bind(seit || '1970-01-01T00:00:00.000Z').all();
  for (const r of results) neu[r.id] = r.anzahl;

  const zeilen = veranstaltungen
    .map(v => {
      const b = belegt[v.id] || { anmeldungen: 0, personen: 0 };
      const s = status(v, b.personen, jetzt);
      return { v, b, s };
    })
    .filter(({ s }) => !s.vorbei)   // vergangene Veranstaltungen ausblenden
    .sort((a, b) => (a.v.datum + a.v.uhrzeit).localeCompare(b.v.datum + b.v.uhrzeit))
    .map(({ v, b, s }) => ({
      veranstaltung_id: v.id,
      titel: v.titel,
      datum: v.datum,
      uhrzeit: v.uhrzeit || '',
      anmeldungen_gesamt: b.anmeldungen,
      personen_gesamt: b.personen,
      neu_seit_letztem_bericht: neu[v.id] || 0,
      freie_plaetze: s.frei === null ? '' : s.frei,
    }));

  const spalten = ['veranstaltung_id', 'titel', 'datum', 'uhrzeit', 'anmeldungen_gesamt', 'personen_gesamt', 'neu_seit_letztem_bericht', 'freie_plaetze'];
  const csvZelle = w => /[;"\n]/.test(String(w)) ? `"${String(w).replace(/"/g, '""')}"` : String(w);
  const csv = [spalten.join(';'), ...zeilen.map(z => spalten.map(k => csvZelle(z[k])).join(';'))].join('\n');
  const seitText = seit ? wienJetzt(new Date(seit)).anzeigeMitZeit : 'Beginn der Aufzeichnung';

  const betreff = `Black-In Anmeldungen ${jetzt.anzeige}`;
  const text = [
    `Black-In Anmeldungen – Bericht vom ${jetzt.anzeigeMitZeit} (Europe/Vienna)`,
    `Neuanmeldungen gezählt seit: ${seitText}`,
    `Veranstaltungen: ${zeilen.length}`,
    '',
    '--- DATEN (CSV, Trennzeichen ;) ---',
    csv,
    '--- ENDE DATEN ---',
  ].join('\n');
  const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #07080a;font-size:13px"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #ddd;font-size:13px"';
  const html = mailRahmen(`
<p><b>Bericht vom ${esc(jetzt.anzeigeMitZeit)}</b><br>Neuanmeldungen gezählt seit: ${esc(seitText)}</p>
${zeilen.length ? `<table style="border-collapse:collapse;width:100%">
<thead><tr>${spalten.map(k => `<th ${th}>${esc(k)}</th>`).join('')}</tr></thead>
<tbody>${zeilen.map(z => `<tr>${spalten.map(k => `<td ${td}>${esc(z[k])}</td>`).join('')}</tr>`).join('')}</tbody>
</table>` : '<p>Derzeit sind keine kommenden Veranstaltungen eingetragen.</p>'}
<pre style="margin-top:20px;font-size:12px;background:#f4f1ea;padding:10px;border-radius:6px;white-space:pre-wrap">${esc(csv)}</pre>`);
  return { betreff, text, html, zeilen };
}

async function berichtSenden(env) {
  const bericht = await berichtErstellen(env);
  if (!env.BERICHT_AN) {
    console.log('[Bericht NICHT gesendet – BERICHT_AN fehlt]\n' + bericht.text);
    return { ...bericht, simuliert: true };
  }
  const ergebnis = await mailSenden(env, { an: env.BERICHT_AN, betreff: bericht.betreff, text: bericht.text, html: bericht.html });
  // Nur echte Sendungen zählen als "letzter Bericht"
  if (!ergebnis.simuliert) await env.DB.prepare('INSERT INTO berichte (gesendet_am) VALUES (?)').bind(new Date().toISOString()).run();
  return { ...bericht, ...ergebnis };
}

// =====================================================================
//  Aufräumen (Datenschutz): alte Anmeldungen und Spamschutz-Einträge löschen
// =====================================================================
async function aufraeumen(env) {
  await env.DB.prepare('DELETE FROM rate_limit WHERE zeit < ?').bind(Date.now() - 24 * 3600e3).run();
  const grenze = new Date(Date.now() - LOESCHEN_NACH_TAGEN * 864e5).toISOString().slice(0, 10);
  for (const v of veranstaltungen) {
    if (v.datum < grenze) await env.DB.prepare('DELETE FROM anmeldungen WHERE veranstaltung_id = ?').bind(v.id).run();
  }
}

// =====================================================================
//  Admin-Bereich (HTTP Basic Auth, Passwort aus ADMIN_PASSWORT)
// =====================================================================
async function passwortOk(request, env) {
  if (!env.ADMIN_PASSWORT) return false;
  const kopf = request.headers.get('Authorization') || '';
  if (!kopf.startsWith('Basic ')) return false;
  let passwort = '';
  try { passwort = atob(kopf.slice(6)).split(':').slice(1).join(':'); } catch (e) { return false; }
  // Zeitkonstanter Vergleich über Hashes gleicher Länge
  const a = new TextEncoder().encode(await sha256(passwort));
  const b = new TextEncoder().encode(await sha256(env.ADMIN_PASSWORT));
  return crypto.subtle.timingSafeEqual(a, b);
}

async function admin(request, env, url) {
  if (!env.ADMIN_PASSWORT) return new Response('Admin-Bereich ist nicht eingerichtet (ADMIN_PASSWORT fehlt).', { status: 503 });
  if (!(await passwortOk(request, env))) {
    return new Response('Anmeldung erforderlich', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Black-In Admin", charset="UTF-8"', 'Cache-Control': 'no-store' },
    });
  }
  const kein = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

  // CSV-Export einer Veranstaltung
  if (url.pathname === '/api/admin/export' && request.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    const v = veranstaltungFinden(id);
    if (!v) return new Response('Veranstaltung nicht gefunden', { status: 404, headers: kein });
    const { results } = await env.DB.prepare(
      'SELECT id, erstellt_am, vorname, nachname, email, telefon, personen, anmerkung FROM anmeldungen WHERE veranstaltung_id = ? ORDER BY id'
    ).bind(id).all();
    // Zellen, die mit = + - @ beginnen, entschärfen (Schutz vor Formeln in Excel)
    const zelle = w => {
      let t = String(w == null ? '' : w);
      if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const kopf = ['Nr', 'Angemeldet am', 'Vorname', 'Nachname', 'E-Mail', 'Telefon', 'Personen', 'Anmerkung'];
    const zeilen = results.map(r => [r.id, wienJetzt(new Date(r.erstellt_am)).anzeigeMitZeit, r.vorname, r.nachname, r.email, r.telefon, r.personen, r.anmerkung].map(zelle).join(';'));
    const csv = '﻿' + [kopf.join(';'), ...zeilen].join('\r\n');
    return new Response(csv, {
      headers: {
        ...kein,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="anmeldungen-${id}.csv"`,
      },
    });
  }

  // Bericht sofort senden (zum Testen)
  if (url.pathname === '/api/admin/bericht' && request.method === 'POST') {
    const herkunft = request.headers.get('Origin');
    if (herkunft && herkunft !== url.origin) return new Response('Nicht erlaubt', { status: 403, headers: kein });
    const ergebnis = await berichtSenden(env);
    return new Response(null, { status: 303, headers: { ...kein, Location: `/api/admin?bericht=${ergebnis.simuliert ? 'simuliert' : 'gesendet'}` } });
  }

  if (url.pathname !== '/api/admin') return new Response('Nicht gefunden', { status: 404, headers: kein });

  // Übersicht
  const jetzt = wienJetzt();
  const belegt = await belegtePlaetze(env);
  const meldung = url.searchParams.get('bericht');
  const zeilen = [...veranstaltungen]
    .sort((a, b) => (a.datum + a.uhrzeit).localeCompare(b.datum + b.uhrzeit))
    .map(v => {
      const b = belegt[v.id] || { anmeldungen: 0, personen: 0 };
      const s = status(v, b.personen, jetzt);
      const zustand = s.offen ? 'offen' : { inaktiv: 'inaktiv', vorbei: 'vorbei', anmeldeschluss: 'Anmeldeschluss vorbei', ausgebucht: 'ausgebucht' }[s.grund];
      return `<tr>
<td><strong>${esc(v.titel)}</strong><br><span class="muted">${esc(v.id)}</span></td>
<td>${esc(datumKurz(v.datum))} ${esc(v.uhrzeit || '')}</td>
<td>${b.anmeldungen}</td><td>${b.personen}</td>
<td>${s.max === null ? '–' : `${s.frei} von ${s.max}`}</td>
<td>${esc(zustand)}</td>
<td><a class="btn btn-outline" href="/api/admin/export?id=${encodeURIComponent(v.id)}">CSV</a></td>
</tr>`;
    }).join('');
  const seite = `<!doctype html><html lang="de-AT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Admin – Black-In</title><link rel="icon" href="/img/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/style.css"></head>
<body><main id="inhalt"><section><div class="wrap">
<p class="eyebrow">Admin</p><h1>Anmeldungen</h1>
${meldung === 'gesendet' ? '<div class="callout"><p>Der Bericht wurde verschickt.</p></div>' : ''}
${meldung === 'simuliert' ? '<div class="callout"><p>Der Bericht wurde erstellt, aber nicht verschickt (Mail-Zugangsdaten oder BERICHT_AN fehlen). Inhalt steht im Worker-Log.</p></div>' : ''}
<div style="overflow-x:auto"><table class="simple"><thead><tr><th>Veranstaltung</th><th>Datum</th><th>Anmeldungen</th><th>Personen</th><th>Frei</th><th>Status</th><th>Export</th></tr></thead>
<tbody>${zeilen || '<tr><td colspan="7">Keine Veranstaltungen eingetragen.</td></tr>'}</tbody></table></div>
<form method="post" action="/api/admin/bericht" style="margin-top:28px"><button class="btn btn-primary" type="submit">Bericht jetzt senden</button>
<p class="muted" style="margin-top:10px">Der Bericht kommt automatisch jeden Montag um 06:00 Uhr. Mit dem Knopf kannst du ihn sofort verschicken (zählt als „letzter Bericht“).</p></form>
</div></section></main></body></html>`;
  return new Response(seite, { headers: { ...kein, 'Content-Type': 'text/html; charset=utf-8' } });
}
