/* Read-only My SMYL preview of accepted images already in this simulator.
 * No API, save, share, patient identity, or clinical-document projection.
 * This is NOT patient authentication; the private portal remains unavailable.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const views = new Set(['frontal','left','right','tresCuartos','extraoral','intraoral','intraoralLeft','intraoralRight']);
  const source = p => p.dataUrl || (p.b64 ? 'data:' + (p.mimeType || 'image/jpeg') + ';base64,' + p.b64 : '');
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text != null) n.textContent = text; return n; };
  let active = null;

  function professional() {
    return typeof S !== 'undefined' && typeof CFG !== 'undefined' && !CFG.modoProspecto &&
      (new URLSearchParams(location.search).get('workspace') === 'professional' || (!!CFG.userId && CFG.userId === CFG.tenantId));
  }
  function pairs() {
    if (!Array.isArray(S.photos) || S.photos.length > 8) return [];
    const seen = new Set(), result = [];
    for (const p of S.photos) {
      if (!p || !views.has(p.view) || seen.has(p.view)) return [];
      seen.add(p.view);
      // Never S.result, pendingGeneratedByView, raw output or supporting photos alone.
      if (!p.synthetic && typeof S.results?.[p.view] === 'string' && S.results[p.view] && (p.dataUrl || p.b64)) {
        result.push({photo:p, view:p.view, dataUrl:p.dataUrl, b64:p.b64, mimeType:p.mimeType, result:S.results[p.view]});
      }
    }
    return result;
  }
  function available() {
    return professional() && $('s-res')?.classList.contains('active') && !$('ba-wrap')?.classList.contains('ba-regenerating');
  }
  function imageBlob(src) {
    // Decode only local raster bytes; never fetch a supplied URL or render SVG/HTML.
    if (typeof src !== 'string' || src.length > 14000100) throw Error('image');
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
    if (!match || match[2].length % 4) throw Error('image');
    const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)), type = match[1];
    const valid = type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : type === 'image/png' ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
      : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
    if (!valid || bytes.length < 16 || bytes.length > 10 * 1024 * 1024) throw Error('image');
    return new Blob([bytes], {type});
  }
  async function openPreview() {
    if (active || !available()) return;
    const captured = pairs(); if (!captured.length) return;
    const owner = progressKey(), actor = CFG.userId, tenant = CFG.tenantId, caseId = S.casoId, selected = S.baVistaActual;
    const current = () => {
      if (!available() || owner !== progressKey() || actor !== CFG.userId || tenant !== CFG.tenantId || caseId !== S.casoId || selected !== S.baVistaActual) return false;
      const next = pairs();
      // Compare existing references/strings; do not rebuild large data URLs on a timer.
      return next.length === captured.length && next.every((p,i) => ['photo','view','dataUrl','b64','mimeType','result'].every(key => p[key] === captured[i][key]));
    };
    const focus = document.activeElement, urls = [];
    const dialog = node('dialog','ms-preview-dialog'), bar = node('div','ms-preview-bar'), host = node('div');
    dialog.id = 'ms-studio-preview'; dialog.setAttribute('aria-labelledby','ms-studio-title');
    const title = node('span','','mySmyl · vista previa'); title.id = 'ms-studio-title';
    const back = node('button','','Volver a la simulación'); back.type = 'button';
    bar.append(title,back); dialog.append(bar,host);
    host.append(node('p','ms-preview-loading','Abriendo las fotos de tu simulación…'));
    let closed = false, controller = null, watch = null;
    function release() { controller?.destroy(); controller = null; urls.splice(0).forEach(url => URL.revokeObjectURL(url)); }
    function close(restoreFocus = true) {
      if (closed) return;
      closed = true; clearInterval(watch); release();
      removeEventListener('pagehide',onPageHide);
      dialog.close(); dialog.remove(); active = null;
      if (restoreFocus && current() && focus?.isConnected) focus.focus({preventScroll:true});
    }
    const onPageHide = () => close(false);
    active = {close,current,actor};
    back.onclick = () => close();
    dialog.oncancel = e => { e.preventDefault(); close(); };
    dialog.onclose = () => close();
    addEventListener('pagehide',onPageHide);
    document.body.append(dialog); dialog.showModal();
    watch = setInterval(() => { if (!current()) close(false); },200);
    try {
      // Start with the view currently displayed; preserve the underlying photo order.
      const ordered = [...captured].sort((a,b) => Number(b.view === selected) - Number(a.view === selected));
      const projected = []; let total = 0;
      for (const p of ordered) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (closed) return;
        if (!current()) { close(false); return; }
        const v = {view:p.view};
        for (const role of ['original','result']) {
          const blob = imageBlob(role === 'original' ? source(p) : p.result); total += blob.size;
          if (total > 40 * 1024 * 1024) throw Error('size');
          const url = URL.createObjectURL(blob); urls.push(url); v[role] = url;
        }
        projected.push(v);
      }
      if (!current()) { close(false); return; }
      controller = window.MySmyl.mount(host,{views:projected});
    } catch (_) {
      if (closed) return;
      release();
      if (!current()) { close(false); return; }
      const error = node('div','ms-preview-loading'); error.setAttribute('role','status');
      error.append(node('p','','No pudimos abrir estas fotos en mySmyl. Tu simulación sigue disponible y no se ha compartido.'));
      const retry = node('button','ms-primary','Reintentar'); retry.type = 'button';
      retry.onclick = () => { close(false); openPreview(); };
      error.append(retry); host.replaceChildren(error);
    }
  }
  function init() {
    const entry = $('pc-save-entry')?.parentElement; if (!entry) return;
    const launch = node('button','flow-secondary','Ver en mySmyl'); launch.id = 'ms-studio-open'; launch.type = 'button';
    launch.setAttribute('aria-haspopup','dialog'); launch.onclick = openPreview; entry.append(launch); entry.classList.add('ms-studio-entry');
    const refresh = () => {
      launch.hidden = !professional() || !pairs().length;
      launch.disabled = !available();
      if (active && !active.current()) active.close(false);
    };
    const previous = window.renderControlCalidadSimulacion;
    window.renderControlCalidadSimulacion = function () { const result = previous.apply(this,arguments); refresh(); return result; };
    const observer = new MutationObserver(refresh);
    for (const id of ['s-res','ba-wrap']) observer.observe($(id),{attributes:true,attributeFilter:['class']});
    // Auth belongs to the existing simulator; observing it does not request a session.
    window.sbAuth?.auth?.onAuthStateChange((event,session) => {
      if (active && (event === 'SIGNED_OUT' || (session?.user && session.user.id !== active.actor))) active.close(false);
      refresh();
    });
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
