/* SMYL · Integración del Centro de evidencia con el expediente actual.
 * Capa de compatibilidad: sólo reutiliza fuentes y editores canónicos existentes.
 * No interpreta, confirma, firma ni guarda evidencia por sí sola. */
(function evidenceCenterIntegration(global) {
  'use strict';

  const FILE_MODALITY = Object.freeze({
    clinical_photo: ['photograph', 'localized'],
    radiograph: ['radiograph_2d', 'other'],
    laboratory: ['document', 'laboratory_report'],
    consent: ['document', 'consent'],
    referral: ['document', 'referral'],
    prescription: ['document', 'other'],
    other: ['document', 'other']
  });

  const DOCUMENT_CATEGORY = Object.freeze({
    laboratory_report: 'laboratory',
    pathology_report: 'laboratory',
    referral: 'referral',
    consent: 'consent',
    medical_clearance: 'other',
    radiology_report: 'other',
    dental_lab_document: 'other',
    other: 'other'
  });

  const CREATE_CAPABILITIES = Object.freeze({
    photograph: { enabled: true, route: 'patient_file' },
    radiograph_2d: { enabled: true, route: 'radiograph_editor' },
    document: { enabled: true, route: 'patient_file' },
    scan_model: {
      enabled: false,
      label: 'Carga 3D por activar',
      reason: 'Los escaneos y modelos todavía no tienen un cargador conectado en este expediente. No se guardará ningún dato.'
    },
    clinical_measurement: {
      enabled: false,
      label: 'Editor por activar',
      reason: 'Las evaluaciones estructuradas deben abrirse desde su editor clínico. Esta versión aún no tiene una ruta conectada; no se guardará ningún dato.'
    },
    cbct_3d: {
      enabled: false,
      label: 'Visor DICOM por activar',
      reason: 'CBCT/DICOM requiere un visor y almacenamiento especializados. Esta versión todavía no los tiene conectados; no se guardará ningún dato.'
    }
  });

  const TYPE_CAPABILITIES = Object.freeze({
    radiograph_2d: Object.freeze({
      periapical: true,
      bitewing: true,
      panoramic: true
    })
  });

  const PATHWAYS = Object.freeze([
    {
      id: 'restorative',
      label: 'Caries y restauradora',
      description: 'Relaciona exploración, fotografías y proyecciones apropiadas.',
      requirements: [
        ['Evaluación clínica', item => item.modality === 'clinical_measurement'],
        ['Fotografía intraoral', item => item.modality === 'photograph' && /intraoral|localized/.test(item.subtype)],
        ['Bitewing o periapical', item => item.modality === 'radiograph_2d' && ['bitewing', 'periapical'].includes(item.subtype)]
      ]
    },
    {
      id: 'endodontic',
      label: 'Endodoncia',
      description: 'Integra síntomas, pruebas pulpares y evidencia periapical.',
      requirements: [
        ['Pruebas pulpares', item => item.modality === 'clinical_measurement' && ['pulp_test', 'percussion_palpation', 'bite_test', 'mobility'].includes(item.subtype)],
        ['Radiografía periapical', item => item.modality === 'radiograph_2d' && item.subtype === 'periapical']
      ]
    },
    {
      id: 'periodontal',
      label: 'Periodoncia',
      description: 'Combina mediciones periodontales, imágenes y seguimiento.',
      requirements: [
        ['Periodontograma', item => item.modality === 'clinical_measurement' && item.subtype === 'periodontogram'],
        ['Serie o imagen indicada', item => item.modality === 'radiograph_2d' && ['fmx', 'periapical', 'panoramic'].includes(item.subtype)],
        ['Fotografías intraorales', item => item.modality === 'photograph' && /intraoral|occlusal/.test(item.subtype)]
      ]
    },
    {
      id: 'orthodontic',
      label: 'Ortodoncia',
      description: 'Ordena fotografías, panorámica, cefalometría y modelos.',
      requirements: [
        ['Serie fotográfica', item => item.modality === 'photograph'],
        ['Panorámica o cefalometría', item => item.modality === 'radiograph_2d' && ['panoramic', 'cephalometric_lateral', 'cephalometric_pa'].includes(item.subtype)],
        ['Escaneo o modelo', item => item.modality === 'scan_model']
      ]
    },
    {
      id: 'surgery',
      label: 'Implantes y cirugía',
      description: 'Agrupa planificación protésica e imagen seleccionada por el profesional.',
      requirements: [
        ['Modelo o escaneo', item => item.modality === 'scan_model'],
        ['Imagen 2D o 3D indicada', item => ['radiograph_2d', 'cbct_3d'].includes(item.modality)]
      ]
    },
    {
      id: 'pathology',
      label: 'Lesiones y patología',
      description: 'Conserva aspecto, evolución, región e informe especializado.',
      requirements: [
        ['Registro clínico o fotográfico', item => item.modality === 'photograph' || (item.modality === 'clinical_measurement' && item.subtype === 'soft_tissue_exam')],
        ['Informe o histopatología', item => item.modality === 'document' && ['pathology_report', 'radiology_report'].includes(item.subtype)]
      ]
    }
  ]);

  let active = null;
  let sequence = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function context() {
    const patient = global.pacienteActual;
    const tenant = global.tenantId;
    if (!patient?.id || patient._local || !tenant) return null;
    return { tenant: String(tenant), patient: String(patient.id) };
  }

  function current(state) {
    const value = context();
    return !!state && state.root?.isConnected && value?.tenant === state.tenant && value.patient === state.patient;
  }

  function legacyFileItem(file) {
    const mapped = FILE_MODALITY[file?.category] || FILE_MODALITY.other;
    return {
      id: String(file?.id || ''),
      modality: mapped[0],
      subtype: mapped[1],
      title: String(file?.name || file?.label || 'Archivo clínico'),
      date: String(file?.capturedAt || file?.createdAt || '').slice(0, 10),
      region: '',
      status: 'draft',
      findings: 0,
      source: 'patient_file'
    };
  }

  function radiographItem(study) {
    const subtype = ['panoramic', 'periapical', 'bitewing'].includes(study?.type) ? study.type : 'other';
    return {
      id: String(study?.id || ''),
      modality: 'radiograph_2d',
      subtype,
      title: String(study?.label || 'Radiografía dental'),
      date: String(study?.date || '').slice(0, 10),
      region: '',
      status: Number(study?.pending) > 0 ? 'review' : 'draft',
      findings: Math.max(0, Number(study?.pending) || 0) + Math.max(0, Number(study?.confirmed) || 0),
      source: 'dental_record'
    };
  }

  function collectEvidence(tenant, patient) {
    const files = global.SmylPatientEvidenceFiles?.all?.(tenant, patient)
      || global.SmylPatient360?.allFiles?.(tenant, patient)
      || global.SmylPatient360?.files?.(tenant, patient);
    const caseId = global.SmylCaseWorkspace?.context?.(tenant, patient)?.caseId;
    const dental = caseId ? global.SmylDentalProgress?.status?.(tenant, patient, caseId) : null;
    const items = [];
    (files?.items || []).forEach(file => items.push(legacyFileItem(file)));
    (dental?.studyItems || []).forEach(study => items.push(radiographItem(study)));
    const seen = new Set();
    return items.filter(item => {
      const key = `${item.source}:${item.id}`;
      if (!item.id || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function itemKey(item) {
    return [item?.id, item?.modality, item?.subtype].map(value => String(value || '')).join('\u001f');
  }

  function originMap(items) {
    return new Map((Array.isArray(items) ? items : []).map(item => [itemKey(item), {
      id: item.id,
      source: item.source
    }]));
  }

  function pathwayState(items, pathway) {
    const sources = pathway.requirements.map(([label, predicate]) => ({ label, available: items.some(predicate) }));
    return { ...pathway, sources, available: sources.filter(source => source.available).length, total: sources.length };
  }

  function renderPathways(state, items) {
    state.pathways.replaceChildren();
    const head = el('header', 'seci-pathway-head');
    const copy = el('div');
    copy.append(el('span', 'seci-kicker', 'ANÁLISIS CLÍNICOS'), el('h3', '', 'Reúne las fuentes por objetivo'), el('p', '', 'Cada análisis combina evidencia diferente; el profesional decide qué información es necesaria.'));
    head.append(copy);
    state.pathways.append(head);
    const grid = el('div', 'seci-pathway-grid');
    PATHWAYS.map(pathway => pathwayState(items, pathway)).forEach(pathway => {
      const card = el('details', 'seci-pathway');
      const summary = el('summary');
      const title = el('span');
      title.append(el('strong', '', pathway.label), el('small', '', pathway.description));
      const progress = el('span', 'seci-pathway-progress', `${pathway.available}/${pathway.total} fuentes`);
      progress.dataset.state = pathway.available === pathway.total ? 'available' : pathway.available ? 'partial' : 'empty';
      summary.append(title, progress);
      const list = el('ul');
      pathway.sources.forEach(source => {
        const row = el('li', '', source.label);
        row.dataset.available = String(source.available);
        row.prepend(el('span', '', source.available ? '✓' : '○'));
        list.append(row);
      });
      card.append(summary, list);
      grid.append(card);
    });
    state.pathways.append(grid, el('p', 'seci-safety', 'Las fuentes se seleccionan según la historia, la exploración y el beneficio clínico. SMYL no indica tomar imágenes de rutina.'));
  }

  function setFiles(input, file) {
    if (!input || !file || typeof DataTransfer !== 'function') return false;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function announce(state, message, tone) {
    if (!current(state)) return;
    state.feedback.textContent = message;
    state.feedback.dataset.tone = tone || 'neutral';
  }

  function creationCapability(modality) {
    return CREATE_CAPABILITIES[modality] || {
      enabled: false,
      reason: 'Esta modalidad todavía no tiene una ruta de guardado conectada. No se guardará ningún dato.'
    };
  }

  function showCapabilityNotice(state, message) {
    announce(state, message, 'attention');
    const body = state.center?.dialog?.querySelector('.sec-dialog-body');
    if (!body) return;
    body.querySelector('.seci-capability-notice')?.remove();
    body.prepend(el('p', 'seci-capability-notice', message));
  }

  function guardUnavailableCreation(state) {
    const center = state.center;
    if (!center?.dialog) return;
    const originalOpenAdd = center.openAdd.bind(center);
    center.openAdd = modality => {
      const capability = modality ? creationCapability(modality) : null;
      if (capability && !capability.enabled) {
        announce(state, capability.reason, 'attention');
        return false;
      }
      return originalOpenAdd(modality);
    };
    const originalRenderCategoryStep = center.renderCategoryStep.bind(center);
    center.renderCategoryStep = body => {
      originalRenderCategoryStep(body);
      const categories = global.SmylEvidenceCenter?.categories || [];
      [...body.querySelectorAll('.sec-category')].forEach((card, index) => {
        const category = categories[index];
        if (!category) return;
        const capability = creationCapability(category.id);
        card.dataset.modality = category.id;
        card.dataset.available = String(capability.enabled);
        if (!capability.enabled) {
          card.setAttribute('aria-disabled', 'true');
          card.title = capability.reason;
        }
      });
    };
    center.dialog.addEventListener('click', event => {
      const card = event.target.closest?.('.sec-category[data-available="false"]');
      if (!card) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showCapabilityNotice(state, creationCapability(card.dataset.modality).reason);
    }, true);
  }

  function prefillPatientFile(state, payload) {
    const dialog = document.querySelector('.p360-dialog[open]');
    if (!dialog) return;
    const captured = dialog.querySelector('input[name="captured"]');
    const notes = dialog.querySelector('textarea[name="notes"]');
    if (captured && payload.date) captured.value = payload.date;
    if (notes) notes.value = [payload.title, payload.region && `Región: ${payload.region}`].filter(Boolean).join('\n').slice(0, 1000);
    setFiles(dialog.querySelector('input[name="file"]'), payload.file);
    dialog.querySelector('input[name="file"]')?.focus({ preventScroll: true });
  }

  function routePatientFile(state, payload, category) {
    if (!global.SmylPatientFiles?.add?.(category)) throw new Error('Tu rol no permite agregar archivos a este expediente.');
    requestAnimationFrame(() => prefillPatientFile(state, payload));
    announce(state, 'Revisa el archivo y confirma la carga en la ficha privada. Todavía no se ha guardado.', 'attention');
  }

  function prefillRadiograph(state, payload) {
    const editor = document.querySelector('.cw-advanced-editor:not([hidden])');
    const form = editor?.querySelector('.dr-record');
    if (!form) {
      announce(state, 'No se pudo abrir el editor radiográfico. Ve a Hallazgos → Rayos X para agregarlo.', 'error');
      return;
    }
    const type = form.querySelector('.dr-study-type select');
    if (type) type.value = ['panoramic', 'periapical', 'bitewing'].includes(payload.subtype) ? payload.subtype : 'other';
    const inputs = [...form.querySelectorAll('.dr-upload-fields input')];
    const textInput = inputs.find(input => input.type === 'text');
    const dateInput = inputs.find(input => input.type === 'date');
    const fileInput = inputs.find(input => input.type === 'file');
    if (textInput) textInput.value = payload.title || '';
    if (dateInput) dateInput.value = payload.date || '';
    if (payload.file && !['image/jpeg', 'image/png'].includes(payload.file.type)) {
      announce(state, 'El editor radiográfico actual admite JPG o PNG. El archivo no se cargó ni se guardó.', 'error');
      return;
    }
    setFiles(fileInput, payload.file);
    fileInput?.focus({ preventScroll: true });
    announce(state, 'Radiografía preparada en el editor. Revísala y pulsa Guardar observaciones; todavía no se ha guardado.', 'attention');
  }

  function routeRadiograph(state, payload) {
    global.SmylCaseWorkspace?.open?.('review');
    const filters = [...document.querySelectorAll('.cw-map-filter')];
    filters.find(button => button.dataset.label === 'Rayos X')?.click();
    requestAnimationFrame(() => {
      const action = document.querySelector('.cw-evaluation-cta');
      if (action && !action.disabled) action.click();
      setTimeout(() => prefillRadiograph(state, payload), 0);
    });
  }

  async function routeDraft(state, payload) {
    if (!current(state)) throw new Error('El expediente cambió. Vuelve a abrir al paciente.');
    if (!global.SmylEvidenceModel?.isSubtypeAllowed?.(payload.modality, payload.subtype)) throw new Error('El tipo de evidencia no corresponde a la modalidad.');
    if (payload.modality === 'photograph') return routePatientFile(state, payload, 'clinical_photo');
    if (payload.modality === 'document') return routePatientFile(state, payload, DOCUMENT_CATEGORY[payload.subtype] || 'other');
    if (payload.modality === 'radiograph_2d') return routeRadiograph(state, payload);
    const labels = {
      scan_model: 'escaneos y modelos',
      clinical_measurement: 'evaluaciones clínicas estructuradas',
      cbct_3d: 'volúmenes CBCT/DICOM'
    };
    throw new Error(`El guardado de ${labels[payload.modality] || 'esta evidencia'} todavía no está habilitado. No se guardó ningún dato.`);
  }

  function openItem(state, item) {
    if (!current(state)) return;
    // SmylEvidenceCenter normaliza los elementos antes de devolverlos en onOpen.
    // Conservamos el origen fuera de la vista para no duplicar ni reinterpretar datos.
    const origin = state.origins.get(itemKey(item)) || item;
    if (origin.source === 'patient_file') {
      if (!global.SmylPatient360?.openFile?.(state.tenant, state.patient, origin.id)) announce(state, 'No se pudo abrir el archivo con los permisos actuales.', 'error');
      return;
    }
    if (origin.source === 'dental_record') {
      if (!global.SmylDentalProgress?.openStudy?.(state.tenant, state.patient, origin.id)) {
        global.SmylCaseWorkspace?.open?.('review');
        announce(state, 'Abre la capa Rayos X para consultar este estudio.', 'attention');
      }
    }
  }

  function refresh(state) {
    if (!current(state)) return dispose(state);
    const items = collectEvidence(state.tenant, state.patient);
    const fingerprint = JSON.stringify(items);
    if (fingerprint === state.fingerprint) return;
    state.fingerprint = fingerprint;
    state.origins = originMap(items);
    state.center.setItems(items);
    renderPathways(state, items);
  }

  function dispose(state) {
    if (!state) return;
    clearInterval(state.timer);
    state.center?.destroy?.();
    if (state.legacy?.isConnected) state.legacy.hidden = false;
    state.root?.remove();
    if (active === state) active = null;
  }

  function mount() {
    const value = context();
    const legacy = document.querySelector('#p-paciente-detalle.activa .cw-evidence-history');
    if (!value || !legacy || !global.SmylEvidenceCenter || !global.SmylEvidenceModel) return;
    if (current(active)) return;
    dispose(active);
    const root = el('section', 'seci-root');
    root.dataset.patientId = value.patient;
    const pathways = el('section', 'seci-pathways');
    const centerHost = el('div', 'seci-center');
    const feedback = el('p', 'seci-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    root.append(pathways, centerHost, feedback);
    legacy.before(root);
    const state = { token: ++sequence, root, pathways, centerHost, feedback, legacy, tenant: value.tenant, patient: value.patient, fingerprint: '', origins: new Map(), center: null, timer: null };
    active = state;
    try {
      state.center = global.SmylEvidenceCenter.mount(centerHost, {
        items: [],
        creationAvailability: modality => {
          const capability = creationCapability(modality);
          return { enabled: capability.enabled, label: capability.label || 'Por activar' };
        },
        typeAvailability: (modality, subtype) => {
          if (modality !== 'radiograph_2d') return { enabled: true };
          return TYPE_CAPABILITIES.radiograph_2d[subtype]
            ? { enabled: true }
            : { enabled: false, label: 'Editor especializado' };
        },
        onOpen: item => openItem(state, item),
        onCreate: payload => routeDraft(state, payload)
      });
      guardUnavailableCreation(state);
      legacy.hidden = true;
      refresh(state);
      state.timer = setInterval(() => refresh(state), 1400);
    } catch (error) {
      legacy.hidden = false;
      root.remove();
      active = null;
      console.warn('SMYL evidence center integration unavailable', error);
    }
  }

  function init() {
    const screen = document.getElementById('p-paciente-detalle');
    if (!screen) return;
    new MutationObserver(mount).observe(screen, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    ['smyl:dental-context-updated', 'smyl:patient-summary', 'smyl:case-selection'].forEach(name => addEventListener(name, () => {
      if (current(active)) refresh(active);
      else mount();
    }));
    mount();
  }

  global.SmylEvidenceCenterIntegration = Object.freeze({
    pathways: PATHWAYS,
    creationAvailability: Object.freeze(Object.fromEntries(Object.entries(CREATE_CAPABILITIES).map(([key, value]) => [key, Object.freeze({ enabled: value.enabled, label: value.label || '' })]))),
    collectEvidence,
    pathwayState,
    itemKey,
    originMap,
    creationCapability,
    legacyFileItem,
    radiographItem,
    mount
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
