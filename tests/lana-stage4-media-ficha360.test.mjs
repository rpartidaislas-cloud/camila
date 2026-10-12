import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const ui = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const edge = read('../supabase/functions/lana-inbox/index.ts');
const helper = read('../supabase/functions/_shared/lana-linked.ts');
const migration = read('../supabase/migrations/20261011230000_lana_clinical_message_links.sql');

test('SMYL renders enriched messages without persisting LANA chat data in the browser', () => {
  for (const feature of ['data-compose-attach', 'data-compose-location', 'smyl-inbox-quote', 'Enviar a revisión clínica', 'Ficha 360', 'data-inbox-forward']) assert.match(ui, new RegExp(feature));
  assert.match(ui, /requestForm/); assert.match(ui, /clipboardData/); assert.match(ui, /dataTransfer/);
  assert.match(css, /smyl-inbox-message-actions/); assert.match(css, /smyl-inbox-forward-dialog/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
});

test('the bridge keeps tenant and LANA credentials server-side for media and clinical links', () => {
  assert.match(edge, /requireUser\(req, CORS\)/);
  assert.match(edge, /auth\.tenantId/);
  assert.match(edge, /camila_vincular_lana_imagen/);
  assert.match(edge, /message\.media_type !== "image"/);
  assert.match(edge, /lana_cita_id/);
  assert.match(ui, /Cita vinculada en LANA/);
  assert.match(ui, /Simulación disponible/);
  assert.match(ui, /Propuesta/);
  assert.match(helper, /!\(init\.body instanceof FormData\)/);
  assert.doesNotMatch(ui, /tenant_id|api_key_ciphertext|SMYL_LANA_ENCRYPTION_KEY/);
});

test('a confirmed chat image links idempotently to the existing patient and case', () => {
  assert.match(migration, /unique \(tenant_id, lana_conversation_id, lana_message_id\)/i);
  assert.match(migration, /camila_lana_handoffs/);
  assert.match(migration, /LANA_HANDOFF_REQUIRED/);
  assert.match(migration, /media_type text not null check \(media_type = 'image'\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /on conflict \(tenant_id, lana_conversation_id, lana_message_id\)/i);
  assert.doesNotMatch(migration, /media_url|imagen_original_url/);
});

