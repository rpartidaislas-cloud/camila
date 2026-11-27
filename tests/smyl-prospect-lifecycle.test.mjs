import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261203100000_smyl_prospect_lifecycle.sql');
const paste = read('docs/sql-prospectos-migrar-pegar-en-supabase.sql');

test('la migración es aditiva: no reclasifica datos ni cambia llaves foráneas', () => {
  assert.match(sql, /add column if not exists ciclo_vida text not null default 'paciente'/);
  assert.doesNotMatch(sql, /^\s*update public\.camila_pacientes\s+set ciclo_vida = 'prospecto'/mi);
  assert.doesNotMatch(sql, /foreign key|references /i);
});

test('la conversión manual exige permiso y alcance sobre el paciente', () => {
  const body = sql.match(/function public\.smyl_promote_prospect\(p_patient_id uuid\)[\s\S]*?\n\$\$;/)[0];
  assert.match(body, /smyl_has_permission\(v_tenant, 'patients\.manage'\)/);
  assert.match(body, /smyl_can_access_patient\(v_tenant, p_patient_id, 'patients'\)/);
  assert.match(sql, /grant execute on function public\.smyl_promote_prospect\(uuid\) to authenticated/);
  assert.match(sql, /revoke all on function public\.smyl_promote_prospect_on_attendance\(\) from public, anon, authenticated/);
});

test('el SQL de reclasificación muestra una vista previa y deja aplicar comentado', () => {
  assert.match(paste, /PASO 1/);
  assert.match(paste, /pasarian_a_prospecto/);
  const active = paste.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(active, /\bupdate\s+public\.camila_pacientes/i, 'el UPDATE no debe correr sin quitar los comentarios');
  assert.match(paste, /registro_estado = 'pendiente'/);
  assert.match(paste, /smyl_clinical_retention_guards/);
});

