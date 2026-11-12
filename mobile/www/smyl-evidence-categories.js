/* SMYL · Categorías clínicas del archivo de evidencia.
 * La categoría expresa el propósito clínico; nunca reemplaza el tipo técnico del original. */
(function evidenceCategoriesModule(global) {
  'use strict';

  const SUGGESTIONS = Object.freeze([
    ['diagnostic_initial', 'Diagnóstico inicial'],
    ['orthodontics', 'Ortodoncia'],
    ['endodontics', 'Endodoncia'],
    ['periodontics', 'Periodoncia'],
    ['implants', 'Implantes'],
    ['oral_surgery', 'Cirugía'],
    ['rehabilitation', 'Rehabilitación'],
    ['followup', 'Seguimiento']
  ].map(([key, name], index) => Object.freeze({ key, name, order: (index + 1) * 10 })));

  function unavailable(error) {
    return ['42P01', 'PGRST205', 'PGRST202'].includes(String(error?.code || ''));
  }

  async function checked(promise, timeout) {
    const response = await (typeof global.sbTimeout === 'function'
      ? global.sbTimeout(promise, timeout || 20000)
      : promise);
    if (response?.error) throw response.error;
    return response?.data;
  }

  function client() {
    if (!global.sb?.from || !global.sb?.rpc) throw new Error('Las categorías clínicas no están disponibles en esta sesión.');
    return global.sb;
  }

  function normalizeCategory(row) {
    return {
      id: String(row?.id || ''),
      templateKey: String(row?.template_key || ''),
      name: String(row?.name || 'Categoría'),
      order: Number(row?.sort_order) || 100,
      archived: !!row?.archived_at,
      createdAt: String(row?.created_at || '')
    };
  }

  function normalizeAssignment(row) {
    return {
      id: String(row?.id || ''),
      patientId: String(row?.patient_id || ''),
      sourceType: String(row?.source_type || ''),
      sourceId: String(row?.source_id || ''),
      categoryId: String(row?.category_id || ''),
      active: !row?.revoked_at,
      assignedAt: String(row?.assigned_at || '')
    };
  }

  async function load(tenant, patient) {
    if (!tenant || !patient) return { available: false, categories: [], assignments: [], suggestions: SUGGESTIONS };
    try {
      const sb = client();
      const [categoryRows, assignmentRows] = await Promise.all([
        checked(sb.from('smyl_evidence_categories')
          .select('id,tenant_id,template_key,name,sort_order,archived_at,created_at')
          .eq('tenant_id', tenant)
          .order('sort_order')
          .order('name')),
        checked(sb.from('smyl_evidence_category_assignments')
          .select('id,tenant_id,patient_id,source_type,source_id,category_id,assigned_at,revoked_at')
          .eq('tenant_id', tenant)
          .eq('patient_id', patient)
          .order('assigned_at', { ascending: false }))
      ]);
      return {
        available: true,
        categories: (categoryRows || []).map(normalizeCategory),
        assignments: (assignmentRows || []).map(normalizeAssignment),
        suggestions: SUGGESTIONS
      };
    } catch (error) {
      if (unavailable(error)) return { available: false, categories: [], assignments: [], suggestions: SUGGESTIONS };
      throw error;
    }
  }

  async function activate(templateKey) {
    const suggestion = SUGGESTIONS.find(item => item.key === templateKey);
    if (!suggestion) throw new Error('La categoría sugerida no es válida.');
    const row = await checked(client().rpc('smyl_activate_evidence_category', {
      p_template_key: suggestion.key,
      p_name: suggestion.name
    }));
    dispatchEvent(new CustomEvent('smyl:evidence-categories-changed', { detail: { action: 'activate', categoryId: row?.id || '' } }));
    return normalizeCategory(row);
  }

  async function create(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 48) throw new Error('Escribe un nombre de 2 a 48 caracteres.');
    const row = await checked(client().rpc('smyl_activate_evidence_category', {
      p_template_key: null,
      p_name: clean
    }));
    dispatchEvent(new CustomEvent('smyl:evidence-categories-changed', { detail: { action: 'create', categoryId: row?.id || '' } }));
    return normalizeCategory(row);
  }

  async function archive(categoryId) {
    const row = await checked(client().rpc('smyl_archive_evidence_category', { p_category_id: categoryId }));
    dispatchEvent(new CustomEvent('smyl:evidence-categories-changed', { detail: { action: 'archive', categoryId } }));
    return normalizeCategory(row);
  }

  async function setCategory(patientId, sourceType, sourceId, categoryId, active) {
    const value = await checked(client().rpc('smyl_set_evidence_category', {
      p_patient_id: patientId,
      p_source_type: sourceType,
      p_source_id: String(sourceId || ''),
      p_category_id: categoryId,
      p_active: active !== false
    }));
    return value;
  }

  global.SmylEvidenceCategories = Object.freeze({
    suggestions: SUGGESTIONS,
    load,
    activate,
    create,
    archive,
    setCategory
  });
})(window);
