// Black-In – Notfall-Handbuch zusammenstellen (Vorlage für die PDFs)
// Holt die Inhalte aus den echten Seiten, damit Website und PDF immer gleich sind.
// handbuch.html            -> ganzes Handbuch (Deckblatt, Nummern, alle Themen, Checklisten)
// handbuch.html?thema=atom -> nur ein Thema (mit Kopfzeile und Notrufnummern)
(function () {
  var ziel = document.getElementById('hb-inhalt');
  var drucken = document.getElementById('hb-drucken');
  if (drucken) drucken.addEventListener('click', function () { window.print(); });

  var m = /[?&]thema=([a-z0-9-]+)/.exec(location.search);
  var thema = m ? m[1] : null;
  var heute = new Date().toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' });
  var adresse = location.origin.indexOf('127.0.0.1') !== -1 || location.origin.indexOf('localhost') !== -1
    ? '' : location.href.replace(/handbuch\.html.*$/, '');
  var kanonisch = document.querySelector('link[rel="canonical"]');

  function laden(datei) {
    return fetch(datei).then(function (r) {
      if (!r.ok) throw new Error(datei + ': HTTP ' + r.status);
      return r.text();
    }).then(function (text) { return new DOMParser().parseFromString(text, 'text/html'); });
  }
  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
  }
  function aufraeumen(knoten) {
    // Bedienelemente, die auf Papier keinen Sinn ergeben, entfernen
    Array.prototype.forEach.call(knoten.querySelectorAll('.no-print, .pdf-link, script, small:empty'), function (x) { x.remove(); });
    Array.prototype.forEach.call(knoten.querySelectorAll('input[type="checkbox"]'), function (x) { x.removeAttribute('id'); x.checked = false; });
    return knoten;
  }

  Promise.all([laden('wissen.html'), laden('checklisten.html'), laden('index.html')]).then(function (seiten) {
    var wissen = seiten[0], checklisten = seiten[1], start = seiten[2];
    var webAdresse = adresse || (start.querySelector('link[rel="canonical"]') || {}).href || '';
    var themen = Array.prototype.slice.call(wissen.querySelectorAll('article.topic'));
    if (thema) themen = themen.filter(function (t) { return t.id === thema; });
    if (!themen.length) throw new Error('Thema nicht gefunden: ' + thema);

    var nummern = start.querySelector('.numbers');
    ziel.innerHTML = '';

    if (!thema) {
      // ---------- Deckblatt ----------
      var deck = el('section', 'hb-deckblatt');
      var logo = el('img'); logo.src = 'img/logo-voll.svg'; logo.alt = 'Black-In Logo'; logo.className = 'hb-logo';
      deck.appendChild(logo);
      deck.appendChild(el('p', 'hb-verein', 'Black-In – Verein zur Krisenvorsorge'));
      deck.appendChild(el('h1', null, 'Notfall-Handbuch'));
      deck.appendChild(el('p', 'hb-untertitel', 'Gut vorbereitet für Blackout, Versorgungsengpässe, Atomunfall und andere Krisen. Zum Ausdrucken und für die Schublade.'));
      deck.appendChild(el('p', 'hb-stand', 'Stand: ' + heute + (webAdresse ? ' · Aktuelle Fassung: ' + webAdresse : '')));
      var hinweis = el('div', 'callout');
      hinweis.appendChild(el('p', null, 'Diese Informationen ersetzen keine Anweisungen von Behörden und Einsatzkräften. Im Ernstfall Radio (ORF) einschalten und den Durchsagen folgen. Notruf in Europa: 112.'));
      deck.appendChild(hinweis);
      ziel.appendChild(deck);

      // ---------- Inhalt ----------
      var inhalt = el('section', 'hb-inhaltsverzeichnis');
      inhalt.appendChild(el('h2', null, 'Inhalt'));
      var liste = el('ol');
      liste.appendChild(el('li', null, 'Wichtige Nummern'));
      themen.forEach(function (t) { liste.appendChild(el('li', null, (t.querySelector('h2') || {}).textContent || t.id)); });
      liste.appendChild(el('li', null, 'Checklisten zum Abhaken'));
      inhalt.appendChild(liste);
      ziel.appendChild(inhalt);
    } else {
      // ---------- Kopf für ein einzelnes Thema ----------
      var kopf = el('header', 'hb-kopf');
      var klein = el('img'); klein.src = 'img/logo.svg'; klein.alt = ''; klein.className = 'hb-logo-klein';
      kopf.appendChild(klein);
      var text = el('div');
      text.appendChild(el('p', 'hb-verein', 'Black-In – Verein zur Krisenvorsorge · Notfall-Info'));
      text.appendChild(el('p', 'hb-stand', 'Stand: ' + heute + (webAdresse ? ' · ' + webAdresse : '')));
      kopf.appendChild(text);
      ziel.appendChild(kopf);
    }

    // ---------- Wichtige Nummern ----------
    function nummernBlock() {
      var abschnitt = el('section', 'hb-nummern');
      abschnitt.appendChild(el('h2', null, 'Wichtige Nummern in Österreich'));
      if (nummern) abschnitt.appendChild(aufraeumen(document.importNode(nummern, true)));
      var eigene = el('div', 'hb-eigene');
      eigene.appendChild(el('h3', null, 'Eigene Nummern eintragen'));
      ['Hausärztin / Hausarzt', 'Gemeinde', 'Nachbarn', 'Familie', 'Treffpunkt der Familie'].forEach(function (z) {
        var zeile = el('p', 'hb-zeile'); zeile.appendChild(el('span', null, z)); eigene.appendChild(zeile);
      });
      abschnitt.appendChild(eigene);
      return abschnitt;
    }
    if (!thema) ziel.appendChild(nummernBlock());

    // ---------- Themen ----------
    themen.forEach(function (t) { ziel.appendChild(aufraeumen(document.importNode(t, true))); });

    // ---------- Checklisten ----------
    if (!thema) {
      var gruppe = checklisten.querySelector('.cl-group');
      if (gruppe) {
        var cl = el('section', 'hb-checklisten topic');
        var wrap = el('div', 'wrap');
        wrap.appendChild(el('h2', null, 'Checklisten zum Abhaken'));
        wrap.appendChild(el('p', 'muted', 'Mit Bleistift abhaken und regelmäßig, zum Beispiel jedes Frühjahr, kontrollieren.'));
        wrap.appendChild(aufraeumen(document.importNode(gruppe.parentNode, true)));
        cl.appendChild(wrap);
        ziel.appendChild(cl);
      }
    } else {
      var kurz = el('div', 'callout hb-notruf');
      kurz.appendChild(el('p', null, 'Notruf in Europa: 112 · Feuerwehr 122 · Polizei 133 · Gesundheitsberatung 1450 · Ärztenotdienst 141'));
      kurz.appendChild(el('p', null, 'Diese Informationen ersetzen keine Anweisungen von Behörden und Einsatzkräften.'));
      ziel.appendChild(kurz);
    }

    document.title = thema
      ? ((themen[0].querySelector('h2') || {}).textContent || thema) + ' – Black-In Notfall-Info'
      : 'Black-In Notfall-Handbuch';
    ziel.removeAttribute('aria-busy');
    document.documentElement.setAttribute('data-fertig', '1');
  }).catch(function (fehler) {
    ziel.innerHTML = '';
    ziel.appendChild(el('p', 'hb-laden', 'Das Handbuch konnte nicht geladen werden (' + fehler.message + ').'));
  });
})();
