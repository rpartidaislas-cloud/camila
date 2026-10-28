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
function png({ width, height, hints = [], filler = 4096 }) {
  const chunk = (type, data) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
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
    requestRun: async id => {
      if (id !== sourceId) return { data: null, error: { code: '42501', message: 'La fuente radiográfica no está disponible.' } };
      const live = [...runs.values()].find(r => r.source_id === id && ['requested', 'completed'].includes(r.status));
      if (live) return { data: structuredClone(live), error: null };
      if ([...runs.values()].some(r => r.source_id === id && r.status === 'unconfirmed')) return { data: null, error: { code: '23514', message: 'Hay una ejecución sin confirmar; revísala antes de solicitar otra.' } };
      const run = { id: `run-${runs.size + 1}`, tenant_id: 't-a', patient_id: 'p-1', source_id: id, kind: 'qc', status: 'requested', engine: { ...ENGINE }, contract_version: 1, output: null, failure_code: '' };
      runs.set(run.id, run); return { data: structuredClone(run), error: null };
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
    ['sin dimensiones', harness({ bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, ...Buffer.from('IEND'), 0, 0, 0, 0]) }), /dimensiones/],
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
  const r = await harness({ bytes: png({ width: 2400, height: 1200 }), provider: other }).run();
  assert.equal(r.status, 502);
  assert.match(r.body.error, /no identifica el motor registrado/);
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
  assert.match(prov, /isAllowedUrl\(cfg\.url, cfg\.allowedHostSuffixes\)/);
  assert.doesNotMatch(coreSrc, /Deno\.|console\./, 'el núcleo no depende de Deno ni escribe logs por su cuenta');
  assert.match(coreSrc, /const requested = await deps\.requestRun\(sourceId, kind\);[\s\S]*await deps\.loadSource\(run\.source_id\)/, 'la base autoriza antes de usar service_role');
  assert.equal(fs.existsSync(new URL('../mobile/www/radiograph-qc', import.meta.url)), false);
});
