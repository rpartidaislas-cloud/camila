import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const js = read('smyl-finance.js');

// Numerito de «Cobros» en el menú = pacientes pendientes de cargo. El comportamiento completo (menú ampliado, colapsado y móvil, cambios en vivo)
// se prueba en un navegador real con tests/qa/cobros-nav-badge-smoke.cjs.

test('cuenta lo mismo que la lista de Cobros: citas que llegaron y la función de sólo lectura dice «pending»', () => {
  assert.match(js, /\.in\('status',\['arrived','in_progress','completed','no_show'\]\)\.gte\('starts_at',since\)\.limit\(200\)/);
  assert.match(js, /window\.sb\.rpc\('smyl_appointment_billing',\{p_appointment_ids:ids\}\)/);
  assert.match(js, /r\.billing_state==='pending'\|\|r\.billing_state==='no_show_pending'/);
});

test('el numerito va en el botón de Cobros del menú (ampliado, colapsado y «Más» en móvil) con texto accesible', () => {
  assert.match(js, /document\.querySelectorAll\('\[data-route="caja"\]'\)\.forEach/);
  assert.match(js, /badge=el\('span','pro-nav-count'\)/);
  assert.match(js, /' paciente pendiente de cargo':' pacientes pendientes de cargo'/);
  assert.match(js, /badge\.hidden=!count/);
  assert.match(js, /count>99\?'99\+':String\(count\)/);
});

test('se actualiza sin abrir Cobros: al iniciar, cada 90 s, al volver a la pestaña, al cambiar de pantalla y con eventos de agenda y cobros', () => {
  assert.match(js, /if\(window\.tenantId\)\{clearInterval\(boot\);refreshNavBadge\(true\);\}/);
  assert.match(js, /setInterval\(function\(\)\{refreshNavBadge\(true\);\},90000\)/);
  assert.match(js, /document\.addEventListener\('visibilitychange'/);
  assert.match(js, /\['smyl:finance-updated','smyl:appointments-changed'\]/);
  assert.match(js, /var result=previous\(route\);refreshNavBadge\(\);/);
  assert.match(read('smyl-schedule.js'), /await load\(true\);window\.dispatchEvent\(new CustomEvent\('smyl:appointments-changed'\)\);remindersChanged\(\);/);
});

test('es barato y seguro: sólo en pestaña visible, con espera mínima de 15 s, sin reintentos infinitos y sin escribir nada', () => {
  assert.match(js, /document\.visibilityState==='hidden'\)return;if\(!force&&Date\.now\(\)-navBadge\.last<15000\)return/);
  assert.match(js, /navBadge\.failures>=3/);
  assert.match(js, /navBadge\.failures\+=1/);
  const block = js.slice(js.indexOf('// ── Numerito en el menú'), js.indexOf('function init(){'));
  assert.doesNotMatch(block, /smyl_post_charge|smyl_mark_appointment_no_charge|\.insert\(|\.update\(|\.delete\(/);
});

test('Cobros mantiene el numerito sincronizado con su lista sin otra consulta', () => {
  assert.match(js, /if\(state\.canRead\)renderNavBadge\(rows\.length\)/);
});

test('versiones y copia móvil sincronizadas', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-finance\.js\?v=36/);
    assert.match(read(file), /smyl-schedule\.js\?v=33/);
  }
  for (const file of ['smyl-finance.js', 'smyl-schedule.js', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
