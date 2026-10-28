// Núcleo de las Edge Functions radiograph-qc y radiograph-analyze, sin Deno ni Supabase: recibe dependencias y devuelve
// {status, body}. Así se prueba cada escenario (tipo falso, hash distinto, respuesta incompleta,
// timeout, duplicado) de forma determinista en Node.
//
// Orden obligatorio: (1) la solicitud se registra en la base con la sesión del usuario — el RPC
// verifica tenant, permiso, alcance del paciente, bandera y motor activo, y es idempotente —;
// (2) sólo entonces se usa service_role para leer la fuente y descargar el archivo por su ruta
// conocida; (3) se verifica hash, MIME real, tamaño y dimensiones; (4) se llama al proveedor con
// timeout; (5) la respuesta se valida con el contrato y se guarda completa e inmutable.
// Un timeout incierto cierra la ejecución como `unconfirmed` y NO reintenta.

import { parseFindingCandidateSet, parseRadiographQc, parseToothCandidateSet, type ModelRef } from './radiograph-contracts.ts';
import { probeRadiograph, sha256Hex } from './radiograph-image.ts';
import type { AnalysisKind, DentalXrayProvider, RadiographQcProvider, VerifiedRadiographSource } from './radiograph-provider.ts';

export interface AiRunRow {
  id: string; tenant_id: string; patient_id: string; source_id: string; kind: string; status: string;
  engine: { provider: string; name: string; version: string }; contract_version: number; output: unknown; failure_code: string;
}
export interface SourceRow {
  id: string; tenant_id: string; patient_id: string; bucket: string; storage_path: string; sha256: string;
  mime_type: string; size_bytes: number; study_type_declared: string;
}
export interface DbResult<T> { data: T | null; error: { code?: string; message: string } | null }
export interface QcDeps {
  requestRun(sourceId: string, kind: AnalysisKind, acknowledgeUnconfirmed: boolean): Promise<DbResult<AiRunRow>>; // como usuario (JWT)
  claimRun(runId: string): Promise<DbResult<AiRunRow>>;                  // service_role: una sola invocación gana antes de llamar al proveedor
  loadSource(sourceId: string): Promise<SourceRow | null>;               // service_role
  download(bucket: string, path: string): Promise<Uint8Array | null>;    // service_role, ruta conocida
  completeRun(runId: string, status: 'completed' | 'failed' | 'unconfirmed', output: unknown, failureCode: string): Promise<DbResult<AiRunRow>>; // service_role
  provider: RadiographQcProvider | null;          // QC
  dentalProvider?: DentalXrayProvider | null;      // localización y señales (Etapa 3)
  timeoutMs: number;
  log(event: Record<string, string | number | boolean | null>): void;    // sólo ids y códigos
}
export interface QcReply { status: number; body: Record<string, unknown> }

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_DIM = 64, MAX_DIM = 12000, MAX_PIXELS = 50_000_000;
const MAX_OUTPUT_BYTES = 250_000, MAX_CANDIDATE_BYTES = 15_000;
// Surrogate suelto: JSON.stringify lo escapa pero PostgreSQL rechaza el \ud800 aislado al convertir a jsonb.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const utf8Bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;
// JSON.stringify escapa el surrogate suelto (lo hace "válido"), así que se busca en las cadenas reales, claves incluidas.
function hasLoneSurrogate(v: unknown): boolean {
  if (typeof v === 'string') return LONE_SURROGATE.test(v);
  if (Array.isArray(v)) return v.some(hasLoneSurrogate);
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).some(([k, x]) => LONE_SURROGATE.test(k) || hasLoneSurrogate(x));
  return false;
}

function publicRun(run: AiRunRow) {
  return { id: run.id, sourceId: run.source_id, kind: run.kind, status: run.status, engine: run.engine, contractVersion: run.contract_version, output: run.output, failureCode: run.failure_code };
}

function dbStatus(code: string | undefined): number {
  if (code === '42501') return 403;
  if (code === '23514' || code === 'PT409' || code === '23505') return 409;
  if (code === '22023') return 400;
  return 500;
}
// Sólo mensajes escritos por nuestras funciones SQL llegan al navegador; cualquier otro error de la base es genérico.
const dbMessage = (error: { code?: string; message: string } | null, fallback: string): string =>
  error && ['42501', '23514', 'PT409', '22023'].includes(error.code || '') ? error.message : fallback;

class ProviderTimeout extends Error {}

