// Adaptador de proveedor para el control de calidad radiográfico (plan §7). La UI nunca habla con
// un proveedor: el núcleo recibe un RadiographQcProvider y valida su respuesta con el contrato.
// Reglas del adaptador: credenciales ocultas, timeout y tamaño impuestos, sin redirecciones,
// salida cruda que el núcleo valida (falla cerrado), versión exacta del modelo, y un proveedor
// simulado determinista para pruebas y pilotos sin motor real.

import { ANALYSES, QC_FLAG_CODES, type ModelRef, type RadiographQcResultV1 } from './radiograph-contracts.ts';

export interface VerifiedRadiographSource {
  sourceId: string;
  sha256: string;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  orientation: number;
  studyTypeDeclared: string;
  bytes: Uint8Array;
  hints: string[]; // sólo las usa el proveedor simulado
}

export interface RadiographQcProvider {
  readonly model: ModelRef;
  // Devuelve la respuesta cruda; el núcleo la valida con parseRadiographQc. Debe respetar `signal`.
  analyze(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown>;
}

export const SIMULATED_MODEL: ModelRef = { provider: 'simulated', name: 'smyl-sim-xray', version: '0.1.0' };

// Determinista a partir de dimensiones, orientación, peso por píxel y pistas de prueba. Nunca emite
// afirmaciones clínicas: sólo clase de estudio y banderas técnicas con explicación.
export class SimulatedQcProvider implements RadiographQcProvider {
  readonly model = SIMULATED_MODEL;
  analyze(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown> {
    if (input.hints.includes('malformed')) return Promise.resolve({ schema: 1, studyClass: { value: 'panoramic' } });
    if (input.hints.includes('hang')) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))));
    if (input.hints.includes('crash')) return Promise.reject(new Error('simulated provider failure'));
    return Promise.resolve(simulateQc(input));
  }
}

export function simulateQc(input: VerifiedRadiographSource): RadiographQcResultV1 {
  const ratio = input.width / input.height;
  const derived = ratio >= 1.8 ? 'panoramic' : ratio >= 1.15 && input.width <= 1600 ? 'bitewing' : ratio < 1.15 ? 'periapical' : 'unknown';
  const declared = input.studyTypeDeclared;
  const agrees = declared === derived || declared === 'unknown';
  const studyClass: RadiographQcResultV1['studyClass'] = agrees
    ? { value: derived, probability: 0.9, alternatives: [] }
    : { value: derived, probability: 0.6, alternatives: [{ value: declared as RadiographQcResultV1['studyClass']['value'], probability: 0.3 }] };
  const flags: RadiographQcResultV1['quality']['flags'] = [];
  if (input.orientation !== 1 && input.orientation !== 0) flags.push({ code: 'orientation_suspect', severity: 'high', region: null, explanation: 'La orientación EXIF no es la normal; revisar lado y sentido antes de interpretar.' });
  const bytesPerPixel = input.bytes.length / (input.width * input.height);
  if (input.mimeType === 'image/jpeg' && bytesPerPixel < 0.08) flags.push({ code: 'compression_artifacts', severity: 'moderate', region: null, explanation: 'Compresión JPEG alta para el tamaño de la imagen; el detalle fino puede estar degradado.' });
  for (const hint of input.hints) {
    const [code, severity] = hint.split(':');
    if ((QC_FLAG_CODES as readonly string[]).includes(code) && !flags.some((f) => f.code === code)) {
      flags.push({ code: code as typeof QC_FLAG_CODES[number], severity: severity === 'high' || severity === 'low' ? severity : 'moderate', region: null, explanation: `Señal técnica simulada: ${code.replace(/_/g, ' ')}.` });
    }
  }
  const unusable = input.hints.includes('unusable');
  const high = flags.some((f) => f.severity === 'high');
  const status: RadiographQcResultV1['quality']['status'] = unusable ? 'unusable' : high || flags.length >= 2 ? 'limited' : 'usable';
  const fineBlocked = status === 'limited' && flags.some((f) => ['motion_blur', 'anterior_blur', 'compression_artifacts', 'orientation_suspect'].includes(f.code));
  const applicable = status === 'unusable' ? [] : fineBlocked ? ['tooth_localization'] : [...ANALYSES];
  const blocked = (ANALYSES as readonly string[]).filter((a) => !applicable.includes(a)).map((code) => ({
    code: code as typeof ANALYSES[number],
    reason: status === 'unusable' ? 'La imagen no es utilizable para análisis asistido.' : 'Las señales técnicas detectadas impiden evaluar señales finas.',
  }));
  return { schema: 1, studyClass, quality: { status, flags }, applicableAnalyses: applicable as RadiographQcResultV1['applicableAnalyses'], blockedAnalyses: blocked, model: { ...SIMULATED_MODEL } };
}

