import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261119200000_smyl_invitation_professional_whatsapp.sql');
const invite = read('supabase/functions/invite-staff/index.ts');
const admin = read('smyl-clinic-admin.js');

test('la invitación guarda el WhatsApp del profesional y se copia al aceptar', () => {
  assert.match(migration, /alter table public\.smyl_staff_invitations\s+add column if not exists contact_phone text not null default ''/);
  assert.match(migration, /smyl_staff_invitations_contact_phone_check/);
  assert.match(migration, /invitation\.contact_phone, invitation\.contact_phone_public and invitation\.contact_phone <> ''/);
  assert.match(migration, /p\.contact_phone = ''/, 'no pisa un WhatsApp que el perfil ya tenía');
  assert.match(migration, /raise exception using errcode = '28000'/, 'conserva el rechazo de invitaciones vencidas');
});

test('invite-staff valida y guarda el WhatsApp solo para profesionales', () => {
  assert.match(invite, /memberKind === "professional" \? String\(body\?\.contact_phone/);
  assert.match(invite, /\^\[0-9 \+\(\)\.-\]\{0,40\}\$/);
  assert.match(invite, /contact_phone: contactPhone, contact_phone_public: contactPhonePublic/);
});

test('«Agregar profesional» pide el WhatsApp y lo envía en la invitación', () => {
  assert.match(admin, /<h2>Agregar profesional<\/h2>/);
  assert.match(admin, /id="ca-prof-contact" name="contact_phone"/);
  assert.match(admin, /contact_phone: String\(input\.contact_phone \|\| ''\)\.trim\(\), contact_phone_public: !!input\.contact_phone_public/);
  assert.doesNotMatch(admin, /ca-prof-whatsapp-later/);
});
