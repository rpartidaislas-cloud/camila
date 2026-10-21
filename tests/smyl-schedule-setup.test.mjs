import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Asistente de puesta en marcha de la Agenda: qué falta para aceptar citas y cómo se
// crea el horario estándar sin pisar lo que ya existe ni salirse del horario de la clínica.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function load() {
  const window = {};
  const document = { readyState: 'loading', addEventListener() {} };
  vm.runInNewContext(read('smyl-schedule-setup.js'), { window, document, setTimeout, clearTimeout, console });
  document.addEventListener = () => {};
  // init corre en DOMContentLoaded; se invoca a mano para exponer la API.
  const handlers = [];
  const doc2 = { readyState: 'loading', addEventListener: (_, fn) => handlers.push(fn) };
  const win2 = {};
  vm.runInNewContext(read('smyl-schedule-setup.js'), { window: win2, document: doc2, setTimeout, clearTimeout, console });
  handlers.forEach((fn) => fn());
  return win2.SmylScheduleSetup;
}
const raw = load();
// Los resultados nacen en otro contexto de vm: se normalizan para comparar estructuras.
const plain = (value) => JSON.parse(JSON.stringify(value));
const api = {
  assess: (data) => plain(raw.assess(plain(data))),
  plan: (data, options, can) => plain(raw.plan(plain(data), plain(options), plain(can))),
  dayRange: (days) => raw.dayRange(plain(days)),
  planServices: (data, selected, presets, options, can) => plain(raw.planServices(plain(data), plain(selected), plain(presets), { ...options }, plain(can))),
  planRooms: (data, count) => plain(raw.planRooms(plain(data), count)),
};

const base = () => ({
  branches: [{ id: 'b1', name: 'Circulo Medico Dental' }],
  professionals: [{ id: 'p1', display_name: 'Dr Hernan Partida' }],
  professionalBranches: [{ professional_id: 'p1', branch_id: 'b1' }],
  professionalServices: [{ professional_id: 'p1', service_id: 's1' }],
  services: [{ id: 's1', name: 'Consulta y valoración inicial', template_key: 'diagnostic-initial' }],
  clinicHours: [],
  professionalHours: [],
  rooms: [],
});
const both = { clinic: true, schedule: true };
const standard = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };

test('la clínica de la captura: sólo faltan los dos horarios', () => {
  const a = api.assess(base());
  assert.equal(a.ready, false);
  assert.deepEqual(a.steps.filter((s) => !s.done && !s.optional).map((s) => s.id), ['clinicHours', 'professionalHours']);
  assert.match(a.steps[1].detail, /Circulo Medico Dental/);
  assert.match(a.steps[3].detail, /Dr Hernan Partida/);
});

test('el horario estándar crea cinco bloques de clínica y cinco del profesional', () => {
  const p = api.plan(base(), standard, both);
  assert.equal(p.clinic.length, 5);
  assert.equal(p.professional.length, 5);
  assert.deepEqual(p.clinic.map((r) => r.weekday), [1, 2, 3, 4, 5]);
  assert.ok(p.clinic.every((r) => r.starts_at === '09:00' && r.ends_at === '18:00'));
  assert.ok(p.professional.every((r) => r.professional_id === 'p1' && r.branch_id === 'b1'));
  assert.deepEqual(p.skipped, []);
});

test('con los horarios creados la agenda queda lista', () => {
  const data = base();
  const p = api.plan(data, standard, both);
  data.clinicHours = p.clinic;
  data.professionalHours = p.professional;
  assert.equal(api.assess(data).ready, true);
  // Repetir el asistente ya no crea nada: es idempotente.
  const again = api.plan(data, standard, both);
  assert.equal(again.clinic.length + again.professional.length, 0);
});

