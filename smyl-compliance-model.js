/* Carpeta para inspección (COFEPRIS): reglas de qué cuenta como «al día». Lógica pura, sin pantalla ni red.
 *
 * Fuentes leídas por el equipo (no inventadas):
 *   - Guía de autoverificación de COFEPRIS para consultorios (aviso de funcionamiento y de responsable, registro diario de
 *     pacientes, título a la vista, fauna nociva < 365 días, bitácoras de limpieza, botiquín, cisternas, cloro residual,
 *     contrato de RPBI con manifiestos, contenedores rojos).
 *   - NOM-013-SSA2-2015 (estomatología): 5.21 botiquín, 5.22 teléfonos de emergencia, 8.1.2 vacunas del personal, 8.22 autoclave,
 *     8.24 testigo biológico cada 2 meses con registro, 8.33 contenedor de punzocortantes, 9 expediente.
 * No hay una guía dental propia de COFEPRIS: a los dentistas se les revisa con la guía de consultorios y con la NOM-013.
 * Los requisitos de rayos X (NOM-229) y de protocolos escritos NO están verificados contra su texto: se marcan «por confirmar»
 * o «recomendado». Conviene validar la lista con un asesor sanitario antes de prometer cumplimiento. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylComplianceModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BIO_DAYS = 61;          // NOM-013-SSA2-2015, 8.24: testigo biológico cada 2 meses
  var SOON_DAYS = 30;         // «vence pronto»
  var DAY = 86400000;

  // Requisitos que la clínica marca a mano. source = de dónde sale; validity = lleva vigencia; level: official | recommended | confirm
  var ITEMS = [
    { key: 'aviso_funcionamiento', group: 'Documentos y avisos', title: 'Aviso de funcionamiento', hint: 'Folio del trámite en COFEPRIS (DIGIPRiS).', source: 'Guía de autoverificación COFEPRIS, punto 1', level: 'official' },
    { key: 'aviso_responsable', group: 'Documentos y avisos', title: 'Aviso de responsable sanitario', hint: 'Nombre y folio del aviso.', source: 'Guía de autoverificación COFEPRIS, punto 1', level: 'official' },
    { key: 'titulo_visible', group: 'Documentos y avisos', title: 'Título y cédula del profesional a la vista del público', hint: 'Colocados donde el paciente los vea.', source: 'Guía de autoverificación COFEPRIS, puntos 4 y 5', level: 'official' },
    { key: 'rotulo_horario', group: 'Documentos y avisos', title: 'Rótulo con el horario del consultorio y del responsable sanitario', hint: '', source: 'Guía de autoverificación COFEPRIS, punto 3', level: 'official' },
    { key: 'contrato_rpbi', group: 'Residuos y limpieza', title: 'Contrato vigente con la empresa recolectora de RPBI', hint: 'Empresa y vigencia del contrato.', validity: true, source: 'Guía de autoverificación COFEPRIS, punto 18', level: 'official' },
    { key: 'contenedores_rpbi', group: 'Residuos y limpieza', title: 'Contenedor rígido rojo para punzocortantes y bolsa roja para RPBI', hint: '', source: 'Guía COFEPRIS, punto 20; NOM-013-SSA2-2015, 8.33', level: 'official' },
    { key: 'fauna_nociva', group: 'Residuos y limpieza', title: 'Comprobante de control de fauna nociva (menor a 365 días)', hint: 'Empresa y fecha de vencimiento del comprobante.', validity: true, source: 'Guía de autoverificación COFEPRIS, punto 11', level: 'official' },
    { key: 'bitacora_limpieza', group: 'Residuos y limpieza', title: 'Bitácora de limpieza y desinfección de instalaciones y equipo', hint: 'Dónde se lleva (papel o digital).', source: 'Guía de autoverificación COFEPRIS, punto 12', level: 'official' },
    { key: 'cisterna', group: 'Residuos y limpieza', title: 'Limpieza de cisterna o tinaco (al menos una vez al año)', hint: 'Fecha de la última limpieza.', validity: true, source: 'Guía de autoverificación COFEPRIS, punto 16', level: 'official' },
    { key: 'cloro_residual', group: 'Residuos y limpieza', title: 'Determinación de cloro residual del agua', hint: '', source: 'Guía de autoverificación COFEPRIS, punto 17', level: 'official' },
    { key: 'autoclave', group: 'Seguridad del paciente', title: 'Autoclave (vapor a presión) para esterilizar el instrumental', hint: 'Marca y número de serie.', source: 'NOM-013-SSA2-2015, 8.22', level: 'official' },
    { key: 'botiquin', group: 'Seguridad del paciente', title: 'Botiquín de urgencias completo', hint: 'Fecha de la última revisión de caducidades.', source: 'Guía COFEPRIS, punto 15; NOM-013-SSA2-2015, 5.21', level: 'official' },
    { key: 'telefonos_emergencia', group: 'Seguridad del paciente', title: 'Lista actualizada de teléfonos de emergencia a la vista', hint: '', source: 'NOM-013-SSA2-2015, 5.22', level: 'official' },
    { key: 'vacunas_personal', group: 'Seguridad del paciente', title: 'Vacunas de hepatitis B y tétanos del personal', hint: 'Quién las tiene vigentes.', source: 'NOM-013-SSA2-2015, 8.1.2', level: 'official' },
    { key: 'medicamentos', group: 'Seguridad del paciente', title: 'Medicamentos e insumos con caducidad vigente y registro sanitario', hint: '', source: 'Guía de autoverificación COFEPRIS, punto 10', level: 'official' },
    { key: 'protocolos', group: 'Recomendado', title: 'Protocolos escritos: esterilización, residuos, urgencias médicas', hint: 'Revisados y firmados por el responsable sanitario.', source: 'Buena práctica; no es un punto textual de la guía', level: 'recommended' },
    { key: 'equipo_rayos_x', group: 'Por confirmar con tu asesor', title: 'Equipo de rayos X: aviso o permiso y dosimetría del personal', hint: 'Los requisitos exactos dependen del equipo y del estado.', validity: true, source: 'NOM-229-SSA1-2002 (no verificada contra su texto)', level: 'confirm' }
  ];
  var ITEM_GROUPS = ['Documentos y avisos', 'Residuos y limpieza', 'Seguridad del paciente', 'Recomendado', 'Por confirmar con tu asesor'];

  function toDate(value) {
    if (!value) return null;
    var d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  function daysBetween(from, to) { return Math.floor((to.getTime() - from.getTime()) / DAY); }
  function dayOnly(value) { var d = toDate(String(value).length === 10 ? value + 'T12:00:00' : value); return d; }

  // Estado de un requisito marcado a mano. status: ok | soon | expired | na | missing
  function itemStatus(row, def, now) {
    var n = toDate(now) || new Date();
    if (!row) return { status: 'missing', label: 'Falta', detail: '' };
    if (row.status === 'not_applicable') return { status: 'na', label: 'No aplica', detail: row.notes || '' };
    var until = row.valid_until ? dayOnly(row.valid_until) : null;
    var ref = [row.reference, until ? 'vigente hasta ' + String(row.valid_until).slice(0, 10) : ''].filter(Boolean).join(' · ');
    if (until) {
      var left = daysBetween(n, until);
      if (left < 0) return { status: 'expired', label: 'Vencido', detail: ref };
      if (left <= SOON_DAYS) return { status: 'soon', label: 'Vence pronto', detail: ref };
    }
    return { status: 'ok', label: 'Al día', detail: ref };
  }

  // Testigo biológico: cada 2 meses (NOM-013-SSA2-2015, 8.24). Un resultado positivo siempre requiere atención.
  function bioStatus(steril, now) {
    var n = toDate(now) || new Date(), last = toDate(steril && steril.last_bio_at);
    if (!last) return { status: 'missing', label: 'Falta', detail: 'Todavía no hay un testigo biológico registrado.' };
    var days = daysBetween(last, n);
    if (steril.last_bio_result === 'positive') return { status: 'attention', label: 'Resultado positivo', detail: 'El último testigo salió positivo. Revisa el ciclo y repite el testigo.' };
    if (days > BIO_DAYS) return { status: 'expired', label: 'Toca el testigo', detail: 'El último fue hace ' + days + ' días; se aplica cada 2 meses.' };
    if (days > BIO_DAYS - SOON_DAYS) return { status: 'soon', label: 'Toca pronto', detail: 'El último fue hace ' + days + ' días; se aplica cada 2 meses.' };
    return { status: 'ok', label: 'Al día', detail: 'Último testigo hace ' + days + (days === 1 ? ' día' : ' días') + ', negativo.' };
  }

  // Filas calculadas con lo que SMYL ya registra + las marcadas a mano. Devuelve {groups, summary}.
  function evaluate(overview, now) {
    var o = overview || {}, n = toDate(now) || new Date();
    var steril = o.sterilization || {}, rpbi = o.rpbi || {}, act = o.activity || {};
    var manual = {}; (o.items || []).forEach(function (r) { manual[r.key] = r; });

    var derived = [];
    derived.push(Object.assign({ key: 'bio', title: 'Testigo biológico de esterilización (cada 2 meses)', source: 'NOM-013-SSA2-2015, 8.24', level: 'official', auto: true, action: 'bio' }, bioStatus(steril, n)));
    derived.push(Object.assign({ key: 'ciclos', title: 'Ciclos de autoclave registrados', source: 'NOM-013-SSA2-2015, 8.20 y 8.22', level: 'official', auto: true, action: 'cycle' },
      steril.cycles > 0 ? { status: 'ok', label: 'Al día', detail: steril.cycles + (steril.cycles === 1 ? ' ciclo' : ' ciclos') + ' en el periodo.' } : { status: 'missing', label: 'Falta', detail: 'No hay ciclos registrados en el periodo.' }));
    derived.push(Object.assign({ key: 'rpbi_manifiestos', title: 'Recolecciones de RPBI con su manifiesto', source: 'Guía de autoverificación COFEPRIS, punto 18', level: 'official', auto: true, action: 'rpbi' },
      rpbi.collections > 0 ? { status: 'ok', label: 'Al día', detail: rpbi.collections + (rpbi.collections === 1 ? ' recolección' : ' recolecciones') + ' · ' + rpbi.kg + ' kg en el periodo.' } : { status: 'missing', label: 'Falta', detail: 'No hay recolecciones registradas en el periodo.' }));
    derived.push(Object.assign({ key: 'notas', title: 'Notas de evolución firmadas', source: 'NOM-004-SSA3-2012, 5.10', level: 'official', auto: true },
      act.draft_notes > 0 ? { status: 'attention', label: 'Por firmar', detail: act.draft_notes + (act.draft_notes === 1 ? ' nota' : ' notas') + ' en borrador. ' + (act.signed_notes || 0) + ' firmadas en el periodo.' }
        : { status: act.signed_notes > 0 ? 'ok' : 'info', label: act.signed_notes > 0 ? 'Al día' : 'Sin datos', detail: (act.signed_notes || 0) + ' firmadas en el periodo.' }));
    derived.push(Object.assign({ key: 'consentimientos', title: 'Consentimientos informados', source: 'NOM-004-SSA3-2012; NOM-013-SSA2-2015, 9.6', level: 'official', auto: true },
      { status: 'info', label: 'Registro', detail: (act.consents_signed || 0) + ' firmados' + (act.consents_revoked ? ', ' + act.consents_revoked + ' revocados' : '') + ' en el periodo.' }));
    derived.push(Object.assign({ key: 'verificacion', title: 'Procedimientos con verificación de seguridad y anestesia', source: 'NOM-013-SSA2-2015, 8.13 y 9.3', level: 'official', auto: true },
      { status: 'info', label: 'Registro', detail: (act.verified_procedures || 0) + ' procedimientos firmados con verificación en el periodo.' }));
    derived.push(Object.assign({ key: 'pacientes_dia', title: 'Registro diario de pacientes (citas atendidas en la Agenda)', source: 'Guía de autoverificación COFEPRIS, punto 2', level: 'official', auto: true },
      act.visits > 0 ? { status: 'ok', label: 'Al día', detail: act.visits + ' citas atendidas en el periodo.' } : { status: 'missing', label: 'Falta', detail: 'No hay citas atendidas en el periodo.' }));

    var items = ITEMS.map(function (def) {
      return Object.assign({ key: def.key, title: def.title, group: def.group, hint: def.hint, source: def.source, level: def.level, validity: !!def.validity, manual: true, row: manual[def.key] || null }, itemStatus(manual[def.key], def, n));
    });
    var groups = [{ name: 'Lo que SMYL registra por ti', rows: derived }].concat(ITEM_GROUPS.map(function (g) { return { name: g, rows: items.filter(function (i) { return i.group === g; }) }; }));

    var all = derived.concat(items), counted = all.filter(function (r) { return r.status !== 'info' && r.status !== 'na'; });
    var ok = counted.filter(function (r) { return r.status === 'ok'; }).length;
    var pending = counted.filter(function (r) { return r.status !== 'ok'; });
    return { groups: groups, summary: { total: counted.length, ok: ok, pending: pending.length, pendingRows: pending, na: all.filter(function (r) { return r.status === 'na'; }).length } };
  }

  function sanitizeCycle(v) {
    var out = { indicator_ok: !!(v && v.indicator_ok) };
    if (v && v.device) out.device = String(v.device).trim().slice(0, 60);
    if (v && v.temperature_c !== '' && v.temperature_c != null) out.temperature_c = Number(v.temperature_c);
    if (v && v.minutes !== '' && v.minutes != null) out.minutes = Number(v.minutes);
    if (v && v.notes) out.notes = String(v.notes).trim().slice(0, 500);
    return out;
  }
  function cycleError(v) {
    var t = v && v.temperature_c !== '' && v.temperature_c != null ? Number(v.temperature_c) : null, m = v && v.minutes !== '' && v.minutes != null ? Number(v.minutes) : null;
    if (t != null && (!isFinite(t) || t < 100 || t > 200)) return 'La temperatura debe estar entre 100 y 200 °C.';
    if (m != null && (!isFinite(m) || m < 1 || m > 120)) return 'La duración debe ser de 1 a 120 minutos.';
    return '';
  }
  function rpbiError(v) {
    if (!v || !String(v.manifest || '').trim()) return 'Escribe el número del manifiesto de recolección.';
    var kg = v.kg !== '' && v.kg != null ? Number(v.kg) : null;
    if (kg != null && (!isFinite(kg) || kg < 0 || kg > 9999)) return 'Los kilos deben estar entre 0 y 9999.';
    return '';
  }

  return { ITEMS: ITEMS, ITEM_GROUPS: ITEM_GROUPS, BIO_DAYS: BIO_DAYS, SOON_DAYS: SOON_DAYS, itemStatus: itemStatus, bioStatus: bioStatus, evaluate: evaluate, cycleError: cycleError, rpbiError: rpbiError, sanitizeCycle: sanitizeCycle };
});
