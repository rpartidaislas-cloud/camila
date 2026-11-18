import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  EXAM_SCHEMA,
  HISTORY_SCHEMA,
  INTERVIEW_GUIDE,
  INTERVIEWER_TOOLS,
  buildInterviewerInstructions,
  firstName,
  ALERT_TYPES,
  normalizeExam,
  normalizeHistory,
  quoteFound,
  splitDate,
  surfaceAllowed,
} from '../supabase/functions/_shared/mila-interview-contract.mjs';

const require = createRequire(import.meta.url);
const H = require('../smyl-history-model.js');
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const TRANSCRIPT = `Doctor: ¿Es alérgico a algún medicamento? Paciente: sí, a la penicilina, me salieron ronchas y se me cerró la garganta.
Doctor: ¿Toma algún medicamento? Paciente: tomo metformina de 850 cada 12 horas desde marzo de 2021.
Doctor: ¿Lo han operado? Paciente: no, nunca. Doctor: ¿Fuma? Paciente: no sé si cuenta, fumo dos cigarros los fines de semana.`;

function strictSchemaOk(schema) {
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    Object.values(schema.properties).forEach(strictSchemaOk);
  } else if (schema.type === 'array') strictSchemaOk(schema.items);
}

test('los esquemas cumplen el modo strict de structured outputs', () => {
  strictSchemaOk(HISTORY_SCHEMA);
  strictSchemaOk(EXAM_SCHEMA);
});

test('la guía cubre las seis secciones que cuentan en la historia y el contacto', () => {
  assert.deepEqual(INTERVIEW_GUIDE.map((s) => s.key).sort(),
    ['alerts', 'allergies', 'conditions', 'dental', 'emergency_contact', 'habits', 'medications', 'surgeries']);
  INTERVIEW_GUIDE.forEach((s) => assert.ok(s.questions.length >= 1));
});

test('normalizeHistory convierte la salida del modelo al documento de historia', () => {
  const out = normalizeHistory({
    alerts: { status: 'not_asked', items: [] },
    allergies: { status: 'yes', records: [{ substance: 'Penicilina', reaction: 'Ronchas y cierre de garganta', severity: 'high', quote: 'a la penicilina, me salieron ronchas' }] },
    conditions: { status: 'not_asked', records: [] },
    medications: { status: 'yes', records: [{ name: 'Metformina', dose: '850 mg', frequency: 'cada 12 horas', changed_at: '2021-03', quote: 'tomo metformina de 850 cada 12 horas' }] },
    surgeries: { status: 'no', records: [] },
    dental: { status: 'not_asked', history_text: '', last_visit: '', quote: '' },
    habits: { status: 'yes', text: 'Tabaquismo ocasional: 2 cigarros los fines de semana', quote: 'fumo dos cigarros los fines de semana' },
    emergency_contact: { text: '', quote: '' },
    notes: '',
    follow_ups: ['Confirmar si hay diabetes diagnosticada (toma metformina)'],
  }, TRANSCRIPT);
  assert.equal(out.document.allergies_status, 'yes');
  assert.equal(out.document.allergy_records[0].severity, 'high');
  // "2021-03" no es una fecha válida para <input type=date>: se conserva como texto en el nombre.
  assert.equal(out.document.medication_records[0].changed_at, '');
  assert.match(out.document.medication_records[0].name, /desde 2021-03/);
  assert.equal(out.document.surgeries_status, 'no');
  assert.equal(out.document.conditions_status, 'pending');
  assert.equal(out.document.dental_status, 'pending');
  assert.equal(out.coverage.surgeries, 'no');
  assert.equal(out.coverage.dental, 'not_asked');
  assert.equal(out.needs_review.length, 0);
  assert.ok(out.evidence.every((e) => e.verified));
  assert.equal(out.follow_ups.length, 1);
});

test('una cita que no aparece en la transcripción se marca para revisar', () => {
  const out = normalizeHistory({ allergies: { status: 'yes', records: [{ substance: 'Látex', reaction: '', severity: '', quote: 'soy alérgico al látex' }] } }, TRANSCRIPT);
  assert.equal(out.evidence[0].verified, false);
  assert.match(out.needs_review[0], /Látex/);
});

