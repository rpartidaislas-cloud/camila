/* SMYL · Almacenamiento: cuánto espacio usan las fotos, radiografías y documentos de la clínica.
   Solo lee el resumen que calcula el servidor (smyl_storage_usage). No sube, borra ni mueve archivos. */
(function (root, factory) {
  var api = factory(typeof window !== 'undefined' ? window : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylStorage = api;
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  var CATEGORIES = {
    'smyl-clinical-files': { label: 'Expediente clínico', color: '#142bc3' },
    'smyl-radiographs': { label: 'Radiografías', color: '#7C5CD6' },
    'smyl-case-photos': { label: 'Fotos y simulaciones', color: '#E0961B' },
    'smyl-proposal-photos': { label: 'Propuestas', color: '#2F6BD0' },
    'smyl-professional-cv': { label: 'Directorio profesional', color: '#8B9AAB' },
    'smyl-professional-cases': { label: 'Directorio profesional', color: '#8B9AAB' }
  };
  var state = { data: null, loading: false, error: '', tenant: null, saving: false };

  function formatBytes(value) {
    var bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    if (bytes < 1073741824) { var mb = bytes / 1048576; return (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB'; }
    var gb = bytes / 1073741824; return (Math.round(gb * 100) / 100) + ' GB';
  }

  // Avisos al 80 % y al 95 %; al 100 % se pausa solo el guardado nuevo (nunca se pierde un archivo recibido por chat).
  function level(used, limit) {
    if (!limit || limit <= 0) return { id: 'unknown', pct: null };
    var pct = (used / limit) * 100;
    return { id: pct >= 100 ? 'full' : pct >= 95 ? 'critical' : pct >= 80 ? 'warning' : 'ok', pct: pct };
  }

  // Une categorías que comparten etiqueta (p. ej. los dos buckets del directorio profesional).
  function groupCategories(rows) {
    var merged = {};
    (rows || []).forEach(function (row) {
      var meta = CATEGORIES[row.bucket] || { label: 'Otros', color: '#B7C4D1' };
      var entry = merged[meta.label] || (merged[meta.label] = { label: meta.label, color: meta.color, bytes: 0, files: 0 });
      entry.bytes += Number(row.bytes) || 0; entry.files += Number(row.files) || 0;
    });
    return Object.keys(merged).map(function (key) { return merged[key]; }).sort(function (a, b) { return b.bytes - a.bytes; });
  }

  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined && text !== null && text !== '') node.textContent = text; return node; }

  function banner(info) {
    var copy = {
      warning: ['Estás cerca del límite', 'Ya usas más del 80 % de tu espacio. Revisa los archivos más pesados o amplía tu plan antes de llenarlo.'],
      critical: ['Casi sin espacio', 'Ya usas más del 95 % de tu espacio. Libera espacio o amplía tu plan para no interrumpir el guardado en el expediente.'],
      full: ['Espacio lleno', 'El guardado nuevo en el expediente está en pausa. Los archivos que llegan por el chat no se pierden. Libera espacio o amplía tu plan.']
    }[info.id];
    if (!copy) return null;
    var box = el('div', 'storage-banner is-' + info.id); box.setAttribute('role', info.id === 'warning' ? 'status' : 'alert');
    box.append(el('strong', '', copy[0]), el('p', '', copy[1]));
    return box;
  }

  function render() {
    var host = document.getElementById('storage-content'); if (!host) return;
    host.innerHTML = '';
    if (state.loading && !state.data) { host.append(el('p', 'storage-note', 'Midiendo el espacio de tu clínica…')); return; }
    if (state.error) {
      var box = el('div', 'storage-note is-warn'); box.setAttribute('role', 'alert'); box.append(el('p', '', state.error));
      var retry = el('button', 'btn btn-secondary btn-sm', 'Reintentar'); retry.type = 'button'; retry.onclick = function () { load(true); }; box.append(retry); host.append(box); return;
    }
    var data = state.data; if (!data) return;
    var used = Number(data.used_bytes) || 0; var limit = data.limit_bytes ? Number(data.limit_bytes) : 0; var info = level(used, limit);
    if (data.alerts_enabled !== false) { var alert = banner(info); if (alert) host.append(alert); }

    var card = el('section', 'storage-card');
    var head = el('div', 'storage-head');
    var figure = el('div', 'storage-figure'); figure.append(el('strong', '', formatBytes(used)), el('span', '', limit ? 'de ' + formatBytes(limit) : 'usados'));
    head.append(figure);
    head.append(el('span', 'storage-plan' + (limit ? ' is-' + info.id : ' is-undefined'), limit ? Math.min(100, Math.round(info.pct)) + ' % usado' : 'Límite del plan sin definir'));
    card.append(head);

    var groups = groupCategories(data.categories);
    var bar = el('div', 'storage-bar'); bar.setAttribute('role', 'img');
    var total = limit || used || 1;
    bar.setAttribute('aria-label', 'Uso por categoría: ' + (groups.map(function (g) { return g.label + ' ' + formatBytes(g.bytes); }).join(', ') || 'sin archivos'));
    groups.forEach(function (group) { var seg = el('i'); seg.style.width = Math.max(0.5, (group.bytes / total) * 100) + '%'; seg.style.background = group.color; bar.append(seg); });
    card.append(bar);

    var legend = el('ul', 'storage-legend');
    if (!groups.length) legend.append(el('li', 'storage-empty', 'Todavía no hay archivos guardados.'));
    groups.forEach(function (group) {
      var item = el('li'); var dot = el('i'); dot.style.background = group.color; dot.setAttribute('aria-hidden', 'true');
      item.append(dot, el('span', '', group.label), el('b', '', formatBytes(group.bytes))); legend.append(item);
    });
    if (limit) { var free = el('li'); var freeDot = el('i'); freeDot.className = 'is-free'; freeDot.setAttribute('aria-hidden', 'true'); free.append(freeDot, el('span', '', 'Disponible'), el('b', '', formatBytes(Math.max(0, limit - used)))); legend.append(free); }
    card.append(legend);
    host.append(card);

    var patients = data.top_patients || [];
    if (patients.length) {
      var section = el('section', 'storage-card'); section.append(el('h2', '', 'Pacientes que más ocupan'));
      var peak = Number(patients[0].bytes) || 1; var list = el('ul', 'storage-patients');
      patients.forEach(function (row) {
        var item = el('li'); item.append(el('span', '', row.name || 'Paciente'));
        var track = el('div', 'storage-track'); var fill = el('i'); fill.style.width = Math.max(3, (Number(row.bytes) / peak) * 100) + '%'; track.append(fill);
        item.append(track, el('b', '', formatBytes(row.bytes))); list.append(item);
      });
      section.append(list); host.append(section);
    }

    var prefs = el('section', 'storage-card');
    var label = el('label', 'storage-switch'); var input = document.createElement('input'); input.type = 'checkbox'; input.checked = data.alerts_enabled !== false; input.disabled = state.saving;
    input.onchange = function () { saveAlerts(input.checked); };
    label.append(input, el('span', '', 'Avisarme al llegar al 80 % y al 95 %')); prefs.append(label);
    host.append(prefs);

    var policy = el('div', 'storage-info');
    policy.append(el('strong', '', 'Si se llena el espacio'), el('p', '', 'Seguirás recibiendo los archivos que los pacientes manden por chat; no se pierden. Lo que se pausa es guardar archivos nuevos en el expediente hasta que liberes espacio o cambies de plan.'));
    host.append(policy);
    host.append(el('p', 'storage-fine', 'Se cuenta lo guardado en SMYL: expediente, radiografías, fotos y simulaciones, propuestas y directorio. Un archivo recibido por chat se suma cuando lo guardas en el expediente.'));
  }

  function friendly(error) {
    var code = error && (error.code || ''); var message = String(error && error.message || '');
    if (code === '42501') return 'Solo quien administra la clínica puede ver el almacenamiento.';
    if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(message)) return 'La medición de almacenamiento todavía no está activada en esta clínica.';
    return 'No se pudo medir el almacenamiento. Intenta de nuevo.';
  }

  async function load(force) {
    if (!win || !win.sb || !win.tenantId || state.loading) return;
    if (!force && state.data && state.tenant === win.tenantId) return;
    state.loading = true; state.tenant = win.tenantId; state.error = ''; render();
    try {
      var result = await win.sb.rpc('smyl_storage_usage');
      if (result.error) throw result.error;
      state.data = result.data;
    } catch (error) { state.error = friendly(error); }
    finally { state.loading = false; render(); }
  }

  async function saveAlerts(enabled) {
    if (state.saving || !state.data) return;
    state.saving = true; var previous = state.data.alerts_enabled; state.data.alerts_enabled = enabled; render();
    try {
      var result = await win.sb.rpc('smyl_storage_set_alerts', { p_enabled: enabled });
      if (result.error) throw result.error;
    } catch (error) { state.data.alerts_enabled = previous; state.error = friendly(error); }
    finally { state.saving = false; render(); }
  }

  function build() {
    var page = el('section', 'pantalla storage-page'); page.id = 'p-almacenamiento';
    var head = el('header', 'storage-page-head');
    var copy = el('div'); copy.append(el('span', 'pro-eyebrow', 'CONFIGURACIÓN · CUENTA'), el('h1', '', 'Almacenamiento'), el('p', '', 'Espacio que usan las fotos, radiografías y documentos de tu clínica.'));
    var refresh = el('button', 'btn btn-secondary', 'Actualizar'); refresh.type = 'button'; refresh.onclick = function () { load(true); };
    head.append(copy, refresh); page.append(head);
    var content = el('div', 'storage-content'); content.id = 'storage-content'; content.setAttribute('aria-live', 'polite'); page.append(content);
    var host = document.querySelector('.contenido'); if (host) host.append(page);
  }

  function init() {
    if (!win || !win.ir || document.getElementById('p-almacenamiento')) return;
    if (win.TITULOS) win.TITULOS.almacenamiento = 'Almacenamiento';
    build();
    var previous = win.ir;
    win.ir = function (route) { var result = previous(route); if (route === 'almacenamiento') load(false); return result; };
  }

  if (win && win.document) { if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', init); else init(); }
  return { formatBytes: formatBytes, level: level, groupCategories: groupCategories, CATEGORIES: CATEGORIES };
});
