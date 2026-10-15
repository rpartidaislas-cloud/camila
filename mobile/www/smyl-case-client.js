/* Frontend adapter for the private case contract; activation is per clinic.
 * Capability check must succeed before listing patients or uploading any bytes.
 * No fallback to camila_casos, public buckets, localStorage or LANA. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./smyl-case-model.js'));
  else root.SmylCaseClient = factory(root.SmylCaseModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const bucket = 'smyl-case-photos';
  async function checked(promise) {
    let timer;
    try {
      const result = await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), 20000); })]);
      if (result?.error) throw result.error;
      if (!result || result.data == null) throw new Error('Unconfirmed response');
      return result.data;
    } finally { clearTimeout(timer); }
  }
  async function connect(client, tenant, isCurrent) {
    if (!client?.auth?.getUser || !M.uuid(tenant) || !isCurrent()) M.fail('CASE_AUTH');
    const identity = await checked(client.auth.getUser());
    if (!identity.user || identity.user.id !== tenant || identity.user.is_anonymous !== false) M.fail('CASE_AUTH');
    const capability = await checked(client.rpc('smyl_case_capabilities', {}));
    if (!isCurrent()) M.fail('CASE_CHANGED');
    if (capability.schema !== 1 || capability.enabled !== true || capability.tenant_id !== tenant || capability.bucket !== bucket || capability.private !== true) M.fail('CASE_UNAVAILABLE');
    async function guard() {
      const data = await checked(client.auth.getSession());
      if (!isCurrent() || data.session?.user?.id !== tenant || data.session.user.is_anonymous !== false) M.fail('CASE_CHANGED');
    }
    return {
      async patients() {
        await guard();
        const rows = await checked(client.from('camila_pacientes').select('id,tenant_id,nombre,apellido').eq('tenant_id', tenant).order('nombre').limit(1000));
        await guard();
        if (!Array.isArray(rows) || rows.some(p => p.tenant_id !== tenant || !M.uuid(p.id))) M.fail('CASE_INVALID');
        return rows;
      },
      async save(attempt) {
        await guard();
        const patient = attempt?.patient_id || attempt?.new_patient?.id;
        if (!attempt || (!!attempt.patient_id === !!attempt.new_patient) || !M.validRow({ id: attempt.id, tenant_id: tenant, patient_id: patient, document: attempt.document }, tenant, patient)) M.fail('CASE_INVALID');
        if (attempt.new_patient && (typeof attempt.new_patient.nombre !== 'string' || !attempt.new_patient.nombre.trim() || attempt.new_patient.nombre.length > 150)) M.fail('CASE_INVALID');
        const assets = attempt.document.views.flatMap(view => [view.original,view.result].filter(Boolean));
        if (!Array.isArray(attempt.uploads) || assets.length !== attempt.uploads.length || assets.reduce((sum,asset) => sum + asset.bytes, 0) > 40 * 1024 * 1024) M.fail('CASE_INVALID');
        for (let i = 0; i < assets.length; i++) {
          const file = attempt.uploads[i], asset = assets[i];
          if (!file || file.path !== asset.path || file.sha256 !== asset.sha256 || file.mime !== asset.mime || file.bytes !== asset.bytes || !(file.blob instanceof Blob) || file.blob.size !== asset.bytes || await M.digest(await file.blob.arrayBuffer()) !== asset.sha256) M.fail('CASE_IMAGE');
        }
        const storage = client.storage.from(bucket);
        for (const asset of attempt.uploads) {
          await guard();
          try { await checked(storage.upload(asset.path, asset.blob, { contentType: asset.mime, upsert: false })); }
          catch (error) {
            // A successful upload may have lost its response. Verify bytes, never overwrite.
            await guard();
            const existing = await checked(storage.download(asset.path));
            if (!(existing instanceof Blob) || existing.size !== asset.bytes || await M.digest(await existing.arrayBuffer()) !== asset.sha256) throw error;
          }
        }
        await guard();
        const row = await checked(client.rpc('smyl_save_patient_case', { p_id: attempt.id, p_patient_id: attempt.patient_id || null, p_new_patient: attempt.new_patient || null, p_document: attempt.document }));
        await guard();
        if (!M.validRow(row, tenant, patient) || row.id !== attempt.id || !M.same(row.document, attempt.document)) M.fail('CASE_INVALID');
        return row;
      },
      async list(patient) {
        if (!M.uuid(patient)) M.fail('CASE_INVALID');
        await guard();
        const rows = await checked(client.rpc('smyl_patient_cases', { p_patient_id: patient }));
        await guard();
        if (!Array.isArray(rows) || rows.length > 100 || rows.some(row => !M.validRow(row, tenant, patient))) M.fail('CASE_INVALID');
        return rows;
      },
      async image(row, asset) {
        if (!M.validRow(row, tenant) || !row.document.views.some(view => view.original === asset || view.result === asset)) M.fail('CASE_INVALID');
        await guard();
        const file = await checked(client.storage.from(bucket).download(asset.path));
        await guard();
        if (!(file instanceof Blob) || file.size !== asset.bytes || await M.digest(await file.arrayBuffer()) !== asset.sha256) M.fail('CASE_IMAGE');
        return URL.createObjectURL(new Blob([file], { type: asset.mime }));
      }
    };
  }
  return { connect };
});
