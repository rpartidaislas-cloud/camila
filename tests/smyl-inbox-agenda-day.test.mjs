import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const calendar = read('smyl-inbox-calendar.js');
const js = read('smyl-inbox.js');

test('las citas del día se muestran solas al elegir un día', () => {
  assert.match(calendar, /agendaOpen: true/);
  // Elegir otro día ya no cierra la agenda.
  assert.match(calendar, /cell\.onclick = \(function \(value\) \{ return function \(\) \{ state\.day = value; paint\(\); \}; \}\)\(key\);/);
  assert.doesNotMatch(calendar, /state\.day = value; state\.agendaOpen = false/);
  assert.match(calendar, /Citas del día · /);
  assert.match(calendar, /'Ocultar citas del día' : 'Ver citas del día'/);
});

test('la agenda solo se pide y se muestra a quien puede leer Agenda, y es de solo lectura', () => {
  assert.match(js, /canReadAgenda: hasPermission\('schedule\.read'\) \|\| hasPermission\('schedule\.manage'\)/);
  assert.match(calendar, /if \(state\.agendaOpen && ctx\.canReadAgenda !== false\) section\.append\(buildAgenda\(ctx, key\)\);/);
  assert.doesNotMatch(calendar, /\.from\(|sb\.rpc|fetch\(/, 'el calendario no consulta datos por su cuenta');
});

test('web, móvil y PWA publican la agenda del día automática', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-inbox-calendar\.js\?v=4/);
    assert.match(read(file), /smyl-inbox\.js\?v=87/);
    assert.match(read(file), /smyl-inbox\.css\?v=74/);
  }
  for (const file of ['smyl-inbox-calendar.js', 'smyl-inbox.js', 'smyl-inbox.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