test('estados inválidos o "sí" sin detalle quedan pendientes', () => {
  const out = normalizeHistory({ conditions: { status: 'yes', records: [] }, habits: { status: 'quizá', text: '', quote: '' } }, '');
  assert.equal(out.document.conditions_status, 'pending');
  assert.equal(out.document.habits_status, 'pending');
});

test('fechas: solo formatos que acepta el editor', () => {
  assert.deepEqual(splitDate('2021-03-15', 'date'), ['2021-03-15', '']);
  assert.deepEqual(splitDate('2021-02-30', 'date'), ['', '2021-02-30']);
  assert.deepEqual(splitDate('2021-03-15', 'month'), ['2021-03', '']);
  assert.deepEqual(splitDate('hace 3 años', 'month'), ['', 'hace 3 años']);
  assert.deepEqual(splitDate('', 'date'), ['', '']);
});

test('normalizeExam valida pieza FDI y cara, y separa lo que no tiene pieza', () => {
  const t = 'dieciséis oclusal caries profunda, once incisal fractura, la once oclusal no, veintinueve caries, gingivitis generalizada';
  const out = normalizeExam({
    findings: [
      { tooth: '16', surface: 'O', condition_code: 'caries', condition_text: 'Caries oclusal profunda', quote: 'dieciséis oclusal caries profunda', uncertain: false },
      { tooth: '11', surface: 'O', condition_code: 'fracture', condition_text: 'Fractura', quote: 'once incisal fractura', uncertain: false },
      { tooth: '29', surface: 'whole', condition_code: 'caries', condition_text: 'Caries', quote: 'veintinueve caries', uncertain: true },
      { tooth: '16', surface: 'O', condition_code: 'caries', condition_text: 'caries oclusal profunda', quote: 'dieciséis oclusal caries profunda', uncertain: false },
    ],
    general_notes: [{ text: 'Gingivitis generalizada', quote: 'gingivitis generalizada' }],
    follow_ups: [],
  }, t);
  assert.equal(out.findings.length, 2, 'duplicado descartado y pieza 29 fuera');
  assert.deepEqual(out.findings[0], { tooth: '16', surface: 'O', condition_code: 'caries', condition: 'Caries oclusal profunda', quote: 'dieciséis oclusal caries profunda', verified: true, uncertain: false });
  assert.equal(out.findings[1].surface, 'whole', 'oclusal no existe en un incisivo');
  assert.equal(out.findings[1].uncertain, true);
  assert.equal(out.unplaced[0].reason, 'Pieza no identificada');
  assert.equal(out.general_notes[0].text, 'Gingivitis generalizada');
  assert.equal(surfaceAllowed('36', 'I'), false);
  assert.equal(surfaceAllowed('13', 'I'), true);
});

test('quoteFound tolera acentos y puntuación', () => {
  assert.ok(quoteFound('Tomo METFORMINA, de 850', TRANSCRIPT));
  assert.ok(!quoteFound('', TRANSCRIPT));
});

test('mergeSuggestion agrega sin borrar lo confirmado ni duplicar', () => {
  const current = { allergy_records: [{ substance: 'Penicilina', reaction: 'Urticaria', severity: 'moderate' }], allergies_status: 'yes', medications_status: 'no', habits: 'Bruxismo', habits_status: 'yes' };
  const out = H.mergeSuggestion(current, {
    allergy_records: [{ substance: 'penicilina', reaction: 'otra', severity: 'high' }, { substance: 'Látex', reaction: '', severity: '' }],
    allergies_status: 'yes',
    medication_records: [{ name: 'Metformina', dose: '850 mg', frequency: 'cada 12 horas', changed_at: '' }],
    medications_status: 'yes',
    surgeries_status: 'no',
    habits: 'Tabaquismo ocasional',
    habits_status: 'yes',
  });
  const d = out.document;
  assert.equal(d.allergy_records.length, 2);
  assert.equal(d.allergy_records[0].reaction, 'Urticaria', 'lo registrado no se sobrescribe');
  assert.equal(d.medications_status, 'yes');
  assert.equal(d.medication_records[0].name, 'Metformina');
  assert.equal(d.surgeries_status, 'no', 'un "no" de MILA llena un apartado pendiente');
  assert.equal(d.habits, 'Bruxismo\nTabaquismo ocasional');
  assert.deepEqual(d.allergies, ['Penicilina', 'Látex']);
  assert.ok(out.added.includes('Alergia: Látex'));
});

