import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const edge = read('../supabase/functions/lana-inbox/index.ts');
const handoffEdge = read('../supabase/functions/lana-handoff/index.ts');
const handoffUi = read('../smyl-lana-handoff.js');
const migration = read('../supabase/migrations/20261016190000_smyl_automatic_conversation_patient_link.sql');
const hardening = read('../supabase/migrations/20261016193000_smyl_lana_patient_link_hardening.sql');
const css = read('../smyl-inbox.css');
const preview = read('./fixtures/smyl-inbox-stage7-preview.html');

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `No se encontró ${start}`);
  assert.notEqual(to, -1, `No se encontró ${end}`);
  return source.slice(from, to);
}

test('abrir una conversación intenta identificar al paciente antes de cargar su continuidad', () => {
  assert.match(inbox, /var patientReady = prepareConversationPatient\(id\)/);
  assert.match(inbox, /await autoLinkConversationPatient\(conversationId\)/);
  assert.match(inbox, /action: 'auto_patient_link'/);
  assert.match(inbox, /state\.patientLinking\[conversationId\]/);
  assert.match(inbox, /created_patient/);
});

test('la vinculación automática es tenant-aware, idempotente y no crea un caso clínico', () => {
  const rpc = between(migration, 'create or replace function public.smyl_auto_link_lana_conversation', 'revoke all on function public.smyl_auto_link_lana_conversation');
  assert.match(rpc, /smyl_actor_has_permission_explicit\(p_actor_id, p_tenant_id, 'messages\.read'\)/);
  assert.match(rpc, /smyl_actor_has_permission_explicit\(p_actor_id, p_tenant_id, 'patients\.manage'\)/);
  assert.match(rpc, /pg_advisory_xact_lock/);
  assert.match(rpc, /h\.tenant_id = p_tenant_id/);
  assert.match(rpc, /count\(distinct p\.id\)/);
  assert.match(rpc, /'ambiguous'/);
  assert.match(rpc, /'needs_identity'/);
  assert.match(rpc, /case_id,[\s\S]*null,[\s\S]*p_actor_id/);
  assert.doesNotMatch(rpc, /insert into public\.camila_casos/);
});

test('todos los flujos clínicos serializan por la misma conversación', () => {
  const lock = /'smyl-lana-conversation:' \|\| p_tenant_id::text \|\| ':' \|\| p_lana_conversation_id::text/;
  assert.match(migration, lock);
  assert.equal((hardening.match(new RegExp(lock.source, 'g')) || []).length, 2);
  assert.match(hardening, /for update/);
  assert.match(hardening, /link_kind = 'confirmed'/);
});

test('un contacto nuevo requiere correo o teléfono verificable y queda provisional', () => {
  const rpc = between(migration, 'create or replace function public.smyl_auto_link_lana_conversation', 'revoke all on function public.smyl_auto_link_lana_conversation');
  assert.match(rpc, /if v_email = '' and v_phone_key = ''/);
  assert.match(rpc, /Contacto provisional creado desde una conversación/);
  assert.match(rpc, /'created_contact'/);
  assert.match(migration, /smyl_normalize_contact_phone/);
  assert.match(migration, /left\([^\n]+, 2\) = '52'/);
  assert.match(hardening, /link_kind in \('manual', 'matched', 'created_contact', 'confirmed'\)/);
  assert.match(edge, /handoff\?\.link_kind === "created_contact"/);
});

test('el endpoint automático exige acceso al hilo, permiso e idempotencia', () => {
  const post = between(edge, 'const conversationId = uuid(body.conversation_id);', 'if (action === "appointment_request"');
  assert.match(post, /canAccessConversation\(actor, auth\.tenantId, conversationId\)/);
  assert.match(post, /requirePermission\(actor, "patients\.manage"/);
  assert.match(post, /Idempotency-Key/);
  assert.match(post, /autoLinkConversationPatient/);
});

test('la ficha y los adjuntos vuelven a comprobar el alcance clínico del paciente', () => {
  assert.match(edge, /accessiblePatient\(actor, tenantId, String\(handoff\.patient_id\), "clinical"\)/);
  assert.match(edge, /code: "patient_scope_denied"/);
  assert.match(edge, /const caseQuery = handoff\.case_id/);
  assert.match(edge, /const linksQuery = handoff\.case_id/);
});

test('la resolución manual ya no preselecciona un expediente ambiguo', () => {
  assert.doesNotMatch(handoffUi, /i===0\?'checked'/);
  assert.match(handoffUi, /!existing&&candidates\?'disabled'/);
  assert.match(handoffUi, /patient_link_preview/);
  assert.match(handoffUi, /patient_link_confirm/);
  assert.match(handoffUi, /\/functions\/v1\/lana-inbox/);
  assert.match(edge, /if \(action === "patient_link_preview" \|\| action === "patient_link_confirm"\)/);
  assert.match(edge, /smyl_lana_patient_candidates/);
  assert.match(edge, /canAccessConversation\(actor, auth\.tenantId, conversationId\)/);
  assert.doesNotMatch(handoffEdge, /smyl_lana_patient_candidates|camila_confirmar_lana_handoff/);
  assert.doesNotMatch(edge, /\.limit\(1000\)/);
});

test('Agenda usa una escala tipográfica coherente y controles accesibles', () => {
  assert.match(css, /--agenda-type-eyebrow:10px/);
  assert.match(css, /--agenda-type-label:10px/);
  assert.match(css, /--agenda-type-control:13px/);
  assert.match(css, /--agenda-type-display:21px/);
  assert.match(css, /width:min\(1000px/);
  assert.match(css, /height:38px/);
  assert.match(css, /--agenda-type-control:15px/);
  assert.match(css, /height:44px/);
  assert.match(css, /button:focus-visible/);
});

test('el fixture permite verificar vínculo existente, contacto nuevo y conflicto', () => {
  assert.match(preview, /action === 'auto_patient_link'/);
  assert.match(preview, /new-patient/);
  assert.match(preview, /ambiguous-patient/);
  assert.match(preview, /needs_identity/);
});
