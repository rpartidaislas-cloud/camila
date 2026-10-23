import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../smyl-inbox.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../smyl-inbox.css', import.meta.url), 'utf8');
const mobileJs = fs.readFileSync(new URL('../mobile/www/smyl-inbox.js', import.meta.url), 'utf8');
const mobileCss = fs.readFileSync(new URL('../mobile/www/smyl-inbox.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const mobileApp = fs.readFileSync(new URL('../mobile/www/app.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('Mensajes expone prioridades y acciones clínicas sin ocultarlas en el panel lateral', () => {
  assert.match(js, /data-inbox-filter="unread">Sin leer/);
  assert.match(js, /Por atender/);
  assert.match(js, /data-thread-carebar/);
  assert.match(js, /Agendar cita/);
  assert.match(js, /Expediente/);
  assert.match(js, /Cotizar/);
  assert.match(js, /Cobrar/);
  assert.match(js, /SmylCareTasks\.open/);
});

test('el primer caso prioritario se abre en escritorio y la vista vacía conserva una acción explícita', () => {
  assert.match(js, /didAutoOpen/);
  assert.match(js, /window\.innerWidth > 760/);
  assert.match(js, /data-inbox-open-next/);
  assert.match(js, /Continúa el siguiente caso/);
});

test('la distribución profesional mantiene contexto amplio y respuesta móvil', () => {
  assert.match(css, /Professional workspace v17/);
  assert.match(css, /grid-template-columns:340px minmax\(520px,1fr\) 318px/);
  assert.match(css, /\.smyl-inbox-carebar/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test('web, móvil y PWA entregan exactamente la misma optimización', () => {
  assert.equal(mobileJs, js);
  assert.equal(mobileCss, css);
  assert.match(app, /smyl-inbox\.js\?v=36/);
  assert.match(app, /smyl-inbox\.css\?v=34/);
  assert.equal(mobileApp.includes('smyl-inbox.js?v=36'), true);
  assert.match(worker, /smyl-v259-usage-alerts/);
});
