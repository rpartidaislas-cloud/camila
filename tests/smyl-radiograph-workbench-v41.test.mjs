import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.resolve(here, file), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const review = read('../smyl-radiograph-review.js');
const dental = read('../smyl-dental-record.js');
const css = read('../smyl-radiograph-workbench.css');

assert.match(app, /smyl-radiograph-workbench\.css\?v=6/);
assert.match(app, /smyl-radiograph-review\.js\?v=11/);
assert.match(app, /smyl-dental-record\.js\?v=17/);
assert.match(worker, /radiograph-navigation-v43/);
assert.match(worker, /smyl-radiograph-workbench\.css\?v=6/);

assert.match(review, /rr-workspace/);
assert.match(review, /categoryLabel/);
assert.match(review, /Base visual sugerida/);
assert.match(review, /Notas del dentista/);
assert.match(review, /Detectado por la IA/);
assert.match(review, /button\(String\(index\+1\),\(\)=>selectItem\(item\.id\)/);
assert.doesNotMatch(review, /Sin texto/);
assert.doesNotMatch(review, /\bconfirm\s*\(/);
assert.doesNotMatch(review, /\balert\s*\(/);
assert.match(review, /aria-labelledby/);
assert.match(review, /viewportNavigation/);
assert.match(review, /touchmove/);
assert.match(review, /Arrastra para recorrer · pellizca para ampliar/);

assert.match(dental, /dr-reading-workspace/);
assert.match(dental, /if\(!adding\)return/);
assert.match(dental, /Pendiente de describir/);
assert.match(dental, /Registrar señal clínica/);
assert.match(dental, /dr-action-feedback/);
assert.match(dental, /La revisión asistida no terminó de cargar/);
assert.match(dental, /viewportNavigation/);
assert.doesNotMatch(dental, /Posición horizontal \(%\)|Posición vertical \(%\)/);

assert.match(css, /grid-template-columns:\s*minmax\(0,\s*7fr\)\s+minmax\(320px,\s*3fr\)/);
assert.match(css, /--rr-primary:\s*var\(--smyl-ui-primary/);
assert.match(css, /\.rr-item-pending\s*\{[^}]*border-style:\s*dashed/s);
assert.match(css, /\.rr-item-confirmed\s*\{/);
assert.match(css, /\.rr-confirm-dialog\s*\{/);
assert.match(css, /\.rr-image-wrap\.is-zoomed\s*\{[^}]*touch-action:\s*none/s);
assert.match(css, /\.dr-radiograph-dialog \.dr-viewport\.is-zoomed\s*\{/);
assert.match(css, /\.dr-action-feedback\.is-warning\s*\{/);
assert.match(css, /\.rr-signal-panel\s*\{[^}]*grid-template-rows:\s*auto auto auto auto/s);
assert.match(css, /\.dr-mark-dialog\s*\{[^}]*--smyl-ui-surface/s);
assert.match(css, /@media \(max-width: 639px\)/);
for (const match of css.matchAll(/font-size:\s*([0-9.]+)px/g)) assert.ok(Number(match[1]) >= 12, `Texto menor de 12 px: ${match[0]}`);

for (const file of ['app.html', 'sw.js', 'smyl-radiograph-review.js', 'smyl-dental-record.js', 'smyl-radiograph-workbench.css']) {
  assert.equal(read('../' + file), read('../mobile/www/' + file), `${file} debe coincidir en web y móvil`);
}

console.log('Radiograph reading workbench v41 contracts passed');
