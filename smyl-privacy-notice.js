/* SMYL · Aviso de privacidad y firma en pantalla: reglas puras (sin DOM ni red).
 *
 * IMPORTANTE: el texto de abajo es un MODELO PROVISIONAL. Es genérico y no sustituye el aviso de privacidad de cada clínica
 * (que debe identificar al responsable, su domicilio y los medios para ejercer derechos ARCO). Debe revisarlo el asesor legal
 * de la clínica antes de usarlo con pacientes. Cada firma guarda el texto exacto que se mostró, su versión y la marca
 * `provisional`, para poder distinguir después las firmas hechas con este modelo. Para usar el aviso propio de la clínica:
 * reemplazar NOTICE (texto y `version`) y poner `provisional:false`; las firmas anteriores conservan su texto y su versión. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylPrivacyNotice=api;})(globalThis,function(){
  'use strict';
  var NOTICE={
    version:'modelo-provisional-1',
    provisional:true,
    title:'Aviso de privacidad',
    paragraphs:[
      'Responsable: {CLINICA}. Sus datos personales, incluidos los de salud (datos personales sensibles), serán tratados para crear y mantener su expediente clínico, brindarle atención dental, agendar y dar seguimiento a sus citas, y comunicarnos con usted, por ejemplo por WhatsApp o por llamada.',
      'Sus datos podrán ser consultados por el personal de la clínica que participa en su atención. No se transferirán a terceros sin su consentimiento, salvo en los casos que la ley permita.',
      'Usted puede ejercer sus derechos de acceso, rectificación, cancelación y oposición (ARCO) y revocar su consentimiento solicitándolo a la clínica por los medios que ella le indique.',
      'Al firmar, usted confirma que leyó este aviso y otorga su consentimiento expreso para el tratamiento de sus datos personales y sensibles para las finalidades anteriores.'
    ]
  };
  var MIN_POINTS=12,MIN_LENGTH=60;   // una firma real tiene trazo: unos cuantos puntos o un toque suelto no cuentan

  /* El texto que se muestra y se guarda: con el nombre de la clínica puesto. */
  function render(clinicName){
    var name=String(clinicName==null?'':clinicName).trim()||'la clínica';
    return {version:NOTICE.version,provisional:NOTICE.provisional,title:NOTICE.title,text:NOTICE.paragraphs.join('\n\n').replace('{CLINICA}',name)};
  }
  function paragraphs(clinicName){return render(clinicName).text.split('\n\n');}

  /* strokes: [[{x,y},…],…] en píxeles del lienzo. Mide cuánto se trazó. */
  function inkOf(strokes){
    var points=0,length=0;
    (strokes||[]).forEach(function(stroke){
      (stroke||[]).forEach(function(p,i){points++;if(i){var q=stroke[i-1];length+=Math.hypot(p.x-q.x,p.y-q.y);}});
    });
    return {points:points,length:Math.round(length),ok:points>=MIN_POINTS&&length>=MIN_LENGTH};
  }

  /* ¿Se puede guardar? Devuelve el primer problema para decirlo en pantalla. */
  function validate(f){
    f=f||{};
    if(!String(f.name||'').trim())return {ok:false,field:'name',message:'Escribe el nombre de quien firma.'};
    if(['patient','guardian'].indexOf(f.relation)<0)return {ok:false,field:'relation',message:'Indica quién firma: el paciente o su tutor.'};
    if(f.read===false)return {ok:false,field:'read',message:'Desliza el aviso hasta el final para poder aceptarlo.'};
    if(!f.checked)return {ok:false,field:'checked',message:'Marca que leyó el aviso y da su consentimiento.'};
    if(!f.ink||!f.ink.ok)return {ok:false,field:'signature',message:'Falta la firma: dibújala con el dedo.'};
    return {ok:true};
  }

  /* Argumentos de smyl_record_patient_consent. */
  function payload(o){
    var n=render(o.clinicName);
    return {p_patient_id:o.patientId,p_notice_version:n.version,p_notice_text:n.text,p_provisional:n.provisional,p_signer_name:String(o.name||'').trim(),p_signer_relation:o.relation,p_signature_png:o.signaturePng};
  }

  function statusText(status,fmtDate){
    if(!status||!status.signed)return '';
    var when=status.signed_at?(fmtDate?fmtDate(status.signed_at):String(status.signed_at)):'';
    return 'Firmado'+(when?' el '+when:'')+(status.signer_name?' por '+status.signer_name:'')+(status.signer_relation==='guardian'?' (tutor)':'')+'.'+(status.provisional?' Con el texto modelo provisional.':'');
  }
  return {NOTICE:NOTICE,render:render,paragraphs:paragraphs,inkOf:inkOf,validate:validate,payload:payload,statusText:statusText,MIN_POINTS:MIN_POINTS,MIN_LENGTH:MIN_LENGTH};
});
