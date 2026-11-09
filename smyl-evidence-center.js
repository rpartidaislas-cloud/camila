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

  const TYPE_VISUALS = Object.freeze({
    face_rest: 'portrait',
    face_smile: 'smile',
    face_profile_right: 'profile-right',
    face_profile_left: 'profile-left',
    intraoral_frontal: 'mouth-front',
    intraoral_right: 'mouth-right',
    intraoral_left: 'mouth-left',
    occlusal_upper: 'arch-upper',
    occlusal_lower: 'arch-lower',
    localized: 'target',
    before_after: 'followup',
    periapical: 'xray-root',
    bitewing: 'xray-bitewing',
    panoramic: 'xray-panorama',
    occlusal: 'xray-arch',
    fmx: 'xray-series',
    cephalometric_lateral: 'xray-profile',
    cephalometric_pa: 'xray-frontal',
    tmj_series: 'xray-tmj',
    radiology_report: 'report-radiology',
    pathology_report: 'report-pathology',
    laboratory_report: 'report-laboratory',
    referral: 'report-referral',
    dental_lab_document: 'report-dental-lab',
    medical_clearance: 'report-medical',
    consent: 'report-consent'
  });

  const TYPE_ILLUSTRATIONS = Object.freeze({
    portrait: '<svg viewBox="0 0 88 64"><path d="M31 23c0-10 5-16 13-16s13 6 13 16-5 17-13 17-13-7-13-17Z"/><path d="M18 61c2-13 11-20 26-20s24 7 26 20"/><path class="guide" d="M44 5v52M24 25h40"/></svg>',
    smile: '<svg viewBox="0 0 88 64"><path d="M31 23c0-10 5-16 13-16s13 6 13 16-5 17-13 17-13-7-13-17Z"/><path d="M18 61c2-13 11-20 26-20s24 7 26 20"/><path class="accent" d="M36 28c5 5 11 5 16 0"/><path class="guide" d="M44 5v52M24 25h40"/></svg>',
    'profile-right': '<svg viewBox="0 0 88 64"><path d="M33 8c14 0 23 9 23 20l7 6-7 4c-2 12-10 19-23 20-7-10-9-19-9-27S27 15 33 8Z"/><path class="guide" d="M20 31h50M44 5v54"/></svg>',
    'profile-left': '<svg viewBox="0 0 88 64"><path d="M55 8c-14 0-23 9-23 20l-7 6 7 4c2 12 10 19 23 20 7-10 9-19 9-27S61 15 55 8Z"/><path class="guide" d="M18 31h50M44 5v54"/></svg>',
    'mouth-front': '<svg viewBox="0 0 88 64"><path d="M12 33c8-16 20-23 32-23s24 7 32 23c-8 16-20 21-32 21S20 49 12 33Z"/><path class="accent" d="M18 32h52M27 23v19M36 18v29M44 16v32M52 18v29M61 23v19"/></svg>',
    'mouth-right': '<svg viewBox="0 0 88 64"><path d="M12 34c14-17 30-23 61-13-7 23-29 33-61 13Z"/><path class="accent" d="M17 33c19-3 35-5 52-9M30 26v15M43 23v17M56 21v15"/></svg>',
    'mouth-left': '<svg viewBox="0 0 88 64"><path d="M76 34C62 17 46 11 15 21c7 23 29 33 61 13Z"/><path class="accent" d="M71 33c-19-3-35-5-52-9M58 26v15M45 23v17M32 21v15"/></svg>',
    'arch-upper': '<svg viewBox="0 0 88 64"><path d="M13 50C14 19 26 8 44 8s30 11 31 42"/><path class="accent" d="M21 47c2-20 10-30 23-30s21 10 23 30"/><path class="guide" d="M24 31h40"/></svg>',
    'arch-lower': '<svg viewBox="0 0 88 64"><path d="M13 14c1 31 13 42 31 42s30-11 31-42"/><path class="accent" d="M21 17c2 20 10 30 23 30s21-10 23-30"/><path class="guide" d="M24 33h40"/></svg>',
    target: '<svg viewBox="0 0 88 64"><circle cx="44" cy="32" r="20"/><circle class="accent" cx="44" cy="32" r="8"/><path class="guide" d="M44 4v15M44 45v15M16 32h15M57 32h15"/></svg>',
    followup: '<svg viewBox="0 0 88 64"><rect x="8" y="10" width="30" height="44" rx="8"/><rect x="50" y="10" width="30" height="44" rx="8"/><path class="accent" d="m39 27 8 5-8 5M17 34c5-8 9-8 13 0M59 34c5-8 9-8 13 0"/></svg>',
    'xray-root': '<svg viewBox="0 0 88 64"><path d="M31 11c5-5 21-5 26 0l-4 21-2 22-7-15-7 15-2-22-4-21Z"/><path class="accent" d="M44 11v28M36 24h16"/></svg>',
    'xray-bitewing': '<svg viewBox="0 0 88 64"><path d="M10 17c8-9 17-9 25 0 6-9 13-9 19 0 7-9 15-9 24 0l-5 16H15l-5-16ZM15 47h58M25 34v20M44 34v20M63 34v20"/><path class="accent" d="M8 32h72"/></svg>',
    'xray-panorama': '<svg viewBox="0 0 88 64"><path d="M8 20c11 31 61 31 72 0M15 17c8 22 50 22 58 0"/><path class="accent" d="M12 35c16 19 48 19 64 0M22 23v16M32 28v16M44 30v17M56 28v16M66 23v16"/></svg>',
    'xray-arch': '<svg viewBox="0 0 88 64"><path d="M12 52C13 20 26 8 44 8s31 12 32 44M23 49c2-19 9-28 21-28s19 9 21 28"/><path class="accent" d="M44 8v45M20 34h48"/></svg>',
    'xray-series': '<svg viewBox="0 0 88 64"><rect x="8" y="8" width="21" height="19" rx="3"/><rect x="33" y="8" width="22" height="19" rx="3"/><rect x="59" y="8" width="21" height="19" rx="3"/><rect x="8" y="36" width="21" height="19" rx="3"/><rect x="33" y="36" width="22" height="19" rx="3"/><rect x="59" y="36" width="21" height="19" rx="3"/><path class="accent" d="M18 13v9M44 13v9M69 13v9M18 41v9M44 41v9M69 41v9"/></svg>',
    'xray-profile': '<svg viewBox="0 0 88 64"><path d="M31 7c18 0 29 11 29 24l8 6-9 5c-4 10-13 16-27 16-7-9-10-18-10-28S25 13 31 7Z"/><path class="accent" d="M17 31h56M44 4v56"/></svg>',
    'xray-frontal': '<svg viewBox="0 0 88 64"><path d="M24 24C24 11 33 5 44 5s20 6 20 19c0 19-8 34-20 34S24 43 24 24Z"/><path class="accent" d="M44 5v53M18 27h52M32 40h24"/></svg>',
    'xray-tmj': '<svg viewBox="0 0 88 64"><path d="M17 12c11 0 19 8 19 19s-8 21-19 21M71 12c-11 0-19 8-19 19s8 21 19 21"/><circle class="accent" cx="25" cy="31" r="6"/><circle class="accent" cx="63" cy="31" r="6"/></svg>',
    'report-radiology': '<svg viewBox="0 0 88 64"><rect x="20" y="5" width="48" height="54" rx="5"/><path d="M32 16h24M32 48h24"/><path class="accent" d="M32 38c2-13 22-13 24 0M38 27c0-6 12-6 12 0"/></svg>',
    'report-pathology': '<svg viewBox="0 0 88 64"><rect x="19" y="6" width="50" height="52" rx="5"/><circle cx="44" cy="30" r="15"/><circle class="accent" cx="39" cy="26" r="4"/><circle class="accent" cx="50" cy="34" r="5"/><path d="M30 50h28"/></svg>',
    'report-laboratory': '<svg viewBox="0 0 88 64"><rect x="19" y="6" width="50" height="52" rx="5"/><path d="M37 14h14M40 14v14L31 47c-2 4 2 7 6 7h14c4 0 8-3 6-7l-9-19V14"/><path class="accent" d="M35 43h18"/></svg>',
    'report-referral': '<svg viewBox="0 0 88 64"><rect x="18" y="7" width="52" height="50" rx="5"/><path d="M28 20h25M28 31h17M28 42h23"/><path class="accent" d="m52 36 9 6-9 6"/></svg>',
    'report-dental-lab': '<svg viewBox="0 0 88 64"><rect x="18" y="7" width="52" height="50" rx="5"/><path d="M33 19c6-5 16-5 22 0l-3 15-2 14-6-10-6 10-2-14-3-15Z"/><path class="accent" d="M28 51h32"/></svg>',
    'report-medical': '<svg viewBox="0 0 88 64"><rect x="18" y="7" width="52" height="50" rx="5"/><path d="M44 15c8 7 14 7 14 7 0 15-4 23-14 28-10-5-14-13-14-28 0 0 6 0 14-7Z"/><path class="accent" d="M44 25v15M37 32h14"/></svg>',
    'report-consent': '<svg viewBox="0 0 88 64"><rect x="18" y="7" width="52" height="50" rx="5"/><path d="M28 19h31M28 29h24M28 48h31"/><path class="accent" d="M30 42c9-10 11 4 18-5 3-4 7 2 11-3"/></svg>',
    document: '<svg viewBox="0 0 88 64"><rect x="20" y="5" width="48" height="54" rx="5"/><path d="M31 18h26M31 29h26M31 40h19M31 50h23"/><path class="accent" d="M55 5v13h13"/></svg>'
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

  const REGION_OPTIONS = Object.freeze([
    ['', 'Sin región específica'],
    ['full_mouth', 'Boca completa'],
    ['upper_arch', 'Arcada superior'],
    ['lower_arch', 'Arcada inferior'],
    ['quadrant_1', 'Cuadrante 1 · superior derecho'],
    ['quadrant_2', 'Cuadrante 2 · superior izquierdo'],
    ['quadrant_3', 'Cuadrante 3 · inferior izquierdo'],
    ['quadrant_4', 'Cuadrante 4 · inferior derecho'],
    ['tooth', 'Pieza específica'],
    ['soft_tissue', 'Tejidos blandos'],
    ['face', 'Rostro y sonrisa']
  ]);

  const REGION_LABELS = Object.freeze(Object.fromEntries(REGION_OPTIONS));

  function modalityAction(category) {
    return ({
      photograph: 'Tomar fotografías',
      radiograph_2d: 'Subir radiografía',
      document: 'Agregar documento'
    })[category?.id] || `Agregar ${String(category?.short || 'evidencia').toLowerCase()}`;
  }

  function typeGroup(category, subtype) {
    if (category.id === 'photograph') {
      if (subtype.startsWith('face_')) return 'Rostro';
      if (subtype.startsWith('intraoral_')) return 'Intraorales';
      if (subtype.startsWith('occlusal_')) return 'Oclusales';
      return 'Otras';
    }
    if (category.id === 'radiograph_2d') {
      if (['periapical', 'bitewing', 'panoramic'].includes(subtype)) return 'Disponibles ahora';
      return 'Estudios especializados';
    }
    if (category.id === 'document') {
      if (['radiology_report', 'pathology_report', 'laboratory_report'].includes(subtype)) return 'Informes clínicos';
      if (['referral', 'dental_lab_document', 'medical_clearance'].includes(subtype)) return 'Coordinación y laboratorio';
      return 'Consentimientos y otros';
    }
    return 'Tipo de documento';
  }

  function typeVisual(subtype) {
    return TYPE_VISUALS[subtype] || (subtype.startsWith('occlusal_') ? 'xray-arch' : 'document');
  }

  function typeIllustration(subtype) {
    const visual = typeVisual(subtype);
    const node = element('span', 'sec-type-visual');
    node.dataset.visual = visual;
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = TYPE_ILLUSTRATIONS[visual] || TYPE_ILLUSTRATIONS.document;
    return node;
  }

  function defaultRegionFor(subtype) {
    if (subtype?.startsWith('face_')) return 'face';
    if (subtype === 'occlusal_upper') return 'upper_arch';
    if (subtype === 'occlusal_lower') return 'lower_arch';
    if (subtype === 'panoramic' || subtype === 'fmx' || subtype === 'before_after') return 'full_mouth';
    if (subtype === 'localized' || subtype === 'periapical' || subtype === 'bitewing') return 'tooth';
    return '';
  }

  function humanFileSize(size) {
    const value = Number(size) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
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
      this.previewUrl = '';
      this.returnFocus = null;
      this.renderShell();
      this.render();
    }

    renderShell() {
      this.root.classList.add('sec-root');
      this.root.replaceChildren();

      const head = element('header', 'sec-head');
      const copy = element('div', 'sec-head-copy');
      copy.append(element('span', 'sec-kicker', 'EXPEDIENTE DEL PACIENTE'), element('h2', '', 'Documentación clínica'), element('p', '', 'Fotografías, radiografías e informes, ordenados en un solo lugar.'));
      this.addButton = button('Agregar evidencia', 'sec-primary sec-add', () => this.openAdd());
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
      this.root.dataset.empty = String(this.items.length === 0);
      this.addButton.hidden = this.items.length === 0;
      this.renderSummary();
      this.renderFilters();
      this.renderList();
    }

    renderSummary() {
      const pending = this.items.filter(item => item.status === 'review').length;
      const signed = this.items.filter(item => item.status === 'signed').length;
      this.summary.replaceChildren();
      [[this.items.length, this.items.length === 1 ? 'registro' : 'registros'], [pending, 'por revisar'], [signed, 'confirmados']].forEach(([value, label]) => {
        const metric = element('span', 'sec-metric');
        metric.append(element('strong', '', String(value)), element('small', '', label));
        this.summary.append(metric);
      });
    }

    renderFilters() {
      this.filters.replaceChildren();
      const creatable = category => {
        const state = this.options.creationAvailability?.(category.id);
        return state === undefined || state === true || state?.enabled !== false;
      };
      const options = [{ id: 'all', short: 'Todo' }, ...CATEGORIES.filter(category => creatable(category) || this.items.some(item => item.modality === category.id))];
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
        empty.append(icon(category?.icon || 'document'), element('h3', '', category ? `Sin ${category.label.toLowerCase()}` : 'Agrega la primera evidencia'), element('p', '', category ? category.description : 'Empieza con una fotografía, una radiografía o un documento clínico.'));
        const actions = element('div', 'sec-empty-actions');
        const quick = category ? [category] : CATEGORIES.filter(item => ['photograph', 'radiograph_2d', 'document'].includes(item.id));
        quick.forEach((item, index) => {
          const action = button('', index === 0 ? 'sec-quick sec-quick-primary' : 'sec-quick', () => this.openAdd(item.id));
          action.append(icon(item.icon), element('span', '', modalityAction(item)));
          actions.append(action);
        });
        empty.append(actions);
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
      this.step = 0;
      this.draft = preselectedModality ? { modality: preselectedModality } : {};
      this.releasePreview();
      this.renderWizard();
      if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
      else this.dialog.setAttribute('open', '');
      queueMicrotask(() => this.dialog.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled])')?.focus());
    }

    closeAdd() {
      if (this.dialog.open && typeof this.dialog.close === 'function') this.dialog.close();
      else this.dialog.removeAttribute('open');
      this.releasePreview();
      this.returnFocus?.focus?.();
    }

    next() {
      this.step = Math.min(1, this.step + 1);
      this.renderWizard();
    }

    back() {
      if (this.step === 1) this.step = 0;
      else if (this.draft.modality) {
        delete this.draft.modality;
        delete this.draft.subtype;
      }
      this.renderWizard();
    }

    releasePreview() {
      if (this.previewUrl && global.URL?.revokeObjectURL) global.URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = '';
    }

    renderWizard() {
      const category = this.draft.modality ? categoryById(this.draft.modality) : null;
      this.dialog.replaceChildren();
      const head = element('header', 'sec-dialog-head');
      const title = element('div');
      title.append(element('span', 'sec-kicker', `PASO ${this.step + 1} DE 2`), element('h2', '', ['Elige la evidencia', 'Confirma el contexto'][this.step]));
      title.querySelector('h2').id = 'sec-dialog-title';
      head.append(title, button('Cerrar', 'sec-close', () => this.closeAdd()));
      const progress = element('div', 'sec-progress');
      progress.setAttribute('aria-label', `Paso ${this.step + 1} de 2`);
      for (let index = 0; index < 2; index += 1) {
        const bar = element('i');
        bar.dataset.complete = String(index <= this.step);
        progress.append(bar);
      }
      const body = element('div', 'sec-dialog-body');
      if (this.step === 0) this.renderCategoryStep(body);
      if (this.step === 1) this.renderDetailsStep(body, category);
      this.dialog.append(head, progress, body);
    }

    renderCategoryStep(body) {
      if (this.draft.modality) {
        this.renderTypeStep(body, categoryById(this.draft.modality));
        return;
      }
      body.append(element('p', 'sec-step-intro', 'Selecciona una acción. Sólo mostramos las opciones disponibles en este expediente.'));
      const grid = element('div', 'sec-category-grid sec-category-primary');
      const more = element('details', 'sec-more-types');
      const moreSummary = element('summary');
      moreSummary.append(element('span', '', 'Más tipos de estudio'), element('small', '', 'Requieren herramientas especializadas'));
      const moreGrid = element('div', 'sec-category-grid');
      CATEGORIES.forEach(category => {
        const rawAvailability = this.options.creationAvailability?.(category.id);
        const availability = rawAvailability === false
          ? { enabled: false, label: 'Por activar' }
          : { enabled: rawAvailability?.enabled !== false, label: rawAvailability?.label || '' };
        const card = button('', 'sec-category', availability.enabled ? () => {
          this.draft.modality = category.id;
          this.renderWizard();
        } : null);
        card.dataset.modality = category.id;
        card.dataset.available = String(availability.enabled);
        card.setAttribute('aria-disabled', String(!availability.enabled));
        card.append(icon(category.icon));
        const copy = element('span');
        copy.append(element('strong', '', availability.enabled ? modalityAction(category) : category.label), element('small', '', category.description));
        card.append(copy);
        if (!availability.enabled) card.append(element('em', '', availability.label || 'Por activar'));
        (availability.enabled ? grid : moreGrid).append(card);
      });
      body.append(grid);
      if (moreGrid.childElementCount) {
        more.append(moreSummary, moreGrid);
        body.append(more);
      }
    }

    renderTypeStep(body, category) {
      if (!category) {
        this.step = 0;
        this.renderWizard();
        return;
      }
      const intro = element('div', 'sec-selected-category sec-selected-category-change');
      intro.append(icon(category.icon), element('div'));
      intro.lastChild.append(element('strong', '', category.label), element('small', '', category.description));
      intro.append(button('Cambiar', 'sec-text-action', () => {
        delete this.draft.modality;
        delete this.draft.subtype;
        this.renderWizard();
      }));
      body.append(intro);
      if (category.advanced) body.append(element('p', 'sec-notice', 'CBCT y DICOM requieren un visor especializado. SMYL conservará el volumen original y su informe; no lo convertirá en una imagen plana.'));
      const groups = new Map();
      category.types.forEach(([id, label]) => {
        const rawAvailability = this.options.typeAvailability?.(category.id, id);
        const availability = rawAvailability === false
          ? { enabled: false, label: 'Por activar' }
          : { enabled: rawAvailability?.enabled !== false, label: rawAvailability?.label || '' };
        const groupName = typeGroup(category, id);
        if (!groups.has(groupName)) groups.set(groupName, { enabled: [], disabled: [] });
        const option = button('', 'sec-type', availability.enabled ? () => {
          this.draft.subtype = id;
          this.next();
        } : null);
        option.dataset.visual = typeVisual(id);
        option.append(typeIllustration(id), element('span', 'sec-type-label', label));
        if (!availability.enabled) option.append(element('em', '', availability.label || 'Por activar'));
        option.setAttribute('aria-disabled', String(!availability.enabled));
        option.setAttribute('aria-pressed', String(this.draft.subtype === id));
        groups.get(groupName)[availability.enabled ? 'enabled' : 'disabled'].push(option);
      });
      groups.forEach((options, label) => {
        if (options.enabled.length) {
          const group = element('section', 'sec-type-group');
          group.append(element('h3', '', label));
          const grid = element('div', 'sec-type-grid');
          options.enabled.forEach(option => grid.append(option));
          group.append(grid);
          body.append(group);
        }
        if (options.disabled.length) {
          const unavailable = element('details', 'sec-unavailable-types');
          const summary = element('summary', '', `${label} · por activar`);
          const grid = element('div', 'sec-type-grid');
          options.disabled.forEach(option => grid.append(option));
          unavailable.append(summary, grid);
          body.append(unavailable);
        }
      });
    }

    renderDetailsStep(body, category) {
      if (!category || !this.draft.subtype) {
        this.step = 0;
        this.renderWizard();
        return;
      }
      const form = element('form', 'sec-form');
      const error = element('p', 'sec-inline-error');
      error.setAttribute('role', 'alert');
      form.addEventListener('submit', event => {
        event.preventDefault();
        const data = new FormData(form);
        this.draft.title = String(data.get('title') || '').trim();
        this.draft.date = String(data.get('date') || '');
        this.draft.regionPreset = String(data.get('regionPreset') || '');
        this.draft.tooth = String(data.get('tooth') || '').trim();
        this.draft.region = this.draft.regionPreset === 'tooth'
          ? (this.draft.tooth ? `Pieza ${this.draft.tooth}` : '')
          : (REGION_LABELS[this.draft.regionPreset] || '');
        this.draft.file = form.elements.evidenceFile?.files?.[0] || this.draft.file || null;
        if (category.fileAccept && !this.draft.file) {
          error.textContent = 'Selecciona el archivo original para continuar.';
          form.querySelector('.sec-file-preview')?.focus?.();
          return;
        }
        if (this.draft.regionPreset === 'tooth' && !/^([1-4][1-8])$/.test(this.draft.tooth)) {
          error.textContent = 'Escribe una pieza FDI válida, por ejemplo 16, 21, 36 o 48.';
          form.elements.tooth?.focus();
          return;
        }
        error.textContent = '';
        this.submitDraft();
      });
      const summary = element('div', 'sec-selected-category sec-selected-category-change');
      summary.append(icon(category.icon), element('div'));
      summary.lastChild.append(element('strong', '', typeLabel(category, this.draft.subtype)), element('small', '', category.label));
      summary.append(button('Cambiar tipo', 'sec-text-action', () => {
        this.step = 0;
        delete this.draft.subtype;
        this.releasePreview();
        this.renderWizard();
      }));
      form.append(summary, error);

      const layout = element('div', 'sec-details-layout');
      const media = element('section', 'sec-media-panel');
      media.append(element('span', 'sec-panel-label', 'ARCHIVO ORIGINAL'));
      const preview = element('div', 'sec-file-preview');
      preview.tabIndex = -1;
      const renderFile = file => {
        preview.replaceChildren();
        preview.dataset.hasFile = String(!!file);
        this.releasePreview();
        if (!file) {
          preview.append(icon(category.icon), element('strong', '', category.id === 'photograph' ? 'Toma o elige una imagen' : 'Selecciona el estudio original'), element('small', '', 'Verás una vista previa antes de continuar.'));
          return;
        }
        if (file.type?.startsWith('image/') && global.URL?.createObjectURL) {
          this.previewUrl = global.URL.createObjectURL(file);
          const image = element('img');
          image.src = this.previewUrl;
          image.alt = 'Vista previa del archivo seleccionado';
          preview.append(image);
        } else {
          const documentIcon = icon(category.icon);
          documentIcon.classList.add('sec-file-document');
          preview.append(documentIcon);
        }
        const meta = element('div', 'sec-file-meta');
        meta.append(element('strong', '', file.name || 'Archivo seleccionado'), element('small', '', humanFileSize(file.size)));
        preview.append(meta);
      };
      renderFile(this.draft.file);
      media.append(preview);

      const fileInput = Object.assign(element('input', 'sec-file-input'), { type: 'file', name: 'evidenceFile', accept: category.fileAccept || '' });
      fileInput.setAttribute('aria-label', 'Seleccionar archivo original');
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0] || null;
        this.draft.file = file;
        renderFile(file);
        error.textContent = '';
      });
      const fileActions = element('div', 'sec-file-actions');
      if (category.id === 'photograph') {
        const camera = button('Tomar foto', 'sec-primary sec-file-action', () => {
          fileInput.setAttribute('capture', this.draft.subtype.startsWith('face_') ? 'user' : 'environment');
          fileInput.click();
        });
        fileActions.append(camera);
      }
      fileActions.append(button(this.draft.file ? 'Cambiar archivo' : 'Elegir archivo', 'sec-secondary sec-file-action', () => {
        fileInput.removeAttribute('capture');
        fileInput.click();
      }));
      media.append(fileActions, fileInput, element('p', 'sec-file-help', category.id === 'radiograph_2d' ? 'JPG o PNG. El original se conserva sin modificaciones.' : 'El original se conserva sin modificaciones.'));

      const fieldsPanel = element('section', 'sec-context-panel');
      fieldsPanel.append(element('span', 'sec-panel-label', 'CONTEXTO CLÍNICO'), element('h3', '', 'Confirma los datos esenciales'));
      const fields = element('div', 'sec-field-grid');
      const dateField = element('label', 'sec-field');
      dateField.append(element('span', '', 'Fecha del estudio'), Object.assign(element('input'), { type: 'date', name: 'date', required: true, value: this.draft.date || new Date().toISOString().slice(0, 10) }));
      const regionField = element('label', 'sec-field');
      const regionSelect = element('select');
      regionSelect.name = 'regionPreset';
      REGION_OPTIONS.forEach(([value, label]) => regionSelect.append(Object.assign(element('option', '', label), { value })));
      regionSelect.value = this.draft.regionPreset || defaultRegionFor(this.draft.subtype);
      regionField.append(element('span', '', 'Región relacionada'), regionSelect);
      const toothField = element('label', 'sec-field sec-tooth-field');
      const toothInput = Object.assign(element('input'), { type: 'text', name: 'tooth', value: this.draft.tooth || '', maxLength: 2, inputMode: 'numeric', placeholder: 'Ej. 16' });
      toothField.append(element('span', '', 'Pieza FDI'), toothInput);
      const syncTooth = () => { toothField.hidden = regionSelect.value !== 'tooth'; };
      regionSelect.addEventListener('change', syncTooth);
      syncTooth();
      const titleField = element('label', 'sec-field sec-field-wide');
      titleField.append(element('span', '', 'Nombre descriptivo · opcional'), Object.assign(element('input'), { type: 'text', name: 'title', value: this.draft.title || '', maxLength: 120, placeholder: category.id === 'photograph' ? 'Ej. Valoración inicial' : 'Ej. Estudio de control' }));
      fields.append(dateField, regionField, toothField, titleField);
      fieldsPanel.append(fields, element('p', 'sec-safety', 'Se preparará un borrador. Nada pasa al odontograma sin confirmación profesional.'));
      layout.append(media, fieldsPanel);
      form.append(layout);
      const footer = element('footer', 'sec-dialog-actions');
      footer.append(button('Atrás', 'sec-secondary', () => this.back()), Object.assign(element('button', 'sec-primary', category.id === 'radiograph_2d' ? 'Continuar al editor' : 'Continuar para guardar'), { type: 'submit' }));
      form.append(footer);
      body.append(form);
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
      this.releasePreview();
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
