/* SMYL · Menú propio para selectores (solo computadora).
 *
 * El desplegable nativo de Windows/macOS no se puede estilizar: se ve plano y con letra de 16 px (regla global anti-zoom
 * de iPhone). En computadora (mouse y hover) este módulo abre en su lugar una tarjeta propia, con el estilo de SMYL.
 * En celular y tableta no hace nada: el selector del sistema (rueda de iOS, hoja de Android) es mejor con el dedo.
 *
 * El <select> sigue siendo la fuente de verdad: se leen sus opciones cada vez que se abre (los módulos las reescriben) y al
 * elegir se asigna select.value y se emiten «input» y «change», así los módulos no cambian nada.
 * Este módulo nunca inserta HTML como texto: todo se arma con createElement y textContent.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SmylSelectMenu = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);

  // Selectores que usan el menú propio. `dark`: sobre el menú lateral. `avatars`: inicial en círculo de color.
  var TARGETS = [
    { selector: '#sb-branch-select', dark: true, avatars: true },
    { selector: '#p-agenda .schedule-filter select#schedule-branch', avatars: true },
    { selector: '#p-agenda .schedule-filter select#schedule-professional', avatars: true },
    { selector: '#p-agenda .schedule-filter select', avatars: false }
  ];
  var GLOBAL_VALUES = ['', 'all'];
  var SEARCH_FROM = 7;
  var PALETTE = ['#2f9e94', '#3b82f6', '#8b5cf6', '#e0791f', '#d9467a', '#0e7490', '#65a30d', '#b45309'];
  var PREFIX_RE = /^(sucursal|consultorio|cl[ií]nica|sede|dr\.?|dra\.?)\s+/i;

  // Opciones que se pintan (pura): texto, valor, si es la vista global, inicial y color.
  function optionsOf(select) {
    var list = [];
    var opts = select && select.options ? select.options : [];
    for (var i = 0; i < opts.length; i += 1) {
      var o = opts[i];
      if (o.hidden || o.disabled) continue;
      var text = String(o.textContent || '').trim();
      list.push({ value: o.value, text: text, global: GLOBAL_VALUES.indexOf(o.value) !== -1, initial: initialOf(text), color: colorOf(text) });
    }
    return list;
  }
  function initialOf(text) {
    var base = String(text || '').replace(PREFIX_RE, '').trim() || String(text || '').trim();
    return base ? base.charAt(0).toUpperCase() : '·';
  }
  function colorOf(text) {
    var h = 0, s = String(text || '');
    for (var i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function matches(item, query) {
    var q = normalize(query).trim();
    return !q || normalize(item.text).indexOf(q) !== -1;
  }
  function configFor(select) {
    if (!select || typeof select.matches !== 'function') return null;
    for (var i = 0; i < TARGETS.length; i += 1) if (select.matches(TARGETS[i].selector)) return TARGETS[i];
    return null;
  }
  function isDesktop() {
    try { return !!(root.matchMedia && root.matchMedia('(hover: hover) and (pointer: fine)').matches); } catch (e) { return false; }
  }

  var open = null; // { select, menu, items, active, search, list }

  function close(refocus) {
    if (!open) return;
    var s = open.select;
    if (open.menu && open.menu.parentNode) open.menu.parentNode.removeChild(open.menu);
    s.setAttribute('aria-expanded', 'false');
    s.classList.remove('smyl-select-open');
    open = null;
    if (refocus) try { s.focus({ preventScroll: true }); } catch (e) {}
  }

  function choose(value) {
    if (!open) return;
    var s = open.select;
    var changed = s.value !== value;
    close(true);
    if (!changed) return;
    s.value = value;
    s.dispatchEvent(new root.Event('input', { bubbles: true }));
    s.dispatchEvent(new root.Event('change', { bubbles: true }));
  }

  function setActive(index) {
    if (!open) return;
    var rows = open.list.querySelectorAll('[role="option"]');
    if (!rows.length) { open.active = -1; return; }
    index = Math.max(0, Math.min(rows.length - 1, index));
    open.active = index;
    for (var i = 0; i < rows.length; i += 1) rows[i].classList.toggle('is-active', i === index);
    if (rows[index].scrollIntoView) rows[index].scrollIntoView({ block: 'nearest' });
    open.menu.setAttribute('aria-activedescendant', rows[index].id);
  }

  function renderList(query) {
    var doc = root.document, cfg = open.cfg, list = open.list, items = open.items.filter(function (it) { return matches(it, query); });
    while (list.firstChild) list.removeChild(list.firstChild);
    var globals = items.filter(function (it) { return it.global; });
    var others = items.filter(function (it) { return !it.global; });
    var globalFirst = open.items.length && open.items[0].global;
    var ordered = globalFirst ? globals.concat(others) : others.concat(globals);
    var current = open.select.value, activeIndex = 0;
    ordered.forEach(function (it, i) {
      if (globals.length && others.length && ((globalFirst && i === globals.length) || (!globalFirst && i === others.length))) {
        var sep = doc.createElement('div'); sep.className = 'smyl-select-menu-sep'; sep.setAttribute('role', 'separator'); list.appendChild(sep);
      }
      var row = doc.createElement('div');
      row.className = 'smyl-select-menu-option' + (it.global ? ' is-global' : '');
      row.id = 'smyl-select-opt-' + i;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', it.value === current ? 'true' : 'false');
      row.dataset.value = it.value;
      if (cfg.avatars || it.global) {
        var badge = doc.createElement('span');
        badge.className = 'smyl-select-menu-badge';
        badge.setAttribute('aria-hidden', 'true');
        if (it.global) badge.classList.add('is-global'); else { badge.textContent = it.initial; badge.style.background = it.color; }
        row.appendChild(badge);
      }
      var label = doc.createElement('span'); label.className = 'smyl-select-menu-label'; label.textContent = it.text; row.appendChild(label);
      var check = doc.createElement('span'); check.className = 'smyl-select-menu-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = it.value === current ? '✓' : ''; row.appendChild(check);
      row.addEventListener('mousedown', function (event) { event.preventDefault(); });
      row.addEventListener('click', function () { choose(it.value); });
      row.addEventListener('mousemove', function () { setActive(Array.prototype.indexOf.call(list.querySelectorAll('[role="option"]'), row)); });
      list.appendChild(row);
      if (it.value === current && !query) activeIndex = list.querySelectorAll('[role="option"]').length - 1;
    });
    if (!ordered.length) {
      var empty = doc.createElement('div'); empty.className = 'smyl-select-menu-empty'; empty.textContent = 'Sin resultados'; list.appendChild(empty);
    }
    setActive(activeIndex);
  }

  function place() {
    if (!open) return;
    var r = open.select.getBoundingClientRect(), menu = open.menu, vw = root.innerWidth, vh = root.innerHeight;
    // Mínimo el ancho del selector; crece con el nombre más largo hasta 360 px para no cortar nombres.
    menu.style.minWidth = Math.max(r.width, 232) + 'px';
    menu.style.maxWidth = Math.min(360, vw - 16) + 'px';
    var width = menu.getBoundingClientRect().width;
    menu.style.left = Math.min(Math.max(8, r.left), vw - width - 8) + 'px';
    var below = vh - r.bottom - 12, above = r.top - 12;
    var up = below < 220 && above > below;
    menu.style.maxHeight = Math.max(160, Math.min(380, up ? above : below)) + 'px';
    if (up) { menu.style.top = ''; menu.style.bottom = (vh - r.top + 6) + 'px'; } else { menu.style.bottom = ''; menu.style.top = (r.bottom + 6) + 'px'; }
  }

  function openMenu(select) {
    var cfg = configFor(select);
    if (!cfg) return false;
    if (open && open.select === select) { close(true); return true; }
    close(false);
    var doc = root.document;
    var menu = doc.createElement('div');
    menu.className = 'smyl-select-menu' + (cfg.dark ? ' is-dark' : '');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('tabindex', '-1');
    var labelText = select.getAttribute('aria-label') || '';
    if (labelText) menu.setAttribute('aria-label', labelText);
    var items = optionsOf(select);
    open = { select: select, menu: menu, items: items, cfg: cfg, active: -1, search: null, list: null };
    if (items.length >= SEARCH_FROM) {
      var search = doc.createElement('input');
      search.type = 'search';
      search.className = 'smyl-select-menu-search';
      search.placeholder = 'Buscar…';
      search.setAttribute('aria-label', 'Buscar en la lista');
      search.addEventListener('input', function () { renderList(search.value); });
      menu.appendChild(search);
      open.search = search;
    }
    var list = doc.createElement('div'); list.className = 'smyl-select-menu-list'; menu.appendChild(list); open.list = list;
    menu.addEventListener('keydown', onMenuKey);
    doc.body.appendChild(menu);
    select.setAttribute('aria-expanded', 'true');
    select.classList.add('smyl-select-open');
    renderList('');
    place();
    try { (open.search || menu).focus({ preventScroll: true }); } catch (e) {}
    return true;
  }

  function onMenuKey(event) {
    if (!open) return;
    var k = event.key;
    if (k === 'ArrowDown') { event.preventDefault(); setActive(open.active + 1); }
    else if (k === 'ArrowUp') { event.preventDefault(); setActive(open.active - 1); }
    else if (k === 'Home' && !open.search) { event.preventDefault(); setActive(0); }
    else if (k === 'End' && !open.search) { event.preventDefault(); setActive(1e6); }
    else if (k === 'Enter' || (k === ' ' && !open.search)) {
      event.preventDefault();
      var row = open.list.querySelectorAll('[role="option"]')[open.active];
      if (row) choose(row.dataset.value);
    } else if (k === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (k === 'Tab') { close(false); }
  }

  function onMouseDown(event) {
    var t = event.target;
    if (open && open.menu.contains(t)) return;
    var select = t && t.closest ? t.closest('select') : null;
    if (select && configFor(select) && isDesktop() && !select.disabled) {
      event.preventDefault();
      if (!(open && open.select === select)) try { select.focus({ preventScroll: true }); } catch (e) {}
      openMenu(select);
      return;
    }
    close(false);
  }

  function onKeyDown(event) {
    var select = event.target;
    if (!select || select.tagName !== 'SELECT' || open || !configFor(select) || !isDesktop() || select.disabled) return;
    var k = event.key;
    if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp' || (event.altKey && k === 'ArrowDown')) {
      event.preventDefault();
      openMenu(select);
    }
  }

  function install() {
    var doc = root.document;
    if (!doc || doc.documentElement.dataset.smylSelectMenu === 'true') return;
    doc.documentElement.dataset.smylSelectMenu = 'true';
    doc.addEventListener('mousedown', onMouseDown, true);
    doc.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('resize', function () { close(false); });
    doc.addEventListener('scroll', function (event) { if (open && !open.menu.contains(event.target)) close(false); }, true);
  }

  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', install); else install();
  }

  return { TARGETS: TARGETS, optionsOf: optionsOf, initialOf: initialOf, colorOf: colorOf, matches: matches, configFor: configFor, open: openMenu, close: close, install: install };
});
