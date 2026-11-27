import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// Los bundles de docs/bundles se pegan en el panel de Supabase. Si repiten un nombre o tienen un error de sintaxis, la función
// responde BOOT_ERROR en producción aunque el código fuente se vea bien. Esta prueba compila cada bundle de privacidad tal como
// se pega (un solo archivo), para atrapar justo eso.
const BUNDLES = ['claude', 'mila-interview', 'periodontal-summary', 'radiograph-analyze', 'cloud-classify', 'fiscal-extract', 'privacy-notice-dispatch', 'whatsapp-templates', 'segment-teeth', 'smyl-pay'];

for (const name of BUNDLES) {
  test(`el bundle de ${name} compila como un solo archivo`, (t) => {
    if (typeof stripTypeScriptTypes !== 'function') return t.skip('Node sin stripTypeScriptTypes');
    const source = readFileSync(new URL(`../docs/bundles/${name}.single-file.ts`, import.meta.url), 'utf8')
      .replace(/^import \{ createClient \} from [^\n]*\n/gm, 'const createClient = () => ({});\n')
      .replace(/^import [^\n]*(?:https?:\/\/|npm:)[^\n]*\n/gm, '');
    // Dos imports del mismo nombre (por ejemplo createClient desde dos URLs) rompen la función al arrancar.
    const nombres = [...source.matchAll(/^import \{([^}]+)\} from /gm)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()));
    assert.equal(new Set(nombres).size, nombres.length, `${name}: import duplicado → ${nombres.filter((x, i) => nombres.indexOf(x) !== i)}`);
    const sinRemotos = source.replace(/^import [^\n]*(?:https?:\/\/|npm:)[^\n]*\n/gm, '');
    assert.doesNotMatch(sinRemotos, /^import .* from ["'][^"']+["']/m, 'quedó un import local sin resolver dentro del bundle');
    assert.doesNotThrow(() => new vm.Script(stripTypeScriptTypes(source).replace(/^export /gm, ''), { filename: `${name}.js` }), `${name} no compila`);
  });
}

test('el candado de privacidad no reexporta nombres que el generador de bundles duplicaría', () => {
  const ts = readFileSync(new URL('../supabase/functions/_shared/privacy.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(ts, /^export \{/m, 'un `export { ... }` de nombres importados rompe el bundle (declaración duplicada)');
});
