// SMYL radiografía asistida — contratos v2 (schema 1) para Edge Functions.
// Espejo tipado de smyl-radiograph-contracts.js; ambos se comprueban contra los mismos
// vectores (tests/fixtures/radiograph-contracts) junto con los validadores SQL.
// Falla cerrado: cualquier campo extra, enumeración desconocida, probabilidad fuera de [0,1]
// o geometría degenerada rechaza la respuesta completa del proveedor.

export const RADIOGRAPH_CONTRACT_VERSION = 1;
export const STUDY_CLASSES = ["panoramic", "periapical", "bitewing", "intraoral_series", "unknown"] as const;
export const QUALITY_STATES = ["usable", "limited", "unusable"] as const;
export const QC_FLAG_CODES = ["motion_blur", "anterior_blur", "anatomical_cropping", "underexposure", "overexposure", "low_contrast", "overlap", "compression_artifacts", "orientation_suspect", "foreign_object", "unknown_study_class"] as const;
export const SEVERITIES = ["low", "moderate", "high"] as const;
export const ANALYSES = ["tooth_localization", "finding_candidates"] as const;
export const VISIBILITIES = ["complete", "partial", "not_evaluable"] as const;
export const FINDING_CATEGORIES = ["restoration", "crown", "implant", "endodontic", "apparently_missing", "density", "contour", "support", "development", "other"] as const;
export const EVIDENCE_LEVELS = ["model_candidate"] as const;
export const DECISION_STATES = ["pending", "confirmed", "corrected", "rejected"] as const;
export const REPORT_PRIORITIES = ["routine", "soon", "urgent"] as const;
export const REPORT_SECTIONS = ["description", "technicalLimitations", "clinicalCorrelation", "missingInformation", "complementaryStudies"] as const;

export type StudyClass = typeof STUDY_CLASSES[number];
export type QualityState = typeof QUALITY_STATES[number];
export type Analysis = typeof ANALYSES[number];
export type GeometryKind = "point" | "bbox" | "polygon";
export interface Geometry { kind: GeometryKind; coordinateSpace: "source-normalized"; points: [number, number][] }
export interface ModelRef { provider: string; name: string; version: string }
export interface RadiographQcResultV1 {
  schema: 1;
  studyClass: { value: StudyClass; probability: number; alternatives: { value: StudyClass; probability: number }[] };
  quality: { status: QualityState; flags: { code: typeof QC_FLAG_CODES[number]; severity: typeof SEVERITIES[number]; region: Geometry | null; explanation: string }[] };
  applicableAnalyses: Analysis[];
  blockedAnalyses: { code: Analysis; reason: string }[];
  model: ModelRef;
}
export interface ToothCandidateV1 { candidateId: string; fdiCandidate: string; fdiProbability: number; geometry: Geometry; visibility: typeof VISIBILITIES[number]; alternatives: { fdi: string; probability: number }[] }
export interface ToothCandidateSetV1 { schema: 1; sourceId: string; model: ModelRef; candidates: ToothCandidateV1[] }
export interface FindingCandidateV1 { candidateId: string; toothCandidate: string | null; category: typeof FINDING_CATEGORIES[number]; label: string; confidence: number; evidenceLevel: "model_candidate"; regions: Geometry[]; explanation: string; limitations: string[] }
export interface FindingCandidateSetV1 { schema: 1; sourceId: string; model: ModelRef; candidates: FindingCandidateV1[] }
export interface RadiographReportV1 { schema: 1; sections: Record<typeof REPORT_SECTIONS[number], string>; findings: { candidateId: string; tooth: string | null; text: string; priority: typeof REPORT_PRIORITIES[number] }[] }

const FDI = /^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CANDIDATE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
// Se normaliza antes de buscar (NFKD, sin marcas ni caracteres invisibles, minúsculas): idéntico en SQL y JS.
const FORBIDDEN_CLAIM = /(diagnos|confirmad|confirmed|confirm[ao]\b|certeza|certain|certitud|definitiv|definite|inequivoc|unequivocal|sin duda|without doubt|concluyente|conclusive|patognomon|pathognomon|seguro de|es una caries|is a caries)/;
const forbidden = (v: unknown): boolean => FORBIDDEN_CLAIM.test(String(v).normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g, ""));

type Dict = Record<string, unknown>;
const fail = (m: string): never => { throw new Error(m); };
const isObj = (v: unknown): v is Dict => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (o: unknown, keys: readonly string[]): o is Dict => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const cp = (s: string): number => [...s].length; // code points, igual que char_length en SQL
const text = (v: unknown, min: number, max: number): v is string => typeof v === "string" && cp(v) <= max && cp(v.trim()) >= min && cp(v.trim()) <= max;
const prob = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const fdi = (v: unknown): v is string => typeof v === "string" && FDI.test(v);
const candidateId = (v: unknown): v is string => typeof v === "string" && CANDIDATE_ID.test(v);
const includes = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const model = (m: unknown): m is ModelRef => exact(m, ["provider", "name", "version"]) && text(m.provider, 1, 60) && text(m.name, 1, 80) && text(m.version, 1, 60);

