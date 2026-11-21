import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireUser, requirePermission } from '../_shared/auth.ts';
import { makeCors } from '../_shared/cors.ts';
import { permisoIA, respuestaIAnegada } from '../_shared/privacy.ts';
import { providerFacts, selectedFacts } from './contract.mjs';

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
