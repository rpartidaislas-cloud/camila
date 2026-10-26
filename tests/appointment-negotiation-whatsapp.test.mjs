import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261026210000_smyl_negotiation_whatsapp_delivery.sql');
const edge = read('../supabase/functions/appointment-negotiations/index.ts');
const schedule = read('../smyl-schedule.js');
const inbox = read('../smyl-inbox.js');
const app = read('../app.html');
const worker = read('../sw.js');
const config = read('../supabase/config.toml');

test('WhatsApp transport stores correlation and decisions without message content', () => {
  for (const table of ['smyl_professional_whatsapp_links', 'smyl_appointment_negotiation_deliveries', 'smyl_appointment_negotiation_channel_events']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /unique \(tenant_id, provider_event_id\)/);
  assert.match(migration, /unique \(tenant_id, proposal_id\)/);
  assert.doesNotMatch(migration, /message_body|patient_name|phone_number|texto_mensaje/);
  assert.match(migration, /no guarda texto, teléfono ni contenido del mensaje/);
});

test('channel responses are service-only, idempotent and reuse slot validation', () => {
  assert.match(migration, /smyl_apply_whatsapp_negotiation_response/);
  assert.match(migration, /on conflict \(tenant_id, provider_event_id\) do nothing/);
  assert.match(migration, /smyl_validate_service_appointment_slot/);
  assert.match(migration, /response_channel = 'whatsapp'/);
  assert.match(migration, /grant execute on function public\.smyl_apply_whatsapp_negotiation_response[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.smyl_apply_whatsapp_negotiation_response[\s\S]*to authenticated/);
});

test('callback requires raw-body HMAC, freshness and exact delivery correlation', () => {
  assert.match(edge, /SMYL_NEGOTIATION_WEBHOOK_SECRET/);
  assert.match(edge, /X-SMYL-Signature: sha256=/);
  assert.match(edge, /crypto\.subtle\.sign\("HMAC"/);
  assert.match(edge, /safeEqual\(signature, `sha256=\$\{await hmac\(raw\)\}`\)/);
  assert.match(edge, /CALLBACK_SKEW_MS = 5 \* 60 \* 1000/);
  assert.match(edge, /provider_message_id/);
  assert.match(edge, /lana_conversation_id/);
  assert.match(config, /\[functions\.appointment-negotiations\]\s*\r?\nverify_jwt = false/);
});

test('templates are approved in LANA and sent with stable idempotency', () => {
  assert.match(edge, /\/inbox\/whatsapp\/templates\?status=all/);
  assert.match(edge, /toUpperCase\(\) === "APPROVED"/);
  assert.match(edge, /cita_confirmacion_profesional_v1/);
  assert.match(edge, /cita_propuesta_paciente_v1/);
  assert.match(edge, /sendHeaders\.set\("Idempotency-Key", key\)/);
  assert.match(edge, /type: "template", template_id: template, template_variables: variables/);
});

test('professional links their own WhatsApp conversation explicitly', () => {
  assert.match(edge, /action === "link_my_professional"/);
  assert.match(edge, /eq\("user_id", auth\.user\.id\)/);
  assert.match(edge, /channel=whatsapp/);
  assert.match(inbox, /Usar como mi WhatsApp profesional/);
  assert.match(inbox, /action:'link_my_professional'/);
  assert.match(inbox, /conversation\.channel!==\'whatsapp\'/);
});

test('Agenda dispatches each layer and keeps an explicit manual fallback', () => {
  assert.match(schedule, /functions\.invoke\('appointment-negotiations'/);
  assert.match(schedule, /dispatchNegotiation\(negotiationId,'professional'\)/);
  assert.match(schedule, /dispatchNegotiation\(id,'patient'\)/);
  assert.match(schedule, /Registrar confirmación/);
  assert.match(schedule, /Registrar aceptación/);
  assert.match(schedule, /WhatsApp no enviado/);
});

test('web, mobile and offline versions stay synchronized', () => {
  assert.match(app, /smyl-schedule\.js\?v=26/);
  assert.match(app, /smyl-inbox\.js\?v=38/);
  assert.match(worker, /whatsapp-callbacks/);
  assert.equal(schedule, read('../mobile/www/smyl-schedule.js'));
  assert.equal(inbox, read('../mobile/www/smyl-inbox.js'));
  assert.equal(app, read('../mobile/www/app.html'));
});
