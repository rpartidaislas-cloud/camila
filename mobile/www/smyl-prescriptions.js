/* SMYL · Recetas médicas (LGS art. 240; Reglamento de Insumos para la Salud arts. 28-30).
 * Sección «Recetas» en la historia clínica: lista las emitidas y permite emitir una nueva con medicamentos en
 * denominación genérica, presentación, dosis, vía, frecuencia y duración. Los datos del médico, del consultorio y
 * del paciente los toma el servidor. Se confirma la identidad antes de emitir y se imprime para firma autógrafa.
 * No sirve para medicamentos controlados (grupos I a III). Todo texto entra escapado. */
(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.SmylPrescriptions = api; })(globalThis, function () {
  'use strict';
  var ROUTES = ['Oral', 'Tópica (en la boca)', 'Sublingual', 'Enjuague bucal', 'Intramuscular', 'Intravenosa', 'Otra'];
  var FIELDS = [['generic_name', 'Denominación genérica', 'Ej. Ibuprofeno'], ['brand_name', 'Nombre comercial (opcional)', ''], ['presentation', 'Presentación', 'Ej. Tabletas de 400 mg'], ['dose', 'Dosis', 'Ej. 1 tableta'], ['frequency', 'Frecuencia', 'Ej. Cada 8 horas'], ['duration', 'Duración', 'Ej. 3 días']];

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function fmtDate(v) { try { return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v)); } catch (e) { return String(v); } }

  function validateItem(it) {
    var required = ['generic_name', 'presentation', 'dose', 'route', 'frequency', 'duration'];
    for (var i = 0; i < required.length; i++) if (!it[required[i]] || !String(it[required[i]]).trim()) return 'Completa ' + ({ generic_name: 'la denominación genérica', presentation: 'la presentación', dose: 'la dosis', route: 'la vía', frequency: 'la frecuencia', duration: 'la duración' })[required[i]] + ' de cada medicamento.';
    return '';
  }

  /** HTML imprimible con todos los datos que exige la ley y espacio para la firma autógrafa. */
  function printable(rx) {
    var p = rx.prescriber || {}, c = rx.clinic || {}, pt = rx.patient || {};
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Receta ' + esc(rx.folio) + '</title><style>'
      + 'body{font:13px/1.5 Arial,sans-serif;color:#111;max-width:720px;margin:24px auto;padding:0 20px}header{border-bottom:2px solid #111;padding-bottom:10px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}'
      + 'h1{font-size:18px;margin:0}small{color:#444}.pt{margin:14px 0;display:flex;gap:24px;flex-wrap:wrap}ol{padding-left:20px}li{margin:0 0 10px}.firma{margin-top:56px;width:280px;border-top:1px solid #111;padding-top:6px}'
      + '.void{color:#b91c1c;font-weight:700;font-size:16px;border:2px solid #b91c1c;padding:6px 10px;display:inline-block}footer{margin-top:24px;font-size:11px;color:#555}</style></head><body>'
      + (rx.voided_at ? '<p class="void">RECETA ANULADA el ' + esc(fmtDate(rx.voided_at)) + ' — ' + esc(rx.void_reason) + '</p>' : '')
      + '<header><div><h1>' + esc(p.name) + '</h1><div>Cédula profesional ' + esc(p.license) + ' · ' + esc(p.institution) + '</div>'
      + (p.specialty ? '<div>' + esc(p.specialty) + (p.specialty_license ? ' · Cédula de especialidad ' + esc(p.specialty_license) : '') + '</div>' : '') + '</div>'
      + '<div style="text-align:right"><b>' + esc(c.name) + '</b><br><small>' + esc(c.branch) + '<br>' + esc(c.address) + (c.phone ? '<br>Tel. ' + esc(c.phone) : '') + '</small></div></header>'
      + '<div class="pt"><span><b>Paciente:</b> ' + esc(pt.name) + '</span>' + (pt.age ? '<span><b>Edad:</b> ' + esc(pt.age) + '</span>' : '') + (pt.sex ? '<span><b>Sexo:</b> ' + esc(pt.sex) + '</span>' : '') + '<span><b>Fecha:</b> ' + esc(fmtDate(rx.issued_at)) + '</span><span><b>Folio:</b> ' + esc(rx.folio) + '</span></div>'
      + '<b>Rx</b><ol>' + (rx.items || []).map(function (it) { return '<li><b>' + esc(it.generic_name) + '</b>' + (it.brand_name ? ' (' + esc(it.brand_name) + ')' : '') + ' — ' + esc(it.presentation) + '<br>' + esc(it.dose) + ', vía ' + esc(String(it.route).toLowerCase()) + ', ' + esc(it.frequency) + ' durante ' + esc(it.duration) + (it.notes ? '<br><small>' + esc(it.notes) + '</small>' : '') + '</li>'; }).join('') + '</ol>'
      + (rx.instructions ? '<p><b>Indicaciones:</b> ' + esc(rx.instructions) + '</p>' : '')
      + '<div class="firma">Firma del médico</div>'
      + '<footer>Huella del documento (SHA-256): ' + esc(rx.document_sha256) + '</footer></body></html>';
  }

  /* ── Navegador ── */
  function rpc(name, args) { return globalThis.sb.rpc(name, args).then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function errText(err) {
    var msg = String(err && err.message || ''), code = err && err.code;
    if (/PGRST202|42883|schema cache/i.test(code + ' ' + msg)) return 'Falta aplicar la migración de recetas en la base de datos.';
    return msg || 'No se pudo completar. Intenta de nuevo.';
  }
  function print(rx) {
    var w = window.open('', '_blank');
    if (!w) { window.alert('Permite las ventanas emergentes para imprimir la receta.'); return; }
    w.document.open(); w.document.write(printable(rx)); w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
  }

  function itemHtml(i) {
    return '<fieldset class="rx-item" data-i="' + i + '"><legend>Medicamento ' + (i + 1) + '</legend><div class="rx-grid">'
      + FIELDS.map(function (f) { return '<label>' + f[1] + '<input name="' + f[0] + '" maxlength="160" placeholder="' + esc(f[2]) + '"></label>'; }).join('')
      + '<label>Vía<select name="route">' + ROUTES.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></label>'
      + '<label class="rx-wide">Notas (opcional)<input name="notes" maxlength="500"></label></div>'
      + (i ? '<button type="button" class="rx-remove">Quitar</button>' : '') + '</fieldset>';
  }

  async function openNew(o) {
    var doc = document, d = doc.createElement('dialog'); d.className = 'ic-dialog rx-dialog';
    var branches = [];
    try { var r = await globalThis.sb.from('smyl_branches').select('id,name,address_line,is_default').eq('tenant_id', o.tenant).eq('active', true).order('is_default', { ascending: false }); branches = r.data || []; } catch (e) { branches = []; }
    d.innerHTML = '<form class="ic-box"><header><h2>Nueva receta</h2><button type="button" class="ic-x" aria-label="Cerrar">×</button></header>'
      + '<p class="ic-help">Escribe cada medicamento con su denominación genérica. Tu nombre, cédula, institución y el domicilio del consultorio se agregan solos. <b>No uses esta receta para medicamentos controlados</b>: requieren recetario especial.</p>'
      + '<label>Consultorio<select name="branch">' + branches.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.name) + (b.address_line ? '' : ' (sin domicilio)') + '</option>'; }).join('') + '</select></label>'
      + '<div class="rx-items">' + itemHtml(0) + '</div><button type="button" class="rx-add">+ Agregar otro medicamento</button>'
      + '<label>Indicaciones generales (opcional)<textarea name="instructions" rows="2" maxlength="3000"></textarea></label>'
      + '<p class="ic-feedback" role="status"></p>'
      + '<div class="ic-actions"><button type="button" class="btn btn-secondary ic-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Emitir e imprimir</button></div></form>';
    doc.body.append(d);
    var form = d.querySelector('form'), list = d.querySelector('.rx-items'), feedback = d.querySelector('.ic-feedback');
    function close() { try { d.close(); } catch (e) {} d.remove(); }
    d.querySelector('.ic-x').onclick = close; d.querySelector('.ic-cancel').onclick = close;
    d.querySelector('.rx-add').onclick = function () { var n = list.querySelectorAll('.rx-item').length; if (n >= 12) return; list.insertAdjacentHTML('beforeend', itemHtml(n)); };
    form.addEventListener('input', function () { feedback.textContent = ''; });
    list.addEventListener('click', function (e) { if (e.target.classList.contains('rx-remove')) e.target.closest('.rx-item').remove(); });
    form.onsubmit = async function (e) {
      e.preventDefault();
      if (!branches.length) { feedback.textContent = 'Registra una sucursal con domicilio en Configuración.'; return; }
      var items = Array.prototype.map.call(list.querySelectorAll('.rx-item'), function (fs) { var it = {}; fs.querySelectorAll('input,select').forEach(function (x) { it[x.name] = x.value.trim(); }); return it; });
      for (var i = 0; i < items.length; i++) { var p = validateItem(items[i]); if (p) { feedback.textContent = p; return; } }
      var submit = form.querySelector('[type=submit]'); submit.disabled = true; feedback.textContent = '';
      try {
        if (globalThis.SmylAuthGuard && !(await globalThis.SmylAuthGuard.reauthenticate(globalThis.sb, 'emitir la receta'))) { submit.disabled = false; return; }
        var rx = await rpc('smyl_issue_prescription', { p_patient_id: o.patient, p_branch_id: form.branch.value, p_items: items, p_instructions: form.instructions.value.trim() });
        close(); print(rx); if (o.refresh) o.refresh();
      } catch (err) { feedback.textContent = errText(err); submit.disabled = false; }
    };
    d.showModal();
  }

  function render(rows, number, canAct) {
    var list = rows === null ? '<p class="ic-empty">No se pudieron consultar las recetas.</p>'
      : !rows.length ? '<p class="ic-empty">Aún no hay recetas emitidas.</p>'
      : '<ul class="ic-list">' + rows.map(function (r) {
        return '<li data-state="' + (r.voided_at ? 'revoked' : 'ok') + '"><div><b>Folio ' + esc(r.folio) + ' · ' + esc((r.items || []).map(function (it) { return it.generic_name; }).join(', ')) + '</b><small>' + esc(fmtDate(r.issued_at)) + ' · ' + esc((r.prescriber || {}).name) + ' (Céd. ' + esc((r.prescriber || {}).license) + ')' + (r.voided_at ? ' · Anulada: ' + esc(r.void_reason) : '') + '</small></div>'
          + '<div class="ic-li-acts"><button type="button" class="p360-hc-edit" data-rx-print="' + esc(r.id) + '">Imprimir</button>' + (canAct && !r.voided_at ? '<button type="button" class="p360-hc-edit" data-rx-void="' + esc(r.id) + '">Anular</button>' : '') + '</div></li>';
      }).join('') + '</ul>';
    return '<section class="p360-hc-band" id="p360-hc-rx" data-tone="rx" tabindex="-1" aria-labelledby="p360-hc-rx-t">'
      + '<header class="p360-hc-band-h"><div class="p360-hc-title"><span class="p360-hc-num" aria-hidden="true">' + Number(number) + '</span><div><h3 id="p360-hc-rx-t">Recetas</h3><small>Emitidas con los datos que exige la ley; se imprimen para firma.</small></div></div>'
      + (canAct ? '<div class="pp-actions"><button type="button" class="p360-hc-edit" data-rx-new>Nueva receta</button></div>' : '') + '</header>' + list + '</section>';
  }

  function mount(o) {
    var doc = globalThis.document;
    if (!o || !o.host || !globalThis.sb || !doc) return Promise.resolve(false);
    var host = o.host, main = host.querySelector('.p360-hc-main'), index = host.querySelector('.p360-hc-index');
    if (!main || !index) return Promise.resolve(false);
    o.refresh = function () { var b = host.querySelector('#p360-hc-rx'), g = host.querySelector('[data-hc-goto="rx"]'); if (b) b.remove(); if (g) g.remove(); mount(o); };
    return rpc('smyl_list_prescriptions', { p_patient_id: o.patient }).catch(function () { return null; }).then(function (rows) {
      if (o.isCurrent && !o.isCurrent()) return false;
      if (!host.isConnected || host.querySelector('#p360-hc-rx')) return false;
      var number = host.querySelectorAll('.p360-hc-band').length + 1, tpl = doc.createElement('template');
      tpl.innerHTML = render(rows, number, !!o.canAct);
      main.insertBefore(tpl.content, main.querySelector('.p360-hc-footer') || null);
      var itpl = doc.createElement('template');
      itpl.innerHTML = '<button type="button" data-hc-goto="rx"><span class="p360-hc-dot" data-state="neutral" aria-hidden="true"></span>' + number + ' · Recetas</button>';
      index.insertBefore(itpl.content, index.querySelector('.p360-hc-progress') || null);
      var band = host.querySelector('#p360-hc-rx');
      index.querySelector('[data-hc-goto="rx"]').onclick = function () { band.scrollIntoView({ block: 'start' }); band.focus({ preventScroll: true }); };
      var add = band.querySelector('[data-rx-new]'); if (add) add.onclick = function () { openNew(o); };
      band.querySelectorAll('[data-rx-print]').forEach(function (b) { b.onclick = function () { var rx = (rows || []).find(function (r) { return r.id === b.dataset.rxPrint; }); if (rx) print(rx); }; });
      band.querySelectorAll('[data-rx-void]').forEach(function (b) { b.onclick = function () { var reason = window.prompt('¿Por qué se anula esta receta?'); if (!reason) return; rpc('smyl_void_prescription', { p_id: b.dataset.rxVoid, p_reason: reason }).then(o.refresh, function (e) { window.alert(errText(e)); }); }; });
      return true;
    });
  }

  return { ROUTES: ROUTES, validateItem: validateItem, printable: printable, render: render, mount: mount, esc: esc };
});
