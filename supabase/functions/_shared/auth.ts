// Verificación de sesión para las Edge Functions que gastan dinero real
// (Anthropic, Gemini, Replicate).
//
// Preferentemente hay que mandar el JWT de una sesión real de Supabase Auth
// (el `access_token` que devuelve signInWithPassword). Por pedido explícito
// (de nuevo -- ya se había hecho y luego revertido una vez) se vuelve a
// aceptar también la publishable key sin sesión -- ACEPTAR ESTO SIGNIFICA
// QUE CUALQUIERA CON LA URL PUBLICADA PUEDE GASTAR LOS CRÉDITOS DE
// ANTHROPIC/GEMINI/REPLICATE DE ESTE PROYECTO, sin pasar por el login del
// cliente (un `curl` a pelo funciona igual). Si se quiere volver a cerrar,
// basta con que el fallback de "sin sesión válida" de abajo rechace (deny)
// en vez de dejar pasar como anónimo.

import { createClient } from 'npm:@supabase/supabase-js@2';

// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY vienen inyectadas automáticamente
// en el entorno de toda Edge Function. `segment-teeth` usa nombres propios
// (SB_URL / SB_SERVICE_ROLE_KEY) porque el prefijo SUPABASE_ está reservado
// y no se puede definir a mano en Secrets, así que aceptamos ambos.
const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

export interface AuthResult {
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
  try {
    const { data, error } = await admin
      .from('camila_usuarios')
      .select('tenant_id')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data?.tenant_id) return data.tenant_id;
  } catch (_e) {
    // Si camila_usuarios no responde, se cae al valor de siempre (dueño) --
    // más seguro que bloquear la llamada por un problema ajeno al usuario.
  }
  return userId;
}

export async function requireUser(req: Request, cors: Record<string, string>): Promise<AuthResult> {
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
    const tenantId = await resolverTenantId(data.user.id);
    return { user: { id: data.user.id, email: data.user.email }, tenantId, response: null };
  }

  if (seTardo) return deny('No se pudo verificar la sesión a tiempo (Supabase Auth no respondió). Intenta de nuevo.');

  // El token no resolvió a una sesión real (p. ej. es la publishable key, o
  // una key de otro proyecto) -- se deja pasar como acceso anónimo (user:
  // null) en vez de rechazar. El caller debe manejar ese caso (p. ej. tomar
  // tenantId del body en vez de la sesión, como hace segment-teeth).
  return { user: null, tenantId: null, response: null };
}
