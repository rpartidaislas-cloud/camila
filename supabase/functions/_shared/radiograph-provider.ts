// Adaptador de proveedor para el control de calidad radiográfico (plan §7). La UI nunca habla con
// un proveedor: el núcleo recibe un RadiographQcProvider y valida su respuesta con el contrato.
// Reglas del adaptador: credenciales ocultas, timeout y tamaño impuestos, sin redirecciones,
// salida cruda que el núcleo valida (falla cerrado), versión exacta del modelo, y un proveedor
// simulado determinista para pruebas y pilotos sin motor real.

import { ANALYSES, FINDING_CATEGORIES, QC_FLAG_CODES, type FindingCandidateSetV1, type ModelRef, type RadiographQcResultV1, type ToothCandidateSetV1 } from './radiograph-contracts.ts';

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

// Clase de estudio simulada a partir de la relación de aspecto (misma regla en QC y localización).
export function simulatedStudyClass(input: VerifiedRadiographSource): 'panoramic' | 'bitewing' | 'periapical' | 'unknown' {
  const ratio = input.width / input.height;
  return ratio >= 1.8 ? 'panoramic' : ratio >= 1.15 && input.width <= 1600 ? 'bitewing' : ratio < 1.15 ? 'periapical' : 'unknown';
}

export function simulateQc(input: VerifiedRadiographSource): RadiographQcResultV1 {
  const derived = simulatedStudyClass(input);
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
  allowedHosts: string[];
}

// Lista EXACTA de hosts (no sufijos): el proveedor de IA nunca hereda el comodín .supabase.co ni subdominios.
export function parseProviderHosts(raw: string | null | undefined): string[] {
  return Array.from(new Set(String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s))));
}
export function isAllowedProviderUrl(raw: unknown, hosts: string[]): boolean {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  return hosts.includes(host);
}

export type AnalysisKind = 'qc' | 'tooth_localization' | 'finding_candidates';

