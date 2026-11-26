/* SMYL · Plantillas sugeridas por sección.
   Cada pantalla que manda WhatsApp (Agenda, Finanzas, Cotizaciones, Pacientes) muestra qué plantillas necesita, cuáles ya están aprobadas por Meta,
   cuáles están en revisión y cuáles faltan, con UN botón para solicitar las que faltan. Así el tenant no tiene que adivinar entre las 60 del catálogo.
   · Parte pura (mapa sección → plantillas, plan de avance): se prueba en Node.
   · Parte de pantalla: tarjeta compacta en cada sección + aviso «Solicitar ahora» cuando falta una plantilla al mandar un mensaje.
   Marketing queda fuera de las sugerencias (requiere consentimiento del paciente). Solo el propietario puede solicitar; los demás ven qué falta. */
(function (root, factory) {
  var catalog = typeof module === 'object' && module.exports ? require('./smyl-template-catalog.js') : root.SmylTemplateCatalog;
  var api = factory(catalog);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SmylTemplateSuggest = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function (catalog) {
  'use strict';

  // tier: 'essential' (lo necesario para que la sección funcione) o 'recommended'. Nunca Marketing.
  var SECTIONS = {
    agenda: {
      title: 'Plantillas para los avisos de la Agenda',
      intro: 'Para que los recordatorios, confirmaciones y seguimientos de la Agenda salgan solos por WhatsApp.',
      items: [
        ['recordatorio_cita_confirmar_v1', 'essential', 'Recordatorio 48 h y 24 h antes, con botones Confirmo / Necesito reprogramar'],
        ['cita_confirmada_v1', 'essential', 'Confirmación al agendar una cita'],
        ['cita_reprogramada_v1', 'essential', 'Aviso cuando mueves una cita'],
        ['cita_cancelada_clinica_v1', 'essential', 'Aviso cuando la clínica cancela una cita'],
        ['cita_no_asistio_reagendar_v1', 'essential', 'Seguimiento si no vino, con botón para reagendar'],
        ['cita_motivo_no_reagenda_v1', 'essential', 'Pregunta por qué no reagendó'],
        ['cita_lista_espera_v1', 'recommended', 'Ofrecer un horario que se liberó a quien está en lista de espera'],
        ['cita_opciones_horario_v1', 'recommended', 'Proponer horarios disponibles desde Mensajes'],
        ['recordatorio_cita_mismo_dia_v1', 'recommended', 'Recordatorio el mismo día de la cita'],
        ['cita_indicaciones_previas_v1', 'recommended', 'Indicaciones antes de la cita'],
        ['cita_como_llegar_v1', 'recommended', 'Cómo llegar a la sucursal'],
        ['cita_retraso_v1', 'recommended', 'Avisar que hay un retraso'],
        ['cita_confirmar_llegada_v1', 'recommended', 'Preguntar si el paciente viene en camino'],
        ['cita_solicitud_recibida_v1', 'recommended', 'Avisar que recibimos su solicitud de cita'],
        ['cita_confirmacion_profesional_v1', 'recommended', 'Pedir al dentista que confirme una cita propuesta'],
        ['agenda_cita_nueva_profesional_v1', 'recommended', 'Avisar al dentista de una cita nueva'],
        ['agenda_cambio_profesional_v1', 'recommended', 'Avisar al dentista de un cambio de horario'],
        ['agenda_cancelacion_profesional_v1', 'recommended', 'Avisar al dentista de una cancelación']
      ]
    },
    finanzas: {
      title: 'Plantillas para cobros y facturación',
      intro: 'Para mandar por WhatsApp pagos, saldos y facturas aunque haya pasado la ventana de 24 horas.',
      items: [
        ['pago_recibido_v1', 'essential', 'Confirmar que recibimos un pago', 'Cobros'],
        ['pago_pendiente_v1', 'essential', 'Recordar un pago pendiente', 'Cobros'],
        ['saldo_vencido_aviso_v1', 'essential', 'Avisar de un saldo vencido', 'Cobros'],
        ['factura_disponible_v1', 'essential', 'Avisar que su factura está lista', 'Facturación'],
        ['datos_facturacion_pendientes_v1', 'essential', 'Pedir los datos fiscales para facturar', 'Facturación'],
        ['comprobante_pago_v1', 'recommended', 'Mandar el comprobante de pago', 'Cobros'],
        ['estado_cuenta_v1', 'recommended', 'Mandar el estado de cuenta', 'Cobros'],
        ['saldo_actualizado_v1', 'recommended', 'Avisar que su saldo cambió', 'Cobros'],
        ['plan_pagos_acordado_v1', 'recommended', 'Confirmar un plan de pagos acordado', 'Cobros'],
        ['plan_pagos_proximo_v1', 'recommended', 'Recordar el próximo pago del plan', 'Cobros']
      ]
    },
    cotizaciones: {
      title: 'Plantillas para tus cotizaciones',
      intro: 'Para enviar la cotización por WhatsApp y darle seguimiento sin depender de la ventana de 24 horas.',
      items: [
        ['cotizacion_lista_v1', 'essential', 'Avisar que su cotización está lista'],
        ['cotizacion_seguimiento_v1', 'essential', 'Dar seguimiento a una cotización sin respuesta'],
        ['plan_tratamiento_listo_v1', 'recommended', 'Avisar que su plan de tratamiento está listo']
      ]
    },
    pacientes: {
      title: 'Plantillas para tus pacientes',
      intro: 'Para el aviso de privacidad, la entrevista previa y el seguimiento después de la cita.',
      items: [
        ['aviso_privacidad_v1', 'essential', 'Enviar el aviso de privacidad'],
        ['entrevista_previa_v1', 'essential', 'Pedir la entrevista previa antes de la primera cita'],
        ['seguimiento_postcita_v1', 'essential', 'Preguntar cómo sigue después de su cita'],
        ['documento_por_firmar_v1', 'recommended', 'Pedir que firme un documento'],
        ['actualizar_datos_v1', 'recommended', 'Pedir que actualice sus datos'],
        ['documentos_recibidos_v1', 'recommended', 'Confirmar que recibimos sus documentos'],
        ['documento_incompleto_v1', 'recommended', 'Avisar que un documento está incompleto'],
        ['indicaciones_postratamiento_v1', 'recommended', 'Indicaciones después de un tratamiento'],
        ['proxima_cita_tratamiento_v1', 'recommended', 'Recordar la próxima cita del tratamiento'],
        ['control_ortodoncia_v1', 'recommended', 'Recordar su control de ortodoncia'],
        ['estudios_listos_v1', 'recommended', 'Avisar que sus estudios están listos'],
        ['trabajo_laboratorio_listo_v1', 'recommended', 'Avisar que su trabajo de laboratorio llegó'],
        ['seguimiento_control_pendiente_v1', 'recommended', 'Recordar un control pendiente']
      ]
    }
  };

  function titleOf(id) {
    var found = catalog && catalog.TEMPLATES ? catalog.TEMPLATES.filter(function (item) { return item.id === id; })[0] : null;
    return found ? found.title : id;
  }
  function groupOfStatus(status) { return status === 'APPROVED' ? 'ready' : status === 'PENDING' ? 'pending' : (!status || status === 'NONE') ? 'missing' : 'problem'; }

  // Plan de una sección: cada plantilla con su estado y los conteos de esenciales y recomendadas.
  // statusOf: función id → 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | … (o un objeto {id: estado}).
  function plan(sectionId, statusOf) {
    var section = SECTIONS[sectionId]; if (!section) return null;
    var lookup = typeof statusOf === 'function' ? statusOf : function (id) { return statusOf ? statusOf[id] : 'NONE'; };
    var items = section.items.map(function (row) {
      var status = lookup(row[0]) || 'NONE';
      return { id: row[0], title: titleOf(row[0]), why: row[2], area: row[3] || '', tier: row[1], status: status, state: groupOfStatus(status) };
    });
    function count(tier) {
      var own = items.filter(function (item) { return item.tier === tier; });
      return {
        total: own.length,
        ready: own.filter(function (item) { return item.state === 'ready'; }).length,
        pending: own.filter(function (item) { return item.state === 'pending'; }).length,
        problems: own.filter(function (item) { return item.state === 'problem'; }).length,
        missing: own.filter(function (item) { return item.state === 'missing'; }).map(function (item) { return item.id; })
      };
    }
    return { id: sectionId, title: section.title, intro: section.intro, items: items, essential: count('essential'), recommended: count('recommended') };
  }

  function essentialsOf(sectionId) {
    var section = SECTIONS[sectionId];
    return section ? section.items.filter(function (row) { return row[1] === 'essential'; }).map(function (row) { return row[0]; }) : [];
  }
  function sectionsOf(templateId) {
    return Object.keys(SECTIONS).filter(function (key) { return SECTIONS[key].items.some(function (row) { return row[0] === templateId; }); });
  }
  // Avance de las plantillas esenciales de la Agenda a partir de la lista que devuelve la función de plantillas (para «Puesta en marcha»).
  function essentialProgress(sectionId, remoteList) {
    var ids = essentialsOf(sectionId), by = {};
    (remoteList || []).forEach(function (item) { if (item && item.name) by[item.name] = item; });
    var ready = 0, pending = 0;
    ids.forEach(function (id) { var r = by[id]; if (r && r.status === 'APPROVED') ready += 1; else if (r && r.status === 'PENDING') pending += 1; });
    return { total: ids.length, ready: ready, pending: pending, missing: ids.length - ready - pending };
  }

  var api = { SECTIONS: SECTIONS, plan: plan, essentialsOf: essentialsOf, sectionsOf: sectionsOf, essentialProgress: essentialProgress, titleOf: titleOf };

  // ───────────────────────── Pantalla ─────────────────────────
  api.start = function (win) {
    var doc = win.document;
    var STATE_TEXT = { ready: 'Aprobada', pending: 'En revisión de Meta', missing: 'Por solicitar', problem: 'Con problemas' };
    var MOUNTS = [
      { route: 'agenda', page: 'p-agenda', section: 'agenda', find: function (page) {
        var grid = page.querySelector('[data-schedule-panel="settings"] .schedule-settings-grid');
        return grid ? { parent: grid, after: page.querySelector('#schedule-reminders-card') } : null;
      } },
      { route: 'caja', page: 'p-caja', section: 'finanzas', find: function (page) { return { parent: page, after: page.querySelector('#finance-feedback') }; } },
      { route: 'propuestas', page: 'p-propuestas', section: 'cotizaciones', find: function (page) { return { parent: page, after: null }; } },
      { route: 'pacientes', page: 'p-pacientes', section: 'pacientes', find: function (page) { return { parent: page, after: null }; } }
    ];
    var data = { summary: null, loading: false };

    function el(tag, cls, text) { var node = doc.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
    function templates() { return win.SmylTemplates && typeof win.SmylTemplates.summary === 'function' ? win.SmylTemplates : null; }
    function statusMap() {
      var map = {};
      ((data.summary && data.summary.templates) || []).forEach(function (item) { map[item.id] = item.status; });
      return map;
    }
    function load() {
      var t = templates(); if (!t || data.loading) return Promise.resolve();
      data.loading = true;
      return Promise.resolve(t.summary()).then(function (summary) { data.summary = summary; }, function () { data.summary = null; })
        .then(function () { data.loading = false; refresh(); });
    }

    function row(item, canRequest) {
      var li = el('li', 'tpl-suggest-row'); li.dataset.state = item.state; li.dataset.template = item.id;
      var mark = el('span', 'tpl-suggest-mark'); mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', STATE_TEXT[item.state]);
      mark.textContent = item.state === 'ready' ? '✓' : item.state === 'pending' ? '…' : item.state === 'problem' ? '!' : '';
      var copy = el('div', 'tpl-suggest-copy');
      copy.append(el('strong', '', item.title), el('small', '', item.why + (item.area ? ' · ' + item.area : '')));
      var side = el('div', 'tpl-suggest-side');
      side.append(el('span', 'tpl-suggest-state', STATE_TEXT[item.state]));
      if (item.state === 'missing' && canRequest && win.SmylTemplates.request) {
        var one = el('button', 'tpl-suggest-link', 'Solicitar'); one.type = 'button';
        one.setAttribute('aria-label', 'Solicitar ' + item.title);
        one.onclick = function () { win.SmylTemplates.request(item.id); };
        side.append(one);
      }
      li.append(mark, copy, side);
      return li;
    }

    function build(sectionId) {
      var p = plan(sectionId, statusMap()); if (!p) return null;
      var canRequest = Boolean(data.summary && data.summary.canRequest);
      var allReady = p.essential.ready === p.essential.total && p.recommended.ready === p.recommended.total;
      if (allReady) return null;
      var card = el('section', 'tpl-suggest'); card.dataset.tplSuggest = sectionId; card.setAttribute('aria-labelledby', 'tpl-suggest-title-' + sectionId);
      var essentialsDone = p.essential.ready === p.essential.total;
      card.dataset.done = String(essentialsDone);
      card.dataset.sig = JSON.stringify([canRequest, p.items.map(function (item) { return item.status; })]);

      var head = el('div', 'tpl-suggest-head');
      var text = el('div', 'tpl-suggest-headtext');
      text.append(el('span', 'tpl-suggest-eyebrow', 'Plantillas de WhatsApp'));
      var title = el('h2', '', essentialsDone ? 'Plantillas esenciales listas' : p.title); title.id = 'tpl-suggest-title-' + sectionId;
      text.append(title, el('p', '', essentialsDone ? 'Tienes aprobadas las plantillas que esta sección necesita. Hay otras recomendadas por si las quieres.' : p.intro));
      var meter = el('div', 'tpl-suggest-meter');
      meter.append(el('strong', '', p.essential.ready + ' de ' + p.essential.total), el('small', '', 'esenciales aprobadas'));
      var bar = el('div', 'tpl-suggest-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(p.essential.total));
      bar.setAttribute('aria-valuenow', String(p.essential.ready)); bar.setAttribute('aria-label', 'Plantillas esenciales aprobadas');
      var fill = el('span'); fill.style.width = Math.round(p.essential.ready / Math.max(1, p.essential.total) * 100) + '%'; bar.append(fill); meter.append(bar);
      head.append(text, meter); card.append(head);

      var actions = el('div', 'tpl-suggest-actions');
      var wanted = p.essential.missing.length ? p.essential.missing : p.recommended.missing;
      if (p.essential.pending) actions.append(el('span', 'tpl-suggest-note', p.essential.pending + (p.essential.pending === 1 ? ' está en revisión de Meta.' : ' están en revisión de Meta.')));
      if (p.essential.problems) actions.append(el('span', 'tpl-suggest-note tpl-suggest-warn', p.essential.problems + (p.essential.problems === 1 ? ' tiene problemas: revísala en Plantillas.' : ' tienen problemas: revísalas en Plantillas.')));
      if (wanted.length) {
        var ask = el('button', 'btn btn-primary tpl-suggest-ask', p.essential.missing.length ? 'Solicitar las que faltan (' + wanted.length + ')' : 'Solicitar las recomendadas (' + wanted.length + ')'); ask.type = 'button';
        ask.disabled = !canRequest || !win.SmylTemplates || !win.SmylTemplates.requestMany;
        ask.onclick = function () { ask.disabled = true; Promise.resolve(win.SmylTemplates.requestMany(wanted)).then(load, load); };
        actions.append(ask);
        if (!canRequest) actions.append(el('span', 'tpl-suggest-note', 'Solo el propietario puede solicitarlas: pídeselo.'));
      }
      var detail = el('button', 'tpl-suggest-toggle', 'Ver detalle'); detail.type = 'button'; detail.setAttribute('aria-expanded', 'false');
      var all = el('button', 'tpl-suggest-link', 'Ir a Plantillas'); all.type = 'button';
      all.onclick = function () { if (win.SmylTemplates && win.SmylTemplates.show) win.SmylTemplates.show(); else if (win.ir) win.ir('plantillas'); };
      actions.append(detail, all); card.append(actions);

      var list = el('div', 'tpl-suggest-detail'); list.hidden = true;
      [['essential', 'Esenciales'], ['recommended', 'Recomendadas']].forEach(function (tier) {
        var items = p.items.filter(function (item) { return item.tier === tier[0]; });
        if (!items.length) return;
        var group = el('section', 'tpl-suggest-group'); group.append(el('h3', '', tier[1]));
        var ul = el('ul', 'tpl-suggest-rows'); items.forEach(function (item) { ul.append(row(item, canRequest)); });
        group.append(ul); list.append(group);
      });
      card.append(list);
      detail.onclick = function () { var open = list.hidden; list.hidden = !open; detail.setAttribute('aria-expanded', String(open)); detail.textContent = open ? 'Ocultar detalle' : 'Ver detalle'; };
      return card;
    }

    function place(mount) {
      var page = doc.getElementById(mount.page); if (!page) return;
      var current = page.querySelector('[data-tpl-suggest="' + mount.section + '"]');
      if (!data.summary || !data.summary.loaded) { if (current) current.remove(); return; }
      var card = build(mount.section);
      var open = current && current.querySelector('.tpl-suggest-detail') && !current.querySelector('.tpl-suggest-detail').hidden;
      if (!card) { if (current) current.remove(); return; }
      if (current && current.dataset.sig === card.dataset.sig) return; // nada cambió: no se vuelve a pintar
      var target = mount.find(page); if (!target) { if (current) current.remove(); return; }
      if (open) { var list = card.querySelector('.tpl-suggest-detail'), toggle = card.querySelector('.tpl-suggest-toggle'); list.hidden = false; toggle.setAttribute('aria-expanded', 'true'); toggle.textContent = 'Ocultar detalle'; }
      if (current) current.replaceWith(card);
      else if (target.after && target.after.parentNode === target.parent) target.after.after(card);
      else target.parent.insertBefore(card, target.parent.firstChild);
    }
    var scheduled = 0;
    function refresh() { win.clearTimeout(scheduled); scheduled = win.setTimeout(function () { MOUNTS.forEach(place); }, 30); }

    // «Falta una plantilla»: en vez de un aviso sin salida, ofrece solicitarla ahora (o dice a quién pedirlo).
    function offerMissing(names, fallbackText) {
      var list = (names || []).filter(Boolean);
      var known = list.filter(function (name) { return sectionsOf(name).length; })[0] || list[0];
      var t = templates();
      if (!t || !known) { win.alert(fallbackText || 'No hay una plantilla aprobada para este mensaje. Solicítala en Mensajería → Plantillas.'); return Promise.resolve(false); }
      return Promise.resolve(t.summary()).then(function (summary) {
        data.summary = summary;
        var item = (summary.templates || []).filter(function (entry) { return list.indexOf(entry.id) !== -1; })
          .sort(function (a, b) { return (a.status === 'PENDING' ? 0 : 1) - (b.status === 'PENDING' ? 0 : 1); })[0];
        var dialog = el('dialog', 'tpl-dialog tpl-suggest-dialog'); var body = el('div', 'tpl-dialog-body');
        body.append(el('h3', '', 'Falta una plantilla aprobada'));
        body.append(el('p', '', 'Para escribirle a este paciente fuera de la ventana de 24 horas se necesita la plantilla «' + titleOf(known) + '» aprobada por Meta.'));
        var actions = el('div', 'tpl-dialog-actions');
        var close = el('button', 'btn btn-secondary btn-sm', 'Cerrar'); close.type = 'button'; close.onclick = function () { dialog.close(); };
        if (item && item.status === 'PENDING') body.append(el('p', 'tpl-dialog-warn', 'Ya la solicitaste: Meta la está revisando. Suele tardar de unos minutos a 48 horas.'));
        else if (item && item.status && item.status !== 'NONE' && item.status !== 'APPROVED') body.append(el('p', 'tpl-dialog-warn', 'Meta la dejó con problemas. Revísala en Plantillas.'));
        else if (!summary.canRequest) body.append(el('p', 'tpl-dialog-warn', 'Solo el propietario puede solicitarla. Pídele que lo haga desde Mensajería → Plantillas.'));
        actions.append(close);
        if (summary.canRequest && (!item || item.status === 'NONE')) {
          var ask = el('button', 'btn btn-primary btn-sm', 'Solicitar ahora'); ask.type = 'button';
          ask.onclick = function () { dialog.close(); win.SmylTemplates.request(known); };
          actions.append(ask);
        }
        body.append(actions); dialog.append(body);
        dialog.addEventListener('close', function () { dialog.remove(); });
        doc.body.append(dialog); if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
        return true;
      }, function () { win.alert(fallbackText || 'No pudimos consultar tus plantillas. Intenta de nuevo.'); return false; });
    }
    api.offerMissing = offerMissing;
    api.reload = load;

    function init() {
      var previous = win.ir;
      if (typeof previous === 'function') {
        win.ir = function (route) {
          var result = previous.apply(this, arguments);
          if (MOUNTS.some(function (mount) { return mount.route === route; })) { load(); refresh(); }
          return result;
        };
      }
      // Las pantallas se vuelven a pintar solas: el aviso se vuelve a poner si desaparece.
      if (win.MutationObserver) {
        // Se ignoran los cambios que provoca la propia tarjeta (si no, se pintaría en bucle).
        var own = function (record) {
          var inside = record.target && record.target.closest && record.target.closest('.tpl-suggest');
          var nodes = Array.prototype.slice.call(record.addedNodes).concat(Array.prototype.slice.call(record.removedNodes));
          return Boolean(inside) || (nodes.length > 0 && nodes.every(function (node) { return node.classList && node.classList.contains('tpl-suggest'); }));
        };
        var observer = new win.MutationObserver(function (records) { if (data.summary && !records.every(own)) refresh(); });
        MOUNTS.forEach(function (mount) {
          var tries = 0;
          (function watch() { var page = doc.getElementById(mount.page); if (page) observer.observe(page, { childList: true, subtree: true }); else if (tries++ < 40) win.setTimeout(watch, 250); })();
        });
      }
      if (win.SmylTemplates && win.SmylTemplates.onChange) win.SmylTemplates.onChange(function () { load(); });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
  };

  return api;
});
