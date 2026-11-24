import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const js = read('smyl-connections.js');

test('sucursales y servicios del asistente ya no se escriben a mano: salen de Mi clínica y del catálogo', () => {
  assert.doesNotMatch(js, /data-import-branches|data-import-services|data-import-hours|data-add-service|Traer mis sucursales|Traer mis servicios/);
  assert.match(js, /data-auto-branches/);
  assert.match(js, /data-auto-services/);
  assert.match(js, /from\('smyl_services'\)\.select\('id,name,category,duration_minutes,reference_price'\)/);
  assert.match(js, /from\('smyl_service_branch_prices'\)/);
  // los campos del documento siguen existiendo, pero ocultos: solo cargan lo que se guarda y se publica
  assert.match(js, /<label class="full" hidden>Sucursales, direcciones y cobertura<textarea name="branches"/);
  assert.match(js, /<div class="connections-repeat-list" data-service-list hidden><\/div>/);
  assert.match(js, /\['location', 'hours'\]\.forEach\(function \(name\) \{ var label = form\.elements\[name\][^}]*label\.hidden = true/);
});

test('el documento se rearma con datos frescos al validar, publicar y probar el borrador', () => {
  assert.match(js, /async function runValidation\(\) \{\s+await refreshAutoFacts\(true\);\s+await saveTrainingDraft\(false\);/);
  assert.match(js, /if \(mode === 'draft'\) await refreshAutoFacts\(true\);/);
  assert.match(js, /refreshAutoFacts\(true\); \}\s+catch \(error\) \{ contextStatus\(error\.message, 'error'\); \}/);
});

test('si Mi clínica no responde, el borrador conserva lo último guardado (nunca se borra por un fallo de red)', () => {
  assert.match(js, /if \(!state\.clinicLoadOk\) throw new Error\('clinic'\);/);
  assert.match(js, /Si Mi clínica no responde se conserva lo que ya tenía el borrador/);
  assert.match(js, /state\.clinicBranches = state\.clinicBranches \|\| \[\];/);
});

test('solo se guarda solo cuando la persona puede editar, y publicar sigue siendo una acción aparte', () => {
  assert.match(js, /if \(changed && canAutosaveTraining\(\)\) \{/);
  assert.match(js, /publica para que el asistente los use/);
  assert.match(js, /Tus servicios o precios cambiaron desde la última publicación\./);
  assert.match(js, /Tus sucursales u horarios cambiaron desde la última publicación\./);
});

test('los ids de servicio son estables (no cambian en cada actualización) y el precio faltante dice «requiere valoración»', () => {
  const fn = new Function(
    js.match(/var SERVICE_IMPORT_LIMIT = \d+;\r?\n/)[0] +
    js.match(/function moneyLabel\(value\) \{[\s\S]*?\r?\n  \}\r?\n/)[0] +
    js.match(/function importServiceRows\([^)]*\) \{[\s\S]*?\r?\n  \}\r?\n/)[0] +
    'return importServiceRows;')();
  const services = [{ id: 'aaaa-1111', name: 'Limpieza', category: 'general', duration_minutes: 45, reference_price: 900 }, { id: 'bbbb-2222', name: 'Valoración', category: 'general', duration_minutes: 30, reference_price: null }];
  const make = (service) => 'service-' + String(service.id).replace(/-/g, '');
  const first = fn(services, [], [], [], make).rows;
  const second = fn(services, [], [], [], make).rows;
  assert.deepEqual(first.map((r) => r.id), second.map((r) => r.id));
  assert.equal(first[0].id, 'service-aaaa1111');
  assert.match(first[0].pricing_note, /Desde \$900/);
  assert.equal(first[1].pricing_note, 'Requiere valoración.');
});

test('web y móvil entregan lo mismo y la versión sube', () => {
  for (const file of ['smyl-connections.js', 'smyl-connections.css', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
  assert.match(read('app.html'), /smyl-connections\.js\?v=30/);
  assert.match(read('smyl-connections.css'), /\.connections-auto-drift/);
});
