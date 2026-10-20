// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/whatsapp-templates/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/auth.ts ──
const { requireUser } = (() => {
// Verificación obligatoria de sesión para Edge Functions privadas.
// Una publishable key identifica el proyecto, pero nunca autentica a una
// persona. Los flujos públicos deben usar funciones separadas con capacidades
// limitadas; nunca deben reutilizar este helper ni aceptar tenant_id del cliente.


// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY vienen inyectadas automáticamente
// en el entorno de toda Edge Function. `segment-teeth` usa nombres propios
// (SB_URL / SB_SERVICE_ROLE_KEY) porque el prefijo SUPABASE_ está reservado
// y no se puede definir a mano en Secrets, así que aceptamos ambos.
const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

interface AuthResult {
  user: { id: string; email?: string } | null;
  // La clínica real de quien llama -- NO uses user.id para topes de gasto,
  // RPCs ni escrituras con tenant_id, usa siempre este campo. Para el dueño
  // coincide con user.id (de siempre); para staff invitado (etapa 4, ver
  // camila_team.sql/camila_usuarios) es la clínica de quien lo invitó.
  // Antes de esto, claude/index.ts y segment-teeth/index.ts usaban user.id
  // directo: camila_consumir_diagnostico nunca encontraba la fila de un
  // staff en camila_tenants (rechazo 402, "no se encontró tu clínica"), y
  // segment-teeth guardaba la segmentación con un tenant_id que no
  // pertenecía a ningún caso real -- se perdía en silencio. null si no hay
  // sesión.
  tenantId: string | null;
  response: Response | null; // si no es null, devuélvela tal cual y no sigas
}

// Mismo patrón que ya usa el cliente (cargarTenantConfig() en
// simulacion.html, continuarConUsuario() en app.html): resuelve si quien
// llama es staff antes de asumir que su propio auth.uid() es el tenant.
async function resolverTenantId(userId: string): Promise<string> {
  const { data, error } = await admin
    .from('camila_usuarios')
    .select('tenant_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data?.tenant_id) return data.tenant_id;
  return userId;
}

async function requireUser(req: Request, cors: Record<string, string>): Promise<AuthResult> {
  const deny = (msg: string) => ({
    user: null,
    tenantId: null,
    response: new Response(JSON.stringify({ error: msg }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    }),
  });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return deny('No autenticado: falta el header Authorization.');

  // Esta llamada corre ANTES de cualquier otro código de la función (incluido
  // el fetchConTimeout de claude/index.ts) -- si se queda colgada sin límite
  // de tiempo, la plataforma mata el proceso a medio camino sin headers de
  // CORS ("CORS error" en el navegador) y ningún timeout más adelante en el
  // código llega siquiera a ejecutarse. Se le pone su propio límite (8s,
  // suficiente para una llamada a la API de Auth de Supabase en condiciones
  // normales) para que, si falla, devuelva una respuesta real con CORS en
  // vez de dejar que la plataforma la corte a ciegas.
  let seTardo = false;
  const timeout = new Promise<{ data: null }>((resolve) => {
    setTimeout(() => { seTardo = true; resolve({ data: null }); }, 8000);
  });
  const { data } = await Promise.race([
    admin.auth.getUser(jwt).catch(() => ({ data: null })),
    timeout,
  ]);
  if (data?.user) {
    try {
      const tenantId = await resolverTenantId(data.user.id);
      return { user: { id: data.user.id, email: data.user.email }, tenantId, response: null };
    } catch (error) {
      console.error('[auth] no se pudo resolver el tenant del usuario:', error instanceof Error ? error.message : 'error desconocido');
      return {
        user: null,
        tenantId: null,
        response: new Response(JSON.stringify({ error: 'No se pudo verificar el acceso a la clínica. Intenta de nuevo.' }), {
          status: 503,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }),
      };
    }
  }

  if (seTardo) return deny('No se pudo verificar la sesión a tiempo (Supabase Auth no respondió). Intenta de nuevo.');

  return deny('No autenticado: la sesión no es válida o ya expiró.');
}

return { requireUser };
})();

// ── _shared/lana-contract.mjs ──
const { SMYL_LANA_CONTRACT_VERSION, normalizeLanaPath, lanaContractHeaders } = (() => {
const SMYL_LANA_CONTRACT_VERSION = "1.5";

const ALLOWED_ROOTS = new Set([
  "attention",
  "channels",
  "context",
  "contract",
  "conversations",
  "inbox",
  "training",
]);

function normalizeLanaPath(input: any) {
  const raw = String(input || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    throw new Error("Ruta LANA no permitida.");
  }

  const rawPath = raw.split(/[?#]/, 1)[0];
  let rawSegments;
  try {
    rawSegments = rawPath.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("Ruta LANA no permitida.");
  }
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Ruta LANA no permitida.");
  }

  const parsed = new URL(raw, "https://lana.invalid");
  if (parsed.origin !== "https://lana.invalid" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("Ruta LANA no permitida.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (!segments.length) throw new Error("Ruta LANA no permitida.");
  if (!ALLOWED_ROOTS.has(segments[0])) throw new Error("Endpoint LANA no permitido.");

  return `${parsed.pathname}${parsed.search}`;
}

function lanaContractHeaders() {
  return { "X-SMYL-LANA-Contract-Version": SMYL_LANA_CONTRACT_VERSION };
}

return { SMYL_LANA_CONTRACT_VERSION, normalizeLanaPath, lanaContractHeaders };
})();

// ── _shared/lana-linked.ts ──
const { LANA_API_BASE, linkedLanaApiKey, lanaRequest, smylAdmin } = (() => {

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const ENCRYPTION_KEY = (Deno.env.get("SMYL_LANA_ENCRYPTION_KEY") || "").trim();
const LANA_API_BASE = "https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type LanaConfig = {
  api_key_ciphertext: string;
  api_key_iv: string;
  estado: string;
};

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function cryptoKey(): Promise<CryptoKey> {
  const raw = base64ToBytes(ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("SMYL_LANA_ENCRYPTION_KEY no configurada correctamente.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

async function linkedLanaApiKey(tenantId: string): Promise<string> {
  const { data, error } = await admin.from("camila_tenants").select("config").eq("id", tenantId).maybeSingle();
  if (error || !data) throw new Error("No se pudo consultar la configuración de la clínica.");
  const config = data.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {};
  const integrations = config.integraciones && typeof config.integraciones === "object"
    ? config.integraciones as Record<string, unknown> : {};
  const lana = integrations.lana && typeof integrations.lana === "object"
    ? integrations.lana as Partial<LanaConfig> : null;
  if (!lana?.api_key_ciphertext || !lana.api_key_iv || lana.estado !== "conectada") {
    throw new Error("LANA todavía no está conectada o requiere atención.");
  }
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(lana.api_key_iv) },
    await cryptoKey(),
    base64ToBytes(lana.api_key_ciphertext),
  );
  return new TextDecoder().decode(clear);
}

async function lanaRequest(
  tenantId: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const safePath = normalizeLanaPath(path);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await linkedLanaApiKey(tenantId)}`);
    headers.set("Accept", "application/json");
    if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    for (const [name, value] of Object.entries(lanaContractHeaders())) headers.set(name, value);
    const response = await fetch(`${LANA_API_BASE}${safePath}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}


return { LANA_API_BASE, linkedLanaApiKey, lanaRequest, smylAdmin: admin };
})();

// ── _shared/whatsapp-template-catalog.mjs ──
const { LANGUAGE, GROUPS, TEMPLATES, RULES, OPT_OUT_FOOTER, validate, fill, formatForLana } = (() => {
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
  function text(label: any, example: any) { return { label: label, source: 'text', example: example }; }
  function pick() { return Array.prototype.slice.call(arguments).map(function (key: any) { return V[key]; }); }
  function quick() { return Array.prototype.slice.call(arguments).map(function (label: any) { return { type: 'QUICK_REPLY', text: label }; }); }

  function utility(id: any, group: any, title: any, when: any, body: any, variables: any, extra: any) {
    return Object.assign({ id: id, group: group, category: 'UTILITY', title: title, when: when, header: '', body: body, footer: '', buttons: [], variables: variables, note: '' }, extra || {});
  }
  function marketing(id: any, title: any, when: any, body: any, variables: any, extra: any) {
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
      'Después de una buena experiencia. Agrega en tu panel de mensajería un botón con la liga a tu perfil de Google.',
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

  function variableNumbers(value: any) {
    var numbers = [];
    String(value || '').replace(/\{\{\s*(\d+)\s*\}\}/g, function (match: any, number: any) { numbers.push(Number(number)); return match; });
    return numbers;
  }

  // Sustituye {{n}} por el ejemplo; con wrap rodea el valor para resaltarlo.
  function fill(value: any, variables: any, wrap: any) {
    return String(value || '').replace(/\{\{\s*(\d+)\s*\}\}/g, function (match: any, number: any) {
      var variable = variables[Number(number) - 1];
      if (!variable) return match;
      return wrap ? wrap(variable.example) : variable.example;
    });
  }

  function validate(template: any) {
    var issues = [];
    var body = template.body || '';
    if (!/^[a-z0-9_]{1,60}$/.test(template.id || '')) issues.push('El nombre debe ir en minúsculas, números y guiones bajos.');
    if (body.length < 1 || body.length > 1024) issues.push('El cuerpo debe tener entre 1 y 1,024 caracteres.');
    if ((template.header || '').length > 60) issues.push('El encabezado supera 60 caracteres.');
    if ((template.footer || '').length > 60) issues.push('El pie supera 60 caracteres.');
    var numbers = variableNumbers(body);
    var unique = Array.from(new Set(numbers)).sort(function (a: any, b: any) { return a - b; });
    unique.forEach(function (number: any, index: any) { if (number !== index + 1) issues.push('Las variables deben numerarse en orden desde {{1}}.'); });
    if (numbers.length !== unique.length) issues.push('Una variable se repite.');
    if (unique.length !== (template.variables || []).length) issues.push('Falta o sobra un ejemplo de variable.');
    if (/^\s*\{\{/.test(body) || /\}\}\s*$/.test(body)) issues.push('El cuerpo no puede empezar ni terminar con una variable.');
    if (/\}\}\s{0,3}\{\{/.test(body)) issues.push('Dos variables no pueden ir juntas.');
    var wordsOutsideVariables = body.replace(/\{\{\s*\d+\s*\}\}/g, ' ').split(/\s+/).filter(Boolean).length;
    if (wordsOutsideVariables < unique.length * 4) issues.push('Hay demasiadas variables para la longitud del texto.');
    (template.variables || []).forEach(function (variable: any) {
      if (!variable.example || /[\n\t]| {4,}/.test(variable.example)) issues.push('El ejemplo de «' + variable.label + '» no es válido.');
    });
    if (/\{\{/.test(template.footer || '')) issues.push('El pie no puede tener variables.');
    var buttons = template.buttons || [];
    if (buttons.length > 3) issues.push('Máximo tres botones.');
    buttons.forEach(function (button: any) { if (button.type !== 'QUICK_REPLY' || !button.text || button.text.length > 25) issues.push('El botón «' + button.text + '» no es válido (máximo 25 caracteres).'); });
    if (template.category !== 'UTILITY' && template.category !== 'MARKETING') issues.push('La categoría debe ser Utilidad o Marketing.');
    if (template.category === 'UTILITY') {
      if (PROMO_WORDS.test([template.header, body, template.footer].join(' '))) issues.push('Una plantilla de Utilidad no puede tener lenguaje promocional.');
      if (/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(body)) issues.push('Una plantilla de Utilidad no debe llevar emojis.');
    }
    if (template.category === 'MARKETING' && !/\bBAJA\b/.test(template.footer || '') && !buttons.some(function (button: any) { return /no recibir|baja/i.test(button.text); })) issues.push('Marketing necesita una forma de darse de baja.');
    if (SENSITIVE_WORDS.test([template.header, body, template.footer].join(' '))) issues.push('Evita datos sensibles de salud o financieros.');
    if (/https?:\/\/|bit\.ly|tinyurl|wa\.me/i.test([template.header, body, template.footer].join(' '))) issues.push('No uses ligas en el texto.');
    return issues;
  }

  // Texto listo para pegar en el formulario de nueva plantilla de LANA.
  function formatForLana(template: any) {
    var lines = [
      'Nombre: ' + template.id,
      'Categoría: ' + (template.category === 'UTILITY' ? 'Utilidad (Utility)' : 'Marketing'),
      'Idioma: ' + LANGUAGE.label + ' (' + LANGUAGE.code + ')'
    ];
    if (template.header) lines.push('Encabezado: ' + template.header);
    lines.push('Cuerpo:', template.body);
    if (template.footer) lines.push('Pie de página: ' + template.footer);
    if (template.buttons.length) lines.push('Botones de respuesta rápida: ' + template.buttons.map(function (button: any) { return button.text; }).join(' | '));
    if (template.variables.length) lines.push('Ejemplos de variables: ' + template.variables.map(function (variable: any, index: any) { return '{{' + (index + 1) + '}} = ' + variable.example; }).join(' | '));
    return lines.join('\n');
  }

  return { LANGUAGE: LANGUAGE, GROUPS: GROUPS, TEMPLATES: TEMPLATES, RULES: RULES, OPT_OUT_FOOTER: OPT_OUT_FOOTER, validate: validate, fill: fill, formatForLana: formatForLana };
})();

const LANGUAGE = catalog.LANGUAGE;
const GROUPS = catalog.GROUPS;
const TEMPLATES = catalog.TEMPLATES;
const RULES = catalog.RULES;
const OPT_OUT_FOOTER = catalog.OPT_OUT_FOOTER;
const validate = catalog.validate;
const fill = catalog.fill;
const formatForLana = catalog.formatForLana;

return { LANGUAGE, GROUPS, TEMPLATES, RULES, OPT_OUT_FOOTER, validate, fill, formatForLana };
})();

// ── whatsapp-templates/index.ts ──
// Plantillas de WhatsApp desde SMYL: ver su estado en Meta y solicitarlas, todo a través de LANA.
//
// SMYL nunca habla con Meta ni guarda sus tokens: le pide a LANA (camila-api) que cree la plantilla
// con la cuenta de WhatsApp Business de la clínica y consulta cómo va. Por seguridad:
//  - Solo se pueden solicitar plantillas del catálogo revisado de SMYL, por su id. Nunca se acepta
//    texto libre del navegador, así que nadie puede mandar contenido arbitrario a Meta.
//  - Solo el propietario de la clínica puede solicitar (cada solicitud gasta cupo de revisión de
//    Meta y los rechazos repetidos pueden afectar la reputación de la cuenta).
//  - Cada plantilla se vuelve a validar con las reglas de Meta antes de enviarla.


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type Template = {
  id: string; category: string; body: string; footer: string;
  buttons: { type: string; text: string }[]; variables: { example: string }[];
};

async function isOwner(user: { id: string }, tenantId: string): Promise<boolean> {
  if (user.id === tenantId) return true;
  const { data } = await smylAdmin.from("camila_usuarios").select("rol,activo").eq("id", user.id).eq("tenant_id", tenantId).maybeSingle();
  return Boolean(data && data.activo !== false && data.rol === "dueño");
}

async function canRead(jwt: string, tenantId: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
  if (!anon) return false;
  const client = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data, error } = await client.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: "messages.read" });
  return !error && data === true;
}

// LANA exige saber quién consulta, incluso en lecturas.
function actorHeaders(user: { id: string; email?: string }, owner: boolean, idempotencyKey?: string): Headers {
  const name = text(user.email, 160).split("@")[0] || "Miembro del equipo";
  const headers = new Headers({
    "X-SMYL-Actor-Id": user.id,
    "X-SMYL-Actor-Role": owner ? "owner" : "staff",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(name),
  });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return headers;
}

const REQUEST_ERRORS: Record<string, string> = {
  owner_required: "Solo el propietario de la clínica puede solicitar plantillas.",
  whatsapp_not_connected: "Conecta WhatsApp en tu panel de mensajería antes de solicitar plantillas.",
  template_rate_limited: "Ya se enviaron varias plantillas en la última hora. Espera un poco y vuelve a intentar.",
  template_name_taken: "Meta ya tiene una plantilla con ese nombre; si fue rechazada, hay que solicitar una versión nueva.",
  meta_unreachable: "Meta no respondió a tiempo. Intenta de nuevo en unos minutos.",
  meta_unavailable: "El servicio de mensajería no puede contactar a Meta en este momento.",
  template_in_progress: "Esta plantilla ya se está enviando a Meta. Espera un momento y actualiza.",
  template_not_recorded: "La plantilla se envió a Meta pero el servicio de mensajería no pudo registrarla. Vuelve a intentar para completarla.",
  template_lookup_failed: "El servicio de mensajería no pudo revisar la plantilla. Intenta de nuevo.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  const tenantId = auth.tenantId;
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = text(body.action, 30);

  const owner = await isOwner(auth.user, tenantId);
  if (!owner && !await canRead(jwt, tenantId)) return json(403, { error: "Tu rol no permite consultar las plantillas.", code: "permission_denied" });

  if (action === "list") {
    try {
      const remote = await lanaRequest(tenantId, "/inbox/whatsapp/templates?status=all", { method: "GET", headers: actorHeaders(auth.user, owner) }, 15000);
      if (!remote.response.ok) return json(502, { error: text(remote.body.error, 300) || "El servicio de mensajería no devolvió las plantillas.", code: "lana_error" });
      const list = Array.isArray(remote.body.templates) ? remote.body.templates as Record<string, unknown>[] : [];
      return json(200, {
        can_request: owner,
        templates: list.map((item) => ({
          name: text(item.name, 200), language: text(item.language, 20), category: text(item.category, 20),
          status: text(item.status, 30), rejection_reason: text(item.rejection_reason, 500) || null,
        })).filter((item) => item.name),
      });
    } catch (error) {
      return json(502, { error: error instanceof Error && /LANA todavía no está conectada/.test(error.message) ? "El servicio de mensajería todavía no está conectado." : "No pudimos consultar el servicio de mensajería.", code: "lana_unreachable" });
    }
  }

  if (action === "request") {
    if (!owner) return json(403, { error: REQUEST_ERRORS.owner_required, code: "owner_required" });
    const id = text(body.template_id, 80);
    const template = (TEMPLATES as Template[]).find((item) => item.id === id);
    if (!template) return json(400, { error: "Esa plantilla no está en el catálogo de SMYL.", code: "unknown_template" });
    const issues = validate(template);
    if (issues.length) return json(500, { error: "La plantilla del catálogo no cumple las reglas de Meta.", code: "invalid_catalog_template" });
    try {
      const remote = await lanaRequest(tenantId, "/inbox/whatsapp/templates", {
        method: "POST",
        headers: actorHeaders(auth.user, true, crypto.randomUUID()),
        body: JSON.stringify({
          name: template.id, category: template.category, language: LANGUAGE.code, body: template.body,
          footer: template.footer || undefined, buttons: template.buttons.length ? template.buttons : undefined,
          examples: template.variables.map((variable) => variable.example),
        }),
      }, 25000);
      if (remote.response.ok) {
        const item = (remote.body.template || {}) as Record<string, unknown>;
        return json(200, { ok: true, existing: remote.body.existing === true, status: text(item.status, 30) || "PENDING" });
      }
      const code = text(remote.body.code, 60);
      const message = REQUEST_ERRORS[code] || text(remote.body.error, 400) || "El servicio de mensajería no pudo enviar la plantilla.";
      return json(remote.response.status >= 400 && remote.response.status < 500 ? remote.response.status : 502, { error: message, code: code || "lana_error" });
    } catch (error) {
      return json(502, { error: error instanceof Error && /LANA todavía no está conectada/.test(error.message) ? "El servicio de mensajería todavía no está conectado." : "No pudimos contactar al servicio de mensajería.", code: "lana_unreachable" });
    }
  }

  return json(400, { error: "Acción no reconocida." });
});
