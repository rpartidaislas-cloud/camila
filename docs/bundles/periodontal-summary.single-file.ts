// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/periodontal-summary/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/auth-membership.ts ──
const { decidirMembresia } = (() => {
// Decisión pura (sin red) sobre la membresía de quien llama a una Edge Function privada.
// Vive aparte de auth.ts para poder probarla sin Deno ni Supabase.
//
// `row` es la fila de camila_usuarios de la persona (o null si no tiene: el dueño de siempre
// es una cuenta cuyo id = tenant_id y puede no tener fila). Si la fila existe pero está
// desactivada, la persona ya no pertenece al equipo: no se le resuelve ninguna clínica
// (antes se ignoraba `activo` y un staff dado de baja seguía usando las funciones con el
// service role).
interface FilaMembresia {
  tenant_id?: string | null;
  activo?: boolean | null;
}

type DecisionMembresia = { tenantId: string } | { inactivo: true };

function decidirMembresia(row: FilaMembresia | null | undefined, userId: string): DecisionMembresia {
  if (row && row.activo === false) return { inactivo: true };
  if (row?.tenant_id) return { tenantId: row.tenant_id };
  return { tenantId: userId };
}

return { decidirMembresia };
})();

// ── _shared/auth.ts ──
const { requireUser, requirePermission } = (() => {
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
// Si la persona tiene fila en camila_usuarios pero está desactivada, ya no pertenece al equipo y no
// se le resuelve ninguna clínica (decidirMembresia, _shared/auth-membership.ts).
async function resolverMembresia(userId: string): Promise<DecisionMembresia> {
  const { data, error } = await admin
    .from('camila_usuarios')
    .select('tenant_id, activo')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return decidirMembresia(data, userId);
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
      const membresia = await resolverMembresia(data.user.id);
      if ('inactivo' in membresia) {
        return {
          user: null,
          tenantId: null,
          response: new Response(JSON.stringify({ error: 'Tu acceso a esta clínica está desactivado. Pide al dueño que lo reactive.' }), {
            status: 403,
            headers: { ...cors, 'Content-Type': 'application/json' },
          }),
        };
      }
      return { user: { id: data.user.id, email: data.user.email }, tenantId: membresia.tenantId, response: null };
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

// Exige un permiso del modelo de roles de SMYL (smyl_member_roles / smyl_role_permissions) además de
// la sesión. El dueño (user.id === tenantId) siempre pasa; el staff solo si su rol activo tiene el
// permiso. Falla cerrado: si la consulta falla, se niega. Devuelve una Response para regresar tal
// cual, o null si se puede continuar.
async function requirePermission(
  auth: AuthResult,
  cors: Record<string, string>,
  permission: string,
): Promise<Response | null> {
  const reply = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (!auth.user || !auth.tenantId) return reply(401, 'Necesitas iniciar sesión.');
  if (auth.user.id === auth.tenantId) return null;
  const { data, error } = await admin.rpc('smyl_actor_has_permission_explicit', {
    p_actor: auth.user.id,
    p_tenant: auth.tenantId,
    p_permission: permission,
  });
  if (error) {
    console.error('[auth] no se pudo verificar el permiso:', error.message);
    return reply(503, 'No se pudo verificar tu permiso. Intenta de nuevo.');
  }
  if (data !== true) return reply(403, 'Tu rol no tiene permiso para esta acción.');
  return null;
}

return { requireUser, requirePermission };
})();

// ── _shared/cors.ts ──
const { makeCors, corsPublic, corsHeaders } = (() => {
// Orígenes autorizados para funciones privadas (autenticadas).
// Las funciones públicas (webhooks, portales de paciente) usan corsPublic o "*" directamente.
const ALLOWED_ORIGINS = new Set([
  'https://app.smyldesign.ai',
  'https://rpartidaislas-cloud.github.io',
]);

// Para funciones privadas: refleja el origen si está en la lista; si no, bloquea con el origen
// principal. Siempre incluye Vary:Origin para que las cachés no reutilicen respuestas entre orígenes.
function makeCors(req: Request, methods = 'POST, OPTIONS'): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://app.smyldesign.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': methods,
    'Vary': 'Origin',
  };
}

// Para endpoints públicos que legítimamente necesitan "*" (portales de paciente, formularios públicos).
const corsPublic: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Alias de compatibilidad hacia atrás (stripe-checkout, stripe-portal).
const corsHeaders = corsPublic;

return { makeCors, corsPublic, corsHeaders };
})();

