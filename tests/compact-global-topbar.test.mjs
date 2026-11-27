import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('el encabezado global deja de repetir visualmente el nombre del módulo', () => {
  const css = read('smyl-ui-template-v3.css');

  assert.match(css, /smyl-management-v3 \.topbar\s*\{[\s\S]*min-height:\s*3rem[\s\S]*background:\s*transparent/);
  assert.match(css, /smyl-management-v3 \.topbar-left > div\s*\{[\s\S]*clip-path:\s*inset\(50%\)/);
  assert.match(css, /smyl-management-v3 \.contenido\s*\{\s*padding-top:\s*\.75rem/);
});

test('web y PWA publican exactamente el mismo encabezado compacto', () => {
  assert.equal(read('smyl-ui-template-v3.css'), read('mobile/www/smyl-ui-template-v3.css'));
  assert.equal(read('app.html'), read('mobile/www/app.html'));
  assert.match(read('app.html'), /smyl-ui-template-v3\.css\?v=11/);
  assert.match(read('sw.js'), /compact-global-topbar-v1/);
  assert.match(read('mobile/www/sw.js'), /compact-global-topbar-v1/);
});
