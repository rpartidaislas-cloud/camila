/* SMYL · Privacidad en la historia clínica del paciente: sección «6 · Privacidad» con el aviso firmado, las tres decisiones
 * (IA, WhatsApp, promociones) y las solicitudes ARCO abiertas. Las reglas (model/render) son puras; mount() lee con las
 * funciones de la base (smyl_patient_consent_status, smyl_patient_privacy_status) y dibuja la sección junto a las demás.
 * Textos del paciente y del servidor entran siempre escapados. */
(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.SmylPatientPrivacyPanel = api; })(globalThis, function () {
  'use strict';
  var PURPOSES = [['ai_processing', 'Inteligencia artificial'], ['whatsapp', 'WhatsApp'], ['marketing', 'Promociones']];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function noticeRow(consent, fmt) {
    if (consent === undefined || consent === null) return { label: 'Aviso de privacidad', text: 'No se pudo comprobar.', state: 'empty', badge: '' };
    if (consent.signed) {
      var when = consent.signed_at ? (fmt ? fmt(consent.signed_at) : String(consent.signed_at)) : '';
      var line = 'Firmado' + (when ? ' el ' + when : '') + (consent.signer_name ? ' por ' + consent.signer_name : '') + (consent.signer_relation === 'guardian' ? ' (tutor)' : '') + '.';
      return { label: 'Aviso de privacidad', lines: [line, 'Versión ' + (consent.notice_version || '—') + (consent.provisional ? ' · texto modelo provisional' : '')], state: 'ok', badge: 'Firmado' };
    }
    return { label: 'Aviso de privacidad', text: 'Aún no ha firmado el aviso.', state: 'pending', badge: 'Por firmar' };
  }
  function decisionRow(purpose, label, info) {
    var s = info && info.state;
    if (s === 'granted') return { label: label, text: 'Sí acepta', state: 'ok', badge: 'Aceptó' };
    if (s === 'revoked') return { label: label, text: purpose === 'ai_processing' ? 'No acepta. La IA no procesará sus datos.' : 'No acepta.', state: 'alert', badge: 'No acepta' };
    if (s === 'unknown') return { label: label, text: purpose === 'ai_processing' ? 'Aún no lo autoriza. La IA no procesará sus datos hasta que lo autorice.' : 'Aún no ha decidido.', state: 'pending', badge: 'Sin decidir' };
    return { label: label, text: 'No se pudo comprobar.', state: 'empty', badge: '' };
  }
  /* consent: undefined/null = no se pudo leer; privacy: objeto por finalidad o null; openRequests: número o null. */
  function model(input, fmt) {
    input = input || {};
    var rows = [noticeRow(input.consent, fmt)], privacy = input.privacy || null;
    PURPOSES.forEach(function (p) { rows.push(decisionRow(p[0], p[1], privacy ? privacy[p[0]] : null)); });
    var open = Number(input.openRequests) || 0;
    if (open > 0) rows.push({ label: 'Solicitudes de derechos', text: open + (open === 1 ? ' solicitud abierta' : ' solicitudes abiertas'), state: 'pending', badge: 'Abierta' });
    var pending = rows.some(function (r) { return r.state === 'pending'; });
    var signed = !!(input.consent && input.consent.signed);
    return { rows: rows, signed: signed, state: pending ? 'pending' : rows.some(function (r) { return r.state === 'empty'; }) ? 'neutral' : 'ok', missing: signed ? '' : 'Aviso de privacidad', hasOpenRequests: open > 0 };
  }
  function rowHtml(row) {
    var lines = Array.isArray(row.lines) && row.lines.length ? row.lines : [row.text || ''];
    return '<div class="p360-hc-row" data-state="' + esc(row.state) + '"><dt>' + esc(row.label) + '</dt><dd class="p360-hc-v">' + lines.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</dd><dd class="p360-hc-st">' + (row.badge ? '<b>' + esc(row.badge) + '</b>' : '') + '</dd></div>';
  }
  /* number = posición en el índice (6). actions: { link, screen } según permisos. */
  function render(m, number, actions) {
    actions = actions || {};
    var btns = '';
    if (!m.signed && actions.link) btns += '<button type="button" class="p360-hc-edit" data-hp-link>Enviar al celular</button>';
    if (!m.signed && actions.screen) btns += '<button type="button" class="p360-hc-edit" data-hp-screen>Firmar en pantalla</button>';
    if (m.hasOpenRequests && actions.requests) btns += '<button type="button" class="p360-hc-edit" data-hp-requests>Ver solicitudes</button>';
    return '<section class="p360-hc-band" id="p360-hc-privacy" data-tone="privacy" data-state="' + esc(m.state) + '" tabindex="-1" aria-labelledby="p360-hc-privacy-t">'
      + '<header class="p360-hc-band-h"><div class="p360-hc-title"><span class="p360-hc-num" aria-hidden="true">' + Number(number) + '</span><div><h3 id="p360-hc-privacy-t">Privacidad y consentimientos</h3><small>Aviso firmado y lo que el paciente permite hacer con sus datos.</small></div></div><div class="pp-actions">' + btns + '</div></header>'
      + '<dl class="p360-hc-rows">' + m.rows.map(rowHtml).join('') + '</dl></section>';
  }
  function indexButton(number, m) {
    return '<button type="button" data-hc-goto="privacy"><span class="p360-hc-dot" data-state="' + esc(m.state === 'neutral' ? 'neutral' : m.state) + '" aria-hidden="true"></span>' + Number(number) + ' · Privacidad</button>';
  }

  /* ── Navegador ── */
  function mount(o) {
    var win = globalThis, doc = win.document;
    if (!o || !o.host || !win.sb || !doc) return Promise.resolve(false);
    var host = o.host, main = host.querySelector('.p360-hc-main'), index = host.querySelector('.p360-hc-index');
    if (!main || !index) return Promise.resolve(false);
    var count = host.querySelectorAll('.p360-hc-band').length;
    o.refresh = function () {
      var band = host.querySelector('#p360-hc-privacy'), btn = host.querySelector('[data-hc-goto="privacy"]');
      if (band) band.remove(); if (btn) btn.remove();
      host.querySelectorAll('.pp-missing').forEach(function (x) { x.remove(); });
      mount(o);
    };
    function rpc(name, args) { return win.sb.rpc(name, args).then(function (r) { if (r.error) throw r.error; return r.data; }); }
    function fmt(v) { try { return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v)); } catch (e) { return String(v); } }
    return Promise.all([
      rpc('smyl_patient_consent_status', { p_patient_id: o.patient }).catch(function () { return undefined; }),
      rpc('smyl_patient_privacy_status', { p_patient_id: o.patient }).catch(function () { return null; }),
      win.sb.from('smyl_data_rights_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', o.tenant).eq('patient_id', o.patient).in('status', ['received', 'in_review']).then(function (r) { return r.error ? null : r.count; }, function () { return null; })
    ]).then(function (res) {
      if (o.isCurrent && !o.isCurrent()) return false;
      if (!host.isConnected || host.querySelector('#p360-hc-privacy')) return false;
      var m = model({ consent: res[0], privacy: res[1], openRequests: res[2] }, fmt), number = count + 1;
      var tpl = doc.createElement('template');
      tpl.innerHTML = render(m, number, { link: !!o.canAct, screen: !!o.canAct && !!(win.SmylConsultorio && win.ir), requests: true });
      var footer = main.querySelector('.p360-hc-footer');
      main.insertBefore(tpl.content, footer || null);
      var progress = index.querySelector('.p360-hc-progress'), itpl = doc.createElement('template');
      itpl.innerHTML = indexButton(number, m);
      index.insertBefore(itpl.content, progress || null);
      var gotoBtn = index.querySelector('[data-hc-goto="privacy"]'), band = host.querySelector('#p360-hc-privacy');
      gotoBtn.onclick = function () { var reduced = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches; band.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); band.focus({ preventScroll: true }); };
      if (m.missing && progress) { var line = doc.createElement('span'); line.className = 'p360-hc-missing pp-missing'; line.textContent = 'Falta firmar: ' + m.missing + '.'; progress.append(line); }
      var link = band.querySelector('[data-hp-link]'), screen = band.querySelector('[data-hp-screen]'), reqs = band.querySelector('[data-hp-requests]');
      if (link) link.onclick = function () { openLink(o, link); };
      if (screen) screen.onclick = function () { win.ir('consultorio'); win.SmylConsultorio.openVisit(o.patient); };
      if (reqs) reqs.onclick = function () { if (typeof win.ir === 'function') win.ir('privacidad'); };
      return true;
    });
  }

  /* Enlace de firma para el celular del paciente: mismo enlace de un solo uso (48 h) que ofrece Consultorio. */
  function openLink(o, button) {
    var win = globalThis, doc = win.document;
    var d = doc.createElement('dialog'); d.className = 'pp-dialog';
    var box = doc.createElement('div'); box.className = 'pp-box';
    var head = doc.createElement('header'), h = doc.createElement('h2'), x = doc.createElement('button');
    h.textContent = 'Que firme desde su celular'; x.type = 'button'; x.className = 'pp-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Cerrar');
    head.append(h, x); box.append(head);
    var body = doc.createElement('div'); body.textContent = 'Preparando el enlace…'; box.append(body); d.append(box);
    function close() { try { d.close(); } catch (e) {} d.remove(); if (button && button.focus) button.focus(); }
    x.onclick = close; d.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    doc.body.append(d); d.showModal();
    win.sb.rpc('smyl_create_consent_link', { p_patient_id: o.patient }).then(function (r) {
      if (r.error) throw r.error;
      var token = String(r.data || '');
      if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('Respuesta inesperada.');
      var url = win.location.origin + win.location.pathname.replace(/[^/]*$/, '') + 'aviso-firma.html?token=' + encodeURIComponent(token);
      body.replaceChildren();
      var qr = doc.createElement('div'); qr.className = 'pp-qr'; qr.setAttribute('role', 'img'); qr.setAttribute('aria-label', 'Código QR para firmar el aviso de privacidad');
      var svg = '';
      if (typeof win.qrcode === 'function') { try { var c = win.qrcode(0, 'M'); c.addData(url); c.make(); svg = c.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { svg = ''; } }
      if (svg) qr.innerHTML = svg; else qr.textContent = 'Usa el enlace de abajo.';
      var cap = doc.createElement('p'); cap.className = 'pp-cap'; cap.textContent = 'Escanéalo con la cámara del celular';
      var status = doc.createElement('p'); status.className = 'pp-status'; status.setAttribute('role', 'status'); status.textContent = 'Esperando su firma…';
      var field = doc.createElement('input'); field.readOnly = true; field.value = url; field.className = 'pp-link'; field.setAttribute('aria-label', 'Enlace para firmar el aviso'); field.onfocus = function () { field.select(); };
      var more = doc.createElement('details'), sum = doc.createElement('summary'); sum.textContent = 'Ver el enlace'; more.append(sum, field);
      var hint = doc.createElement('p'); hint.className = 'pp-hint'; hint.textContent = 'El enlace sirve una sola vez y vence en 48 horas. Si generas otro, el anterior deja de servir.';
      var acts = doc.createElement('div'); acts.className = 'pp-acts';
      var quick = win.SmylPatientQuick, wa = quick && o.phone ? quick.whatsappUrl(o.phone, 'Hola, antes de tu atención te pedimos leer y firmar nuestro aviso de privacidad desde tu celular (el enlace vence en 48 horas): ' + url) : '';
      function act(text, cls, fn) { var b = doc.createElement('button'); b.type = 'button'; b.className = cls || ''; b.textContent = text; b.onclick = fn; acts.append(b); return b; }
      if (wa) act('Enviarlo por WhatsApp', 'pp-primary', function () { win.open(wa, '_blank', 'noopener'); });
      var copy = act('Copiar enlace', '', function () { var p = win.navigator.clipboard ? win.navigator.clipboard.writeText(url) : Promise.reject(); p.then(function () { copy.textContent = 'Enlace copiado'; }, function () { more.open = true; field.focus(); field.select(); copy.textContent = 'Selecciona y copia el enlace'; }); });
      act('Cerrar', '', close);
      body.append(qr, cap, status, acts, more, hint);
      /* Mientras la ventana está abierta se revisa cada pocos segundos si ya firmó; al cerrar, la sección se actualiza. */
      var polls = 0, signed = false;
      var timer = setInterval(function () {
        if (!d.isConnected) { clearInterval(timer); return; }
        if (++polls > 150) { clearInterval(timer); status.textContent = 'Dejé de esperar. Cierra y vuelve a abrir el enlace si hace falta.'; return; }
        win.sb.rpc('smyl_patient_consent_status', { p_patient_id: o.patient }).then(function (r) {
          if (r.error || !r.data || !r.data.signed || signed) return;
          signed = true; clearInterval(timer); status.textContent = '✓ Ya firmó el aviso.'; status.className = 'pp-status pp-done';
          acts.replaceChildren(); act('Listo', 'pp-primary', close);
        }, function () {});
      }, 4000);
      d.addEventListener('close', function () { clearInterval(timer); if (signed && o.refresh) o.refresh(); }, { once: true });
    }).catch(function (err) {
      var code = err && err.code, msg = String(err && err.message || '');
      body.textContent = code === '42501' ? 'Tu rol no permite enviar avisos a firmar.' : /PGRST202|42883|schema cache/i.test(code + ' ' + msg) ? 'Falta aplicar la migración de firma por enlace en la base de datos.' : 'No se pudo crear el enlace. Revisa tu conexión e inténtalo de nuevo.';
    });
  }
  return { PURPOSES: PURPOSES, model: model, render: render, indexButton: indexButton, mount: mount, esc: esc };
});
