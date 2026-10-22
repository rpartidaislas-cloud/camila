import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../smyl-clinic-setup.js');
const styles = read('../smyl-clinic-setup.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('la lista «Configura tu clínica» verifica cada paso con datos reales y solo de lectura', () => {
  for (const id of ["'hours'", "'patient'", "'whatsapp'", "'template'", "'reminders'"]) assert.ok(script.includes('id: ' + id), id);
  assert.match(script, /from\('smyl_clinic_hours'\)\.select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(script, /from\('camila_pacientes'\)\.select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(script, /from\('smyl_reminder_settings'\)\.select\('enabled'\)/);
  assert.match(script, /functions\/v1\/lana-channels/);
  assert.match(script, /functions\.invoke\('whatsapp-templates', \{ body: \{ action: 'list' \} \}\)/);
  assert.match(script, /item\.status === 'APPROVED' && item\.category === 'UTILITY'/);
  assert.doesNotMatch(script, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|method: 'POST'/);
});

test('solo la ve el propietario, se oculta al completarse y un fallo no cuenta como paso listo', () => {
  assert.match(script, /window\.miRolEquipo === 'dueño'/);
  assert.match(script, /!isOwner\(\) \|\| !results \|\| !pending\.length/);
  assert.match(script, /\{ unknown: true \}/);
  assert.match(script, /No pudimos verificarlo ahora/);
  assert.match(script, /Meta la está revisando/);
});

test('el plegado se recuerda por clínica con almacenamiento tolerante a fallos y empieza plegada y muestra el siguiente paso', () => {
  assert.match(script, /smyl_clinic_setup_collapsed_/);
  assert.match(script, /smyl_clinic_setup_height/);
  assert.equal((script.match(/try \{/g) || []).length >= 2, true);
  assert.match(script, /item\.hidden = state\.collapsed && step\.id !== firstPending/);
});

test('no muestra el nombre del motor de mensajería y el CSS cubre celular', () => {
  assert.doesNotMatch(script, /\bLANA\b|\bLana\b/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /min-height:40px/);
});

test('web, móvil y PWA publican el módulo', () => {
  assert.match(app, /<link rel="stylesheet" href="smyl-clinic-setup\.css\?v=2">\s*<script defer src="smyl-clinic-setup\.js\?v=3"><\/script>/);
  assert.ok(app.indexOf('smyl-clinic-setup.js') > app.indexOf('smyl-daily-home.js'), 'carga después del Inicio');
  assert.ok(worker.includes("'/camila/smyl-clinic-setup.js?v=3'") && worker.includes("'/camila/smyl-clinic-setup.css?v=2'"));
  for (const file of ['smyl-clinic-setup.js', 'smyl-clinic-setup.css', 'app.html', 'sw.js']) assert.equal(read('../mobile/www/' + file), read('../' + file), file);
});
