// smyl-asistente-autollenado: «Capacitar IA» se prellena con los datos de la clínica, sin inventar y sin pisar lo que la persona escribió.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { compose, MAX, clip } = require("../smyl-training-autofill.js");
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const CTX = {
  tenant: { nombre: "Dental Ruiz", email: "hola@ruiz.mx", config: { ciudad: "Guadalajara", especialidad: "Odontología general", pago_en_linea: true, tel: "33 0000 1111" } },
  branches: [{ id: "b1", name: "Centro", phone: "33 1234 5678", whatsapp_phone: "+52 33 5555 0000", arrival_notes: "Entrada por la calle lateral" }, { id: "b2", name: "Norte", phone: "33 9999 8888" }],
  services: [{ name: "Valoración inicial", reference_price: 500, specialty: "Odontología general", patient_name: "Valoración" }, { name: "Limpieza dental", reference_price: 900 }, { name: "Ortodoncia", reference_price: 0 }],
  professionals: [{ display_name: "Dra. Ana", specialty: "Ortodoncia" }, { display_name: "Dr. Beto" }],
  profiles: [{ languages: ["Español", "Inglés"], treatment_focus: ["Estética dental"] }],
  channels: [{ channel: "whatsapp", connected: true, display_phone_number: "+52 33 9999 0000" }, { channel: "instagram", connected: true, display_name: "dentalruiz" }, { channel: "messenger", connected: false, display_name: "no conectado" }],
  scheduling: { level: "request", min_lead_hours: 2, horizon_days: 14 }, noShowFee: 300, reminders: { enabled: true }, fiscalProfile: true,
  locationText: "Centro: Av. Juárez 120, Guadalajara · Norte: Calle 5, Zapopan", hoursText: "Centro: Lun-Vie 9:00-18:00",
};

test("con los datos de la clínica se propone texto REAL para identidad, clínica, contacto, agenda, cobros, facturación y recordatorios", () => {
  const { fields, faq } = compose(CTX);
  assert.equal(fields.assistant_name.text, "Asistente de Dental Ruiz");
  assert.match(fields.clinic_description.text, /Dental Ruiz es una clínica dental en Guadalajara, con enfoque en odontología general, ortodoncia y estética dental/);
  assert.match(fields.clinic_description.text, /Atiende en 2 sucursales/);
  assert.match(fields.clinic_description.text, /Ofrece servicios como Valoración, Limpieza dental y Ortodoncia/);
  assert.equal(fields.specialties.text, "Odontología general, Ortodoncia, Estética dental");
  assert.equal(fields.languages.text, "Español, Inglés");
  assert.equal(fields.contact_channels.text, "WhatsApp: +52 33 9999 0000, +52 33 5555 0000 · Teléfono: 33 1234 5678, 33 9999 8888, 33 0000 1111 · Instagram: dentalruiz · Correo: hola@ruiz.mx");
  assert.ok(!fields.contact_channels.text.includes("no conectado"), "un canal no conectado no se anuncia");
  assert.equal(fields.access_info.text, "Centro: Entrada por la calle lateral");
  assert.match(fields.scheduling_rules.text, /al menos 2 horas de anticipación y hasta 14 días/);
  assert.match(fields.appointment_policy.text, /dejar una solicitud de cita; la clínica la revisa y la confirma\. Ninguna cita se confirma sola/);
  assert.match(fields.cancellation_policy.text, /cargo por inasistencia/);
  assert.match(fields.pricing_policy.text, /desde \$X, sujeto a valoración/);
  assert.match(fields.payment_policy.text, /pago en línea con un enlace que envía el equipo/);
  assert.match(fields.invoice_policy.text, /puede emitir factura \(CFDI\)/);
  assert.match(fields.followup_policy.text, /recordatorios de cita por WhatsApp/);
  assert.match(fields.intake_questions.text, /sucursal/);
  assert.match(fields.emergency_policy.text, /33 1234 5678|9999 0000|5555 0000/);
  // Origen de cada dato: «dato» (de la clínica) o «sugerido» (texto neutral que se revisa).
  assert.equal(fields.clinic_description.kind, "dato"); assert.equal(fields.handoff_rules.kind, "sugerido");
  assert.ok(faq.length >= 5 && faq.length <= 8);
  assert.deepEqual(faq.slice(0, 2).map((f) => f.q), ["¿Dónde están ubicados?", "¿Cuál es el horario de atención?"]);
  assert.ok(faq.some((f) => f.q === "¿Emiten factura?") && faq.some((f) => f.q === "¿Cómo puedo pagar?"));
});

