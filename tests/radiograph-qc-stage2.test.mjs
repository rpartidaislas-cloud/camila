// Radiografía asistida — Etapa 2: control de calidad (radiograph-qc) con proveedor simulado.
// Carga los módulos TS compartidos sin Deno, construye imágenes sintéticas (cabeceras PNG/JPEG
// reales, sin decodificar píxeles) y recorre cada escenario del plan de forma determinista:
// panorámica, periapical, bitewing, rotada, borrosa, recortada, sub/sobreexpuesta, archivo
// falso, hash distinto, respuesta incompleta, timeout sin reintento y duplicado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smyl-radiograph-qc-'));
for (const name of ['radiograph-contracts', 'radiograph-image', 'radiograph-provider', 'radiograph-qc-core']) {
  const js = stripTypeScriptTypes(read(`supabase/functions/_shared/${name}.ts`), { mode: 'strip' })
    .replace(/^import type .*$/gm, '')
    .replace(/from '\.\/([\w-]+)\.ts'/g, "from './$1.mjs'");
  fs.writeFileSync(path.join(dir, `${name}.mjs`), js);
}
const load = name => import(pathToFileURL(path.join(dir, `${name}.mjs`)).href);
const image = await load('radiograph-image');
const providers = await load('radiograph-provider');
const core = await load('radiograph-qc-core');

// --- imágenes sintéticas -------------------------------------------------------------------
const be32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const be16 = n => [n >>> 8 & 255, n & 255];
const ascii = s => [...Buffer.from(s, 'latin1')];
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png({ width, height, hints = [], filler = 4096 }) {
  const chunk = (type, data) => [...be32(data.length), ...ascii(type), ...data, ...be32(crc32([...ascii(type), ...data]))];
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be32(width), ...be32(height), 8, 0, 0, 0, 0]),
    ...(hints.length ? chunk('tEXt', [...ascii('smyl.sim'), 0, ...ascii(hints.join(','))]) : []),
    ...chunk('IDAT', new Array(filler).fill(7)),
    ...chunk('IEND', [])];
  return Uint8Array.from(bytes);
}
function jpeg({ width, height, orientation = null, filler = 4096 }) {
  const seg = (marker, data) => [0xff, marker, ...be16(data.length + 2), ...data];
  const exif = orientation === null ? [] : seg(0xe1, [...ascii('Exif'), 0, 0, 0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]);
  const sof = seg(0xc0, [8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const pad = seg(0xe2, new Array(filler).fill(0));
  return Uint8Array.from([0xff, 0xd8, ...exif, ...sof, ...pad, 0xff, 0xd9]);
}

test('probeRadiograph lee tipo real, dimensiones y orientación sin decodificar', async () => {
  const p = image.probeRadiograph(png({ width: 2400, height: 1200, hints: ['motion_blur:high', 'unusable'] }));
  assert.deepEqual([p.mime, p.width, p.height, p.orientation, p.hints, p.reason], ['image/png', 2400, 1200, 1, ['motion_blur:high', 'unusable'], null]);
  const j = image.probeRadiograph(jpeg({ width: 900, height: 650, orientation: 6 }));
  assert.deepEqual([j.mime, j.width, j.height, j.orientation, j.reason], ['image/jpeg', 900, 650, 6, null]);
  assert.equal(image.probeRadiograph(jpeg({ width: 900, height: 650 })).orientation, 1);
  assert.equal(image.probeRadiograph(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])).mime, null);
  assert.match((await image.sha256Hex(new Uint8Array([1, 2, 3]))), /^[a-f0-9]{64}$/);
});

