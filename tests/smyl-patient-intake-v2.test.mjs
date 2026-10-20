import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Alta de pacientes v2: teléfono con prefijo, detección de duplicados con la
// misma regla que la vinculación del chat, datos de atención y consentimiento.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('la migración amplía camila_pacientes y expone la búsqueda de duplicados a usuarios autenticados', () => {
  const sql = read('supabase/migrations/20261020150000_smyl_patient_intake_v2.sql');
  for (const column of ['origen', 'branch_id', 'professional_id', 'alertas_medicas', 'consentimiento_whatsapp', 'consentimiento_whatsapp_at']) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`), `falta la columna ${column}`);
  }
  assert.match(sql, /references public\.smyl_branches\(tenant_id, id\)/);
  assert.match(sql, /references public\.smyl_professionals\(tenant_id, id\)/);
  assert.match(sql, /create or replace function public\.smyl_patient_duplicates\(/);
  assert.match(sql, /public\.smyl_normalize_contact_phone\(p\.telefono\)/, 'debe reutilizar la normalización del chat');
  assert.match(sql, /public\.smyl_has_permission\(p_tenant_id, 'patients\.read'\)/);
  assert.match(sql, /public\.smyl_can_access_patient\(p_tenant_id, p\.id, 'patients'\)/);
  assert.match(sql, /p_tenant_id = public\.smyl_current_tenant\(\)/);
  assert.match(sql, /grant execute on function public\.smyl_patient_duplicates\(uuid, text, text, uuid\) to authenticated/);
  assert.match(sql, /create trigger smyl_patient_consent_stamp/);
});

test('el modal pide teléfono con prefijo, correo, atención, alertas y consentimiento', () => {
  const app = read('app.html');
  for (const id of ['mp-tel-cc', 'mp-tel', 'mp-email', 'mp-duplicados', 'mp-sucursal', 'mp-profesional', 'mp-origen', 'mp-alerta-input', 'mp-alertas', 'mp-consent-wa', 'mp-fnac', 'mp-genero', 'mp-notas']) {
    assert.match(app, new RegExp(`id="${id}"`), `falta #${id}`);
  }
  assert.match(app, /<option value="52" selected>MX \+52<\/option>/);
  assert.match(app, /acepta recibir recordatorios y mensajes de la clínica por WhatsApp/);
  assert.match(app, /<summary>Más datos · opcional<\/summary>/);
  assert.doesNotMatch(app, /💾 Guardar paciente/, 'sin emojis en controles (política visual)');
});

test('la lógica de alta normaliza el teléfono, detecta duplicados y degrada sin la migración', () => {
  const clinic = read('smyl-clinic.js');
  assert.match(clinic, /function phoneKey\(/);
  assert.match(clinic, /digits\.length === 12 && digits\.slice\(0, 2\) === '52'/, 'misma regla que smyl_normalize_contact_phone');
  assert.match(clinic, /function composePhone\(/);
  assert.match(clinic, /sb\.rpc\('smyl_patient_duplicates'/);
  assert.match(clinic, /PGRST202/, 'sin la RPC compara contra la lista cargada');
  assert.match(clinic, /Abrir su ficha/);
  assert.match(clinic, /Es otra persona, continuar/);
  assert.match(clinic, /Revisa el posible duplicado antes de guardar/);
  assert.match(clinic, /error\.code !== 'PGRST204'/, 'sin las columnas nuevas guarda los datos básicos');
  assert.match(clinic, /from\('smyl_branches'\)\.select\('id,name,is_default'\)/);
  assert.match(clinic, /from\('smyl_professionals'\)\.select\('id,display_name'\)/);
  assert.match(clinic, /consentimiento_whatsapp: document\.getElementById\('mp-consent-wa'\)\.checked/);
  assert.doesNotMatch(clinic, /extra\.append\(document\.getElementById\(id\)\.closest\('\.fg'\)\)/, 'el markup ya trae la sección opcional');
});

test('web, móvil y PWA publican la misma alta de pacientes v2', () => {
  for (const file of ['smyl-clinic.js', 'smyl-clinic.css', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  for (const file of ['app.html', 'sw.js']) {
    const source = read(file);
    assert.match(source, /smyl-clinic\.js\?v=10/, `${file} debe cargar smyl-clinic.js v10`);
    assert.match(source, /smyl-clinic\.css\?v=5/, `${file} debe cargar smyl-clinic.css v5`);
  }
});
