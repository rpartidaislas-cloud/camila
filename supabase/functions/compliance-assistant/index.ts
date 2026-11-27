import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireUser, requirePermission } from '../_shared/auth.ts';
import { makeCors } from '../_shared/cors.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '');
const model = Deno.env.get('OPENAI_MILA_REWRITE_MODEL') || Deno.env.get('OPENAI_MILA_NOTE_MODEL') || 'gpt-5-mini';
const enforce = Deno.env.get('SMYL_CONSUMABLES_ENFORCED') === 'true';
const feature = 'compliance_assistant';
const allowed = new Set(['aviso_funcionamiento','aviso_responsable','titulo_visible','rotulo_horario','contrato_rpbi',
  'contenedores_rpbi','fauna_nociva','bitacora_limpieza','cisterna','cloro_residual','autoclave','botiquin',
  'telefonos_emergencia','vacunas_personal','medicamentos','protocolos','equipo_rayos_x']);

function text(v: unknown, max: number): string { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function outputText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text;
  for (const item of data?.output || []) for (const part of item?.content || []) if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
  return '';
}
function suggestions(value: any, validKeys: Set<string>) {
  const list = Array.isArray(value?.suggestions) ? value.suggestions : [];
  return list.filter((s: any) => validKeys.has(s?.key)).map((s: any) => {
    let status = ['have','not_applicable','needs_info'].includes(s?.status) ? s.status : 'needs_info';
    const reference = text(s?.reference, 120), notes = text(s?.notes, 500);
    if (status === 'have' && !reference) status = 'needs_info';
    if (status === 'not_applicable' && notes.length < 8) status = 'needs_info';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(s?.valid_until || '')) ? String(s.valid_until) : '';
    return { key: s.key, status, reference, valid_until: date, notes,
      explanation: text(s?.explanation, 280), confidence: ['high','medium','low'].includes(s?.confidence) ? s.confidence : 'low' };
  });
}

