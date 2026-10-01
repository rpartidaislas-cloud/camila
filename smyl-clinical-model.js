/* Small, versioned document contract. No generated image is clinical evidence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylClinicalModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function text(value, limit) { return String(value == null ? '' : value).trim().slice(0, limit); }
  function normalize(value) {
    value = value || {};
    return {
      schema: 1,
      reason: text(value.reason, 2000),
      background: text(value.background, 8000),
      assessment: text(value.assessment, 8000),
      treatments: (Array.isArray(value.treatments) ? value.treatments : []).slice(0, 20).map(function (item) {
        item = item || {};
        return { name: text(item.name, 200), area: text(item.area, 200), notes: text(item.notes, 2000) };
      })
    };
  }
  function reviewError(value) {
    var doc = normalize(value);
    if (!doc.assessment) return 'Escribe tu valoración antes de revisar el plan.';
    if (!doc.treatments.length || doc.treatments.some(function (item) { return !item.name; })) {
      return 'Da nombre a cada tratamiento o indicación del plan.';
    }
    return '';
  }
  function errorMessage(error) {
    var code = error && error.code;
    if (code === '40001') return 'El expediente cambió en otra sesión. Conservamos tus cambios en pantalla. Recarga la ficha antes de volver a guardar.';
    if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') return 'El expediente aún no está habilitado en la base de datos. Falta activar la actualización clínica.';
    if (code === '42501' || code === 'PGRST301') return 'Tu sesión no tiene permiso para esta acción. Revisa la cuenta con la que ingresaste.';
    return 'No pudimos confirmar el guardado o la carga. Revisa tu conexión; tus cambios siguen en pantalla.';
  }
  return { normalize: normalize, reviewError: reviewError, errorMessage: errorMessage };
});
