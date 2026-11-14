# Website black-in.at

Statische Website (reines HTML/CSS/JS, kein CMS) mit einem kleinen **Cloudflare Worker**
für die Anmeldung zu Veranstaltungen. Gehostet wird alles bei Cloudflare:

| Teil | Wo |
|---|---|
| Seiten, Bilder, CSS, JS | dieser Ordner (Cloudflare „Static Assets“) |
| Anmeldung, Admin, Bericht | `worker/index.js` |
| Veranstaltungen | `daten/veranstaltungen.json` |
| Anmeldungen | Cloudflare D1-Datenbank `black-in` (Schema in `migrations/`) |
| E-Mails | Brevo (Bestätigung an Teilnehmer, Wochenbericht) |
| Konfiguration | `wrangler.jsonc` (ohne Geheimnisse) |

Was **nicht** öffentlich ausgeliefert werden darf (Worker-Code, Daten, Konfiguration),
steht in `.assetsignore`.

## Vor dem Veröffentlichen ausfüllen (gelb markiert, Suche nach `todo`)
- `impressum.html`: Straße, ZVR-Zahl, Name des Präsidenten
- `datenschutz.html`: Straße, Löschfrist der Logdaten, Statistik-Tool
- `kontakt.html`: Straße
- `verein.html`: Namen des Vorstands

## Neue Veranstaltung anlegen
1. `daten/veranstaltungen.json` öffnen.
2. Einen Block kopieren, mit Komma vom vorigen trennen und ausfüllen:

```json
{
  "id": "blackout-vortrag-2027-03",
  "titel": "Blackout – was tun, wenn der Strom weg ist?",
  "datum": "2027-03-14",
  "uhrzeit": "19:00",
  "ort": "Gemeindesaal Sonntag, 6731 Sonntag",
  "beschreibung": "Kurzer Text: worum geht es, für wen?",
  "max_teilnehmer": 40,
  "anmeldeschluss": "2027-03-12",
  "aktiv": true
}
```

| Feld | Bedeutung |
|---|---|
| `id` | eindeutig, nur Kleinbuchstaben, Ziffern und `-`. **Nach der ersten Anmeldung nicht mehr ändern.** |
| `datum` | `JJJJ-MM-TT` |
| `uhrzeit` | `HH:MM` (Wiener Zeit) |
| `max_teilnehmer` | Zahl oder `null` (= unbegrenzt). Gezählt werden Personen, nicht Anmeldungen. |
| `anmeldeschluss` | `JJJJ-MM-TT` (gilt bis 23:59) oder `JJJJ-MM-TTTHH:MM`, oder `null` (= bis Beginn) |
| `aktiv` | `false` blendet den Termin aus und sperrt die Anmeldung |

3. Speichern und veröffentlichen: `npm run deploy` (siehe unten).

Vergangene Termine verschwinden automatisch von der Website. Ihre Anmeldungen werden
90 Tage nach dem Termin automatisch gelöscht. Den Eintrag in der JSON-Datei kann man
danach entfernen.

Direktlink auf das Formular einer Veranstaltung:
`https://<adresse>/termine.html?veranstaltung=<id>`

## Admin-Bereich
`https://<adresse>/api/admin` (Benutzername beliebig, Passwort = `ADMIN_PASSWORT`)
- Übersicht aller Veranstaltungen mit Anmeldungen, Personen, freien Plätzen
- **CSV-Export** pro Veranstaltung (Semikolon-getrennt, öffnet direkt in Excel)
- Knopf „Bericht jetzt senden“

## Wöchentlicher Bericht
Jeden **Montag um 06:00 Uhr (Europe/Vienna)** an `BERICHT_AN`.
Betreff: `Black-In Anmeldungen TT.MM.JJJJ`. Inhalt: pro kommender Veranstaltung
`veranstaltung_id;titel;datum;uhrzeit;anmeldungen_gesamt;personen_gesamt;neu_seit_letztem_bericht;freie_plaetze`
(als Tabelle und als CSV-Block zwischen `--- DATEN` und `--- ENDE DATEN ---`).

Technisch: Cron-Trigger Montag 04:00 und 05:00 UTC; der Worker sendet nur, wenn es in
Wien gerade 06:00 ist (deckt Sommer- und Winterzeit ab).

## Umgebungsvariablen (Geheimnisse)
Nie in den Code oder ins Git schreiben. Online setzen mit
`npx wrangler secret put NAME`, lokal in der Datei `.dev.vars` (ist in `.gitignore`).

| Name | Pflicht | Inhalt |
|---|---|---|
| `ADMIN_PASSWORT` | ja | Passwort für `/api/admin` (lang und zufällig) |
| `IP_SALZ` | ja | beliebige lange Zufallszeichenfolge für den Spamschutz |
| `BREVO_API_KEY` | ja | API-Schlüssel von Brevo (Transactional E-Mails) |
| `MAIL_ABSENDER` | ja | bei Brevo bestätigte Absenderadresse |
| `BERICHT_AN` | ja | Empfänger des Wochenberichts |

`MAIL_ABSENDER_NAME` steht (nicht geheim) in `wrangler.jsonc`.
Fehlen `BREVO_API_KEY`/`MAIL_ABSENDER`, werden keine Mails verschickt, sondern nur ins Log geschrieben.

## Lokal testen
```
npm install
npm run db:lokal      # Datenbank-Tabellen lokal anlegen
npm run dev           # http://localhost:8787
```
Bericht lokal auslösen: `http://localhost:8787/__scheduled?cron=0+5+*+*+1`
(sendet nur montags um 06:00) oder im Admin-Bereich „Bericht jetzt senden“.

## Erstmalig einrichten (Cloudflare)
1. `npx wrangler login`
2. `npx wrangler d1 create black-in` und die ausgegebene `database_id` in `wrangler.jsonc` eintragen
3. `npm run db:online`
4. Die fünf Geheimnisse mit `npx wrangler secret put …` setzen
5. `npm run deploy`

## Besucherstatistik
Den Matomo- oder Plausible-Code in **jeder** HTML-Datei an der Stelle
`<!-- Besucherstatistik ... -->` im `<head>` einfügen.
