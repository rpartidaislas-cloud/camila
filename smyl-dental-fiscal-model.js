/* SMYL · Reglas de preparación fiscal exclusivas para odontología.
 * Orientan y bloquean inconsistencias; no sustituyen la revisión del emisor,
 * contador, PAC ni los catálogos vigentes del SAT. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylDentalFiscalModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SERVICE_KINDS = [
    ['professional_dental','Atención profesional odontológica'],
    ['dental_hygiene','Higiene dental profesional'],
    ['oral_surgery','Cirugía oral o maxilofacial'],
    ['orthodontics','Ortodoncia'],
    ['dental_imaging','Imagen o estudio odontológico'],
    ['dental_lab','Laboratorio o prótesis dental'],
    ['dental_product','Producto dental vendido por separado'],
    ['dental_other','Otro concepto exclusivamente dental']
  ];
  var TAX_TREATMENTS = [
    ['pending','Pendiente de revisión'],
    ['exempt','IVA exento'],
    ['rate','IVA con tasa'],
    ['non_object','No objeto de impuesto']
  ];
  var DEDUCTION_PROFILES = [
    ['dental_candidate','Puede corresponder a honorarios dentales'],
    ['disability_candidate','Puede corresponder a incapacidad o discapacidad'],
    ['not_personal','No se presenta como deducción personal'],
    ['review','Requiere criterio fiscal antes de sugerir uso']
  ];
  var DENTAL_SAT_KEYS = Object.freeze({
    professional_dental:['85122000','85122001'], dental_hygiene:['85122002'],
    oral_surgery:['85122004'], orthodontics:['85122005'], dental_imaging:['85121808'],
    dental_lab:['85122000','85122001'], dental_product:[], dental_other:['85122000','85122001']
  });

  function includesPair(list, value) { return list.some(function (x) { return x[0] === value; }); }
  function serviceKindFor(input) {
    var row=input||{}, key=String(row.template_key||row.key||''), sat=String(row.sat_product_service_code||'');
    if (sat==='85122002') return 'dental_hygiene';
    if (sat==='85122004') return 'oral_surgery';
    if (sat==='85122005') return 'orthodontics';
    if (sat==='85121808' || key.indexOf('imaging-')===0) return 'dental_imaging';
    return 'professional_dental';
  }
  function deductionProfileFor(input) {
    var row=input||{}, category=String(row.category||''), kind=row.fiscal_service_kind||serviceKindFor(row);
    if (kind==='dental_product') return 'not_personal';
    if (category==='aesthetic') return 'review';
    return 'dental_candidate';
  }
  function suggestedPolicy(input) {
    var kind=(input&&input.fiscal_service_kind)||serviceKindFor(input);
    var professional=['professional_dental','dental_hygiene','oral_surgery','orthodontics'].indexOf(kind)>=0;
    return {
      fiscal_service_kind:kind,
      tax_treatment:professional?'exempt':'pending',
      tax_object_code:professional?'02':null,
      tax_rate:null,
      deduction_profile:deductionProfileFor(input),
      professional_title_required:professional,
      sat_unit_code:(input&&input.sat_unit_code)||'E48'
    };
  }
  function normalize(input) {
    var row=input||{}, suggested=suggestedPolicy(row);
    var rate=row.tax_rate===''||row.tax_rate==null?null:Number(row.tax_rate);
    return {
      fiscal_service_kind:row.fiscal_service_kind||suggested.fiscal_service_kind,
      tax_treatment:row.tax_treatment||suggested.tax_treatment,
      tax_object_code:String(row.tax_object_code||suggested.tax_object_code||'').trim()||null,
      tax_rate:Number.isFinite(rate)?rate:null,
      deduction_profile:row.deduction_profile||suggested.deduction_profile,
      professional_title_required:row.professional_title_required==null?suggested.professional_title_required:row.professional_title_required===true,
      fiscal_policy_note:String(row.fiscal_policy_note||'').trim(),
      sat_unit_code:String(row.sat_unit_code||suggested.sat_unit_code||'').trim().toUpperCase()||null
    };
  }
  function validate(input) {
    var row=normalize(input), errors=[];
    if (!includesPair(SERVICE_KINDS,row.fiscal_service_kind)) errors.push('La clase fiscal no pertenece al catálogo dental de SMYL.');
    if (!includesPair(TAX_TREATMENTS,row.tax_treatment)) errors.push('El tratamiento de IVA no es válido.');
    if (!includesPair(DEDUCTION_PROFILES,row.deduction_profile)) errors.push('El criterio de deducción no es válido.');
    if (row.tax_treatment==='exempt' && (row.tax_object_code!=='02'||row.tax_rate!==null)) errors.push('IVA exento requiere ObjetoImp 02 y no debe llevar tasa.');
    if (row.tax_treatment==='rate' && (row.tax_object_code!=='02'||row.tax_rate==null||row.tax_rate<0||row.tax_rate>1)) errors.push('IVA con tasa requiere ObjetoImp 02 y una tasa entre 0 y 1.');
    if (row.tax_treatment==='non_object' && (row.tax_object_code!=='01'||row.tax_rate!==null)) errors.push('No objeto requiere ObjetoImp 01 y no debe llevar tasa.');
    if (row.tax_treatment==='pending' && input&&input.fiscal_status==='reviewed') errors.push('No se puede marcar como revisado mientras el tratamiento fiscal esté pendiente.');
    var allowed=DENTAL_SAT_KEYS[row.fiscal_service_kind]||[];
    if (allowed.length && input&&input.sat_product_service_code && allowed.indexOf(String(input.sat_product_service_code))<0) errors.push('La clave SAT requiere revisión porque no coincide con la clase dental seleccionada.');
    if (row.fiscal_policy_note.length>500) errors.push('La nota fiscal no puede exceder 500 caracteres.');
    return errors;
  }
  function paymentDecision(total, payments) {
    var amount=Math.max(0,Number(total)||0), rows=(payments||[]).filter(function(p){return p&&p.status!=='cancelled'&&p.status!=='refunded';});
    var paid=rows.reduce(function(s,p){return s+Math.max(0,Number(p.amount)||0);},0), full=paid>=amount-0.01;
    var forms={};rows.forEach(function(p){var code=String(p.payment_form||'99');forms[code]=(forms[code]||0)+(Number(p.amount)||0);});
    var form=Object.keys(forms).sort(function(a,b){return forms[b]-forms[a];})[0]||'99';
    return {payment_method:full?'PUE':'PPD',payment_form:full?form:'99',paid:Math.round(paid*100)/100,balance:Math.max(0,Math.round((amount-paid)*100)/100)};
  }
  function depositKind(serviceDefined, priceDefined) { return serviceDefined&&priceDefined?'partial_payment':'advance'; }
  function deductionGuidance(input) {
    var row=input||{}, use=String(row.cfdi_use||''), person=String(row.receiver_person_type||''), form=String(row.payment_form||'');
    var warnings=[];
    if ((use==='D01'||use==='D02')&&person&&person!=='individual') warnings.push('D01 y D02 no deben sugerirse como deducción personal a una persona moral.');
    if ((use==='D01'||use==='D02')&&form==='01') warnings.push('El pago en efectivo puede facturarse, pero no debe presentarse como deducción personal dental.');
    return {warnings:warnings,eligible_hint:warnings.length===0&&(use==='D01'||use==='D02')};
  }

  return Object.freeze({serviceKinds:SERVICE_KINDS,taxTreatments:TAX_TREATMENTS,deductionProfiles:DEDUCTION_PROFILES,dentalSatKeys:DENTAL_SAT_KEYS,serviceKindFor:serviceKindFor,suggestedPolicy:suggestedPolicy,normalize:normalize,validate:validate,paymentDecision:paymentDecision,depositKind:depositKind,deductionGuidance:deductionGuidance});
});
