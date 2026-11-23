// Buscador de ClaveProdServ en «Editar servicio»: consulta el catálogo oficial del SAT por medio de Facturapi.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { leerProductosSat, textoBusquedaSat, descripcionServicioSat, leerConsultasSat, unirCandidatosSat, leerSeleccionSat, leerServicioSugerido, sumarUso, SAT_CONSULTAS_SCHEMA, SAT_SELECCION_SCHEMA, SERVICIO_SCHEMA } from '../supabase/functions/_shared/facturapi-core.mjs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('leerProductosSat solo acepta claves de 8 dígitos y recorta lo demás', () => {
  const body = { data: [
    { key: '85122001', description: '  Servicios de   odontólogos ' },
    { key: '8512200', description: 'corta' }, { key: 'ABCDEFGH', description: 'letras' }, null, { description: 'sin clave' },
    { key: '85122002', description: 'x'.repeat(500) },
  ] };
  const r = leerProductosSat(body);
  assert.deepEqual(r.map((x) => x.key), ['85122001', '85122002']);
  assert.equal(r[0].description, 'Servicios de odontólogos');
  assert.equal(r[1].description.length, 200);
  assert.deepEqual(leerProductosSat(null), []); assert.deepEqual(leerProductosSat({ data: 'x' }), []); assert.deepEqual(leerProductosSat({}), []);
  assert.equal(leerProductosSat({ data: Array.from({ length: 30 }, (_, i) => ({ key: String(85122000 + i), description: 'd' })) }).length, 12);
});

test('textoBusquedaSat pide al menos 3 caracteres y limita el largo', () => {
  assert.equal(textoBusquedaSat('  limpieza   dental '), 'limpieza dental');
  assert.equal(textoBusquedaSat('ab'), ''); assert.equal(textoBusquedaSat(null), '');
  assert.equal(textoBusquedaSat('a'.repeat(200)).length, 60);
});

