import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const tokens = read('../smyl-design-system-v2.css');
const styles = read('../smyl-inbox.css');
const dialogs = read('../smyl-dialog-system.css');
const inbox = read('../smyl-inbox.js');
const app = read('../app.html');
const worker = read('../sw.js');

test('la política visual v2 tiene una fuente canónica de tokens operativos', () => {
  assert.match(tokens, /--smyl-primary:\s*#194391/);
  assert.match(tokens, /--smyl-accent:\s*#0F766E/);
  assert.match(tokens, /--smyl-type-dialog:\s*600 18px\/24px/);
  assert.match(tokens, /--smyl-radius-dialog:\s*12px/);
  assert.match(tokens, /--shadow-dialog:/);
  assert.match(tokens, /prefers-reduced-motion:\s*reduce/);
  assert.match(app, /smyl-design-system-v2\.css\?v=1/);
  assert.match(worker, /smyl-design-system-v2\.css\?v=1/);
  assert.equal(tokens, read('../mobile/www/smyl-design-system-v2.css'));
});

test('el sistema compartido de ventanas adopta la escala profesional v2', () => {
  assert.match(dialogs, /width:min\(680px,calc\(100vw - 32px\)\)/);
  assert.match(dialogs, /data-smyl-dialog-size="small"\]\{width:min\(520px/);
  assert.match(dialogs, /border-radius:12px!important/);
  assert.match(dialogs, /font-size:18px!important;font-weight:600!important;line-height:24px/);
  assert.match(dialogs, /background:var\(--smyl-primary,#194391\)!important/);
  assert.doesNotMatch(dialogs, /backdrop-filter/);
});

test('Agendar cita aplica jerarquía, divulgación progresiva y tamaño por contenido', () => {
  assert.match(inbox, /<h2 tabindex="-1">Agendar cita<\/h2>/);
  assert.match(inbox, /smyl-inbox-availability-context/);
  assert.match(inbox, /data-availability-date-fields hidden/);
  assert.match(inbox, /data-availability-custom>Fechas personalizadas/);
  assert.match(inbox, /data-availability-prepare disabled>Agregar opciones al mensaje/);
  assert.doesNotMatch(inbox, /AGENDA · SIN SALIR DEL CHAT/);
  assert.doesNotMatch(inbox, /smyl-inbox-calendar-mark/);
  assert.match(styles, /width:\s*min\(680px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /has-results\s*\{\s*width:\s*min\(960px/);
  assert.match(styles, /height:\s*auto/);
  assert.match(styles, /smyl-inbox-availability-dates\[hidden\]\s*\{\s*display:\s*none/);
});

test('los horarios son seleccionables como unidad y móvil apila los días', () => {
  assert.match(inbox, /row\.setAttribute\('role', 'button'\)/);
  assert.match(inbox, /row\.setAttribute\('aria-pressed'/);
  assert.match(inbox, /row\.onkeydown/);
  assert.match(styles, /smyl-inbox-availability-slot\.is-selected/);
  assert.match(styles, /max-width:\s*640px/);
  assert.match(styles, /availability-board > \[data-availability-results\]\s*\{[^}]*display:\s*block/s);
});
