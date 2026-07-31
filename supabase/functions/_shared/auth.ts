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
  if (data?.user) return { user: { id: data.user.id, email: data.user.email }, response: null };

  if (seTardo) return deny('No se pudo verificar la sesión a tiempo (Supabase Auth no respondió). Intenta de nuevo.');
  return deny('Sesión inválida o vencida: inicia sesión de nuevo.');
}
