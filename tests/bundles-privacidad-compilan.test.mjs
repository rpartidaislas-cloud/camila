import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// Los bundles de docs/bundles se pegan en el panel de Supabase. Si repiten un nombre o tienen un error de sintaxis, la función
// responde BOOT_ERROR en producción aunque el código fuente se vea bien. Esta prueba compila cada bundle de privacidad tal como
// se pega (un solo archivo), para atrapar justo eso.
const BUNDLES = ['claude', 'mila-interview', 'periodontal-summary', 'radiograph-analyze', 'cloud-classify', 'fiscal-extract', 'privacy-notice-dispatch', 'whatsapp-templates'];

for (const name of BUNDLES) {
  test(`el bundle de ${name} compila como un solo archivo`, (t) => {
    if (typeof stripTypeScriptTypes !== 'function') return t.skip('Node sin stripTypeScriptTypes');
    const source = readFileSync(new URL(`../docs/bundles/${name}.single-file.ts`, import.meta.url), 'utf8')
      .replace(/^import [^\n]*npm:[^\n]*\n/gm, 'const createClient = () => ({});\n');
    assert.doesNotMatch(source, /^import .* from ["'][^"']+["']/m, 'quedó un import sin resolver dentro del bundle');
    assert.doesNotThrow(() => new vm.Script(stripTypeScriptTypes(source).replace(/^export /gm, ''), { filename: `${name}.js` }), `${name} no compila`);
  });
}

test('el candado de privacidad no reexporta nombres que el generador de bundles duplicaría', () => {
  const ts = readFileSync(new URL('../supabase/functions/_shared/privacy.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(ts, /^export \{/m, 'un `export { ... }` de nombres importados rompe el bundle (declaración duplicada)');
});
