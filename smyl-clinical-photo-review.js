/* SMYL · Valoración profesional de fotografías clínicas canónicas.
 * Los originales se cargan únicamente en Archivos clínicos. Este módulo sólo consulta,
 * solicita análisis y registra decisiones profesionales auditables. */
(function clinicalPhotoReviewModule(global) {
  'use strict';

  const TEETH = Object.freeze([11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48].map(String));
  const CATEGORY_LABELS = Object.freeze({
    quality: 'Calidad de la toma', anatomy: 'Anatomía visible', caries_candidate: 'Cambio visible por comprobar',
    restoration: 'Restauración visible', periodontal_support: 'Soporte periodontal', endodontic: 'Zona endodóntica',
    periapical: 'Zona periapical', pathology: 'Alteración visible', implant: 'Implante', orthodontic: 'Posición dental',
    trauma: 'Trauma visible', prosthetic: 'Prótesis', development: 'Desarrollo', soft_tissue: 'Tejidos blandos',
    occlusion: 'Relación oclusal', other: 'Otra observación'
  });
  const QUALITY = Object.freeze({
    pending: ['Sin analizar', 'neutral'], usable: ['Utilizable', 'good'], limited: ['Visibilidad limitada', 'attention'], unusable: ['No evaluable', 'danger']
  });
  const REGION_LABELS = Object.freeze({
    whole_mouth: 'Boca completa', arch: 'Arcada', quadrant: 'Cuadrante', tooth: 'Pieza', anatomical_region: 'Región anatómica'
  });
  const DISPOSITIONS = Object.freeze({
    reviewed_no_findings: ['Revisada sin observaciones registrables', 'good'],
    not_evaluable: ['No evaluable', 'danger'],
    manual_only: ['Valoración manual registrada', 'good']
  });
  let active = null;
  let sequence = 0;

  function evidenceWorkspace() {
    return global.SmylEvidenceWorkspace || null;
  }

  function progressFor(study, override) {
    const findings = Array.isArray(study?.findings) ? study.findings : [];
    const input = {
      quality: qualityOf(study),
      findings: findings.length,
      pending: pendingFindings(study).length,
      reviewed: reviewedFindings(study).length,
      closed: Boolean(studyDisposition(study)),
      ...(override || {})
    };
    const workspace = evidenceWorkspace();
    if (workspace?.photoProgress) return workspace.photoProgress(input);
    return input.closed
      ? { original: 'complete', quality: 'complete', suggestions: 'complete', decision: 'complete', history: 'current' }
      : { original: 'complete', quality: 'current', suggestions: 'pending', decision: 'pending', history: 'pending' };
  }

  function setReviewProgress(state, study, override) {
    const progress = state?.dialog?.querySelector('.smyl-ew-progress');
    const workspace = evidenceWorkspace();
    if (progress && workspace?.setProgress) workspace.setProgress(progress, progressFor(study, override));
    if (state?.dialog) state.dialog.dataset.reviewPhase = progress?.dataset.currentPhase || '';
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(text, action, className) {
    const node = el('button', className || 'scpr-secondary', text);
    node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  }
  function photoIcon(className) {
    const shell = el('span', className || 'scpr-photo-icon');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    body.setAttribute('d', 'M4.75 7.25h3.1l1.2-1.7h5.9l1.2 1.7h3.1c.97 0 1.75.78 1.75 1.75v8.25c0 .97-.78 1.75-1.75 1.75H4.75C3.78 19 3 18.22 3 17.25V9c0-.97.78-1.75 1.75-1.75Z');
    const lens = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    lens.setAttribute('cx', '12');
    lens.setAttribute('cy', '13');
    lens.setAttribute('r', '3.25');
    svg.append(body, lens);
    shell.append(svg);
    return shell;
  }
  function context() {
    const patient = global.pacienteActual;
    const tenant = global.tenantId;
    if (!patient?.id || patient._local || !tenant) return null;
    return { tenant: String(tenant), patient: String(patient.id) };
  }
  function current(state) {
    const value = context();
    return !!state && active === state && state.token === sequence && state.root?.isConnected && value?.tenant === state.tenant && value.patient === state.patient;
  }
  function cleanText(value, limit) {
    return String(value || '').trim().slice(0, limit || 1000);
  }
  function qualityOf(study) {
    const status = (typeof study?.quality === 'string' ? study.quality : study?.quality?.status) || study?.qualityDetail?.status || study?.qualityStatus || 'pending';
    return QUALITY[status] ? status : 'pending';
  }
  function latestDecision(finding) {
    return finding?.latestDecision || finding?.decision || null;
  }
  function findingState(finding) {
    return latestDecision(finding)?.state || finding?.state || finding?.initial_state || 'pending';
  }
  function pendingFindings(study) {
    return (study?.findings || []).filter(finding => findingState(finding) === 'pending');
  }
  function reviewedFindings(study) {
    return (study?.findings || []).filter(finding => findingState(finding) !== 'pending');
  }
  function studyDisposition(study) {
    const value = study?.disposition || study?.latestDisposition || null;
    return value && DISPOSITIONS[value.state] ? value : null;
  }
  function studyLabel(study) {
    return study?.label || study?.display_name || global.SmylClinicalPhotoService?.label?.(study?.subtype) || 'Fotografía clínica';
  }
  function studyDate(study) {
    const raw = study?.acquired_at || study?.acquiredAt || study?.created_at || study?.createdAt;
    const when = Date.parse(raw || '');
    return Number.isFinite(when) ? new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(when)) : 'Sin fecha';
  }
  function studyStatus(study) {
    const pending = pendingFindings(study).length;
    const reviewed = reviewedFindings(study).length;
    const quality = qualityOf(study);
    if (pending) return [`${pending} ${pending === 1 ? 'sugerencia pendiente' : 'sugerencias pendientes'}`, 'attention'];
    const disposition = studyDisposition(study);
    if (disposition) return DISPOSITIONS[disposition.state];
    if (reviewed) return [`${reviewed} ${reviewed === 1 ? 'decisión registrada' : 'decisiones registradas'}`, 'good'];
    if (quality === 'unusable') return ['Sin evaluación de IA', 'danger'];
    if (quality !== 'pending') return ['Sin sugerencias automáticas', 'neutral'];
    return ['Lista para valorar', 'neutral'];
  }
  function announce(state, message, tone) {
    if (!current(state)) return;
    const workspace = evidenceWorkspace();
    if (workspace?.setFeedback) workspace.setFeedback(state.feedback, { message, tone, key: `${tone || 'neutral'}:${message || ''}` });
    else {
      state.feedback.textContent = message || '';
      state.feedback.dataset.tone = tone || 'neutral';
    }
  }
  function revokeUrls(state) {
    for (const value of state.urls.values()) URL.revokeObjectURL(value);
    state.urls.clear();
  }
  async function originalUrl(state, study) {
    if (state.urls.has(study.id)) return state.urls.get(study.id);
    const loaded = await global.SmylClinicalPhotoService.loadOriginal(study);
    if (!current(state)) throw new Error('La ficha cambió.');
    const blob = loaded?.blob instanceof Blob ? loaded.blob : loaded;
    if (!(blob instanceof Blob)) throw new Error('No se pudo verificar el original.');
    const url = loaded?.url || URL.createObjectURL(blob);
    state.urls.set(study.id, url);
    return url;
  }

  function renderSummary(state) {
    const pending = state.studies.reduce((total, study) => total + pendingFindings(study).length, 0);
    const reviewed = state.studies.reduce((total, study) => total + reviewedFindings(study).length + (studyDisposition(study) ? 1 : 0), 0);
    state.metrics.replaceChildren();
    [[state.studies.length, state.studies.length === 1 ? 'toma clínica' : 'tomas clínicas'], [pending, 'por revisar'], [reviewed, 'decisiones']].forEach(([value, label]) => {
      const metric = el('span', 'scpr-metric');
      metric.append(el('strong', '', String(value)), el('small', '', label));
      state.metrics.append(metric);
    });
    const candidates = state.studies.filter(study => !studyDisposition(study) && qualityOf(study) === 'pending' && !(study.findings || []).length);
    state.batchButton.hidden = candidates.length < 2;
    state.batchButton.textContent = `Analizar serie${candidates.length > 2 ? ` (${Math.min(candidates.length, 4)})` : ''}`;
  }

  function renderEmpty(state) {
    const empty = el('section', 'scpr-empty');
    const copy = el('div');
    copy.append(el('strong', '', 'Aún no hay fotografías clínicas clasificadas'), el('p', '', 'Agrega la toma una sola vez en Archivos clínicos. Después aparecerá aquí para revisión y decisión profesional.'));
    const action = button('Ver archivos clínicos', () => {
      if (typeof global.SmylPatient360?.open === 'function') global.SmylPatient360.open('files');
      else global.SmylCaseWorkspace?.open?.('photos');
    }, 'scpr-primary');
    empty.append(photoIcon('scpr-empty-icon scpr-photo-icon'), copy, action);
    state.list.append(empty);
  }

  function renderStudies(state) {
    state.list.replaceChildren();
    if (!state.studies.length) return renderEmpty(state);
    for (const study of state.studies) {
      const card = el('article', 'scpr-study-card');
      const media = el('div', 'scpr-study-media');
      media.setAttribute('role', 'img');
      media.setAttribute('aria-label', 'Se verifica al abrir la valoración; el original permanece privado');
      const placeholder = photoIcon('scpr-study-placeholder scpr-photo-icon');
      placeholder.setAttribute('aria-hidden', 'true');
      media.append(placeholder, el('span', 'scpr-original-badge', 'ORIGINAL PRIVADO'));
      const body = el('div', 'scpr-study-copy');
      const heading = el('div', 'scpr-study-heading');
      const title = el('div');
      title.append(el('span', 'scpr-kicker', 'FOTOGRAFÍA CLÍNICA'), el('strong', '', studyLabel(study)), el('small', '', `${studyDate(study)} · ${study.subtype || 'sin clasificación'}`));
      const [statusText, statusTone] = studyStatus(study);
      const status = el('span', 'scpr-status', statusText);
      status.dataset.tone = statusTone;
      heading.append(title, status);
      const q = qualityOf(study), quality = el('p', 'scpr-quality');
      const qualityNote = cleanText(study?.qualityDetail?.notes || (typeof study?.quality === 'object' ? study.quality.notes : ''), 220);
      quality.append(el('strong', '', QUALITY[q][0]), document.createTextNode(qualityNote ? ` · ${qualityNote}` : q === 'pending' ? ' · pendiente de valoración' : ''));
      const action = button(pendingFindings(study).length ? 'Revisar sugerencias' : (reviewedFindings(study).length || studyDisposition(study)) ? 'Consultar valoración' : q === 'pending' ? 'Preparar valoración' : 'Abrir valoración', () => openReview(state, study), 'scpr-primary');
      body.append(heading, quality, action);
      card.append(media, body);
      state.list.append(card);
    }
  }

  async function refresh(state, force) {
    if (!current(state) || state.loading) return;
    state.loading = true;
    state.root.dataset.loading = 'true';
    try {
      const response = await global.SmylClinicalPhotoService.list(state.tenant, state.patient, { force: force === true });
      if (!current(state)) return;
      state.studies = Array.isArray(response) ? response : Array.isArray(response?.studies) ? response.studies : [];
      if (response?.available === false) throw new Error(response.reason || 'La valoración fotográfica profesional aún no está activada en esta clínica.');
      renderSummary(state);
      renderStudies(state);
      announce(state, '', 'neutral');
      const resolvedStudies = state.studies.filter(study => studyDisposition(study) || ((study.findings || []).length && (study.findings || []).every(finding => findingState(finding) !== 'pending'))).length;
      dispatchEvent(new CustomEvent('smyl:clinical-photo-status', { detail: {
        tenant: state.tenant, patient: state.patient, studies: state.studies.length,
        pending: state.studies.reduce((sum, study) => sum + pendingFindings(study).length, 0),
        reviewed: state.studies.reduce((sum, study) => sum + reviewedFindings(study).length + (studyDisposition(study) ? 1 : 0), 0),
        resolvedStudies,
        unresolvedStudies: Math.max(0, state.studies.length - resolvedStudies),
        notAnalyzed: state.studies.filter(study => !studyDisposition(study) && qualityOf(study) === 'pending' && !(study.findings || []).length).length,
        firstStudyId: state.studies[0]?.id || '',
        firstPendingStudyId: state.studies.find(study => pendingFindings(study).length)?.id || ''
      }}));
    } catch (error) {
      if (!current(state)) return;
      announce(state, /PGRST|42P01|42883|no existe|not found/i.test(String(error?.message || error)) ? 'La valoración fotográfica profesional aún no está activada en esta clínica.' : (error?.message || 'No se pudieron cargar las valoraciones fotográficas.'), 'error');
      renderSummary(state);
      state.list.replaceChildren();
      const retry = button('Reintentar', () => refresh(state, true), 'scpr-secondary');
      const problem = el('section', 'scpr-empty');
      problem.append(el('span', 'scpr-empty-icon', '!'), el('div', '', null), retry);
      problem.children[1].append(el('strong', '', 'No pudimos abrir la valoración fotográfica'), el('p', '', 'Los originales permanecen guardados. No se ejecutó ningún análisis.'));
      state.list.append(problem);
    } finally {
      state.loading = false;
      if (current(state)) state.root.dataset.loading = 'false';
    }
  }

  function closeDialog(state) {
    if (!state.dialog) return;
    const dialog = state.dialog;
    state.dialog = null;
    dialog.close();
    dialog.remove();
  }

  function openBatchReview(state) {
    if (!current(state) || state.dialog) return;
    const candidates = state.studies.filter(study => !studyDisposition(study) && qualityOf(study) === 'pending' && !(study.findings || []).length).slice(0, 4);
    if (candidates.length < 2) return;
    const dialog = el('dialog', 'scpr-dialog scpr-batch-dialog');
    const close = () => closeDialog(state);
    const header = el('header', 'scpr-dialog-head'), copy = el('div');
    copy.append(el('span', 'scpr-kicker', 'SERIE FOTOGRÁFICA'), el('h2', '', 'Analizar vistas complementarias'), el('p', '', 'Selecciona hasta cuatro originales del mismo paciente. Cada toma conservará su clasificación y su resultado independiente.'));
    const back = button('Volver al expediente', close, 'scpr-secondary scpr-back');
    back.setAttribute('aria-label', 'Volver al expediente');
    header.append(copy, back);
    const body = el('div', 'scpr-dialog-body scpr-batch-body');
    const intro = el('section', 'scpr-batch-intro');
    intro.append(el('h3', '', 'La comparación entre vistas mejora el contexto, no sustituye tu valoración'), el('p', '', 'La IA puede contrastar frontal, laterales y oclusales, pero debe abstenerse si una toma no es evaluable o si la orientación no es inequívoca.'));
    const list = el('div', 'scpr-batch-list');
    candidates.forEach(study => {
      const option = el('label', 'scpr-batch-option'), check = el('input');
      check.type = 'checkbox'; check.value = study.id; check.checked = true;
      const text = el('span');
      text.append(el('strong', '', studyLabel(study)), el('small', '', `${studyDate(study)} · ${study.subtype}`));
      option.append(check, text); list.append(option);
    });
    const consent = el('label', 'scpr-confirm'), authorized = el('input'); authorized.type = 'checkbox';
    consent.append(authorized, document.createTextNode('Confirmo que son fotografías originales del paciente, cuento con autorización y deseo enviarlas al servicio clínico de IA de SMYL.'));
    const feedback = el('p', 'scpr-action-feedback'); feedback.setAttribute('role', 'status');
    const cancel = button('Cancelar', close, 'scpr-secondary');
    const analyze = button('Analizar serie', async () => {
      const ids = [...list.querySelectorAll('input:checked')].map(input => input.value);
      if (!authorized.checked || !ids.length || ids.length > 4) return;
      analyze.disabled = cancel.disabled = true;
      list.querySelectorAll('input').forEach(input => { input.disabled = true; }); authorized.disabled = true;
      feedback.textContent = 'Analizando las vistas originales como una serie. Puede tardar cerca de un minuto.';
      try {
        await global.SmylClinicalPhotoService.analyze(ids, { consent: true });
        await refresh(state, true);
        close();
        announce(state, 'La serie quedó analizada. Revisa y decide cada sugerencia antes de incorporarla al expediente.', 'success');
      } catch (error) {
        feedback.textContent = error?.message || 'No se pudo completar el análisis de la serie. No se guardó como completado.';
        analyze.disabled = cancel.disabled = false;
        list.querySelectorAll('input').forEach(input => { input.disabled = false; }); authorized.disabled = false; authorized.checked = false;
      }
    }, 'scpr-primary');
    const sync = () => {
      const count = list.querySelectorAll('input:checked').length;
      analyze.disabled = !authorized.checked || count < 1 || count > 4;
      feedback.textContent = count > 4 ? 'Selecciona como máximo cuatro tomas.' : '';
    };
    list.addEventListener('change', sync); authorized.addEventListener('change', sync); analyze.disabled = true;
    const actions = el('div', 'scpr-actions'); actions.append(cancel, analyze);
    body.append(intro, list, consent, feedback, actions); dialog.append(header, body); document.body.append(dialog);
    state.dialog = dialog;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (state.dialog === dialog) closeDialog(state); });
    dialog.showModal();
  }

  function reviewHeader(dialog, study, close) {
    const header = el('header', 'scpr-dialog-head');
    const copy = el('div');
    copy.append(el('span', 'scpr-kicker', 'EVIDENCIA · FOTOGRAFÍA CLÍNICA'), el('h2', '', studyLabel(study)), el('p', '', 'Original protegido, control de calidad, sugerencias y decisión profesional en un solo flujo.'));
    const back = button('Volver al expediente', close, 'scpr-secondary scpr-back');
    back.setAttribute('aria-label', 'Volver al expediente');
    header.append(copy, back);
    const workspace = evidenceWorkspace();
    const steps = workspace?.createProgress
      ? workspace.createProgress({ states: progressFor(study), ariaLabel: 'Progreso de la valoración fotográfica' })
      : el('ol', 'smyl-ew-progress');
    if (!steps.children.length) {
      [['1', 'Original'], ['2', 'Calidad'], ['3', 'Sugerencias'], ['4', 'Decisión'], ['5', 'Historial']].forEach(([number, label], index) => {
        const item = el('li', 'smyl-ew-progress__item');
        item.dataset.state = index === 1 ? 'current' : index === 0 ? 'complete' : 'pending';
        if (index === 1) item.setAttribute('aria-current', 'step');
        item.append(el('span', 'smyl-ew-progress__marker', index === 0 ? '✓' : number), el('span', 'smyl-ew-progress__label', label), el('span', 'smyl-ew-progress__status', index === 0 ? 'Listo' : index === 1 ? 'En curso' : 'Pendiente'));
        steps.append(item);
      });
    }
    return [header, steps];
  }

  async function openReview(state, initialStudy) {
    if (!current(state) || state.dialog) return;
    const dialog = el('dialog', 'scpr-dialog smyl-evidence-workspace');
    evidenceWorkspace()?.decorate?.(dialog, 'photograph');
    dialog.setAttribute('aria-label', `Valoración de ${studyLabel(initialStudy)}`);
    const close = () => closeDialog(state);
    const [header, steps] = reviewHeader(dialog, initialStudy, close);
    const body = el('div', 'scpr-dialog-body');
    dialog.append(header, steps, body);
    document.body.append(dialog);
    state.dialog = dialog;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (state.dialog === dialog) closeDialog(state); });
    dialog.showModal();
    body.append(el('p', 'scpr-loading', 'Verificando el original privado…'));
    try {
      const url = await originalUrl(state, initialStudy);
      if (!current(state) || state.dialog !== dialog) return;
      renderReview(state, initialStudy.id, url, body);
    } catch (error) {
      setReviewProgress(state, initialStudy, { failed: true });
      const problem = el('p', 'scpr-error');
      const message = error?.message || 'No se pudo verificar el original. No se ejecutó ningún análisis.';
      if (evidenceWorkspace()?.setFeedback) evidenceWorkspace().setFeedback(problem, { message, tone: 'error', key: 'photo-original-load' });
      else problem.textContent = message;
      body.replaceChildren(problem);
    }
  }

  function currentStudy(state, studyId) {
    return state.studies.find(study => study.id === studyId) || null;
  }

  function renderOriginal(study, url) {
    const panel = el('section', 'scpr-original-panel');
    const figure = el('figure');
    const image = el('img');
    image.src = url;
    image.alt = `${studyLabel(study)} · fotografía original sin modificaciones`;
    const caption = el('figcaption');
    caption.append(el('strong', '', 'Original verificado'), el('span', '', `${studyDate(study)} · ${study.subtype}`));
    figure.append(image, caption);
    const q = qualityOf(study), quality = el('div', 'scpr-quality-card');
    quality.dataset.tone = QUALITY[q][1];
    quality.append(el('span', '', QUALITY[q][0]), el('p', '', cleanText(study?.qualityDetail?.notes || study?.quality?.notes, 500) || 'La calidad se documentará cuando se ejecute o complete la valoración.'));
    panel.append(figure, quality, el('p', 'scpr-original-note', 'No se aplican filtros, blanqueamiento, recortes clínicos ni simulaciones a este original.'));
    return panel;
  }

  function dispositionRevision(study) {
    const revision = Number(studyDisposition(study)?.revision || 0);
    return Number.isInteger(revision) && revision >= 0 ? revision : 0;
  }

  function dispositionAudit(disposition) {
    if (!disposition) return '';
    const raw = disposition.decided_at || disposition.updated_at || disposition.created_at;
    const when = Date.parse(raw || '');
    const date = Number.isFinite(when) ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(when)) : '';
    const author = cleanText(disposition.professional_name || disposition.decided_by_name || disposition.author_name || '', 120);
    return [author, date, disposition.revision ? `revisión ${disposition.revision}` : ''].filter(Boolean).join(' · ');
  }

  function renderSavedDisposition(study) {
    const disposition = studyDisposition(study);
    if (!disposition) return null;
    const summary = el('section', 'scpr-saved-decision scpr-study-disposition');
    summary.dataset.state = disposition.state;
    summary.append(
      el('span', 'scpr-kicker', 'CIERRE PROFESIONAL DE LA TOMA'),
      el('h3', '', DISPOSITIONS[disposition.state][0]),
      el('p', '', cleanText(disposition.note || disposition.reason, 1000) || 'La toma quedó resuelta por criterio profesional.'),
      el('small', '', dispositionAudit(disposition) || 'Decisión auditada en el expediente')
    );
    return summary;
  }

  function renderDispositionForm(state, study, host, initialState) {
    setReviewProgress(state, study, { quality: qualityOf(study) === 'pending' ? 'limited' : qualityOf(study) });
    host.replaceChildren();
    const form = el('form', 'scpr-professional-form scpr-disposition-form');
    form.append(el('span', 'scpr-kicker', 'CIERRE DE LA TOMA'), el('h3', '', 'Registrar el resultado de tu revisión'), el('p', '', 'Este cierre no equivale a un diagnóstico. Deja constancia de por qué la toma se resolvió sin una sugerencia confirmada.'));
    const stateLabel = el('label'); stateLabel.append(el('span', '', 'Resultado profesional'));
    const outcome = el('select');
    outcome.append(new Option('Revisada, sin observaciones registrables', 'reviewed_no_findings'), new Option('No evaluable por calidad o localización', 'not_evaluable'), new Option('Valoración exclusivamente manual', 'manual_only'));
    outcome.value = DISPOSITIONS[initialState] ? initialState : 'reviewed_no_findings'; stateLabel.append(outcome);
    const reasonLabel = el('label'); reasonLabel.append(el('span', '', 'Motivo'));
    const reason = el('select');
    const reasonsByState = {
      reviewed_no_findings: [['no_visible_findings', 'Sin observaciones visibles registrables']],
      manual_only: [['professional_manual_review', 'Revisión exclusivamente manual']],
      not_evaluable: [
        ['focus_insufficient', 'Enfoque insuficiente'], ['exposure_insufficient', 'Iluminación o exposición insuficiente'],
        ['region_not_visible', 'Zona clínica incompleta o no visible'], ['orientation_uncertain', 'Orientación no verificable'],
        ['artifact_or_obstruction', 'Artefacto u obstrucción'], ['other', 'Otro motivo']
      ]
    };
    const syncReasons = () => { reason.replaceChildren(); (reasonsByState[outcome.value] || []).forEach(([value, label]) => reason.append(new Option(label, value))); };
    syncReasons(); reasonLabel.append(reason);
    const noteLabel = el('label'); noteLabel.append(el('span', '', 'Nota profesional'));
    const note = el('textarea'); note.rows = 4; note.maxLength = 1000; note.placeholder = 'Explica brevemente qué revisaste y por qué cierras esta toma así.'; noteLabel.append(note);
    const verify = el('label', 'scpr-confirm'), check = el('input'); check.type = 'checkbox';
    verify.append(check, document.createTextNode('Revisé el original y confirmo que este cierre corresponde a mi criterio profesional.'));
    const feedback = el('p', 'scpr-action-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    const cancel = button('Cancelar', () => renderReview(state, study.id, state.urls.get(study.id), state.dialog.querySelector('.scpr-dialog-body')), 'scpr-secondary');
    const save = button('Guardar cierre', async () => {
      if (save.disabled) return;
      save.disabled = cancel.disabled = true; feedback.textContent = 'Guardando el cierre profesional…';
      try {
        if (typeof global.SmylClinicalPhotoService.setDisposition !== 'function') throw new Error('El cierre profesional todavía no está habilitado en esta clínica.');
        await global.SmylClinicalPhotoService.setDisposition({
          studyId: study.id, expectedRevision: dispositionRevision(study), state: outcome.value,
          reason: reason.value, note: note.value.trim()
        });
        await refresh(state, true);
        renderReview(state, study.id, state.urls.get(study.id), state.dialog.querySelector('.scpr-dialog-body'));
      } catch (error) {
        feedback.textContent = error?.message || 'No se pudo guardar el cierre. Tus datos siguen visibles.';
        save.disabled = false; cancel.disabled = false;
      }
    }, 'scpr-primary');
    const sync = () => { save.disabled = !check.checked || note.value.trim().length < 5; };
    outcome.onchange = () => { syncReasons(); check.checked = false; sync(); };
    reason.onchange = () => { check.checked = false; sync(); };
    note.oninput = () => { check.checked = false; sync(); }; check.onchange = sync; save.disabled = true;
    const actions = el('div', 'scpr-actions'); actions.append(cancel, save);
    form.append(stateLabel, reasonLabel, noteLabel, verify, feedback, actions); host.append(form); note.focus({ preventScroll: true });
  }

  function renderAnalyze(state, study, host) {
    const panel = el('section', 'scpr-decision-panel');
    panel.append(el('span', 'scpr-kicker', 'CALIDAD Y ANÁLISIS ASISTIDO'), el('h3', '', 'Decide cómo revisar esta toma'), el('p', '', 'La IA puede señalar detalles visibles por comprobar. Nunca confirma diagnósticos ni modifica el expediente por sí sola.'));
    const safety = el('div', 'scpr-safety');
    safety.append(el('strong', '', 'Abstención segura'), el('p', '', 'Si la toma está desenfocada, mal orientada o no permite localizar la zona, se marcará como no evaluable y podrás continuar manualmente.'));
    const consent = el('label', 'scpr-confirm'), check = el('input');
    check.type = 'checkbox';
    consent.append(check, document.createTextNode('Confirmo que es una fotografía original del paciente, tengo autorización y deseo enviarla al servicio clínico de IA de SMYL.'));
    const feedback = el('p', 'scpr-action-feedback'); feedback.setAttribute('role', 'status');
    const analyze = button('Analizar fotografía', async () => {
      if (!check.checked || analyze.disabled) return;
      analyze.disabled = true; manual.disabled = resolve.disabled = true; check.disabled = true;
      setReviewProgress(state, study, { quality: 'usable', analyzing: true });
      feedback.textContent = 'Analizando el original. Puede tardar cerca de un minuto; no cierres esta ventana.';
      try {
        await global.SmylClinicalPhotoService.analyze([study.id], { consent: true });
        await refresh(state, true);
        const updated = currentStudy(state, study.id);
        if (!updated || !state.dialog) return;
        renderReview(state, study.id, state.urls.get(study.id), host);
      } catch (error) {
        setReviewProgress(state, study, { failed: true });
        const message = error?.message || 'No se pudo confirmar el análisis. No se reintentó automáticamente.';
        if (evidenceWorkspace()?.setFeedback) evidenceWorkspace().setFeedback(feedback, { message, tone: 'error', key: 'photo-analysis' });
        else feedback.textContent = message;
        analyze.disabled = false; manual.disabled = resolve.disabled = false; check.disabled = false; check.checked = false;
      }
    }, 'scpr-primary');
    analyze.disabled = true;
    check.addEventListener('change', () => { analyze.disabled = !check.checked; });
    const manual = button('Registrar observación manual', () => renderManualForm(state, study, host), 'scpr-secondary');
    const resolve = button('Continuar sin IA', () => renderDispositionForm(state, study, host, 'manual_only'), 'scpr-secondary');
    const actions = el('div', 'scpr-actions'); actions.append(resolve, manual, analyze);
    panel.append(safety, consent, feedback, actions);
    host.append(panel);
  }

  function anatomyFromFinding(finding) {
    const value = finding?.anatomy || {};
    return { scope: value.scope || (value.fdi ? 'tooth' : 'whole_mouth'), fdi: value.fdi || '', regionCode: value.regionCode || value.region_code || '' };
  }

  function renderFindingDecision(state, study, finding, host) {
    setReviewProgress(state, study);
    host.replaceChildren();
    const source = el('section', 'scpr-ai-source');
    source.append(el('span', 'scpr-kicker', 'SUGERENCIA DE IA · NO CONFIRMADA'), el('h3', '', cleanText(finding.label, 160) || CATEGORY_LABELS[finding.category] || 'Observación por comprobar'), el('p', '', cleanText(finding.description, 2000)), el('small', '', cleanText(finding?.payload?.evidence || finding?.payload?.where || '', 400)));
    const form = el('form', 'scpr-professional-form');
    form.addEventListener('submit', event => event.preventDefault());
    form.append(el('span', 'scpr-kicker', 'DECISIÓN PROFESIONAL'), el('h3', '', 'Tu conclusión clínica'));
    const anatomy = anatomyFromFinding(finding);
    const categoryLabel = el('label'); categoryLabel.append(el('span', '', 'Tipo de observación'));
    const category = el('select'); Object.entries(CATEGORY_LABELS).forEach(([value, label]) => category.append(new Option(label, value))); category.value = CATEGORY_LABELS[finding.category] ? finding.category : 'other'; categoryLabel.append(category);
    const scopeLabel = el('label'); scopeLabel.append(el('span', '', 'Alcance anatómico'));
    const scope = el('select'); Object.entries(REGION_LABELS).forEach(([value, label]) => scope.append(new Option(label, value))); scope.value = REGION_LABELS[anatomy.scope] ? anatomy.scope : 'whole_mouth'; scopeLabel.append(scope);
    const regionLabel = el('label'); regionLabel.append(el('span', '', 'Región o referencia · opcional'));
    const region = el('input'); region.type = 'text'; region.maxLength = 120; region.value = cleanText(anatomy.regionCode, 120); region.placeholder = 'Ej. arcada superior, cuadrante 2 o mucosa vestibular'; regionLabel.append(region);
    const toothLabel = el('label'); toothLabel.append(el('span', '', 'Pieza relacionada · opcional'));
    const tooth = el('select'); tooth.append(new Option('Sin pieza confirmada', '')); TEETH.forEach(value => tooth.append(new Option(`FDI ${value}`, value))); tooth.value = anatomy.fdi; toothLabel.append(tooth);
    const noteLabel = el('label'); noteLabel.append(el('span', '', 'Conclusión u observación'));
    const note = el('textarea'); note.rows = 4; note.maxLength = 1000; note.value = cleanText(finding.description, 1000); noteLabel.append(note);
    const verify = el('label', 'scpr-confirm'), check = el('input'); check.type = 'checkbox'; verify.append(check, document.createTextNode('Revisé el original, la localización y el texto. Esta decisión corresponde a mi criterio profesional.'));
    const feedback = el('p', 'scpr-action-feedback'); feedback.setAttribute('role', 'status');
    const rejectPanel = el('section', 'scpr-reject-panel'); rejectPanel.hidden = true;
    rejectPanel.append(el('h4', '', 'Confirmar descarte de la sugerencia'), el('p', '', 'El descarte quedará auditado. Explica por qué esta sugerencia no corresponde al original.'));
    const rejectReasonLabel = el('label'); rejectReasonLabel.append(el('span', '', 'Motivo del descarte'));
    const rejectReason = el('textarea'); rejectReason.rows = 3; rejectReason.maxLength = 600; rejectReasonLabel.append(rejectReason);
    const rejectVerify = el('label', 'scpr-confirm'), rejectCheck = el('input'); rejectCheck.type = 'checkbox'; rejectVerify.append(rejectCheck, document.createTextNode('Revisé el original y confirmo que deseo descartar esta sugerencia.'));
    const cancelReject = button('Cancelar descarte', () => { rejectPanel.hidden = true; rejectReason.value = ''; rejectCheck.checked = false; }, 'scpr-secondary');
    const confirmReject = button('Confirmar descarte', () => saveDecision('rejected', rejectReason.value.trim()), 'scpr-danger'); confirmReject.disabled = true;
    const rejectActions = el('div', 'scpr-actions'); rejectActions.append(cancelReject, confirmReject); rejectPanel.append(rejectReasonLabel, rejectVerify, rejectActions);
    const reject = button('Descartar sugerencia', () => { rejectPanel.hidden = false; rejectPanel.scrollIntoView({ block: 'nearest' }); rejectReason.focus({ preventScroll: true }); }, 'scpr-danger');
    const confirm = button('Guardar decisión', () => saveDecision('confirmed', ''), 'scpr-primary'); confirm.disabled = true;
    const resetConfirm = () => { check.checked = false; confirm.disabled = true; };
    check.onchange = () => { confirm.disabled = !check.checked || !note.value.trim(); };
    [category, scope, region, tooth, note].forEach(control => control.addEventListener(control === note || control === region ? 'input' : 'change', resetConfirm));
    const syncAnatomy = () => { tooth.disabled = scope.value !== 'tooth'; if (tooth.disabled) tooth.value = ''; };
    scope.addEventListener('change', syncAnatomy); syncAnatomy();
    const syncReject = () => { confirmReject.disabled = !rejectCheck.checked || rejectReason.value.trim().length < 5; };
    rejectReason.addEventListener('input', () => { rejectCheck.checked = false; syncReject(); }); rejectCheck.addEventListener('change', syncReject);
    async function saveDecision(baseState, rejectionNote) {
      if (baseState === 'confirmed' && confirm.disabled) return;
      if (baseState === 'rejected' && confirmReject.disabled) return;
      confirm.disabled = reject.disabled = confirmReject.disabled = cancelReject.disabled = true;
      feedback.textContent = 'Guardando la decisión profesional…';
      try {
        const original = anatomyFromFinding(finding);
        const changed = note.value.trim() !== cleanText(finding.description, 1000) || tooth.value !== original.fdi || scope.value !== original.scope || region.value.trim() !== original.regionCode || category.value !== finding.category;
        const stateName = baseState === 'confirmed' && changed ? 'corrected' : baseState;
        const correction = stateName === 'corrected' ? {
          category: category.value,
          label: category.value === finding.category ? (cleanText(finding.label, 160) || CATEGORY_LABELS[category.value] || 'Observación clínica') : CATEGORY_LABELS[category.value],
          description: note.value.trim(),
          anatomy: { scope: scope.value, ...(tooth.value ? { fdi: tooth.value } : {}), ...(region.value.trim() ? { regionCode: region.value.trim() } : {}) }
        } : {};
        const revision = Number(latestDecision(finding)?.revision || 0);
        await global.SmylClinicalPhotoService.decide({ findingId: finding.id, expectedRevision: revision, state: stateName, correction, note: baseState === 'rejected' ? rejectionNote : note.value.trim() });
        await refresh(state, true);
        const updated = currentStudy(state, study.id);
        if (!updated || !state.dialog) return;
        renderReview(state, study.id, state.urls.get(study.id), state.dialog.querySelector('.scpr-dialog-body'));
      } catch (error) {
        feedback.textContent = error?.message || 'No se pudo guardar la decisión. Tus cambios siguen visibles.';
        confirm.disabled = !check.checked || !note.value.trim(); reject.disabled = false; cancelReject.disabled = false; syncReject();
      }
    }
    const actions = el('div', 'scpr-actions'); actions.append(reject, confirm);
    form.append(categoryLabel, scopeLabel, regionLabel, toothLabel, noteLabel, verify, feedback, rejectPanel, actions);
    host.append(source, form);
  }

  function renderFindings(state, study, host) {
    setReviewProgress(state, study);
    const findings = study.findings || [];
    const pending = findings.filter(finding => findingState(finding) === 'pending');
    const dispositionSummary = renderSavedDisposition(study);
    if (dispositionSummary) host.append(dispositionSummary);
    if (qualityOf(study) === 'unusable' && !findings.length) {
      const abstain = el('section', 'scpr-abstention');
      const actions = el('div', 'scpr-actions');
      actions.append(button('Registrar no evaluable', () => renderDispositionForm(state, study, host, 'not_evaluable'), 'scpr-secondary'), button('Continuar con revisión manual', () => renderManualForm(state, study, host), 'scpr-primary'));
      abstain.append(el('span', 'scpr-kicker', 'SIN EVALUACIÓN DE IA'), el('h3', '', 'La toma no permite una valoración automática segura'), el('p', '', cleanText(study?.qualityDetail?.notes || study?.quality?.notes, 1000) || 'La visibilidad o la orientación son insuficientes. Esto no significa ausencia de hallazgos.'), actions);
      host.append(abstain); return;
    }
    if (!findings.length) {
      const empty = el('section', 'scpr-abstention');
      const actions = el('div', 'scpr-actions');
      actions.append(button('Cerrar sin observaciones', () => renderDispositionForm(state, study, host, 'reviewed_no_findings'), 'scpr-secondary'), button('Agregar observación manual', () => renderManualForm(state, study, host), 'scpr-primary'));
      empty.append(el('span', 'scpr-kicker', 'SIN SUGERENCIAS AUTOMÁTICAS'), el('h3', '', 'Revisa el original con tu criterio clínico'), el('p', '', 'Que la IA no señale detalles no equivale a una conclusión negativa ni a una boca sana.'), actions);
      host.append(empty); return;
    }
    const layout = el('div', 'scpr-findings-layout'), list = el('nav', 'scpr-finding-list'), detail = el('div', 'scpr-finding-detail');
    list.setAttribute('aria-label', 'Sugerencias y decisiones de esta fotografía');
    findings.forEach((finding, index) => {
      const stateName = findingState(finding), item = button('', () => {
        list.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node === item)));
        if (stateName === 'pending') renderFindingDecision(state, study, finding, detail);
        else {
          const decision = latestDecision(finding), correction = decision?.correction || {}, anatomy = correction.anatomy || finding.anatomy || {}, category = correction.category || finding.category;
          detail.replaceChildren();
          const summary = el('section', 'scpr-saved-decision');
          summary.dataset.state = stateName;
          const location = [REGION_LABELS[anatomy.scope] || '', anatomy.regionCode || anatomy.region_code || '', anatomy.fdi ? `FDI ${anatomy.fdi}` : ''].filter(Boolean).join(' · ') || 'Sin localización confirmada';
          summary.append(
            el('span', 'scpr-kicker', stateName === 'rejected' ? 'SUGERENCIA DESCARTADA' : 'DECISIÓN PROFESIONAL GUARDADA'),
            el('h3', '', correction.label || finding.label || 'Observación clínica'),
            el('p', '', correction.description || decision?.note || finding.description || ''),
            el('small', '', `${CATEGORY_LABELS[category] || 'Observación clínica'} · ${location}`),
            el('small', 'scpr-audit-meta', dispositionAudit(decision) || `Revisión ${decision?.revision || 1}`)
          );
          detail.append(summary);
        }
      }, 'scpr-finding-item');
      item.dataset.state = stateName;
      item.append(el('span', '', String(index + 1)), el('div', '', null));
      item.children[1].append(el('strong', '', cleanText(finding.label, 100) || CATEGORY_LABELS[finding.category] || 'Observación'), el('small', '', stateName === 'pending' ? 'Por revisar' : stateName === 'rejected' ? 'Descartada' : 'Decisión guardada'));
      list.append(item);
    });
    const add = button('Agregar observación manual', () => renderManualForm(state, study, detail), 'scpr-secondary');
    list.append(add); layout.append(list, detail); host.append(layout);
    const firstPending = list.querySelector('button[data-state="pending"]') || list.querySelector('.scpr-finding-item');
    firstPending?.click();
    if (!pending.length) detail.prepend(el('p', 'scpr-all-reviewed', 'Todas las sugerencias de esta toma tienen una decisión registrada.'));
  }

  function renderManualForm(state, study, host) {
    setReviewProgress(state, study, { quality: qualityOf(study) === 'pending' ? 'limited' : qualityOf(study) });
    host.replaceChildren();
    const form = el('form', 'scpr-professional-form scpr-manual-form');
    form.append(el('span', 'scpr-kicker', 'REGISTRO PROFESIONAL'), el('h3', '', 'Agregar observación manual'), el('p', '', 'Registra únicamente lo que confirmaste al revisar el original y la exploración clínica.'));
    const categoryLabel = el('label'); categoryLabel.append(el('span', '', 'Tipo de observación'));
    const category = el('select'); Object.entries(CATEGORY_LABELS).filter(([key]) => !['quality','periapical'].includes(key)).forEach(([key, label]) => category.append(new Option(label, key))); category.value = 'other'; categoryLabel.append(category);
    const scopeLabel = el('label'); scopeLabel.append(el('span', '', 'Alcance anatómico'));
    const scope = el('select'); Object.entries(REGION_LABELS).forEach(([value, label]) => scope.append(new Option(label, value))); scope.value = 'whole_mouth'; scopeLabel.append(scope);
    const regionLabel = el('label'); regionLabel.append(el('span', '', 'Región o referencia · opcional'));
    const region = el('input'); region.type = 'text'; region.maxLength = 120; region.placeholder = 'Ej. arcada superior o mucosa vestibular'; regionLabel.append(region);
    const toothLabel = el('label'); toothLabel.append(el('span', '', 'Pieza relacionada · opcional'));
    const tooth = el('select'); tooth.append(new Option('Sin pieza confirmada', '')); TEETH.forEach(value => tooth.append(new Option(`FDI ${value}`, value))); toothLabel.append(tooth);
    const textLabel = el('label'); textLabel.append(el('span', '', 'Observación profesional'));
    const text = el('textarea'); text.rows = 4; text.maxLength = 1000; textLabel.append(text);
    const verify = el('label', 'scpr-confirm'), check = el('input'); check.type = 'checkbox'; verify.append(check, document.createTextNode('Confirmo que esta observación proviene de mi revisión profesional, no de una inferencia automática.'));
    const feedback = el('p', 'scpr-action-feedback'); feedback.setAttribute('role', 'status');
    const cancel = button('Cancelar', () => renderReview(state, study.id, state.urls.get(study.id), state.dialog.querySelector('.scpr-dialog-body')), 'scpr-secondary');
    const save = button('Guardar observación', async () => {
      if (!check.checked || !text.value.trim()) return;
      save.disabled = cancel.disabled = true; feedback.textContent = 'Guardando observación profesional…';
      let findingSaved = false;
      try {
        await global.SmylClinicalPhotoService.createManual({
          studyId: study.id, category: category.value, label: CATEGORY_LABELS[category.value] || 'Observación clínica', description: text.value.trim(),
          anatomy: { scope: scope.value, ...(tooth.value ? { fdi: tooth.value } : {}), ...(region.value.trim() ? { regionCode: region.value.trim() } : {}) }, payload: { source: 'clinical_photo_review' }
        });
        findingSaved = true;
        if (typeof global.SmylClinicalPhotoService.setDisposition === 'function') {
          await global.SmylClinicalPhotoService.setDisposition({ studyId: study.id, expectedRevision: dispositionRevision(study), state: 'manual_only', reason: 'professional_manual_review', note: text.value.trim() });
        }
        await refresh(state, true);
        renderReview(state, study.id, state.urls.get(study.id), state.dialog.querySelector('.scpr-dialog-body'));
      } catch (error) {
        if (findingSaved) {
          await refresh(state, true).catch(() => {});
          if (state.dialog) renderReview(state, study.id, state.urls.get(study.id), state.dialog.querySelector('.scpr-dialog-body'));
          announce(state, 'La observación quedó guardada, pero el cierre de la toma requiere reintento.', 'error');
        } else {
          feedback.textContent = error?.message || 'No se pudo guardar la observación.'; save.disabled = false; cancel.disabled = false;
        }
      }
    }, 'scpr-primary'); save.disabled = true;
    const sync = () => { save.disabled = !check.checked || !text.value.trim(); };
    const reset = () => { check.checked = false; sync(); };
    text.oninput = reset; category.onchange = reset; scope.onchange = () => { tooth.disabled = scope.value !== 'tooth'; if (tooth.disabled) tooth.value = ''; reset(); }; region.oninput = reset; tooth.onchange = reset; check.onchange = sync; scope.onchange();
    const actions = el('div', 'scpr-actions'); actions.append(cancel, save);
    form.append(categoryLabel, scopeLabel, regionLabel, toothLabel, textLabel, verify, feedback, actions); host.append(form); text.focus({ preventScroll: true });
  }

  function renderReview(state, studyId, url, host) {
    const study = currentStudy(state, studyId);
    if (!study || !host) return;
    setReviewProgress(state, study);
    host.replaceChildren();
    const layout = el('div', 'scpr-review-layout'), original = renderOriginal(study, url), decision = el('section', 'scpr-review-work');
    layout.append(original, decision); host.append(layout);
    if (!studyDisposition(study) && qualityOf(study) === 'pending' && !(study.findings || []).length) renderAnalyze(state, study, decision);
    else renderFindings(state, study, decision);
  }

  function dispose(state) {
    if (!state) return;
    clearInterval(state.timer);
    closeDialog(state);
    revokeUrls(state);
    state.root?.remove();
    if (active === state) active = null;
  }

  function mount() {
    const value = context();
    const reviewHost = document.querySelector('#p-paciente-detalle.activa #cw-evaluation-panel-findings .cw-evaluation-panel-body');
    if (!value || !reviewHost || !global.SmylClinicalPhotoService) return;
    if (current(active)) return;
    dispose(active);
    const root = el('section', 'scpr-root smyl-evidence-workspace');
    evidenceWorkspace()?.decorate?.(root, 'photograph');
    root.dataset.patientId = value.patient;
    const head = el('header', 'scpr-head'), copy = el('div');
    copy.append(el('span', 'scpr-kicker', 'FOTOGRAFÍAS CLÍNICAS'), el('h2', '', 'Revisión de fotografías'), el('p', '', 'Comprueba las tomas originales de Archivos clínicos y confirma sólo los hallazgos que correspondan.'));
    const headTools = el('div', 'scpr-head-tools'), metrics = el('div', 'scpr-metrics');
    const batchButton = button('Analizar serie', () => openBatchReview(active), 'scpr-secondary'); batchButton.hidden = true;
    headTools.append(metrics, batchButton); head.append(copy, headTools);
    const list = el('div', 'scpr-list'), feedback = el('p', 'scpr-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    root.append(head, list, feedback);
    const radiographQueue = reviewHost.querySelector('.cw-radiograph-shelf');
    if (radiographQueue) reviewHost.insertBefore(root, radiographQueue); else reviewHost.append(root);
    const state = { token: ++sequence, root, metrics, batchButton, list, feedback, tenant: value.tenant, patient: value.patient, studies: [], urls: new Map(), dialog: null, loading: false, timer: null };
    active = state;
    refresh(state, true);
    state.timer = setInterval(() => { if (current(state) && !state.dialog) refresh(state, true); }, 30000);
  }

  function init() {
    const screen = document.getElementById('p-paciente-detalle');
    if (!screen) return;
    new MutationObserver(mount).observe(screen, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    ['smyl:patient-file-created', 'smyl:clinical-photo-indexed', 'smyl:clinical-photo-analysis', 'smyl:clinical-photo-decision', 'smyl:clinical-photo-disposition', 'smyl:clinical-photo-manual-finding', 'smyl:case-selection'].forEach(name => addEventListener(name, () => {
      if (current(active)) refresh(active, true); else mount();
    }));
    addEventListener('smyl:clinical-photo-open-request', event => {
      const detail = event?.detail || {};
      if (!detail.studyId) return;
      openRequested(String(detail.studyId), detail);
    });
    mount();
  }

  async function openRequested(studyId, requestedContext) {
    if (!current(active)) mount();
    const state = active;
    if (!current(state) || (requestedContext?.tenant && requestedContext.tenant !== state.tenant) || (requestedContext?.patient && requestedContext.patient !== state.patient)) return false;
    await refresh(state, true);
    const study = currentStudy(state, studyId);
    if (!study) return false;
    state.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (state.dialog) closeDialog(state);
    await openReview(state, study);
    return true;
  }

  global.SmylClinicalPhotoReview = Object.freeze({
    refresh() { if (current(active)) return refresh(active, true); mount(); return Promise.resolve(); },
    studies(tenant, patient) {
      const state = active;
      if (!current(state) || (tenant && tenant !== state.tenant) || (patient && patient !== state.patient)) return [];
      return state.studies.slice();
    },
    open(studyId) { return openRequested(String(studyId || ''), {}); },
    openFirst() {
      const state = active;
      if (!current(state)) { mount(); return false; }
      const study = state.studies.find(item => pendingFindings(item).length) || state.studies.find(item => qualityOf(item) === 'pending') || state.studies[0];
      return study ? openRequested(study.id, {}) : false;
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
