/* SMYL · Receta médica — hoja de impresión.
 *
 * Esta pieza dibuja la receta a partir de un objeto simple (lo usa smyl-prescriptions.js); no guarda nada y NO afirma
 * cumplir ninguna norma (ver docs/RECETA_REQUISITOS.md): el contenido legal obligatorio (artículos del Reglamento de Insumos para la Salud, leyendas, reglas de
 * antibióticos y medicamentos controlados) se verifica con las fuentes oficiales y se completa en otra etapa. Hasta entonces el
 * módulo solo sabe mostrar datos y avisar qué le falta a la hoja para verse completa (`sheetIssues`).
 *
 * Forma del objeto:
 *   { folio, issued_at, professional:{name,specialty,license_number,license_institution}, clinic:{name,address,phone},
 *     patient:{name,age_label}, diagnosis, items:[{generic,brand,form,strength,dose,route,frequency,duration,quantity}],
 *     indications, legends:[texto] }
 * Todo se dibuja con textContent; nada de lo capturado se interpreta como HTML.
 */
(function (root, factory) {
  var model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model; else root.SmylPrescriptionPrint = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function text(value, max) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 400); }

  function normalize(rx) {
    rx = rx && typeof rx === 'object' ? rx : {};
    var pro = rx.professional || {}, clinic = rx.clinic || {}, patient = rx.patient || {};
    return {
      folio: text(rx.folio, 20), issued_at: text(rx.issued_at, 40),
      professional: { name: text(pro.name, 120), specialty: text(pro.specialty, 80), license_number: text(pro.license_number, 30), license_institution: text(pro.license_institution, 120) },
      clinic: { name: text(clinic.name, 120), address: text(clinic.address, 240), phone: text(clinic.phone, 40) },
      patient: { name: text(patient.name, 160), age_label: text(patient.age_label, 30) },
      diagnosis: text(rx.diagnosis, 240),
      items: (Array.isArray(rx.items) ? rx.items : []).slice(0, 12).map(function (i) {
        i = i || {};
        return { generic: text(i.generic, 120), brand: text(i.brand, 120), form: text(i.form, 60), strength: text(i.strength, 60), dose: text(i.dose, 120),
          route: text(i.route, 60), frequency: text(i.frequency, 80), duration: text(i.duration, 80), quantity: text(i.quantity, 60) };
      }),
      indications: text(rx.indications, 900),
      legends: (Array.isArray(rx.legends) ? rx.legends : []).slice(0, 6).map(function (l) { return text(l, 300); }).filter(Boolean)
    };
  }

  // Qué le falta a la hoja para verse completa. NO es la lista de requisitos legales (esa se verifica aparte).
  function sheetIssues(input) {
    var rx = normalize(input), out = [];
    if (!rx.professional.name) out.push('Nombre del profesional');
    if (!rx.professional.license_number) out.push('Cédula profesional');
    if (!rx.professional.license_institution) out.push('Institución que expidió el título');
    if (!rx.clinic.address) out.push('Domicilio del consultorio');
    if (!rx.patient.name) out.push('Nombre del paciente');
    if (!rx.issued_at) out.push('Fecha');
    if (!rx.items.length) out.push('Al menos un medicamento');
    rx.items.forEach(function (i, n) { if (!i.generic) out.push('Medicamento ' + (n + 1) + ': nombre'); });
    return out;
  }

  function el(doc, tag, cls, value) { var n = doc.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; }

  function instruction(i) {
    var parts = [];
    if (i.dose) parts.push(i.dose);
    if (i.route) parts.push('vía ' + i.route);
    if (i.frequency) parts.push(i.frequency);
    if (i.duration) parts.push('durante ' + i.duration);
    return parts.join(', ');
  }

  function dateLabel(value) {
    if (!value) return '';
    var d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : value;
  }

  function initials(value) {
    var words = text(value, 120).split(/\s+/).filter(Boolean);
    if (!words.length) return 'S';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase().slice(0, 2);
  }

  function render(input, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    var rx = normalize(input), paper = el(doc, 'article', 'rx-paper');
    paper.setAttribute('aria-label', 'Receta médica');

    var head = el(doc, 'header', 'rx-head'), identity = el(doc, 'div', 'rx-identity'), mark = el(doc, 'span', 'rx-clinic-mark', initials(rx.clinic.name));
    var who = el(doc, 'div', 'rx-doctor');
    who.append(el(doc, 'strong', 'rx-doctor-name', rx.professional.name || 'Nombre del profesional'));
    if (rx.professional.specialty) who.append(el(doc, 'span', 'rx-doctor-line', rx.professional.specialty));
    who.append(el(doc, 'span', 'rx-doctor-line', 'Cédula profesional: ' + (rx.professional.license_number || '—')));
    who.append(el(doc, 'span', 'rx-doctor-line', 'Institución: ' + (rx.professional.license_institution || '—')));
    identity.append(mark, who);
    var place = el(doc, 'div', 'rx-clinic');
    place.append(el(doc, 'small', 'rx-document-type', 'RECETA MÉDICA'));
    if (rx.clinic.name) place.append(el(doc, 'strong', '', rx.clinic.name));
    if (rx.clinic.address) place.append(el(doc, 'span', '', rx.clinic.address));
    if (rx.clinic.phone) place.append(el(doc, 'span', '', 'Tel. ' + rx.clinic.phone));
    head.append(identity, place); paper.append(head);

    var meta = el(doc, 'div', 'rx-meta');
    [['Paciente', rx.patient.name || '—'], ['Edad', rx.patient.age_label || '—'], ['Fecha', dateLabel(rx.issued_at) || '—'], ['Folio', rx.folio || '—']].forEach(function (pair) {
      var cell = el(doc, 'div', 'rx-meta-cell'); cell.append(el(doc, 'small', '', pair[0]), el(doc, 'strong', '', pair[1])); meta.append(cell);
    });
    paper.append(meta);
    if (rx.diagnosis) { var dx = el(doc, 'p', 'rx-diagnosis'); dx.append(el(doc, 'small', '', 'Diagnóstico: '), document_text(doc, rx.diagnosis)); paper.append(dx); }

    var body = el(doc, 'section', 'rx-body'); body.append(el(doc, 'span', 'rx-rp', 'Rp.'));
    var list = el(doc, 'ol', 'rx-items');
    rx.items.forEach(function (i) {
      var li = el(doc, 'li', 'rx-item'), name = [i.generic, i.strength, i.form].filter(Boolean).join(' · ');
      var title = el(doc, 'strong', 'rx-item-name', name || 'Medicamento'); li.append(title);
      if (i.brand) li.append(el(doc, 'span', 'rx-item-brand', ' (' + i.brand + ')'));
      var how = instruction(i); if (how) li.append(el(doc, 'p', 'rx-item-how', how + '.'));
      if (i.quantity) li.append(el(doc, 'p', 'rx-item-qty', 'Cantidad: ' + i.quantity));
      list.append(li);
    });
    body.append(list); paper.append(body);

    if (rx.indications) { var ind = el(doc, 'section', 'rx-indications'); ind.append(el(doc, 'small', '', 'Indicaciones'), el(doc, 'p', '', rx.indications)); paper.append(ind); }

    var foot = el(doc, 'footer', 'rx-foot');
    var sign = el(doc, 'div', 'rx-sign'); sign.append(el(doc, 'span', 'rx-sign-line'), el(doc, 'small', '', 'Firma del profesional'));
    var stamp = el(doc, 'div', 'rx-stamp'); stamp.append(el(doc, 'small', '', 'Sello'));
    foot.append(sign, stamp); paper.append(foot);
    rx.legends.forEach(function (l) { paper.append(el(doc, 'p', 'rx-legend', l)); });
    return paper;
  }
  function document_text(doc, value) { return doc.createTextNode(value); }

  return { normalize: normalize, sheetIssues: sheetIssues, render: render };
});
