/* SMYL · Contrato visual compartido para revisión de evidencia clínica.
 * Este módulo no interpreta evidencia ni persiste decisiones. Normaliza la
 * navegación, los estados y la semántica visual para que cada modalidad pueda
 * conservar su visor y analizador especializados. */
(function smylEvidenceWorkspaceModule(global) {
  'use strict';

  const model = global.SmylEvidenceModel || {};
  const FALLBACK_PHASES = Object.freeze([
    Object.freeze({ key: 'original', label: 'Original' }),
    Object.freeze({ key: 'quality', label: 'Calidad' }),
    Object.freeze({ key: 'suggestions', label: 'Sugerencias' }),
    Object.freeze({ key: 'decision', label: 'Decisión' }),
    Object.freeze({ key: 'history', label: 'Historial' })
  ]);

  const PHASES = Object.freeze((Array.isArray(model.WORKSPACE_PHASES) && model.WORKSPACE_PHASES.length
    ? model.WORKSPACE_PHASES
    : FALLBACK_PHASES).map(phase => Object.freeze({ key: String(phase.key), label: String(phase.label) })));
  const PHASE_STATE_VALUES = Object.freeze(Array.isArray(model.WORKSPACE_PHASE_STATES) && model.WORKSPACE_PHASE_STATES.length
    ? model.WORKSPACE_PHASE_STATES.slice()
    : ['pending', 'current', 'complete', 'skipped', 'error']);
  const PHASE_STATES = new Set(PHASE_STATE_VALUES);
  const ANALYSIS_STATES = Object.freeze(Array.isArray(model.ANALYSIS_STATES) && model.ANALYSIS_STATES.length
    ? model.ANALYSIS_STATES.slice()
    : ['pending', 'running', 'ready', 'failed', 'unsupported']);
  const FALLBACK_CAPABILITIES = Object.freeze({
    photograph: Object.freeze({ viewer: 'image', qc: true, analysis: true, decision: true, history: true }),
    radiograph_2d: Object.freeze({ viewer: 'radiograph', qc: true, analysis: true, decision: true, history: true }),
    scan_model: Object.freeze({ viewer: 'mesh_3d', qc: false, analysis: false, decision: false, history: false }),
    clinical_measurement: Object.freeze({ viewer: 'structured', qc: false, analysis: false, decision: false, history: false }),
    document: Object.freeze({ viewer: 'document', qc: false, analysis: false, decision: false, history: true }),
    cbct_3d: Object.freeze({ viewer: 'dicom', qc: false, analysis: false, decision: false, history: false })
  });
  const CAPABILITIES = Object.freeze(model.MODALITY_CAPABILITIES || FALLBACK_CAPABILITIES);

  function phaseLabel(key) {
    return PHASES.find(phase => phase.key === key)?.label || key;
  }

  function normalizePhaseState(value) {
    return PHASE_STATES.has(value) ? value : 'pending';
  }

  function getCapabilities(modality) {
    const value = CAPABILITIES[String(modality || '')];
    return value ? Object.freeze({ ...value }) : null;
  }

  function dedupeErrors(errors) {
    const list = Array.isArray(errors) ? errors : errors == null ? [] : [errors];
    const unique = new Map();
    list.forEach(value => {
      const source = typeof value === 'string' ? { message: value } : (value && typeof value === 'object' ? value : { message: String(value) });
      const message = String(source.message || source.error || 'No se pudo completar la operación.').trim();
      const code = String(source.code || 'evidence_error').trim();
      const operation = String(source.operation || '').trim();
      const key = `${operation}\u0000${code}\u0000${message}`;
      const existing = unique.get(key);
      if (existing) existing.count += 1;
      else unique.set(key, { code, message, operation, count: 1 });
    });
    return Array.from(unique.values());
  }

  function setFeedback(node, input) {
    if (!node) return false;
    const value = input || {};
    const message = String(value.message || '').trim();
    const tone = String(value.tone || 'neutral').trim();
    const key = String(value.key || `${tone}:${message}`).trim();
    if (!message) {
      node.textContent = '';
      delete node.dataset.feedbackKey;
      delete node.dataset.feedbackCount;
      node.dataset.tone = tone;
      return true;
    }
    if (node.dataset.feedbackKey === key) {
      node.dataset.feedbackCount = String((Number(node.dataset.feedbackCount) || 1) + 1);
      return false;
    }
    node.textContent = message;
    node.dataset.tone = tone;
    node.dataset.feedbackKey = key;
    node.dataset.feedbackCount = '1';
    return true;
  }

  function createProgress(options) {
    const settings = options || {};
    const owner = settings.document || global.document;
    const root = owner.createElement('ol');
    root.className = 'smyl-ew-progress';
    root.setAttribute('aria-label', settings.ariaLabel || 'Progreso de la revisión clínica');
    PHASES.forEach((phase, index) => {
      const item = owner.createElement('li');
      item.className = 'smyl-ew-progress__item';
      item.dataset.phase = phase.key;
      item.dataset.state = 'pending';
      const marker = owner.createElement('span');
      marker.className = 'smyl-ew-progress__marker';
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = String(index + 1);
      const label = owner.createElement('span');
      label.className = 'smyl-ew-progress__label';
      label.textContent = phase.label;
      const status = owner.createElement('span');
      status.className = 'smyl-ew-progress__status';
      status.textContent = 'Pendiente';
      item.append(marker, label, status);
      root.append(item);
    });
    setProgress(root, settings.states || {});
    return root;
  }

  function setProgress(root, states) {
    if (!root) return root;
    const values = states || {};
    let currentKey = '';
    let currentAssigned = false;
    PHASES.forEach(phase => {
      const item = root.querySelector(`[data-phase="${phase.key}"]`);
      if (!item) return;
      let value = normalizePhaseState(values[phase.key]);
      if (value === 'current' && currentAssigned) value = 'pending';
      item.dataset.state = value;
      item.removeAttribute('aria-current');
      if (value === 'current') {
        item.setAttribute('aria-current', 'step');
        currentKey = phase.key;
        currentAssigned = true;
      }
      const marker = item.querySelector('.smyl-ew-progress__marker');
      const status = item.querySelector('.smyl-ew-progress__status');
      if (marker) marker.textContent = value === 'complete' ? '✓' : String(PHASES.indexOf(phase) + 1);
      if (status) status.textContent = value === 'complete' ? 'Listo' : value === 'current' ? 'En curso' : value === 'skipped' ? 'Omitido' : value === 'error' ? 'Revisar' : 'Pendiente';
    });
    root.dataset.currentPhase = currentKey;
    return root;
  }

  function photoProgress(input) {
    const value = input || {};
    const quality = ['usable', 'limited', 'unusable'].includes(value.quality) ? value.quality : 'pending';
    const findings = Math.max(0, Number(value.findings) || 0);
    const pending = Math.max(0, Number(value.pending) || 0);
    const reviewed = Math.max(0, Number(value.reviewed) || 0);
    const closed = Boolean(value.closed);
    const analyzing = Boolean(value.analyzing);
    const failed = Boolean(value.failed);
    const noSuggestions = quality !== 'pending' && findings === 0;

    if (closed || (findings > 0 && pending === 0 && reviewed > 0)) {
      return { original: 'complete', quality: 'complete', suggestions: quality === 'unusable' ? 'skipped' : 'complete', decision: 'complete', history: 'current' };
    }
    if (pending > 0) {
      return { original: 'complete', quality: 'complete', suggestions: 'complete', decision: 'current', history: 'pending' };
    }
    if (quality === 'unusable') {
      return { original: 'complete', quality: 'complete', suggestions: 'skipped', decision: 'current', history: 'pending' };
    }
    if (failed) {
      return { original: 'complete', quality: quality === 'pending' ? 'current' : 'complete', suggestions: 'error', decision: 'pending', history: 'pending' };
    }
    if (analyzing) {
      return { original: 'complete', quality: 'complete', suggestions: 'current', decision: 'pending', history: 'pending' };
    }
    if (noSuggestions) {
      return { original: 'complete', quality: 'complete', suggestions: 'complete', decision: 'current', history: 'pending' };
    }
    return { original: 'complete', quality: 'current', suggestions: 'pending', decision: 'pending', history: 'pending' };
  }

  function radiographProgress(input) {
    const value = input || {};
    const quality = ['usable', 'limited', 'unusable'].includes(value.quality) ? value.quality : 'pending';
    const analysis = ANALYSIS_STATES.includes(value.analysis) ? value.analysis
      : value.analysisRunning ? 'running'
        : value.analysisFailed ? 'failed'
          : value.analysisReady ? 'ready'
            : 'pending';
    const pending = Math.max(0, Number(value.pending) || 0);
    const reviewed = Math.max(0, Number(value.reviewed) || 0);
    const closed = Boolean(value.closed || value.signed);
    if (closed || (reviewed > 0 && pending === 0 && analysis === 'ready')) {
      return { original: 'complete', quality: 'complete', suggestions: quality === 'unusable' || analysis === 'unsupported' ? 'skipped' : 'complete', decision: 'complete', history: 'current' };
    }
    if (pending > 0) return { original: 'complete', quality: 'complete', suggestions: 'complete', decision: 'current', history: 'pending' };
    if (quality === 'unusable' || analysis === 'unsupported') return { original: 'complete', quality: 'complete', suggestions: 'skipped', decision: 'current', history: 'pending' };
    if (analysis === 'failed') return { original: 'complete', quality: quality === 'pending' ? 'current' : 'complete', suggestions: 'error', decision: 'pending', history: 'pending' };
    if (analysis === 'running') return { original: 'complete', quality: 'complete', suggestions: 'current', decision: 'pending', history: 'pending' };
    if (analysis === 'ready') return { original: 'complete', quality: 'complete', suggestions: 'complete', decision: 'current', history: 'pending' };
    return { original: 'complete', quality: 'current', suggestions: 'pending', decision: 'pending', history: 'pending' };
  }

  function decorateWorkspace(node, modality) {
    if (!node) return node;
    node.classList.add('smyl-evidence-workspace');
    if (modality) node.dataset.evidenceModality = String(modality);
    return node;
  }

  global.SmylEvidenceWorkspace = Object.freeze({
    phases: PHASES,
    phaseStates: PHASE_STATE_VALUES,
    analysisStates: ANALYSIS_STATES,
    capabilities: CAPABILITIES,
    phaseLabel,
    getCapabilities,
    createProgress,
    setProgress,
    photoProgress,
    radiographProgress,
    dedupeErrors,
    setFeedback,
    decorate: decorateWorkspace
  });
})(window);