test('respeta los días que ya tienen horario y no duplica', () => {
  const data = base();
  data.clinicHours = [{ branch_id: 'b1', weekday: 1, starts_at: '10:00:00', ends_at: '14:00:00' }];
  data.professionalHours = [{ professional_id: 'p1', branch_id: 'b1', weekday: 2 }];
  const p = api.plan(data, standard, both);
  assert.deepEqual(p.clinic.map((r) => r.weekday), [2, 3, 4, 5], 'el lunes ya tenía horario');
  // El lunes del profesional se recorta al horario de la clínica (10:00–14:00); el martes ya tenía.
  const lunes = p.professional.filter((r) => r.weekday === 1);
  assert.deepEqual(lunes.map((r) => [r.starts_at, r.ends_at]), [['10:00', '14:00']]);
  assert.equal(p.professional.filter((r) => r.weekday === 2).length, 0);
});

test('el horario del profesional nunca sale del de la clínica', () => {
  const data = base();
  data.clinicHours = [1, 2, 3, 4, 5].map((d) => ({ branch_id: 'b1', weekday: d, starts_at: '10:00:00', ends_at: '16:00:00' }));
  const p = api.plan(data, standard, both);
  assert.equal(p.clinic.length, 0);
  assert.ok(p.professional.every((r) => r.starts_at === '10:00' && r.ends_at === '16:00'));
  const noche = api.plan(data, { days: [1], start: '17:00', end: '20:00' }, both);
  assert.equal(noche.professional.length, 0);
  assert.equal(noche.skipped.length, 1, 'se avisa de lo que se omite');
});

test('sin permiso de Mi clínica sólo se crea lo del profesional, y sin horario de clínica se omite', () => {
  const p = api.plan(base(), standard, { clinic: false, schedule: true });
  assert.equal(p.clinic.length, 0);
  assert.equal(p.professional.length, 0);
  assert.equal(p.skipped.length, 5);
  const q = api.plan(base(), standard, { clinic: true, schedule: false });
  assert.equal(q.clinic.length, 5);
  assert.equal(q.professional.length, 0);
});

test('valida días y horas', () => {
  assert.match(api.plan(base(), { days: [], start: '09:00', end: '18:00' }, both).error, /al menos un día/);
  assert.match(api.plan(base(), { days: [1], start: '18:00', end: '09:00' }, both).error, /posterior/);
  assert.match(api.plan(base(), { days: [1], start: '', end: '09:00' }, both).error, /posterior/);
});

test('varias sucursales y profesionales: cada uno sólo en sus sucursales', () => {
  const data = base();
  data.branches.push({ id: 'b2', name: 'Norte' });
  data.professionals.push({ id: 'p2', display_name: 'Dra Ruiz' });
  data.professionalBranches.push({ professional_id: 'p2', branch_id: 'b2' });
  const p = api.plan(data, { days: [1, 2], start: '09:00', end: '13:00' }, both);
  assert.equal(p.clinic.length, 4);
  assert.deepEqual(p.professional.filter((r) => r.professional_id === 'p2').map((r) => r.branch_id), ['b2', 'b2']);
  assert.deepEqual(p.professional.filter((r) => r.professional_id === 'p1').map((r) => r.branch_id), ['b1', 'b1']);
});

test('los pasos detectan sucursal, profesional y servicio faltantes', () => {
  const a = api.assess({ branches: [], professionals: [], professionalBranches: [], professionalServices: [], services: [], clinicHours: [], professionalHours: [], rooms: [] });
  assert.deepEqual(a.steps.filter((s) => !s.done && !s.optional).map((s) => s.id), ['branch', 'clinicHours', 'professional', 'professionalHours', 'services']);
  const sinServicio = base(); sinServicio.professionalServices = [];
  assert.equal(api.assess(sinServicio).steps.find((s) => s.id === 'services').done, false);
  const inactivo = base(); inactivo.services = [];
  assert.match(api.assess(inactivo).steps.find((s) => s.id === 'services').detail, /Aún no hay servicios/);
  assert.equal(api.assess(inactivo).steps.find((s) => s.id === 'services').done, false);
});

