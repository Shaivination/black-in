# Website black-in.at

Statische Website, kein CMS und keine Datenbank. Einfach den **Inhalt dieses Ordners** per FTP oder über den Dateimanager des Hosters in das Hauptverzeichnis von black-in.at hochladen. (`LIESMICH.md` muss nicht mit hoch.)

## Vor dem Hochladen ausfüllen (gelb markiert, Suche nach `todo`)
- `impressum.html`: Straße, ZVR-Zahl, Name des Präsidenten
- `datenschutz.html`: Straße, Hoster, Löschfrist der Logfiles, Statistik-Tool
- `kontakt.html`: Straße
- `verein.html`: Namen des Vorstands
- E-Mail-Adresse `info@black-in.at` beim Hoster anlegen

## Besucherstatistik
Den Matomo- oder Plausible-Code vom Hoster in **jeder** HTML-Datei an der Stelle
`<!-- Besucherstatistik ... -->` im `<head>` einfügen.

## Termin eintragen
In `termine.html` gibt es eine auskommentierte Vorlage. Den Block kopieren, ausfüllen und den Hinweis „Derzeit sind keine Termine eingetragen“ entfernen.
