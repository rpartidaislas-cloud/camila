/* Versioned clinical-plan contract. Schema 2 links catalog services to explicit FDI targets. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylClinicalModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var phases = [['evaluate','Evaluación'],['prevent','Prevención'],['stabilize','Estabilización'],['treat','Tratamiento'],['maintain','Mantenimiento']];
  var surfaces = [['M','Mesial'],['D','Distal'],['O','Oclusal'],['V','Vestibular'],['L','Lingual / palatina'],['I','Incisal']];
  var teeth = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38].map(String);
  var toothSet = new Set(teeth), surfaceSet = new Set(surfaces.map(function (x) { return x[0]; }));
  function text(value, limit) { return String(value == null ? '' : value).trim().slice(0, limit); }
  function unique(values, allowed) { return Array.from(new Set(Array.isArray(values) ? values.map(String) : [])).filter(function (v) { return allowed.has(v); }); }
  function snapshot(value) {
    if (!value || typeof value !== 'object') return null;
    var price = value.reference_price == null || value.reference_price === '' ? null : Number(value.reference_price);
    return {
      name: text(value.name, 100), patient_name: text(value.patient_name || value.name, 120),
      category: text(value.category, 40), specialty: text(value.specialty, 60),
      scope_type: text(value.scope_type, 30), pricing_mode: text(value.pricing_mode, 30),
      reference_price: Number.isFinite(price) && price >= 0 ? price : null, currency: 'MXN',
      sat_product_service_code: text(value.sat_product_service_code, 8) || null,
      sat_unit_code: text(value.sat_unit_code, 8) || null, tax_object_code: text(value.tax_object_code, 2) || null,
      fiscal_status: value.fiscal_status === 'reviewed' ? 'reviewed' : 'pending'
    };
  }
  function treatment(value, index) {
    value = value || {};
    var phase = phases.some(function (x) { return x[0] === value.phase; }) ? value.phase : 'treat';
    return {
      id: /^[a-zA-Z0-9-]{1,64}$/.test(String(value.id || '')) ? String(value.id) : 'item-' + String(index + 1).padStart(2, '0'),
      name: text(value.name, 200), area: text(value.area, 200), notes: text(value.notes, 2000), phase: phase,
      service_id: /^[0-9a-f-]{36}$/i.test(String(value.service_id || '')) ? String(value.service_id).toLowerCase() : null,
      service_revision: Number.isInteger(Number(value.service_revision)) && Number(value.service_revision) > 0 ? Number(value.service_revision) : null,
      service_snapshot: snapshot(value.service_snapshot), teeth: unique(value.teeth, toothSet), surfaces: unique(value.surfaces, surfaceSet)
    };
  }
  function normalize(value) {
    value = value || {};
    return {
      schema: 2,
      reason: text(value.reason, 2000), background: text(value.background, 8000), assessment: text(value.assessment, 8000),
      treatments: (Array.isArray(value.treatments) ? value.treatments : []).slice(0, 20).map(treatment)
    };
  }
  function reviewError(value) {
    var doc = normalize(value), ids = new Set();
    if (!doc.assessment) return 'Escribe tu valoración antes de revisar el plan.';
    if (!doc.treatments.length || doc.treatments.some(function (item) { return !item.name; })) return 'Da nombre a cada tratamiento o indicación del plan.';
    for (var item of doc.treatments) {
      if (ids.has(item.id)) return 'Cada tratamiento necesita un identificador distinto.';
      ids.add(item.id);
      if ((item.service_id && (!item.service_revision || !item.service_snapshot)) || (!item.service_id && (item.service_revision || item.service_snapshot))) return 'Revisa el servicio vinculado al plan.';
      if (item.surfaces.length && !item.teeth.length) return 'Selecciona una pieza antes de indicar superficies.';
    }
    return '';
  }
  function quantity(item) {
    var mode = item.service_snapshot && item.service_snapshot.pricing_mode;
    if (mode === 'per_tooth') return Math.max(1, item.teeth.length);
    if (mode === 'per_surface') return Math.max(1, item.teeth.length * Math.max(1, item.surfaces.length));
    return 1;
  }
  function areaLabel(item) {
    var parts = [];
    if (item.teeth.length) parts.push('Piezas ' + item.teeth.join(', '));
    if (item.surfaces.length) parts.push('Superficies ' + item.surfaces.join(', '));
    return parts.join(' · ') || item.area;
  }
  function errorMessage(error) {
    var code = error && error.code;
    if (code === '40001') return 'El expediente cambió en otra sesión. Conservamos tus cambios en pantalla. Recarga la ficha antes de volver a guardar.';
    if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return 'El expediente aún no está habilitado en la base de datos. Falta activar la actualización clínica.';
    if (code === '42501' || code === 'PGRST301') return 'Tu sesión no tiene permiso para esta acción. Revisa la cuenta con la que ingresaste.';
    if (code === '22023') return 'Revisa piezas, superficies y servicio antes de guardar.';
    return 'No pudimos confirmar el guardado o la carga. Revisa tu conexión; tus cambios siguen en pantalla.';
  }
  return Object.freeze({ normalize: normalize, reviewError: reviewError, errorMessage: errorMessage, phases: phases, surfaces: surfaces, teeth: teeth, quantity: quantity, areaLabel: areaLabel, snapshot: snapshot });
});