test('un "no" de MILA no reemplaza un estado ya confirmado', () => {
  const out = H.mergeSuggestion({ conditions_status: 'unknown' }, { conditions_status: 'no', condition_records: [] });
  assert.equal(out.document.conditions_status, 'unknown');
});

test('la función protege la sesión: QR de un solo uso, dispositivo, consentimiento y medición', () => {
  const fn = read('../supabase/functions/mila-interview/index.ts');
  const config = read('../supabase/config.toml');
  const sql = read('../supabase/migrations/20261115130000_smyl_mila_interview.sql');
  assert.match(config, /\[functions\.mila-interview\]\r?\nverify_jwt = false/);
  assert.match(fn, /requirePermission\(auth, CORS, "clinical\.write"\)/);
  assert.match(fn, /\.is\("device_hash", null\)/, 'el token se canjea una sola vez');
  assert.match(fn, /if \(!row\.consent_at\) return json\(409/);
  assert.match(fn, /smyl_consume/);
  assert.match(fn, /smyl_ai_usage_log/);
  assert.match(fn, /input_tokens/);
  assert.doesNotMatch(fn, /storage\.from|\.upload\(/, 'el audio no se guarda');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.smyl_mila_interviews from public, anon, authenticated/);
  assert.match(sql, /'mila_history_interview', 'mila_exam_dictation'/);
});

test('la app carga MILA y la copia móvil está sincronizada', () => {
  const app = read('../app.html');
  assert.match(app, /vendor\/qrcode-generator-1\.4\.4\.js/);
  assert.match(app, /smyl-mila-interview\.js\?v=6/);
  for (const file of ['app.html', 'mila-movil.html', 'smyl-mila-interview.js', 'smyl-mila-interview.css', 'smyl-history-model.js', 'smyl-history-read.js', 'smyl-patient-360.js', 'smyl-case-workspace.js', 'sw.js', 'vendor/qrcode-generator-1.4.4.js']) {
    assert.equal(read(`../mobile/www/${file}`), read(`../${file}`), `${file} sincronizado`);
  }
});

test('la entrevistadora por voz saluda por el primer nombre y tiene reglas de seguridad', () => {
  assert.equal(firstName('  Ana María '), 'Ana');
  assert.equal(firstName('<script>'), 'script');
  const text = buildInterviewerInstructions('Ana María');
  assert.match(text, /llamada Ana /);
  assert.doesNotMatch(text, /María/, 'solo el primer nombre');
  assert.match(text, /No das diagnósticos/);
  assert.match(text, /Eso lo revisará el doctor/);
  assert.match(text, /UNA pregunta a la vez/);
  assert.match(text, /RESUMEN breve en voz alta/);
  assert.match(text, /registrar_alerta/);
  assert.match(text, /Qué le trae hoy/);
  for (const section of INTERVIEW_GUIDE) assert.ok(text.includes(section.title), section.title);
  assert.ok(buildInterviewerInstructions('').includes('la persona paciente'));
});

test('las funciones de la entrevistadora son estrictas', () => {
  assert.deepEqual(INTERVIEWER_TOOLS.map((t) => t.name), ['registrar_alerta', 'entrevista_completa']);
  const alert = INTERVIEWER_TOOLS[0].parameters;
  assert.deepEqual(alert.properties.tipo.enum, ALERT_TYPES);
  assert.equal(alert.additionalProperties, false);
});

test('el modo por voz y la interpretación en segundo plano miden el consumo en el servidor', () => {
  const fn = read('../supabase/functions/mila-interview/index.ts');
  assert.match(fn, /api\.openai\.com\/v1\/realtime\/calls/);
  assert.match(fn, /buildInterviewerInstructions\(firstName\(patient\?\.nombre\)/);
  assert.match(fn, /Date\.now\(\) - Date\.parse\(rt\.started_at\)/, 'los segundos de voz los mide el servidor');
  assert.match(fn, /MAX_REALTIME_SECONDS/);
  assert.match(fn, /usage_source: "client_reported_openai_response_done"/);
  assert.match(fn, /EdgeRuntime!\.waitUntil/);
  assert.match(fn, /source_chars/, 'un borrador viejo no pisa uno más nuevo');
  assert.match(fn, /\.eq\("tenant_id", tenantId\)\.like\("request_id"/);
  assert.match(fn, /if \(!row\.consent_at\) return json\(409/);
  const phone = read('../mila-movil.html');
  assert.match(phone, /id="v-confirm"/);
  assert.match(phone, /realtime_finish/);
  assert.match(phone, /SEGMENT_MS=60000/);
});

test('voz femenina latina configurable y pantalla en vivo con orbe', () => {
  const text = buildInterviewerInstructions('Ana');
  assert.match(text, /mujer latinoamericana: acento mexicano/);
  const fn = read('../supabase/functions/mila-interview/index.ts');
  assert.match(fn, /OPENAI_MILA_INTERVIEW_VOICE/);
  assert.match(fn, /cached_input_tokens/);
  const phone = read('../mila-movil.html');
  assert.match(phone, /id="live"/);
  assert.match(phone, /<canvas id="orb"/);
  assert.match(phone, /createAnalyser/);
  assert.match(phone, /output_audio_buffer\.started/);
  assert.match(phone, /input_audio_buffer\.speech_started/);
  assert.match(phone, /prefers-reduced-motion: reduce/);
  assert.match(phone, /id="live-pause"/);
});

test('ahorro sin perder calidad: ruido, intervenciones breves y cierre por silencio', () => {
  assert.match(read('../supabase/functions/mila-interview/index.ts'), /noise_reduction: \{ type: "far_field" \}/);
  assert.match(buildInterviewerInstructions('Ana'), /como máximo dos frases breves/);
  const phone = read('../mila-movil.html');
  assert.match(phone, /limit=rt\.muted\?300000:60000/);
  assert.match(phone, /se cerrará en/);
});

test('pantalla v2: anillo de temas, karaoke, pantalla de terminado y continuar entrevista', () => {
  const phone = read('../mila-movil.html');
  assert.doesNotMatch(phone, /class="live-badge"/, 'sin la etiqueta MILA arriba');
  assert.match(phone, /id="ring"/);
  assert.match(phone, /function detectTopic/);
  assert.match(phone, /function karaoke/);
  assert.match(phone, /id="rt-done"/);
  assert.match(phone, /continuar:!!continuar/);
  const text = buildInterviewerInstructions('Ana', { continuation: { covered: ['Alergias'], pending: ['Hábitos'] } });
  assert.match(text, /ESTA ES UNA CONTINUACIÓN/);
  assert.match(text, /Pregunta solo por: Hábitos/);
  assert.doesNotMatch(buildInterviewerInstructions('Ana'), /CONTINUACIÓN/);
  const fn = read('../supabase/functions/mila-interview/index.ts');
  assert.match(fn, /field\("continuar"\) === "true"/);
  assert.match(fn, /:rt\$\{Date\.parse\(rt\.started_at\)\}/, 'cada conversación se mide por separado');
});

test('el resumen final no se corta: tope amplio, reanudación y actividad mientras MILA habla', () => {
  const fn = read('../supabase/functions/mila-interview/index.ts');
  assert.match(fn, /max_output_tokens: "inf"/);
  assert.doesNotMatch(fn, /max_output_tokens: 600,/);
  const phone = read('../mila-movil.html');
  assert.match(phone, /reason==='max_output_tokens'/);
  assert.match(phone, /if\(ORB\.state==='mila'\|\|ORB\.state==='listening'\|\|ORB\.state==='thinking'\)rt\.last=Date\.now\(\);/);
});

test('orbe v3: cintas de luz que siguen la voz, sin filtros de desenfoque', () => {
  const phone = read('../mila-movil.html');
  assert.match(phone, /Orbe v3: esfera de vidrio con cintas de luz/);
  assert.doesNotMatch(phone, /CANVAS_BLUR/);
  assert.match(phone, /paintOrb\(g,ORB\.size,t,ORB\.state/);
});

test('entrevista previa: formulario sin IA, identidad, plantilla y seguimiento', async () => {
  const m = await import('../supabase/functions/_shared/mila-interview-contract.mjs');
  const r = m.buildFromForm({
    allergies_status: 'yes', allergies: [{ substance: 'Penicilina', reaction: 'ronchas', severity: 'high' }],
    alerts: ['anticoagulante', 'inventado'], medications_status: 'no', conditions_status: 'unknown', surgeries_status: '',
    reason: 'Dolor de muela', pain: 'yes', pain_level: 9, habits: ['fuma'], brushing: '2 veces al día', floss: 'no',
    emergency_name: 'Luis', emergency_phone: '55 1234 5678',
  });
  assert.equal(r.source, 'form');
  assert.equal(r.document.allergy_records[0].severity, 'high');
  assert.deepEqual(r.document.alerts, ['Toma anticoagulantes o aspirina diaria'], 'opciones desconocidas se ignoran');
  assert.equal(r.document.medications_status, 'no');
  assert.equal(r.document.conditions_status, 'unknown');
  assert.equal(r.coverage.surgeries, 'not_asked');
  assert.match(r.document.dental_history, /Motivo de consulta: Dolor de muela\. Refiere dolor 9\/10/);
  assert.match(r.needs_review[0], /dolor intenso/);
  assert.equal(r.document.emergency_contact, 'Luis · 55 1234 5678');
  assert.ok(m.summarizeKnownHistory(r.document).some((l) => /Alergias: Penicilina/.test(l)));
  const pre = m.buildInterviewerInstructions('Ana', { previsit: { clinic: 'Clínica Sonríe', appointment: 'martes 18 a las 10:00 am' }, known: ['Alergias: Penicilina'] });
  assert.match(pre, /responde SOLA desde su celular/);
  assert.match(pre, /911/);
  assert.match(pre, /tipo «urgencia»/);
  assert.match(pre, /PACIENTE DE SEGUIMIENTO/);
  assert.ok(m.ALERT_TYPES.includes('urgencia'));
  // las casillas del formulario del celular coinciden con las del servidor
  const phone = read('../mila-movil.html');
  for (const [key] of m.FORM_ALERT_OPTIONS) assert.match(phone, new RegExp(`\\['${key}',`));
  for (const [key] of m.FORM_HABIT_OPTIONS) assert.match(phone, new RegExp(`\\['${key}',`));
  assert.match(phone, /id="v-dob"/);
  assert.match(phone, /id="v-form"/);
  assert.match(phone, /call\('form_submit'/);
  const fn = read('../supabase/functions/mila-interview/index.ts');
  assert.match(fn, /action === "previsit_create"/);
  assert.match(fn, /sameDob\(field\("dob"\)/);
  assert.match(fn, /identity_attempts\) \|\| 0\) >= 5/);
  assert.match(fn, /event_type: "mila_interview_consent"/);
  assert.match(fn, /PREVISIT_TEMPLATE = "entrevista_previa_v1"/);
  assert.match(fn, /MAX_PREVISIT_REALTIME_SECONDS = 15 \* 60/);
  const catalog = await import('../supabase/functions/_shared/whatsapp-template-catalog.mjs');
  const tpl = catalog.TEMPLATES.find((t) => t.id === 'entrevista_previa_v1');
  assert.ok(tpl, 'la plantilla está en el catálogo');
  assert.deepEqual(catalog.validate(tpl), []);
  const sql = read('../supabase/migrations/20261116120000_smyl_mila_previsit.sql');
  assert.match(sql, /check \(kind in \('clinic', 'previsit'\)\)/);
  const desk = read('../smyl-mila-interview.js');
  assert.match(desk, /renderPending/);
  assert.match(desk, /smyl:mila-history-saved/);
  assert.match(read('../smyl-patient-360.js'), /smyl:mila-history-saved/);
});

test('el orbe siempre es circular aunque el subtítulo sea largo', () => {
  const phone = read('../mila-movil.html');
  assert.match(phone, /\.orbwrap\{position:relative;flex:none;width:min\(78vw,320px,38vh\);height:auto;aspect-ratio:1\/1;/);
  assert.match(phone, /Math\.abs\(w-ORB\.size\)>2/, 'el lienzo se ajusta si cambia el tamaño');
});

test('entrevista previa: envío automático y marcas en la agenda', () => {
  const sql = read('../supabase/migrations/20261116150000_smyl_mila_previsit_auto.sql');
  assert.match(sql, /hours_before integer not null default 48 check \(hours_before between 12 and 168\)/);
  assert.match(sql, /audience in \('no_history', 'stale', 'all'\)/);
  assert.match(sql, /unique \(tenant_id, appointment_id\)/, 'una sola entrevista previa por cita');
  assert.match(sql, /enable row level security[\s\S]*revoke all on public\.smyl_mila_previsit_dispatches from public, anon, authenticated/);
  const fn = read('../supabase/functions/mila-interview/index.ts');
  assert.match(fn, /x-smyl-cron-secret/);
  assert.match(fn, /SMYL_REMINDERS_CRON_SECRET/);
  assert.match(fn, /action === "previsit_overview"[\s\S]{0,300}"schedule\.read"/);
  assert.match(fn, /action === "previsit_settings_save"[\s\S]{0,200}"schedule\.manage"/);
  assert.match(fn, /AUTO_RESEND_DAYS = 30/);
  assert.match(fn, /AUTO_STALE_DAYS = 365/);
  assert.match(fn, /\.eq\("status", "confirmed"\)/, 'solo citas confirmadas');
  assert.match(fn, /if \(!templateId\) return \{ skipped: "template_not_approved" \}/, 'sin plantilla aprobada no se registra nada');
  assert.match(fn, /status: "reviewed"/, 'al revisar o descartar se marca la cita');
  const agenda = read('../smyl-schedule.js');
  assert.match(agenda, /previsitChip\(a\)\+'<\/button>'/);
  assert.match(agenda, /action:'previsit_overview'/);
  assert.match(agenda, /data-previsit-send/);
  assert.match(agenda, /previsitOnly:true,appointmentId:a\.id/);
  const desk = read('../smyl-mila-interview.js');
  assert.match(desk, /action:'previsit_settings_save'/);
  assert.match(desk, /appointment_id:s\.appointmentId/);
  for (const f of ['smyl-schedule.js', 'smyl-schedule.css', 'smyl-mila-interview.js', 'smyl-mila-interview.css']) {
    assert.equal(read('../mobile/www/' + f), read('../' + f), f + ' sincronizado con la app móvil');
  }
});

test('turnos de voz: el detector semántico no se corta con un «ajá» ni con ruido', async () => {
  const fn = read('../supabase/functions/mila-interview/index.ts');
  assert.match(fn, /type: "semantic_vad", eagerness: VAD_EAGERNESS, create_response: false, interrupt_response: false/);
  assert.match(fn, /OPENAI_MILA_TURN_MODE/);
  assert.match(fn, /turn_control: TURN_MODE === "semantic" \? "client" : "server"/);
  assert.match(fn, /type: "server_vad", threshold: 0.62/, 'el esquema anterior queda como regreso rápido');

  const html = read('../mila-movil.html');
  const block = html.slice(html.indexOf('// MARK:turns'), html.indexOf('// MARK:/turns'));
  assert.ok(block.length > 200, 'bloque de turnos presente');
  const vm = await import('node:vm');
  const sent = [];
  const ctx = { st: { rt: { ctl: true, muted: false } }, sendRt: (e) => sent.push(e.type), performance: { now: () => ctx.now } , now: 0 };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  const ev = (e, at) => { if (at != null) ctx.now = at; vm.runInContext('onTurnEvent(' + JSON.stringify(e) + ')', ctx); };
  const reset = () => { sent.length = 0; Object.assign(ctx.st.rt, { respActive: false, pendingReply: false, duringMila: false, interrupted: false, heardText: '' }); };

  // 1) MILA habla y el paciente dice «ajá»: no se cancela ni se responde.
  reset();
  ev({ type: 'response.created' });
  ev({ type: 'input_audio_buffer.speech_started' }, 1000);
  ev({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Ajá' });
  ev({ type: 'input_audio_buffer.speech_stopped' }, 1300);
  ev({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Ajá.' });
  assert.deepEqual(sent, [], '«ajá» no interrumpe');
  assert.equal(ctx.st.rt.respActive, true);

  // 2) MILA habla y el paciente dice «o»/ruido sin texto.
  reset();
  ev({ type: 'response.created' });
  ev({ type: 'input_audio_buffer.speech_started' }, 0);
  ev({ type: 'input_audio_buffer.speech_stopped' }, 200);
  ev({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'o' });
  assert.deepEqual(sent, []);

  // 3) Interrupción de verdad: una frase mientras MILA habla la corta y se responde después.
  reset();
  ev({ type: 'response.created' });
  ev({ type: 'input_audio_buffer.speech_started' }, 0);
  ev({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Espera, tengo una duda' });
  assert.deepEqual(sent, ['response.cancel', 'output_audio_buffer.clear']);
  ev({ type: 'input_audio_buffer.speech_stopped' }, 2000);
  ev({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Espera, tengo una duda' });
  assert.deepEqual(sent, ['response.cancel', 'output_audio_buffer.clear', 'response.create']);

  // 4) MILA callada: responde en cuanto el paciente termina, sin esperar la transcripción.
  reset();
  ev({ type: 'input_audio_buffer.speech_started' }, 0);
  ev({ type: 'input_audio_buffer.speech_stopped' }, 1500);
  assert.deepEqual(sent, ['response.create']);
  ev({ type: 'response.created' });
  ev({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'No tengo alergias' });
  assert.deepEqual(sent, ['response.create'], 'no responde dos veces');

  // 5) MILA callada y un ruido muy corto sin texto: no responde.
  reset();
  ev({ type: 'input_audio_buffer.speech_started' }, 0);
  ev({ type: 'input_audio_buffer.speech_stopped' }, 200);
  ev({ type: 'conversation.item.input_audio_transcription.completed', transcript: '' });
  assert.deepEqual(sent, []);

  // 6) Un «sí» corto cuando MILA ya terminó de hablar sí se contesta.
  reset();
  ev({ type: 'response.created' });
  ev({ type: 'input_audio_buffer.speech_started' }, 0);
  ev({ type: 'response.done' });
  ev({ type: 'input_audio_buffer.speech_stopped' }, 300);
  ev({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Sí.' });
  assert.deepEqual(sent, ['response.create']);

  // 7) Con turn_control del servidor, el celular no interviene.
  reset();
  ctx.st.rt.ctl = false;
  ev({ type: 'input_audio_buffer.speech_started' }, 0);
  ev({ type: 'input_audio_buffer.speech_stopped' }, 1500);
  assert.deepEqual(sent, []);
  ctx.st.rt.ctl = true;
});

test('agilidad de MILA: acuses breves, sin anunciar preguntas y velocidad con respaldo', () => {
  const text = buildInterviewerInstructions('Ana');
  assert.match(text, /Agilidad: en cuanto tengas la respuesta, contesta de inmediato/);
  assert.match(text, /unas 15 palabras como máximo/);
  assert.match(text, /No anuncies lo que vas a preguntar/);
  assert.match(text, /simple «no» o «ninguna», pasa directo/);
  assert.match(text, /espera; no llenes el silencio/);
  assert.match(text, /como máximo dos frases breves/, 'se conserva el límite anterior');
  const fn = read('../supabase/functions/mila-interview/index.ts');
  assert.match(fn, /OPENAI_MILA_VOICE_SPEED/);
  assert.match(fn, /Math\.min\(1\.25, Math\.max\(0\.8, n\)\)/);
  assert.match(fn, /!resp\.ok && VOICE_SPEED !== 1 && \/speed\/i\.test\(answer\)[\s\S]{0,200}openCall\(false\)/, 'si rechaza speed reintenta sin él');
});
