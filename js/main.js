// Black-In – kleine Helfer: Menü, Jahreszahl, Checklisten
(function () {
  // Mobiles Menü
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Jahreszahl im Footer
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // Checklisten: Häkchen werden nur im eigenen Browser gespeichert
  var boxes = document.querySelectorAll('.cl-list input[type="checkbox"]');
  if (!boxes.length) return;
  var KEY = 'blackin-checkliste-v1';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignorieren */ }
  }
  function update() {
    var done = 0;
    boxes.forEach(function (b) { if (b.checked) done++; });
    var pct = Math.round((done / boxes.length) * 100);
    var bar = document.querySelector('.progress-bar span');
    var label = document.getElementById('progress-label');
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = done + ' von ' + boxes.length + ' erledigt (' + pct + ' %)';
    document.querySelectorAll('.cl-group').forEach(function (g) {
      var all = g.querySelectorAll('input[type="checkbox"]');
      var d = 0; all.forEach(function (b) { if (b.checked) d++; });
      var s = g.querySelector('h3 small');
      if (s) s.textContent = d + '/' + all.length;
    });
  }

  boxes.forEach(function (b) {
    if (state[b.id]) b.checked = true;
    b.addEventListener('change', function () { state[b.id] = b.checked; save(); update(); });
  });

  var reset = document.getElementById('cl-reset');
  // Zurücksetzen mit Bestätigung direkt am Button (zweiter Klick innerhalb von 4 Sekunden)
  if (reset) {
    var armed = false, timer, original = reset.textContent;
    reset.addEventListener('click', function () {
      if (!armed) {
        armed = true; reset.textContent = 'Wirklich alles zurücksetzen?';
        timer = setTimeout(function () { armed = false; reset.textContent = original; }, 4000);
        return;
      }
      clearTimeout(timer); armed = false; reset.textContent = original;
      boxes.forEach(function (b) { b.checked = false; });
      state = {}; save(); update();
    });
  }
  // Drucken geht nur, wenn die Seite nicht in einem fremden Rahmen (z. B. Vorschau) läuft
  var print = document.getElementById('cl-print');
  var framed = false;
  try { framed = window.self !== window.top; } catch (e) { framed = true; }
  if (print) {
    if (framed) print.hidden = true;
    else print.addEventListener('click', function () { window.print(); });
  }

  update();
})();