// ── _shared/privacy-core.mjs ──
const { MENSAJE_IA_NO_PERMITIDA, MENSAJE_IA_NO_VERIFICABLE, decidirIA } = (() => {
// Permiso del paciente para que sus datos pasen por herramientas de IA de proveedores externos (finalidad 'ai_processing').
// Regla: SOLO se bloquea cuando el paciente lo negó o lo retiró ('revoked'). Un paciente sin decisión registrada ('unknown',
// el caso de todos los anteriores a esta función) sigue como hasta ahora, para no detener la clínica el día que se publique.
// Si no se puede comprobar (error de base de datos) se bloquea: ante la duda no se manda nada a un tercero.
const MENSAJE_IA_NO_PERMITIDA = 'Este paciente no autorizó el uso de inteligencia artificial con sus datos. Captura o revisa esto manualmente.';
const MENSAJE_IA_NO_VERIFICABLE = 'No se pudo comprobar el permiso de IA del paciente. Inténtalo de nuevo en un momento.';

/** Convierte la respuesta de smyl_patient_privacy_state en una decisión: 'allowed' | 'revoked' | 'unavailable'. */
function decidirIA(result: any) {
  if (!result || result.error) return 'unavailable';
  const state = result.data;
  if (state === 'revoked') return 'revoked';
  if (state === 'granted' || state === 'unknown') return 'allowed';
  return 'unavailable';
}

return { MENSAJE_IA_NO_PERMITIDA, MENSAJE_IA_NO_VERIFICABLE, decidirIA };
})();

// ── _shared/privacy.ts ──
const { permisoIA, respuestaIAnegada } = (() => {
// Candado de privacidad para las funciones que mandan datos de un paciente a una IA externa. La regla vive en privacy-core.mjs.

type PermisoIA = 'allowed' | 'revoked' | 'unavailable';

// deno-lint-ignore no-explicit-any
async function permisoIA(admin: any, tenantId: string, patientId: string): Promise<PermisoIA> {
  try {
    const result = await admin.rpc('smyl_patient_privacy_state', { p_tenant: tenantId, p_patient: patientId, p_purpose: 'ai_processing' });
    return decidirIA(result);
  } catch { return 'unavailable'; }
}

/** Respuesta lista para devolver cuando NO se puede usar IA con este paciente; null si se puede continuar. */
function respuestaIAnegada(permiso: PermisoIA): { status: number; body: { error: string; code: string } } | null {
  if (permiso === 'allowed') return null;
  if (permiso === 'revoked') return { status: 403, body: { error: MENSAJE_IA_NO_PERMITIDA, code: 'patient_ai_not_allowed' } };
  return { status: 503, body: { error: MENSAJE_IA_NO_VERIFICABLE, code: 'patient_ai_unverifiable' } };
}

return { permisoIA, respuestaIAnegada };
})();

// ── _shared/contract.mjs ──
const { providerFacts, selectedFacts } = (() => {
// A closed vocabulary prevents provider input and output from containing patient identity or clinical prose.
const sites = ['MB', 'B', 'DB', 'ML', 'L', 'DL'];
const sources = ['clinical', 'photo', 'radiograph'];
const fields = ['depth', 'margin', 'bleeding'];
const numberIn = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;
const validField = (field, v) => field === 'bleeding' ? typeof v === 'boolean' : numberIn(v, field === 'margin' ? -20 : 0, 20);

function providerFacts(input: any) {
  if (!Array.isArray(input) || !input.length || input.length > 15) return null;
  const result = [], keys = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    let fact;
    if (sources.includes(raw.kind)) {
      if (!numberIn(raw.count, 1, 999)) return null;
      fact = { kind: raw.kind, count: raw.count };
    } else {
      if (!['site', 'change'].includes(raw.kind) || !sites.includes(raw.site)) return null;
      fact = { kind: raw.kind, site: raw.site };
      for (const field of fields) {
        if (!Object.hasOwn(raw, field)) continue;
        if (!validField(field, raw[field])) return null;
        fact[field] = raw[field];
        if (raw.kind === 'change') {
          const prev = 'previous_' + field;
          if (!validField(field, raw[prev]) || raw[prev] === raw[field]) return null;
          fact[prev] = raw[prev];
        }
      }
      if (!fields.some(field => Object.hasOwn(fact, field))) return null;
    }
    const key = fact.kind + (fact.site || '');
    if (keys.has(key) || Object.keys(raw).length !== Object.keys(fact).length) return null;
    keys.add(key);
    result.push(fact);
  }
  for (const delta of result.filter(f => f.kind === 'change')) {
    const now = result.find(f => f.kind === 'site' && f.site === delta.site);
    if (!now || !fields.every(field => !Object.hasOwn(delta, field) || now[field] === delta[field])) return null;
  }
  return result.some(f => f.kind === 'site') ? result : null;
}

function selectedFacts(response: any, facts: any) {
  const raw = response.output_text || response.output?.flatMap(block => block.content || []).find(item => item.type === 'output_text')?.text;
  if (typeof raw !== 'string') return null;
  let indices;
  try { indices = JSON.parse(raw).indices; } catch { return null; }
  if (!Array.isArray(indices) || !indices.length || indices.length > facts.length ||
      indices.some(n => !numberIn(n, 0, facts.length - 1)) || new Set(indices).size !== indices.length) return null;
  // Preserve clinician-confirmed sources and longitudinal changes even if the model overlooked them.
  const order = new Set(indices);
  if (!indices.some(n => facts[n].kind === 'site')) order.add(facts.findIndex(f => f.kind === 'site'));
  facts.forEach((f, n) => { if (f.kind !== 'site') order.add(n); });
  return [...order];
}

return { providerFacts, selectedFacts };
})();