test("NO inventa: sin dato no hay campo (promociones, seguros, tiempos de respuesta, tono), y sin configuración no afirma cobros, facturas ni recordatorios", () => {
  const { fields, faq } = compose({ tenant: { nombre: "Clínica X" }, branches: [], services: [], noShowFee: 0 });
  for (const campo of ["approved_promotions", "insurance_policy", "human_response_policy", "tone", "autonomy_level", "languages", "specialties", "contact_channels", "access_info", "scheduling_rules", "invoice_policy", "followup_policy"]) {
    assert.equal(campo in fields, false, `${campo} no tiene fuente: debe quedar vacío`);
  }
  assert.doesNotMatch(fields.payment_policy.text, /pago en línea/);
  assert.doesNotMatch(fields.cancellation_policy.text, /cargo/);
  assert.match(fields.pricing_policy.text, /No compartas precios/);
  assert.equal(fields.payment_policy.kind, "sugerido");
  assert.equal(faq.some((f) => /factura|pagar|cuesta|ubicados|horario|servicios/i.test(f.q)), false, "sin datos no hay preguntas derivadas de datos");
  // Sin ningún dato de la clínica solo quedan textos neutrales que no afirman nada específico.
  const vacio = compose({});
  assert.ok(!("assistant_name" in vacio.fields) && !("clinic_description" in vacio.fields));
  for (const f of Object.values(vacio.fields)) assert.equal(f.kind, "sugerido");
});

test("cada texto respeta el maxlength de su campo (también con datos enormes), sin cortar a media palabra y sin marcadores", () => {
  const largo = "palabra ".repeat(400).trim();
  const { fields, faq } = compose({ ...CTX, tenant: { nombre: "N".repeat(200), config: { ciudad: largo } }, services: Array.from({ length: 40 }, (_, i) => ({ name: `Servicio ${i} ${largo}`, reference_price: 100 })),
    branches: [{ id: "b", name: "S", arrival_notes: largo, phone: largo }], locationText: largo, hoursText: largo });
  for (const [campo, f] of Object.entries(fields)) assert.ok(f.text.length <= MAX[campo], `${campo}: ${f.text.length} > ${MAX[campo]}`);
  for (const f of faq) { assert.ok(f.q.length <= MAX.faq_question && f.a.length <= MAX.faq_answer); }
  assert.equal(clip("uno dos tres cuatro", 10).endsWith("…"), true);
  assert.equal(clip("corto", 50), "corto");
  const todo = JSON.stringify([fields, faq]);
  assert.ok(!todo.includes("|||"), "los textos propuestos no llevan marcadores de control");
  assert.ok(!/LANA|OpenPay|Facturapi|Meta\b/.test(todo), "sin nombres de proveedor en los textos");
});

test("valores raros no rompen: nulos, tipos incorrectos y precios no numéricos", () => {
  assert.doesNotThrow(() => compose(null));
  assert.doesNotThrow(() => compose({ branches: "x", services: [null, {}, { name: 5 }], professionals: [null], profiles: [{ languages: "es" }], channels: [null], scheduling: "x", noShowFee: "abc", tenant: { config: "x" } }));
  const r = compose({ tenant: { nombre: "A", config: { ciudad: null } }, services: [{ name: "X", reference_price: "no" }], noShowFee: NaN });
  assert.match(r.fields.pricing_policy.text, /No compartas precios/);
});

