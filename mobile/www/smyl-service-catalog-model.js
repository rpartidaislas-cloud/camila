/* SMYL · Catálogo dental: taxonomía y plantillas clínicas/fiscales. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylServiceCatalogModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CATEGORIES = [
    ['diagnostic','Valoración y diagnóstico'],['preventive','Prevención y limpieza'],
    ['restorative','Odontología restauradora'],['endodontic','Endodoncia'],
    ['periodontic','Periodoncia'],['surgery','Cirugía oral'],['prosthodontic','Prótesis'],
    ['aesthetic','Estética y carillas'],['orthodontic','Ortodoncia'],['implantology','Implantología'],
    ['pediatric','Odontopediatría'],['emergency','Urgencias'],['imaging','Imagen y laboratorio'],['other','Otros']
  ];
  var SCOPES = [
    ['session','Sesión'],['tooth','Pieza'],['teeth','Varias piezas'],['surface','Superficie dental'],
    ['quadrant','Cuadrante o sextante'],['arch','Arcada'],['phase','Fase'],['package','Paquete'],['general','General']
  ];
  var PRICING = [
    ['fixed','Precio fijo'],['per_tooth','Por pieza'],['per_surface','Por superficie'],
    ['per_quadrant','Por cuadrante'],['per_arch','Por arcada'],['per_session','Por sesión'],
    ['per_phase','Por fase'],['package','Paquete'],['from','Desde']
  ];
  var SAT = Object.freeze({
    dental:'85122000', dentist:'85122001', hygienist:'85122002', oral_surgery:'85122004', orthodontics:'85122005', xray:'85121808'
  });
  function p(key, category, name, scope, pricing, minutes, sat, specialty) {
    return Object.freeze({key:key,category:category,name:name,patient_name:name,scope_type:scope,pricing_mode:pricing,duration_minutes:minutes,sat_product_service_code:sat||SAT.dentist,specialty:specialty||category});
  }
  var PRESETS = [
    p('diagnostic-initial','diagnostic','Consulta y valoración inicial','session','fixed',60,SAT.dentist),
    p('diagnostic-periodic','diagnostic','Revisión periódica','session','fixed',30,SAT.dentist),
    p('diagnostic-specialist','diagnostic','Valoración por especialista','session','fixed',60,SAT.dentist),
    p('diagnostic-records','diagnostic','Expediente diagnóstico integral','package','package',90,SAT.dentist),
    p('diagnostic-scan','diagnostic','Escaneo intraoral','arch','per_arch',30,SAT.dentist),
    p('preventive-prophylaxis','preventive','Limpieza dental / profilaxis','session','per_session',45,SAT.hygienist),
    p('preventive-fluoride','preventive','Aplicación de flúor','session','per_session',30,SAT.hygienist),
    p('preventive-sealant','preventive','Sellador de fosetas y fisuras','tooth','per_tooth',30,SAT.hygienist),
    p('preventive-perio-maintenance','preventive','Mantenimiento periodontal','session','per_session',60,SAT.hygienist),
    p('restorative-resin-1','restorative','Resina de una superficie','surface','per_surface',45,SAT.dentist),
    p('restorative-resin-multi','restorative','Resina de múltiples superficies','tooth','per_tooth',60,SAT.dentist),
    p('restorative-ionomer','restorative','Restauración con ionómero','tooth','per_tooth',45,SAT.dentist),
    p('restorative-temporary','restorative','Restauración temporal','tooth','per_tooth',30,SAT.dentist),
    p('restorative-inlay','restorative','Incrustación dental','tooth','per_tooth',75,SAT.dentist),
    p('restorative-core','restorative','Reconstrucción de muñón','tooth','per_tooth',60,SAT.dentist),
    p('endodontic-root-canal','endodontic','Tratamiento de conductos','tooth','per_tooth',90,SAT.dentist,'endodontic'),
    p('endodontic-retreatment','endodontic','Retratamiento endodóntico','tooth','per_tooth',120,SAT.dentist,'endodontic'),
    p('endodontic-pulpotomy','endodontic','Pulpotomía','tooth','per_tooth',60,SAT.dentist,'endodontic'),
    p('endodontic-apex','endodontic','Apexificación / apicogénesis','phase','per_phase',60,SAT.dentist,'endodontic'),
    p('periodontic-chart','periodontic','Periodontograma','general','fixed',45,SAT.dentist,'periodontic'),
    p('periodontic-scaling','periodontic','Raspado y alisado radicular','quadrant','per_quadrant',60,SAT.dentist,'periodontic'),
    p('periodontic-gingivectomy','periodontic','Gingivectomía','quadrant','per_quadrant',90,SAT.dentist,'periodontic'),
    p('periodontic-crown-lengthening','periodontic','Alargamiento coronario','tooth','per_tooth',90,SAT.dentist,'periodontic'),
    p('periodontic-graft','periodontic','Injerto periodontal','quadrant','per_quadrant',120,SAT.dentist,'periodontic'),
    p('surgery-extraction','surgery','Extracción simple','tooth','per_tooth',45,SAT.oral_surgery,'surgery'),
    p('surgery-complex-extraction','surgery','Extracción quirúrgica','tooth','per_tooth',90,SAT.oral_surgery,'surgery'),
    p('surgery-third-molar','surgery','Cirugía de tercer molar','tooth','per_tooth',90,SAT.oral_surgery,'surgery'),
    p('surgery-frenectomy','surgery','Frenectomía','general','fixed',75,SAT.oral_surgery,'surgery'),
    p('surgery-biopsy','surgery','Biopsia oral','general','fixed',60,SAT.oral_surgery,'surgery'),
    p('prostho-crown','prosthodontic','Corona dental','tooth','per_tooth',75,SAT.dentist,'prosthodontic'),
    p('prostho-provisional','prosthodontic','Corona provisional','tooth','per_tooth',45,SAT.dentist,'prosthodontic'),
    p('prostho-bridge','prosthodontic','Puente fijo','teeth','per_tooth',90,SAT.dentist,'prosthodontic'),
    p('prostho-partial','prosthodontic','Prótesis parcial removible','arch','per_arch',60,SAT.dentist,'prosthodontic'),
    p('prostho-total','prosthodontic','Prótesis total','arch','per_arch',60,SAT.dentist,'prosthodontic'),
    p('prostho-reline','prosthodontic','Rebase o reparación de prótesis','arch','per_arch',45,SAT.dentist,'prosthodontic'),
    p('aesthetic-whitening','aesthetic','Blanqueamiento dental','arch','package',90,SAT.dentist,'aesthetic'),
    p('aesthetic-resin-veneer','aesthetic','Carilla de resina','tooth','per_tooth',75,SAT.dentist,'aesthetic'),
    p('aesthetic-ceramic-veneer','aesthetic','Carilla cerámica','tooth','per_tooth',75,SAT.dentist,'aesthetic'),
    p('aesthetic-mockup','aesthetic','Encerado diagnóstico y mock-up','package','package',90,SAT.dentist,'aesthetic'),
    p('aesthetic-contouring','aesthetic','Contorneado estético','teeth','per_tooth',60,SAT.dentist,'aesthetic'),
    p('ortho-study','orthodontic','Estudio de ortodoncia','package','package',90,SAT.orthodontics,'orthodontic'),
    p('ortho-brackets','orthodontic','Colocación de brackets','package','package',120,SAT.orthodontics,'orthodontic'),
    p('ortho-control','orthodontic','Control de ortodoncia','session','per_session',30,SAT.orthodontics,'orthodontic'),
    p('ortho-aligners','orthodontic','Tratamiento con alineadores','phase','per_phase',60,SAT.orthodontics,'orthodontic'),
    p('ortho-refinement','orthodontic','Refinamiento de alineadores','phase','per_phase',45,SAT.orthodontics,'orthodontic'),
    p('ortho-removal','orthodontic','Retiro de aparatología','session','fixed',60,SAT.orthodontics,'orthodontic'),
    p('ortho-retainer','orthodontic','Retenedor','arch','per_arch',45,SAT.orthodontics,'orthodontic'),
    p('implant-planning','implantology','Planeación de implante','package','package',60,SAT.oral_surgery,'implantology'),
    p('implant-placement','implantology','Colocación de implante','tooth','per_tooth',120,SAT.oral_surgery,'implantology'),
    p('implant-graft','implantology','Injerto óseo','phase','per_phase',120,SAT.oral_surgery,'implantology'),
    p('implant-abutment','implantology','Pilar sobre implante','tooth','per_tooth',45,SAT.dentist,'implantology'),
    p('implant-crown','implantology','Corona sobre implante','tooth','per_tooth',75,SAT.dentist,'implantology'),
    p('pediatric-consult','pediatric','Consulta odontopediátrica','session','fixed',45,SAT.dentist,'pediatric'),
    p('pediatric-crown','pediatric','Corona infantil','tooth','per_tooth',60,SAT.dentist,'pediatric'),
    p('pediatric-space-maintainer','pediatric','Mantenedor de espacio','arch','per_arch',60,SAT.dentist,'pediatric'),
    p('emergency-consult','emergency','Consulta de urgencia','session','fixed',45,SAT.dentist,'emergency'),
    p('emergency-drainage','emergency','Drenaje de absceso','general','fixed',45,SAT.dentist,'emergency'),
    p('emergency-recement','emergency','Recementación','tooth','per_tooth',30,SAT.dentist,'emergency'),
    p('imaging-periapical','imaging','Radiografía periapical','tooth','per_tooth',15,SAT.xray,'imaging'),
    p('imaging-panoramic','imaging','Radiografía panorámica','general','fixed',20,SAT.xray,'imaging'),
    p('imaging-cephalometric','imaging','Cefalometría','general','fixed',30,SAT.xray,'imaging'),
    p('imaging-cbct','imaging','Tomografía CBCT','general','fixed',30,SAT.xray,'imaging')
  ];

  function oneOf(list, value) { return list.some(function (row) { return row[0] === value; }); }
  function normalize(input) {
    var row = input || {};
    var price = row.reference_price === '' || row.reference_price == null ? null : Number(row.reference_price);
    return {
      template_key: row.template_key || null,
      name: String(row.name || '').trim(), patient_name: String(row.patient_name || row.name || '').trim(),
      description: String(row.description || '').trim(), category: row.category || 'other', specialty: row.specialty || row.category || 'general',
      duration_minutes: Number(row.duration_minutes || 60), reference_price: Number.isFinite(price) ? price : null,
      currency: row.currency || 'MXN', scope_type: row.scope_type || 'session', pricing_mode: row.pricing_mode || 'fixed',
      sat_product_service_code: String(row.sat_product_service_code || '').trim() || null,
      sat_unit_code: String(row.sat_unit_code || '').trim().toUpperCase() || null,
      tax_object_code: String(row.tax_object_code || '').trim() || null,
      fiscal_status: row.fiscal_status === 'reviewed' ? 'reviewed' : 'pending', active: row.active !== false,
      featured: row.featured === true
    };
  }
  function validate(input) {
    var row = normalize(input), errors = [];
    if (row.name.length < 2 || row.name.length > 100) errors.push('El nombre debe tener entre 2 y 100 caracteres.');
    if (!oneOf(CATEGORIES,row.category)) errors.push('La categoría no es válida.');
    if (!oneOf(SCOPES,row.scope_type)) errors.push('La unidad clínica no es válida.');
    if (!oneOf(PRICING,row.pricing_mode)) errors.push('La modalidad de precio no es válida.');
    if (row.reference_price != null && (row.reference_price < 0 || row.reference_price > 9999999999.99)) errors.push('El precio está fuera del rango permitido.');
    if (!Number.isInteger(row.duration_minutes) || row.duration_minutes < 10 || row.duration_minutes > 480) errors.push('La duración debe estar entre 10 y 480 minutos.');
    if (row.sat_product_service_code && !/^\d{8}$/.test(row.sat_product_service_code)) errors.push('Clave SAT debe contener 8 dígitos.');
    if (row.sat_unit_code && !/^[A-Z0-9]{1,8}$/.test(row.sat_unit_code)) errors.push('Clave de unidad SAT no válida.');
    if (row.tax_object_code && !/^\d{2}$/.test(row.tax_object_code)) errors.push('Objeto de impuesto debe contener 2 dígitos.');
    return errors;
  }
  function presetInsert(preset, tenantId, actorId) {
    var row = normalize(preset); row.tenant_id=tenantId; row.created_by=actorId; row.template_key=preset.key; row.fiscal_status='pending'; return row;
  }
  return Object.freeze({categories:CATEGORIES,scopes:SCOPES,pricingModes:PRICING,presets:PRESETS,satSuggestions:SAT,normalize:normalize,validate:validate,presetInsert:presetInsert});
});