export function isGeometry(g: unknown, allowPoint: boolean): g is Geometry {
  if (!exact(g, ["kind", "coordinateSpace", "points"]) || g.coordinateSpace !== "source-normalized" || !Array.isArray(g.points)) return false;
  if (!["point", "bbox", "polygon"].includes(String(g.kind)) || (g.kind === "point" && !allowPoint)) return false;
  const points = g.points as unknown[];
  let prev: [number, number] | null = null;
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !prob(p[0]) || !prob(p[1])) return false;
    if (prev && prev[0] === p[0] && prev[1] === p[1]) return false;
    prev = [p[0], p[1]];
  }
  const pts = points as [number, number][];
  const n = pts.length;
  if (g.kind === "point") return n === 1;
  if (g.kind === "bbox") return n === 2 && pts[1][0] > pts[0][0] && pts[1][1] > pts[0][1];
  if (n < 3 || n > 64) return false;
  if (pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1]) return false;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(area) / 2 >= 0.000001 - 0.000000000001;
}

export function parseRadiographQc(value: unknown): RadiographQcResultV1 {
  if (!exact(value, ["schema", "studyClass", "quality", "applicableAnalyses", "blockedAnalyses", "model"]) || value.schema !== 1 || !model(value.model)) fail("Resultado de control de calidad no válido.");
  const v = value as Dict;
  const sc = v.studyClass;
  if (!exact(sc, ["value", "probability", "alternatives"]) || !includes(STUDY_CLASSES, sc.value) || !prob(sc.probability) || !Array.isArray(sc.alternatives) || sc.alternatives.length > 4) fail("Clase de estudio no válida.");
  const scd = sc as Dict;
  const seen = new Set<string>([String(scd.value)]);
  for (const a of scd.alternatives as unknown[]) {
    if (!exact(a, ["value", "probability"]) || !includes(STUDY_CLASSES, a.value) || seen.has(a.value) || !prob(a.probability)) fail("Alternativa de clase de estudio no válida.");
    seen.add(String((a as Dict).value));
  }
  const q = v.quality;
  if (!exact(q, ["status", "flags"]) || !includes(QUALITY_STATES, q.status) || !Array.isArray(q.flags) || q.flags.length > 12) fail("Calidad radiográfica no válida.");
  const qd = q as Dict;
  for (const f of qd.flags as unknown[]) {
    if (!exact(f, ["code", "severity", "region", "explanation"]) || !includes(QC_FLAG_CODES, f.code) || !includes(SEVERITIES, f.severity) || !text(f.explanation, 1, 300) || !(f.region === null || isGeometry(f.region, true))) fail("Bandera de calidad no válida.");
  }
  if (!Array.isArray(v.applicableAnalyses) || !Array.isArray(v.blockedAnalyses)) fail("Análisis aplicables no válidos.");
  const applicable = new Set<string>();
  for (const a of v.applicableAnalyses as unknown[]) { if (!includes(ANALYSES, a) || applicable.has(a)) fail("Análisis aplicable no válido."); applicable.add(a as string); }
  const blocked = new Set<string>();
  for (const b of v.blockedAnalyses as unknown[]) {
    if (!exact(b, ["code", "reason"]) || !includes(ANALYSES, b.code) || applicable.has(b.code) || blocked.has(b.code) || !text(b.reason, 1, 300)) fail("Análisis bloqueado no válido.");
    blocked.add(String((b as Dict).code));
  }
  if ((qd.flags as Dict[]).some((f) => forbidden(f.explanation)) || (v.blockedAnalyses as Dict[]).some((b) => forbidden(b.reason))) fail("El modelo no puede presentar una señal como diagnóstico o certeza.");
  if (qd.status === "unusable" && applicable.size) fail("Una imagen no utilizable no habilita análisis.");
  return structuredClone(value) as RadiographQcResultV1;
}

export function parseToothCandidateSet(value: unknown): ToothCandidateSetV1 {
  if (!exact(value, ["schema", "sourceId", "model", "candidates"]) || value.schema !== 1 || !UUID.test(String(value.sourceId)) || !model(value.model) || !Array.isArray(value.candidates) || value.candidates.length > 64) fail("Conjunto de piezas candidatas no válido.");
  const ids = new Set<string>();
  for (const c of (value as Dict).candidates as unknown[]) {
    if (!exact(c, ["candidateId", "fdiCandidate", "fdiProbability", "geometry", "visibility", "alternatives"]) || !candidateId(c.candidateId) || ids.has(c.candidateId)
      || !fdi(c.fdiCandidate) || !prob(c.fdiProbability) || !isGeometry(c.geometry, false) || !includes(VISIBILITIES, c.visibility) || !Array.isArray(c.alternatives) || c.alternatives.length > 3) fail("Pieza candidata no válida.");
    const cd = c as Dict;
    ids.add(String(cd.candidateId));
    const alts = new Set<string>([String(cd.fdiCandidate)]);
    for (const a of cd.alternatives as unknown[]) {
      if (!exact(a, ["fdi", "probability"]) || !fdi(a.fdi) || alts.has(a.fdi) || !prob(a.probability)) fail("Alternativa FDI no válida.");
      alts.add(String((a as Dict).fdi));
    }
  }
  return structuredClone(value) as ToothCandidateSetV1;
}