// --- dependencias falsas: una "base de datos" en memoria con la misma semántica que los RPC ----
const SRC = '55555555-5555-4555-8555-555555555555';
const ENGINE = providers.SIMULATED_MODEL;
function harness({ bytes, mime = 'image/png', declared = 'panoramic', sha = null, size = null, provider = new providers.SimulatedQcProvider(), timeoutMs = 2000, sourceId = SRC }) {
  const logs = [];
  const runs = new Map();
  let calls = 0;
  const wrapped = provider && { model: provider.model, analyze: (i, s) => { calls += 1; return provider.analyze(i, s); } };
  const ready = (async () => ({ sha: sha ?? await image.sha256Hex(bytes), size: size ?? bytes.length }))();
  const deps = {
    requestRun: async (id, _kind, ack) => {
      if (id !== sourceId) return { data: null, error: { code: '42501', message: 'La fuente radiográfica no está disponible.' } };
      const live = [...runs.values()].find(r => r.source_id === id && ['requested', 'completed'].includes(r.status));
      if (live) return { data: structuredClone(live), error: null };
      if (!ack && [...runs.values()].some(r => r.source_id === id && r.status === 'unconfirmed')) return { data: null, error: { code: '23514', message: 'Hay una ejecución sin confirmar; revísala antes de solicitar otra.' } };
      const run = { id: `run-${runs.size + 1}`, tenant_id: 't-a', patient_id: 'p-1', source_id: id, kind: 'qc', status: 'requested', engine: { ...ENGINE }, contract_version: 1, output: null, failure_code: '' };
      runs.set(run.id, run); return { data: structuredClone(run), error: null };
    },
    claimRun: async id => {
      const run = runs.get(id);
      if (!run) return { data: null, error: { code: '42501', message: 'Ejecución desconocida.' } };
      if (run.status !== 'requested' || run.claimed) return { data: null, error: { code: 'PT409', message: 'in_progress' } };
      run.claimed = true; return { data: structuredClone(run), error: null };
    },
    loadSource: async id => { const s = await ready; return id === sourceId ? { id, tenant_id: 't-a', patient_id: 'p-1', bucket: 'smyl-radiographs', storage_path: `t-a/p-1/s/${s.sha}.png`, sha256: s.sha, mime_type: mime, size_bytes: s.size, study_type_declared: declared } : null; },
    download: async () => bytes,
    completeRun: async (id, status, output, failureCode) => {
      const run = runs.get(id);
      if (!run) return { data: null, error: { code: '42501', message: 'Ejecución desconocida.' } };
      if (run.status !== 'requested') return run.status === status && JSON.stringify(run.output) === JSON.stringify(output) ? { data: structuredClone(run), error: null } : { data: null, error: { code: '42501', message: 'La salida original del motor es inmutable.' } };
      Object.assign(run, { status, output, failure_code: failureCode }); return { data: structuredClone(run), error: null };
    },
    provider: wrapped, timeoutMs, log: e => logs.push(e),
  };
  return { deps, logs, runs, calls: () => calls, run: body => core.runRadiographQc(body ?? { sourceId }, deps) };
}

test('panorámica utilizable: clase, sin banderas y ambos análisis habilitados', async () => {
  const h = harness({ bytes: png({ width: 2400, height: 1200 }) });
  const r = await h.run();
  assert.equal(r.status, 200);
  assert.equal(r.body.run.status, 'completed');
  assert.deepEqual([r.body.run.output.studyClass.value, r.body.run.output.quality.status, r.body.run.output.applicableAnalyses], ['panoramic', 'usable', ['tooth_localization', 'finding_candidates']]);
  assert.deepEqual(r.body.run.engine, ENGINE);
  assert.equal(h.calls(), 1);
});

test('periapical y bitewing se clasifican; el tipo declarado distinto queda como alternativa', async () => {
  const peri = await harness({ bytes: png({ width: 600, height: 800 }), declared: 'periapical' }).run();
  assert.equal(peri.body.run.output.studyClass.value, 'periapical');
  assert.deepEqual(peri.body.run.output.studyClass.alternatives, []);
  const bw = await harness({ bytes: jpeg({ width: 900, height: 650, filler: 200000 }), mime: 'image/jpeg', declared: 'panoramic' }).run();
  assert.equal(bw.status, 200);
  assert.equal(bw.body.run.output.studyClass.value, 'bitewing');
  assert.deepEqual(bw.body.run.output.studyClass.alternatives, [{ value: 'panoramic', probability: 0.3 }]);
  assert.equal(bw.body.run.output.studyClass.probability, 0.6);
});

test('rotada (EXIF 6): orientación sospechosa, calidad limitada y señales finas bloqueadas', async () => {
  const r = await harness({ bytes: jpeg({ width: 2400, height: 1200, orientation: 6, filler: 400000 }), mime: 'image/jpeg' }).run();
  assert.equal(r.status, 200);
  const o = r.body.run.output;
  assert.equal(o.quality.status, 'limited');
  assert.deepEqual(o.quality.flags.map(f => [f.code, f.severity]), [['orientation_suspect', 'high']]);
  assert.deepEqual(o.applicableAnalyses, ['tooth_localization']);
  assert.deepEqual(o.blockedAnalyses.map(b => b.code), ['finding_candidates']);
});

