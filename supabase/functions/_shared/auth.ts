// Verificación de sesión para las Edge Functions que gastan dinero real
// (Anthropic, OpenAI, Replicate).
//
// Exige un JWT de sesión real de Supabase Auth (el `access_token` que
// devuelve signInWithPassword) -- la publishable key SIN sesión ya no basta.
// Antes se aceptaba también sin sesión ("acceso anónimo permitido por
// pedido explícito"), lo que significaba que cualquiera con la URL
// publicada podía gastar los créditos de Anthropic/OpenAI/Replicate de este
// proyecto sin pasar por el login (un `curl` a pelo funcionaba igual). Se
// revirtió: ahora rechaza cualquier llamada sin una sesión válida.

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

  // Si el token no resuelve a una sesión real (p. ej. es la publishable
  // key, un JWT vencido, o de otro proyecto), se rechaza -- ya no se deja
  // pasar como acceso anónimo.
  const { data } = await admin.auth.getUser(jwt).catch(() => ({ data: null }));
  if (data?.user) return { user: { id: data.user.id, email: data.user.email }, response: null };

  return deny('Sesión inválida o vencida: inicia sesión de nuevo.');
}