Deno.serve(async (req: Request) => {
  const cors = makeCors(req);
  const json = (status: number, body: object) => new Response(JSON.stringify(body), { status,
    headers: { ...cors, 'Cache-Control': 'no-store', 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });
  try {
    const auth = await requireUser(req, cors);
    if (auth.response) return auth.response;
    if (!auth.user || !auth.tenantId) return json(401, { error: 'Inicia sesión para usar MILA.' });
    const denied = await requirePermission(auth, cors, 'settings.manage'); if (denied) return denied;
    const raw = await req.text(); if (raw.length > 24000) return json(413, { error: 'La información es demasiado extensa.' });
    let body: any; try { body = JSON.parse(raw); } catch { return json(400, { error: 'Solicitud no válida.' }); }
    const context = text(body?.context, 6000), clinic = text(body?.clinic_name, 120);
    const items = (Array.isArray(body?.items) ? body.items : []).filter((item: any) => allowed.has(item?.key)).slice(0, allowed.size).map((item: any) => ({
      key: item.key, title: text(item.title, 180), hint: text(item.hint, 180), cadence: text(item.cadence, 20),
      validity: item.validity === true, current_status: text(item.current_status, 30),
      current_reference: text(item.current_reference, 120), current_notes: text(item.current_notes, 500)
    }));
    if (!items.length) return json(400, { error: 'No hay requisitos para revisar.' });
    const key = Deno.env.get('OPENAI_API_KEY'); if (!key) return json(503, { error: 'MILA no está configurada todavía.' });
    if (enforce) {
      const wallet = await admin.from('smyl_wallets').select('balance_units').eq('tenant_id', auth.tenantId).eq('resource', 'ai_credits').maybeSingle();
      if (wallet.error) return json(503, { error: 'No se pudo comprobar el saldo de MILA.' });
      if (!wallet.data || Number(wallet.data.balance_units) < 1) return json(402, { error: 'Se necesita un crédito de MILA para preparar el borrador.' });
    }
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(40_000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({
        model, store: false, max_output_tokens: 2600,
        instructions: `Eres MILA, asistente administrativo de una clínica dental en México. Prepara un BORRADOR para revisar requisitos sanitarios.
Reglas estrictas: no certificas cumplimiento; no das asesoría legal; no inventas folios, vigencias, empresas, responsables ni documentos. Sólo propones status "have" cuando el texto del usuario contiene evidencia explícita y una referencia concreta. Sólo propones "not_applicable" cuando el usuario lo afirma explícitamente y explicas el motivo. En cualquier duda usa "needs_info" y formula una pregunta sencilla. Conserva los registros actuales. No incluyas datos de pacientes. Escribe en español claro para una persona sin experiencia regulatoria.`,
        input: JSON.stringify({ clinic, user_context: context, requirements: items }),
        text: { format: { type: 'json_schema', name: 'compliance_draft', strict: true, schema: {
          type: 'object', additionalProperties: false, required: ['overview','suggestions','questions'], properties: {
            overview: { type: 'string' },
            suggestions: { type: 'array', items: { type: 'object', additionalProperties: false,
              required: ['key','status','reference','valid_until','notes','explanation','confidence'], properties: {
                key: { type: 'string' }, status: { type: 'string', enum: ['have','not_applicable','needs_info'] },
                reference: { type: 'string' }, valid_until: { type: 'string' }, notes: { type: 'string' },
                explanation: { type: 'string' }, confidence: { type: 'string', enum: ['high','medium','low'] }
              } } }, questions: { type: 'array', items: { type: 'string' }, maxItems: 8 }
          }
        } } }
      }) });
    if (!response.ok) return json(502, { error: 'MILA no pudo preparar el borrador. Intenta de nuevo.' });
    const completion = await response.json(); let parsed: any;
    try { parsed = JSON.parse(outputText(completion)); } catch { return json(422, { error: 'MILA devolvió un borrador incompleto.' }); }
    const validKeys = new Set(items.map((item: any) => item.key));
    const draft = suggestions(parsed, validKeys);
    const metering = await admin.rpc('smyl_consume', { p_tenant_id: auth.tenantId, p_resource: 'ai_credits', p_quantity_units: 1,
      p_idempotency_key: feature + ':' + (completion.id || crypto.randomUUID()), p_source_type: feature, p_source_id: null,
      p_provider: 'openai', p_provider_model: model, p_enforce: enforce,
      p_metadata: { input_tokens: Number(completion.usage?.input_tokens) || 0, output_tokens: Number(completion.usage?.output_tokens) || 0 } });
    const receipt = Array.isArray(metering.data) ? metering.data[0] : metering.data;
    if (metering.error || !receipt) return json(503, { error: 'No se pudo registrar el consumo de MILA.' });
    if (receipt.accepted === false) return json(402, { error: 'El crédito de MILA ya no está disponible.' });
    await admin.from('smyl_ai_usage_log').insert({ tenant_id: auth.tenantId, feature, model,
      request_id: text(completion.id, 120) || null, outcome: draft.length ? 'ok' : 'incomplete',
      input_tokens: Number(completion.usage?.input_tokens) || 0, output_tokens: Number(completion.usage?.output_tokens) || 0,
      duration_ms: null, stop_reason: text(completion.status, 40) || null });
    return json(200, { overview: text(parsed?.overview, 600), suggestions: draft,
      questions: (Array.isArray(parsed?.questions) ? parsed.questions : []).map((q: unknown) => text(q, 240)).filter(Boolean).slice(0, 8),
      usage: { credits: 1, input_tokens: Number(completion.usage?.input_tokens) || 0, output_tokens: Number(completion.usage?.output_tokens) || 0 } });
  } catch (error) {
    console.error('[compliance-assistant]', error instanceof Error ? error.message : error);
    return json(503, { error: 'MILA no está disponible en este momento. Puedes continuar manualmente.' });
  }
});