test('borrosa, recortada, subexpuesta y sobreexpuesta producen banderas explicadas, nunca diagnóstico', async () => {
  for (const [hint, status] of [['motion_blur:high', 'limited'], ['anatomical_cropping', 'usable'], ['underexposure', 'usable'], ['overexposure', 'usable'], ['anterior_blur:high', 'limited']]) {
    const r = await harness({ bytes: png({ width: 2400, height: 1200, hints: [hint] }) }).run();
    assert.equal(r.status, 200, hint);
    const o = r.body.run.output;
    assert.equal(o.quality.flags[0].code, hint.split(':')[0]);
    assert.equal(o.quality.status, status, hint);
    for (const f of o.quality.flags) assert.doesNotMatch(f.explanation, /diagn|caries|lesi[oó]n/i);
  }
  const two = await harness({ bytes: png({ width: 2400, height: 1200, hints: ['underexposure', 'low_contrast'] }) }).run();
  assert.equal(two.body.run.output.quality.status, 'limited', 'dos banderas moderadas limitan');
});

test('no utilizable: sin análisis aplicables y ambos bloqueados con motivo', async () => {
  const r = await harness({ bytes: png({ width: 2400, height: 1200, hints: ['motion_blur:high', 'unusable'] }) }).run();
  const o = r.body.run.output;
  assert.equal(o.quality.status, 'unusable');
  assert.deepEqual(o.applicableAnalyses, []);
  assert.deepEqual(o.blockedAnalyses.map(b => b.code).sort(), ['finding_candidates', 'tooth_localization']);
});

test('archivo falso, hash distinto, tamaño distinto o dimensiones fuera de rango cierran la ejecución como fallida sin llamar al motor', async () => {
  const cases = [
    ['PNG real declarado como JPEG', harness({ bytes: png({ width: 2400, height: 1200 }), mime: 'image/jpeg' }), /tipo real/],
    ['hash distinto', harness({ bytes: png({ width: 2400, height: 1200 }), sha: 'ab'.repeat(32) }), /huella/],
    ['tamaño distinto', harness({ bytes: png({ width: 2400, height: 1200 }), size: 10 }), /tamaño real/],
    ['dimensiones enormes', harness({ bytes: png({ width: 20000, height: 1200 }) }), /fuera de rango/],
    ['sin dimensiones', harness({ bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, ...Buffer.from('IEND'), 0, 0, 0, 0]) }), /IHDR|dimensiones/],
    ['PDF disfrazado', harness({ bytes: Uint8Array.from([...Buffer.from('%PDF-1.4 '), ...new Array(40).fill(0), ...Buffer.from('%%EOF')]) }), /tipo real/],
  ];
  for (const [label, h, pattern] of cases) {
    const r = await h.run();
    assert.equal(r.status, 422, label);
    assert.equal(r.body.code, /enormes|dimensiones|tipo real|huella|tamaño/.test(label) ? r.body.code : 'source_invalid', label);
    assert.match(r.body.error, pattern, label);
    assert.equal(h.calls(), 0, `${label}: el motor nunca recibe un archivo no verificado`);
    const run = [...h.runs.values()][0];
    assert.deepEqual([run.status, run.failure_code, run.output], ['failed', 'source_invalid', null], label);
  }
});

test('respuesta incompleta del motor: fallida con invalid_output y sin guardar salida parcial', async () => {
  const h = harness({ bytes: png({ width: 2400, height: 1200, hints: ['malformed'] }) });
  const r = await h.run();
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'invalid_output');
  assert.deepEqual([...h.runs.values()].map(x => [x.status, x.failure_code, x.output]), [['failed', 'invalid_output', null]]);
  const crash = harness({ bytes: png({ width: 2400, height: 1200, hints: ['crash'] }) });
  assert.equal((await crash.run()).body.code, 'provider_error');
});

