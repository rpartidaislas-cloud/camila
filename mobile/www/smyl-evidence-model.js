/* SMYL · Centro de evidencia clínica — contrato de navegador v1.
   Organiza evidencia por modalidad sin convertir una sugerencia de IA en diagnóstico.
   El original, la interpretación profesional y la decisión sobre cada hallazgo son capas distintas. */
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylEvidenceModel = api;
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const SCHEMA_VERSION = 1;
  const MODALITIES = Object.freeze([
    'photograph',
    'radiograph_2d',
    'scan_model',
    'clinical_measurement',
    'document',
    'cbct_3d'
  ]);

  const SUBTYPES = Object.freeze({
    photograph: Object.freeze([
      'face_rest', 'face_smile', 'face_profile_right', 'face_profile_left',
      'intraoral_frontal', 'intraoral_right', 'intraoral_left',
      'occlusal_upper', 'occlusal_lower', 'localized', 'before_after'
    ]),
    radiograph_2d: Object.freeze([
      'periapical', 'bitewing', 'panoramic', 'occlusal', 'fmx',
      'cephalometric_lateral', 'cephalometric_pa', 'tmj_series', 'other'
    ]),
    scan_model: Object.freeze([
      'arch_upper', 'arch_lower', 'bite', 'restorative_preparation',
      'study_model', 'facial_scan', 'other'
    ]),
    clinical_measurement: Object.freeze([
      'periodontogram', 'pulp_test', 'percussion_palpation', 'bite_test',
      'mobility', 'occlusion', 'tmj_exam', 'soft_tissue_exam', 'caries_risk', 'other'
    ]),
    document: Object.freeze([
      'radiology_report', 'pathology_report', 'laboratory_report', 'referral',
      'consent', 'dental_lab_document', 'medical_clearance', 'other'
    ]),
    cbct_3d: Object.freeze(['cbct_dicom', 'medical_ct', 'mri', 'other'])
  });

  const MODALITY_LABELS = Object.freeze({
    photograph: 'Fotografías',
    radiograph_2d: 'Rayos X 2D',
    scan_model: 'Escaneos y modelos',
    clinical_measurement: 'Evaluaciones clínicas',
    document: 'Informes y documentos',
    cbct_3d: 'CBCT y 3D'
  });

  const SUBTYPE_LABELS = Object.freeze({
    face_rest: 'Rostro frontal en reposo',
    face_smile: 'Rostro frontal sonriendo',
    face_profile_right: 'Perfil derecho',
    face_profile_left: 'Perfil izquierdo',
    intraoral_frontal: 'Intraoral frontal',
    intraoral_right: 'Intraoral lateral derecha',
    intraoral_left: 'Intraoral lateral izquierda',
    occlusal_upper: 'Oclusal superior',
    occlusal_lower: 'Oclusal inferior',
    localized: 'Acercamiento clínico',
    before_after: 'Seguimiento antes y después',
    periapical: 'Periapical',
    bitewing: 'Bitewing / aleta de mordida',
    panoramic: 'Panorámica',
    occlusal: 'Radiografía oclusal',
    fmx: 'Serie completa / FMX',
    cephalometric_lateral: 'Cefalométrica lateral',
    cephalometric_pa: 'Cefalométrica posteroanterior',
    tmj_series: 'Serie de ATM',
    arch_upper: 'Escaneo de arcada superior',
    arch_lower: 'Escaneo de arcada inferior',
    bite: 'Registro digital de mordida',
    restorative_preparation: 'Preparación restauradora',
    study_model: 'Modelo de estudio',
    facial_scan: 'Escaneo facial',
    periodontogram: 'Periodontograma',
    pulp_test: 'Pruebas pulpares',
    percussion_palpation: 'Percusión y palpación',
    bite_test: 'Prueba de mordida',
    mobility: 'Movilidad',
    occlusion: 'Evaluación oclusal',
    tmj_exam: 'Evaluación de ATM',
    soft_tissue_exam: 'Tejidos blandos',
    caries_risk: 'Riesgo de caries',
    radiology_report: 'Informe radiológico',
    pathology_report: 'Histopatología / biopsia',
    laboratory_report: 'Informe de laboratorio',
    referral: 'Interconsulta o referencia',
    consent: 'Consentimiento',
    dental_lab_document: 'Documento de laboratorio dental',
    medical_clearance: 'Valoración médica',
    cbct_dicom: 'CBCT / serie DICOM',
    medical_ct: 'Tomografía médica',
    mri: 'Resonancia magnética',
    other: 'Otro estudio'
  });

  const STUDY_STATUSES = Object.freeze(['draft', 'ready', 'under_review', 'signed', 'superseded']);
  const QUALITY_STATES = Object.freeze(['pending', 'usable', 'limited', 'unusable']);
  // Contrato transversal de la mesa de evidencia. Describe el ciclo compartido
  // sin asumir que todas las modalidades usan el mismo analizador clínico.
  const WORKSPACE_PHASES = Object.freeze([
    Object.freeze({ key: 'original', label: 'Original' }),
    Object.freeze({ key: 'quality', label: 'Calidad' }),
    Object.freeze({ key: 'suggestions', label: 'Sugerencias' }),
    Object.freeze({ key: 'decision', label: 'Decisión' }),
    Object.freeze({ key: 'history', label: 'Historial' })
  ]);
  const WORKSPACE_PHASE_STATES = Object.freeze(['pending', 'current', 'complete', 'skipped', 'error']);
  const ANALYSIS_STATES = Object.freeze(['pending', 'running', 'ready', 'failed', 'unsupported']);
  const MODALITY_CAPABILITIES = Object.freeze({
    photograph: Object.freeze({ viewer: 'image', qc: true, analysis: true, decision: true, history: true }),
    radiograph_2d: Object.freeze({ viewer: 'radiograph', qc: true, analysis: true, decision: true, history: true }),
    scan_model: Object.freeze({ viewer: 'mesh_3d', qc: false, analysis: false, decision: false, history: false }),
    clinical_measurement: Object.freeze({ viewer: 'structured', qc: false, analysis: false, decision: false, history: false }),
    document: Object.freeze({ viewer: 'document', qc: false, analysis: false, decision: false, history: true }),
    cbct_3d: Object.freeze({ viewer: 'dicom', qc: false, analysis: false, decision: false, history: false })
  });
  const ANATOMY_SCOPES = Object.freeze(['whole_mouth', 'arch', 'quadrant', 'tooth', 'surface', 'soft_tissue_region', 'anatomical_region']);
  const SURFACES = Object.freeze(['M', 'D', 'O', 'I', 'V', 'B', 'L', 'P', 'C', 'R']);
  const ASSET_ROLES = Object.freeze(['original', 'derived', 'thumbnail', 'report', 'segmentation']);
  const CONTEXT_TYPES = Object.freeze(['odontogram', 'periodontogram', 'clinical_note', 'treatment_plan', 'appointment', 'diagnosis', 'comparison']);
  // `supersedes` sólo lo crea la acción clínica dedicada; nunca un vínculo genérico del cliente.
  const CONTEXT_RELATIONSHIPS = Object.freeze(['supports', 'derived_from', 'compares_with']);
  const FINDING_ORIGINS = Object.freeze(['professional', 'ai', 'imported']);
  const FINDING_STATES = Object.freeze(['pending', 'confirmed']);
  const DECISION_STATES = Object.freeze(['confirmed', 'corrected', 'rejected']);
  const EVIDENCE_LEVELS = Object.freeze(['clinical_observation', 'measurement', 'image_observation', 'report_extract', 'model_candidate']);
  const FINDING_CATEGORIES = Object.freeze([
    'quality', 'anatomy', 'caries_candidate', 'restoration', 'periodontal_support',
    'endodontic', 'periapical', 'pathology', 'implant', 'orthodontic', 'trauma',
    'prosthetic', 'temporomandibular', 'development', 'soft_tissue', 'occlusion', 'other'
  ]);
  const FDI = /^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/;
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

  const fail = message => { throw new Error(message); };
  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const clone = value => typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
  const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && [...value].length <= max;
  const optionalText = (value, max) => value == null || value === '' || text(value, 0, max);
  const isUuid = value => typeof value === 'string' && UUID.test(value);
  const isFdi = value => typeof value === 'string' && FDI.test(value);
  const isProbability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  const isJsonSize = (value, max) => {
    try { return JSON.stringify(value).length <= max; } catch (_) { return false; }
  };

  function isSubtypeAllowed(modality, subtype){
    return MODALITIES.includes(modality) && SUBTYPES[modality].includes(subtype);
  }

  function getSubtypes(modality){
    return MODALITIES.includes(modality) ? SUBTYPES[modality].slice() : [];
  }

  function getModalityLabel(modality){
    return MODALITY_LABELS[modality] || modality || '';
  }

  function getSubtypeLabel(subtype){
    return SUBTYPE_LABELS[subtype] || subtype || '';
  }

  function getModalityCapabilities(modality){
    const value = MODALITY_CAPABILITIES[modality];
    return value ? { ...value } : null;
  }

  function createStudyDraft(modality, subtype){
    if(!isSubtypeAllowed(modality, subtype)) fail('El tipo de evidencia no corresponde a la modalidad.');
    return {
      schema: SCHEMA_VERSION,
      modality,
      subtype,
      displayName: getSubtypeLabel(subtype),
      clinicalIndication: '',
      acquiredAt: null,
      sourceProvider: '',
      region: {},
      quality: { status: 'pending', flags: [], notes: '' },
      metadata: {}
    };
  }

  function parseStudyDraft(value){
    if(!isObject(value) || value.schema !== SCHEMA_VERSION) fail('La evidencia no usa un contrato compatible.');
    if(!isSubtypeAllowed(value.modality, value.subtype)) fail('El tipo de evidencia no corresponde a la modalidad.');
    if(!text(value.displayName, 1, 180)) fail('Escribe un nombre breve para la evidencia.');
    if(!optionalText(value.clinicalIndication, 2000)) fail('La indicación clínica es demasiado larga.');
    if(!(value.acquiredAt === null || (typeof value.acquiredAt === 'string' && !Number.isNaN(Date.parse(value.acquiredAt))))) fail('La fecha del estudio no es válida.');
    if(!optionalText(value.sourceProvider, 180)) fail('El proveedor del estudio es demasiado largo.');
    if(!isObject(value.region) || !isJsonSize(value.region, 4096)) fail('La región clínica no es válida.');
    if(!isObject(value.quality) || !QUALITY_STATES.includes(value.quality.status) || !Array.isArray(value.quality.flags)
      || value.quality.flags.length > 20 || !optionalText(value.quality.notes, 2000) || !isJsonSize(value.quality, 8192)) {
      fail('El control de calidad no es válido.');
    }
    if(value.quality.flags.some(flag => !isObject(flag) || !text(flag.code, 1, 80) || !optionalText(flag.note, 300))) {
      fail('Una bandera de calidad no es válida.');
    }
    if(!isObject(value.metadata) || !isJsonSize(value.metadata, 32768)) fail('Los datos especializados no son válidos.');
    return clone(value);
  }

  function parseAnatomyLink(value){
    if(!isObject(value) || !ANATOMY_SCOPES.includes(value.scope)) fail('El alcance anatómico no es válido.');
    const fdi = value.fdi == null || value.fdi === '' ? null : String(value.fdi);
    const surface = value.surface == null || value.surface === '' ? null : String(value.surface).toUpperCase();
    const regionCode = value.regionCode == null ? '' : String(value.regionCode).trim();
    if(fdi !== null && !isFdi(fdi)) fail('La pieza no usa numeración FDI válida.');
    if(surface !== null && !SURFACES.includes(surface)) fail('La superficie dental no es válida.');
    if(regionCode.length > 120) fail('La región anatómica es demasiado larga.');
    if(value.scope === 'tooth' && (!fdi || surface)) fail('Selecciona únicamente la pieza para este vínculo.');
    if(value.scope === 'surface' && (!fdi || !surface)) fail('Selecciona pieza y superficie.');
    if(['whole_mouth', 'arch', 'quadrant', 'soft_tissue_region', 'anatomical_region'].includes(value.scope) && (fdi || surface)) fail('Este alcance no admite pieza o superficie.');
    if(['arch', 'quadrant', 'soft_tissue_region', 'anatomical_region'].includes(value.scope) && !regionCode) fail('Indica la región anatómica.');
    const geometry = value.geometry == null ? null : value.geometry;
    if(geometry !== null && (!isObject(geometry) || !isJsonSize(geometry, 8192))) fail('La geometría anatómica no es válida.');
    return { scope: value.scope, fdi, surface, regionCode, geometry };
  }

  function parseContextLink(value){
    if(!isObject(value) || !CONTEXT_TYPES.includes(value.contextType)) fail('El tipo de vínculo clínico no es válido.');
    if(!isUuid(value.contextId)) fail('El destino del vínculo clínico no es válido.');
    const relationship = value.relationship || 'supports';
    if(!CONTEXT_RELATIONSHIPS.includes(relationship)) fail('La relación clínica no es válida.');
    return { contextType: value.contextType, contextId: value.contextId, relationship };
  }

  function parseFindingDraft(value){
    if(!isObject(value) || !FINDING_ORIGINS.includes(value.origin)) fail('El origen del hallazgo no es válido.');
    if(!FINDING_CATEGORIES.includes(value.category)) fail('La categoría del hallazgo no es válida.');
    if(!EVIDENCE_LEVELS.includes(value.evidenceLevel)) fail('El nivel de evidencia no es válido.');
    if(!text(value.label, 1, 160) || !optionalText(value.description, 2000)) fail('Describe el hallazgo de forma breve.');
    const anatomy = parseAnatomyLink(value.anatomy || { scope: 'whole_mouth' });
    const confidence = value.confidence == null ? null : value.confidence;
    if(value.origin === 'ai' && !isProbability(confidence)) fail('Una sugerencia de IA debe incluir probabilidad entre 0 y 1.');
    if(value.origin !== 'ai' && confidence !== null) fail('La probabilidad sólo corresponde a sugerencias de IA.');
    const initialState = value.initialState || (value.origin === 'professional' ? 'confirmed' : 'pending');
    if(!FINDING_STATES.includes(initialState)) fail('El estado inicial del hallazgo no es válido.');
    if(value.origin === 'ai' && initialState !== 'pending') fail('La IA nunca confirma automáticamente un hallazgo.');
    if(value.origin === 'imported' && initialState !== 'pending') fail('Un hallazgo importado requiere revisión profesional.');
    const model = value.model == null ? null : value.model;
    if(value.origin === 'ai' && (!isObject(model) || !text(model.provider, 1, 60) || !text(model.name, 1, 100) || !isJsonSize(model, 4096))) fail('Identifica el motor que generó la sugerencia.');
    if(value.origin !== 'ai' && model !== null) fail('Sólo una sugerencia de IA incluye datos del motor.');
    const payload = value.payload == null ? {} : value.payload;
    if(!isObject(payload) || !isJsonSize(payload, 16384)) fail('Los datos del hallazgo no son válidos.');
    return { origin: value.origin, category: value.category, evidenceLevel: value.evidenceLevel,
      label: value.label.trim(), description: String(value.description || '').trim(), anatomy,
      confidence, initialState, model: clone(model), payload: clone(payload) };
  }

  function parseDecision(state, correction, note){
    if(!DECISION_STATES.includes(state)) fail('La decisión profesional no es válida.');
    const normalizedCorrection = correction == null ? {} : correction;
    if(!isObject(normalizedCorrection) || !isJsonSize(normalizedCorrection, 16384)) fail('La corrección profesional no es válida.');
    if(state === 'corrected' && Object.keys(normalizedCorrection).length === 0) fail('Describe la corrección profesional.');
    if(state !== 'corrected' && Object.keys(normalizedCorrection).length > 0) fail('Sólo una corrección lleva datos modificados.');
    if(!optionalText(note, 1000)) fail('La nota de decisión es demasiado larga.');
    return { state, correction: clone(normalizedCorrection), note: String(note || '').trim() };
  }

  function parseReportDocument(value, strict){
    if(!isObject(value) || value.schema !== SCHEMA_VERSION) fail('El informe no usa un contrato compatible.');
    const contractKeys = ['schema', 'summary', 'technicalLimitations', 'clinicalCorrelation', 'recommendations', 'findingIds'];
    const suppliedKeys = Object.keys(value).sort();
    if(suppliedKeys.length !== contractKeys.length || contractKeys.slice().sort().some((key, index) => suppliedKeys[index] !== key)) {
      fail('El informe contiene campos no compatibles.');
    }
    const keys = ['summary', 'technicalLimitations', 'clinicalCorrelation', 'recommendations'];
    for(const key of keys) if(typeof value[key] !== 'string' || [...value[key]].length > 8000) fail('Una sección del informe no es válida.');
    if(strict && !text(value.summary || '', 2, 8000)) fail('Completa el resumen profesional antes de firmar.');
    if(!Array.isArray(value.findingIds) || value.findingIds.length > 200 || value.findingIds.some(id => !isUuid(id))) fail('Los hallazgos del informe no son válidos.');
    if(new Set(value.findingIds).size !== value.findingIds.length) fail('El informe contiene hallazgos repetidos.');
    return clone(value);
  }

  function summarizeStudy(study){
    const source = study || {};
    return {
      modality: getModalityLabel(source.modality),
      subtype: getSubtypeLabel(source.subtype),
      status: source.status || 'draft',
      quality: source.quality && source.quality.status ? source.quality.status : 'pending'
    };
  }

  const safe = fn => function(){
    try { return { ok: true, value: fn.apply(null, arguments) }; }
    catch(error){ return { ok: false, error: error.message }; }
  };

  return Object.freeze({
    SCHEMA_VERSION, MODALITIES, SUBTYPES, MODALITY_LABELS, SUBTYPE_LABELS,
    STUDY_STATUSES, QUALITY_STATES, WORKSPACE_PHASES, WORKSPACE_PHASE_STATES, ANALYSIS_STATES, MODALITY_CAPABILITIES,
    ANATOMY_SCOPES, SURFACES, ASSET_ROLES, CONTEXT_TYPES, CONTEXT_RELATIONSHIPS,
    FINDING_ORIGINS, FINDING_STATES, DECISION_STATES, EVIDENCE_LEVELS, FINDING_CATEGORIES,
    isSubtypeAllowed, getSubtypes, getModalityLabel, getSubtypeLabel, getModalityCapabilities, createStudyDraft,
    parseStudyDraft, parseAnatomyLink, parseContextLink, parseFindingDraft, parseDecision, parseReportDocument,
    validateStudyDraft: safe(parseStudyDraft), validateAnatomyLink: safe(parseAnatomyLink),
    validateContextLink: safe(parseContextLink),
    validateFindingDraft: safe(parseFindingDraft), validateReportDraft: safe(v => parseReportDocument(v, false)),
    validateReportForSignature: safe(v => parseReportDocument(v, true)), summarizeStudy
  });
});
