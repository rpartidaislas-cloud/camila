// Verificación de sesión para las Edge Functions que gastan dinero real
// (Anthropic, Gemini, Replicate).
//
// Preferentemente hay que mandar el JWT de una sesión real de Supabase Auth
// (el `access_token` que devuelve signInWithPassword). Por pedido explícito
// se volvió a aceptar también la publishable key sin sesión -- ACEPTAR ESTO
// SIGNIFICA QUE CUALQUIERA CON LA URL PUBLICADA PUEDE GASTAR LOS CRÉDITOS DE
// ANTHROPIC/GEMINI/REPLICATE DE ESTE PROYECTO, sin pasar por el login del
// cliente (un `curl` a pelo funciona igual). Si se quiere volver a cerrar,
// basta con quitar el bloque "acepta la publishable key" de abajo.

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
  response: Response | null; // si no es null, devuélvela tal cual y no sigas
}

export async function requireUser(req: Request, cors: Record<string, string>): Promise<AuthResult> {
  const deny = (msg: string) => ({
    user: null,
    response: new Response(JSON.stringify({ error: msg }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    }),
  });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return deny('No autenticado: falta el header Authorization.');

  // Intenta resolver una sesión real. Si el token no es una sesión válida
  // (p. ej. es la publishable key, o una key de otro proyecto), YA NO se
  // rechaza la llamada -- se deja pasar como acceso anónimo (user: null).
  // El caller debe manejar ese caso (p. ej. tomar tenantId del body en vez
  // de la sesión, como hace segment-teeth).
  const { data } = await admin.auth.getUser(jwt).catch(() => ({ data: null }));
  if (data?.user) return { user: { id: data.user.id, email: data.user.email }, response: null };

  return { user: null, response: null };
}
