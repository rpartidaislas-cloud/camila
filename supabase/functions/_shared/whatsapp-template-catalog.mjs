// ARCHIVO GENERADO por scripts/sync-template-catalog.mjs a partir de smyl-template-catalog.js: no lo edites.
const catalog = (function () {
  'use strict';

  var LANGUAGE = { code: 'es_MX', label: 'Español (México)' };
  var OPT_OUT_FOOTER = 'Responde BAJA para no recibir más mensajes';

  var GROUPS = [
    { id: 'citas', label: 'Citas y recordatorios' },
    { id: 'tratamiento', label: 'Seguimiento del tratamiento' },
    { id: 'pagos', label: 'Pagos y cotizaciones' },
    { id: 'datos', label: 'Datos y documentos' },
    { id: 'marketing', label: 'Reactivación y promociones' }
  ];

  // Qué dato de SMYL va en cada variable (coincide con las fuentes del recordatorio automático).
  var V = {
    nombre: { label: 'Nombre del paciente', source: 'patient_first_name', example: 'Ana' },
    clinica: { label: 'Nombre de la clínica', source: 'clinic', example: 'Clínica Dental Sonríe' },
    fecha: { label: 'Fecha de la cita', source: 'date', example: 'martes 21 de octubre' },
    hora: { label: 'Hora de la cita', source: 'time', example: '10:30 a.m.' },
    servicio: { label: 'Servicio', source: 'service', example: 'valoración dental' },
    sucursal: { label: 'Sucursal', source: 'branch', example: 'Sucursal Centro' },
    telefono: { label: 'Teléfono de la sucursal', source: 'branch_phone', example: '55 1234 5678' }
  };
  function text(label, example) { return { label: label, source: 'text', example: example }; }
  function pick() { return Array.prototype.slice.call(arguments).map(function (key) { return V[key]; }); }
  function quick() { return Array.prototype.slice.call(arguments).map(function (label) { return { type: 'QUICK_REPLY', text: label }; }); }

  function utility(id, group, title, when, body, variables, extra) {
    return Object.assign({ id: id, group: group, category: 'UTILITY', title: title, when: when, header: '', body: body, footer: '', buttons: [], variables: variables, note: '' }, extra || {});
  }
  function marketing(id, title, when, body, variables, extra) {
    return Object.assign({ id: id, group: 'marketing', category: 'MARKETING', title: title, when: when, header: '', body: body, footer: OPT_OUT_FOOTER, buttons: [], variables: variables, note: '' }, extra || {});
  }

  var TEMPLATES = [
    // ── Utilidad · Citas y recordatorios ─────────────────────────────────
    utility('recordatorio_cita_24h_v1', 'citas', 'Recordatorio de cita (24 horas antes)',
      'Es la que usa el recordatorio automático de la Agenda. Solicítala primero.',
      'Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}} en {{4}}. Responde a este mensaje si necesitas cambiarla.',
      pick('nombre', 'fecha', 'hora', 'clinica'), { automatic: true }),
    utility('recordatorio_cita_confirmar_v1', 'citas', 'Recordatorio con botones para confirmar',
      'Igual que el recordatorio de 24 horas, pero el paciente responde con un toque.',
      'Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}} en {{4}}. Elige una opción para que podamos organizar la agenda.',
      pick('nombre', 'fecha', 'hora', 'clinica'), { buttons: quick('Confirmo mi asistencia', 'Necesito reprogramar') }),
    utility('recordatorio_cita_mismo_dia_v1', 'citas', 'Recordatorio el mismo día',
      'Unas horas antes de la cita.',
      'Hola {{1}}, hoy tienes cita a las {{2}} en {{3}}. Te esperamos; si vas a llegar tarde o no puedes asistir, avísanos respondiendo a este mensaje.',
      pick('nombre', 'hora', 'clinica')),
    utility('cita_confirmada_v1', 'citas', 'Confirmación de cita',
      'Justo después de agendar la cita.',
      'Hola {{1}}, tu cita en {{2}} quedó confirmada para el {{3}} a las {{4}}. Si necesitas cambiarla, responde a este mensaje con anticipación.',
      pick('nombre', 'clinica', 'fecha', 'hora')),
    utility('cita_solicitud_recibida_v1', 'citas', 'Solicitud de cita recibida',
      'Cuando el paciente pide una cita y el equipo aún debe confirmarla.',
      'Hola {{1}}, recibimos tu solicitud de cita para {{2}}. Nuestro equipo la revisará y te confirmará el horario por este medio en breve.',
      pick('nombre', 'servicio')),
    utility('cita_opciones_horario_v1', 'citas', 'Opciones de horario',
      'Para proponer horarios disponibles desde Mensajes.',
      'Hola {{1}}, tenemos disponibles estos horarios para tu cita en {{2}}: {{3}}. Responde con la opción que prefieras y la reservamos.',
      [V.nombre, V.clinica, text('Horarios propuestos', 'martes 21 a las 10:00, miércoles 22 a las 16:30 o jueves 23 a las 12:00')]),
    utility('cita_reprogramada_v1', 'citas', 'Cita reprogramada',
      'Cuando mueves la cita a otro día u hora.',
      'Hola {{1}}, tu cita en {{2}} se reprogramó para el {{3}} a las {{4}}. Si ese horario no te funciona, responde a este mensaje y buscamos otro.',
      pick('nombre', 'clinica', 'fecha', 'hora')),
    utility('cita_cancelada_clinica_v1', 'citas', 'Cita cancelada por la clínica',
      'Cuando la clínica debe cancelar y ofrecer una nueva fecha.',
      'Hola {{1}}, lamentamos informarte que tuvimos que cancelar tu cita del {{2}} en {{3}}. Responde a este mensaje y te ayudamos a elegir un nuevo horario.',
      pick('nombre', 'fecha', 'clinica')),
    utility('cita_retraso_v1', 'citas', 'Aviso de retraso en la agenda',
      'Cuando el consultorio lleva retraso el mismo día.',
      'Hola {{1}}, hoy llevamos unos minutos de retraso en la agenda de {{2}}. Tu cita de las {{3}} podría comenzar un poco más tarde. Gracias por tu comprensión.',
      pick('nombre', 'clinica', 'hora')),
    utility('cita_indicaciones_previas_v1', 'citas', 'Indicaciones antes de tu cita',
      'Uno o dos días antes, para que el paciente llegue preparado.',
      'Hola {{1}}, para tu cita del {{2}} en {{3}}, te pedimos llegar 10 minutos antes y traer una identificación y, si los tienes, tus estudios o radiografías recientes.',
      pick('nombre', 'fecha', 'clinica')),
    utility('cita_como_llegar_v1', 'citas', 'Cómo llegar a la clínica',
      'Cuando el paciente pregunta la ubicación.',
      'Hola {{1}}, te compartimos los datos para llegar a tu cita en {{2}}: {{3}}. Si tienes dudas para llegar, llámanos al {{4}}.',
      [V.nombre, V.sucursal, text('Dirección', 'Av. Reforma 123, colonia Centro, a una cuadra del metro'), V.telefono]),
    utility('cita_lista_espera_v1', 'citas', 'Se liberó un horario',
      'Para pacientes que pidieron que los avisaras si se liberaba un espacio.',
      'Hola {{1}}, se liberó un horario en {{2}} para el {{3}} a las {{4}}. Si te interesa, responde a este mensaje en las próximas horas para reservarlo.',
      pick('nombre', 'clinica', 'fecha', 'hora')),
    utility('cita_no_asistio_v1', 'citas', 'No pudimos verte en tu cita',
      'Después de una inasistencia, para ofrecer reagendar.',
      'Hola {{1}}, notamos que no pudiste asistir a tu cita del {{2}} en {{3}}. Si deseas reagendarla, responde a este mensaje y con gusto te ayudamos.',
      pick('nombre', 'fecha', 'clinica')),

    // ── Utilidad · Seguimiento del tratamiento ───────────────────────────
    utility('seguimiento_postcita_v1', 'tratamiento', 'Seguimiento después de tu cita',
      'Al día siguiente de un procedimiento.',
      'Hola {{1}}, gracias por visitarnos en {{2}}. ¿Cómo te has sentido después de tu cita? Si tienes dudas o molestias, responde a este mensaje y te atiende nuestro equipo.',
      pick('nombre', 'clinica')),
    utility('indicaciones_postratamiento_v1', 'tratamiento', 'Indicaciones posteriores al tratamiento',
      'Con las indicaciones acordadas en la cita. Mantén el texto breve y sin datos clínicos.',
      'Hola {{1}}, estas son las indicaciones que acordamos para después de tu cita del {{2}}: {{3}}. Si algo no queda claro, responde a este mensaje.',
      [V.nombre, V.fecha, text('Indicaciones (una frase)', 'evita alimentos duros durante las próximas 24 horas')],
      { note: 'No incluyas diagnósticos ni datos clínicos en la variable de indicaciones.' }),
    utility('proxima_cita_tratamiento_v1', 'tratamiento', 'Próxima cita de tu tratamiento',
      'Cuando toca agendar la siguiente etapa de un tratamiento.',
      'Hola {{1}}, ya puedes agendar la siguiente cita de tu tratamiento en {{2}}. Responde a este mensaje y te proponemos horarios disponibles.',
      pick('nombre', 'clinica')),
    utility('control_ortodoncia_v1', 'tratamiento', 'Cita de control de ortodoncia',
      'Para ajustes periódicos de ortodoncia.',
      'Hola {{1}}, corresponde tu cita de control de ortodoncia en {{2}}. Responde a este mensaje para elegir el día y la hora que mejor te acomode.',
      pick('nombre', 'clinica')),
    utility('estudios_listos_v1', 'tratamiento', 'Estudios o radiografías listos',
      'Cuando los estudios ya se pueden recoger o enviar.',
      'Hola {{1}}, tus estudios solicitados en {{2}} ya están disponibles. Pasa por ellos en horario de atención o responde a este mensaje para coordinar la entrega.',
      pick('nombre', 'clinica')),
    utility('plan_tratamiento_listo_v1', 'tratamiento', 'Tu plan de tratamiento está listo',
      'Después de la valoración, para agendar la explicación del plan.',
      'Hola {{1}}, ya preparamos el plan de tratamiento que revisamos en tu valoración en {{2}}. Responde a este mensaje para agendar una cita y explicártelo con calma.',
      pick('nombre', 'clinica')),

    // ── Utilidad · Pagos y cotizaciones ──────────────────────────────────
    utility('cotizacion_lista_v1', 'pagos', 'Cotización lista',
      'Cuando generas la cotización en Tratamientos.',
      'Hola {{1}}, tu cotización {{2}} de {{3}} ya está lista. Responde a este mensaje si quieres revisarla con nuestro equipo o resolver tus dudas.',
      [V.nombre, text('Folio de la cotización', 'COT-1042'), V.clinica]),
    utility('cotizacion_seguimiento_v1', 'pagos', 'Seguimiento a tu cotización',
      'Unos días después de enviar la cotización.',
      'Hola {{1}}, ¿pudiste revisar la cotización {{2}} que te enviamos desde {{3}}? Responde a este mensaje y resolvemos cualquier duda que tengas.',
      [V.nombre, text('Folio de la cotización', 'COT-1042'), V.clinica],
      { note: 'Meta puede reclasificarla como Marketing por invitar a decidir una compra; si pasa, úsala solo en la ventana de 24 horas.' }),
    utility('pago_recibido_v1', 'pagos', 'Pago recibido',
      'Al registrar un cobro en Caja.',
      'Hola {{1}}, recibimos tu pago de {{2}} en {{3}}. Gracias; si necesitas tu comprobante, responde a este mensaje.',
      [V.nombre, text('Monto', '$1,500.00'), V.clinica]),
    utility('pago_pendiente_v1', 'pagos', 'Recordatorio de pago pendiente',
      'Cuando hay un saldo por pagar.',
      'Hola {{1}}, tienes un pago pendiente de {{2}} en {{3}} con vencimiento el {{4}}. Si ya lo realizaste, responde a este mensaje para que lo verifiquemos.',
      [V.nombre, text('Monto', '$1,500.00'), V.clinica, text('Fecha de vencimiento', '25 de octubre')]),
    utility('plan_pagos_proximo_v1', 'pagos', 'Próximo pago de tu plan',
      'Para pacientes con pagos parciales de un tratamiento.',
      'Hola {{1}}, tu próximo pago de {{2}} del plan de tratamiento en {{3}} vence el {{4}}. Responde a este mensaje si necesitas ayuda o quieres ajustar la fecha.',
      [V.nombre, text('Monto', '$1,500.00'), V.clinica, text('Fecha de vencimiento', '25 de octubre')]),
    utility('factura_disponible_v1', 'pagos', 'Factura disponible',
      'Cuando se genera el CFDI.',
      'Hola {{1}}, tu factura {{2}} de {{3}} ya fue generada. Responde a este mensaje con el correo donde quieres recibirla y te la enviamos.',
      [V.nombre, text('Folio de la factura', 'A-2381'), V.clinica]),

    // ── Utilidad · Datos y documentos ────────────────────────────────────
    utility('documento_por_firmar_v1', 'datos', 'Documento pendiente de firma',
      'Consentimientos o formatos que se firman en la clínica.',
      'Hola {{1}}, tienes un documento pendiente de revisión y firma para tu atención en {{2}}. Puedes completarlo al llegar a tu cita del {{3}}.',
      pick('nombre', 'clinica', 'fecha')),
    utility('actualizar_datos_v1', 'datos', 'Actualiza tus datos de contacto',
      'Para mantener al día teléfono y correo del expediente.',
      'Hola {{1}}, para mantener tu expediente al día en {{2}}, ¿puedes confirmarnos si tu teléfono y tu correo siguen siendo los mismos? Responde a este mensaje.',
      pick('nombre', 'clinica')),

    // ── Marketing · Reactivación y promociones (requieren opt-in del paciente) ──
    marketing('limpieza_semestral_v1', 'Recordatorio de limpieza (cada 6 meses)',
      'A pacientes con la última limpieza hace unos seis meses.',
      'Hola {{1}}, ya pasaron unos meses desde tu última limpieza dental en {{2}}. Una revisión periódica ayuda a cuidar tu sonrisa. ¿Quieres que te propongamos horarios?',
      pick('nombre', 'clinica'), { buttons: quick('Sí, quiero agendar', 'Ahora no') }),
    marketing('reactivacion_paciente_v1', 'Te extrañamos',
      'A pacientes que llevan mucho tiempo sin venir.',
      'Hola {{1}}, hace tiempo que no te vemos en {{2}} y nos gustaría saber cómo estás. Si quieres retomar tu revisión o tu tratamiento, responde a este mensaje y te ayudamos a agendar.',
      pick('nombre', 'clinica')),
    marketing('valoracion_sin_costo_v1', 'Valoración sin costo',
      'Campañas de captación de nuevos pacientes.',
      'Hola {{1}}, en {{2}} tenemos valoraciones dentales sin costo durante {{3}}. Cupo limitado; responde a este mensaje para reservar tu lugar.',
      [V.nombre, V.clinica, text('Periodo', 'el mes de noviembre')]),
    marketing('promo_blanqueamiento_v1', 'Promoción de blanqueamiento',
      'Promociones de temporada.',
      'Hola {{1}}, este mes tenemos una promoción en blanqueamiento dental en {{2}}: {{3}}. Responde a este mensaje para conocer los detalles y reservar.',
      [V.nombre, V.clinica, text('Promoción', '10% de descuento hasta el 30 de noviembre')]),
    marketing('info_ortodoncia_v1', 'Información de ortodoncia',
      'Para pacientes que preguntaron por alinear sus dientes.',
      'Hola {{1}}, si te interesa alinear tus dientes, en {{2}} podemos explicarte las opciones de ortodoncia disponibles y resolver tus dudas. ¿Te gustaría agendar una valoración?',
      pick('nombre', 'clinica'), { buttons: quick('Quiero una valoración', 'Ahora no') }),
    marketing('revision_infantil_v1', 'Revisión dental infantil',
      'Antes del regreso a clases o vacaciones.',
      'Hola {{1}}, antes de {{2}} es un buen momento para una revisión dental de tus hijos en {{3}}. Responde a este mensaje y te proponemos horarios.',
      [V.nombre, text('Temporada', 'el regreso a clases'), V.clinica]),
    marketing('nuevo_servicio_v1', 'Nuevo servicio en la clínica',
      'Cuando incorporas un tratamiento o tecnología.',
      'Hola {{1}}, en {{2}} ahora ofrecemos {{3}}. Si quieres saber si es adecuado para ti, responde a este mensaje y agendamos una valoración.',
      [V.nombre, V.clinica, text('Servicio nuevo', 'limpieza dental con ultrasonido')]),
    marketing('programa_referidos_v1', 'Programa de referidos',
      'Para invitar a pacientes a recomendar la clínica.',
      'Hola {{1}}, gracias por confiar en {{2}}. Si recomiendas nuestro consultorio a un familiar o amigo, tenemos un beneficio para ti: {{3}}. Responde a este mensaje para conocerlo.',
      [V.nombre, V.clinica, text('Beneficio', 'una limpieza dental de cortesía')]),
    marketing('solicitud_resena_v1', 'Solicitud de reseña',
      'Después de una buena experiencia. Agrega en LANA un botón con la liga a tu perfil de Google.',
      'Hola {{1}}, gracias por tu visita a {{2}}. Tu opinión nos ayuda a mejorar y a que más personas nos encuentren. ¿Nos regalas un minuto para contarnos tu experiencia?',
      pick('nombre', 'clinica'), { buttons: quick('Con gusto', 'Ahora no') }),
    marketing('revision_fin_de_anio_v1', 'Revisión de fin de año',
      'Noviembre y diciembre, antes de que venzan los beneficios de seguros.',
      'Hola {{1}}, antes de que termine el año puedes aprovechar tus beneficios dentales en {{2}}. Responde a este mensaje y te ayudamos a agendar tu revisión a tiempo.',
      pick('nombre', 'clinica')),
    marketing('felicitacion_cumpleanos_v1', 'Felicitación de cumpleaños',
      'El día del cumpleaños del paciente.',
      'Hola {{1}}, todo el equipo de {{2}} te desea un feliz cumpleaños. Gracias por confiarnos el cuidado de tu sonrisa.',
      pick('nombre', 'clinica'))
  ];

  // Reglas de Meta que el catálogo respeta; se muestran en la pantalla y se verifican en las pruebas.
  var RULES = [
    { title: 'Categoría', text: 'Utilidad es para mensajes que el paciente espera por algo que ya hizo (citas, pagos, seguimiento). Cualquier promoción, descuento o invitación a comprar es Marketing; si lo disfrazas de Utilidad, Meta la rechaza o la reclasifica. SMYL solo envía plantillas de Utilidad fuera de la ventana de 24 horas.' },
    { title: 'Variables', text: 'Se escriben {{1}}, {{2}}… en orden y todas se usan. No pueden estar al inicio ni al final del texto, ni pegadas una con otra. Cada una necesita un ejemplo real al solicitarla y no puede contener saltos de línea.' },
    { title: 'Tamaño', text: 'Cuerpo de hasta 1,024 caracteres; encabezado y pie de hasta 60. Cada botón de respuesta rápida, hasta 25 caracteres. Mantén suficiente texto por variable.' },
    { title: 'Opt-in y baja', text: 'Para Marketing el paciente debe haber aceptado recibir mensajes. Incluye siempre una forma de darse de baja (por eso el pie «Responde BAJA…»).' },
    { title: 'Contenido permitido', text: 'Sin ligas acortadas, sin datos sensibles (diagnósticos, enfermedades, datos financieros completos), sin promesas de resultados ni amenazas. Usa lenguaje claro y neutro.' },
    { title: 'Nombre e idioma', text: 'El nombre va en minúsculas con guiones bajos (ej. recordatorio_cita_24h_v1) y el idioma es Español (México), es_MX. Cada cambio de texto requiere una plantilla nueva, por eso terminan en _v1.' },
    { title: 'Aprobación', text: 'Meta suele responder entre unos minutos y 48 horas. Si rechaza una plantilla, ajusta el texto según el motivo y envíala como _v2.' }
  ];

  var PROMO_WORDS = /descuento|promoci[oó]n|\bpromo\b|oferta|gratis|gratuit|cup[oó]n|2x1|\bregalo\b|ahorra|aprovecha|%/i;
  var SENSITIVE_WORDS = /diagn[oó]stic|enfermedad|\bvih\b|c[aá]ncer|embarazo|infecci[oó]n|\btarjeta\b|\bcvv\b/i;

  function variableNumbers(value) {
    var numbers = [];
    String(value || '').replace(/\{\{\s*(\d+)\s*\}\}/g, function (match, number) { numbers.push(Number(number)); return match; });
    return numbers;
  }

  // Sustituye {{n}} por el ejemplo; con wrap rodea el valor para resaltarlo.
  function fill(value, variables, wrap) {
    return String(value || '').replace(/\{\{\s*(\d+)\s*\}\}/g, function (match, number) {
      var variable = variables[Number(number) - 1];
      if (!variable) return match;
      return wrap ? wrap(variable.example) : variable.example;
    });
  }

  function validate(template) {
    var issues = [];
    var body = template.body || '';
    if (!/^[a-z0-9_]{1,60}$/.test(template.id || '')) issues.push('El nombre debe ir en minúsculas, números y guiones bajos.');
    if (body.length < 1 || body.length > 1024) issues.push('El cuerpo debe tener entre 1 y 1,024 caracteres.');
    if ((template.header || '').length > 60) issues.push('El encabezado supera 60 caracteres.');
    if ((template.footer || '').length > 60) issues.push('El pie supera 60 caracteres.');
    var numbers = variableNumbers(body);
    var unique = Array.from(new Set(numbers)).sort(function (a, b) { return a - b; });
    unique.forEach(function (number, index) { if (number !== index + 1) issues.push('Las variables deben numerarse en orden desde {{1}}.'); });
    if (numbers.length !== unique.length) issues.push('Una variable se repite.');
    if (unique.length !== (template.variables || []).length) issues.push('Falta o sobra un ejemplo de variable.');
    if (/^\s*\{\{/.test(body) || /\}\}\s*$/.test(body)) issues.push('El cuerpo no puede empezar ni terminar con una variable.');
    if (/\}\}\s{0,3}\{\{/.test(body)) issues.push('Dos variables no pueden ir juntas.');
    var wordsOutsideVariables = body.replace(/\{\{\s*\d+\s*\}\}/g, ' ').split(/\s+/).filter(Boolean).length;
    if (wordsOutsideVariables < unique.length * 4) issues.push('Hay demasiadas variables para la longitud del texto.');
    (template.variables || []).forEach(function (variable) {
      if (!variable.example || /[\n\t]| {4,}/.test(variable.example)) issues.push('El ejemplo de «' + variable.label + '» no es válido.');
    });
    if (/\{\{/.test(template.footer || '')) issues.push('El pie no puede tener variables.');
    var buttons = template.buttons || [];
    if (buttons.length > 3) issues.push('Máximo tres botones.');
    buttons.forEach(function (button) { if (button.type !== 'QUICK_REPLY' || !button.text || button.text.length > 25) issues.push('El botón «' + button.text + '» no es válido (máximo 25 caracteres).'); });
    if (template.category !== 'UTILITY' && template.category !== 'MARKETING') issues.push('La categoría debe ser Utilidad o Marketing.');
    if (template.category === 'UTILITY') {
      if (PROMO_WORDS.test([template.header, body, template.footer].join(' '))) issues.push('Una plantilla de Utilidad no puede tener lenguaje promocional.');
      if (/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(body)) issues.push('Una plantilla de Utilidad no debe llevar emojis.');
    }
    if (template.category === 'MARKETING' && !/\bBAJA\b/.test(template.footer || '') && !buttons.some(function (button) { return /no recibir|baja/i.test(button.text); })) issues.push('Marketing necesita una forma de darse de baja.');
    if (SENSITIVE_WORDS.test([template.header, body, template.footer].join(' '))) issues.push('Evita datos sensibles de salud o financieros.');
    if (/https?:\/\/|bit\.ly|tinyurl|wa\.me/i.test([template.header, body, template.footer].join(' '))) issues.push('No uses ligas en el texto.');
    return issues;
  }

  // Texto listo para pegar en el formulario de nueva plantilla de LANA.
  function formatForLana(template) {
    var lines = [
      'Nombre: ' + template.id,
      'Categoría: ' + (template.category === 'UTILITY' ? 'Utilidad (Utility)' : 'Marketing'),
      'Idioma: ' + LANGUAGE.label + ' (' + LANGUAGE.code + ')'
    ];
    if (template.header) lines.push('Encabezado: ' + template.header);
    lines.push('Cuerpo:', template.body);
    if (template.footer) lines.push('Pie de página: ' + template.footer);
    if (template.buttons.length) lines.push('Botones de respuesta rápida: ' + template.buttons.map(function (button) { return button.text; }).join(' | '));
    if (template.variables.length) lines.push('Ejemplos de variables: ' + template.variables.map(function (variable, index) { return '{{' + (index + 1) + '}} = ' + variable.example; }).join(' | '));
    return lines.join('\n');
  }

  return { LANGUAGE: LANGUAGE, GROUPS: GROUPS, TEMPLATES: TEMPLATES, RULES: RULES, OPT_OUT_FOOTER: OPT_OUT_FOOTER, validate: validate, fill: fill, formatForLana: formatForLana };
})();

export const LANGUAGE = catalog.LANGUAGE;
export const GROUPS = catalog.GROUPS;
export const TEMPLATES = catalog.TEMPLATES;
export const RULES = catalog.RULES;
export const OPT_OUT_FOOTER = catalog.OPT_OUT_FOOTER;
export const validate = catalog.validate;
export const fill = catalog.fill;
export const formatForLana = catalog.formatForLana;
