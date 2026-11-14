// Black-In – Termine anzeigen und Anmeldung zu Veranstaltungen
// Die Daten kommen vom Cloudflare Worker (/api/veranstaltungen, /api/anmeldung).
(function () {
  var liste = document.getElementById('termine-liste');
  if (!liste) return;

  var leer = document.getElementById('termine-leer');
  var leerTitel = document.getElementById('termine-leer-titel');
  var leerText = document.getElementById('termine-leer-text');
  var bereich = document.getElementById('anmeldung');
  var form = document.getElementById('anmeldeformular');
  var auswahl = document.getElementById('f-veranstaltung');
  var felder = document.getElementById('f-felder');
  var geschlossen = document.getElementById('f-geschlossen');
  var personen = document.getElementById('f-personen');
  var personenHilfe = document.getElementById('h-personen');
  var senden = document.getElementById('f-senden');
  var statusEl = document.getElementById('f-status');
  var erfolg = document.getElementById('anmeldung-erfolg');
  var erfolgText = document.getElementById('anmeldung-erfolg-text');
  var weitere = document.getElementById('anmeldung-weitere');

  var MAX_PERSONEN = 10;
  var MONATE = ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'];
  var GRUENDE = {
    ausgebucht: 'Ausgebucht',
    anmeldeschluss: 'Anmeldeschluss vorbei',
    inaktiv: 'Keine Anmeldung möglich',
    vorbei: 'Bereits vorbei'
  };
  var termine = [];

  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
  }
  function datumKurz(d) { var t = d.split('-'); return t[2] + '.' + t[1] + '.' + t[0]; }
  function finde(id) {
    for (var i = 0; i < termine.length; i++) if (termine[i].id === id) return termine[i];
    return null;
  }

  // ---------- Termine laden und anzeigen ----------
  function laden() {
    return fetch('/api/veranstaltungen', { headers: { Accept: 'application/json' } })
      .then(function (r) {
        // 404: Die Seite läuft ohne Anmeldeserver (z. B. noch auf GitHub Pages) -> keine Termine
        if (r.status === 404) return { veranstaltungen: [] };
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (daten) { termine = daten.veranstaltungen || []; anzeigen(); })
      .catch(function () {
        leerTitel.textContent = 'Termine konnten nicht geladen werden';
        leerText.textContent = 'Bitte versuchen Sie es später noch einmal oder schreiben Sie uns über die Kontaktseite.';
        liste.removeAttribute('aria-busy');
      });
  }

  function anzeigen() {
    liste.removeAttribute('aria-busy');
    // alte Karten entfernen (Platzhalter bleibt im DOM)
    Array.prototype.slice.call(liste.querySelectorAll('.event')).forEach(function (k) { k.remove(); });

    if (!termine.length) {
      leer.hidden = false;
      leerTitel.textContent = 'Derzeit sind keine Termine eingetragen';
      leerText.textContent = 'Neue Veranstaltungen stehen hier, sobald sie feststehen. Schauen Sie wieder vorbei.';
      bereich.hidden = true;
      return;
    }
    leer.hidden = true;

    termine.forEach(function (t) {
      var teile = t.datum.split('-');
      var karte = el('article', 'card event');
      var datum = el('div', 'date');
      datum.appendChild(el('b', null, String(Number(teile[2]))));
      datum.appendChild(document.createTextNode(MONATE[Number(teile[1]) - 1] + ' ' + teile[0]));
      karte.appendChild(datum);

      var inhalt = el('div');
      inhalt.appendChild(el('h3', null, t.titel));
      var info = [];
      if (t.uhrzeit) info.push(t.uhrzeit + ' Uhr');
      if (t.ort) info.push(t.ort);
      if (info.length) inhalt.appendChild(el('p', 'muted', info.join(' · ')));
      if (t.beschreibung) inhalt.appendChild(el('p', null, t.beschreibung));

      var fuss = el('div', 'event-fuss');
      if (t.offen) {
        var knopf = el('a', 'btn btn-primary', 'Anmelden');
        knopf.href = '#anmeldung';
        knopf.setAttribute('aria-label', 'Anmelden: ' + t.titel);
        knopf.addEventListener('click', function (e) { e.preventDefault(); waehlen(t.id, true); });
        fuss.appendChild(knopf);
        var plaetze = [];
        if (t.frei !== null) plaetze.push(t.frei === 1 ? 'Noch 1 Platz frei' : 'Noch ' + t.frei + ' Plätze frei');
        if (t.anmeldeschluss) plaetze.push('Anmeldeschluss ' + datumKurz(t.anmeldeschluss.slice(0, 10)));
        if (plaetze.length) fuss.appendChild(el('span', 'muted', plaetze.join(' · ')));
      } else {
        fuss.appendChild(el('span', 'tag tag-zu', GRUENDE[t.grund] || 'Keine Anmeldung möglich'));
      }
      inhalt.appendChild(fuss);
      karte.appendChild(inhalt);
      liste.appendChild(karte);
    });

    // Auswahlliste neu aufbauen
    var vorher = auswahl.value;
    auswahl.innerHTML = '';
    var leerOption = el('option', null, 'Bitte wählen …');
    leerOption.value = '';
    auswahl.appendChild(leerOption);
    termine.forEach(function (t) {
      var o = el('option', null, t.titel + ' – ' + datumKurz(t.datum) + (t.offen ? '' : ' (' + (GRUENDE[t.grund] || 'geschlossen') + ')'));
      o.value = t.id;
      o.disabled = !t.offen;
      auswahl.appendChild(o);
    });
    var offene = termine.filter(function (t) { return t.offen; });
    if (vorher && finde(vorher)) auswahl.value = vorher;
    else if (offene.length === 1) auswahl.value = offene[0].id;
    bereich.hidden = false;
    auswahlGeaendert();

    // Direktlink: termine.html?veranstaltung=ID#anmeldung
    var m = /[?&]veranstaltung=([^&#]+)/.exec(location.search);
    if (m && !vorher) waehlen(decodeURIComponent(m[1]), false);
  }

  function waehlen(id, fokus) {
    if (!finde(id)) return;
    auswahl.value = id;
    auswahlGeaendert();
    erfolg.hidden = true;
    form.hidden = false;
    // Beim Klick sanft scrollen, beim Direktlink (Seite lädt noch) sofort springen
    bereich.scrollIntoView({ behavior: fokus ? 'smooth' : 'auto', block: 'start' });
    if (fokus) {
      var t = finde(id);
      setTimeout(function () { (t && t.offen ? document.getElementById('f-vorname') : auswahl).focus({ preventScroll: true }); }, 350);
    }
  }

  // Formular sperren, wenn die gewählte Veranstaltung voll oder geschlossen ist
  function auswahlGeaendert() {
    var t = finde(auswahl.value);
    var offene = termine.filter(function (x) { return x.offen; }).length;
    var zu = (t && !t.offen) || offene === 0;
    felder.disabled = zu;
    geschlossen.hidden = !zu;
    if (zu) {
      geschlossen.textContent = t && !t.offen
        ? (t.grund === 'ausgebucht'
            ? 'Diese Veranstaltung ist leider ausgebucht. Eine Anmeldung ist nicht mehr möglich.'
            : 'Der Anmeldeschluss für diese Veranstaltung ist vorbei. Eine Anmeldung ist nicht mehr möglich.')
        : 'Für die aktuellen Veranstaltungen ist derzeit keine Anmeldung möglich.';
    }
    var max = MAX_PERSONEN;
    if (t && t.frei !== null) max = Math.max(1, Math.min(MAX_PERSONEN, t.frei));
    personen.max = String(max);
    personenHilfe.textContent = 'Inklusive Ihnen selbst. Höchstens ' + max + (max === 1 ? ' Person.' : ' Personen.');
  }
  auswahl.addEventListener('change', function () { auswahlGeaendert(); fehlerSetzen('veranstaltung', ''); });

  // ---------- Prüfen (gleiche Regeln wie auf dem Server) ----------
  function wert(name) { return (form.elements[name].value || '').trim(); }

  function pruefen() {
    var f = {};
    var t = finde(auswahl.value);
    if (!t) f.veranstaltung = 'Bitte wählen Sie eine Veranstaltung.';
    if (!wert('vorname')) f.vorname = 'Bitte geben Sie Ihren Vornamen an.';
    if (!wert('nachname')) f.nachname = 'Bitte geben Sie Ihren Nachnamen an.';
    var email = wert('email');
    if (!email) f.email = 'Bitte geben Sie Ihre E-Mail-Adresse an.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) f.email = 'Bitte geben Sie eine gültige E-Mail-Adresse an, z. B. name@beispiel.at.';
    var tel = wert('telefon');
    if (tel && !/^[0-9+()\/\-\s]{6,30}$/.test(tel)) f.telefon = 'Bitte geben Sie eine gültige Telefonnummer an (nur Ziffern, Leerzeichen und + ( ) / -).';
    var p = Number(wert('personen'));
    var max = Number(personen.max) || MAX_PERSONEN;
    if (!(p >= 1 && p <= max && Math.floor(p) === p)) f.personen = 'Bitte geben Sie eine Anzahl zwischen 1 und ' + max + ' an.';
    if (wert('anmerkung').length > 1000) f.anmerkung = 'Die Anmerkung darf höchstens 1000 Zeichen lang sein.';
    if (!form.elements.datenschutz.checked) f.datenschutz = 'Bitte bestätigen Sie die Datenschutzerklärung.';
    return f;
  }

  function fehlerSetzen(name, text) {
    var feld = form.elements[name];
    var meldung = document.getElementById('e-' + name);
    if (!feld || !meldung) return;
    meldung.textContent = text || '';
    if (text) feld.setAttribute('aria-invalid', 'true');
    else feld.removeAttribute('aria-invalid');
  }

  function alleFehler(f) {
    var namen = ['veranstaltung', 'vorname', 'nachname', 'email', 'telefon', 'personen', 'anmerkung', 'datenschutz'];
    var erstes = null;
    namen.forEach(function (n) {
      fehlerSetzen(n, f[n]);
      if (f[n] && !erstes) erstes = form.elements[n];
    });
    if (erstes) erstes.focus();
    return !erstes;
  }

  // Fehler verschwinden, sobald man das Feld korrigiert
  form.addEventListener('input', function (e) {
    if (e.target.name && e.target.getAttribute('aria-invalid')) fehlerSetzen(e.target.name, '');
  });
  form.addEventListener('change', function (e) {
    if (e.target.name === 'datenschutz' && e.target.checked) fehlerSetzen('datenschutz', '');
  });

  // ---------- Absenden ----------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    statusEl.textContent = '';
    if (!alleFehler(pruefen())) {
      statusEl.textContent = 'Bitte prüfen Sie die markierten Felder.';
      return;
    }
    var daten = {
      veranstaltung: auswahl.value,
      vorname: wert('vorname'),
      nachname: wert('nachname'),
      email: wert('email'),
      telefon: wert('telefon'),
      personen: Number(wert('personen')),
      anmerkung: wert('anmerkung'),
      datenschutz: form.elements.datenschutz.checked,
      website: form.elements.website.value
    };
    senden.disabled = true;
    senden.textContent = 'Wird gesendet …';

    fetch('/api/anmeldung', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(daten)
    })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (antwort) {
        if (antwort.ok) {
          var v = antwort.veranstaltung;
          erfolgText.textContent = v
            ? 'Sie sind für „' + v.titel + '“ am ' + v.datum + (v.uhrzeit ? ', ' + v.uhrzeit + ' Uhr,' : '') +
              ' angemeldet (' + (daten.personen === 1 ? '1 Person' : daten.personen + ' Personen') + ').'
            : 'Ihre Anmeldung ist eingegangen.';
          form.hidden = true;
          erfolg.hidden = false;
          erfolg.focus();
          laden();   // freie Plätze aktualisieren
          return;
        }
        if (antwort.fehler) alleFehler(antwort.fehler);
        statusEl.textContent = antwort.meldung || 'Die Anmeldung hat leider nicht geklappt. Bitte versuchen Sie es noch einmal.';
        if (antwort.grund) laden();   // z. B. gerade ausgebucht: Anzeige aktualisieren
      })
      .catch(function () {
        statusEl.textContent = 'Keine Verbindung. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es noch einmal.';
      })
      .then(function () {
        senden.disabled = false;
        senden.textContent = 'Verbindlich anmelden';
      });
  });

  weitere.addEventListener('click', function () {
    var id = auswahl.value;
    form.reset();
    auswahl.value = id;
    auswahlGeaendert();
    erfolg.hidden = true;
    form.hidden = false;
    document.getElementById('f-vorname').focus();
  });

  laden();
})();
