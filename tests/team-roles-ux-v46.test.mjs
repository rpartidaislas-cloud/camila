import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../smyl-clinic-admin.js');
const styles = read('../smyl-clinic-admin.css');

test('agregar doctor reutiliza una cuenta de la clínica sin reenviar correo', () => {
  assert.match(script, /function memberByEmail/);
  assert.match(script, /function professionalForMember/);
  assert.match(script, /existing \? await configureExistingDoctor/);
  assert.match(script, /rpc\('smyl_create_professional'/);
  assert.match(script, /rpc\('smyl_set_member_role'/);
  assert.match(script, /rpc\('smyl_set_member_primary_branch'/);
  assert.match(script, /roleByCode\('odontologo'\)/);
  assert.match(script, /No fue necesario enviar otro correo/);
});

test('el correo sólo se usa para accesos realmente nuevos', () => {
  const detection = script.indexOf('var existing = memberByEmail(email)');
  const fetchInvite = script.indexOf("'/functions/v1/invite-staff'");
  assert.ok(detection > -1 && detection < fetchInvite);
  assert.match(script, /Ese correo ya pertenece a tu equipo/);
  assert.match(script, /Ese correo ya usa SMYL/);
});

test('equipo y profesionales se presentan como una sola ficha por persona', () => {
  assert.match(script, /Personas con acceso/);
  assert.match(script, /professionalForMember\(user\.id\)/);
  assert.match(script, /Doctor<\/span>/);
  assert.match(script, /Los doctores vinculados se identifican en la misma lista/);
  assert.match(script, /row\.active && !row\.user_id/);
});

test('el módulo aplica escala legible, controles táctiles y composición responsive', () => {
  assert.match(styles, /SMYL UI v3 · Configuración de clínica y equipo/);
  assert.match(styles, /\.clinic-admin-page\s*\{[\s\S]*?font-size:14px/);
  assert.match(styles, /\.clinic-admin-field :is\(input,select,textarea\)\{[^}]*min-height:48px/);
  assert.match(styles, /\.clinic-admin-page \.btn\{[^}]*min-height:42px/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /@media\(max-width:440px\)/);
});
