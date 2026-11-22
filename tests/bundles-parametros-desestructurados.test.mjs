// El generador de bundles (scripts/bundle-edge-function.mjs) anotaba `: any` dentro de parámetros desestructurados:
// `({ cer, key, password } = {})` quedaba `({ cer, key: any, password } = {})`, que en JavaScript renombra `key` a `any`
// (la variable `key` deja de existir; repetirlo en una misma firma es error de sintaxis y la función no arranca).
// Esto dejó sin arrancar la función `facturapi` publicada desde su bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dir = new URL('../docs/bundles/', import.meta.url);
const bundles = fs.readdirSync(dir).filter((f) => f.endsWith('.single-file.ts'));

test('ningún bundle anota `: any` dentro de un parámetro desestructurado', () => {
  const bad = [];
  for (const file of bundles) {
    const text = fs.readFileSync(new URL(file, dir), 'utf8');
    for (const m of text.matchAll(/function\s*\w*\s*\(\s*\{[^)]*\}/g)) if (/\w\s*:\s*any\b/.test(m[0])) bad.push(file + ': ' + m[0].slice(0, 90));
  }
  assert.deepEqual(bad, []);
});

test('el generador deja intactos los parámetros con llaves y anota los sueltos', () => {
  const src = fs.readFileSync(new URL('../scripts/bundle-edge-function.mjs', import.meta.url), 'utf8');
  assert.match(src, /params\.includes\('\{'\) \|\| params\.includes\('\['\) \|\| params\.includes\('='\)/);
  const facturapi = fs.readFileSync(new URL('facturapi.single-file.ts', dir), 'utf8');
  assert.match(facturapi, /function validarCsd\(\{ cer, key, password \} = \{\}\) \{/);
  assert.match(facturapi, /function puedeActivarProduccion\(\{ mode, status, productionReady, issuerReviewed, policyReviewed, confirmText \} = \{\}\) \{/);
  assert.match(facturapi, /async function huella\(key: any\) \{/);
});
