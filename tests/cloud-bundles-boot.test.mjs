import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// Los bundles de docs/bundles se pegan en el panel de Supabase: si no compilan, la función responde BOOT_ERROR (503).
// Esta prueba "arranca" cada bundle de la Nube con un Deno y un cliente simulados para atrapar errores de sintaxis y
// declaraciones duplicadas que el generador puede introducir y que el código original no tiene.
// facturapi: un defecto del generador (`key: any` dentro de parámetros desestructurados) dejó sin arrancar a facturapi en producción.
const bundles = ['cloud-share', 'cloud-classify', 'secure-clinical-file', 'file-lifecycle-maintenance', 'facturapi'];

for (const name of bundles) {
  test(`el bundle de ${name} compila y arranca`, async (t) => {
    if (typeof stripTypeScriptTypes !== 'function') return t.skip('Node sin stripTypeScriptTypes');
    const file = new URL(`../docs/bundles/${name}.single-file.ts`, import.meta.url);
    assert.ok(existsSync(file), `falta docs/bundles/${name}.single-file.ts`);
    const source = readFileSync(file, 'utf8').replace(/^import \{ createClient \} from "npm:@supabase\/supabase-js@2";/m, 'const createClient = () => ({ auth: {}, from: () => ({}), rpc: () => ({}), storage: {} });');
    assert.doesNotMatch(source, /^import .* from "npm:/m, 'quedó un import npm sin sustituir en la prueba');
    const js = stripTypeScriptTypes(source);
    let registrada = null;
    const sandbox = { Deno: { env: { get: (k) => (k === 'SUPABASE_URL' ? 'https://x.supabase.co' : 'k') }, serve: (handler) => { registrada = handler; } }, console, crypto: globalThis.crypto, TextEncoder, TextDecoder, URL, Request, Response, Headers, fetch: async () => new Response('{}'), AbortController, setTimeout, clearTimeout, Promise };
    vm.createContext(sandbox);
    new vm.Script(js.replace(/^export /gm, ''), { filename: `${name}.js` }).runInContext(sandbox);
    assert.equal(typeof registrada, 'function', `${name} no registró Deno.serve`);
  });
}

test('los bundles de la Nube no repiten nombres entre bloques _shared', () => {
  for (const name of ['cloud-share', 'cloud-classify', 'facturapi']) {
    const source = readFileSync(new URL(`../docs/bundles/${name}.single-file.ts`, import.meta.url), 'utf8');
    const destructured = [...source.matchAll(/^const \{([^}]+)\} = \(\(\) => \{/gm)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
    const repeated = destructured.filter((n, i) => destructured.indexOf(n) !== i);
    assert.deepEqual(repeated, [], `${name}: nombres repetidos entre bloques: ${repeated.join(', ')}`);
  }
});


test('ningún archivo único para pegar en Supabase conserva instrucciones export/import dentro del código (el panel falla con «import and export cannot be used outside of module code»)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../docs/bundles/', import.meta.url);
  const malos = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.single-file.ts'))) {
    const lines = readFileSync(new URL(file, dir), 'utf8').split('\n');
    lines.forEach((line, index) => { if (/^export\s/.test(line)) malos.push(`${file}:${index + 1}: ${line.slice(0, 60)}`); });
  }
  assert.deepEqual(malos, []);
});
