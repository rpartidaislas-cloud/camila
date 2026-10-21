import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// La Agenda ya no descarga a todos los pacientes: busca en el servidor, completa sólo
// los nombres que necesitan las citas, y degrada a una consulta directa si la función
// de la base aún no está aplicada.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const schedule = read('smyl-schedule.js');
const sql = read('supabase/migrations/20261021120000_smyl_search_patients.sql');

test('la carga inicial trae sólo los 200 pacientes más recientes, no la lista completa', () => {
  assert.match(schedule, /camila_pacientes'\)\.select\('id,nombre,apellido,telefono,email'\)\.eq\('tenant_id',state\.tenant\)\.order\('updated_at',\{ascending:false\}\)\.limit\(200\)/);
  assert.doesNotMatch(schedule, /camila_pacientes'\)\.select\('id,nombre,apellido,telefono,email'\)\.eq\('tenant_id',state\.tenant\)\.order\('nombre'\)\)/, 'sin la consulta sin límite (PostgREST corta en 1000)');
});

test('los pacientes de las citas y solicitudes se completan por id en lotes', () => {
  assert.match(schedule, /async function ensurePatients\(ids\)/);
  assert.match(schedule, /for\(var i=0;i<missing\.length;i\+=100\)/);
  assert.match(schedule, /\.in\('id',missing\.slice\(i,i\+100\)\)/);
  assert.match(schedule, /await ensurePatients\(state\.appointments\.map\(function\(a\)\{return a\.patient_id;\}\)\.concat\(state\.requests\.map/);
  assert.match(schedule, /ensurePatients\(\[patientId\]\)\.then\(function\(\)\{openNew\(null,patientId\);\}\)/, 'agendar desde un paciente que no está en los recientes');
});

test('reprogramar o revisar una solicitud sólo ofrece al paciente de la cita', () => {
  assert.match(schedule, /options\(state\.patients\.filter\(function\(x\)\{return x\.id===patient;\}\)/);
});

test('la búsqueda llama a la función del servidor con espera y descarta respuestas viejas', () => {
  assert.match(schedule, /rpc\('smyl_search_patients',\{p_tenant_id:state\.tenant,p_query:q,p_limit:8\}\)/);
  assert.match(schedule, /timer=setTimeout\(async function\(\)\{try\{var rows=await searchRemote\(q\);if\(mine!==seq\)return;/, 'espera de 250 ms y secuencia anti respuestas tardías');
  assert.match(schedule, /\},250\);\}/);
  assert.match(schedule, /Buscando…/);
  assert.match(schedule, /No se pudo buscar en el servidor\. Se muestran pacientes ya cargados\./);
  assert.match(schedule, /input\.addEventListener\('input',function\(\)\{[^}]*runSearch\(\);\}\)/);
});

test('sin la función en la base cae a una consulta directa con las dos formas del texto', () => {
  assert.match(schedule, /function missingRpc\(err\)\{[^}]*PGRST202[^}]*42883/);
  assert.match(schedule, /forms=\[raw,plain\(raw\)\]/, 'texto con y sin acentos');
  assert.match(schedule, /\.or\(expr\.join\(','\)\)\.limit\(40\)/);
  assert.match(schedule, /matchPatients\(rows\|\|\[\],q\)\.slice\(0,8\)/);
});

test('un teléfono con espacios se busca completo también en el respaldo del navegador', () => {
  assert.match(schedule, /\/\^\[0-9\\s\(\)\+\.-\]\+\$\/\.test\(q\.trim\(\)\)&&digitsOf\(q\)\.length>=3/);
});

test('la función de la base respeta el rol, no filtra por trozos de teléfono y acota el límite', () => {
  assert.match(sql, /security invoker/, 'RLS y el alcance del rol deciden qué filas ve cada persona');
  assert.doesNotMatch(sql, /security definer/);
  assert.match(sql, /p_tenant_id = public\.smyl_current_tenant\(\)/);
  assert.match(sql, /translate\(lower\(btrim\(coalesce\(p_query, ''\)\)\), 'áéíóúüñ', 'aeiouun'\)/, 'sin acentos ni mayúsculas');
  assert.match(sql, /\[1:6\]/, 'máximo seis términos');
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 8\), 1\), 20\)/);
  assert.match(sql, /replace\(replace\(replace\(t, '\\', '\\\\'\), '%', '\\%'\), '_', '\\_'\)/, 'los comodines del usuario son texto literal');
  assert.match(sql, /\^\[0-9\\s\(\)\+\.-\]\+\$/, 'un teléfono con espacios se busca completo');
  assert.match(sql, /revoke all on function public\.smyl_search_patients\(uuid, text, integer\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.smyl_search_patients\(uuid, text, integer\) to authenticated;/);
});

test('el flujo manual aplica la migración correcta y verifica función, invoker y permisos', () => {
  const workflow = read('.github/workflows/smyl-buscar-pacientes-migracion.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.match(workflow, /MIGRATION_VERSION: "20261021120000"/);
  assert.match(workflow, /MIGRATION_FILE: supabase\/migrations\/20261021120000_smyl_search_patients\.sql/);
  assert.match(workflow, /not p\.prosecdef/);
  assert.match(workflow, /has_function_privilege\('authenticated'[\s\S]*?not has_function_privilege\('anon'/);
  const ref = read('supabase/config.toml').match(/project_id = "([a-z0-9]+)"/)?.[1];
  assert.ok(workflow.includes(`PROJECT_REF: ${ref}`));
});

test('web, móvil y PWA publican la misma Agenda', () => {
  for (const file of ['smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-schedule\.js\?v=13/);
    assert.match(read(file), /smyl-schedule\.css\?v=8/);
  }
  assert.match(read('smyl-schedule.css'), /\.schedule-patient-status\{/);
});