test("la pantalla: chips «Autollenar con mis datos» y «Rehacer desde mi clínica», lectura con tolerancia a columnas ausentes y sin pisar lo escrito", () => {
  const conn = read("smyl-connections.js");
  assert.match(conn, /data-autofill disabled/);
  assert.match(conn, /data-autofill-redo disabled/);
  const fn = conn.slice(conn.indexOf("async function loadAutofillContext"), conn.indexOf("// Barra fija del asistente"));
  // Cada lectura es independiente y tolerante: una tabla o columna ausente no tumba el autollenado.
  assert.match(fn, /async function safe\(promise\) \{ try \{ var r = await promise; if \(r && r\.error\) fallidas \+= 1; return r && !r\.error \? \(r\.data \|\| null\) : null; \} catch \(_\) \{ fallidas \+= 1; return null; \} \}/);
  for (const t of ["camila_tenants", "smyl_branches", "smyl_services", "smyl_professionals", "smyl_professional_profiles", "smyl_ai_scheduling_settings", "smyl_finance_settings", "smyl_reminder_settings", "smyl_issuer_fiscal_profiles"]) assert.ok(fn.includes(`from('${t}')`), t);
  // No pisa: solo llena campos vacíos, con el valor por defecto o aún idéntico a lo autollenado antes; «Rehacer» pide confirmación.
  assert.match(fn, /var libre = !current \|\| current === AUTOFILL_DEFAULTS\[name\] \|\| \(seed && current === seed\.text\);/);
  assert.match(fn, /if \(!libre && !options\.overwrite\) \{ kept \+= 1; return; \}/);
  assert.match(conn, /window\.confirm\('Esto vuelve a llenar los campos autollenables/);
  assert.match(fn, /var base = options\.overwrite \? rows\.filter/, "las preguntas frecuentes propias se conservan");
  assert.match(fn, /markTrainingDirty\(\); updateTrainingSteps\(\);/, "queda como borrador y se autoguarda");
  assert.match(fn, /state\.autofillBusy/);
  // Arranque automático solo con la capacitación vacía y una vez por sesión.
  assert.match(conn, /if \(state\.trainingLoaded && blankForm && !state\.autofillTried && trainingIsBlank\(blankForm\)\) \{ state\.autofillTried = true; await runAutofill\(\{ initial: true \}\); \}/);
  // Los chips solo se activan con permiso y conexión.
  assert.match(conn, /var listo = Boolean\(state\.status && state\.status\.connected && state\.status\.can_manage && state\.trainingLoaded && !state\.autofillBusy\);/);
  assert.ok(!/localStorage|sessionStorage/.test(conn), "nada en el navegador");
});

test("estilos, carga del script y copia móvil con versiones coherentes", () => {
  assert.match(read("smyl-navigation.css"), /\.assistant-autofill-badge\.is-suggested/);
  for (const base of ["", "mobile/www/"]) {
    const app = read(`${base}app.html`);
    assert.ok(app.indexOf("smyl-training-autofill.js?v=1") > 0 && app.indexOf("smyl-training-autofill.js?v=1") < app.indexOf("smyl-connections.js?v=33"), `${base}app.html: el módulo carga antes que smyl-connections.js`);
    assert.match(read(`${base}sw.js`), /\/camila\/smyl-training-autofill\.js\?v=1/);
  }
  for (const f of ["smyl-training-autofill.js", "smyl-connections.js", "smyl-navigation.css"]) assert.equal(read(`mobile/www/${f}`), read(f), f);
  assert.match(read("mobile/scripts/sync-web.js"), /smyl-training-autofill\.js/);
});

test("sin «Rehacer» las preguntas frecuentes existentes (aunque vengan de un autollenado y estén editadas) nunca se reemplazan, solo se agregan las que faltan", () => {
  const js = read("smyl-connections.js");
  assert.match(js, /var base = options\.overwrite \? rows\.filter\(function \(r\) \{ return !\/\^auto-faq-\/\.test\(r\.id \|\| ''\); \}\) : rows;/);
  assert.doesNotMatch(js, /rows\.every\(function \(r\) \{ return \/\^auto-faq-/);
});

test("el cargo por inasistencia se menciona sin cifra y se avisa cuando una fuente de datos no se pudo leer", () => {
  const js = read("smyl-connections.js");
  const af = read("smyl-training-autofill.js");
  assert.doesNotMatch(af, /cargo por inasistencia de '/);
  assert.match(js, /failedSources: fallidas/);
  assert.match(js, /no pudimos leer/);
});