test('un motor que responde con otro modelo/versión se rechaza aunque el JSON sea válido', async () => {
  const other = { model: { provider: 'simulated', name: 'smyl-sim-xray', version: '9.9.9' }, analyze: async i => Object.assign(providers.simulateQc(i), { model: { provider: 'simulated', name: 'smyl-sim-xray', version: '9.9.9' } }) };
  const h = harness({ bytes: png({ width: 2400, height: 1200 }), provider: other });
  const r = await h.run();
  assert.equal(r.status, 503);
  assert.match(r.body.error, /no coincide con el motor registrado/);
  assert.equal(h.calls(), 1 - 1, 'la imagen no sale hacia un motor distinto del registrado');
  // y si el motor coincide pero responde con otra identidad, se rechaza al validar
  const liar = { model: providers.SIMULATED_MODEL, analyze: async i => Object.assign(providers.simulateQc(i), { model: { provider: 'simulated', name: 'smyl-sim-xray', version: '9.9.9' } }) };
  const r2 = await harness({ bytes: png({ width: 2400, height: 1200 }), provider: liar }).run();
  assert.equal(r2.status, 502);
  assert.match(r2.body.error, /no identifica el motor registrado/);
});

test('reclamo atómico: dos invocaciones simultáneas envían la imagen una sola vez', async () => {
  const h = harness({ bytes: png({ width: 2400, height: 1200 }), provider: new providers.SimulatedQcProvider() });
  const [a, b] = await Promise.all([h.run(), h.run()]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal([a, b].find(r => r.status === 409).body.code, 'in_progress');
  assert.equal(h.calls(), 1);
});

test('cualquier fallo después de enviar cierra la ejecución como sin confirmar; antes de enviar, como fallida', async () => {
  const h = harness({ bytes: png({ width: 2400, height: 1200 }) });
  const original = h.deps.completeRun;
  let throwOnce = true;
  h.deps.completeRun = async (...args) => { if (args[1] === 'completed' && throwOnce) { throwOnce = false; throw new Error('db down'); } return original(...args); };
  const r = await h.run();
  assert.equal(r.status, 500);
  assert.deepEqual([...h.runs.values()].map(x => [x.status, x.failure_code]), [['unconfirmed', 'provider_error']]);
  const pre = harness({ bytes: png({ width: 2400, height: 1200 }) });
  pre.deps.download = async () => { throw new Error('storage down'); };
  assert.equal((await pre.run()).status, 500);
  assert.deepEqual([...pre.runs.values()].map(x => [x.status, x.failure_code]), [['failed', 'provider_error']]);
  assert.equal(pre.calls(), 0);
});

test('errores del proveedor: 4xx definitivo falla; 5xx o red quedan sin confirmar; el mensaje del proveedor no se registra', async () => {
  const mk = message => ({ model: providers.SIMULATED_MODEL, analyze: async () => { throw new Error(message); } });
  const rejected = harness({ bytes: png({ width: 2400, height: 1200 }), provider: mk('provider_http_422') });
  await rejected.run();
  assert.deepEqual([...rejected.runs.values()].map(x => x.status), ['failed']);
  for (const message of ['provider_http_503', 'fetch failed', 'provider_http_408']) {
    const h = harness({ bytes: png({ width: 2400, height: 1200 }), provider: mk(message) });
    const r = await h.run();
    assert.deepEqual([...h.runs.values()].map(x => x.status), ['unconfirmed'], message);
    assert.equal(r.status, 502);
  }
  const secret = harness({ bytes: png({ width: 2400, height: 1200 }), provider: mk('Bearer sk-123 leaked https://internal') });
  await secret.run();
  assert.doesNotMatch(JSON.stringify(secret.logs), /sk-123|internal/);
});

test('salida con texto inválido o demasiado grande se rechaza antes de guardarla; el reconocimiento de "sin confirmar" viaja a la base', async () => {
  const big = { model: providers.SIMULATED_MODEL, analyze: async i => Object.assign(providers.simulateQc(i), { applicableAnalyses: [], quality: { status: 'usable', flags: Array.from({ length: 12 }, () => ({ code: 'low_contrast', severity: 'low', region: null, explanation: 'x'.repeat(300) })) } }) };
  const h = harness({ bytes: png({ width: 2400, height: 1200 }), provider: big });
  assert.equal((await h.run()).status, 200, 'dentro del tope');
  const lone = { model: providers.SIMULATED_MODEL, analyze: async i => { const q = providers.simulateQc(i); q.quality.flags = [{ code: 'low_contrast', severity: 'low', region: null, explanation: 'texto \ud800 roto' }]; return q; } };
  const h2 = harness({ bytes: png({ width: 2400, height: 1200 }), provider: lone });
  const r2 = await h2.run();
  assert.equal(r2.body.code, 'invalid_output');
  let acknowledged = null;
  const h3 = harness({ bytes: png({ width: 2400, height: 1200 }) });
  const original = h3.deps.requestRun;
  h3.deps.requestRun = async (id, kind, ack) => { acknowledged = ack; return original(id, kind, ack); };
  await core.runRadiographQc({ sourceId: SRC, acknowledgeUnconfirmed: true }, h3.deps);
  assert.equal(acknowledged, true);
});

test('imagen estricta: CRC del IHDR, un solo IHDR, un solo cuadro JPEG, relleno 0xFF y tope de megapíxeles', async () => {
  const good = png({ width: 2400, height: 1200 });
  const badCrc = Uint8Array.from(good); badCrc[8 + 8 + 13] ^= 0xff; // último byte del CRC del IHDR... (inicio de CRC)
  const flipped = Uint8Array.from(good); flipped[16] ^= 0x01; // altera el ancho sin recalcular CRC
  assert.match(image.probeRadiograph(flipped).reason, /dañada/);
  const doubled = Uint8Array.from([...good.slice(0, 8 + 25), ...good.slice(8, 8 + 25), ...good.slice(8 + 25)]);
  assert.match(image.probeRadiograph(doubled).reason, /más de una cabecera/);
  const twoFrames = (() => { const j = jpeg({ width: 900, height: 650 }); const sof = [0xff, 0xc0, 0, 17, 8, 2, 138, 3, 132, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]; return Uint8Array.from([0xff, 0xd8, ...sof, ...sof, 0xff, 0xd9]); })();
  assert.match(image.probeRadiograph(twoFrames).reason, /más de un cuadro/);
  const filled = (() => { const j = jpeg({ width: 900, height: 650 }); return Uint8Array.from([0xff, 0xd8, 0xff, 0xff, 0xff, ...j.slice(2)]); })();
  assert.equal(image.probeRadiograph(filled).width, 900);
  const huge = harness({ bytes: png({ width: 9000, height: 9000 }) });
  assert.match((await huge.run()).body.error, /fuera de rango/);
  assert.equal(huge.calls(), 0);
  assert.equal(badCrc.length, good.length);
});

test('proveedor HTTP: hosts exactos (sin heredar .supabase.co), simulado sólo con permiso explícito y respuesta limitada por flujo', async () => {
  const env = { RADIOGRAPH_QC_PROVIDER: 'http', RADIOGRAPH_QC_URL: 'https://x.supabase.co/qc', RADIOGRAPH_QC_API_KEY: 'k', RADIOGRAPH_QC_PROVIDER_NAME: 'acme', RADIOGRAPH_QC_MODEL_NAME: 'm', RADIOGRAPH_QC_MODEL_VERSION: '1' };
  assert.equal(providers.createQcProvider(env), null, 'sin lista de hosts no hay proveedor');
  assert.equal(providers.createQcProvider({ ...env, RADIOGRAPH_PROVIDER_HOSTS: 'api.acme.com' }), null, 'un host distinto no hereda .supabase.co');
  assert.ok(providers.createQcProvider({ ...env, RADIOGRAPH_QC_URL: 'https://api.acme.com/qc', RADIOGRAPH_PROVIDER_HOSTS: 'api.acme.com' }));
  assert.equal(providers.createQcProvider({ ...env, RADIOGRAPH_QC_URL: 'https://evil.api.acme.com/qc', RADIOGRAPH_PROVIDER_HOSTS: 'api.acme.com' }), null, 'subdominios no heredan');
  assert.equal(providers.createQcProvider({ RADIOGRAPH_QC_PROVIDER: 'simulated' }), null);
  assert.ok(providers.createQcProvider({ RADIOGRAPH_QC_PROVIDER: 'simulated', RADIOGRAPH_ALLOW_SIMULATED: '1' }));
  assert.equal(providers.createDentalProvider({ RADIOGRAPH_DENTAL_PROVIDER: 'simulated' }), null);
  assert.ok(providers.createDentalProvider({ RADIOGRAPH_DENTAL_PROVIDER: 'simulated', RADIOGRAPH_ALLOW_SIMULATED: '1' }));
  const provider = providers.createQcProvider({ ...env, RADIOGRAPH_QC_URL: 'https://api.acme.com/qc', RADIOGRAPH_PROVIDER_HOSTS: 'api.acme.com' });
  const realFetch = globalThis.fetch;
  try {
    const stream = chunk => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode(chunk)); c.close(); } }), { status: 200 });
    globalThis.fetch = async () => stream('x'.repeat(20000)); // 400 KB sin Content-Length > tope de 256 KB
    await assert.rejects(provider.analyze(providers.simulatedStudyClass ? { sourceId: SRC, sha256: 'a', mimeType: 'image/png', width: 100, height: 100, orientation: 1, studyTypeDeclared: 'unknown', bytes: new Uint8Array(4), hints: [] } : null, new AbortController().signal), /too_large/);
  } finally { globalThis.fetch = realFetch; }
});

