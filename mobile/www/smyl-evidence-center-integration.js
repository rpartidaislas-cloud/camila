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
    const id = String(file?.id || '');
    const linkedStudySource = mapped[0] === 'radiograph_2d'
      ? 'dental_record'
      : mapped[0] === 'photograph'
        ? 'clinical_photo_study'
        : 'patient_file';
    return {
      id,
      modality: mapped[0],
      subtype: mapped[1],
      title: String(file?.name || file?.label || 'Archivo clínico'),
      date: String(file?.capturedAt || file?.createdAt || '').slice(0, 10),
      region: '',
      status: 'draft',
      findings: 0,
      source: 'patient_file',
      patientFileId: id,
      linkedStudyId: String(file?.studyId || file?.study_id || file?.metadata?.studyId || file?.metadata?.study_id || ''),
      linkedStudySource,
      sha256: String(file?.sha256 || file?.hash || ''),
      storagePath: String(file?.storagePath || file?.storage_path || file?.path || ''),
      aliases: id ? [{ source: 'patient_file', id }] : []
    };
  }

  function radiographItem(study) {
    const subtype = ['panoramic', 'periapical', 'bitewing'].includes(study?.type) ? study.type : 'other';
    const id = String(study?.id || '');
    const patientFileId = String(study?.patientFileId || study?.patient_file_id || study?.original?.patientFileId || study?.asset?.patient_file_id || '');
    return {
      id,
      modality: 'radiograph_2d',
      subtype,
      title: String(study?.label || 'Radiografía dental'),
      date: String(study?.date || '').slice(0, 10),
      region: '',
      status: Number(study?.pending) > 0 ? 'review' : 'draft',
      findings: Math.max(0, Number(study?.pending) || 0) + Math.max(0, Number(study?.confirmed) || 0),
      source: 'dental_record',
      patientFileId,
      linkedStudyId: id,
      linkedStudySource: 'dental_record',
      sha256: String(study?.sha256 || study?.hash || study?.original?.sha256 || study?.asset?.sha256 || ''),
      storagePath: String(study?.storagePath || study?.storage_path || study?.original?.path || study?.asset?.path || ''),
      aliases: [
        ...(id ? [{ source: 'dental_record', id }] : []),
        ...(patientFileId ? [{ source: 'patient_file', id: patientFileId }] : [])
      ]
    };
  }

  function regionLabel(region) {
    if (!region || typeof region !== 'object') return '';
    if (region.scope === 'tooth' && region.fdi) return `Pieza FDI ${region.fdi}`;
    const labels = {
      whole_mouth: 'Boca completa',
      upper_arch: 'Arcada superior',
      lower_arch: 'Arcada inferior',
      quadrant_1: 'Cuadrante 1 · superior derecho',
      quadrant_2: 'Cuadrante 2 · superior izquierdo',
      quadrant_3: 'Cuadrante 3 · inferior izquierdo',
      quadrant_4: 'Cuadrante 4 · inferior derecho',
      face: 'Rostro y sonrisa',
      soft_tissue: 'Tejidos blandos',
      localized: 'Zona localizada'
    };
    return labels[region.regionCode] || (region.scope === 'whole_mouth' ? labels.whole_mouth : '');
  }

  function photoStudyItem(study) {
    const pending = Math.max(0, Number(study?.pending) || 0);
    const reviewed = Math.max(0, Number(study?.confirmed) || 0) + Math.max(0, Number(study?.rejected) || 0);
    const status = study?.status === 'signed' ? 'signed' : pending > 0 ? 'review' : 'draft';
    const id = String(study?.id || '');
    const patientFileId = String(study?.original?.patientFileId || study?.asset?.patient_file_id || '');
    return {
      id,
      modality: 'photograph',
      subtype: String(study?.subtype || 'localized'),
      title: String(study?.display_name || study?.viewLabel || study?.label || 'Fotografía clínica'),
      date: String(study?.acquired_at || study?.created_at || '').slice(0, 10),
      region: regionLabel(study?.region),
      status,
      findings: pending + reviewed,
      source: 'clinical_photo_study',
      patientFileId,
      linkedStudyId: id,
      linkedStudySource: 'clinical_photo_study',
      sha256: String(study?.original?.sha256 || study?.original?.hash || study?.asset?.sha256 || ''),
      storagePath: String(study?.original?.path || study?.asset?.storage_path || study?.asset?.path || ''),
      aliases: [
        ...(id ? [{ source: 'clinical_photo_study', id }] : []),
        ...(patientFileId ? [{ source: 'patient_file', id: patientFileId }] : [])
      ]
    };
  }

  function canonicalEvidenceKeys(item) {
    const keys = [];
    const modality = String(item?.modality || item?.source || 'unknown');
    const linkedStudySource = String(item?.linkedStudySource || item?.source || modality);
    if (item?.patientFileId) keys.push(`patient-file:${item.patientFileId}`);
    if (item?.linkedStudyId) keys.push(`study:${linkedStudySource}:${item.linkedStudyId}`);
    if (item?.sha256) keys.push(`sha256:${modality}:${item.sha256}`);
    if (item?.storagePath) keys.push(`path:${modality}:${item.storagePath}`);
    if (item?.id && item?.source) keys.push(`source:${item.source}:${item.id}`);
    return [...new Set(keys)];
  }

  function mergeAliases(primary, secondary) {
    const aliases = [...(primary?.aliases || []), ...(secondary?.aliases || [])];
    const seen = new Set();
    return aliases.filter(alias => {
      const key = assignmentKey(alias?.source, alias?.id);
      if (!alias?.source || !alias?.id || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function deduplicateEvidence(items) {
    const result = [];
    const indexes = new Map();
    const priority = { patient_file: 0, dental_record: 1, clinical_photo_study: 2 };
    (Array.isArray(items) ? items : []).forEach(item => {
      if (!item?.id) return;
      const keys = canonicalEvidenceKeys(item);
      const existingIndex = keys.map(key => indexes.get(key)).find(index => Number.isInteger(index));
      if (!Number.isInteger(existingIndex)) {
        const nextIndex = result.length;
        result.push(item);
        keys.forEach(key => indexes.set(key, nextIndex));
        return;
      }
      const existing = result[existingIndex];
      const preferred = (priority[item.source] || 0) > (priority[existing.source] || 0) ? item : existing;
      const other = preferred === item ? existing : item;
      result[existingIndex] = { ...preferred, aliases: mergeAliases(preferred, other) };
      [...canonicalEvidenceKeys(existing), ...keys].forEach(key => indexes.set(key, existingIndex));
    });
    return result;
  }

  function collectEvidence(tenant, patient, photoStudies) {
    const files = global.SmylPatientEvidenceFiles?.all?.(tenant, patient)
      || global.SmylPatient360?.allFiles?.(tenant, patient)
      || global.SmylPatient360?.files?.(tenant, patient);
    const caseId = global.SmylCaseWorkspace?.context?.(tenant, patient)?.caseId;
    const dental = caseId ? global.SmylDentalProgress?.status?.(tenant, patient, caseId) : null;
    const items = [];
    const canonicalPhotos = (Array.isArray(photoStudies) ? photoStudies : []).map(photoStudyItem);
    const indexedFiles = new Set(canonicalPhotos.map(item => item.patientFileId).filter(Boolean));
    canonicalPhotos.forEach(item => items.push(item));
    (files?.items || []).forEach(file => {
      if (file?.category === 'clinical_photo' && indexedFiles.has(String(file?.id || ''))) return;
      items.push(legacyFileItem(file));
    });
    (dental?.studyItems || []).forEach(study => items.push(radiographItem(study)));
    return deduplicateEvidence(items);
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

  function assignmentKey(sourceType, sourceId) {
    return `${String(sourceType || '')}:${String(sourceId || '')}`;
  }

  function applyCategoryAssignments(state, items) {
    const active = new Map();
    (state.categorySnapshot?.assignments || []).filter(row => row.active).forEach(row => {
      const key = assignmentKey(row.sourceType, row.sourceId);
      if (!active.has(key)) active.set(key, []);
      active.get(key).push(row.categoryId);
    });
    return items.map(item => {
      const identities = [{ source: item.source, id: item.id }, ...(item.aliases || [])];
      const categoryIds = [...new Set(identities.flatMap(identity => active.get(assignmentKey(identity.source, identity.id)) || []))];
      return { ...item, categoryIds };
    });
  }

  function pathwayState(items, pathway) {
    const sources = pathway.requirements.map(([label, predicate]) => ({ label, available: items.some(predicate) }));
    return { ...pathway, sources, available: sources.filter(source => source.available).length, total: sources.length };
  }

  function renderPathways(state, items) {
    state.pathways.replaceChildren();
    state.pathways.hidden = true;
  }

  function renderValuationArchive(state, items) {
    const host = document.querySelector('#p-paciente-detalle.activa .cw-valuation-evidence');
    if (!host) return;
    host.replaceChildren();
    const categories = state.categorySnapshot?.categories || [];
    const head = el('header', 'seci-valuation-head');
    const copy = el('div');
    copy.append(el('span', 'seci-kicker', 'ARCHIVOS CLÍNICOS'), el('h3', '', 'Fuentes para revisar'), el('p', '', 'Consulta los originales antes de registrar una conclusión profesional.'));
    const openArchive = el('button', 'seci-open-archive', 'Ver archivos clínicos');
    openArchive.type = 'button';
    openArchive.onclick = () => {
      if (typeof global.SmylPatient360?.open === 'function') global.SmylPatient360.open('files');
      else global.SmylCaseWorkspace?.open?.('files');
    };
    head.append(copy, openArchive);
    host.append(head);
    const categoryCounts = categories.filter(category => !category.archived).map(category => ({
      ...category,
      count: items.filter(item => item.categoryIds?.includes(category.id)).length
    })).filter(category => category.count > 0);
    if (categoryCounts.length) {
      const chips = el('div', 'seci-valuation-categories');
      categoryCounts.forEach(category => {
        const chip = el('span', 'seci-valuation-category');
        chip.append(el('span', '', category.name), el('b', '', String(category.count)));
        chips.append(chip);
      });
      host.append(chips);
    }
    const summary = el('p', 'seci-valuation-empty', items.length
      ? `${items.length} ${items.length === 1 ? 'archivo clínico disponible' : 'archivos clínicos disponibles'}. Los originales se administran en Archivos.`
      : 'Aún no hay archivos clínicos. Puedes continuar con la revisión manual.');
    host.append(summary);
  }

  async function assignMany(state, sourceType, sourceId, categoryIds) {
    if (!global.SmylEvidenceCategories?.setCategory || !sourceId) return;
    const selected = new Set((categoryIds || []).map(String));
    const currentIds = new Set((state.categorySnapshot?.assignments || [])
      .filter(row => row.active && row.sourceType === sourceType && row.sourceId === String(sourceId))
      .map(row => row.categoryId));
    const tasks = [];
    selected.forEach(categoryId => {
      if (!currentIds.has(categoryId)) tasks.push(global.SmylEvidenceCategories.setCategory(state.patient, sourceType, sourceId, categoryId, true));
    });
    currentIds.forEach(categoryId => {
      if (!selected.has(categoryId)) tasks.push(global.SmylEvidenceCategories.setCategory(state.patient, sourceType, sourceId, categoryId, false));
    });
    if (tasks.length) await Promise.all(tasks);
  }

  async function refreshCategories(state) {
    if (!current(state) || !global.SmylEvidenceCategories?.load) return;
    if (state.categoryLoading) return state.categoryPromise;
    state.categoryLoading = true;
    state.categoryPromise = (async () => {
      try {
        state.categorySnapshot = await global.SmylEvidenceCategories.load(state.tenant, state.patient);
        if (!current(state)) return;
        state.center?.setCategories(state.categorySnapshot.categories, state.categorySnapshot.suggestions);
        state.fingerprint = '';
        refresh(state);
      } catch (error) {
        announce(state, error?.message || 'No se pudieron cargar las categorías clínicas.', 'error');
      } finally {
        state.categoryLoading = false;
        state.categoryPromise = null;
      }
    })();
    return state.categoryPromise;
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

  function beginRadiographIntake(state, payload, editor, before) {
    const record = editor?.querySelector('.dr-record');
    if (!record) throw new Error('No pudimos abrir el cargador radiográfico. Conservamos tu selección para que puedas intentarlo de nuevo.');
    const shell = record.closest('.cw-advanced-editor');
    const form = record.querySelector('.dr-form');
    const save = form?.querySelector(':scope > .dr-primary');
    const shellSummary = shell?.querySelector(':scope > summary');
    const shellTitle = shellSummary?.querySelector(':scope > span:nth-child(2) strong');
    const shellToggle = shellSummary?.querySelector('.cw-advanced-toggle');
    const banner = el('section', 'seci-radiograph-focus');
    banner.id = 'seci-radiograph-intake-status';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.tabIndex = -1;
    const copy = el('div');
    copy.append(el('span', 'seci-radiograph-kicker', 'CARGA EN CURSO'), el('strong', '', 'Preparando radiografía'), el('p', '', `${payload.file?.name || 'Archivo seleccionado'} · todavía no se ha guardado.`));
    banner.append(el('span', 'seci-radiograph-icon', 'RX'), copy);
    form?.before(banner);
    const intake = {
      editor,
      record,
      shell,
      banner,
      before,
      studyId: '',
      save,
      saveLabel: save?.textContent || 'Guardar observaciones',
      shellTitle,
      shellTitleLabel: shellTitle?.textContent || 'Agregar estudio radiográfico',
      shellToggle,
      shellToggleLabel: shellToggle?.textContent || 'Cerrar',
      blockSummary: null,
      keepOpen: null
    };
    intake.blockSummary = event => {
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
    };
    intake.keepOpen = () => {
      if (state.pendingRadiographIntake === intake && shell && !shell.open) shell.open = true;
    };
    state.pendingRadiographIntake = intake;
    state.root.hidden = true;
    if (shell) shell.open = true;
    shellSummary?.addEventListener('click', intake.blockSummary);
    shellSummary?.addEventListener('keydown', intake.blockSummary);
    shell?.addEventListener('toggle', intake.keepOpen);
    record.dataset.evidenceIntake = 'preparing';
    if (shell) shell.dataset.evidenceIntake = 'preparing';
    if (save) {
      save.textContent = 'Guardar radiografía';
      save.classList.add('seci-intake-save');
      save.setAttribute('aria-describedby', 'seci-radiograph-intake-status');
    }
    if (shellTitle) shellTitle.textContent = 'Revisar y guardar radiografía';
    if (shellToggle) shellToggle.textContent = 'En curso';
  }

  function markRadiographPrepared(state, studyId) {
    const intake = state.pendingRadiographIntake;
    if (!intake || !studyId) return;
    if (intake.before?.has(String(studyId))) return;
    intake.studyId = String(studyId);
    intake.record.dataset.evidenceIntake = 'ready';
    if (intake.shell) intake.shell.dataset.evidenceIntake = 'ready';
    const card = [...intake.record.querySelectorAll('.dr-study')].find(item => item.dataset.studyId === intake.studyId);
    card?.classList.add('is-evidence-intake');
    const notes = card?.querySelector('.dr-intake-notes');
    const discard = card?.querySelector('.dr-intake-discard');
    if (notes) notes.setAttribute('aria-label', 'Añadir notas opcionales antes de guardar la radiografía');
    if (discard) discard.setAttribute('aria-label', 'Descartar esta carga radiográfica sin guardar');
    const title = intake.banner.querySelector('strong');
    const detail = intake.banner.querySelector('p');
    if (title) title.textContent = 'Radiografía sin guardar';
    if (detail) detail.textContent = 'Guarda la radiografía para añadirla al expediente. Las notas son opcionales.';
    requestAnimationFrame(() => {
      if (!current(state) || !intake.banner.isConnected) return;
      intake.banner.scrollIntoView({ block: 'start', behavior: 'smooth' });
      intake.save?.focus({ preventScroll: true });
    });
  }

  function finishRadiographIntake(state, options) {
    const intake = state?.pendingRadiographIntake;
    if (!intake) return;
    intake.banner?.remove();
    intake.record?.removeAttribute('data-evidence-intake');
    intake.shell?.removeAttribute('data-evidence-intake');
    intake.record?.querySelectorAll('.is-evidence-intake').forEach(card => card.classList.remove('is-evidence-intake'));
    intake.shell?.querySelector(':scope > summary')?.removeEventListener('click', intake.blockSummary);
    intake.shell?.querySelector(':scope > summary')?.removeEventListener('keydown', intake.blockSummary);
    intake.shell?.removeEventListener('toggle', intake.keepOpen);
    if (intake.save?.isConnected) {
      intake.save.textContent = intake.saveLabel;
      intake.save.classList.remove('seci-intake-save');
      intake.save.removeAttribute('aria-describedby');
    }
    if (intake.shellTitle?.isConnected) intake.shellTitle.textContent = intake.shellTitleLabel;
    if (intake.shellToggle?.isConnected) intake.shellToggle.textContent = intake.shellToggleLabel;
    state.pendingRadiographIntake = null;
    state.root.hidden = false;
    if (options?.focusArchive) requestAnimationFrame(() => state.centerHost?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
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
        const category = categories.find(item => item.id === card.dataset.modality) || categories[index];
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

  function routePatientFile(state, payload, category, options) {
    const customSaved = options?.onSaved;
    const prepared = { ...(options || {}), onSaved: async row => {
      if (customSaved) await customSaved(row);
      else if (payload.categoryIds?.length) await assignMany(state, 'patient_file', row?.id, payload.categoryIds);
      if (payload.categoryIds?.length) await refreshCategories(state);
    }};
    if (!global.SmylPatientFiles?.add?.(category, prepared)) throw new Error('Tu rol no permite agregar archivos a este expediente.');
    requestAnimationFrame(() => prefillPatientFile(state, payload));
    announce(state, 'Revisa el archivo y confirma la carga en la ficha privada. Todavía no se ha guardado.', 'attention');
  }

  function canonicalPhotoRegion(payload) {
    const tooth = String(payload?.tooth || '').trim();
    if (/^[1-4][1-8]$/.test(tooth)) return { scope: 'tooth', fdi: tooth };
    const preset = String(payload?.regionPreset || '').trim();
    if (preset === 'full_mouth') return { scope: 'whole_mouth' };
    if (['upper_arch', 'lower_arch'].includes(preset)) return { scope: 'arch', regionCode: preset };
    if (/^quadrant_[1-4]$/.test(preset)) return { scope: 'quadrant', regionCode: preset };
    if (preset === 'soft_tissue') return { scope: 'soft_tissue_region', regionCode: 'soft_tissue' };
    if (preset === 'face') return { scope: 'anatomical_region', regionCode: 'face' };
    if (preset === 'tooth') return { scope: 'anatomical_region', regionCode: 'localized' };
    return undefined;
  }

  function routeClinicalPhoto(state, payload) {
    if (!global.SmylClinicalPhotoService?.indexPatientFile) {
      throw new Error('La clasificación profesional de fotografías todavía no terminó de cargar. Intenta de nuevo.');
    }
    const indexingPayload = {
      subtype: payload.subtype,
      title: payload.title,
      date: payload.date,
      region: canonicalPhotoRegion(payload),
      metadata: {
        regionLabel: payload.region || '',
        regionPreset: payload.regionPreset || '',
        tooth: payload.tooth || ''
      }
    };
    return routePatientFile(state, payload, 'clinical_photo', {
      workflow: 'clinical_photo',
      lockCategory: true,
      accept: 'image/jpeg,image/png,image/webp',
      title: 'Agregar fotografía clínica',
      description: 'Guarda el original una sola vez y clasifícalo para su valoración profesional. La IA no confirmará observaciones automáticamente.',
      submitLabel: 'Guardar original',
      successMessage: 'Fotografía original guardada y preparada para valoración.',
      onSaved: async row => {
        const study = await global.SmylClinicalPhotoService.indexPatientFile({
          tenant: state.tenant,
          patient: state.patient,
          row,
          payload: indexingPayload
        });
        if (payload.categoryIds?.length) await assignMany(state, 'clinical_photo_study', study?.id, payload.categoryIds);
      }
    });
  }

  function prefillRadiograph(state, payload, editor) {
    const form = editor?.querySelector('.dr-record');
    if (!form) {
      throw new Error('No pudimos abrir el cargador radiográfico. Conservamos tu selección para que puedas intentarlo de nuevo.');
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
      throw new Error('El editor radiográfico admite archivos JPG o PNG. El archivo no se cargó ni se guardó.');
    }
    if (!fileInput || !setFiles(fileInput, payload.file)) {
      throw new Error('No pudimos transferir el archivo al cargador radiográfico. Conservamos tu selección para que puedas intentarlo de nuevo.');
    }
    requestAnimationFrame(() => {
      if (!current(state) || !editor.isConnected) return;
      editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
      state.pendingRadiographIntake?.banner?.focus({ preventScroll: true });
    });
    announce(state, 'Radiografía preparada. Pulsa Guardar radiografía para añadirla al expediente.', 'attention');
    return true;
  }

  function routeRadiograph(state, payload) {
    const caseId = global.SmylCaseWorkspace?.context?.(state.tenant, state.patient)?.caseId;
    const status = caseId ? global.SmylDentalProgress?.status?.(state.tenant, state.patient, caseId) : null;
    const before = new Set((status?.studyItems || []).map(item => String(item.id)));
    if (payload.categoryIds?.length) {
      state.pendingRadiographCategory = {
        before,
        categoryIds: payload.categoryIds.slice(),
        expiresAt: Date.now() + 15 * 60 * 1000
      };
    }
    const editor = global.SmylCaseWorkspace?.openRadiographIntake?.(payload);
    if (!editor) throw new Error('No pudimos abrir el cargador radiográfico. Conservamos tu selección para que puedas intentarlo de nuevo.');
    beginRadiographIntake(state, payload, editor, before);
    try {
      return prefillRadiograph(state, payload, editor);
    } catch (error) {
      state.pendingRadiographCategory = null;
      finishRadiographIntake(state);
      throw error;
    }
  }

  async function completePendingRadiograph(state) {
    const pending = state.pendingRadiographCategory;
    if (!pending) return;
    if (Date.now() > pending.expiresAt) {
      state.pendingRadiographCategory = null;
      return;
    }
    const caseId = global.SmylCaseWorkspace?.context?.(state.tenant, state.patient)?.caseId;
    const status = caseId ? global.SmylDentalProgress?.status?.(state.tenant, state.patient, caseId) : null;
    const created = (status?.studyItems || []).find(item => !pending.before.has(String(item.id)));
    if (!created) return;
    state.pendingRadiographCategory = null;
    await assignMany(state, 'dental_record', created.id, pending.categoryIds);
    await refreshCategories(state);
    announce(state, 'Radiografía guardada y clasificada en el archivo clínico.', 'neutral');
  }

  async function routeDraft(state, payload) {
    if (!current(state)) throw new Error('El expediente cambió. Vuelve a abrir al paciente.');
    if (!global.SmylEvidenceModel?.isSubtypeAllowed?.(payload.modality, payload.subtype)) throw new Error('El tipo de archivo clínico no corresponde a la modalidad.');
    if (payload.modality === 'photograph') return routeClinicalPhoto(state, payload);
    if (payload.modality === 'document') return routePatientFile(state, payload, DOCUMENT_CATEGORY[payload.subtype] || 'other');
    if (payload.modality === 'radiograph_2d') return routeRadiograph(state, payload);
    const labels = {
      scan_model: 'escaneos y modelos',
      clinical_measurement: 'evaluaciones clínicas estructuradas',
      cbct_3d: 'volúmenes CBCT/DICOM'
    };
    throw new Error(`El guardado de ${labels[payload.modality] || 'este archivo clínico'} todavía no está habilitado. No se guardó ningún dato.`);
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
    if (origin.source === 'clinical_photo_study') {
      global.SmylCaseWorkspace?.open?.('review');
      requestAnimationFrame(() => {
        document.getElementById('cw-evaluation-task-findings')?.click();
        Promise.resolve(global.SmylClinicalPhotoReview?.refresh?.()).finally(() => {
          const section = document.querySelector('.scpr-root');
          section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          dispatchEvent(new CustomEvent('smyl:clinical-photo-open-request', { detail: {
            tenant: state.tenant,
            patient: state.patient,
            studyId: origin.id
          }}));
        });
      });
      announce(state, 'Abriendo la valoración de la fotografía original.', 'neutral');
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
    const items = applyCategoryAssignments(state, collectEvidence(state.tenant, state.patient, state.photoStudies));
    const fingerprint = JSON.stringify(items);
    if (fingerprint === state.fingerprint) return;
    state.fingerprint = fingerprint;
    state.origins = originMap(items);
    state.center.setItems(items);
    renderPathways(state, items);
    renderValuationArchive(state, items);
  }

  async function refreshPhotos(state, force) {
    if (!current(state) || state.photoLoading || !global.SmylClinicalPhotoService?.list) return;
    state.photoLoading = true;
    try {
      const response = await global.SmylClinicalPhotoService.list(state.tenant, state.patient, { force: force === true });
      if (!current(state)) return;
      state.photoAvailable = response?.available !== false;
      state.photoStudies = Array.isArray(response) ? response : Array.isArray(response?.studies) ? response.studies : [];
      refresh(state);
    } catch (error) {
      if (!current(state)) return;
      state.photoAvailable = false;
      state.photoStudies = [];
      refresh(state);
      console.warn('SMYL canonical photo evidence unavailable', error);
    } finally {
      state.photoLoading = false;
    }
  }

  function dispose(state) {
    if (!state) return;
    clearInterval(state.timer);
    clearInterval(state.photoTimer);
    finishRadiographIntake(state);
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
    const pathways = el('div', 'seci-pathways');
    const centerHost = el('div', 'seci-center');
    const feedback = el('p', 'seci-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    root.append(centerHost, pathways, feedback);
    legacy.before(root);
    const state = { token: ++sequence, root, pathways, centerHost, feedback, legacy, tenant: value.tenant, patient: value.patient, fingerprint: '', origins: new Map(), center: null, timer: null, photoTimer: null, photoStudies: [], photoAvailable: null, photoLoading: false, categoryLoading: false, categoryPromise: null, categorySnapshot: { available: false, categories: [], assignments: [], suggestions: global.SmylEvidenceCategories?.suggestions || [] }, pendingRadiographCategory: null, pendingRadiographIntake: null };
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
        onCreate: payload => routeDraft(state, payload),
        categories: state.categorySnapshot.categories,
        suggestions: state.categorySnapshot.suggestions,
        onActivateCategory: async category => {
          await global.SmylEvidenceCategories.activate(category.key);
          await refreshCategories(state);
          announce(state, `${category.name} ya está disponible en la clínica.`, 'neutral');
        },
        onCreateCategory: async name => {
          const category = await global.SmylEvidenceCategories.create(name);
          await refreshCategories(state);
          announce(state, `${category.name} ya está disponible en la clínica.`, 'neutral');
        },
        onAssignCategories: async (item, categoryIds) => {
          await assignMany(state, item.source, item.sourceId || item.id, categoryIds);
          await refreshCategories(state);
          announce(state, 'Clasificación guardada. El original no cambió.', 'neutral');
        },
        onCategoryError: error => announce(state, error?.message || 'No se pudo actualizar la categoría.', 'error')
      });
      guardUnavailableCreation(state);
      legacy.hidden = true;
      refresh(state);
      refreshCategories(state);
      refreshPhotos(state, true);
      state.timer = setInterval(() => refresh(state), 1400);
      state.photoTimer = setInterval(() => refreshPhotos(state, false), 6000);
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
    ['smyl:dental-context-updated', 'smyl:patient-summary', 'smyl:case-selection'].forEach(name => addEventListener(name, event => {
      if (current(active)) {
        refresh(active);
        if (name === 'smyl:dental-context-updated' && event.detail?.reason === 'saved' && active.pendingRadiographIntake) completePendingRadiograph(active).then(() => {
          if (!current(active)) return;
          finishRadiographIntake(active, { focusArchive: true });
          announce(active, 'Radiografía guardada en el archivo clínico.', 'neutral');
        }).catch(error => {
          if (!current(active)) return;
          finishRadiographIntake(active, { focusArchive: true });
          announce(active, error?.message || 'La radiografía se guardó, pero falta clasificarla.', 'attention');
        });
      }
      else mount();
    }));
    addEventListener('smyl:dental-study-prepared', event => {
      if (!current(active) || !active.pendingRadiographIntake || event.detail?.tenant !== active.tenant || event.detail?.patient !== active.patient) return;
      markRadiographPrepared(active, event.detail?.studyId);
    });
    addEventListener('smyl:dental-study-preparation-cancelled', event => {
      if (!current(active) || !active.pendingRadiographIntake || event.detail?.tenant !== active.tenant || event.detail?.patient !== active.patient) return;
      active.pendingRadiographCategory = null;
      finishRadiographIntake(active, { focusArchive: true });
      announce(active, 'Carga descartada. El expediente no cambió.', 'neutral');
    });
    addEventListener('smyl:dental-study-preparation-failed', event => {
      if (!current(active) || !active.pendingRadiographIntake || event.detail?.tenant !== active.tenant || event.detail?.patient !== active.patient) return;
      active.pendingRadiographCategory = null;
      finishRadiographIntake(active);
      announce(active, event.detail?.reason === 'duplicate' ? 'Esta radiografía ya estaba registrada; no se creó otra copia.' : 'La radiografía no se agregó. Revisa el archivo y vuelve a intentarlo.', 'attention');
    });
    ['smyl:patient-file-created', 'smyl:clinical-photo-indexed', 'smyl:clinical-photo-analysis', 'smyl:clinical-photo-decision', 'smyl:clinical-photo-manual-finding'].forEach(name => addEventListener(name, () => {
      if (current(active)) refreshPhotos(active, true);
      else mount();
    }));
    addEventListener('smyl:evidence-categories-changed', () => {
      if (current(active)) refreshCategories(active);
      else mount();
    });
    mount();
  }

  global.SmylEvidenceCenterIntegration = Object.freeze({
    pathways: PATHWAYS,
    creationAvailability: Object.freeze(Object.fromEntries(Object.entries(CREATE_CAPABILITIES).map(([key, value]) => [key, Object.freeze({ enabled: value.enabled, label: value.label || '' })]))),
    collectEvidence,
    pathwayState,
    itemKey,
    originMap,
    assignmentKey,
    applyCategoryAssignments,
    creationCapability,
    legacyFileItem,
    photoStudyItem,
    radiographItem,
    mount,
    openAdd(modality) {
      if (!current(active)) mount();
      if (!current(active) || !active.center) return false;
      return active.center.openAdd(modality || undefined) !== false;
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
