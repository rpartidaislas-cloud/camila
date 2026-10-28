// Control de calidad de una radiografía 2D (plan Etapa 2). Dedicada: NO reutiliza segment-teeth
// (ese servicio es para fotografías). La autorización la decide la base de datos con la sesión
// del usuario (smyl_radiograph_request_ai_run); service_role sólo se usa después para leer la
// fuente, descargar el archivo por su ruta conocida y cerrar la ejecución.
// Logs: ids y códigos únicamente; nunca imagen, base64, salida del motor ni datos clínicos.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { makeCors } from '../_shared/cors.ts';
import { createQcProvider } from '../_shared/radiograph-provider.ts';
import { runRadiographQc, type AiRunRow, type SourceRow } from '../_shared/radiograph-qc-core.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
const SB_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SB_ANON_KEY') || '';
const configuredTimeout = Number(Deno.env.get('RADIOGRAPH_QC_TIMEOUT_MS'));
// Siempre finito: un valor ausente o mal escrito usa el predeterminado en vez de producir NaN (sin timeout).
const PROVIDER_TIMEOUT_MS = Math.min(Math.max(Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 45000, 5000), 120000);
const MAX_BODY_BYTES = 4096;
// service_role se crea dentro del manejador: un fallo de configuración se responde, no tumba el módulo.
const adminClient = () => createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const provider = createQcProvider(
  { RADIOGRAPH_QC_PROVIDER: Deno.env.get('RADIOGRAPH_QC_PROVIDER'), RADIOGRAPH_QC_URL: Deno.env.get('RADIOGRAPH_QC_URL'), RADIOGRAPH_QC_API_KEY: Deno.env.get('RADIOGRAPH_QC_API_KEY'),
    RADIOGRAPH_QC_PROVIDER_NAME: Deno.env.get('RADIOGRAPH_QC_PROVIDER_NAME'), RADIOGRAPH_QC_MODEL_NAME: Deno.env.get('RADIOGRAPH_QC_MODEL_NAME'),
    RADIOGRAPH_QC_MODEL_VERSION: Deno.env.get('RADIOGRAPH_QC_MODEL_VERSION'), RADIOGRAPH_PROVIDER_HOSTS: Deno.env.get('RADIOGRAPH_PROVIDER_HOSTS'), RADIOGRAPH_ALLOW_SIMULATED: Deno.env.get('RADIOGRAPH_ALLOW_SIMULATED') },
);

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const reply = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Método no permitido.' });
  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  let body: unknown;
  try {
    if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) return reply(413, { error: 'Cuerpo demasiado grande.' });
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return reply(413, { error: 'Cuerpo demasiado grande.' });
    body = JSON.parse(text);
  } catch { return reply(400, { error: 'Cuerpo no válido.' }); }
  // Cliente con la sesión de la persona: el RPC aplica tenant, permiso, alcance, bandera y motor.
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
  try {
    const admin = adminClient();
    const result = await runRadiographQc(body, {
      requestRun: async (sourceId, kind, acknowledgeUnconfirmed) => {
        const { data, error } = await asUser.rpc('smyl_radiograph_request_ai_run', { p_source_id: sourceId, p_kind: kind, p_acknowledge_unconfirmed: acknowledgeUnconfirmed });
        return { data: (data as AiRunRow) ?? null, error: error ? { code: error.code, message: error.message } : null };
      },
      claimRun: async (runId) => {
        const { data, error } = await admin.rpc('smyl_radiograph_claim_ai_run', { p_run_id: runId });
        return { data: (data as AiRunRow) ?? null, error: error ? { code: error.code, message: error.message } : null };
      },
      loadSource: async (sourceId) => {
        const { data } = await admin.from('smyl_radiograph_sources').select('id,tenant_id,patient_id,bucket,storage_path,sha256,mime_type,size_bytes,study_type_declared').eq('id', sourceId).maybeSingle();
        return (data as SourceRow) ?? null;
      },
      download: async (bucket, path) => {
        const downloaded = await admin.storage.from(bucket).download(path);
        if (downloaded.error || !downloaded.data) return null;
        return new Uint8Array(await downloaded.data.arrayBuffer());
      },
      completeRun: async (runId, status, output, failureCode) => {
        const { data, error } = await admin.rpc('smyl_radiograph_complete_ai_run', { p_run_id: runId, p_status: status, p_output: output, p_failure_code: failureCode, p_cost: {} });
        return { data: (data as AiRunRow) ?? null, error: error ? { code: error.code, message: error.message } : null };
      },
      provider,
      timeoutMs: PROVIDER_TIMEOUT_MS,
      log: (event) => console.log(JSON.stringify({ fn: 'radiograph-qc', actor: auth.user?.id, tenant: auth.tenantId, ...event })),
    });
    return reply(result.status, result.body);
  } catch (error) {
    
    return reply(500, { error: 'No se pudo completar el control de calidad. Intenta de nuevo.' });
  }
});
