-- Black-In: Anmeldungen zu Veranstaltungen
-- Die Veranstaltungen selbst stehen in daten/veranstaltungen.json.

CREATE TABLE IF NOT EXISTS anmeldungen (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  veranstaltung_id TEXT    NOT NULL,
  vorname          TEXT    NOT NULL,
  nachname         TEXT    NOT NULL,
  email            TEXT    NOT NULL,
  telefon          TEXT,
  personen         INTEGER NOT NULL DEFAULT 1,
  anmerkung        TEXT,
  erstellt_am      TEXT    NOT NULL   -- ISO-Zeit in UTC
);
CREATE INDEX IF NOT EXISTS idx_anmeldungen_veranstaltung ON anmeldungen (veranstaltung_id);
CREATE INDEX IF NOT EXISTS idx_anmeldungen_erstellt ON anmeldungen (erstellt_am);

-- Spamschutz: nur ein Hash der IP-Adresse (nicht umkehrbar), wird nach 24 h gelöscht
CREATE TABLE IF NOT EXISTS rate_limit (
  ip_hash TEXT    NOT NULL,
  zeit    INTEGER NOT NULL                 -- Millisekunden seit 1970
);
CREATE INDEX IF NOT EXISTS idx_rate_limit ON rate_limit (ip_hash, zeit);

-- Wann wurde der letzte Bericht verschickt? (für "neu seit letztem Bericht")
CREATE TABLE IF NOT EXISTS berichte (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  gesendet_am TEXT NOT NULL                -- ISO-Zeit in UTC
);
