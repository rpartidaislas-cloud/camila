// Análisis de radiografía con Opus 5.5 fijado por el servidor, y medición de lo que consume cada análisis.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const mod = await import('../supabase/functions/_shared/radiograph-claude.ts');

test('el servidor fija modelo, esfuerzo y esquema; el navegador solo manda prompt e imagen', () => {
  assert.equal(mod.RADIOGRAPH_ACTION, 'analyze_dental_radiograph_v1');
  assert.equal(mod.RADIOGRAPH_MODEL, 'claude-opus-5-5');
  assert.ok(mod.RADIOGRAPH_TIMEOUT_MS < 130000, 'debe cortar antes que el navegador (130 s)');
  const fn = read('supabase/functions/claude/index.ts');
  assert.match(fn, /body\.action === RADIOGRAPH_ACTION[\s\S]{0,400}anthropicBody\.model = RADIOGRAPH_MODEL/);
  assert.match(fn, /output_config = \{\s*effort: RADIOGRAPH_EFFORT,\s*format: \{ type: "json_schema", schema: RADIOGRAPH_SCHEMA \}/);
  assert.match(fn, /body\?\.action === RADIOGRAPH_ACTION\) \{\s*if \(!user \|\| user\.id !== tenantEfectivo\)/, 'solo sesión profesional');
  const client = read('smyl-radiograph-analysis-client.js');
  assert.match(client, /action:'analyze_dental_radiograph_v1'/);
  assert.doesNotMatch(client, /JSON\.stringify\(\{model,/, 'el navegador no elige modelo');
  assert.match(client, /2576\/Math\.max/);
});

test('el esquema obliga a dar ubicación y cuadro, y deja el diente como null real si no se puede situar', () => {
  const s = mod.RADIOGRAPH_SCHEMA;
  assert.deepEqual(s.required, ['schema', 'quality', 'qualityNote', 'observations', 'limitations']);
  const o = s.properties.observations.items;
  assert.deepEqual(o.required, ['id', 'category', 'tooth', 'observation', 'evidence', 'x', 'y', 'w', 'h']);
  assert.equal(o.additionalProperties, false);
  assert.deepEqual(o.properties.tooth.anyOf.map(x => x.type), ['string', 'null']);
  for (const k of ['x', 'y', 'w', 'h']) assert.equal(o.properties[k].type, 'number', k + ' sin null: siempre una estimación');
});

test('la respuesta al navegador solo lleva bloques de texto (sin razonamiento)', () => {
  const out = mod.textOnly({ id: 'msg_1', stop_reason: 'end_turn', usage: {}, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{}' }] });
  assert.deepEqual(out.content, [{ type: 'text', text: '{}' }]);
  assert.equal(out.id, 'msg_1');
});

test('el costo estimado usa los tokens reales y la tarifa del modelo', () => {
  // 3,000 de entrada a $4/M + 2,500 de salida a $20/M = 0.012 + 0.05
  assert.equal(mod.estimateCostUsd('claude-opus-5-5', { input_tokens: 3000, output_tokens: 2500 }), 0.062);
  assert.equal(mod.estimateCostUsd('claude-opus-5-5', { input_tokens: 1000000, cache_read_input_tokens: 1000000 }), 4.2);
  assert.equal(mod.estimateCostUsd('modelo-desconocido', { input_tokens: 10 }), null);
  assert.equal(mod.estimateCostUsd('claude-opus-5-5', null), null);
});

test('la fila de consumo no guarda imágenes ni respuestas, y sanea los valores', () => {
  const row = mod.usageRow({ tenantId: 't', requestId: 'r'.repeat(300), outcome: 'ok', durationMs: 41234.7,
    usage: { input_tokens: 3100, output_tokens: 3000, cache_read_input_tokens: -5, content: 'secreto' }, stopReason: 'end_turn' });
  assert.deepEqual(Object.keys(row).sort(), ['cache_read_tokens', 'cache_write_tokens', 'duration_ms', 'estimated_cost_usd', 'feature', 'input_tokens',
    'model', 'outcome', 'output_tokens', 'request_id', 'stop_reason', 'tenant_id'].sort());
  assert.equal(row.request_id.length, 120);
  assert.equal(row.cache_read_tokens, null);
  assert.equal(row.duration_ms, 41235);
  assert.equal(row.feature, 'radiograph_analysis');
});

test('el consumo se registra también cuando el análisis falla, sin perder el resultado si el registro falla', () => {
  const fn = read('supabase/functions/claude/index.ts');
  assert.match(fn, /smyl_ai_usage_log/);
  assert.match(fn, /await medirRadiografia\("error", null, null\)/);
  assert.match(fn, /await medirRadiografia\(cData\?\.stop_reason === "end_turn" \? "ok" : "incomplete"/);
  assert.match(fn, /No se pudo registrar el consumo de IA/);
});

test('migración de consumo: solo escribe el servidor, la clínica lee su resumen con permiso', () => {
  const sql = read('supabase/migrations/20261031120000_smyl_ai_usage_log.sql');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.smyl_ai_usage_log from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy|grant (select|insert|all)/i);
  assert.match(sql, /smyl_current_tenant\(\)/);
  assert.match(sql, /smyl_has_permission\(v_tenant, 'clinic\.manage'\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /revoke all on function public\.smyl_ai_usage_summary\(text, integer\) from public, anon/);
  assert.doesNotMatch(sql, /(image_data|base64|response_text|patient_id)/);
});

test('el validador de la revisión acepta Opus y conserva Sonnet para revisiones anteriores', () => {
  const sql = read('supabase/migrations/20261031130000_smyl_radiograph_model_opus.sql');
  assert.match(sql, /a->>'model' not in \('claude-sonnet-4-6','claude-opus-5-5'\)/);
  assert.match(sql, /create or replace function public\.smyl_validate_radiograph_review/);
  assert.match(sql, /revoke all on function public\.smyl_validate_radiograph_review\(jsonb,jsonb\) from public,anon,authenticated/);
  const js = read('smyl-radiograph-review-model.js');
  assert.match(js, /const models=\['claude-sonnet-4-6','claude-opus-5-5'\]/);
  assert.match(js, /!models\.includes\(doc\.analysis\.model\)/);
});

test('Plan y consumo muestra la medición y usa la función de resumen', () => {
  assert.match(read('consumos.html'), /id="radiograph-usage"/);
  const js = read('smyl-consumption.js');
  assert.match(js, /sb\.rpc\('smyl_ai_usage_summary',\{p_feature:'radiograph_analysis',p_days:30\}\)/);
  assert.match(js, /loadRadiographUsage\(\);\}/);
  assert.match(read('smyl-consumption.css'), /\.usage-ai-measure-grid/);
});

test('las copias móviles siguen idénticas', () => {
  for (const f of ['app.html', 'sw.js', 'consumos.html', 'smyl-consumption.js', 'smyl-consumption.css', 'smyl-radiograph-analysis-client.js', 'smyl-radiograph-review-model.js']) {
    assert.equal(read('mobile/www/' + f), read(f), f);
  }
});
