import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

test('la actualización de la PWA no recarga la página mientras se trabaja', () => {
  const block = app.slice(app.indexOf("addEventListener('controllerchange'"));
  assert.match(app, /var smylHadController = Boolean\(navigator\.serviceWorker\.controller\)/);
  assert.match(block, /if \(!smylHadController\) \{ smylHadController = true; return; \}/);
  assert.match(block, /document\.visibilityState === 'hidden'\) \{ smylApplyUpdate\(\)/);
  assert.match(block, /smylShowUpdateNotice\(\)/);
  assert.doesNotMatch(app, /recargarCuandoSePueda/);
});

test('la copia móvil de app.html sigue idéntica', () => {
  assert.equal(readFileSync(new URL('../mobile/www/app.html', import.meta.url), 'utf8'), app);
});
