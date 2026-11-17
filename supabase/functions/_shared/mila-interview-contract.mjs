// MILA · Entrevista (historia clínica) y exploración dictada desde el celular.
// Contrato puro (sin red ni Deno) para que se pueda probar en Node: esquemas que se piden al modelo,
// prompts y normalización/validación de lo que devuelve. Lo que el modelo diga NUNCA se guarda en el
// expediente directamente: se convierte en un borrador que el dentista revisa en la computadora.

export const HISTORY_SECTIONS = ['alerts', 'allergies', 'conditions', 'medications', 'surgeries', 'dental', 'habits'];
export const SECTION_LABELS = {
  alerts: 'Alertas médicas', allergies: 'Alergias', conditions: 'Condiciones médicas', medications: 'Medicamentos',
  surgeries: 'Cirugías y hospitalizaciones', dental: 'Antecedentes dentales', habits: 'Hábitos', emergency_contact: 'Contacto de emergencia',
};
export const TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38].map(String);
export const SURFACES = ['whole', 'M', 'D', 'V', 'L', 'O', 'I'];
export const CONDITION_CODES = ['caries', 'restoration', 'crown', 'endodontics', 'missing', 'implant', 'fracture', 'sealant', 'other'];
const STATUS = ['yes', 'no', 'unknown', 'not_asked'];
const SEVERITY = ['', 'low', 'moderate', 'high'];
const COND_STATUS = ['', 'active', 'controlled', 'resolved', 'unknown'];
const MAX_RECORDS = 20;

