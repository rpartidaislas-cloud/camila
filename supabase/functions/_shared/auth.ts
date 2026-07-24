// Verificación de sesión para las Edge Functions que gastan dinero real
// (Anthropic, Gemini, Replicate).
//
// Antes de esto, `claude` y `segment-teeth` respondían a cualquier POST sin
// ningún header: un `curl` a pelo contra la URL --- que está publicada en un
// repo público --- ejecutaba prompts arbitrarios de Opus contra la cuenta de
// Anthropic del proyecto. Lo mismo con Gemini y con Replicate.
//
// La regla ahora es: hay que mandar el JWT de una sesión real de Supabase Auth
// (el `access_token` que devuelve signInWithPassword), NO la publishable key.
// La publishable key es pública por diseño --- vive en el HTML del cliente ---
// así que aceptarla como credencial equivale a no pedir nada.

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
  if (!jwt) return deny('No autenticado: falta el header Authorization con el token de sesión.');

  // Las publishable/anon keys no son JWTs de usuario. Las nuevas (sb_publishable_...)
  // ni siquiera tienen forma de JWT; las viejas sí, pero traen role=anon. Rechazamos
  // ambas explícitamente para que el error diga qué hacer en vez de un 401 opaco.
  if (jwt.startsWith('sb_publishable_') || jwt.startsWith('sb_secret_')) {
    return deny('No autenticado: mandaste la publishable key, no el token de sesión. Usa session.access_token.');
  }

  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return deny('Sesión inválida o expirada. Vuelve a iniciar sesión.');

  return { user: { id: data.user.id, email: data.user.email }, response: null };
}