// Adaptador HTTP genérico: https permitido, sin redirecciones, tope de respuesta, salida cruda.
// El tipo de análisis viaja en los metadatos; cada proveedor real necesitará su propio mapeo.
export class HttpRadiographProvider {
  readonly model: ModelRef;
  private readonly cfg: HttpQcProviderConfig;
  constructor(cfg: HttpQcProviderConfig) {
    if (!isAllowedProviderUrl(cfg.url, cfg.allowedHosts)) throw new Error('URL del proveedor no permitida.');
    this.cfg = cfg;
    this.model = { ...cfg.model };
  }
  async request(kind: AnalysisKind, input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown> {
    const body = new FormData();
    body.set('metadata', JSON.stringify({ kind, sourceId: input.sourceId, sha256: input.sha256, mimeType: input.mimeType, width: input.width, height: input.height, studyTypeDeclared: input.studyTypeDeclared, model: this.model }));
    body.set('image', new Blob([input.bytes], { type: input.mimeType }), 'radiograph');
    const res = await fetch(this.cfg.url, { method: 'POST', headers: { authorization: `Bearer ${this.cfg.apiKey}` }, body, redirect: 'error', signal });
    if (!res.ok) throw new Error(`provider_http_${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > this.cfg.maxResponseBytes) throw new Error('provider_response_too_large');
    // Lectura por flujo con tope: un proveedor que no declara longitud no puede llenar la memoria.
    const reader = res.body?.getReader();
    if (!reader) throw new Error('provider_empty_response');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.cfg.maxResponseBytes) { await reader.cancel().catch(() => undefined); throw new Error('provider_response_too_large'); }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
    return JSON.parse(new TextDecoder().decode(all));
  }
}

export class HttpQcProvider extends HttpRadiographProvider implements RadiographQcProvider {
  analyze(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown> { return this.request('qc', input, signal); }
}

// ---------------------------------------------------------------------------------------------
// Etapa 3: localización dental y señales candidatas (plan §7, DentalXrayProvider).
// ---------------------------------------------------------------------------------------------
export interface DentalXrayProvider {
  readonly model: ModelRef;
  localizeTeeth(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown>;
  analyzeCandidates(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown>;
}

export class HttpDentalXrayProvider extends HttpRadiographProvider implements DentalXrayProvider {
  localizeTeeth(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown> { return this.request('tooth_localization', input, signal); }
  analyzeCandidates(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown> { return this.request('finding_candidates', input, signal); }
}

export const SIMULATED_DENTAL_MODEL: ModelRef = { provider: 'simulated', name: 'smyl-sim-dental', version: '0.1.0' };
const UPPER_FDI = ['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28'];
const LOWER_FDI = ['48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38'];
const THIRD_MOLARS = new Set(['18','28','38','48']);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const box = (x0: number, y0: number, x1: number, y1: number): ToothCandidateSetV1['candidates'][number]['geometry'] =>
  ({ kind: 'polygon', coordinateSpace: 'source-normalized', points: [[r3(x0), r3(y0)], [r3(x1), r3(y0)], [r3(x1), r3(y1)], [r3(x0), r3(y1)]] });

// Geometrías deterministas por clase de estudio. Un diente "missing:<fdi>" simplemente no se
// emite (el modelo no lo ve): nunca se produce una afirmación de ausencia.
export function simulatedToothLayout(input: VerifiedRadiographSource): { fdi: string; geometry: ToothCandidateSetV1['candidates'][number]['geometry']; anterior: boolean }[] {
  const cls = simulatedStudyClass(input);
  const row = (list: string[], y0: number, y1: number, x0: number, span: number) =>
    list.map((fdi, i) => ({ fdi, geometry: box(x0 + i * (span / list.length), y0, x0 + (i + 0.92) * (span / list.length), y1), anterior: ['3','2','1'].includes(fdi[1]) }));
  if (cls === 'panoramic') return [...row(UPPER_FDI, 0.30, 0.48, 0.08, 0.84), ...row(LOWER_FDI, 0.52, 0.70, 0.08, 0.84)];
  if (cls === 'bitewing') return [...row(['17','16','15','14'], 0.12, 0.48, 0.10, 0.80), ...row(['47','46','45','44'], 0.52, 0.88, 0.10, 0.80)];
  if (cls === 'periapical') return row(['37','36','35'], 0.25, 0.80, 0.12, 0.76);
  return [];
}

const hintArg = (hints: string[], key: string): string[] => hints.filter((h) => h.startsWith(key + ':')).map((h) => h.slice(key.length + 1));

export function simulateTeeth(input: VerifiedRadiographSource): ToothCandidateSetV1 {
  const missing = new Set(hintArg(input.hints, 'missing'));
  const uncertain = new Set(hintArg(input.hints, 'uncertain'));
  const candidates = simulatedToothLayout(input).filter((t) => !missing.has(t.fdi)).map((t) => {
    const neighbour = String(Number(t.fdi) + (Number(t.fdi) % 10 === 8 ? -1 : 1));
    const unsure = uncertain.has(t.fdi);
    return {
      candidateId: `t-${t.fdi}`,
      fdiCandidate: t.fdi,
      fdiProbability: unsure ? 0.55 : t.anterior ? 0.8 : 0.92,
      geometry: t.geometry,
      visibility: (THIRD_MOLARS.has(t.fdi) ? 'partial' : 'complete') as 'partial' | 'complete',
      alternatives: unsure ? [{ fdi: neighbour, probability: 0.35 }] : t.anterior ? [{ fdi: neighbour, probability: 0.12 }] : [],
    };
  });
  return { schema: 1, sourceId: input.sourceId, model: { ...SIMULATED_DENTAL_MODEL }, candidates };
}

// El modelo simulado NO inventa señales clínicas: sólo emite las que piden las pistas de prueba
// (`finding:<categoría>@<fdi>`), siempre como candidato con región y limitaciones.
export function simulateFindings(input: VerifiedRadiographSource): FindingCandidateSetV1 {
  const layout = new Map(simulatedToothLayout(input).map((t) => [t.fdi, t.geometry]));
  const candidates: FindingCandidateSetV1['candidates'] = [];
  for (const spec of hintArg(input.hints, 'finding')) {
    const [category, fdi] = spec.split('@');
    if (!(FINDING_CATEGORIES as readonly string[]).includes(category)) continue;
    const geometry = (fdi && layout.get(fdi)) || box(0.4, 0.4, 0.6, 0.6);
    candidates.push({
      candidateId: `f-${category}-${fdi || 'na'}`,
      toothCandidate: fdi && layout.has(fdi) ? fdi : null,
      category: category as FindingCandidateSetV1['candidates'][number]['category'],
      label: category === 'apparently_missing' ? 'Pieza aparentemente no visible' : `Patrón compatible con ${category.replace(/_/g, ' ')} (candidato)`,
      confidence: 0.7,
      evidenceLevel: 'model_candidate',
      regions: [geometry],
      explanation: 'Señal visual simulada que requiere comprobación profesional.',
      limitations: ['Proveedor simulado: sin validación clínica.'],
    });
  }
  return { schema: 1, sourceId: input.sourceId, model: { ...SIMULATED_DENTAL_MODEL }, candidates };
}

export class SimulatedDentalXrayProvider implements DentalXrayProvider {
  readonly model = SIMULATED_DENTAL_MODEL;
  localizeTeeth(input: VerifiedRadiographSource, signal: AbortSignal): Promise<unknown> {
    if (input.hints.includes('malformed')) return Promise.resolve({ schema: 1, sourceId: input.sourceId, candidates: [{ candidateId: 'x' }] });
    if (input.hints.includes('hang')) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))));
    return Promise.resolve(simulateTeeth(input));
  }
  analyzeCandidates(input: VerifiedRadiographSource): Promise<unknown> {
    if (input.hints.includes('malformed')) return Promise.resolve({ schema: 1, sourceId: input.sourceId, candidates: [{ candidateId: 'x' }] });
    return Promise.resolve(simulateFindings(input));
  }
}

// Un proveedor simulado genera geometría sintética: sólo se instancia con RADIOGRAPH_ALLOW_SIMULATED=1 (demostración).
const simulatedAllowed = (env: ProviderEnv): boolean => env.RADIOGRAPH_ALLOW_SIMULATED === '1';

export function createDentalProvider(env: ProviderEnv): DentalXrayProvider | null {
  const kind = (env.RADIOGRAPH_DENTAL_PROVIDER || '').trim();
  if (kind === 'simulated') return simulatedAllowed(env) ? new SimulatedDentalXrayProvider() : null;
  if (kind !== 'http') return null;
  const url = env.RADIOGRAPH_DENTAL_URL || '', apiKey = env.RADIOGRAPH_DENTAL_API_KEY || '';
  const model = { provider: env.RADIOGRAPH_DENTAL_PROVIDER_NAME || '', name: env.RADIOGRAPH_DENTAL_MODEL_NAME || '', version: env.RADIOGRAPH_DENTAL_MODEL_VERSION || '' };
  if (!url || !apiKey || !model.provider || !model.name || !model.version) return null;
  try { return new HttpDentalXrayProvider({ url, apiKey, model, timeoutMs: 0, maxResponseBytes: 262_144, allowedHosts: parseProviderHosts(env.RADIOGRAPH_PROVIDER_HOSTS) }); } catch { return null; }
}

export type ProviderEnv = Record<string, string | undefined>;

// Falla cerrado: sin RADIOGRAPH_QC_PROVIDER no hay motor. Las credenciales sólo viven en env.
export function createQcProvider(env: ProviderEnv): RadiographQcProvider | null {
  const kind = (env.RADIOGRAPH_QC_PROVIDER || '').trim();
  if (kind === 'simulated') return simulatedAllowed(env) ? new SimulatedQcProvider() : null;
  if (kind !== 'http') return null;
  const url = env.RADIOGRAPH_QC_URL || '', apiKey = env.RADIOGRAPH_QC_API_KEY || '';
  const model = { provider: env.RADIOGRAPH_QC_PROVIDER_NAME || '', name: env.RADIOGRAPH_QC_MODEL_NAME || '', version: env.RADIOGRAPH_QC_MODEL_VERSION || '' };
  if (!url || !apiKey || !model.provider || !model.name || !model.version) return null;
  try { return new HttpQcProvider({ url, apiKey, model, timeoutMs: 0, maxResponseBytes: 262_144, allowedHosts: parseProviderHosts(env.RADIOGRAPH_PROVIDER_HOSTS) }); } catch { return null; }
}