const str = { type: 'string' };
const statusProp = { type: 'string', enum: STATUS };
function obj(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
function list(items) { return { type: 'array', items }; }

export const HISTORY_SCHEMA = obj({
  alerts: obj({ status: statusProp, items: list(obj({ text: str, quote: str })) }),
  allergies: obj({ status: statusProp, records: list(obj({ substance: str, reaction: str, severity: { type: 'string', enum: SEVERITY }, quote: str })) }),
  conditions: obj({ status: statusProp, records: list(obj({ name: str, diagnosed_at: str, status: { type: 'string', enum: COND_STATUS }, quote: str })) }),
  medications: obj({ status: statusProp, records: list(obj({ name: str, dose: str, frequency: str, changed_at: str, quote: str })) }),
  surgeries: obj({ status: statusProp, records: list(obj({ procedure: str, date: str, quote: str })) }),
  dental: obj({ status: statusProp, history_text: str, last_visit: str, quote: str }),
  habits: obj({ status: statusProp, text: str, quote: str }),
  emergency_contact: obj({ text: str, quote: str }),
  notes: str,
  follow_ups: list(str),
});

export const EXAM_SCHEMA = obj({
  findings: list(obj({
    tooth: str,
    surface: { type: 'string', enum: SURFACES },
    condition_code: { type: 'string', enum: CONDITION_CODES },
    condition_text: str,
    quote: str,
    uncertain: { type: 'boolean' },
  })),
  general_notes: list(obj({ text: str, quote: str })),
  follow_ups: list(str),
});

export const HISTORY_PROMPT = `Eres MILA, asistente de documentación odontológica en español de México. Recibes la TRANSCRIPCIÓN COMPLETA de una entrevista entre un dentista y su paciente (puede estar desordenada, con interrupciones y sin indicar quién habla).
Si las líneas vienen etiquetadas, «MILA:» es la asistente que pregunta (sus frases NO son datos del paciente) y «Paciente:» es lo que respondió el paciente o su acompañante.
Tu tarea es llenar el borrador de la historia clínica SOLO con lo que el paciente afirmó o el dentista confirmó en voz alta.

Reglas obligatorias:
- No inventes, no infieras y no completes con conocimiento general. Si un dato no se dijo, déjalo vacío.
- status por sección: "yes" si refirió tenerlo; "no" si lo negó explícitamente ("no tomo nada", "ninguna alergia"); "unknown" si dijo que no sabe o no recuerda; "not_asked" si el tema no apareció.
- Si en una pregunta posterior el paciente corrige lo que dijo, usa la versión corregida.
- Un registro por elemento (una alergia, un medicamento, una cirugía…). Usa el nombre tal como se dijo, con ortografía correcta.
- Alergias: severity "high" solo si describe anafilaxia, dificultad para respirar, hinchazón de garganta o hospitalización; "moderate"/"low" solo si se describe; si no, "".
- Medicamentos: dosis y frecuencia solo si se dijeron (ej. "500 mg", "cada 12 horas").
- Fechas: formato AAAA-MM-DD, o AAAA-MM si solo se dijo mes y año. Si solo hay un año o una fecha relativa ("hace 3 años"), escribe el texto tal cual dicho (ej. "2019", "hace 3 años").
- alerts: condiciones que cambian la atención dental (anticoagulantes, marcapasos, embarazo, bifosfonatos, diabetes descontrolada, hipertensión, problemas de coagulación, cardiopatía, etc.) SOLO si se mencionaron.
- dental.history_text: empieza con «Motivo de consulta: …». Si hay dolor, agrega desde cuándo, intensidad 0-10, localización y qué lo empeora o alivia, solo si se dijeron. Después tratamientos dentales previos, complicaciones con anestesia, sensibilidad o sangrado. Frases clínicas breves.
- habits.text: tabaco, alcohol, bruxismo, respiración oral, onicofagia, dieta azucarada, higiene (frecuencia de cepillado, hilo dental) SOLO si se mencionaron.
- quote: fragmento textual breve (máx. 160 caracteres) de la transcripción que respalda el dato. Copia las palabras exactas.
- follow_ups: máximo 6 preguntas concretas que el dentista aún debería hacer o confirmar (ej. "Confirmar dosis del anticoagulante", "Preguntar por alergia a anestésicos locales"). Prioriza la seguridad clínica.
- notes: solo información clínica relevante que no cabe en otra sección; si no hay, "".`;

export const EXAM_PROMPT = `Eres MILA, asistente de documentación odontológica en español de México. Recibes la TRANSCRIPCIÓN de lo que el dentista dictó en voz alta mientras exploraba la boca del paciente.
Convierte el dictado en hallazgos del odontograma con notación FDI (11-18, 21-28, 31-38, 41-48).

Reglas obligatorias:
- Registra SOLO lo dictado. No inventes piezas, superficies ni hallazgos y no hagas diagnósticos propios.
- Convierte números hablados a FDI ("dieciséis" o "uno seis" = 16; "treinta y seis" o "tres seis" = 36). Si la pieza no es clara o no es un número FDI válido, no inventes: usa tooth "" y marca uncertain=true.
- surface: O oclusal, M mesial, D distal, V vestibular/bucal/labial, L lingual/palatina, I incisal, whole si se refiere a toda la pieza o no se dijo la cara. Si se dictan varias caras (ej. "mesio-oclusal"), crea un hallazgo por cara.
- condition_code: caries, restoration (resina, amalgama, obturación), crown, endodontics, missing (ausente), implant, fracture, sealant u other. condition_text: frase breve y clínica tal como se dictó (ej. "Caries oclusal profunda", "Resina desadaptada").
- Si el dentista corrige ("no, perdón, era la 26"), usa la corrección y descarta lo anterior.
- Negaciones ("la 11 sin caries") NO son hallazgos.
- general_notes: observaciones que no son de una pieza (ej. "gingivitis generalizada", "cálculo en sector anteroinferior", "higiene deficiente").
- quote: fragmento textual breve (máx. 160 caracteres) que respalda el hallazgo.
- uncertain=true si hay cualquier ambigüedad.
- follow_ups: máximo 4 puntos que el dentista debería confirmar.`;

// ---------------------------------------------------------------- normalización

function text(v, max = 400) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
export function plain(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/* La cita debe salir de la transcripción: si no aparece (o casi), el dato queda marcado para revisar. */
export function quoteFound(quote, transcript) {
  const q = plain(quote), t = plain(transcript);
  if (!q) return false;
  if (t.includes(q)) return true;
  const words = q.split(' ').filter((w) => w.length > 2);
  if (!words.length) return false;
  const hits = words.filter((w) => t.includes(w)).length;
  return hits / words.length >= 0.8;
}
function status(v) { return STATUS.includes(v) ? v : 'not_asked'; }
function oneOf(v, allowed) { return allowed.includes(v) ? v : ''; }
const DAY = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/;
function validCalendar(value) {
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12) return false;
  if (d === undefined) return true;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
/* Devuelve [valorParaElCampo, textoSobrante]. Un campo <input type=date|month> solo acepta su formato exacto. */
export function splitDate(value, kind) {
  const v = text(value, 40);
  if (!v) return ['', ''];
  if (kind === 'month') {
    if (MONTH.test(v) && validCalendar(v)) return [v, ''];
    if (DAY.test(v) && validCalendar(v)) return [v.slice(0, 7), ''];
    return ['', v];
  }
  if (DAY.test(v) && validCalendar(v)) return [v, ''];
  return ['', v];
}
function withExtra(primary, extra) { return extra ? `${primary} (${extra})` : primary; }

/* Convierte la salida del modelo en: documento sugerido (mismas claves que smyl-history-model) + evidencias + pendientes. */
export function normalizeHistory(raw, transcript) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const evidence = [];
  const needsReview = [];
  const doc = {};
  const coverage = {};
  function note(section, label, quote) {
    const q = text(quote, 160);
    const found = quoteFound(q, transcript);
    evidence.push({ section, label: text(label, 200), quote: q, verified: found });
    if (!found) needsReview.push(`${SECTION_LABELS[section]}: "${text(label, 80)}" no se encontró textual en la conversación.`);
  }
  function rows(section, input, build) {
    const out = [];
    for (const item of Array.isArray(input) ? input : []) {
      if (out.length >= MAX_RECORDS || !item || typeof item !== 'object') continue;
      const row = build(item);
      if (!row) continue;
      out.push(row);
    }
    return out;
  }
  const docStatus = (s, n) => (n ? 'yes' : s === 'not_asked' ? 'pending' : s === 'yes' ? 'pending' : s);

  const alerts = r.alerts || {};
  const alertItems = rows('alerts', alerts.items, (it) => { const t = text(it.text, 120); if (!t) return null; note('alerts', t, it.quote); return t; });
  doc.alerts = alertItems; doc.alerts_status = docStatus(status(alerts.status), alertItems.length);
  coverage.alerts = status(alerts.status);

  const al = r.allergies || {};
  doc.allergy_records = rows('allergies', al.records, (it) => {
    const substance = text(it.substance, 120); if (!substance) return null;
    note('allergies', substance, it.quote);
    return { substance, reaction: text(it.reaction, 160), severity: oneOf(it.severity, SEVERITY) };
  });
  doc.allergies_status = docStatus(status(al.status), doc.allergy_records.length);
  coverage.allergies = status(al.status);

  const co = r.conditions || {};
  doc.condition_records = rows('conditions', co.records, (it) => {
    const name = text(it.name, 120); if (!name) return null;
    const [diagnosed_at, extra] = splitDate(it.diagnosed_at, 'month');
    note('conditions', name, it.quote);
    return { name: withExtra(name, extra), diagnosed_at, status: oneOf(it.status, COND_STATUS) };
  });
  doc.conditions_status = docStatus(status(co.status), doc.condition_records.length);
  coverage.conditions = status(co.status);

  const me = r.medications || {};
  doc.medication_records = rows('medications', me.records, (it) => {
    const name = text(it.name, 120); if (!name) return null;
    const [changed_at, extra] = splitDate(it.changed_at, 'date');
    note('medications', name, it.quote);
    return { name: withExtra(name, extra && `desde ${extra}`), dose: text(it.dose, 60), frequency: text(it.frequency, 80), changed_at };
  });
  doc.medications_status = docStatus(status(me.status), doc.medication_records.length);
  coverage.medications = status(me.status);

  const su = r.surgeries || {};
  doc.surgery_records = rows('surgeries', su.records, (it) => {
    const procedure = text(it.procedure, 160); if (!procedure) return null;
    const [date, extra] = splitDate(it.date, 'date');
    note('surgeries', procedure, it.quote);
    return { procedure: withExtra(procedure, extra), date };
  });
  doc.surgeries_status = docStatus(status(su.status), doc.surgery_records.length);
  coverage.surgeries = status(su.status);

  const de = r.dental || {};
  const [lastVisit, visitExtra] = splitDate(de.last_visit, 'date');
  let dentalText = text(de.history_text, 1200);
  if (visitExtra) dentalText = [dentalText, `Última visita referida: ${visitExtra}.`].filter(Boolean).join(' ');
  doc.dental_history = dentalText; doc.last_dental_visit = lastVisit;
  doc.dental_status = docStatus(status(de.status), dentalText || lastVisit);
  if (dentalText || lastVisit) note('dental', dentalText || lastVisit, de.quote);
  coverage.dental = status(de.status);

  const ha = r.habits || {};
  doc.habits = text(ha.text, 600);
  doc.habits_status = docStatus(status(ha.status), doc.habits);
  if (doc.habits) note('habits', doc.habits, ha.quote);
  coverage.habits = status(ha.status);

  const ec = r.emergency_contact || {};
  doc.emergency_contact = text(ec.text, 160);
  if (doc.emergency_contact) note('emergency_contact', doc.emergency_contact, ec.quote);
  doc.notes = text(r.notes, 1500);

  const followUps = (Array.isArray(r.follow_ups) ? r.follow_ups : []).map((v) => text(v, 200)).filter(Boolean).slice(0, 6);
  return { document: doc, evidence: evidence.slice(0, 120), needs_review: needsReview.slice(0, 20), follow_ups: followUps, coverage };
}

export function surfaceAllowed(tooth, surface) {
  if (!TEETH.includes(String(tooth)) || !SURFACES.includes(surface)) return false;
  const unit = Number(String(tooth)[1]);
  if (surface === 'O') return unit >= 4;
  if (surface === 'I') return unit <= 3;
  return true;
}

export function normalizeExam(raw, transcript) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const findings = [];
  const unplaced = [];
  const seen = new Set();
  for (const it of Array.isArray(r.findings) ? r.findings : []) {
    if (!it || typeof it !== 'object' || findings.length >= 60) continue;
    const condition = text(it.condition_text, 160);
    const quote = text(it.quote, 160);
    const tooth = String(it.tooth || '').replace(/\D/g, '');
    const code = CONDITION_CODES.includes(it.condition_code) ? it.condition_code : 'other';
    if (!condition) continue;
    if (!TEETH.includes(tooth)) { unplaced.push({ text: condition, quote, reason: 'Pieza no identificada' }); continue; }
    let surface = SURFACES.includes(it.surface) ? it.surface : 'whole';
    let uncertain = it.uncertain === true;
    if (!surfaceAllowed(tooth, surface)) { surface = 'whole'; uncertain = true; }
    const key = `${tooth}|${surface}|${plain(condition)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const verified = quoteFound(quote, transcript);
    findings.push({ tooth, surface, condition_code: code, condition, quote, verified, uncertain: uncertain || !verified });
  }
  const general = (Array.isArray(r.general_notes) ? r.general_notes : [])
    .map((g) => ({ text: text(g && g.text, 240), quote: text(g && g.quote, 160) })).filter((g) => g.text).slice(0, 20);
  const followUps = (Array.isArray(r.follow_ups) ? r.follow_ups : []).map((v) => text(v, 200)).filter(Boolean).slice(0, 4);
  return { findings, unplaced: unplaced.slice(0, 20), general_notes: general, follow_ups: followUps };
}

/* Guía que ve el dentista en el celular. */
export const INTERVIEW_GUIDE = [
  { key: 'allergies', title: 'Alergias', questions: ['¿Es alérgico a algún medicamento, anestesia, látex o alimento?', 'Si sí: ¿qué le pasó? ¿Tuvo que ir a urgencias?'] },
  { key: 'alerts', title: 'Alertas médicas', questions: ['¿Toma anticoagulantes o aspirina?', '¿Tiene marcapasos, problemas del corazón o de coagulación?', '¿Está embarazada o en lactancia?'] },
  { key: 'conditions', title: 'Condiciones médicas', questions: ['¿Tiene diabetes, presión alta, asma, tiroides u otra enfermedad?', '¿Desde cuándo? ¿Está controlada?'] },
  { key: 'medications', title: 'Medicamentos', questions: ['¿Qué medicamentos toma actualmente?', '¿Qué dosis y cada cuánto?'] },
  { key: 'surgeries', title: 'Cirugías y hospitalizaciones', questions: ['¿Lo han operado u hospitalizado?', '¿De qué y cuándo?'] },
  { key: 'dental', title: 'Motivo de consulta y antecedentes dentales', questions: ['¿Qué le trae hoy a consulta?', 'Si hay dolor: ¿desde cuándo? Del 0 al 10, ¿qué tanto duele? ¿Qué lo empeora?', '¿Cuándo fue su última visita al dentista?', '¿Ha tenido problemas con la anestesia, sangrado o sensibilidad?'] },
  { key: 'habits', title: 'Hábitos', questions: ['¿Fuma o toma alcohol?', '¿Aprieta o rechina los dientes?', '¿Cuántas veces se cepilla al día? ¿Usa hilo dental?'] },
  { key: 'emergency_contact', title: 'Contacto de emergencia', questions: ['¿A quién llamamos en caso de emergencia? Nombre y teléfono.'] },
];

// ---------------------------------------------------------------- MILA entrevista por voz (Realtime)

export const ALERT_TYPES = ['alergia_grave', 'anticoagulante', 'cardiaco', 'embarazo', 'urgencia', 'otra'];
export const ALERT_LABELS = {
  alergia_grave: 'Alergia grave', anticoagulante: 'Anticoagulante', cardiaco: 'Condición cardiaca o marcapasos', embarazo: 'Embarazo o lactancia', urgencia: 'Síntoma urgente', otra: 'Alerta clínica',
};

export const INTERVIEWER_TOOLS = [
  {
    type: 'function',
    name: 'registrar_alerta',
    description: 'Avisa de inmediato al dentista de un dato que cambia la seguridad de la atención: alergia grave (anafilaxia, hinchazón de garganta, hospitalización), anticoagulantes o antiagregantes, marcapasos o enfermedad del corazón, embarazo o lactancia, u otra condición de riesgo. Úsala en cuanto el paciente lo diga; no lo menciones al paciente.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ALERT_TYPES },
        detalle: { type: 'string', description: 'Frase breve con lo que dijo el paciente, ej. «Toma warfarina 5 mg diario».' },
      },
      required: ['tipo', 'detalle'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'entrevista_completa',
    description: 'Llámala solo después de que el paciente confirmó el resumen final y te despediste.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/* Primer nombre para el saludo; nunca apellidos ni otros datos. */
export function firstName(nombre) {
  const first = String(nombre || '').trim().split(/\s+/)[0] || '';
  return first.replace(/[^\p{L}'-]/gu, '').slice(0, 40);
}

/* opts.continuation = { covered: [títulos], pending: [títulos] } cuando se retoma una entrevista ya iniciada.
 * opts.known = [frases] con lo que ya está registrado en la historia (paciente de seguimiento).
 * opts.previsit = { clinic, appointment } cuando el paciente responde solo, antes de su cita. */
export function buildInterviewerInstructions(patientFirstName, opts = {}) {
  const name = firstName(patientFirstName);
  const cont = opts && opts.continuation;
  const known = (opts && Array.isArray(opts.known) ? opts.known : []).filter(Boolean).slice(0, 20);
  const pre = opts && opts.previsit;
  const sections = INTERVIEW_GUIDE.map((s, i) => `${i + 1}. ${s.title}: ${s.questions.join(' ')}`).join('\n');
  return `Eres MILA, asistente del consultorio dental. Estás entrevistando por voz a ${name ? `la persona paciente llamada ${name}` : 'la persona paciente'} para preparar su historia clínica. ${pre ? `La persona responde SOLA desde su celular, antes de su cita${pre.appointment ? ` (${pre.appointment})` : ''}${pre.clinic ? ` en ${pre.clinic}` : ''}; el dentista NO está presente y revisará todo después.` : 'El dentista está presente y revisará todo después.'}

Cómo hablas:
- Tu voz es la de una mujer latinoamericana: acento mexicano natural y cálido, sin sonar a doblaje ni a español de España. Entonación amable y cercana, ritmo pausado y claro, como una asistente de consultorio en México.
- Español de México, de usted, cálido y profesional. Frases cortas: UNA pregunta a la vez y espera la respuesta.
- Cada intervención tuya dura como máximo dos frases breves (por ejemplo, un acuse corto y la siguiente pregunta). No repitas lo que el paciente acaba de decir salvo para aclarar. La única excepción es el resumen final.
- Agilidad: en cuanto tengas la respuesta, contesta de inmediato y sin pensar en voz alta. Tu acuse es de una a tres palabras y lo varías («Gracias», «Entiendo», «Perfecto», «Muy bien»); nunca repitas el mismo dos veces seguidas. Cada frase tuya, de unas 15 palabras como máximo.
- No anuncies lo que vas a preguntar («ahora le voy a preguntar sobre…») ni expliques por qué lo preguntas salvo que te lo pidan: haz la pregunta directa.
- Si responde un simple «no» o «ninguna», pasa directo a la siguiente pregunta sin comentarlo. Si responde con una frase corta, no la repitas: solo acusa y sigue.
- Si hace una pausa para pensar o dice «mmm», «déjeme ver», espera; no llenes el silencio ni repitas la pregunta de inmediato.
- Preséntate como «MILA, asistente del consultorio${pre && pre.clinic ? ` de ${pre.clinic}` : ''}». No eres doctora ni das la consulta.
- Si no entendiste o la respuesta es ambigua, pide amablemente que la repita o aclare.
- Si la persona habla en otro idioma, responde en ese idioma.

Lo que NUNCA haces:
- No das diagnósticos, consejos médicos, opiniones sobre tratamientos, precios ni indicaciones de medicamentos. Si te preguntan algo así, responde: «Eso lo revisará el doctor en un momento» y sigue.
- No inventas datos ni asumes respuestas. No comentas ni juzgas lo que te cuentan.
- No pides datos que no estén en la guía (ni dirección, ni datos de pago, ni identificaciones).

Orden de la entrevista:
0. Saluda${name ? ` a ${name} por su nombre` : ''}, explica en una frase que harás unas preguntas de salud para su expediente y que el doctor lo revisará.
${sections}

Reglas de la entrevista:
- Si responde «sí» a algo, repregunta lo necesario (qué medicamento, dosis, cada cuánto, qué reacción tuvo, desde cuándo).
- En cuanto escuches una alergia grave, anticoagulante, marcapasos o enfermedad del corazón, embarazo u otra condición de riesgo, llama a la función registrar_alerta y continúa con naturalidad.
- Si el paciente quiere detenerse, respétalo y despídete.
- Al terminar, haz un RESUMEN breve en voz alta de lo que entendiste (alergias, medicamentos, enfermedades, cirugías, motivo de consulta, hábitos) y pregunta «¿Es correcto o quiere corregir algo?». Corrige lo que te indique.
- Después despídete diciendo ${pre ? 'que sus respuestas quedaron enviadas y el doctor las revisará en su cita' : 'que el doctor lo atenderá enseguida'} y llama a entrevista_completa.${pre ? `

ENTREVISTA PREVIA (el paciente está solo):
- Si menciona un síntoma que podría ser urgente (dolor en el pecho, falta de aire, hinchazón grande de cara o cuello, fiebre alta con hinchazón, sangrado que no se detiene, dolor intenso que no cede), dile con calma que no espere a su cita: que llame al consultorio${pre.clinic ? ` (${pre.clinic})` : ''} o, si es grave, al 911. Llama a registrar_alerta con tipo «urgencia». Después pregunta si quiere continuar.
- No confirmes ni cambies citas, no des precios y no prometas tratamientos: «Eso lo verá con el doctor en su cita».` : ''}${known.length ? `

PACIENTE DE SEGUIMIENTO. Esto ya está registrado en su historia:
${known.map((k) => `- ${k}`).join('\n')}
- No repitas toda la guía. Por cada tema, confirma en una frase si sigue igual («La última vez nos dijo que es alérgica a la penicilina, ¿sigue igual?») y pregunta si hay algo nuevo. Pregunta completo solo los temas que no aparecen arriba.` : ''}${cont ? `

ESTA ES UNA CONTINUACIÓN de una entrevista que ya empezó con la misma persona.
- No te presentes de nuevo: saluda brevemente («Seguimos con unas preguntas más»).
- Ya se cubrió: ${(cont.covered || []).join(', ') || 'nada todavía'}. No vuelvas a preguntar eso salvo que el paciente quiera corregir algo.
- Pregunta solo por: ${(cont.pending || []).join(', ') || 'lo que haya quedado incompleto'}. Después haz el resumen breve de lo nuevo y despídete.` : ''}`;
}

/* Frases cortas con lo que ya está en la historia, para que MILA confirme en vez de preguntar todo. */
export function summarizeKnownHistory(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const t = (v, max = 120) => text(v, max);
  const out = [];
  const allergies = list(d.allergy_records).map((r) => t(r && r.substance)).filter(Boolean);
  if (allergies.length) out.push(`Alergias: ${allergies.join(', ')}`);
  else if (d.allergies_status === 'no') out.push('Alergias: negó tener');
  const alerts = list(d.alerts).map((a) => t(a)).filter(Boolean);
  if (alerts.length) out.push(`Alertas médicas: ${alerts.join(', ')}`);
  const conditions = list(d.condition_records).map((r) => t(r && r.name)).filter(Boolean);
  if (conditions.length) out.push(`Condiciones: ${conditions.join(', ')}`);
  else if (d.conditions_status === 'no') out.push('Condiciones médicas: negó tener');
  const meds = list(d.medication_records).map((r) => [t(r && r.name), t(r && r.dose, 40), t(r && r.frequency, 60)].filter(Boolean).join(' ')).filter(Boolean);
  if (meds.length) out.push(`Medicamentos: ${meds.join('; ')}`);
  else if (d.medications_status === 'no') out.push('Medicamentos: negó tomar');
  const surgeries = list(d.surgery_records).map((r) => t(r && r.procedure)).filter(Boolean);
  if (surgeries.length) out.push(`Cirugías: ${surgeries.join(', ')}`);
  else if (d.surgeries_status === 'no') out.push('Cirugías: negó tener');
  if (t(d.habits)) out.push(`Hábitos: ${t(d.habits, 200)}`);
  return out.slice(0, 12);
}

// ---------------------------------------------------------------- Formulario previo a la cita
/* Opciones de alertas del formulario (casillas) → texto que entra en «Alertas médicas». */
export const FORM_ALERT_OPTIONS = [
  ['anticoagulante', 'Toma anticoagulantes o aspirina diaria'],
  ['marcapasos', 'Usa marcapasos'],
  ['corazon', 'Enfermedad del corazón'],
  ['coagulacion', 'Problemas de coagulación o sangrado'],
  ['embarazo', 'Embarazo o lactancia'],
  ['bifosfonatos', 'Toma bifosfonatos (para huesos/osteoporosis)'],
];
export const FORM_HABIT_OPTIONS = [
  ['fuma', 'Fuma'], ['alcohol', 'Toma alcohol con frecuencia'], ['bruxismo', 'Aprieta o rechina los dientes'],
  ['respiracion_oral', 'Respira por la boca'], ['unas', 'Se muerde las uñas'], ['azucar', 'Consume dulces o refrescos a diario'],
];
const YNU = ['yes', 'no', 'unknown'];

/* Convierte las respuestas del formulario en el mismo borrador que produce la entrevista por voz (sin IA, sin costo). */
export function buildFromForm(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const st = (v) => (YNU.includes(v) ? v : 'not_asked');
  const rows = (v, build) => (Array.isArray(v) ? v : []).slice(0, MAX_RECORDS).map((r) => (r && typeof r === 'object' ? build(r) : null)).filter(Boolean);
  const doc = {};
  const coverage = {};
  const evidence = [];
  const from = 'Respondido por el paciente en el formulario previo a la cita';
  const docStatus = (s, n) => (n ? 'yes' : s === 'not_asked' || s === 'yes' ? 'pending' : s);

  const alertKeys = (Array.isArray(a.alerts) ? a.alerts : []).filter((k) => FORM_ALERT_OPTIONS.some((o) => o[0] === k));
  const alertOther = text(a.alerts_other, 160);
  doc.alerts = alertKeys.map((k) => FORM_ALERT_OPTIONS.find((o) => o[0] === k)[1]).concat(alertOther ? [alertOther] : []);
  coverage.alerts = doc.alerts.length ? 'yes' : st(a.alerts_status);
  doc.alerts_status = docStatus(coverage.alerts, doc.alerts.length);

  doc.allergy_records = rows(a.allergies, (r) => { const substance = text(r.substance, 120); return substance ? { substance, reaction: text(r.reaction, 160), severity: ['low', 'moderate', 'high'].includes(r.severity) ? r.severity : '' } : null; });
  coverage.allergies = doc.allergy_records.length ? 'yes' : st(a.allergies_status);
  doc.allergies_status = docStatus(coverage.allergies, doc.allergy_records.length);

  doc.condition_records = rows(a.conditions, (r) => { const name = text(r.name, 120); const since = text(r.since, 40); return name ? { name: since ? `${name} (desde ${since})` : name, diagnosed_at: '', status: '' } : null; });
  coverage.conditions = doc.condition_records.length ? 'yes' : st(a.conditions_status);
  doc.conditions_status = docStatus(coverage.conditions, doc.condition_records.length);

  doc.medication_records = rows(a.medications, (r) => { const name = text(r.name, 120); return name ? { name, dose: text(r.dose, 60), frequency: text(r.frequency, 80), changed_at: '' } : null; });
  coverage.medications = doc.medication_records.length ? 'yes' : st(a.medications_status);
  doc.medications_status = docStatus(coverage.medications, doc.medication_records.length);

  doc.surgery_records = rows(a.surgeries, (r) => { const procedure = text(r.procedure, 160); const when = text(r.when, 40); return procedure ? { procedure: when ? `${procedure} (${when})` : procedure, date: '' } : null; });
  coverage.surgeries = doc.surgery_records.length ? 'yes' : st(a.surgeries_status);
  doc.surgeries_status = docStatus(coverage.surgeries, doc.surgery_records.length);

  const reason = text(a.reason, 300);
  const painLevel = Number.isFinite(Number(a.pain_level)) && a.pain_level !== '' && a.pain_level != null ? Math.max(0, Math.min(10, Math.round(Number(a.pain_level)))) : null;
  const dentalParts = [];
  if (reason) dentalParts.push(`Motivo de consulta: ${reason}.`);
  if (a.pain === 'yes') dentalParts.push(`Refiere dolor${painLevel != null ? ` ${painLevel}/10` : ''}${text(a.pain_since, 60) ? ` (inicio: ${text(a.pain_since, 60)})` : ''}${text(a.pain_trigger, 120) ? `; empeora con ${text(a.pain_trigger, 120)}` : ''}.`);
  if (a.pain === 'no') dentalParts.push('Niega dolor actual.');
  if (a.anesthesia_problems === 'yes') dentalParts.push(`Refiere problemas previos con anestesia${text(a.anesthesia_detail, 160) ? `: ${text(a.anesthesia_detail, 160)}` : ''}.`);
  const lastVisit = text(a.last_visit, 60);
  if (lastVisit) dentalParts.push(`Última visita al dentista: ${lastVisit}.`);
  doc.dental_history = dentalParts.join(' ').slice(0, 1200);
  doc.last_dental_visit = '';
  coverage.dental = doc.dental_history ? 'yes' : 'not_asked';
  doc.dental_status = doc.dental_history ? 'yes' : 'pending';

  const habitKeys = (Array.isArray(a.habits) ? a.habits : []).filter((k) => FORM_HABIT_OPTIONS.some((o) => o[0] === k));
  const brushing = text(a.brushing, 40);
  const habitParts = habitKeys.map((k) => FORM_HABIT_OPTIONS.find((o) => o[0] === k)[1]);
  if (brushing) habitParts.push(`Cepillado: ${brushing}`);
  if (a.floss === 'yes') habitParts.push('Usa hilo dental');
  if (a.floss === 'no') habitParts.push('No usa hilo dental');
  doc.habits = habitParts.join('; ').slice(0, 600);
  coverage.habits = doc.habits ? 'yes' : a.habits_none ? 'no' : 'not_asked';
  doc.habits_status = doc.habits ? 'yes' : a.habits_none ? 'no' : 'pending';

  const ecName = text(a.emergency_name, 80), ecPhone = text(a.emergency_phone, 30).replace(/[^\d+ ()-]/g, '');
  doc.emergency_contact = [ecName, ecPhone].filter(Boolean).join(' · ');
  doc.notes = text(a.notes, 800);

  for (const [section, label] of [['allergies', 'Alergias'], ['alerts', 'Alertas médicas'], ['conditions', 'Condiciones'], ['medications', 'Medicamentos'], ['surgeries', 'Cirugías'], ['dental', 'Motivo y antecedentes dentales'], ['habits', 'Hábitos']]) {
    if (coverage[section] && coverage[section] !== 'not_asked') evidence.push({ section, label, quote: from, verified: true });
  }
  const followUps = [];
  if (doc.medication_records.some((m) => !m.dose)) followUps.push('Confirmar dosis de los medicamentos que refirió');
  if (doc.allergy_records.some((r) => !r.reaction)) followUps.push('Preguntar qué reacción tuvo en sus alergias');
  for (const k of HISTORY_SECTIONS) if (!coverage[k] || coverage[k] === 'not_asked') followUps.push(`Preguntar en consulta: ${SECTION_LABELS[k]}`);
  const urgent = a.pain === 'yes' && painLevel != null && painLevel >= 8;
  return { document: doc, evidence, needs_review: urgent ? ['Refiere dolor intenso (8/10 o más): valorar prioridad de la cita.'] : [], follow_ups: followUps.slice(0, 6), coverage, source: 'form' };
}