const require = createRequire(import.meta.url);
let pgliteEntry;
try { pgliteEntry = require.resolve('@electric-sql/pglite', { paths: [...(process.env.SMYL_PGLITE_DIR ? [resolve(process.env.SMYL_PGLITE_DIR)] : []), resolve('.')] }); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND' || process.env.SMYL_REQUIRE_PGLITE === '1') throw error; }

test('PostgreSQL: la primera llegada convierte al prospecto y el invariante lo protege', { skip: pgliteEntry ? false : 'Define SMYL_PGLITE_DIR para ejecutar el contrato.' }, async (t) => {
  const { PGlite } = await import(pathToFileURL(pgliteEntry).href);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role authenticated; create role anon;
    create table public.camila_pacientes (tenant_id uuid not null, id uuid primary key default gen_random_uuid(), nombre text);
    create table public.smyl_appointments (tenant_id uuid not null, id uuid primary key default gen_random_uuid(), patient_id uuid not null, status text not null default 'confirmed');
    create function public.smyl_current_tenant() returns uuid language sql as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create function public.smyl_has_permission(t uuid, p text) returns boolean language sql as $$ select current_setting('test.allow', true) = 'yes' $$;
    create function public.smyl_can_access_patient(t uuid, p uuid, d text) returns boolean language sql as $$ select true $$;
  `);
  await db.exec(sql);
  const { SENTINELAS } = await import('../scripts/migration-sentinels.mjs');
  assert.equal((await db.query(SENTINELAS['20261203100000'].sentinel)).rows[0].ok, true);

  const T = '11111111-1111-4111-8111-111111111111';
  const P1 = 'aaaaaaaa-0000-4000-8000-000000000001', P2 = 'aaaaaaaa-0000-4000-8000-000000000002', P3 = 'aaaaaaaa-0000-4000-8000-000000000003';
  const life = async (id) => (await db.query('select ciclo_vida, convertido_at from public.camila_pacientes where id=$1', [id])).rows[0];
  await db.exec(`insert into public.camila_pacientes(tenant_id,id,nombre) values ('${T}','${P1}','Ana'),('${T}','${P2}','Beto'),('${T}','${P3}','Cris')`);
  assert.equal((await life(P1)).ciclo_vida, 'paciente', 'lo existente queda como paciente');

  await db.exec(`update public.camila_pacientes set ciclo_vida='prospecto' where id in ('${P1}','${P2}','${P3}')`);
  assert.equal((await life(P1)).ciclo_vida, 'prospecto');
  await db.exec(`insert into public.smyl_appointments(tenant_id,id,patient_id) values ('${T}','bbbbbbbb-0000-4000-8000-000000000001','${P1}')`);
  assert.equal((await life(P1)).ciclo_vida, 'prospecto', 'agendar no convierte');

  await db.exec(`update public.smyl_appointments set status='no_show' where id='bbbbbbbb-0000-4000-8000-000000000001'`);
  assert.equal((await life(P1)).ciclo_vida, 'prospecto', 'no llegar no convierte');
  await db.exec(`update public.smyl_appointments set status='arrived' where id='bbbbbbbb-0000-4000-8000-000000000001'`);
  const converted = await life(P1);
  assert.equal(converted.ciclo_vida, 'paciente', 'Llegó convierte');
  assert.ok(converted.convertido_at, 'queda la fecha de conversión');

  await db.exec(`insert into public.smyl_appointments(tenant_id,id,patient_id,status) values ('${T}','bbbbbbbb-0000-4000-8000-000000000002','${P2}','arrived')`);
  assert.equal((await life(P2)).ciclo_vida, 'paciente', 'entrar directo como «llegó» (walk-in) convierte');

  await db.exec(`update public.camila_pacientes set ciclo_vida='prospecto' where id='${P1}'`);
  assert.equal((await life(P1)).ciclo_vida, 'paciente', 'quien ya llegó no puede volver a prospecto');
  await db.exec(`insert into public.camila_pacientes(tenant_id,id,nombre,ciclo_vida) values ('${T}','aaaaaaaa-0000-4000-8000-000000000009','Nuevo','prospecto')`);
  assert.equal((await life('aaaaaaaa-0000-4000-8000-000000000009')).ciclo_vida, 'prospecto', 'un alta nueva puede nacer prospecto');

  // Conversión manual
  await db.exec(`select set_config('test.tenant','${T}',false); select set_config('test.allow','no',false);`);
  await assert.rejects(() => db.query('select public.smyl_promote_prospect($1)', [P3]), /No tienes permiso/);
  await db.exec(`select set_config('test.allow','yes',false)`);
  assert.equal((await db.query('select public.smyl_promote_prospect($1) as r', [P3])).rows[0].r, true);
  assert.equal((await life(P3)).ciclo_vida, 'paciente');
  assert.equal((await db.query('select public.smyl_promote_prospect($1) as r', [P3])).rows[0].r, false, 'idempotente');
  await assert.rejects(() => db.query(`select public.smyl_promote_prospect('aaaaaaaa-0000-4000-8000-0000000000ff')`), /no existe/);
  await db.exec(`select set_config('test.tenant','22222222-2222-4222-8222-222222222222',false)`);
  await assert.rejects(() => db.query('select public.smyl_promote_prospect($1)', [P3]), /no existe/, 'otra clínica no ve al paciente');
});

// ── Interfaz ────────────────────────────────────────────────────────────────

const clinicJs = read('smyl-clinic.js');
const scheduleJs = read('smyl-schedule.js');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }

test('la agenda da de alta a la persona nueva como prospecto, con reintento si la columna aún no existe', () => {
  assert.match(scheduleJs, /ciclo_vida:'prospecto'/);
  assert.match(scheduleJs, /optional=\['ciclo_vida','registro_estado'\]/);
  assert.match(scheduleJs, /Se guarda como prospecto: pasa a Pacientes cuando llega a su primera cita/);
});

test('el directorio ofrece el filtro «Prospectos» y la conversión usa la RPC', () => {
  assert.match(clinicJs, /function isProspect\(p\) \{ return !!p && p\.ciclo_vida === 'prospecto'; \}/);
  assert.match(clinicJs, /sb\.rpc\('smyl_promote_prospect', \{ p_patient_id: p\.id \}\)/);
  assert.match(read('app.html'), /data-patient-filter-value="prospects"/);
  for (const file of ['smyl-clinic.js', 'smyl-clinic.css', 'smyl-patients-directory.css', 'smyl-schedule.js', 'app.html', 'sw.js']) {
    assert.equal(read('mobile/www/' + file), read(file), `${file} difiere en mobile/www`);
  }
});

test('navegador: los prospectos no cuentan como pacientes y se convierten con un clic', { skip: chromium ? false : 'Playwright/Chromium no disponible' }, async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<body class="smyl-ui-governed"><section id="p-pacientes">
    <button data-patient-filter-value="all" class="is-active"></button><button data-patient-filter-value="incomplete"></button>
    <button data-patient-filter-value="prospects" hidden>Prospectos <b id="patient-metric-prospects"></b></button>
    <b id="patient-metric-total"></b><b id="patient-metric-incomplete"></b>
    <input id="buscar-pac"><p id="patient-directory-summary"></p><div id="tabla-pacientes-wrap"></div></section></body>`);
  await page.evaluate(() => {
    window.tenantId = 't1'; window.sb = { rpc: (name, args) => { window.__rpc = [name, args]; return Promise.resolve({ data: true, error: null }); } };
    window.sbTimeout = (q) => q; window.TITULOS = {};
    window.todosLosPacientes = [
      { id: 'p1', nombre: 'Ana', apellido: 'Paz', telefono: '5512345678', ciclo_vida: 'paciente' },
      { id: 'p2', nombre: 'Beto', apellido: '', telefono: '5598765432', ciclo_vida: 'prospecto' },
      { id: 'p3', nombre: 'Cris', apellido: '', email: 'c@x.mx' },
    ];
  });
  page.on('pageerror', () => {});
  await page.addScriptTag({ content: clinicJs });
  const names = () => page.$$eval('#tabla-pacientes-wrap .clinic-patient-name-open', (n) => n.map((x) => x.textContent));
  await page.evaluate(() => window.renderTablaPacientes(window.todosLosPacientes));
  assert.deepEqual(await page.evaluate(() => window.todosLosPacientes.length), 3);
  await page.evaluate(() => window.filtrarDirectorioPacientes('all'));
  assert.deepEqual(await names(), ['Ana Paz', 'Cris'], 'la lista normal no incluye prospectos');
  assert.equal(await page.textContent('#patient-metric-total'), '2');
  assert.equal(await page.textContent('#patient-metric-prospects'), '1');
  assert.equal(await page.$eval('[data-patient-filter-value="prospects"]', (b) => b.hidden), false, 'el filtro aparece cuando hay prospectos');

  await page.evaluate(() => window.filtrarDirectorioPacientes('prospects'));
  assert.deepEqual(await names(), ['Beto']);
  assert.match(await page.textContent('#patient-directory-summary'), /1 prospecto/);
  assert.match(await page.textContent('#tabla-pacientes-wrap .clinic-patient-status'), /Prospecto/);

  await page.click('#tabla-pacientes-wrap .clinic-patient-promote');
  await page.waitForFunction(() => window.__rpc);
  assert.deepEqual(await page.evaluate(() => window.__rpc), ['smyl_promote_prospect', { p_patient_id: 'p2' }]);
  await page.waitForFunction(() => window.todosLosPacientes.find((p) => p.id === 'p2').ciclo_vida === 'paciente');
  await page.evaluate(() => window.filtrarDirectorioPacientes('all'));
  assert.deepEqual(await names(), ['Ana Paz', 'Beto', 'Cris'], 'tras convertir, ya aparece entre los pacientes');
  assert.equal(await page.textContent('#patient-metric-total'), '3');
});
