import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-dialog-system.js');
const styles = read('../smyl-dialog-system.css');
const worker = read('../sw.js');

test('SMYL aplica una anatomía común a sus ventanas operativas', () => {
  for (const moduleClass of ['inventory-dialog', 'finance-dialog', 'schedule-dialog', 'catalog-dialog', 'clinic-admin-dialog', 'p360-dialog', 'proposal-preview-dialog', 'smyl-inbox-copilot-dialog']) {
    assert.match(script, new RegExp(moduleClass));
  }
  assert.match(script, /smyl-dialog-header/);
  assert.match(script, /smyl-dialog-body/);
  assert.match(script, /smyl-dialog-footer/);
  assert.match(script, /Cerrar ventana/);
  assert.match(script, /form\.classList\.contains\('smyl-dialog-form'\)/);
  assert.match(script, /smylDialogBound/);
  assert.match(script, /enhanceLegacy/);
  assert.match(script, /\.modal-bg/);
});

test('las ventanas protegen cambios, validación y accesibilidad', () => {
  assert.match(script, /¿Cerrar sin guardar los cambios\?/);
  assert.match(script, /aria-labelledby/);
  assert.match(script, /aria-modal/);
  assert.match(script, /data-smyl-invalid/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /body:has\(dialog\[data-smyl-dialog-system/);
});

test('la presentación conserva cabecera y acciones visibles y usa pantalla completa móvil', () => {
  assert.match(styles, /\.smyl-dialog-form\{display:flex/);
  assert.match(styles, /\.smyl-dialog-body\{flex:1 1 auto/);
  assert.match(styles, /\.smyl-dialog-footer\{display:flex/);
  assert.match(styles, /@media\(max-width:640px\)/);
  assert.match(styles, /width:100vw!important;height:100dvh!important/);
  assert.match(styles, /modal-bg\[data-smyl-legacy-dialog="true"\]/);
});

test('web, móvil y PWA distribuyen el sistema unificado', () => {
  assert.match(app, /smyl-dialog-system\.css\?v=1/);
  assert.match(app, /smyl-dialog-system\.js\?v=1/);
  assert.match(worker, /smyl-v233-verified-reviews/);
  assert.match(worker, /smyl-dialog-system\.css\?v=1/);
  assert.match(worker, /smyl-dialog-system\.js\?v=1/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-dialog-system.js'));
  assert.equal(styles, read('../mobile/www/smyl-dialog-system.css'));
  assert.match(read('./fixtures/smyl-dialog-system-stage9-preview.html'), /Nueva orden de compra/);
});