test('timeout incierto: la ejecución queda unconfirmed, no se reintenta sola y una nueva solicitud se bloquea', async () => {
  const h = harness({ bytes: png({ width: 2400, height: 1200, hints: ['hang'] }), timeoutMs: 30 });
  const r = await h.run();
  assert.equal(r.status, 504);
  assert.equal(r.body.code, 'timeout');
  assert.deepEqual([...h.runs.values()].map(x => [x.status, x.failure_code]), [['unconfirmed', 'timeout']]);
  assert.equal(h.calls(), 1);
  const again = await h.run();
  assert.equal(again.status, 409);
  assert.match(again.body.error, /sin confirmar/);
  assert.equal(h.calls(), 1, 'ningún reintento automático');
});

test('duplicado: la segunda solicitud reutiliza la ejecución completada sin llamar al motor', async () => {
  const h = harness({ bytes: png({ width: 2400, height: 1200 }) });
  const first = await h.run();
  const second = await h.run();
  assert.equal(second.status, 200);
  assert.equal(second.body.reused, true);
  assert.equal(second.body.run.id, first.body.run.id);
  assert.equal(h.calls(), 1);
});

test('sin motor configurado no se registra ninguna solicitud; fuente ajena o cuerpo inválido se rechazan antes de descargar', async () => {
  const none = harness({ bytes: png({ width: 2400, height: 1200 }), provider: null });
  assert.equal((await none.run()).status, 503);
  assert.equal(none.runs.size, 0);
  const h = harness({ bytes: png({ width: 2400, height: 1200 }) });
  assert.equal((await h.run({ sourceId: 'no-uuid' })).status, 400);
  assert.equal((await h.run({ sourceId: '00000000-0000-4000-8000-000000000000' })).status, 403);
  assert.equal(h.runs.size, 0);
});

