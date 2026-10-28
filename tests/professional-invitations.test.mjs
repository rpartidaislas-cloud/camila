import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261026190000_smyl_professional_invitations.sql');
const edge = read('../supabase/functions/invite-staff/index.ts');
const admin = read('../smyl-clinic-admin.js');
const catalog = await import('../supabase/functions/_shared/whatsapp-template-catalog.mjs');

test('el profesional nace de una invitación aceptada y no de un perfil suelto', () => {
  assert.match(migration, /create table if not exists public\.smyl_staff_invitations/);
  assert.match(migration, /member_kind in \('staff', 'professional'\)/);
  assert.match(migration, /status in \('pending', 'accepted', 'revoked', 'expired'\)/);
  assert.match(migration, /lower\(i\.email\) = lower\(new\.email\)/);
  assert.match(migration, /invitation\.member_kind = 'professional'/);
  assert.match(migration, /insert into public\.smyl_professionals/);
  assert.match(migration, /insert into public\.smyl_professional_branches/);
  assert.match(migration, /r\.code = 'odontologo'/);
  assert.match(migration, /update public\.smyl_staff_invitations[\s\S]*status = 'accepted'/);
});

test('la invitación valida tenant y sucursal antes de enviar el correo', () => {
  assert.match(edge, /memberKind = body\?\.member_kind === "professional"/);
  assert.match(edge, /\.from\("smyl_branches"\)[\s\S]*\.eq\("tenant_id", tenant\.id\)/);
  assert.match(edge, /\.from\("smyl_staff_invitations"\)[\s\S]*invited_by: user\.id/);
  assert.match(edge, /smyl_invitation_id: invitation\.id/);
  assert.match(edge, /delete\(\)\.eq\("id", invitation\.id\)/);
  assert.match(edge, /\(count \|\| 0\) \+ \(pendingCount \|\| 0\) >= limiteUsuarios/);
});

test('Mi clínica agrega doctores sin duplicar cuentas existentes', () => {
  assert.match(admin, /Agregar doctor/);
  assert.match(admin, /member_kind: 'professional'/);
  assert.match(admin, /No enviaremos otro correo/);
  assert.match(admin, /rpc\('smyl_create_professional'/);
  assert.match(admin, /roleByCode\('odontologo'\)/);
  assert.match(admin, /Invitación pendiente/);
  assert.doesNotMatch(admin, /<option value="">Sin vincular<\/option>/);
});

test('el catálogo incluye las plantillas Utility para profesional y paciente', () => {
  const professional = catalog.TEMPLATES.find((item) => item.id === 'cita_confirmacion_profesional_v1');
  const patient = catalog.TEMPLATES.find((item) => item.id === 'cita_propuesta_paciente_v1');
  assert.equal(professional.category, 'UTILITY');
  assert.deepEqual(professional.buttons.map((item) => item.text), ['Confirmar', 'Cambiar horario', 'Rechazar']);
  assert.equal(professional.variables.some((item) => item.source === 'patient_first_name'), false);
  assert.equal(patient.category, 'UTILITY');
  assert.deepEqual(patient.buttons.map((item) => item.text), ['Aceptar', 'Ver otras opciones', 'Hablar con clínica']);
});
