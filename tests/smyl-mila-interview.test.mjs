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
  assert.match(config, /\[functions\.mila-interview\]\nverify_jwt = false/);
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
  assert.match(app, /smyl-mila-interview\.js\?v=2/);
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
  assert.match(fn, /buildInterviewerInstructions\(firstName\(patient\?\.nombre\)\)/);
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