interface Engine { model: ModelRef; call(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown>; parse(raw: unknown): { model: ModelRef; sourceId?: string } & Record<string, unknown> }

function selectEngine(kind: AnalysisKind, deps: QcDeps): Engine | null {
  if (kind === 'qc') return deps.provider ? { model: deps.provider.model, call: (i, s) => deps.provider!.analyze(i, s), parse: parseRadiographQc } : null;
  const d = deps.dentalProvider;
  if (!d) return null;
  if (kind === 'tooth_localization') return { model: d.model, call: (i, s) => d.localizeTeeth(i, s), parse: parseToothCandidateSet };
  if (kind === 'finding_candidates') return { model: d.model, call: (i, s) => d.analyzeCandidates(i, s), parse: parseFindingCandidateSet };
  return null;
}

export function runRadiographQc(rawBody: unknown, deps: QcDeps): Promise<QcReply> { return runRadiographAnalysis('qc', rawBody, deps); }

export async function runRadiographAnalysis(kind: AnalysisKind, rawBody: unknown, deps: QcDeps): Promise<QcReply> {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.toLowerCase() : '';
  if (!UUID.test(sourceId)) return { status: 400, body: { error: 'Indica la fuente radiográfica.' } };
  if (!['qc', 'tooth_localization', 'finding_candidates'].includes(kind)) return { status: 400, body: { error: 'Tipo de análisis desconocido.' } };
  const engine = selectEngine(kind, deps);
  if (!engine) return { status: 503, body: { error: 'Este análisis radiográfico no está configurado en el servidor.', code: 'disabled' } };

  const requested = await deps.requestRun(sourceId, kind, body.acknowledgeUnconfirmed === true);
  if (requested.error || !requested.data) {
    deps.log({ event: 'run_request_rejected', kind, sourceId, code: requested.error?.code || '' });
    return { status: dbStatus(requested.error?.code), body: { error: dbMessage(requested.error, 'No se pudo registrar la solicitud.'), code: requested.error?.code || '' } };
  }
  const run = requested.data;
  if (run.kind !== kind) return { status: 409, body: { error: 'La ejecución registrada no corresponde a este análisis.', code: 'kind_mismatch' } };
  if (run.status === 'completed') {
    deps.log({ event: 'run_reused', kind, runId: run.id, sourceId });
    return { status: 200, body: { run: publicRun(run), reused: true } };
  }
  if (run.status !== 'requested') return { status: 409, body: { error: 'La ejecución no está en un estado que permita continuar.', code: run.status } };

  // Reclamo atómico: si otra invocación ya envió (o está enviando) esta ejecución, esta no vuelve a enviar nada.
  const claimed = await deps.claimRun(run.id);
  if (claimed.error || !claimed.data) {
    deps.log({ event: 'run_claim_rejected', kind, runId: run.id, sourceId, code: claimed.error?.code || '' });
    if (claimed.error?.code === 'PT409') return { status: 409, body: { error: 'Esta imagen ya se está analizando; espera el resultado.', code: 'in_progress', run: { id: run.id, status: run.status } } };
    return { status: dbStatus(claimed.error?.code), body: { error: dbMessage(claimed.error, 'No se pudo iniciar el análisis.'), code: claimed.error?.code || '' } };
  }

  let sent = false;
  const close = async (status: number, failureCode: string, error: string, runStatus: 'failed' | 'unconfirmed' = 'failed') => {
    let closed: DbResult<AiRunRow> = { data: null, error: { message: 'not_closed' } };
    try { closed = await deps.completeRun(run.id, runStatus, null, failureCode); } catch { /* se registra abajo; la ejecución caduca sola como "sin confirmar" */ }
    deps.log({ event: 'run_closed', kind, runId: run.id, sourceId, status: runStatus, code: failureCode, persisted: !closed.error });
    return { status, body: { error, code: failureCode, run: closed.data ? publicRun(closed.data) : { id: run.id, status: runStatus, failureCode } } };
  };
  const timeoutReply = () => close(504, 'timeout', 'El motor no respondió a tiempo; la ejecución quedó sin confirmar y no se reintenta sola.', 'unconfirmed');

  try {
    const source = await deps.loadSource(run.source_id);
    if (!source || source.tenant_id !== run.tenant_id || source.patient_id !== run.patient_id) return await close(422, 'source_invalid', 'La fuente radiográfica no está disponible.');
    if (source.bucket !== 'smyl-radiographs' || source.size_bytes > MAX_BYTES) return await close(422, 'size_limit', 'El archivo excede el tamaño permitido.');
    // La ruta debe seguir el prefijo tenant/paciente: ni una fuente mal registrada puede apuntar al archivo de otra persona.
    if (!source.storage_path.startsWith(`${source.tenant_id}/${source.patient_id}/`) || source.storage_path.split('/').some((part) => part === '..' || part === '.')) {
      return await close(422, 'source_invalid', 'La ruta del archivo no pertenece a este paciente.');
    }
    const bytes = await deps.download(source.bucket, source.storage_path);
    if (!bytes) return await close(422, 'source_invalid', 'No se encontró el archivo privado.');
    if (bytes.length !== source.size_bytes || bytes.length > MAX_BYTES) return await close(422, 'source_invalid', 'El tamaño real no coincide con la fuente.');
    if ((await sha256Hex(bytes)) !== source.sha256) return await close(422, 'source_invalid', 'La huella del archivo no coincide con la fuente.');
    const probe = probeRadiograph(bytes);
    if (probe.mime !== source.mime_type) return await close(422, 'source_invalid', 'El tipo real del archivo no coincide con la fuente.');
    if (probe.reason || probe.width === null || probe.height === null) return await close(422, 'source_invalid', probe.reason || 'La imagen no declara dimensiones.');
    if (probe.width < MIN_DIM || probe.height < MIN_DIM || probe.width > MAX_DIM || probe.height > MAX_DIM || probe.width * probe.height > MAX_PIXELS) {
      return await close(422, 'source_invalid', 'Las dimensiones de la imagen están fuera de rango.');
    }
    // La identidad del motor se comprueba ANTES de enviar la imagen: si cambió el motor activo, no sale nada.
    const reg = run.engine, cfg = engine.model;
    if (reg.provider !== cfg.provider || reg.name !== cfg.name || reg.version !== cfg.version) {
      return await close(503, 'disabled', 'El motor configurado no coincide con el motor registrado para esta ejecución.');
    }

    const verified: VerifiedRadiographSource = {
      sourceId: source.id, sha256: source.sha256, mimeType: probe.mime, width: probe.width, height: probe.height,
      orientation: probe.orientation, studyTypeDeclared: source.study_type_declared, bytes, hints: probe.hints,
    };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProviderTimeout()); }, deps.timeoutMs); });
    let raw: unknown;
    sent = true; // desde aquí el proveedor pudo recibir la imagen
    try {
      const call = engine.call(verified, controller.signal);
      call.catch(() => undefined); // si pierde la carrera, su rechazo tardío no debe quedar sin atender
      raw = await Promise.race([call, deadline]);
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof ProviderTimeout || controller.signal.aborted) return await timeoutReply();
      const message = error instanceof Error ? error.message : '';
      const http = /^provider_http_(\d{3})$/.exec(message);
      deps.log({ event: 'run_provider_error', kind, runId: run.id, sourceId, code: http ? `http_${http[1]}` : 'network' });
      // Un rechazo 4xx definitivo (salvo 408) prueba que el proveedor no procesó nada; el resto es incierto.
      if (http && Number(http[1]) >= 400 && Number(http[1]) < 500 && http[1] !== '408') return await close(502, 'provider_error', 'El motor devolvió un error.');
      return await close(502, 'provider_error', 'El motor no confirmó el resultado; la ejecución quedó sin confirmar y no se reintenta sola.', 'unconfirmed');
    }
    clearTimeout(timer);
    if (controller.signal.aborted) return await timeoutReply();

    let output: ReturnType<Engine['parse']>;
    try { output = engine.parse(raw); } catch (error) {
      deps.log({ event: 'run_invalid_output', kind, runId: run.id, sourceId, code: error instanceof Error ? 'contract' : 'unknown' });
      return await close(502, 'invalid_output', 'La respuesta del motor no cumple el contrato.');
    }
    if (kind !== 'qc' && output.sourceId !== source.id) return await close(502, 'invalid_output', 'La respuesta no corresponde a la fuente.');
    const m = output.model;
    if (m.provider !== reg.provider || m.name !== reg.name || m.version !== reg.version) return await close(502, 'invalid_output', 'La respuesta no identifica el motor registrado.');
    // La base guarda jsonb con topes en bytes UTF-8: se comprueban aquí para no perder un resultado ya pagado.
    if (hasLoneSurrogate(output)) return await close(502, 'invalid_output', 'La respuesta contiene texto no válido.');
    if (utf8Bytes(output) > MAX_OUTPUT_BYTES || (kind !== 'qc' && (output.candidates as unknown[]).some((c) => utf8Bytes(c) > MAX_CANDIDATE_BYTES))) {
      return await close(502, 'invalid_output', 'La respuesta del motor excede el tamaño permitido.');
    }
    const closed = await deps.completeRun(run.id, 'completed', output, '');
    if (closed.error || !closed.data) {
      deps.log({ event: 'run_persist_failed', kind, runId: run.id, sourceId, code: closed.error?.code || '' });
      // La respuesta ya existe pero no se guardó: se intenta cerrar como "sin confirmar" para no dejarla abierta.
      return await close(dbStatus(closed.error?.code), 'invalid_output', dbMessage(closed.error, 'No se pudo guardar el resultado.'), closed.error?.code === '22023' ? 'failed' : 'unconfirmed');
    }
    const summary = kind === 'qc'
      ? { quality: String((output.quality as { status: string }).status), studyClass: String((output.studyClass as { value: string }).value) }
      : { candidates: (output.candidates as unknown[]).length };
    deps.log({ event: 'run_completed', kind, runId: run.id, sourceId, ...summary });
    return { status: 200, body: { run: publicRun(closed.data), reused: false } };
  } catch (error) {
    // Cualquier fallo inesperado después del reclamo cierra la ejecución: nunca queda "solicitada" para siempre.
    deps.log({ event: 'run_unexpected', kind, runId: run.id, sourceId, sent, code: error instanceof Error ? error.name : 'unknown' });
    return sent
      ? await close(500, 'provider_error', 'El análisis se interrumpió; la ejecución quedó sin confirmar y no se reintenta sola.', 'unconfirmed')
      : await close(500, 'provider_error', 'No se pudo completar el análisis.');
  }
}
