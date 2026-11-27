import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const js = read('smyl-professional-v3.js');
const css = read('smyl-professional-v3.css');

test('el selector consulta el directorio completo por nombre, teléfono o correo', () => {
  assert.match(js, /select\('id,nombre,apellido,telefono,email'\)/);
  assert.match(js, /rpc\('smyl_search_patients',\{p_tenant_id:window\.tenantId,p_query:term,p_limit:20\}\)/);
  assert.match(js, /normalize\('NFD'\)/);
  assert.match(js, /Buscando en todo el directorio/);
  assert.match(js, /No se pudo buscar en todo el directorio/);
});

test('el contexto de planes y cotizaciones se resuelve en paralelo y evita duplicados', () => {
  assert.match(js, /Promise\.all\(\[taskRequest\(planReq\)/);
  assert.match(js, /taskQuotes\.set\(quote\.patient_id,\[\]\)/);
  assert.match(js, /quotes\.find\(function\(quote\)\{return quote\.plan_revision===plan\.revision;\}\)/);
  assert.match(js, /No pudimos comprobar cotizaciones anteriores/);
});

test('la ventana es accesible, recupera el foco y permite navegación por teclado', () => {
  assert.match(js, /setAttribute\('aria-modal','true'\)/);
  assert.match(js, /addEventListener\('cancel'/);
  assert.match(js, /target\.focus\(\)/);
  assert.match(js, /ArrowLeft','ArrowRight','Home','End/);
  assert.match(js, /aria-live="polite"/);
});

test('la composición se centra en escritorio y funciona como hoja inferior en móvil', () => {
  assert.match(css, /\.pro-task-dialog\{[\s\S]*position:fixed;inset:0;margin:auto;width:min\(680px/);
  assert.match(css, /\.pro-task-search input\{[\s\S]*min-height:48px/);
  assert.match(css, /\.pro-task-patients>button\{[\s\S]*min-height:70px/);
  assert.match(css, /@media\(max-width:600px\)\{[\s\S]*\.pro-task-dialog\{inset:auto 0 0/);
  assert.match(css, /env\(safe-area-inset-bottom,0px\)/);
});

test('web, PWA y móvil publican exactamente la misma versión', () => {
  assert.match(read('app.html'), /smyl-professional-v3\.css\?v=14/);
  assert.match(read('app.html'), /smyl-professional-v3\.js\?v=16/);
  assert.match(read('sw.js'), /quote-picker-v2/);
  for (const file of ['smyl-professional-v3.js', 'smyl-professional-v3.css', 'app.html', 'sw.js']) {
    assert.equal(read(file), read('mobile/www/' + file), `mobile/www/${file} difiere`);
  }
});
