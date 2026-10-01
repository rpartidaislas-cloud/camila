/* Patient-case frontend contract v1. No storage, network, diagnosis or generation. */
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.SmylCaseModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const views = ['frontal','left','right','tresCuartos','extraoral','intraoral','intraoralLeft','intraoralRight'];
  const labels = ['Frontal sonriendo','Perfil izquierdo','Perfil derecho','Vista 3/4','Detalle de sonrisa','Frontal intraoral','Lateral intraoral izquierda','Lateral intraoral derecha'];
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const label = view => labels[views.indexOf(view)] || 'Vista';
  const fail = code => { const error = new Error(code); error.code = code; throw error; };
  function source(photo) {
    return photo.dataUrl || (photo.b64 ? 'data:' + (photo.mimeType || 'image/jpeg') + ';base64,' + photo.b64 : '');
  }
  function snapshot(state) {
    if (!state || !Array.isArray(state.photos) || !state.photos.length || state.photos.length > 8) fail('CASE_EMPTY');
    const seen = new Set();
    const photos = state.photos.map(photo => {
      if (!views.includes(photo.view) || seen.has(photo.view) || photo.synthetic) fail('CASE_INVALID');
      seen.add(photo.view);
      // Only accepted, integrated results. Never raw/pendingGeneratedByView.
      return { view: photo.view, original: source(photo), result: state.results?.[photo.view] || null };
    });
    if (!photos.some(photo => photo.result)) fail('CASE_EMPTY');
    const design = state.smileDesign || {};
    if (!['alignment','veneers','combined'].includes(design.mode) || !['upper','lower','both'].includes(design.arch)) fail('CASE_INVALID');
    return {
      schema: 1, photos,
      settings: { mode: design.mode, arch: design.arch, tone: design.mode === 'alignment' || state.vitaMode === 'current' ? 'original' : state.vitaTone || 'A1', alignmentStyle: design.alignmentStyle || 'faithful', finish: state.vitaFinish || 'natural', construction: state.vitaConstruction || 'layered', intensity: state.vitaIntensity || 'balanced', instructions: String(design.instructions || '').slice(0,500) }
    };
  }
  function imageData(src) {
    // Do not fetch arbitrary remote/blob URLs or upload a pending crop by fallback.
    const match = typeof src === 'string' && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
    if (!match || match[2].length % 4 || match[2].length > 14000000) fail('CASE_IMAGE');
    const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
    if (bytes.length > 10 * 1024 * 1024) fail('CASE_SIZE');
    const type = match[1];
    const valid = type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : type === 'image/png' ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
      : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
    if (!valid || bytes.length < 16) fail('CASE_IMAGE');
    return { bytes, type, extension: type.split('/')[1] };
  }
  async function digest(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2,'0')).join('');
  }
  async function prepare(snap, tenant, id) {
    if (!uuid(tenant) || !uuid(id)) fail('CASE_INVALID');
    const document = { schema: 1, settings: { ...snap.settings }, views: [] }, uploads = [];
    let total = 0;
    for (const photo of snap.photos) {
      const view = { view: photo.view, original: null, result: null };
      for (const role of ['original','result']) {
        if (role === 'result' && !photo.result) continue;
        const image = imageData(photo[role]); total += image.bytes.length;
        if (total > 40 * 1024 * 1024) fail('CASE_SIZE');
        const hash = await digest(image.bytes);
        const path = [tenant, id, photo.view, role + '-' + hash + '.' + image.extension].join('/');
        view[role] = { path, sha256: hash, bytes: image.bytes.length, mime: image.type };
        uploads.push({ ...view[role], blob: new Blob([image.bytes], { type: image.type }) });
      }
      document.views.push(view);
    }
    return { document, uploads };
  }
  function validAsset(asset, tenant, id, view, role) {
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || !['image/png','image/jpeg','image/webp'].includes(asset.mime)) return false;
    return Number.isInteger(asset.bytes) && asset.bytes > 0 && asset.bytes <= 10 * 1024 * 1024 && asset.path === [tenant,id,view,role + '-' + asset.sha256 + '.' + asset.mime.split('/')[1]].join('/');
  }
  function validRow(row, tenant, patient) {
    if (!row || !uuid(row.id) || row.tenant_id !== tenant || !uuid(row.patient_id) || (patient && row.patient_id !== patient) || row.document?.schema !== 1) return false;
    const items = row.document.views;
    return Array.isArray(items) && items.length > 0 && items.length <= 8 && items.every(item => item && typeof item === 'object') && new Set(items.map(item => item.view)).size === items.length && items.some(item => item.result) && items.every(item => views.includes(item.view) && validAsset(item.original, tenant, row.id, item.view, 'original') && (!item.result || validAsset(item.result, tenant, row.id, item.view, 'result')));
  }
  function message(error) {
    const code = error?.code;
    if (['PGRST202','42883','CASE_UNAVAILABLE'].includes(code)) return 'El guardado en pacientes todavía no está activado. Tu comparación sigue aquí; no se ha guardado en una ficha.';
    if (['CASE_AUTH','42501'].includes(code)) return 'Inicia sesión con la cuenta titular de esta clínica para continuar.';
    if (code === 'CASE_EMPTY') return 'Primero genera y acepta al menos una vista. Las fotografías de apoyo pueden quedarse sin generar.';
    if (code === 'CASE_IMAGE') return 'No se pudo preparar una de las imágenes para guardarla. Conserva esta pantalla; no se ha confirmado el guardado.';
    if (code === 'CASE_SIZE') return 'Este caso supera el tamaño admitido. Conserva las imágenes; no se ha guardado en una ficha.';
    if (code === '40001') return 'El caso tiene otro guardado. Revisa su ficha antes de intentar asociarlo nuevamente.';
    if (code === 'CASE_CHANGED') return 'Cambió la sesión o la simulación. No continuamos el guardado para evitar asociar datos incorrectos.';
    return 'No pudimos confirmar el guardado. Reintenta desde aquí: mantendremos el mismo caso para evitar duplicados.';
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  return { views, label, uuid, snapshot, prepare, digest, validRow, message, fail, same };
});
