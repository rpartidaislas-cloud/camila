// Núcleo de la Edge Function radiograph-qc, sin Deno ni Supabase: recibe dependencias y devuelve
// {status, body}. Así se prueba cada escenario (tipo falso, hash distinto, respuesta incompleta,
// timeout, duplicado) de forma determinista en Node.
//
// Orden obligatorio: (1) la solicitud se registra en la base con la sesión del usuario — el RPC
// verifica tenant, permiso, alcance del paciente, bandera y motor activo, y es idempotente —;
// (2) sólo entonces se usa service_role para leer la fuente y descargar el archivo por su ruta
// conocida; (3) se verifica hash, MIME real, tamaño y dimensiones; (4) se llama al proveedor con
// timeout; (5) la respuesta se valida con el contrato y se guarda completa e inmutable.
// Un timeout incierto cierra la ejecución como `unconfirmed` y NO reintenta.

import { parseRadiographQc } from './radiograph-contracts.ts';
import { probeRadiograph, sha256Hex } from './radiograph-image.ts';
import type { RadiographQcProvider, VerifiedRadiographSource } from './radiograph-provider.ts';

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
  requestRun(sourceId: string): Promise<DbResult<AiRunRow>>;            // como usuario (JWT)
  loadSource(sourceId: string): Promise<SourceRow | null>;               // service_role
  download(bucket: string, path: string): Promise<Uint8Array | null>;    // service_role, ruta conocida
  completeRun(runId: string, status: 'completed' | 'failed' | 'unconfirmed', output: unknown, failureCode: string): Promise<DbResult<AiRunRow>>; // service_role
  provider: RadiographQcProvider | null;
  timeoutMs: number;
  log(event: Record<string, string | number | boolean | null>): void;    // sólo ids y códigos
}
export interface QcReply { status: number; body: Record<string, unknown> }

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_DIM = 64, MAX_DIM = 12000;

function publicRun(run: AiRunRow) {
  return { id: run.id, sourceId: run.source_id, kind: run.kind, status: run.status, engine: run.engine, contractVersion: run.contract_version, output: run.output, failureCode: run.failure_code };
}

function dbStatus(code: string | undefined): number {
  if (code === '42501') return 403;
  if (code === '23514' || code === 'PT409' || code === '23505') return 409;
  if (code === '22023') return 400;
  return 500;
}

export async function runRadiographQc(rawBody: unknown, deps: QcDeps): Promise<QcReply> {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.toLowerCase() : '';
  if (!UUID.test(sourceId)) return { status: 400, body: { error: 'Indica la fuente radiográfica.' } };
  if (!deps.provider) return { status: 503, body: { error: 'El control de calidad radiográfico no está configurado en el servidor.', code: 'disabled' } };

  const requested = await deps.requestRun(sourceId);
  if (requested.error || !requested.data) {
    deps.log({ event: 'qc_request_rejected', sourceId, code: requested.error?.code || '' });
    return { status: dbStatus(requested.error?.code), body: { error: requested.error?.message || 'No se pudo registrar la solicitud.', code: requested.error?.code || '' } };
  }
  const run = requested.data;
  if (run.status === 'completed') {
    deps.log({ event: 'qc_reused', runId: run.id, sourceId });
    return { status: 200, body: { run: publicRun(run), reused: true } };
  }
  if (run.status !== 'requested') return { status: 409, body: { error: 'La ejecución no está en un estado que permita continuar.', code: run.status } };

  const fail = async (status: number, failureCode: string, error: string, runStatus: 'failed' | 'unconfirmed' = 'failed') => {
    const closed = await deps.completeRun(run.id, runStatus, null, failureCode);
    deps.log({ event: 'qc_closed', runId: run.id, sourceId, status: runStatus, code: failureCode, persisted: !closed.error });
    return { status, body: { error, code: failureCode, run: closed.data ? publicRun(closed.data) : { id: run.id, status: runStatus, failureCode } } };
  };

  const source = await deps.loadSource(run.source_id);
  if (!source || source.tenant_id !== run.tenant_id) return fail(422, 'source_invalid', 'La fuente radiográfica no está disponible.');
  if (source.bucket !== 'smyl-radiographs' || source.size_bytes > MAX_BYTES) return fail(422, 'size_limit', 'El archivo excede el tamaño permitido.');
  const bytes = await deps.download(source.bucket, source.storage_path);
  if (!bytes) return fail(422, 'source_invalid', 'No se encontró el archivo privado.');
  if (bytes.length !== source.size_bytes || bytes.length > MAX_BYTES) return fail(422, 'source_invalid', 'El tamaño real no coincide con la fuente.');
  if ((await sha256Hex(bytes)) !== source.sha256) return fail(422, 'source_invalid', 'La huella del archivo no coincide con la fuente.');
  const probe = probeRadiograph(bytes);
  if (probe.mime !== source.mime_type) return fail(422, 'source_invalid', 'El tipo real del archivo no coincide con la fuente.');
  if (probe.reason || probe.width === null || probe.height === null) return fail(422, 'source_invalid', probe.reason || 'La imagen no declara dimensiones.');
  if (probe.width < MIN_DIM || probe.height < MIN_DIM || probe.width > MAX_DIM || probe.height > MAX_DIM) return fail(422, 'source_invalid', 'Las dimensiones de la imagen están fuera de rango.');

  const verified: VerifiedRadiographSource = {
    sourceId: source.id, sha256: source.sha256, mimeType: probe.mime, width: probe.width, height: probe.height,
    orientation: probe.orientation, studyTypeDeclared: source.study_type_declared, bytes, hints: probe.hints,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  let raw: unknown;
  try {
    raw = await deps.provider.analyze(verified, controller.signal);
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) return fail(504, 'timeout', 'El motor no respondió a tiempo; la ejecución quedó sin confirmar y no se reintenta sola.', 'unconfirmed');
    deps.log({ event: 'qc_provider_error', runId: run.id, sourceId, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return fail(502, 'provider_error', 'El motor devolvió un error.');
  }
  clearTimeout(timer);
  if (controller.signal.aborted) return fail(504, 'timeout', 'El motor no respondió a tiempo; la ejecución quedó sin confirmar y no se reintenta sola.', 'unconfirmed');

  let output;
  try { output = parseRadiographQc(raw); } catch (error) {
    deps.log({ event: 'qc_invalid_output', runId: run.id, sourceId, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return fail(502, 'invalid_output', 'La respuesta del motor no cumple el contrato.');
  }
  const m = output.model, e = run.engine, p = deps.provider.model;
  if (m.provider !== e.provider || m.name !== e.name || m.version !== e.version || m.provider !== p.provider || m.name !== p.name || m.version !== p.version) {
    return fail(502, 'invalid_output', 'La respuesta no identifica el motor registrado.');
  }
  const closed = await deps.completeRun(run.id, 'completed', output, '');
  if (closed.error || !closed.data) {
    deps.log({ event: 'qc_persist_failed', runId: run.id, sourceId, code: closed.error?.code || '' });
    return { status: dbStatus(closed.error?.code), body: { error: closed.error?.message || 'No se pudo guardar el resultado.', code: closed.error?.code || '' } };
  }
  deps.log({ event: 'qc_completed', runId: run.id, sourceId, quality: output.quality.status, studyClass: output.studyClass.value, flags: output.quality.flags.length });
  return { status: 200, body: { run: publicRun(closed.data), reused: false } };
}
