(function evidenceCenterModule(global) {
  'use strict';

  const CATEGORIES = Object.freeze([
    {
      id: 'photograph',
      label: 'Fotografías',
      short: 'Fotos',
      description: 'Rostro, sonrisa, vistas intraorales y seguimiento.',
      icon: 'camera',
      fileAccept: 'image/jpeg,image/png,image/webp',
      types: [
        ['face_rest', 'Rostro frontal en reposo'],
        ['face_smile', 'Frontal sonriendo'],
        ['face_profile_right', 'Perfil derecho'],
        ['face_profile_left', 'Perfil izquierdo'],
        ['intraoral_frontal', 'Intraoral frontal'],
        ['intraoral_right', 'Lateral intraoral derecha'],
        ['intraoral_left', 'Lateral intraoral izquierda'],
        ['occlusal_upper', 'Oclusal superior'],
        ['occlusal_lower', 'Oclusal inferior'],
        ['localized', 'Pieza o lesión localizada'],
        ['before_after', 'Seguimiento antes y después']
      ]
    },
    {
      id: 'radiograph_2d',
      label: 'Rayos X 2D',
      short: 'Rayos X',
      description: 'Periapical, bitewing, panorámica, oclusal y series.',
      icon: 'radiograph',
      fileAccept: 'image/jpeg,image/png',
      types: [
        ['periapical', 'Periapical'],
        ['bitewing', 'Bitewing / aleta de mordida'],
        ['panoramic', 'Panorámica'],
        ['occlusal', 'Oclusal'],
        ['fmx', 'Serie completa / FMX'],
        ['cephalometric_lateral', 'Cefalométrica lateral'],
        ['cephalometric_pa', 'Cefalométrica posteroanterior'],
        ['tmj_series', 'Serie de ATM'],
        ['other', 'Otro estudio 2D']
      ]
    },
    {
      id: 'scan_model',
      label: 'Escaneos y modelos',
      short: 'Escaneos',
      description: 'Arcadas, mordida, modelos y comparación digital.',
      icon: 'scan',
      fileAccept: '.stl,.ply,.obj,model/stl',
      types: [
        ['arch_upper', 'Arcada superior'],
        ['arch_lower', 'Arcada inferior'],
        ['bite', 'Registro de mordida'],
        ['restorative_preparation', 'Preparación o restauración'],
        ['study_model', 'Modelo de estudio'],
        ['facial_scan', 'Escaneo facial'],
        ['other', 'Otro escaneo o modelo']
      ]
    },
    {
      id: 'clinical_measurement',
      label: 'Evaluaciones clínicas',
      short: 'Evaluaciones',
      description: 'Periodoncia, pruebas pulpares, oclusión y tejidos.',
      icon: 'clipboard',
      fileAccept: '',
      types: [
        ['periodontogram', 'Periodontograma'],
        ['pulp_test', 'Pruebas pulpares'],
        ['percussion_palpation', 'Percusión y palpación'],
        ['bite_test', 'Prueba de mordida'],
        ['mobility', 'Movilidad'],
        ['occlusion', 'Oclusión y contactos'],
        ['soft_tissue_exam', 'Tejidos blandos'],
        ['tmj_exam', 'Evaluación de ATM'],
        ['caries_risk', 'Riesgo de caries'],
        ['other', 'Otra evaluación clínica']
      ]
    },
    {
      id: 'document',
      label: 'Informes y documentos',
      short: 'Informes',
      description: 'Informes radiológicos, referencias e histopatología.',
      icon: 'document',
      fileAccept: 'application/pdf,image/jpeg,image/png',
      types: [
        ['radiology_report', 'Informe radiológico'],
        ['pathology_report', 'Histopatología o biopsia'],
        ['laboratory_report', 'Estudio médico o laboratorio'],
        ['referral', 'Interconsulta o referencia'],
        ['dental_lab_document', 'Documento de laboratorio dental'],
        ['medical_clearance', 'Valoración médica'],
        ['consent', 'Consentimiento o autorización'],
        ['other', 'Otro documento clínico']
      ]
    },
    {
      id: 'cbct_3d',
      label: 'CBCT y 3D',
      short: 'CBCT / 3D',
      description: 'Volúmenes DICOM, cortes, mediciones e informe.',
      icon: 'cube',
      fileAccept: '.dcm,application/dicom',
      advanced: true,
      types: [
        ['cbct_dicom', 'Volumen CBCT / DICOM'],
        ['medical_ct', 'Tomografía médica'],
        ['mri', 'Resonancia magnética'],
        ['other', 'Otro estudio 3D']
      ]
    }
  ]);

  const ICONS = Object.freeze({
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h3l1.4-2h7.2l1.4 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    radiograph: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5c2.2 0 3.1 1.2 5 1.2s2.8-1.2 5-1.2c2.3 0 3.5 2 3.1 4.7-.4 3-2 4.7-2.6 8.4-.4 2.4-1.2 3.9-2.5 3.9-1.6 0-1.2-5.7-3-5.7s-1.4 5.7-3 5.7c-1.3 0-2.1-1.5-2.5-3.9-.6-3.7-2.2-5.4-2.6-8.4C3.5 5.5 4.7 3.5 7 3.5z"/><path d="M8 9.5h8M12 7v5"/></svg>',
    scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path d="M7 12h10M7 15h10"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5v-2h6v2M8 10h8M8 14h8M8 18h5"/></svg>',
    document: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg>',
    cube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2zM4.3 7.4L12 12l7.7-4.6M12 12v9"/></svg>'
  });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function button(label, className, action) {
    const node = element('button', className, label);
    node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  }

  function icon(name) {
    const node = element('span', 'sec-icon');
    node.innerHTML = ICONS[name] || ICONS.document;
    return node;
  }

  function categoryById(id) {
    return CATEGORIES.find(category => category.id === id)
      || CATEGORIES.find(category => category.id === 'document');
  }

  function typeLabel(category, id) {
    return category.types.find(type => type[0] === id)?.[1] || 'Sin tipo';
  }

  function cleanItems(items) {
    return (Array.isArray(items) ? items : []).map((item, index) => ({
      id: String(item?.id || `evidence-${index + 1}`),
      modality: categoryById(item?.modality || item?.category).id,
      subtype: String(item?.subtype || item?.type || ''),
      title: String(item?.title || ''),
      date: String(item?.date || ''),
      region: String(item?.region || ''),
      status: ({
        draft: 'draft',
        ready: 'review',
        under_review: 'review',
        review: 'review',
        signed: 'signed',
        superseded: 'superseded'
      })[item?.status] || 'draft',
      findings: Math.max(0, Number(item?.findings) || 0)
    }));
  }

  function statusLabel(status) {
    return ({
      draft: 'Borrador',
      review: 'Por revisar',
      signed: 'Interpretación firmada',
      superseded: 'Sustituido · conserva historial'
    })[status] || 'Borrador';
  }

  class EvidenceCenter {
    constructor(root, options) {
      if (!root) throw new Error('SmylEvidenceCenter requiere un contenedor.');
      this.root = root;
      this.options = options || {};
      this.items = cleanItems(this.options.items);
      this.filter = 'all';
      this.step = 0;
      this.draft = {};
      this.returnFocus = null;
      this.renderShell();
      this.render();
    }

    renderShell() {
      this.root.classList.add('sec-root');
      this.root.replaceChildren();

      const head = element('header', 'sec-head');
      const copy = element('div', 'sec-head-copy');
      copy.append(element('span', 'sec-kicker', 'EVIDENCIA CLÍNICA'), element('h2', '', 'Estudios y registros'), element('p', '', 'Cada estudio conserva su original, contexto y revisión profesional.'));
      this.addButton = button('Agregar evidencia', 'sec-primary', () => this.openAdd());
      head.append(copy, this.addButton);

      this.summary = element('div', 'sec-summary');
      this.filters = element('div', 'sec-filters');
      this.filters.setAttribute('role', 'tablist');
      this.filters.setAttribute('aria-label', 'Tipos de evidencia clínica');
      this.list = element('div', 'sec-list');
      this.list.setAttribute('aria-live', 'polite');
      this.root.append(head, this.summary, this.filters, this.list);

      this.dialog = element('dialog', 'sec-dialog');
      this.dialog.setAttribute('aria-labelledby', 'sec-dialog-title');
      this.dialog.addEventListener('cancel', event => {
        event.preventDefault();
        this.closeAdd();
      });
      document.body.append(this.dialog);
    }

    render() {
      this.renderSummary();
      this.renderFilters();
      this.renderList();
    }

    renderSummary() {
      const pending = this.items.filter(item => item.status === 'review').length;
      const signed = this.items.filter(item => item.status === 'signed').length;
      const linked = new Set(this.items.map(item => item.region).filter(Boolean)).size;
      this.summary.replaceChildren();
      [[this.items.length, this.items.length === 1 ? 'estudio' : 'estudios'], [pending, 'por revisar'], [signed, 'firmados'], [linked, linked === 1 ? 'región vinculada' : 'regiones vinculadas']].forEach(([value, label]) => {
        const metric = element('span', 'sec-metric');
        metric.append(element('strong', '', String(value)), element('small', '', label));
        this.summary.append(metric);
      });
    }

    renderFilters() {
      this.filters.replaceChildren();
      const options = [{ id: 'all', short: 'Todo' }, ...CATEGORIES];
      options.forEach(option => {
        const count = option.id === 'all' ? this.items.length : this.items.filter(item => item.modality === option.id).length;
        const tab = button('', 'sec-filter', () => {
          this.filter = option.id;
          this.renderFilters();
          this.renderList();
        });
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(this.filter === option.id));
        tab.append(element('span', '', option.short), element('b', '', String(count)));
        this.filters.append(tab);
      });
    }

    renderList() {
      this.list.replaceChildren();
      const visible = this.filter === 'all' ? this.items : this.items.filter(item => item.modality === this.filter);
      if (!visible.length) {
        const empty = element('section', 'sec-empty');
        const category = this.filter === 'all' ? null : categoryById(this.filter);
        empty.append(icon(category?.icon || 'document'), element('h3', '', category ? `Sin ${category.label.toLowerCase()}` : 'Sin evidencia todavía'), element('p', '', category ? category.description : 'Agrega únicamente la evidencia necesaria para la atención de esta persona.'));
        const action = button(category ? `Agregar ${category.short.toLowerCase()}` : 'Agregar primera evidencia', 'sec-secondary', () => this.openAdd(category?.id));
        empty.append(action);
        this.list.append(empty);
        return;
      }

      visible.forEach(item => {
        const category = categoryById(item.modality);
        const card = element('article', 'sec-study');
        card.dataset.status = item.status;
        const main = element('div', 'sec-study-main');
        main.append(icon(category.icon));
        const copy = element('div');
        copy.append(element('span', 'sec-study-category', category.label), element('strong', '', item.title || typeLabel(category, item.subtype)));
        const metadata = [item.date ? new Date(`${item.date}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Sin fecha', item.region || 'Sin región vinculada'].join(' · ');
        copy.append(element('small', '', metadata));
        main.append(copy);
        const state = element('span', 'sec-status', statusLabel(item.status));
        state.dataset.tone = item.status;
        const action = button('Abrir', 'sec-link', () => this.options.onOpen?.(item));
        card.append(main, state, action);
        this.list.append(card);
      });
    }

    openAdd(preselectedModality) {
      this.returnFocus = document.activeElement;
      this.step = preselectedModality ? 1 : 0;
      this.draft = preselectedModality ? { modality: preselectedModality } : {};
      this.renderWizard();
      if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
      else this.dialog.setAttribute('open', '');
      queueMicrotask(() => this.dialog.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled])')?.focus());
    }

    closeAdd() {
      if (this.dialog.open && typeof this.dialog.close === 'function') this.dialog.close();
      else this.dialog.removeAttribute('open');
      this.returnFocus?.focus?.();
    }

    next() {
      this.step = Math.min(3, this.step + 1);
      this.renderWizard();
    }

    back() {
      this.step = Math.max(0, this.step - 1);
      this.renderWizard();
    }

    renderWizard() {
      const category = this.draft.modality ? categoryById(this.draft.modality) : null;
      this.dialog.replaceChildren();
      const head = element('header', 'sec-dialog-head');
      const title = element('div');
      title.append(element('span', 'sec-kicker', `PASO ${this.step + 1} DE 4`), element('h2', '', ['¿Qué vas a agregar?', 'Elige el tipo de estudio', 'Completa los datos esenciales', 'Revisa antes de guardar'][this.step]));
      title.querySelector('h2').id = 'sec-dialog-title';
      head.append(title, button('Cerrar', 'sec-close', () => this.closeAdd()));
      const progress = element('div', 'sec-progress');
      progress.setAttribute('aria-label', `Paso ${this.step + 1} de 4`);
      for (let index = 0; index < 4; index += 1) {
        const bar = element('i');
        bar.dataset.complete = String(index <= this.step);
        progress.append(bar);
      }
      const body = element('div', 'sec-dialog-body');
      if (this.step === 0) this.renderCategoryStep(body);
      if (this.step === 1) this.renderTypeStep(body, category);
      if (this.step === 2) this.renderDetailsStep(body, category);
      if (this.step === 3) this.renderReviewStep(body, category);
      this.dialog.append(head, progress, body);
    }

    renderCategoryStep(body) {
      body.append(element('p', 'sec-step-intro', 'Selecciona la modalidad. Los campos siguientes cambiarán según el tipo de evidencia.'));
      const grid = element('div', 'sec-category-grid');
      CATEGORIES.forEach(category => {
        const rawAvailability = this.options.creationAvailability?.(category.id);
        const availability = rawAvailability === false
          ? { enabled: false, label: 'Por activar' }
          : { enabled: rawAvailability?.enabled !== false, label: rawAvailability?.label || '' };
        const card = button('', 'sec-category', availability.enabled ? () => {
          this.draft.modality = category.id;
          this.next();
        } : null);
        card.setAttribute('aria-disabled', String(!availability.enabled));
        card.append(icon(category.icon));
        const copy = element('span');
        copy.append(element('strong', '', category.label), element('small', '', category.description));
        card.append(copy);
        if (!availability.enabled) card.append(element('em', '', availability.label || 'Por activar'));
        else if (category.advanced) card.append(element('em', '', 'Especializado'));
        grid.append(card);
      });
      body.append(grid);
    }

    renderTypeStep(body, category) {
      if (!category) {
        this.step = 0;
        this.renderWizard();
        return;
      }
      const intro = element('div', 'sec-selected-category');
      intro.append(icon(category.icon), element('div'));
      intro.lastChild.append(element('strong', '', category.label), element('small', '', category.description));
      body.append(intro);
      if (category.advanced) body.append(element('p', 'sec-notice', 'CBCT y DICOM requieren un visor especializado. SMYL conservará el volumen original y su informe; no lo convertirá en una imagen plana.'));
      const grid = element('div', 'sec-type-grid');
      category.types.forEach(([id, label]) => {
        const rawAvailability = this.options.typeAvailability?.(category.id, id);
        const availability = rawAvailability === false
          ? { enabled: false, label: 'Por activar' }
          : { enabled: rawAvailability?.enabled !== false, label: rawAvailability?.label || '' };
        const option = button('', 'sec-type', availability.enabled ? () => {
          this.draft.subtype = id;
          this.next();
        } : null);
        option.append(element('span', '', label));
        if (!availability.enabled) option.append(element('em', '', availability.label || 'Por activar'));
        option.setAttribute('aria-disabled', String(!availability.enabled));
        option.setAttribute('aria-pressed', String(this.draft.subtype === id));
        grid.append(option);
      });
      const footer = element('footer', 'sec-dialog-actions');
      footer.append(button('Atrás', 'sec-secondary', () => this.back()));
      body.append(grid, footer);
    }

    renderDetailsStep(body, category) {
      const form = element('form', 'sec-form');
      form.addEventListener('submit', event => {
        event.preventDefault();
        const data = new FormData(form);
        this.draft.title = String(data.get('title') || '').trim();
        this.draft.date = String(data.get('date') || '');
        this.draft.region = String(data.get('region') || '').trim();
        this.draft.file = form.elements.evidenceFile?.files?.[0] || null;
        this.next();
      });
      const summary = element('div', 'sec-selected-category');
      summary.append(icon(category.icon), element('div'));
      summary.lastChild.append(element('strong', '', typeLabel(category, this.draft.subtype)), element('small', '', category.label));
      form.append(summary);

      const fields = element('div', 'sec-field-grid');
      const dateField = element('label', 'sec-field');
      dateField.append(element('span', '', 'Fecha del estudio'), Object.assign(element('input'), { type: 'date', name: 'date', required: true, value: this.draft.date || new Date().toISOString().slice(0, 10) }));
      const regionField = element('label', 'sec-field');
      const regionInput = Object.assign(element('input'), { type: 'text', name: 'region', value: this.draft.region || '', maxLength: 120, placeholder: 'Ej. piezas 16–18 o arcada superior' });
      regionField.append(element('span', '', 'Pieza, superficie o región'), regionInput);
      const titleField = element('label', 'sec-field sec-field-wide');
      titleField.append(element('span', '', 'Nombre descriptivo · opcional'), Object.assign(element('input'), { type: 'text', name: 'title', value: this.draft.title || '', maxLength: 120, placeholder: 'Ej. Bitewings de control' }));
      fields.append(dateField, regionField, titleField);

      if (category.fileAccept) {
        const fileField = element('label', 'sec-upload sec-field-wide');
        const fileInput = Object.assign(element('input'), { type: 'file', name: 'evidenceFile', accept: category.fileAccept });
        fileField.append(icon(category.icon), element('strong', '', category.id === 'cbct_3d' ? 'Seleccionar volumen o informe' : 'Seleccionar archivo original'), element('small', '', 'El original no se modifica. La carga definitiva ocurrirá al confirmar.'), fileInput);
        fields.append(fileField);
      } else {
        const notice = element('div', 'sec-clinical-note sec-field-wide');
        notice.append(element('strong', '', 'Registro clínico estructurado'), element('p', '', 'Esta evaluación se captura en su editor correspondiente; no requiere adjuntar un archivo.'));
        fields.append(notice);
      }
      form.append(fields);
      const footer = element('footer', 'sec-dialog-actions');
      footer.append(button('Atrás', 'sec-secondary', () => this.back()), Object.assign(element('button', 'sec-primary', 'Continuar'), { type: 'submit' }));
      form.append(footer);
      body.append(form);
    }

    renderReviewStep(body, category) {
      const review = element('section', 'sec-review');
      review.append(icon(category.icon), element('div'));
      review.lastChild.append(element('span', 'sec-kicker', category.label.toUpperCase()), element('h3', '', this.draft.title || typeLabel(category, this.draft.subtype)));
      const facts = element('dl', 'sec-review-facts');
      [['Tipo', typeLabel(category, this.draft.subtype)], ['Fecha', this.draft.date ? new Date(`${this.draft.date}T12:00:00`).toLocaleDateString('es-MX', { dateStyle: 'long' }) : 'Sin fecha'], ['Región', this.draft.region || 'Sin región vinculada'], ['Original', this.draft.file?.name || (category.fileAccept ? 'Sin archivo seleccionado' : 'Registro clínico')]].forEach(([label, value]) => {
        const fact = element('div');
        fact.append(element('dt', '', label), element('dd', '', value));
        facts.append(fact);
      });
      review.append(facts, element('p', 'sec-safety', 'Guardar crea un borrador. Ninguna sugerencia se incorpora al odontograma hasta que un profesional la confirme.'));
      const footer = element('footer', 'sec-dialog-actions');
      footer.append(button('Atrás', 'sec-secondary', () => this.back()), button('Guardar evidencia', 'sec-primary', () => this.submitDraft()));
      body.append(review, footer);
    }

    async submitDraft() {
      const payload = {
        modality: this.draft.modality,
        subtype: this.draft.subtype,
        title: this.draft.title || '',
        date: this.draft.date || '',
        region: this.draft.region || '',
        file: this.draft.file || null,
        status: 'draft'
      };
      this.dialog.dataset.busy = 'true';
      this.dialog.querySelectorAll('button').forEach(control => { control.disabled = true; });
      try {
        if (this.options.onCreate) await this.options.onCreate(payload);
        else this.root.dispatchEvent(new CustomEvent('smyl:evidence:create', { bubbles: true, detail: payload }));
        this.closeAdd();
      } catch (error) {
        const message = element('p', 'sec-error', error?.message || 'No se pudo guardar la evidencia. Intenta nuevamente.');
        this.dialog.querySelector('.sec-dialog-body')?.prepend(message);
      } finally {
        this.dialog.dataset.busy = 'false';
        this.dialog.querySelectorAll('button').forEach(control => { control.disabled = false; });
      }
    }

    setItems(items) {
      this.items = cleanItems(items);
      this.render();
    }

    destroy() {
      this.dialog.remove();
      this.root.replaceChildren();
      this.root.classList.remove('sec-root');
    }
  }

  global.SmylEvidenceCenter = Object.freeze({
    categories: CATEGORIES,
    mount(root, options) {
      return new EvidenceCenter(root, options);
    }
  });
})(window);