// ── periodontal-summary/index.ts ──
const admin = createClient(Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '');
const model = Deno.env.get('OPENAI_MILA_REWRITE_MODEL') || Deno.env.get('OPENAI_MILA_NOTE_MODEL') || 'gpt-5-mini';
const enforce = Deno.env.get('SMYL_CONSUMABLES_ENFORCED') === 'true';
const uid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const source = 'periodontal_summary';

Deno.serve(async (req: Request) => {
  const cors = makeCors(req);
  const json = (status: number, body: object) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
  });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });
  try {
    const auth = await requireUser(req, cors);
    if (auth.response) return auth.response;
    if (!auth.user || !auth.tenantId) return json(401, { error: 'Inicia sesión para usar MILA.' });
    const denied = await requirePermission(auth, cors, 'clinical.write');
    if (denied) return denied;
    if (Number(req.headers.get('Content-Length')) > 8192) return json(413, { error: 'Solicitud demasiado extensa.' });
    const raw = await req.text();
    if (raw.length > 8192) return json(413, { error: 'Solicitud demasiado extensa.' });
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'Solicitud no válida.' }); }
    const facts = providerFacts(body?.facts);
    if (!facts || typeof body?.patientId !== 'string' || !uid.test(body.patientId)) return json(400, { error: 'Comprueba los datos de la pieza.' });
    const access = await admin.rpc('smyl_actor_can_access_patient_explicit', {
      p_actor: auth.user.id, p_tenant: auth.tenantId, p_patient: body.patientId, p_domain: 'clinical'
    });
    if (access.error) return json(503, { error: 'No se pudo comprobar el acceso al paciente.' });
    if (access.data !== true) return json(403, { error: 'Tu rol no tiene acceso a este paciente.' });
    const negada = respuestaIAnegada(await permisoIA(admin, auth.tenantId, body.patientId));
    if (negada) return json(negada.status, negada.body);
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) return json(503, { error: 'MILA no está configurada. Puedes redactar el resumen manualmente.' });
    if (enforce) {
      const wallet = await admin.from('smyl_wallets').select('balance_units').eq('tenant_id', auth.tenantId).eq('resource', 'ai_credits').maybeSingle();
      if (wallet.error) return json(503, { error: 'No se pudo comprobar el saldo de IA.' });
      if (!wallet.data || Number(wallet.data.balance_units) < 1) return json(402, { error: 'Se necesita un crédito de IA. Puedes redactar el resumen manualmente.' });
    }
    const completion = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(35_000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, store: false, max_output_tokens: 800,
        instructions: 'Selecciona los índices (desde cero) para ordenar un resumen breve de sondaje de UNA pieza. Incluye sitios medidos representativos, los cambios medidos respecto al examen anterior y cada fuente clínica corroborada. Agrupa lo relacionado. No diagnostiques, puntúes riesgo ni completes valores ausentes. Devuelve solo índices únicos.',
        input: JSON.stringify(facts),
        text: { format: { type: 'json_schema', name: 'periodontal_order', strict: true, schema: {
          type: 'object', additionalProperties: false, required: ['indices'], properties: { indices: { type: 'array', items: { type: 'integer' } } }
        } } }
      })
    });
    if (!completion.ok) return json(502, { error: 'MILA no pudo preparar el resumen. Puedes volver a intentarlo.' });
    const result = await completion.json();
    const indices = selectedFacts(result, facts);
    if (!indices) return json(422, { error: 'La propuesta quedó incompleta. Puedes redactar el resumen o reintentar.' });
    const metering = await admin.rpc('smyl_consume', {
      p_tenant_id: auth.tenantId, p_resource: 'ai_credits', p_quantity_units: 1,
      p_idempotency_key: source + ':' + (result.id || crypto.randomUUID()), p_source_type: source,
      p_source_id: null, p_provider: 'openai', p_provider_model: model, p_enforce: enforce,
      p_metadata: { input_tokens: Number(result.usage?.input_tokens) || 0, output_tokens: Number(result.usage?.output_tokens) || 0 }
    });
    const receipt = Array.isArray(metering.data) ? metering.data[0] : metering.data;
    if (metering.error || !receipt) return json(503, { error: 'No se pudo verificar el consumo de MILA.' });
    if (!receipt.accepted) return json(402, { error: 'El crédito ya no está disponible. Puedes redactar el resumen manualmente.' });
    return json(200, { indices });
  } catch {
    return json(503, { error: 'MILA no está disponible en este momento. Puedes continuar la captura manual.' });
  }
});