export function parseFindingCandidateSet(value: unknown): FindingCandidateSetV1 {
  if (!exact(value, ["schema", "sourceId", "model", "candidates"]) || value.schema !== 1 || !UUID.test(String(value.sourceId)) || !model(value.model) || !Array.isArray(value.candidates) || value.candidates.length > 48) fail("Conjunto de señales candidatas no válido.");
  const ids = new Set<string>();
  for (const c of (value as Dict).candidates as unknown[]) {
    if (!exact(c, ["candidateId", "toothCandidate", "category", "label", "confidence", "evidenceLevel", "regions", "explanation", "limitations"]) || !candidateId(c.candidateId) || ids.has(c.candidateId)
      || !(c.toothCandidate === null || fdi(c.toothCandidate)) || !includes(FINDING_CATEGORIES, c.category) || !text(c.label, 1, 120) || !prob(c.confidence)
      || !includes(EVIDENCE_LEVELS, c.evidenceLevel) || !Array.isArray(c.regions) || c.regions.length < 1 || c.regions.length > 4 || !text(c.explanation, 1, 300)
      || !Array.isArray(c.limitations) || c.limitations.length > 6) fail("Señal candidata no válida.");
    const cd = c as Dict;
    if (forbidden(cd.label) || forbidden(cd.explanation) || (cd.limitations as unknown[]).some(forbidden)) fail("El modelo no puede presentar una señal como diagnóstico o certeza.");
    ids.add(String(cd.candidateId));
    for (const r of cd.regions as unknown[]) if (!isGeometry(r, false)) fail("Región de señal no válida.");
    for (const l of cd.limitations as unknown[]) if (!text(l, 1, 200)) fail("Limitación de señal no válida.");
  }
  return structuredClone(value) as FindingCandidateSetV1;
}

export function parseRadiographReport(value: unknown, strict: boolean): RadiographReportV1 {
  if (!exact(value, ["schema", "sections", "findings"]) || value.schema !== 1 || !Array.isArray(value.findings) || value.findings.length > 48) fail("Informe radiográfico no válido.");
  const v = value as Dict;
  if (!exact(v.sections, REPORT_SECTIONS)) fail("Secciones del informe no válidas.");
  const sections = v.sections as Dict;
  for (const k of REPORT_SECTIONS) if (!text(sections[k], 0, 4000)) fail("Sección del informe demasiado larga.");
  if (strict && String(sections.description).trim().length < 2) fail("Completa la descripción radiográfica antes de firmar.");
  const ids = new Set<string>();
  for (const f of v.findings as unknown[]) {
    if (!exact(f, ["candidateId", "tooth", "text", "priority"]) || !UUID.test(String(f.candidateId)) || ids.has(String(f.candidateId)) || !(f.tooth === null || fdi(f.tooth)) || !text(f.text, 1, 600) || !includes(REPORT_PRIORITIES, f.priority)) fail("Hallazgo del informe no válido.");
    ids.add(String((f as Dict).candidateId));
  }
  return structuredClone(value) as RadiographReportV1;
}

export function parseRadiographOutput(kind: "qc" | "tooth_localization" | "finding_candidates", value: unknown): RadiographQcResultV1 | ToothCandidateSetV1 | FindingCandidateSetV1 {
  if (kind === "qc") return parseRadiographQc(value);
  if (kind === "tooth_localization") return parseToothCandidateSet(value);
  if (kind === "finding_candidates") return parseFindingCandidateSet(value);
  return fail("Tipo de análisis desconocido.");
}

// Decisión profesional: sólo una corrección lleva datos (fdi, label, geometry, visibility).
export function parseDecisionPayload(state: string, payload: unknown): Record<string, unknown> {
  if (!includes(DECISION_STATES, state) || state === "pending") fail("Estado de decisión no válido.");
  const p = payload == null ? {} : payload;
  if (state !== "corrected") { if (!isObj(p) || Object.keys(p).length) fail("Sólo una corrección lleva datos."); return {}; }
  if (!isObj(p) || !Object.keys(p).length || !Object.keys(p).every((k) => ["fdi", "label", "geometry", "visibility"].includes(k))
    || (Object.hasOwn(p, "fdi") && !(p.fdi === null || fdi(p.fdi))) || (Object.hasOwn(p, "label") && !text(p.label, 1, 200))
    || (Object.hasOwn(p, "geometry") && !isGeometry(p.geometry, false)) || (Object.hasOwn(p, "visibility") && !includes(VISIBILITIES, p.visibility))) fail("Corrección no válida.");
  return structuredClone(p);
}

export const hasForbiddenClaim = forbidden;
export const isFdi = fdi;
