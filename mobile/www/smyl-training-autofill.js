/* SMYL · Autollenado de «Capacitar IA» con los datos que la clínica YA tiene. Lógica pura (sin red ni DOM): compose(ctx) devuelve el
   texto propuesto por campo y las preguntas frecuentes derivadas. Solo usa datos reales de la clínica; lo que no tiene fuente (promociones,
   seguros, tiempos de respuesta) NO se inventa: se deja vacío. Los textos de política sin dato son neutros ("sugerido": se revisan y se editan)
   y nunca afirman algo que la clínica no haya configurado. Cada texto respeta el maxlength del campo. */
(function (root) {
  'use strict';
  var MAX = {
    assistant_name: 50, welcome_message: 350, clinic_description: 1600, specialties: 1200, languages: 300, contact_channels: 700, access_info: 900,
    minor_policy: 900, scheduling_rules: 1600, attention_objective: 900, appointment_policy: 1200, cancellation_policy: 1200, pricing_policy: 1200,
    payment_policy: 1200, invoice_policy: 1200, followup_policy: 1200, intake_questions: 1600, emergency_policy: 1200, handoff_rules: 1600,
    allowed_memory: 1200, prohibited_memory: 1200, faq_question: 280, faq_answer: 900
  };

  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function clip(text, max) {
    var t = clean(text);
    if (t.length <= max) return t;
    var cut = t.slice(0, max - 1), sp = cut.lastIndexOf(' ');
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '') + '…';
  }
  function uniq(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (x) { var t = clean(x), k = t.toLocaleLowerCase('es-MX'); if (t && !seen[k]) { seen[k] = 1; out.push(t); } });
    return out;
  }
  function money(n) { var v = Number(n); return Number.isFinite(v) ? '$' + v.toLocaleString('es-MX', { maximumFractionDigits: 2 }) : ''; }
  function list(items) { var a = items.slice(); if (a.length <= 1) return a.join(''); return a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]; }

  function compose(ctx) {
    ctx = ctx || {};
    var fields = {}, faq = [];
    function put(name, text, kind, source) {
      var t = clip(text, MAX[name] || 1200);
      if (t) fields[name] = { text: t, kind: kind, source: source };
    }
    var tenant = ctx.tenant || {}, cfg = tenant.config && typeof tenant.config === 'object' ? tenant.config : {};
    var clinica = clean(cfg.consultorio || tenant.nombre || '');
    var ciudad = clean(cfg.ciudad || '');
    var objetos = function (v) { return (Array.isArray(v) ? v : []).filter(function (x) { return x && typeof x === 'object'; }); };
    var branches = objetos(ctx.branches);
    var services = objetos(ctx.services).filter(function (s) { return clean(s.name); });
    var pros = objetos(ctx.professionals);
    var profiles = objetos(ctx.profiles);
    var channels = objetos(ctx.channels).filter(function (c) { return c.connected; });
    var sched = ctx.scheduling && typeof ctx.scheduling === 'object' ? ctx.scheduling : null;
    var conPrecio = services.filter(function (s) { return Number(s.reference_price) > 0; });
    var especialidades = uniq([].concat(
      services.map(function (s) { return s.specialty; }), pros.map(function (p) { return p.specialty; }),
      [].concat.apply([], profiles.map(function (p) { return Array.isArray(p.treatment_focus) ? p.treatment_focus : []; })), [cfg.especialidad]
    ));

    // ── Identidad ──
    if (clinica) {
      put('assistant_name', 'Asistente de ' + clinica, 'dato', 'Nombre de tu clínica');
      put('welcome_message', 'Hola, soy el asistente de ' + clinica + '. Puedo orientarte con información de la clínica. ¿En qué te puedo ayudar?', 'dato', 'Nombre de tu clínica');
    }

    // ── Tu clínica ──
    if (clinica) {
      var partes = [clinica + ' es una clínica dental' + (ciudad ? ' en ' + ciudad : '') + (especialidades.length ? ', con enfoque en ' + list(especialidades.slice(0, 4)).toLocaleLowerCase('es-MX') : '') + '.'];
      if (branches.length > 1) partes.push('Atiende en ' + branches.length + ' sucursales.');
      if (services.length) partes.push('Ofrece servicios como ' + list(uniq(services.map(function (s) { return s.patient_name || s.name; })).slice(0, 5)) + '.');
      if (pros.length > 1) partes.push('Cuenta con un equipo de ' + pros.length + ' profesionales.');
      put('clinic_description', partes.join(' '), 'dato', 'Mi clínica, equipo y Servicios y tarifas');
    }
    if (especialidades.length) put('specialties', especialidades.join(', '), 'dato', 'Servicios y equipo');
    var idiomas = uniq([].concat.apply([], profiles.map(function (p) { return Array.isArray(p.languages) ? p.languages : []; })));
    if (idiomas.length) put('languages', idiomas.join(', '), 'dato', 'Perfiles del equipo');

    var contacto = [];
    var wa = uniq([].concat(channels.filter(function (c) { return c.channel === 'whatsapp'; }).map(function (c) { return c.display_phone_number; }),
      branches.map(function (b) { return b.whatsapp_phone; }), [ctx.reminders && ctx.reminders.whatsapp_phone]));
    if (wa.length) contacto.push('WhatsApp: ' + wa.join(', '));
    var tel = uniq(branches.map(function (b) { return b.phone; }).concat([cfg.tel]));
    if (tel.length) contacto.push('Teléfono: ' + tel.join(', '));
    ['messenger', 'instagram'].forEach(function (canal) {
      var c = channels.filter(function (x) { return x.channel === canal && clean(x.display_name); })[0];
      if (c) contacto.push((canal === 'messenger' ? 'Messenger: ' : 'Instagram: ') + clean(c.display_name));
    });
    if (clean(tenant.email)) contacto.push('Correo: ' + clean(tenant.email));
    if (contacto.length) put('contact_channels', contacto.join(' · '), 'dato', 'Mi clínica y canales conectados');

    var llegada = branches.filter(function (b) { return clean(b.arrival_notes); });
    if (llegada.length) put('access_info', llegada.length === 1 && branches.length === 1 ? clean(llegada[0].arrival_notes) : llegada.map(function (b) { return clean(b.name) + ': ' + clean(b.arrival_notes); }).join(' · '), 'dato', 'Indicaciones de llegada de tus sucursales');
    put('minor_policy', 'Para la atención de menores de edad, una persona del equipo confirma con la madre, el padre o el tutor los requisitos y la autorización.', 'sugerido', 'Texto neutral: revísalo');
    if (sched && Number.isFinite(Number(sched.min_lead_hours)) && Number.isFinite(Number(sched.horizon_days))) put('scheduling_rules', 'Las citas se solicitan con al menos ' + Number(sched.min_lead_hours) + ' horas de anticipación y hasta ' + Number(sched.horizon_days) + ' días hacia adelante.', 'dato', 'Agenda con IA');

    // ── Reglas de atención ──
    put('attention_objective', 'Orientar al paciente, resolver dudas administrativas y ayudarle a definir el siguiente paso con la clínica.', 'sugerido', 'Texto neutral: revísalo');
    var cita = sched && sched.level === 'request'
      ? 'El asistente puede ofrecer horarios disponibles de la agenda y dejar una solicitud de cita; la clínica la revisa y la confirma. Ninguna cita se confirma sola.'
      : sched && sched.level === 'suggest'
        ? 'El asistente puede sugerir horarios disponibles de la agenda; una persona del equipo confirma la cita.'
        : 'Las citas las confirma una persona del equipo; el asistente toma los datos de la solicitud y los pasa a la clínica.';
    put('appointment_policy', cita, sched && sched.level && sched.level !== 'off' ? 'dato' : 'sugerido', sched ? 'Agenda con IA' : 'Texto neutral: revísalo');
    var fee = Number(ctx.noShowFee);
    put('cancellation_policy', fee > 0
      ? 'Para cancelar o reprogramar, avisa a la clínica con anticipación. Si el paciente no asiste a una cita sin avisar, la clínica puede aplicar un cargo por inasistencia; la clínica informa el monto.'
      : 'Para cancelar o reprogramar, el paciente avisa a la clínica y una persona del equipo gestiona el cambio.', fee > 0 ? 'dato' : 'sugerido', fee > 0 ? 'Cobros: cargo por inasistencia' : 'Texto neutral: revísalo');
    put('pricing_policy', conPrecio.length
      ? 'Solo comparte los precios de referencia de la lista de servicios, siempre como «desde $X, sujeto a valoración». Nunca inventes, redondees ni calcules importes; el precio final lo confirma la clínica después de la valoración. Si un servicio no trae precio, di que se cotiza en consulta.'
      : 'No compartas precios: la clínica los informa en consulta.', conPrecio.length ? 'dato' : 'sugerido', conPrecio.length ? 'Servicios y tarifas' : 'Texto neutral: revísalo');
    var pagoLinea = !!cfg.pago_en_linea;
    put('payment_policy', pagoLinea
      ? 'La clínica ofrece pago en línea con un enlace que envía el equipo. Los cobros y anticipos los gestiona una persona; nunca pidas datos de tarjeta por el chat.'
      : 'Los pagos y anticipos se acuerdan con el equipo de la clínica; nunca pidas datos de tarjeta por el chat.', pagoLinea ? 'dato' : 'sugerido', pagoLinea ? 'Cobros: pago en línea' : 'Texto neutral: revísalo');
    if (ctx.fiscalProfile) put('invoice_policy', 'La clínica puede emitir factura (CFDI). Una persona del equipo solicita los datos fiscales necesarios; nunca pidas contraseñas ni documentos completos por el chat.', 'dato', 'Facturación');
    if (ctx.reminders && ctx.reminders.enabled) put('followup_policy', 'La clínica envía recordatorios de cita por WhatsApp. Si el paciente pide reprogramar o cancelar, pasa la conversación a una persona del equipo.', 'dato', 'Recordatorios de cita');
    put('intake_questions', 'Nombre completo, servicio de interés, día u horario preferido' + (branches.length > 1 ? ', sucursal' : '') + ' y un teléfono o correo de contacto. Una o dos preguntas por mensaje.', 'sugerido', 'Texto neutral: revísalo');
    var telUrg = tel[0] || wa[0] || '';
    put('emergency_policy', 'Si el paciente menciona dolor intenso, sangrado, inflamación o una urgencia, no des indicaciones clínicas: avisa a una persona del equipo' + (telUrg ? ' y comparte el teléfono de la clínica (' + telUrg + ')' : '') + '.', 'sugerido', telUrg ? 'Teléfono de tu clínica' : 'Texto neutral: revísalo');
    put('handoff_rules', 'Pasar a una persona cuando el paciente lo pida, ante quejas o molestias, dolor, urgencias o dudas clínicas, solicitudes de expediente y cualquier tema que el asistente no pueda confirmar.', 'sugerido', 'Texto neutral: revísalo');
    put('allowed_memory', 'Nombre, servicio de interés y preferencia de horario que el paciente comparta en esta conversación.', 'sugerido', 'Texto neutral: revísalo');
    put('prohibited_memory', 'Diagnósticos, síntomas, historial clínico, fotografías o radiografías, documentos de identidad y datos de pago.', 'sugerido', 'Texto neutral: revísalo');

    // ── Preguntas frecuentes: solo con datos reales ──
    function addFaq(q, a) { if (clean(q) && clean(a)) faq.push({ q: clip(q, MAX.faq_question), a: clip(a, MAX.faq_answer) }); }
    if (clean(ctx.locationText)) addFaq('¿Dónde están ubicados?', ctx.locationText);
    if (clean(ctx.hoursText)) addFaq('¿Cuál es el horario de atención?', ctx.hoursText);
    if (services.length) addFaq('¿Qué servicios ofrecen?', 'Ofrecemos: ' + uniq(services.map(function (s) { return s.patient_name || s.name; })).slice(0, 12).join(', ') + '.');
    addFaq('¿Cómo puedo agendar una cita?', sched && sched.level === 'request'
      ? 'Puedo mostrarte horarios disponibles y dejar tu solicitud de cita; la clínica la revisa y te confirma por este mismo chat.'
      : 'Con gusto tomo tus datos y los paso al equipo de la clínica para que te confirme tu cita.');
    if (conPrecio.length) addFaq('¿Cuánto cuesta una consulta o tratamiento?', 'Los precios son de referencia y se confirman después de la valoración. Dime qué servicio te interesa y te comparto el precio de referencia.');
    if (pagoLinea) addFaq('¿Cómo puedo pagar?', 'La clínica ofrece pago en línea con un enlace que te envía el equipo; también puedes acordar tu pago con ellos.');
    if (ctx.fiscalProfile) addFaq('¿Emiten factura?', 'Sí, la clínica puede emitir factura. El equipo te pedirá los datos fiscales necesarios.');
    return { fields: fields, faq: faq.slice(0, 8) };
  }

  var api = { compose: compose, MAX: MAX, clip: clip };
  root.SmylTrainingAutofill = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
