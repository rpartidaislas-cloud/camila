// Tope de gasto server-side para las Edge Functions que llaman APIs de
// pago (Anthropic, Gemini, Replicate). Antes el límite de plan
// (limite_diagnosticos/diagnosticos_usados) solo se checaba en el cliente
// -- cualquiera que llamara al Edge Function directo, sin pasar por la UI,
// generaba simulaciones sin ningún tope real. Ver migración
// camila_limits.sql para las funciones de Postgres que hacen el chequeo
// atómico (RPC, SECURITY DEFINER, solo invocables por el service_role).
//
// Mientras _shared/auth.ts siga aceptando llamadas sin sesión (pedido
// explícito del usuario), este módulo también aplica un tope duro por
// IP/hora a esas llamadas anónimas -- no reemplaza el login, solo evita
// que un link compartido genere gasto sin límite.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

const ANON_LIMITE_POR_HORA = Number(Deno.env.get('ANON_HOURLY_LIMIT') || '5');
const ANON_VENTANA_SEG = 3600;

export interface LimitResult {
  allowed: boolean;
  response: Response | null;
}

function limitDeny(cors: Record<string, string>, status: number, msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function ipDelRequest(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'sin-ip';
}

const MENSAJES_TENANT: Record<string, string> = {
  tenant_no_encontrado: 'No se encontró tu cuenta de clínica.',
  plan_inactivo: 'Tu plan no está activo. Revisa tu suscripción.',
  plan_vencido: 'Tu plan venció. Renueva tu suscripción para seguir generando simulaciones.',
  limite_alcanzado: 'Alcanzaste el límite de diagnósticos de tu plan en este periodo.',
};

// Llamar UNA vez por request, antes de gastar en la API externa. Si
// allowed=false, response ya trae el error listo para devolver tal cual.
export async function checkAndConsumeLimit(
  req: Request,
  tenantId: string | null, // el tenantId resuelto por requireUser() -- NUNCA user.id crudo, ver _shared/auth.ts
  cors: Record<string, string>
): Promise<LimitResult> {
  if (tenantId) {
    const { data, error } = await admin.rpc('camila_consumir_diagnostico', { p_tenant_id: tenantId });
    if (error) {
      // Falla de infraestructura ajena al usuario (RPC no desplegada,
      // conexión a la BD caída, etc.) -- no lo bloqueamos por eso, mejor
      // dejar pasar y que quede en los logs.
      console.error('[limits] error RPC camila_consumir_diagnostico:', error.message);
      return { allowed: true, response: null };
    }
    const fila = Array.isArray(data) ? data[0] : data;
    if (!fila?.permitido) {
      const motivo = fila?.motivo || 'limite_alcanzado';
      return { allowed: false, response: limitDeny(cors, 402, MENSAJES_TENANT[motivo] || MENSAJES_TENANT.limite_alcanzado) };
    }
    return { allowed: true, response: null };
  }

  // Sin sesión (acceso anónimo temporalmente permitido, ver auth.ts).
  const ip = ipDelRequest(req);
  const { data, error } = await admin.rpc('camila_anon_rate_check', {
    p_ip: ip,
    p_limite: ANON_LIMITE_POR_HORA,
    p_ventana_seg: ANON_VENTANA_SEG,
  });
  if (error) {
    console.error('[limits] error RPC camila_anon_rate_check:', error.message);
    return { allowed: true, response: null };
  }
  if (!data) {
    return {
      allowed: false,
      response: limitDeny(cors, 429, 'Demasiadas solicitudes sin iniciar sesión. Inicia sesión o intenta más tarde.'),
    };
  }
  return { allowed: true, response: null };
}