test('el rango de días se lee en español', () => {
  assert.equal(api.dayRange([1, 2, 3, 4, 5]), 'Lun a Vie');
  assert.equal(api.dayRange([1, 2, 3, 4, 5, 6]), 'Lun a Sáb');
  assert.equal(api.dayRange([1, 3]), 'Lun, Mié');
  assert.equal(api.dayRange([0]), 'Dom');
});

test('el asistente escribe con permisos de la base, de forma idempotente y atómica por tabla', () => {
  const source = read('smyl-schedule-setup.js');
  assert.match(source, /smyl_has_permission', \{ p_tenant_id: tenant, p_permission: permission \}/);
  assert.match(source, /ask\('schedule\.manage'\), ask\('clinic\.manage'\)/);
  assert.match(source, /from\('smyl_clinic_hours'\)\.upsert\(.*onConflict: 'tenant_id,branch_id,weekday,starts_at,ends_at'/);
  assert.match(source, /from\('smyl_professional_hours'\)\.upsert\(.*onConflict: 'tenant_id,professional_id,branch_id,weekday,starts_at,ends_at'/);
  assert.match(source, /tenant_id: tenant/, 'toda escritura lleva el tenant de la sesión');
  assert.match(source, /no se duplicará nada/);
  assert.doesNotMatch(source, /\.delete\(/, 'el asistente no borra nada');
});

test('web, móvil y PWA publican el asistente', () => {
  for (const file of ['smyl-schedule-setup.js', 'smyl-schedule-setup.css', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  assert.match(read('app.html'), /<script defer src="smyl-schedule-setup\.js\?v=2"><\/script>/);
  assert.match(read('app.html'), /<link rel="stylesheet" href="smyl-schedule-setup\.css\?v=2">/);
  assert.match(read('sw.js'), /\/camila\/smyl-schedule-setup\.js\?v=2/);
  assert.match(read('sw.js'), /\/camila\/smyl-schedule-setup\.css\?v=2/);
  const css = read('smyl-schedule-setup.css');
  assert.doesNotMatch(css, /font-size:\s*(?:[0-9]|10)px/, 'texto de al menos 11 px');
  assert.doesNotMatch(css, /border-radius:\s*(?:1[3-9]|[2-9][0-9])px/, 'radios de hasta 12 px en superficies operativas');
});

const presets = [
  { key: 'diagnostic-initial', name: 'Consulta y valoración inicial' },
  { key: 'diagnostic-periodic', name: 'Revisión periódica' },
  { key: 'preventive-prophylaxis', name: 'Limpieza dental / profilaxis' },
];
const allCan = { clinic: true, schedule: true, services: true };
let counter = 0;
const newId = () => `id-${++counter}`;
const empty = () => ({ ...base(), services: [], professionalServices: [] });

test('clínica nueva: crea los servicios elegidos y los asigna a los profesionales', () => {
  const p = api.planServices(empty(), ['diagnostic-initial', 'diagnostic-periodic'], presets, { newId }, allCan);
  assert.deepEqual(p.create.map((c) => c.preset.key), ['diagnostic-initial', 'diagnostic-periodic']);
  assert.equal(p.assignments.length, 2);
  assert.ok(p.assignments.every((a) => a.professional_id === 'p1' && a.isNew));
  assert.deepEqual(p.create.map((c) => c.id), p.assignments.map((a) => a.service_id), 'las asignaciones apuntan a los ids nuevos');
});

test('no repite servicios: ni por plantilla ni por nombre sin acentos ni mayúsculas', () => {
  const data = empty();
  data.services = [{ id: 'x1', name: 'REVISION PERIODICA', template_key: null }, { id: 'x2', name: 'Otro', template_key: 'preventive-prophylaxis' }];
  data.professionalServices = [{ professional_id: 'p1', service_id: 'x1' }, { professional_id: 'p1', service_id: 'x2' }];
  const p = api.planServices(data, ['diagnostic-initial', 'diagnostic-periodic', 'preventive-prophylaxis'], presets, { newId }, allCan);
  assert.deepEqual(p.create.map((c) => c.preset.key), ['diagnostic-initial']);
  assert.deepEqual(p.already.map((x) => x.key).sort(), ['diagnostic-periodic', 'preventive-prophylaxis']);
});

test('asigna también servicios existentes que ningún profesional realiza, sin duplicar pares', () => {
  const data = empty();
  data.services = [{ id: 'x1', name: 'Blanqueamiento', template_key: null }, { id: 'x2', name: 'Limpieza', template_key: null }];
  data.professionalServices = [{ professional_id: 'p1', service_id: 'x2' }];
  const p = api.planServices(data, [], presets, { newId }, allCan);
  assert.equal(p.create.length, 0);
  assert.deepEqual(p.assignments.map((a) => a.service_id), ['x1'], 'x2 ya tiene profesional');
  data.professionals.push({ id: 'p2', display_name: 'Dra Ruiz' });
  const q = api.planServices(data, [], presets, { newId }, allCan);
  assert.deepEqual(q.assignments.map((a) => a.professional_id + ':' + a.service_id).sort(), ['p1:x1', 'p2:x1']);
});

test('sin permisos: sin configuración no se crean servicios y sin Agenda no se asigna', () => {
  const sinConfig = api.planServices(empty(), ['diagnostic-initial'], presets, { newId }, { schedule: true, services: false });
  assert.equal(sinConfig.create.length + sinConfig.assignments.length, 0);
  const sinAgenda = api.planServices(empty(), ['diagnostic-initial'], presets, { newId }, { schedule: false, services: true });
  assert.equal(sinAgenda.create.length, 1);
  assert.equal(sinAgenda.assignments.length, 0);
  const sinAsignar = api.planServices(empty(), ['diagnostic-initial'], presets, { newId, assign: false }, allCan);
  assert.equal(sinAsignar.create.length, 1);
  assert.equal(sinAsignar.assignments.length, 0);
});

test('sillones: sólo en sucursales que no tienen, con nombres numerados y límites', () => {
  const data = base();
  data.branches.push({ id: 'b2', name: 'Norte' });
  data.rooms = [{ id: 'r1', branch_id: 'b1', name: 'Sillón 1' }];
  const p = api.planRooms(data, 2);
  assert.deepEqual(p.map((r) => r.branch_id + ':' + r.name), ['b2:Sillón 1', 'b2:Sillón 2']);
  assert.equal(api.planRooms(base(), 0).length, 1, 'mínimo uno');
  assert.equal(api.planRooms(base(), 99).length, 10, 'máximo diez');
  assert.equal(api.planRooms({ ...base(), rooms: [{ id: 'r', branch_id: 'b1', name: 'Sala' }] }, 3).length, 0, 'ya tiene sillones');
});

test('los sillones son opcionales: no bloquean que la agenda esté lista', () => {
  const data = base();
  const p = api.plan(data, standard, both);
  data.clinicHours = p.clinic; data.professionalHours = p.professional;
  const a = api.assess(data);
  assert.equal(a.ready, true);
  assert.equal(a.steps.find((s) => s.id === 'rooms').done, false);
  assert.equal(a.steps.find((s) => s.id === 'rooms').optional, true);
});

test('el asistente escribe servicios y sillones con las llaves y permisos de la base', () => {
  const source = read('smyl-schedule-setup.js');
  assert.match(source, /ask\('settings\.manage'\)/);
  assert.match(source, /model\.presetInsert\(c\.preset, tenant, actor\)/, 'reutiliza el catálogo dental, que deja lo fiscal en revisión');
  assert.match(source, /from\('smyl_services'\)\.insert\(rows\)/);
  assert.match(source, /from\('smyl_professional_services'\)\.upsert\(.*onConflict: 'tenant_id,professional_id,service_id', ignoreDuplicates: true/);
  assert.match(source, /from\('smyl_rooms'\)\.insert\(.*room_type: 'sillon'/);
  assert.match(source, /Con sillones configurados, cada cita debe elegir uno/, 'avisa del efecto de configurar sillones');
  assert.doesNotMatch(source, /reference_price/, 'no inventa precios');
});
