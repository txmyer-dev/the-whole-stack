/*
 * SlidingColumns — stacked, sliding-column note navigation.
 * Dependency-free browser drop-in for the pattern popularised by Andy Matuschak's
 * working notes (notes.andymatuschak.org): every internal link opens in a new column
 * to the right, the URL carries the whole stack, and scrolled-past columns collapse
 * to a narrow strip showing the note title vertically.
 *
 * Usage: include sliding-columns.css, add <div id="sliding-columns"></div>, load this file,
 * then call SlidingColumns.init({ rootSlug: 'home' }). See docs/api.md for every option.
 * (Keep closing script tags out of this file: it is often inlined into a page.)
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    container: '#sliding-columns',
    rootSlug: null,
    routing: 'path',                 // 'path' → /root?stackedNotes=a  |  'hash' → #/root?stackedNotes=a
    basePath: '/',
    paramName: 'stackedNotes',
    columnWidth: 625,
    collapsedWidth: 40,
    mobileBreakpoint: 800,
    linkSelector: 'a[href]',
    contentSelector: 'main, article, .sc-note, body',
    noteUrl: null,                   // (slug) => URL to fetch for the default loader
    slugFromHref: null,              // (href, anchor) => slug | null
    loadNote: null,                  // async (slug) => { title, html }
    onNavigate: null,                // (stack) => void
    transitionMs: 150
  };

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) target[k] = src[k];
    }
    return target;
  }

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function normalizeSlug(s) {
    if (!s) return null;
    s = s.replace(/^\/+|\/+$/g, '').replace(/\.html?$/i, '');
    if (!s) return null;
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  function init(userOptions) {
    var opts = assign({}, DEFAULTS, userOptions || {});
    var container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('SlidingColumns: container not found: ' + opts.container);
    if (opts.basePath.charAt(opts.basePath.length - 1) !== '/') opts.basePath += '/';

    container.classList.add('sc-root');
    container.style.setProperty('--sc-column-width', opts.columnWidth + 'px');
    container.style.setProperty('--sc-collapsed-width', opts.collapsedWidth + 'px');

    var track = container.querySelector('.sc-track');
    if (!track) {
      track = el('div', 'sc-track');
      // Adopt any pre-rendered columns.
      var preRendered = Array.prototype.slice.call(container.querySelectorAll('.sc-column'));
      preRendered.forEach(function (c) { track.appendChild(c); });
      container.appendChild(track);
    }

    var cache = {};            // slug → Promise<{title, html}>
    var columns = [];          // [{ slug, node, title }]
    var hovered = null;        // { sourceIndex, slug }

    // Adopt pre-rendered columns into the cache so the first paint costs no fetch.
    Array.prototype.forEach.call(track.querySelectorAll('.sc-column[data-slug]'), function (node) {
      var slug = node.getAttribute('data-slug');
      var note = node.querySelector('.sc-note');
      var label = node.querySelector('.sc-label');
      var title = (label && label.textContent) || (note && note.querySelector('h1') && note.querySelector('h1').textContent) || slug;
      if (!label) { label = el('div', 'sc-label'); label.textContent = title; node.insertBefore(label, node.firstChild); }
      cache[slug] = Promise.resolve({ title: title, html: note ? note.innerHTML : '' });
      columns.push({ slug: slug, node: node, title: title });
    });

    /* ---------- routing ---------- */

    function readRoute() {
      var path, search;
      if (opts.routing === 'hash') {
        var h = global.location.hash.replace(/^#\/?/, '');
        var q = h.indexOf('?');
        path = q === -1 ? h : h.slice(0, q);
        search = q === -1 ? '' : h.slice(q);
      } else {
        path = global.location.pathname;
        if (path.indexOf(opts.basePath) === 0) path = path.slice(opts.basePath.length);
        search = global.location.search;
      }
      var root = normalizeSlug(path) || opts.rootSlug;
      var stacked = [];
      var params = new URLSearchParams(search);
      params.getAll(opts.paramName).forEach(function (s) { s = normalizeSlug(s); if (s) stacked.push(s); });
      return root ? [root].concat(stacked) : [];
    }

    function buildUrl(stack) {
      var qs = stack.slice(1).map(function (s) { return opts.paramName + '=' + encodeURIComponent(s); }).join('&');
      var tail = encodeURIComponent(stack[0]) + (qs ? '?' + qs : '');
      return opts.routing === 'hash' ? '#/' + tail : opts.basePath + tail;
    }

    function pushRoute(stack) {
      global.history.pushState(null, '', buildUrl(stack));
      render(stack);
    }

    /* ---------- loading ---------- */

    function defaultNoteUrl(slug) {
      return opts.basePath + encodeURIComponent(slug);
    }

    function defaultLoadNote(slug) {
      var url = (opts.noteUrl || defaultNoteUrl)(slug);
      return fetch(url, { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        return res.text();
      }).then(function (text) {
        var doc = new DOMParser().parseFromString(text, 'text/html');
        var body = doc.querySelector(opts.contentSelector) || doc.body;
        var label = doc.querySelector('.sc-label');
        var h1 = body.querySelector('h1') || doc.querySelector('h1');
        var title = (label && label.textContent) || (h1 && h1.textContent) || doc.title || slug;
        return { title: title.trim(), html: body.innerHTML };
      });
    }

    function load(slug) {
      if (!cache[slug]) {
        cache[slug] = Promise.resolve().then(function () { return (opts.loadNote || defaultLoadNote)(slug); })
          .catch(function (err) {
            return { title: slug, html: '<p class="sc-error">Couldn’t load this note (' + String(err.message || err) + ').</p>' };
          });
      }
      return cache[slug];
    }

    /* ---------- rendering ---------- */

    function isMobile() { return container.clientWidth <= opts.mobileBreakpoint; }

    function positionColumn(entry, index) {
      entry.node.style.left = (index * opts.collapsedWidth) + 'px';
      entry.node.style.right = (-(opts.columnWidth - opts.collapsedWidth)) + 'px';
      entry.node.setAttribute('data-index', String(index));
    }

    function createColumn(slug) {
      var node = el('div', 'sc-column sc-entering', { 'data-slug': slug });
      var label = el('div', 'sc-label'); label.textContent = slug;
      var note = el('div', 'sc-note');
      note.innerHTML = '<p class="sc-loading">Loading…</p>';
      node.appendChild(label); node.appendChild(note);
      var entry = { slug: slug, node: node, title: slug };
      load(slug).then(function (data) {
        entry.title = data.title;
        label.textContent = data.title;
        note.innerHTML = data.html;
        markActiveLinks();
      });
      var reveal = function () { node.classList.remove('sc-entering'); };
      global.requestAnimationFrame(reveal); global.setTimeout(reveal, 50);
      return entry;
    }

    function removeColumn(entry) {
      entry.node.classList.add('sc-exiting');
      global.setTimeout(function () { if (entry.node.parentNode) entry.node.parentNode.removeChild(entry.node); }, opts.transitionMs);
    }

    function render(stack) {
      var mobile = isMobile();
      var visible = mobile ? stack.slice(-1) : stack;
      // Keep the longest matching prefix, drop the rest, append the new tail.
      var keep = 0;
      while (keep < columns.length && keep < visible.length && columns[keep].slug === visible[keep]) keep++;
      columns.splice(keep).forEach(removeColumn);
      for (var i = keep; i < visible.length; i++) {
        var entry = createColumn(visible[i]);
        track.appendChild(entry.node);
        columns.push(entry);
      }
      columns.forEach(positionColumn);
      track.style.width = mobile ? '' : (visible.length * opts.columnWidth) + 'px';
      container.classList.toggle('sc-mobile', mobile);
      updateStates();
      markActiveLinks();
      if (opts.onNavigate) opts.onNavigate(stack.slice());
    }

    function currentStack() { return columns.map(function (c) { return c.slug; }); }

    /* ---------- scroll states (resting / overlay / obscured) ---------- */

    function updateStates() {
      if (isMobile()) { columns.forEach(function (c) { c.node.setAttribute('data-state', 'resting'); }); return; }
      var w = opts.columnWidth, cw = opts.collapsedWidth, vw = container.clientWidth;
      var x = container.scrollLeft;
      columns.forEach(function (c, i) {
        // Scrolled past this column's natural start → it is pinned on the left (overlay);
        // scrolled past the next column's start too → it has collapsed to a strip (obscured).
        var start = Math.max(0, (w - cw) * (i - 1));
        var collapseLeft = Math.max(0, (w - cw) * (i + 1) - 80);
        // Not yet scrolled far enough for this column to fit → it is pinned on the right edge (obscured).
        var collapseRight = Math.min(track.scrollWidth, (w - cw) * i - (vw - (i - 1) * cw) + 80);
        var state = x > start ? (x > collapseLeft ? 'obscured' : 'overlay') : (x < collapseRight ? 'obscured' : 'resting');
        c.node.setAttribute('data-state', state);
      });
    }

    function scrollToColumn(index) {
      if (isMobile()) return;
      if (columns.length * opts.columnWidth > container.clientWidth) {
        container.scrollTo({ left: index * opts.columnWidth - (container.clientWidth - opts.columnWidth) / 2, top: 0, behavior: 'smooth' });
      }
    }

    /* ---------- links ---------- */

    function slugFromAnchor(a) {
      if (opts.slugFromHref) return opts.slugFromHref(a.getAttribute('href'), a);
      if (a.target && a.target !== '_self') return null;
      if (a.hasAttribute('download')) return null;
      var url;
      try { url = new URL(a.href, global.location.href); } catch (e) { return null; }
      if (url.origin !== global.location.origin) return null;
      if (opts.routing === 'hash') {
        if (url.hash.indexOf('#/') === 0) return normalizeSlug(url.hash.slice(2).split('?')[0]);
        if (url.pathname === global.location.pathname && url.hash) return null; // in-page anchor
      }
      if (url.pathname.indexOf(opts.basePath) !== 0) return null;
      var rest = url.pathname.slice(opts.basePath.length);
      return normalizeSlug(rest);
    }

    function columnIndexOf(node) {
      var col = node.closest ? node.closest('.sc-column') : null;
      if (!col) return -1;
      for (var i = 0; i < columns.length; i++) if (columns[i].node === col) return i;
      return -1;
    }

    function navigate(sourceIndex, slug) {
      var stack = currentStack();
      if (isMobile()) { pushRoute([slug]); return; }
      var existing = stack.indexOf(slug);
      if (existing !== -1) { scrollToColumn(existing); return; }
      var next = stack.slice(0, sourceIndex + 1).concat([slug]);
      pushRoute(next);
      global.setTimeout(function () { scrollToColumn(next.length - 1); }, 16);
    }

    function onClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest(opts.linkSelector) : null;
      if (!a || !container.contains(a)) return;
      var slug = slugFromAnchor(a);
      if (!slug) return;
      e.preventDefault();
      navigate(columnIndexOf(a), slug);
    }

    function clearHover() {
      hovered = null;
      columns.forEach(function (c) { c.node.classList.remove('sc-hover-target', 'sc-would-exit'); });
    }

    function onMouseOver(e) {
      var a = e.target.closest ? e.target.closest(opts.linkSelector) : null;
      if (!a || !container.contains(a)) return;
      var slug = slugFromAnchor(a);
      if (!slug) return;
      clearHover();
      var source = columnIndexOf(a);
      hovered = { sourceIndex: source, slug: slug };
      var target = currentStack().indexOf(slug);
      columns.forEach(function (c, i) {
        if (i === target) c.node.classList.add('sc-hover-target');
        else if (target === -1 && i > source) c.node.classList.add('sc-would-exit');
      });
    }

    function onMouseOut(e) {
      var a = e.target.closest ? e.target.closest(opts.linkSelector) : null;
      if (a && container.contains(a)) clearHover();
    }

    function markActiveLinks() {
      var stack = currentStack();
      Array.prototype.forEach.call(container.querySelectorAll(opts.linkSelector), function (a) {
        var slug = slugFromAnchor(a);
        a.classList.toggle('sc-link-open', !!slug && stack.indexOf(slug) !== -1);
      });
    }

    /* ---------- wiring ---------- */

    function onScroll() { updateStates(); } // browsers already coalesce scroll events per frame
    function onPop() { render(readRoute()); }
    function onResize() { render(readRoute()); }

    container.addEventListener('click', onClick);
    container.addEventListener('mouseover', onMouseOver);
    container.addEventListener('mouseout', onMouseOut);
    container.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('popstate', onPop);
    global.addEventListener('resize', onResize);

    var initial = readRoute();
    if (!initial.length && columns.length) initial = currentStack();
    if (!initial.length) throw new Error('SlidingColumns: no root note — pass rootSlug or pre-render a .sc-column');
    if (opts.routing !== 'hash' && global.location.pathname === opts.basePath && initial.length === 1) {
      global.history.replaceState(null, '', buildUrl(initial));
    }
    render(initial);

    return {
      navigate: navigate,
      open: function (slug) { navigate(columns.length - 1, slug); },
      setStack: pushRoute,
      getStack: currentStack,
      refresh: function () { render(readRoute()); },
      destroy: function () {
        container.removeEventListener('click', onClick);
        container.removeEventListener('mouseover', onMouseOver);
        container.removeEventListener('mouseout', onMouseOut);
        container.removeEventListener('scroll', onScroll);
        global.removeEventListener('popstate', onPop);
        global.removeEventListener('resize', onResize);
      }
    };
  }

  var api = { init: init, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SlidingColumns = api;
})(typeof window !== 'undefined' ? window : this);
