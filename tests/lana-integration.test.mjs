import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const simulator = read('../simulacion.html');
const entry = read('../nueva/index.html');
const analyze = read('../supabase/functions/analizar-foto/index.ts');
const notify = read('../supabase/functions/lana-webhook/index.ts');
const shared = read('../supabase/functions/_shared/lana.ts');
const migration = read('../supabase/migrations/20260917_lana_integration.sql');

assert.match(entry, /smyl_lana_context/);
assert.match(entry, /location\.replace/);
assert.match(entry, /tenant_id/);
assert.match(entry, /cita_id/);
assert.match(entry, /Number\.isSafeInteger/);
assert.doesNotMatch(entry, /LANA_WEBHOOK_SECRET|OPENAI_API_KEY/);

assert.match(simulator, /function leerContextoLanaEntrada/);
assert.match(simulator, /function aplicarContextoLana/);
assert.match(simulator, /lana_cita_id: casoData\.cita_id/);
assert.match(simulator, /lana_origen: casoData\.origen/);
assert.match(simulator, /functions\/v1\/lana-webhook/);
assert.match(simulator, /subirResultadoAStorage\(simulacionFrontal,casoId\)/);
assert.doesNotMatch(simulator, /LANA_WEBHOOK_SECRET/);

assert.match(analyze, /EdgeRuntime\.waitUntil\(procesarEnSegundoPlano/);
assert.match(analyze, /gpt-4o-2024-11-20/);
assert.match(analyze, /https:\/\/api\.openai\.com\/v1\/responses/);
assert.match(analyze, /type: "input_image"/);
assert.match(analyze, /type: "json_schema"/);
assert.match(analyze, /store: false/);
assert.match(analyze, /imagen_simulacion_url: null/);
assert.match(analyze, /autorizarLana\(req\)/);
assert.match(analyze, /estado: "error"/);
assert.match(analyze, /NO se llama al webhook de completado/);

assert.match(shared, /LANA_WEBHOOK_URL/);
assert.match(shared, /LANA_WEBHOOK_SECRET/);
assert.match(shared, /\[2000, 4000, 8000\]/);
assert.match(shared, /respuesta\.status < 500/);
assert.match(shared, /Authorization.*Bearer/);

assert.match(notify, /requireUser/);
assert.match(notify, /if \(!auth\.user \|\| !auth\.tenantId\)/);
assert.match(notify, /evento: "simulacion_guardada"/);
assert.match(notify, /enviarWebhookLana\(payload\)/);
assert.match(notify, /parsed\.origin !== origenPeticion\.origin/);
assert.match(notify, /parsed\.protocol !== "https:"/);
assert.match(notify, /parsed\.origin !== origenPeticion\.origin/);
assert.match(notify, /parsed\.protocol !== "https:"/);

assert.match(migration, /create table if not exists public\.smyl_analisis_fotos/);
assert.match(migration, /cita_id bigint/);
assert.match(migration, /tratamientos_sugeridos jsonb/);
assert.match(migration, /enable row level security/);
assert.match(migration, /idempotency_key/);

console.log('LANA integration contract: OK');
