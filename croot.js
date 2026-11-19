/*!
 * croot.js — state machine & camera controller untuk crootss
 * https://github.com/crootss/crootss
 * ES module tanpa dependency. Butuh crootss.css.
 *
 *   <script type="module" src=".../croot.min.js"></script>         (auto-init)
 *   import { croot } from '.../croot.min.js';                        (manual)
 */

var NODE = '.croot-node';
var PROPS = ['x', 'y', 'z', 'rx', 'ry', 'rz', 'scale'];
var REPLACED = /^(IMG|VIDEO|CANVAS|IFRAME|EMBED|OBJECT|INPUT|SELECT|TEXTAREA|BUTTON)$/;
var INTERACTIVE = 'a, button, input, select, textarea, label, summary, [contenteditable], [tabindex]:not(.croot-node)';

/* ---------- util ---------- */

// "2.10" → [2, 10]; dibandingkan per segmen sehingga 2 < 2.1 < 2.2 < 2.10 < 3
export function parseStep(value) {
  return String(value).trim().split('.').map(Number);
}
export function compareStep(a, b) {
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) {
    var x = i < a.length ? a[i] : -Infinity;
    var y = i < b.length ? b[i] : -Infinity;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function num(value, fallback) {
  var v = parseFloat(value);
  return isFinite(v) ? v : fallback;
}

function cssDuration(value) {
  var v = parseFloat(value) || 0;
  return /ms\s*$/.test(value) ? v : v * 1000;
}

/* ---------- controller ---------- */

export function croot(root, options) {
  if (typeof root === 'string') root = document.querySelector(root);
  root = root || document.querySelector('[data-croot]');
  if (!root) throw new Error('croot: root element tidak ditemukan');
  if (root.croot) return root.croot;

  options = Object.assign({ fit: 0.9, pullback: 1, hash: true, keyboard: true, touch: true, overview: null, debug: false, presenter: true }, options);
  if (root.dataset.crootFit) options.fit = num(root.dataset.crootFit, options.fit);
  if (root.dataset.crootPullback) options.pullback = num(root.dataset.crootPullback, options.pullback);
  if (root.dataset.crootOverview) options.overview = root.dataset.crootOverview;
  if (root.hasAttribute('data-croot-debug')) options.debug = true;

  var stage = root.querySelector('.croot-stage');
  if (!stage) throw new Error('croot: .croot-stage tidak ditemukan');

  var all = Array.prototype.slice.call(stage.querySelectorAll(NODE));
  // Node "big picture" (opsional): overview membingkai node ini, bukan sekadar
  // semua node, sehingga Esc selalu kembali ke gambaran besar presentasi.
  var big = typeof options.overview === 'string' ? stage.querySelector(options.overview) : options.overview;
  if (big && !(stage.contains(big) && big.matches(NODE))) big = null;
  var steps = [];        // node dalam urutan linier
  var current = null;    // node aktif
  var index = -1;        // index linier terakhir (tetap saat node bebas diklik)
  var inOverview = false;
  var pullAnim = null;
  var moveTimer = null;

  // Baca atribut data-croot-* (fallback: custom property --croot-*) → simpan
  // sebagai custom property, supaya CSS jadi satu-satunya sumber transform.
  all.forEach(function (el, i) {
    var cs = getComputedStyle(el);
    PROPS.forEach(function (p) {
      var key = 'croot' + p.charAt(0).toUpperCase() + p.slice(1);
      var raw = el.dataset[key];
      if (raw == null || raw === '') raw = cs.getPropertyValue('--croot-' + p);
      var v = num(raw, p === 'scale' ? 1 : 0);
      el.style.setProperty('--croot-' + p, v);
      el['_croot_' + p] = v;
    });
    if (!el.id) el.id = 'croot-' + (i + 1);
    if (el.dataset.crootStep != null) {
      el._crootStep = parseStep(el.dataset.crootStep);
      el._crootOrder = i;
      steps.push(el);
    }
  });
  steps.sort(function (a, b) {
    return compareStep(a._crootStep, b._crootStep) || a._crootOrder - b._crootOrder;
  });
  if (!steps.length) steps = all.slice();

  // Matriks dunia node = matriks dunia induk × transform lokal node.
  // Sama persis dengan transform di crootss.css (tanpa translate(-50%,-50%),
  // sehingga yang dihitung adalah frame di pusat node).
  function localMatrix(el) {
    return new DOMMatrix()
      .translateSelf(el._croot_x, el._croot_y, el._croot_z)
      .rotateSelf(el._croot_rx, 0, 0)
      .rotateSelf(0, el._croot_ry, 0)
      .rotateSelf(0, 0, el._croot_rz)
      .scaleSelf(el._croot_scale, el._croot_scale, el._croot_scale);
  }
  function worldMatrix(el) {
    var m = localMatrix(el);
    for (var p = el.parentElement.closest(NODE); p && stage.contains(p); p = p.parentElement.closest(NODE)) {
      m = localMatrix(p).multiply(m);
    }
    return m;
  }

  function setCamera(matrix, instant) {
    root.classList.toggle('croot-instant', !!instant);
    if (!instant) {
      root.classList.add('croot-moving');
      clearTimeout(moveTimer);
      moveTimer = setTimeout(function () {
        root.classList.remove('croot-moving');
      }, cssDuration(getComputedStyle(stage).transitionDuration) + 50);
    }
    stage.style.transform = matrix.toString();
    if (instant) {
      void stage.offsetWidth; // flush supaya transisi berikutnya normal
      root.classList.remove('croot-instant');
    }
  }

  // Kamera "mundur" sejenak di tengah perjalanan, seperti Prezi: makin jauh
  // jarak di layar, makin jauh mundurnya. Dipasang di properti `scale` (bukan
  // `transform`) supaya tidak mengganggu interpolasi matriks kamera; `scale`
  // stage berporos di pusat layar, jadi efeknya sama dengan kamera menjauh.
  function pullback(el) {
    if (pullAnim) pullAnim.cancel();
    pullAnim = null;
    var duration = cssDuration(getComputedStyle(stage).transitionDuration);
    if (!(options.pullback > 0) || !stage.animate || duration < 50) return;
    var t = getComputedStyle(stage).transform;
    var from = !t || t === 'none' ? new DOMMatrix() : new DOMMatrix(t);
    var p = from.transformPoint(worldMatrix(el).transformPoint(new DOMPoint(0, 0, 0)));
    var r = Math.hypot(p.x, p.y) / Math.hypot(root.clientWidth, root.clientHeight);
    var k = Math.max(0.35, 1 / (1 + r * options.pullback));
    if (k > 0.97) return; // zoom ke anak / node yang sudah di layar: tidak perlu mundur
    var mid = k + ' ' + k + ' ' + k;
    pullAnim = stage.animate([
      { scale: '1 1 1', easing: 'ease-out' },
      { scale: mid, offset: 0.45, easing: 'ease-in-out' },
      { scale: '1 1 1' }
    ], { duration: duration });
  }

  // w, h: ukuran layar kamera; default viewport (halaman cetak memakai ukurannya sendiri).
  function nodeCamera(el, w, h) {
    w = w || root.clientWidth; h = h || root.clientHeight;
    var fit = Math.min(w / el.offsetWidth, h / el.offsetHeight) * options.fit;
    return new DOMMatrix().scaleSelf(fit, fit, fit).multiply(worldMatrix(el).inverse());
  }

  function overviewCamera() {
    if (big) return nodeCamera(big);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(function (el) {
      var m = worldMatrix(el), w = el.offsetWidth / 2, h = el.offsetHeight / 2;
      [[-w, -h], [w, -h], [w, h], [-w, h]].forEach(function (c) {
        var pt = m.transformPoint(new DOMPoint(c[0], c[1], 0));
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
      });
    });
    var fit = Math.min(root.clientWidth / (maxX - minX), root.clientHeight / (maxY - minY)) * options.fit;
    return new DOMMatrix()
      .scaleSelf(fit, fit, fit)
      .translateSelf(-(minX + maxX) / 2, -(minY + maxY) / 2, 0);
  }

  /* ---------- debug: isi meluap ---------- */

  // Tandai node yang isinya melewati batas node. Node yang sebidang dengan
  // layar (tanpa rotasi) diukur dari kotak yang benar-benar tergambar:
  // getClientRects() per elemen dan per potongan teks, relatif terhadap kotak
  // node. Proyeksi bidang yang sejajar layar hanyalah skala seragam, jadi
  // posisi kamera tidak berpengaruh. Isi yang dipotong elemen ber-overflow
  // (mis. <pre> bergulir) tidak dihitung; dekorasi ::before/::after juga tidak.
  function visualOverflow(node, bad) {
    var nr = node.getBoundingClientRect(), k = nr.width / node.offsetWidth;
    if (!(k > 0)) return;
    var tol = 4 * k; // 4px node: abaikan selisih subpiksel antar-browser
    function out(r) {
      return r.width > 0 && r.height > 0 &&
        (r.left < nr.left - tol || r.top < nr.top - tol || r.right > nr.right + tol || r.bottom > nr.bottom + tol);
    }
    function anyOut(list) {
      for (var i = 0; i < list.length; i++) if (out(list[i])) return true;
      return false;
    }
    var range = document.createRange();
    (function walk(el) {
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          if (!/\S/.test(c.data)) continue;
          range.selectNodeContents(c);
          if (anyOut(range.getClientRects()) && bad.indexOf(el) < 0 && el !== node) bad.push(el);
        } else if (c.nodeType === 1 && !c.matches(NODE)) {
          if (anyOut(c.getClientRects())) bad.push(c);
          var cs = getComputedStyle(c);
          if (cs.display === 'none' || c instanceof SVGElement) continue;
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') continue; // isinya terpotong
          walk(c);
        }
      }
    })(node);
  }

  // Node yang diputar: kotak layar miring, jadi ukur dari tata letak
  // (offsetLeft/Top, scrollWidth) tanpa transform.
  function layoutOverflow(node, bad) {
    var W = node.clientWidth, H = node.clientHeight;
    node.querySelectorAll('*').forEach(function (el) {
      if (!(el instanceof HTMLElement) || el.closest(NODE) !== node) return; // anak node diukur sendiri
      var cs = getComputedStyle(el);
      // Elemen inline yang terpotong ke baris berikutnya tidak bisa diukur
      // begini; luapannya terlihat lewat scrollWidth blok induknya.
      if (cs.display === 'inline' && !REPLACED.test(el.tagName)) return;
      var x = 0, y = 0, p = el;
      while (p && p !== node) { x += p.offsetLeft; y += p.offsetTop; p = p.offsetParent; }
      if (p !== node) return; // tersembunyi atau position: fixed
      var w = Math.max(el.offsetWidth, cs.overflowX === 'visible' ? el.scrollWidth : 0);
      var h = Math.max(el.offsetHeight, cs.overflowY === 'visible' ? el.scrollHeight : 0);
      if (x < -1 || y < -1 || x + w > W + 1 || y + h > H + 1) bad.push(el);
    });
  }

  function checkOverflow() {
    var found = [];
    root.querySelectorAll('.croot-overflow-el').forEach(function (el) { el.classList.remove('croot-overflow-el'); });
    all.forEach(function (node) {
      var bad = [], m = worldMatrix(node);
      var flat = Math.abs(m.b) + Math.abs(m.c) + Math.abs(m.m13) + Math.abs(m.m23) + Math.abs(m.m31) + Math.abs(m.m32) < 1e-6;
      (flat ? visualOverflow : layoutOverflow)(node, bad);
      // Hanya elemen terluar yang ditandai; anaknya ikut meluap bersamanya.
      bad = bad.filter(function (el) { return !bad.some(function (o) { return o !== el && o.contains(el); }); });
      node.classList.toggle('croot-overflow', bad.length > 0);
      if (bad.length) {
        bad.forEach(function (el) { el.classList.add('croot-overflow-el'); });
        found.push({ node: node, elements: bad });
      }
    });
    if (found.length && options.debug) {
      console.warn('croot: isi meluap di ' + found.length + ' node: ' + found.map(function (f) { return '#' + f.node.id; }).join(', '), found);
    }
    return found;
  }

  /* ---------- cetak / PDF: satu langkah per halaman ---------- */

  // Saat dicetak, setiap langkah disalin menjadi satu halaman 1280×720 dengan
  // kamera di langkah itu, jadi PDF sama dengan yang tampil di layar.
  var PAGE_W = 1280, PAGE_H = 720;
  var printBox = null;
  function buildPrint() {
    if (printBox) return;
    printBox = document.createElement('div');
    printBox.className = 'croot-print';
    var pages = steps.slice();
    if (big && pages.indexOf(big) < 0) pages.unshift(big);
    pages.forEach(function (el) {
      var page = root.cloneNode(false);
      ['id', 'data-croot', 'tabindex', 'aria-label'].forEach(function (a) { page.removeAttribute(a); });
      page.classList.remove('croot-moving', 'croot-instant', 'croot-overview');
      page.classList.add('croot-page');
      if (el === big) page.classList.add('croot-overview');
      var st = stage.cloneNode(true);
      // Kamera cetak 2D: skala lewat `zoom` (ukuran tata letak ikut mengecil),
      // sisanya lewat transform. Mesin cetak Chromium salah me-raster elemen
      // raksasa yang hanya dikecilkan dengan transform (mis. peta 11000px).
      var m = nodeCamera(el, PAGE_W, PAGE_H), k = Math.hypot(m.a, m.b);
      st.style.zoom = k;
      st.style.transform = 'matrix(' + [m.a / k, m.b / k, m.c / k, m.d / k, m.e / k, m.f / k].join(',') + ')';
      st.querySelectorAll('.croot-active').forEach(function (n) { n.classList.remove('croot-active'); n.removeAttribute('aria-current'); });
      var twin = st.querySelector('#' + CSS.escape(el.id));
      if (twin) twin.classList.add('croot-active');
      page.appendChild(st);
      printBox.appendChild(page);
    });
    document.body.appendChild(printBox);
  }
  function clearPrint() {
    if (printBox) printBox.remove();
    printBox = null;
  }
  // dialog === false: hanya siapkan halaman cetak (untuk Chromium headless /
  // otomatisasi); <html data-croot-print="siap"> menandai halaman sudah siap.
  function print(dialog) {
    buildPrint();
    document.documentElement.setAttribute('data-croot-print', 'siap');
    if (dialog !== false) window.print();
  }

  /* ---------- gambar layar penuh (data-croot-zoom) ---------- */

  function zoomIn(el) {
    var fs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (fs) {
      var r = fs.call(el);
      if (r && r.catch) r.catch(function () {});
    } else if (el.currentSrc || el.src) {
      window.open(el.currentSrc || el.src, '_blank'); // iPhone: tanpa fullscreen elemen
    }
  }

  /* ---------- presenter: catatan, waktu, langkah berikutnya ---------- */

  // Jendela kedua untuk penyaji (tombol P). Jendela utama tetap untuk
  // proyektor/penonton; keduanya dikendalikan dari mana saja.
  var presenterWin = null;
  function titleOf(el) {
    if (!el) return '';
    var heading = el.querySelector('h1, h2, h3, h4, h5, h6');
    return (el.getAttribute('aria-label') || (heading ? heading.textContent : el.id)).trim().replace(/\s+/g, ' ');
  }
  function notesOf(el) {
    return el ? Array.prototype.filter.call(el.querySelectorAll('.croot-notes'), function (n) { return n.closest(NODE) === el; }) : [];
  }
  function presenter() {
    if (presenterWin && !presenterWin.closed) { presenterWin.focus(); return presenterWin; }
    var win = window.open('', 'croot-presenter', 'width=960,height=640');
    if (!win) return null; // popup diblokir browser
    presenterWin = win;
    var d = win.document;
    d.title = 'Presenter: ' + document.title;
    d.documentElement.lang = document.documentElement.lang || 'id';
    // Gaya presenter ada di crootss.css; pakai stylesheet yang sama.
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      if (sheet.href && /crootss(\.min)?\.css(\?|$)/.test(sheet.href)) {
        var link = d.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        d.head.appendChild(link);
      }
    });
    d.body.className = 'croot-presenter';
    d.body.innerHTML = '';
    function part(tag, cls, parent) {
      var e = d.createElement(tag);
      e.className = cls;
      (parent || d.body).appendChild(e);
      return e;
    }
    var bar = part('header', 'cp-bar');
    var pos = part('span', 'cp-pos', bar);
    var timer = part('span', 'cp-timer', bar);
    var clock = part('span', 'cp-clock', bar);
    var reset = part('button', 'cp-btn', bar);
    reset.type = 'button';
    reset.textContent = 'Ulang waktu';
    var now = part('h1', 'cp-now');
    var notes = part('div', 'cp-notes');
    var nextEl = part('p', 'cp-next');
    var nav = part('nav', 'cp-nav');
    [['prev', '← Sebelumnya'], ['overview', 'Big picture'], ['next', 'Berikutnya →']].forEach(function (b) {
      var btn = part('button', 'cp-btn', nav);
      btn.type = 'button';
      btn.dataset.act = b[0];
      btn.textContent = b[1];
    });

    var start = Date.now();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function tick() {
      var s = Math.floor((Date.now() - start) / 1000);
      timer.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
      var t = new Date();
      clock.textContent = pad(t.getHours()) + ':' + pad(t.getMinutes());
    }
    function render() {
      if (win.closed) return;
      pos.textContent = inOverview ? 'Big picture' : (index + 1) + ' / ' + steps.length;
      now.textContent = inOverview ? 'Big picture' : titleOf(current);
      notes.innerHTML = '';
      var list = inOverview ? [] : notesOf(current);
      if (!list.length) part('p', 'cp-empty', notes).textContent = 'Tidak ada catatan untuk langkah ini.';
      list.forEach(function (n) {
        var copy = d.importNode(n, true);
        copy.className = 'cp-note';
        notes.appendChild(copy);
      });
      var nx = inOverview ? current : steps[index + 1];
      nextEl.textContent = nx ? 'Berikutnya: ' + titleOf(nx) : (big ? 'Berikutnya: big picture' : 'Langkah terakhir');
    }
    reset.addEventListener('click', function () { start = Date.now(); tick(); });
    nav.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'overview') overview(true);
      else api[act.dataset.act]();
    });
    win.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') next();
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') prev();
      else if (k === 'Escape') overview();
      else return;
      e.preventDefault();
    });
    root.addEventListener('croot:enter', render);
    root.addEventListener('croot:overview', render);
    win.addEventListener('pagehide', function () {
      root.removeEventListener('croot:enter', render);
      root.removeEventListener('croot:overview', render);
      presenterWin = null;
    });
    win.setInterval(tick, 1000);
    tick();
    render();
    return win;
  }

  function emit(target, name, detail) {
    target.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail }));
  }

  function announce(el) {
    var heading = el.querySelector('h1, h2, h3, h4, h5, h6');
    var label = el.getAttribute('aria-label') || (heading ? heading.textContent : el.id);
    var pos = steps.indexOf(el);
    live.textContent = (pos >= 0 ? (pos + 1) + ' / ' + steps.length + ': ' : '') + label.trim();
  }

  function updateHash(id) {
    if (!options.hash) return;
    var hash = '#/' + id;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function resolve(target) {
    if (typeof target === 'number') return steps[target];
    if (typeof target === 'string') return document.getElementById(target.replace(/^#\/?/, ''));
    return target;
  }

  /* ---------- API publik ---------- */

  function goto(target, instant) {
    var el = resolve(target);
    if (!el || !stage.contains(el) || !el.matches(NODE)) return false;
    var prev = current;
    var wasOverview = inOverview;
    if (prev === el && !inOverview) return true;

    inOverview = false;
    root.classList.remove('croot-overview');
    if (prev && prev !== el) {
      prev.classList.remove('croot-active');
      prev.removeAttribute('aria-current');
      emit(prev, 'croot:leave', { next: el });
    }
    current = el;
    var pos = steps.indexOf(el);
    if (pos >= 0) index = pos;
    el.classList.add('croot-active');
    el.setAttribute('aria-current', 'step');
    if (!instant && prev && !wasOverview) pullback(el);
    setCamera(nodeCamera(el), instant);
    updateHash(el.id);
    announce(el);
    if (prev !== el || wasOverview) emit(el, 'croot:enter', { previous: prev, index: index });
    return true;
  }

  function next() {
    if (inOverview && current) return goto(current);
    // Dengan big picture, langkah setelah yang terakhir kembali ke gambaran besar.
    if (big && index === steps.length - 1 && current === steps[index]) return overview(true);
    return goto(Math.min(index + 1, steps.length - 1));
  }
  function prev() {
    if (inOverview && current) return goto(current);
    return goto(Math.max(index - 1, 0));
  }

  function overview(force, instant) {
    var on = force == null ? !inOverview : !!force;
    if (!on) return current ? goto(current, instant) : goto(0, instant);
    inOverview = true;
    root.classList.add('croot-overview');
    setCamera(overviewCamera(), instant);
    updateHash('overview');
    live.textContent = 'Overview';
    emit(root, 'croot:overview', { current: current });
    return true;
  }

  /* ---------- input ---------- */

  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var full = document.fullscreenElement || document.webkitFullscreenElement;
    if (full && root.contains(full)) return; // gambar layar penuh: biarkan browser (Esc menutupnya)
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) next();
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey)) prev();
    else if (k === 'Home') goto(0);
    else if (k === 'End') goto(steps.length - 1);
    else if (k === 'Escape') overview();
    else if ((k === 'p' || k === 'P') && options.presenter) presenter();
    else return;
    e.preventDefault();
  }

  // Event delegation: satu listener untuk seluruh kanvas.
  function onClick(e) {
    // Gambar/diagram ber-data-croot-zoom di node aktif: tampilkan layar penuh.
    var zoom = e.target.closest('[data-croot-zoom]');
    if (zoom && root.contains(zoom) && !inOverview && zoom.closest(NODE) === current) {
      e.preventDefault();
      zoomIn(zoom);
      return;
    }
    var trigger = e.target.closest('[data-croot-target]');
    if (trigger && root.contains(trigger)) {
      e.preventDefault();
      goto(document.querySelector(trigger.dataset.crootTarget));
      return;
    }
    var control = e.target.closest(INTERACTIVE);
    if (control && control !== root && root.contains(control)) return; // jangan bajak link/tombol/form
    var el = e.target.closest(NODE);
    if (el && stage.contains(el) && (el !== current || inOverview)) goto(el);
  }

  var touch = null;
  function onTouchStart(e) {
    if (e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e) {
    if (!touch) return;
    var dx = e.changedTouches[0].clientX - touch.x;
    var dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 50) return;
    if (Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
    else (dy < 0 ? next : prev)();
  }

  var resizeFrame = null;
  function onResize() {
    if (root.croot !== api) return; // sudah di-destroy
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(function () {
      setCamera(inOverview ? overviewCamera() : nodeCamera(current), true);
      if (options.debug) checkOverflow();
    });
  }

  function onHash() {
    var id = location.hash.replace(/^#\/?/, '');
    if (id === 'overview') overview(true);
    else if (id) goto(id);
  }

  /* ---------- init ---------- */

  var live = document.createElement('div');
  live.className = 'croot-sr-only';
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  root.classList.add('croot-ready');
  if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');

  if (options.keyboard) document.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);
  if (options.touch) {
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd);
  }
  window.addEventListener('resize', onResize);
  // Ukuran node/viewport bisa berubah setelah init (font web, gambar, viewport
  // ponsel yang baru stabil), jadi kamera dipasang ulang setelah semuanya siap.
  window.addEventListener('load', onResize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
  if (options.hash) window.addEventListener('hashchange', onHash);
  window.addEventListener('beforeprint', buildPrint);
  window.addEventListener('afterprint', clearPrint);
  if (options.debug) root.classList.add('croot-debug');

  var start = options.hash && location.hash.replace(/^#\/?/, '');
  if (start === 'overview') {
    goto(0, true);
    overview(true, true);
  } else if (!(start && goto(start, true))) {
    goto(0, true);
  }

  var api = {
    root: root,
    steps: steps,
    bigPicture: big,
    goto: goto,
    next: next,
    prev: prev,
    overview: overview,
    checkOverflow: checkOverflow,
    print: print,
    presenter: presenter,
    get current() { return current; },
    get index() { return index; },
    get isOverview() { return inOverview; },
    destroy: function () {
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('click', onClick);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('load', onResize);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('beforeprint', buildPrint);
      window.removeEventListener('afterprint', clearPrint);
      clearPrint();
      if (presenterWin && !presenterWin.closed) presenterWin.close();
      root.classList.remove('croot-ready', 'croot-overview', 'croot-moving', 'croot-instant', 'croot-debug');
      all.forEach(function (el) { el.classList.remove('croot-overflow'); });
      if (pullAnim) pullAnim.cancel();
      stage.style.transform = '';
      all.forEach(function (el) { el.classList.remove('croot-active'); el.removeAttribute('aria-current'); });
      live.remove();
      delete root.croot;
    }
  };
  root.croot = api;

  // ?print di URL: buka dialog cetak setelah font dan gambar siap.
  // ?print=pdf: siapkan halaman cetak saja, tanpa dialog (Chromium headless,
  // tools/pdf.py).
  var printParam = /[?&]print(?:=([^&]*))?(?:&|$)/.exec(location.search);
  if (printParam) {
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    var loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise(function (r) { window.addEventListener('load', r, { once: true }); });
    Promise.all([ready, loaded]).then(function () {
      setTimeout(function () { print(printParam[1] !== 'pdf'); }, 300);
    });
  }
  return api;
}

// Auto-init: <div class="croot-viewport" data-croot> (lewati dengan data-croot="manual")
if (typeof document !== 'undefined') {
  var auto = function () {
    document.querySelectorAll('[data-croot]:not([data-croot="manual"])').forEach(function (el) { croot(el); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
}

export default croot;
