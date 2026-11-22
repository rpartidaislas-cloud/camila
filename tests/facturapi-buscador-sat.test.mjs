// Buscador de ClaveProdServ en «Editar servicio»: consulta el catálogo oficial del SAT por medio de Facturapi.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { leerProductosSat, textoBusquedaSat } from '../supabase/functions/_shared/facturapi-core.mjs';

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
  const block = fn.slice(at, fn.indexOf('// ── cuenta propia', at));
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
  assert.match(ui, /body:\{action:'search_sat_products',q:q\}/);
  assert.match(ui, /if\(!unit\.value\)\{unit\.value='E48'/); assert.match(ui, /if\(!object\.value\)\{object\.value='02'/);
  assert.match(ui, /ev\.key==='Enter'\)\{ev\.preventDefault\(\)/);
  assert.doesNotMatch(ui.slice(ui.indexOf('satBox.onclick'), ui.indexOf("d.querySelector('form').onsubmit")), /fiscal_reviewed/);
  assert.equal(ui, read('mobile/www/smyl-service-catalog.js'));
  assert.equal(read('smyl-service-catalog.css'), read('mobile/www/smyl-service-catalog.css'));
  assert.match(read('app.html'), /smyl-service-catalog\.js\?v=11/); assert.match(read('app.html'), /smyl-service-catalog\.css\?v=3/);
});
