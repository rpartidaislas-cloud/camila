/* SMYL · Aviso de privacidad y firma en pantalla: reglas puras (sin DOM ni red).
 *
 * Aviso de privacidad INTEGRAL modelo para clínicas (LFPDPPP publicada en el DOF el 20 de marzo de 2025): identifica al
 * responsable con su domicilio y contacto, los datos (incluidos los sensibles de salud), las finalidades primarias y
 * secundarias, encargados y transferencias (también internacionales), derechos ARCO con plazos, revocación, limitación de
 * uso, cambios y autoridad. {CLINICA}, {DOMICILIO} y {CORREO} se llenan con los datos de cada clínica. Es un modelo:
 * conviene que el asesor legal de la clínica lo revise. Cada firma guarda el texto exacto, su versión y su huella; las
 * firmas anteriores conservan su texto. Para un aviso propio: reemplazar NOTICE (texto y `version`). */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylPrivacyNotice=api;})(globalThis,function(){
  'use strict';
  var NOTICE={
    version:'smyl-integral-2026-11-v3',
    provisional:false,
    title:'Aviso de privacidad integral',
    paragraphs:[
      'Responsable. {CLINICA}, con domicilio en {DOMICILIO}, es responsable del tratamiento de sus datos personales. Para cualquier asunto de privacidad puede escribir a {CORREO} o acudir a la recepción de la clínica.',
      'Datos que tratamos. Datos de identificación y contacto (nombre, fecha de nacimiento, sexo, domicilio, CURP, teléfono y correo), datos de facturación si los solicita y datos personales sensibles de salud: historia clínica, antecedentes, alergias, medicamentos, odontograma, fotografías y radiografías dentales, notas clínicas, recetas y consentimientos.',
      'Finalidades necesarias. Integrar y conservar su expediente clínico (por lo menos 5 años, conforme a la NOM-004-SSA3-2012), brindarle atención odontológica, elaborar presupuestos y recetas, agendar, confirmar y recordarle sus citas, cobrar y facturar, y cumplir obligaciones legales.',
      'Finalidades adicionales, que puede rechazar sin que se le niegue la atención: (a) usar herramientas de inteligencia artificial de proveedores externos para apoyar el análisis o la simulación de sus fotografías; (b) enviarle por WhatsApp avisos que no sean de sus citas; (c) enviarle promociones o información de la clínica. Puede aceptarlas o rechazarlas al firmar este aviso y cambiar su decisión en cualquier momento escribiendo a {CORREO}.',
      'Encargados y transferencias. La clínica usa la plataforma SMYL y sus proveedores, que tratan sus datos solo por cuenta y siguiendo instrucciones de la clínica, bajo contrato y medidas de seguridad: alojamiento de datos (Supabase sobre Amazon Web Services), mensajería (Meta, WhatsApp), pagos (Stripe u Openpay), facturación (Facturapi) y, solo si usted lo autoriza, inteligencia artificial (OpenAI, Anthropic y Google). Algunos de ellos están fuera de México, principalmente en los Estados Unidos. No vendemos sus datos ni los transferimos a terceros para sus propios fines, salvo en los casos que la ley permite sin su consentimiento, por ejemplo cuando lo requiera una autoridad de salud o judicial.',
      'Derechos ARCO y revocación. Usted puede acceder a sus datos, rectificarlos, cancelarlos u oponerse a su tratamiento, y revocar su consentimiento, con una solicitud a {CORREO} o en la recepción que indique su nombre, un medio para responderle, una identificación (o la de su representante) y una descripción clara de lo que pide. Le responderemos en un máximo de 20 días hábiles y, si procede, lo haremos efectivo dentro de los 15 días hábiles siguientes. La cancelación del expediente clínico queda sujeta al plazo de conservación que exige la ley.',
      'Limitar el uso. Puede pedir por los mismos medios que limitemos el uso o la divulgación de sus datos, por ejemplo que no le enviemos promociones.',
      'Cambios. Si este aviso cambia, se lo informaremos en la recepción y por el medio de contacto que nos dio; si cambian las finalidades, le pediremos firmar de nuevo.',
      'Este aviso se emite conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares. Si considera que su derecho a la protección de datos fue vulnerado, puede acudir a la autoridad de protección de datos personales competente.',
      'Al firmar, usted confirma que leyó este aviso y otorga su consentimiento expreso y por escrito para el tratamiento de sus datos personales y sensibles para las finalidades necesarias descritas.'
    ]
  };
  var MIN_POINTS=12,MIN_LENGTH=60;   // una firma real tiene trazo: unos cuantos puntos o un toque suelto no cuentan

  /* El texto que se muestra y se guarda: con el nombre de la clínica puesto. */
  /* ctx opcional: {address, email}. Sin domicilio o correo se indica cómo obtenerlos (y se marca como pendiente). */
  function render(clinicName,ctx){
    ctx=ctx||{};
    var name=String(clinicName==null?'':clinicName).trim()||'la clínica';
    var address=String(ctx.address||'').trim()||'el domicilio de la clínica que se le muestra en recepción';
    var email=String(ctx.email||'').trim()||'el correo de contacto de la clínica';
    var text=NOTICE.paragraphs.join('\n\n').split('{CLINICA}').join(name).split('{DOMICILIO}').join(address).split('{CORREO}').join(email);
    return {version:NOTICE.version,provisional:NOTICE.provisional||!String(ctx.address||'').trim()||!String(ctx.email||'').trim(),title:NOTICE.title,text:text};
  }
  function paragraphs(clinicName,ctx){return render(clinicName,ctx).text.split('\n\n');}

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
    var n=render(o.clinicName,o.context);
    return {p_patient_id:o.patientId,p_notice_version:n.version,p_notice_text:n.text,p_provisional:n.provisional,p_signer_name:String(o.name||'').trim(),p_signer_relation:o.relation,p_signature_png:o.signaturePng};
  }

  function statusText(status,fmtDate){
    if(!status||!status.signed)return '';
    var when=status.signed_at?(fmtDate?fmtDate(status.signed_at):String(status.signed_at)):'';
    return 'Firmado'+(when?' el '+when:'')+(status.signer_name?' por '+status.signer_name:'')+(status.signer_relation==='guardian'?' (tutor)':'')+'.'+(status.provisional?' Con el texto modelo provisional.':'');
  }
  return {NOTICE:NOTICE,render:render,paragraphs:paragraphs,inkOf:inkOf,validate:validate,payload:payload,statusText:statusText,MIN_POINTS:MIN_POINTS,MIN_LENGTH:MIN_LENGTH};
});
