/* Center-to-select interaction shared by preparation and local shade preview.
 * Selection follows user scrolling each frame; expensive work waits for settling.
 * Layout changes never silently change a preset.
 */
(function (root) {
  'use strict';
  function attach({ track, selector, key, onSelect, onSettle = () => {}, enabled = () => true }) {
    let selected = null, timer = null, frame = null, selectionFrame = null, dragging = null, suppressClick = false;
    let syncing = false, reporting = false, destroyed = false, moved = false, pending = false;
    const pointers = new Set(), listeners = [];
    const items = () => Array.from(track.querySelectorAll(selector));
    const value = item => item?.getAttribute(key);
    const byValue = code => items().find(item => value(item) === code);
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const on = (event, fn, options) => { track.addEventListener(event, fn, options); listeners.push([event, fn, options]); };
    function offset(item) {
      const a = track.getBoundingClientRect(), b = item.getBoundingClientRect();
      return b.left + b.width / 2 - a.left - track.clientLeft - track.clientWidth / 2;
    }
    function nearest() { return items().reduce((best, item) => !best || Math.abs(offset(item)) < Math.abs(offset(best)) ? item : best, null); }
    function tabs() {
      const list = items(), active = byValue(selected) || list[0];
      list.forEach(item => { item.tabIndex = item === active ? 0 : -1; });
    }
    function notify(item, force = false) {
      if (!item || item.disabled || !enabled()) return;
      const code = value(item); if (code === selected && !force) return;
      selected = code; pending = true; tabs(); reporting = true;
      try { onSelect(code); } finally { reporting = false; }
    }
    function commit() {
      if (!pending || !enabled()) return;
      pending = false; onSettle(selected);
    }
    function followCenter() {
      selectionFrame = null;
      if (!destroyed && !syncing && moved && track.clientWidth && enabled()) notify(nearest());
    }
    function center(item, smooth) {
      if (!item || !track.clientWidth) return;
      syncing = true; moved = false;
      track.scrollTo({ left: track.scrollLeft + offset(item), behavior: smooth && !reduced() ? 'smooth' : 'instant' });
      defer();
    }
    function settle() {
      clearTimeout(timer);
      if (destroyed || pointers.size || !track.clientWidth) return;
      if (syncing) { syncing = false; moved = false; commit(); return; }
      if (!moved) return;
      moved = false;
      if (!enabled()) { center(byValue(selected), false); return; }
      const item = nearest(); notify(item); commit();
      if (item && Math.abs(offset(item)) > .75) center(item, true);
    }
    function defer() { clearTimeout(timer); timer = setTimeout(settle, 160); }
    function sync(code) {
      const changed = code !== selected; selected = code; tabs();
      if (changed && !reporting) { pending = false; center(byValue(code) || nearest(), false); }
    }
    function pick(code) {
      const item = byValue(code); if (!item || item.disabled || !enabled()) return;
      notify(item, true); commit(); center(item, true);
    }
    function step(direction) {
      const list = items(), start = byValue(selected) || nearest();
      const index = Math.max(0, Math.min(list.length - 1, list.indexOf(start) + direction));
      pick(value(list[index]));
    }
    function layout() {
      if (destroyed || !track.clientWidth) return;
      const first = items()[0]; if (!first) return;
      const edge = Math.max(0, (track.clientWidth - first.getBoundingClientRect().width) / 2) + 'px';
      if (track.style.getPropertyValue('--shade-edge') !== edge) track.style.setProperty('--shade-edge', edge);
      if (!pointers.size) center(byValue(selected) || nearest(), false);
    }
    on('scroll', () => {
      if (!syncing) {
        moved = true;
        if (selectionFrame === null) selectionFrame = requestAnimationFrame(followCenter);
      }
      defer();
    }, { passive: true });
    on('scrollend', settle);
    on('pointerdown', event => {
      if (!enabled() || event.button > 0) return;
      pointers.add(event.pointerId); clearTimeout(timer); syncing = false; suppressClick = false;
      if (event.pointerType === 'mouse') dragging = { id: event.pointerId, x: event.clientX, left: track.scrollLeft, moved: false };
    });
    on('pointermove', event => {
      if (!dragging || dragging.id !== event.pointerId) return;
      const delta = event.clientX - dragging.x;
      if (!dragging.moved && Math.abs(delta) < 7) return;
      if (!dragging.moved) { dragging.moved = true; track.classList.add('is-dragging'); track.setPointerCapture(event.pointerId); }
      event.preventDefault(); track.scrollLeft = dragging.left - delta; moved = true;
    });
    function release(event) {
      pointers.delete(event.pointerId);
      if (dragging?.id === event.pointerId) {
        suppressClick = dragging.moved; dragging = null; track.classList.remove('is-dragging');
        if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      }
      defer();
    }
    on('pointerup', release); on('pointercancel', release); on('lostpointercapture', release);
    on('pointerleave', event => { if (dragging && !dragging.moved) { pointers.delete(event.pointerId); dragging = null; } });
    on('wheel', () => { syncing = false; }, { passive: true });
    on('click', event => { if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; } }, true);
    on('keydown', event => {
      const target = event.target.closest(selector); if (!target || target.disabled || !enabled()) return;
      const list = items(); let index = list.indexOf(target);
      if (event.key === 'ArrowRight') index++; else if (event.key === 'ArrowLeft') index--;
      else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = list.length - 1; else return;
      event.preventDefault(); const next = list[Math.max(0, Math.min(list.length - 1, index))];
      pick(value(next)); next.focus({ preventScroll: true });
    });
    const resize = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); });
    resize.observe(track, { box: 'border-box' }); tabs();
    return { sync, pick, step, layout, destroy() {
      destroyed = true; clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(selectionFrame); resize.disconnect();
      listeners.forEach(([event, fn, options]) => track.removeEventListener(event, fn, options));
    } };
  }
  root.SmylShadeCarousel = { attach };
})(window);
