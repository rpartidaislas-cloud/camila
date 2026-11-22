/* Fotos de pacientes del bucket privado camila-fotos.
 * Los enlaces firmados ahora duran 7 días (antes ~1 año). Los casos guardan esos enlaces; cuando uno vence,
 * la <img> falla y este módulo pide un enlace nuevo con la sesión del usuario (la política de Storage decide
 * si puede verla) y lo reemplaza una sola vez. No guarda nada en el navegador. */
(function (global) {
  'use strict';
  var BUCKET = 'camila-fotos';
  var PATTERN = /^(https:\/\/[^/]+)\/storage\/v1\/object\/sign\/camila-fotos\/([^?#]+)/;
  var REFRESH_SECONDS = 3600;
  var pending = new Map();

  function apiKey() {
    try { if (global.SUPA_KEY) return global.SUPA_KEY; } catch (_) {}
    try { if (global.CFG && global.CFG.supaKey) return global.CFG.supaKey; } catch (_) {}
    try { if (typeof DB_KEY !== 'undefined' && DB_KEY) return DB_KEY; } catch (_) {}
    return '';
  }

  async function accessToken() {
    try {
      var result = global.sb && global.sb.auth && await global.sb.auth.getSession();
      var token = result && result.data && result.data.session && result.data.session.access_token;
      if (token) return token;
    } catch (_) {}
    try { if (global.CFG && global.CFG.userToken) return global.CFG.userToken; } catch (_) {}
    try { if (typeof userToken !== 'undefined' && userToken) return userToken; } catch (_) {}
    return '';
  }

  /** Devuelve un enlace firmado nuevo (1 h) para una URL firmada de camila-fotos, o null si no aplica o no hay permiso. */
  async function refresh(url) {
    var match = PATTERN.exec(String(url || ''));
    if (!match) return null;
    var base = match[1], path = decodeURIComponent(match[2]);
    if (pending.has(path)) return pending.get(path);
    var job = (async function () {
      var token = await accessToken(), key = apiKey();
      if (!token || !key) return null;
      var response = await fetch(base + '/storage/v1/object/sign/' + BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/'), {
        method: 'POST',
        headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: REFRESH_SECONDS })
      });
      if (!response.ok) return null;
      var data = await response.json().catch(function () { return null; });
      return data && data.signedURL ? base + '/storage/v1' + data.signedURL : null;
    })().catch(function () { return null; });
    pending.set(path, job);
    job.then(function () { setTimeout(function () { pending.delete(path); }, 60000); });
    return job;
  }

  // Una imagen con enlace vencido dispara "error": se intenta una sola vez con un enlace nuevo.
  document.addEventListener('error', function (event) {
    var img = event.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.smylRefreshed === '1' || !PATTERN.test(img.currentSrc || img.src)) return;
    img.dataset.smylRefreshed = '1';
    refresh(img.currentSrc || img.src).then(function (fresh) { if (fresh) img.src = fresh; });
  }, true);

  global.SmylPhotoUrl = Object.freeze({ refresh: refresh, matches: function (url) { return PATTERN.test(String(url || '')); } });
})(window);
