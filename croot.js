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

  options = Object.assign({ fit: 0.9, hash: true, keyboard: true, touch: true }, options);
  if (root.dataset.crootFit) options.fit = num(root.dataset.crootFit, options.fit);

  var stage = root.querySelector('.croot-stage');
  if (!stage) throw new Error('croot: .croot-stage tidak ditemukan');

  var all = Array.prototype.slice.call(stage.querySelectorAll(NODE));
  var steps = [];        // node dalam urutan linier
  var current = null;    // node aktif
  var index = -1;        // index linier terakhir (tetap saat node bebas diklik)
  var inOverview = false;
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

  function nodeCamera(el) {
    var fit = Math.min(root.clientWidth / el.offsetWidth, root.clientHeight / el.offsetHeight) * options.fit;
    return new DOMMatrix().scaleSelf(fit, fit, fit).multiply(worldMatrix(el).inverse());
  }

  function overviewCamera() {
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
    setCamera(nodeCamera(el), instant);
    updateHash(el.id);
    announce(el);
    if (prev !== el || wasOverview) emit(el, 'croot:enter', { previous: prev, index: index });
    return true;
  }

  function next() {
    if (inOverview && current) return goto(current);
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
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) next();
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey)) prev();
    else if (k === 'Home') goto(0);
    else if (k === 'End') goto(steps.length - 1);
    else if (k === 'Escape') overview();
    else return;
    e.preventDefault();
  }

  // Event delegation: satu listener untuk seluruh kanvas.
  function onClick(e) {
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
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(function () {
      setCamera(inOverview ? overviewCamera() : nodeCamera(current), true);
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
  if (options.hash) window.addEventListener('hashchange', onHash);

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
    goto: goto,
    next: next,
    prev: prev,
    overview: overview,
    get current() { return current; },
    get index() { return index; },
    get isOverview() { return inOverview; },
    destroy: function () {
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('click', onClick);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('hashchange', onHash);
      root.classList.remove('croot-ready', 'croot-overview', 'croot-moving', 'croot-instant');
      stage.style.transform = '';
      all.forEach(function (el) { el.classList.remove('croot-active'); el.removeAttribute('aria-current'); });
      live.remove();
      delete root.croot;
    }
  };
  root.croot = api;
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
