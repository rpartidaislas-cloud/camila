/* SMYL · Skeletons de carga (asistente compartido). Estilos: smyl-skeleton.css.
   Uso:
     host.innerHTML = SmylSkeleton.html('list', { rows: 6, label: 'Cargando pacientes' });   // HTML listo para innerHTML
     var node = SmylSkeleton.node('cards', { count: 4, label: 'Cargando propuestas' });        // elemento DOM
     SmylSkeleton.busy(page, true);                                                            // aria-busy mientras carga
   Tipos: list, cards, kpis, table, form, detail, calendar, media, chart, text, panel.
   Lo decorativo va aria-hidden; cada región es role="status" con el texto «Cargando…» solo para lectores de pantalla. */
(function () {
  'use strict';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(value, fallback, max) { var v = parseInt(value, 10); if (!(v > 0)) v = fallback; return Math.min(v, max || 24); }
  function line(width, size) { return '<span class="sk sk-line' + (size ? ' is-' + size : '') + (width ? ' w-' + width : '') + '"></span>'; }
  function repeat(count, make) { var out = ''; for (var i = 0; i < count; i += 1) out += make(i); return out; }
  var WIDTHS = [60, 40, 70, 50, 80, 30];

  var BUILDERS = {
    // Filas con avatar y dos líneas (pacientes, conversaciones, versiones, pendientes…).
    list: function (o) {
      return '<div class="sk-list' + (o.plain ? ' is-plain' : '') + '">' + repeat(n(o.rows, 5), function (i) {
        return '<div class="sk-list-item">' + (o.avatar === false ? '' : '<span class="sk sk-circle"></span>') + '<div class="sk-stack">' + line(WIDTHS[i % 6]) + line(WIDTHS[(i + 2) % 6] > 50 ? 30 : 50) + '</div>' + (o.action ? '<span class="sk sk-chip"></span>' : '') + '</div>';
      }) + '</div>';
    },
    // Tarjetas en cuadrícula (propuestas, simulaciones, plantillas, servicios…).
    cards: function (o) {
      return '<div class="sk-cards">' + repeat(n(o.count, 6), function (i) {
        return '<div class="sk-card">' + (o.media ? '<span class="sk sk-block"></span>' : '') + line(70, 'lg') + line(100) + line(WIDTHS[i % 6] + 10 > 100 ? 90 : WIDTHS[i % 6] + 10) + '<div class="sk-row"><span class="sk sk-chip"></span><span class="sk sk-chip"></span></div></div>';
      }) + '</div>';
    },
    // Tarjetas de cifras (Inicio, Cobros, Inventario).
    kpis: function (o) {
      return '<div class="sk-kpis">' + repeat(n(o.count, 4), function () { return '<div class="sk-kpi">' + line(40) + line(60, 'xl') + line(30) + '</div>'; }) + '</div>';
    },
    // Tabla con encabezado (Pagos, Facturación, Equipo, Catálogo).
    table: function (o) {
      var cols = n(o.cols, 4, 8);
      var cell = function (i) { return line(i === 0 ? 70 : (WIDTHS[i % 6] > 50 ? 60 : 40)); };
      return '<div class="sk-table" style="--sk-cols:' + cols + '">' + repeat(n(o.rows, 6) + 1, function () { return '<div class="sk-table-row">' + repeat(cols, cell) + '</div>'; }) + '</div>';
    },
    // Formulario (ajustes, datos fiscales, perfil).
    form: function (o) {
      return '<div class="sk-form">' + repeat(n(o.fields, 5), function (i) { return '<div class="sk-field">' + line(i % 2 ? 20 : 30) + '<span class="sk sk-block"></span></div>'; }) + '<div class="sk-row"><span class="sk sk-btn"></span><span class="sk sk-btn"></span></div></div>';
    },
    // Detalle de una persona o documento (expediente, ficha, caso).
    detail: function () {
      return '<div class="sk-detail"><div class="sk-detail-head"><span class="sk sk-circle is-lg"></span><div class="sk-stack" style="flex:1">' + line(40, 'lg') + line(60) + '</div></div>' +
        '<div class="sk-kpis">' + repeat(3, function () { return '<div class="sk-kpi">' + line(50) + line(70, 'lg') + '</div>'; }) + '</div>' +
        '<div class="sk-stack">' + line(30, 'lg') + line(100) + line(90) + line(70) + '</div></div>';
    },
    // Agenda / calendario mensual.
    calendar: function (o) {
      return '<div class="sk-calendar"><div class="sk-calendar-head">' + line(30, 'lg') + '<div class="sk-row"><span class="sk sk-btn"></span><span class="sk sk-btn"></span></div></div>' +
        '<div class="sk-calendar-grid">' + repeat(n(o.cells, 35, 42), function () { return '<span class="sk"></span>'; }) + '</div></div>';
    },
    // Galería de imágenes (simulaciones, evidencias, radiografías).
    media: function (o) { return '<div class="sk-media">' + repeat(n(o.count, 8), function () { return '<span class="sk"></span>'; }) + '</div>'; },
    // Gráfica de barras.
    chart: function (o) {
      var heights = [45, 70, 55, 85, 60, 90, 50, 75];
      return '<div class="sk-chart">' + repeat(n(o.bars, 8), function (i) { return '<span class="sk" style="height:' + heights[i % 8] + '%"></span>'; }) + '</div>';
    },
    // Párrafo corto (un aviso, un texto, un resumen).
    text: function (o) {
      return '<div class="sk-stack">' + repeat(n(o.lines, 3), function (i, count) { return line(i === n(o.lines, 3) - 1 ? 60 : 100); }) + '</div>';
    },
    // Panel con título y contenido corto (tarjetas laterales, secciones plegables).
    panel: function (o) {
      return '<div class="sk-card">' + line(40, 'lg') + repeat(n(o.lines, 3), function (i) { return line(i % 2 ? 80 : 100); }) + '</div>';
    }
  };

  function html(kind, options) {
    var o = options || {}, build = BUILDERS[kind] || BUILDERS.text, label = o.label || 'Cargando…';
    return '<div class="sk-region" role="status" aria-live="polite" data-skeleton="' + esc(kind) + '"><span class="sk-sr">' + esc(label) + '</span><div aria-hidden="true">' + build(o) + '</div></div>';
  }
  function node(kind, options) {
    var holder = document.createElement('div'); holder.innerHTML = html(kind, options); return holder.firstElementChild;
  }
  // Marca una pantalla o bloque como «ocupado» mientras carga (para lectores de pantalla y estilos).
  function busy(element, on) {
    if (!element) return;
    if (on) element.setAttribute('aria-busy', 'true'); else element.removeAttribute('aria-busy');
  }
  window.SmylSkeleton = Object.freeze({ html: html, node: node, busy: busy, kinds: Object.freeze(Object.keys(BUILDERS)) });
})();