test('los logs sólo llevan ids y códigos: nunca imagen, base64, salida del motor ni texto clínico', async () => {
  const h = harness({ bytes: png({ width: 2400, height: 1200, hints: ['motion_blur:high'] }) });
  await h.run(); await h.run();
  const text = JSON.stringify(h.logs);
  assert.ok(text.length < 1500, text.length);
  assert.doesNotMatch(text, /bytes|base64|explanation|flags":\[|storage_path|sha256/);
  assert.deepEqual(h.logs.map(l => l.event), ['run_completed', 'run_reused']);
});

test('contrato estático: función dedicada, autorización en la base con la sesión del usuario, sin redirecciones ni URLs del cliente', () => {
  const index = read('supabase/functions/radiograph-qc/index.ts');
  const prov = read('supabase/functions/_shared/radiograph-provider.ts');
  const coreSrc = read('supabase/functions/_shared/radiograph-qc-core.ts');
  assert.match(index, /requireUser\(req, CORS\)/);
  assert.match(index, /asUser\.rpc\('smyl_radiograph_request_ai_run'/);
  assert.match(index, /admin\.rpc\('smyl_radiograph_complete_ai_run'/);
  assert.match(index, /admin\.storage\.from\(bucket\)\.download\(path\)/);
  assert.doesNotMatch(index + prov + coreSrc, /from ['"][^'"]*segment-teeth|segment_teeth|createSignedUrl|body\.url|body\.path|body\.image/);
  assert.match(prov, /redirect: 'error'/);
  assert.match(prov, /isAllowedProviderUrl\(cfg\.url, cfg\.allowedHosts\)/);
  assert.doesNotMatch(coreSrc, /Deno\.|console\./, 'el núcleo no depende de Deno ni escribe logs por su cuenta');
  assert.match(coreSrc, /const requested = await deps\.requestRun\(sourceId, kind, [^;]*;[\s\S]*await deps\.claimRun\(run\.id\)[\s\S]*await deps\.loadSource\(run\.source_id\)/, 'la base autoriza antes de usar service_role');
  assert.equal(fs.existsSync(new URL('../mobile/www/radiograph-qc', import.meta.url)), false);
});
