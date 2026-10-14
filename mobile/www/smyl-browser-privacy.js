(function () {
  'use strict';

  // Clinical records belong in Supabase, never in persistent browser storage.
  // This removes data left by older SMYL versions without touching Supabase
  // session keys or harmless UI preferences.
  var exactKeys = new Set([
    'camila_caso_preview',
    'smyl_editor_v2_case',
    'smyl_editor_v2_case_library',
    'smyl_editor_v2_design'
  ]);
  var sensitivePrefixes = [
    'camila_pacientes_',
    'camila_casos_',
    'camila_cotizaciones_',
    'camila_progreso_',
    'smyl_rapida_progreso_'
  ];

  function isSensitiveKey(key) {
    return exactKeys.has(key) || sensitivePrefixes.some(function (prefix) {
      return key.indexOf(prefix) === 0;
    });
  }

  function purgeStorage(storage) {
    if (!storage) return;
    var keys = [];
    try {
      for (var index = 0; index < storage.length; index += 1) {
        var key = storage.key(index);
        if (key && isSensitiveKey(key)) keys.push(key);
      }
      keys.forEach(function (key) { storage.removeItem(key); });
    } catch (_) {}
  }

  function purgeLegacyClinicalData() {
    try { purgeStorage(window.localStorage); } catch (_) {}
    try { purgeStorage(window.sessionStorage); } catch (_) {}
    try {
      if (window.indexedDB) window.indexedDB.deleteDatabase('smyl_editor_v2_media');
    } catch (_) {}
  }

  purgeLegacyClinicalData();
  if (document && document.documentElement) document.documentElement.dataset.smylPrivacy = 'active';
  window.SmylBrowserPrivacy = Object.freeze({
    isSensitiveKey: isSensitiveKey,
    purgeLegacyClinicalData: purgeLegacyClinicalData
  });
})();