export interface HttpQcProviderConfig {
  url: string;
  apiKey: string;
  model: ModelRef;
  timeoutMs: number;
  maxResponseBytes: number;
  allowedHostSuffixes: string[];
}

// Adaptador HTTP genérico: https permitido, sin redirecciones, tope de respuesta, salida cruda.
export class HttpQcProvider implements RadiographQcProvider {
  readonly model: ModelRef;
  private readonly cfg: HttpQcProviderConfig;
  constructor(cfg: HttpQcProviderConfig, isAllowedUrl: (u: string, s: string[]) => boolean) {
    if (!isAllowedUrl(cfg.url, cfg.allowedHostSuffixes)) throw new Error('URL del proveedor no permitida.');
    this.cfg = cfg;
    this.model = { ...cfg.model };
  }
  async analyze(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown> {
    const body = new FormData();
    body.set('metadata', JSON.stringify({ sourceId: input.sourceId, sha256: input.sha256, mimeType: input.mimeType, width: input.width, height: input.height, studyTypeDeclared: input.studyTypeDeclared, model: this.model }));
    body.set('image', new Blob([input.bytes], { type: input.mimeType }), 'radiograph');
    const res = await fetch(this.cfg.url, { method: 'POST', headers: { authorization: `Bearer ${this.cfg.apiKey}` }, body, redirect: 'error', signal });
    if (!res.ok) throw new Error(`provider_http_${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > this.cfg.maxResponseBytes) throw new Error('provider_response_too_large');
    const text = await res.text();
    if (text.length > this.cfg.maxResponseBytes) throw new Error('provider_response_too_large');
    return JSON.parse(text);
  }
}

export type ProviderEnv = Record<string, string | undefined>;

// Falla cerrado: sin RADIOGRAPH_QC_PROVIDER no hay motor. Las credenciales sólo viven en env.
export function createQcProvider(env: ProviderEnv, isAllowedUrl: (u: string, s: string[]) => boolean, parseSuffixes: (extra: string | undefined) => string[]): RadiographQcProvider | null {
  const kind = (env.RADIOGRAPH_QC_PROVIDER || '').trim();
  if (kind === 'simulated') return new SimulatedQcProvider();
  if (kind !== 'http') return null;
  const url = env.RADIOGRAPH_QC_URL || '', apiKey = env.RADIOGRAPH_QC_API_KEY || '';
  const model = { provider: env.RADIOGRAPH_QC_PROVIDER_NAME || '', name: env.RADIOGRAPH_QC_MODEL_NAME || '', version: env.RADIOGRAPH_QC_MODEL_VERSION || '' };
  if (!url || !apiKey || !model.provider || !model.name || !model.version) return null;
  return new HttpQcProvider({ url, apiKey, model, timeoutMs: 0, maxResponseBytes: 262_144, allowedHostSuffixes: parseSuffixes(env.RADIOGRAPH_PROVIDER_HOSTS) }, isAllowedUrl);
}