test('la función facturapi expone search_sat_products con permiso de gestión, sin devolver llaves', () => {
  const fn = read('supabase/functions/facturapi/index.ts');
  const at = fn.indexOf('if (action === "search_sat_products")');
  assert.ok(at > 0);
  const block = fn.slice(at, fn.indexOf('// ── La IA sugiere', at));
  assert.match(block, /status !== "connected"/);
  assert.match(block, /\/catalogs\/products\?q=\$\{encodeURIComponent\(q\)\}&limit=12/);
  assert.match(block, /json\(CORS, 200, \{ results: leerProductosSat\(r\.body\) \}\)/);
  // La llave se descifra solo dentro de la función; lo único que sale hacia el navegador son los resultados.
  assert.equal((block.match(/json\(CORS, 200,/g) || []).length, 1);
  assert.doesNotMatch(block, /json\(CORS, 200, \{[^}]*(key|secret|connection)/);
  // No es una acción de timbrado: pasa por finance.manage y antes del interruptor de plataforma.
  assert.doesNotMatch(fn.match(/const esTimbrado = [^;]+;/)[0], /search_sat_products/);
  const bundle = read('docs/bundles/facturapi.single-file.ts');
  assert.match(bundle, /search_sat_products/); assert.match(bundle, /function leerProductosSat\(/);
});

test('el editor de servicios trae el buscador, no marca el servicio como revisado y solo sugiere unidad y objeto si están vacíos', () => {
  const ui = read('smyl-service-catalog.js');
  assert.match(ui, /data-sat-q/); assert.match(ui, /data-sat-go/); assert.match(ui, /data-sat-results/);
  assert.match(ui, /satCall\(\{action:'search_sat_products',q:q\}\)/);
  assert.match(ui, /if\(!unit\.value\)\{unit\.value='E48'/); assert.match(ui, /if\(!object\.value\)\{object\.value='02'/);
  assert.match(ui, /ev\.key==='Enter'\)\{ev\.preventDefault\(\)/);
  assert.doesNotMatch(ui.slice(ui.indexOf('satBox.onclick'), ui.indexOf("d.querySelector('form').onsubmit")), /fiscal_reviewed/);
  assert.equal(ui, read('mobile/www/smyl-service-catalog.js'));
  assert.equal(read('smyl-service-catalog.css'), read('mobile/www/smyl-service-catalog.css'));
  assert.match(read('app.html'), /smyl-service-catalog\.js\?v=15/); assert.match(read('app.html'), /smyl-service-catalog\.css\?v=6/);
});

test('la IA nunca puede inventar una clave: solo se aceptan las que estaban entre los candidatos', () => {
  const candidatos = [{ key: '85122001', description: 'Servicios de odontólogos' }, { key: '85122002', description: 'Servicios de higienistas dentales' }];
  const texto = JSON.stringify({ picks: [
    { key: '99999999', reason: 'inventada' }, { key: '85122002', reason: '  Limpieza la hace el   higienista ' }, { key: '85122002', reason: 'repetida' },
    { key: '85122001', reason: 'x'.repeat(500) }, { key: '85122003', reason: 'no estaba' },
  ] });
  const r = leerSeleccionSat(texto, candidatos);
  assert.deepEqual(r.map((x) => x.key), ['85122002', '85122001']);
  assert.equal(r[0].reason, 'Limpieza la hace el higienista'); assert.equal(r[0].description, 'Servicios de higienistas dentales'); assert.equal(r[1].reason.length, 200);
  assert.deepEqual(leerSeleccionSat('no es json', candidatos), []); assert.deepEqual(leerSeleccionSat(JSON.stringify({ picks: 'x' }), candidatos), []);
  assert.deepEqual(leerSeleccionSat(texto, []), []);
});

test('las consultas de la IA se limpian: de 3 a 60 caracteres, sin repetir, sin claves numéricas y máximo 4', () => {
  const r = leerConsultasSat(JSON.stringify({ queries: ['  odontólogos ', 'Odontólogos', 'ab', '85122001', 'higienista dental', 'ortodoncia', 'cirugía oral', 'radiografía', 5, null] }));
  assert.deepEqual(r, ['odontólogos', 'higienista dental', 'ortodoncia', 'cirugía oral']);
  assert.deepEqual(leerConsultasSat('{'), []); assert.deepEqual(leerConsultasSat(JSON.stringify({ queries: 'x' })), []);
});

test('unirCandidatosSat junta resultados sin repetir claves y respeta el máximo; el servicio pide al menos un nombre', () => {
  const a = [{ key: '85122001', description: 'a' }, { key: '85122002', description: 'b' }], b = [{ key: '85122002', description: 'b2' }, { key: '85122004', description: 'c' }];
  assert.deepEqual(unirCandidatosSat([a, b, null]).map((x) => x.key), ['85122001', '85122002', '85122004']);
  assert.equal(unirCandidatosSat([Array.from({ length: 40 }, (_, i) => ({ key: String(85000000 + i), description: 'd' }))]).length, 24);
  assert.equal(descripcionServicioSat({ name: ' ' }), null); assert.equal(descripcionServicioSat(null), null);
  assert.deepEqual(descripcionServicioSat({ name: '  Limpieza   dental ', category: 'Preventiva', description: 'y'.repeat(500) }), { name: 'Limpieza dental', category: 'Preventiva', description: 'y'.repeat(300) });
});

test('suggest_sat_product aplica el tope, mide y cuenta los tokens, elige solo entre candidatos y no manda datos de pacientes', () => {
  const fn = read('supabase/functions/facturapi/index.ts');
  const at = fn.indexOf('if (action === "suggest_sat_product")');
  assert.ok(at > 0);
  const block = fn.slice(at, fn.indexOf('if (action === "suggest_service")', at));
  assert.match(block, /puedeUsarIA\(tenantId, CORS\)/); assert.match(block, /medirIA\(tenantId, ia1\)/);
  assert.match(block, /registrarConsumo\(tenantId, \[[^\]]*\.\.\.sat\.llamadas\], "sat_suggest"/);
  assert.doesNotMatch(block, /patient|paciente_id|rfc/i);
  const helper = fn.slice(fn.indexOf('async function sugerirClaveSat'), fn.indexOf('async function timbrado'));
  assert.match(helper, /leerSeleccionSat\(ia\.text, candidatos\)/); assert.match(helper, /if \(!candidatos\.length\) return \{ suggestions: \[\]/);
  assert.match(fn.slice(fn.indexOf('async function puedeUsarIA'), fn.indexOf('async function sugerirClaveSat')), /evaluarTopeFiscal\(/);
  assert.doesNotMatch(fn.match(/const esTimbrado = [^;]+;/)[0], /suggest_/);
  const bundle = read('docs/bundles/facturapi.single-file.ts');
  assert.match(bundle, /suggest_sat_product/); assert.match(bundle, /async function llamarIA\(/);
});

test('los esquemas de la IA no llevan restricciones de arreglos ni de números (la API los rechaza con 400)', () => {
  for (const schema of [SAT_CONSULTAS_SCHEMA, SAT_SELECCION_SCHEMA, SERVICIO_SCHEMA]) assert.doesNotMatch(JSON.stringify(schema), /maxItems|minItems|minimum|maximum|minLength|maxLength/);
});

test('leerServicioSugerido solo deja valores válidos y nunca trae precio', () => {
  const r = leerServicioSugerido(JSON.stringify({ category: 'preventive', scope_type: 'session', pricing_mode: 'per_session', duration_minutes: 47, description: '  Limpia   los dientes. ', prep_instructions: '', sat_queries: ['higienista dental', 'odontólogos', '85122002'], reference_price: 999 }));
  assert.deepEqual(r, { category: 'preventive', scope_type: 'session', pricing_mode: 'per_session', duration_minutes: 45, description: 'Limpia los dientes.', prep_instructions: '', tax_treatment: null, queries: ['higienista dental', 'odontólogos'] });
  assert.equal('reference_price' in r, false);
  const mala = leerServicioSugerido(JSON.stringify({ category: 'inventada', scope_type: 'x', pricing_mode: 5, duration_minutes: 9999, description: 7, prep_instructions: null, sat_queries: 'x' }));
  assert.deepEqual(mala, { category: null, scope_type: null, pricing_mode: null, duration_minutes: null, description: '7', prep_instructions: '', tax_treatment: null, queries: [] });
  assert.equal(leerServicioSugerido('no es json'), null); assert.equal(leerServicioSugerido('null'), null);
  assert.equal(leerServicioSugerido(JSON.stringify({ duration_minutes: 5 })).duration_minutes, null); assert.equal(leerServicioSugerido(JSON.stringify({ duration_minutes: 480 })).duration_minutes, 480);
});

test('sumarUso suma los tokens de varias llamadas para el registro de consumo', () => {
  assert.deepEqual(sumarUso([{ input_tokens: 100, output_tokens: 20 }, null, { input_tokens: 50.4, output_tokens: 5, cache_read_input_tokens: 10 }, { input_tokens: -3, output_tokens: 'x' }]),
    { input_tokens: 150, output_tokens: 25, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, calls: 3 });
  assert.equal(sumarUso(null).calls, 0);
});

test('suggest_service sugiere todo menos el precio, la clave SAT es opcional y cada uso se cuenta en Créditos de IA', () => {
  const fn = read('supabase/functions/facturapi/index.ts');
  const at = fn.indexOf('if (action === "suggest_service")');
  assert.ok(at > 0);
  const block = fn.slice(at, fn.indexOf('// ── cuenta propia', at));
  assert.match(block, /puedeUsarIA\(tenantId, CORS\)/); assert.match(block, /leerServicioSugerido\(ia1\.text\)/);
  assert.match(block, /registrarConsumo\(tenantId, llamadas, "service_suggest", true\)/);
  assert.match(block, /sat_note/); assert.doesNotMatch(block, /reference_price|price/);
  assert.match(block, /if \(row && row\.status === "connected" && row\.secret_ciphertext\)/);
  const consumo = fn.slice(fn.indexOf('async function registrarConsumo'), fn.indexOf('async function puedeUsarIA'));
  assert.match(consumo, /rpc\("smyl_consume"/); assert.match(consumo, /p_resource: "ai_credits"/); assert.match(consumo, /token_usage: uso/); assert.match(consumo, /p_enforce: CONSUMABLES_ENFORCED/);
});

test('el editor de servicios ofrece «Sugerir con IA» y avisa que se confirme con el contador', () => {
  const ui = read('smyl-service-catalog.js');
  assert.match(ui, /data-sat-ai/); assert.match(ui, /action:'suggest_sat_product'/); assert.match(ui, /Sugerir con IA/);
  assert.match(ui, /La IA solo elige entre claves reales del catálogo del SAT\. Confírmala con tu contador\./);
  assert.equal(ui, read('mobile/www/smyl-service-catalog.js'));
});

test('«Sugerir todo con IA» llena el formulario sin tocar el precio, no pisa textos escritos y se puede deshacer', () => {
  const ui = read('smyl-service-catalog.js');
  assert.match(ui, /data-ai-all/); assert.match(ui, /action:'suggest_service'/); assert.match(ui, /data-ai-undo/);
  assert.match(ui, /nada se guarda hasta que pulses Guardar/);
  const fill = ui.slice(ui.indexOf('async function aiAll'), ui.indexOf('aiBtn.onclick=aiAll'));
  assert.doesNotMatch(fill, /reference_price/);
  assert.match(fill, /if\(row\[2\]&&el\.value\.trim\(\)\)return;/);
  assert.match(fill, /!reviewed/);
  assert.equal(ui, read('mobile/www/smyl-service-catalog.js'));
});

test('la llamada a la IA reserva tokens para el razonamiento y la respuesta (1,500 dejaba la respuesta cortada)', () => {
  const fn = read('supabase/functions/facturapi/index.ts');
  assert.match(fn, /max_tokens: FISCAL_EXTRACT_MAX_TOKENS/); assert.doesNotMatch(fn, /max_tokens: 1500/);
  const core = read('supabase/functions/_shared/fiscal-core.mjs');
  assert.ok(Number(core.match(/FISCAL_EXTRACT_MAX_TOKENS = (\d+)/)[1]) >= 4000);
  assert.match(fn, /sugerencia de servicio ilegible; ia_ok:/);
});

