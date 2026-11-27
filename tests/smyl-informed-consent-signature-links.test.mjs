import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migrationPath = 'supabase/migrations/20261129130000_smyl_informed_consent_signing.sql';
const migrationUrl = new URL(migrationPath, root);
const sql = readFileSync(migrationUrl, 'utf8');

function functionSql(name) {
  const marker = `create or replace function public.${name}`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `falta ${name}`);
  const next = sql.indexOf('\ncreate or replace function public.', start + marker.length);
  return sql.slice(start, next === -1 ? sql.length : next);
}

function tableSql(name) {
  const match = sql.match(new RegExp(
    `create table if not exists public\\.${name}\\s*\\(([\\s\\S]*?)\\n\\);`,
    'i',
  ));
  assert.ok(match, `falta la tabla ${name}`);
  return match[1];
}

test('la migración dedicada conserva una sola fuente de verdad', () => {
  assert.equal(existsSync(migrationUrl), true, `falta ${migrationPath}`);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
  assert.match(sql, /drop trigger if exists smyl_informed_consents_immutable[\s\S]*update public\.smyl_informed_consents/i);
  assert.match(sql, /create trigger smyl_informed_consents_immutable\s+before update or delete/i);
  assert.match(sql, /revoke all on (?:table )?public\.smyl_informed_consents from public, anon, authenticated/i);
});

test('el QR congela el documento, vence en cinco minutos y no persiste el token en claro', () => {
  const links = tableSql('smyl_informed_consent_signature_links');
  const create = functionSql('smyl_create_informed_consent_signature_link');
  for (const column of [
    'document_text', 'document_sha256', 'signer_name', 'signer_relation',
    'reference', 'token_hash', 'expires_at', 'acceptance_version',
    'acceptance_text', 'accepted_at', 'signature_sha256', 'capture_token_sha256', 'submitted_at',
  ]) assert.match(links, new RegExp(`\\b${column}\\b`, 'i'), column);
  assert.doesNotMatch(links, /^\s*(?:token|raw_token|plaintext_token)\s+text\b/im);
  assert.match(create, /encode\(gen_random_bytes\(32\), 'hex'\)/i);
  assert.match(create, /sha256\(convert_to\(v_plaintext_token, 'UTF8'\)\)/i);
  assert.match(create, /clock_timestamp\(\) \+ interval '5 minutes'/i);
  assert.match(create, /document_sha256\s*=\s*v_document_hash/i);
  assert.match(create, /document_text, document_sha256/i);
  assert.match(create, /smyl_recent_auth_method\(600\)/i);
  assert.match(sql, /smyl_informed_consent_acceptance_text[\s\S]*patient-consent-v1[\s\S]*Leí o recibí la lectura/i);
  assert.match(create, /pg_advisory_xact_lock[\s\S]*:consent-link/i);
});

test('la consulta pública muestra el documento y la captura exige aceptación y PNG estricto', () => {
  const info = functionSql('smyl_informed_consent_signature_link_info');
  const submit = functionSql('smyl_submit_informed_consent_signature');
  for (const key of [
    'clinic_name', 'procedure_title', 'document_text', 'document_sha256',
    'signer_name', 'signer_relation', 'reference', 'acceptance_version', 'acceptance_text', 'expires_at',
  ]) assert.match(info, new RegExp(`'${key}'`, 'i'), key);
  assert.match(info, /submitted_at is null[\s\S]*used_at is null[\s\S]*cancelled_at is null/i);
  assert.match(info, /expires_at > clock_timestamp\(\)/i);
  assert.match(submit, /p_accepted is distinct from true/i);
  assert.match(submit, /smyl_valid_signature_png\(coalesce\(p_signature_png, ''\)\)/i);
  assert.match(submit, /for update/i);
  assert.match(submit, /submitted_at is null[\s\S]*used_at is null[\s\S]*cancelled_at is null/i);
  assert.match(submit, /capture_token_sha256\s*=\s*v_link\.token_hash/i);
  assert.match(submit, /'signature_sha256', v_signature_hash/i);
  assert.match(sql, /grant execute on function public\.smyl_informed_consent_signature_link_info\(text\) to anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.smyl_submit_informed_consent_signature\(text, text, boolean\) to anon, authenticated/i);
});

test('estado y cancelación son autenticados y revalidan el alcance clínico', () => {
  const status = functionSql('smyl_informed_consent_signature_link_status');
  const cancel = functionSql('smyl_cancel_informed_consent_signature_link');
  assert.match(status, /smyl_has_permission\(v_tenant, 'clinical\.write'\)/i);
  assert.match(status, /p\.user_id = auth\.uid\(\)[\s\S]*p\.active/i);
  assert.match(status, /smyl_can_access_patient\(v_tenant, l\.patient_id, 'clinical'\)/i);
  assert.match(status, /l\.created_by = auth\.uid\(\)/i);
  assert.match(status, /case when v_link\.submitted_at is not null then v_link\.signature_png else null end/i);
  assert.match(cancel, /created_by = auth\.uid\(\)/i);
  assert.match(cancel, /for update/i);
  assert.match(cancel, /delete from public\.smyl_informed_consent_signature_links where id = v_link\.id/i);
  assert.match(sql, /revoke all on function public\.smyl_informed_consent_signature_link_status\(text\) from public, anon/i);
  assert.match(sql, /revoke all on function public\.smyl_cancel_informed_consent_signature_link\(text\) from public, anon/i);
});

test('QR y firma local convergen en una finalización idempotente, presencial y auditable', () => {
  const finalize = functionSql('smyl_finalize_informed_consent_signature');
  assert.match(finalize, /\(p_signature_png is null\) = \(p_link_token is null\)/i);
  assert.match(finalize, /p_identity_verified is distinct from true/i);
  assert.match(finalize, /smyl_recent_auth_method\(600\)/i);
  assert.match(finalize, /pg_advisory_xact_lock[\s\S]*p_idempotency_key/i);
  assert.match(finalize, /where tenant_id = v_tenant and idempotency_key = p_idempotency_key/i);
  assert.match(finalize, /v_link\.document_text is distinct from p_document_text/i);
  assert.match(finalize, /v_link\.document_sha256 is distinct from v_document_hash/i);
  assert.match(finalize, /l\.submitted_at <= l\.expires_at/i);
  assert.match(finalize, /for update/i);
  assert.match(finalize, /smyl_valid_signature_png\(coalesce\(p_signature_png, ''\)\)/i);
  assert.match(finalize, /signature_capture_method, identity_verified_by, identity_verified_at/i);
  assert.match(finalize, /capture_token_sha256, capture_client_info, patient_accepted_at, signature_captured_at/i);
  assert.match(finalize, /v_capture_client_info := v_link\.client_info/i);
  assert.match(finalize, /'schema', 'smyl-consent-evidence-v1'/i);
  assert.match(finalize, /acceptance_version, acceptance_text, evidence_sha256, idempotency_key/i);
  assert.match(finalize, /'document_sha256', v_document_hash/i);
  assert.match(finalize, /'signature_sha256', v_signature_hash/i);
  assert.match(finalize, /'evidence_sha256', v_evidence_hash/i);
  assert.match(sql, /create unique index if not exists smyl_informed_consents_idempotency_idx[\s\S]*\(tenant_id, idempotency_key\)/i);
});

test('el RPC anterior es un adaptador local seguro, no una vía alterna', () => {
  const legacy = functionSql('smyl_record_informed_consent');
  assert.match(legacy, /security invoker/i);
  assert.match(legacy, /return public\.smyl_finalize_informed_consent_signature\(/i);
  assert.match(legacy, /p_signature_png,[\s\S]*null,[\s\S]*gen_random_uuid\(\),[\s\S]*true,[\s\S]*true/i);
  assert.match(sql, /revoke all on function public\.smyl_record_informed_consent\([^;]+\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.smyl_record_informed_consent\([^;]+\) to authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.smyl_record_informed_consent\([^;]+\) to anon/i);
});

test('el registro definitivo preserva retención, inmutabilidad y revocación trazable', () => {
  const immutable = functionSql('smyl_informed_consents_immutable');
  const revoke = functionSql('smyl_revoke_informed_consent');
  const get = functionSql('smyl_get_informed_consent');
  assert.doesNotMatch(immutable, /pg_trigger_depth/i);
  assert.match(immutable, /current_setting\('smyl\.retention_purge', true\)[\s\S]*<> 'nom004-5y'/i);
  assert.match(immutable, /old\.revoked_at is not null/i);
  assert.match(immutable, /new\.revoked_at is null/i);
  assert.match(immutable, /new\.revoked_by is null/i);
  assert.match(revoke, /for update/i);
  assert.match(revoke, /smyl_recent_auth_method\(600\)/i);
  assert.match(revoke, /insert into public\.smyl_audit_events/i);
  assert.match(get, /insert into public\.smyl_audit_events/i);
  for (const hidden of [
    'tenant_id', 'captured_by', 'identity_verified_by', 'capture_token_sha256',
    'capture_client_info', 'capture_link_id', 'idempotency_key',
  ]) assert.match(get, new RegExp(`- '${hidden}'`, 'i'), hidden);
  assert.match(sql, /identity_verification_method = 'legacy_in_person'[\s\S]*smyl_valid_signature_png\(signature_png\)[\s\S]*not valid/i);
});

test('los datos efímeros se purgan y el trabajo programado deja una alerta sin pg_cron', () => {
  const purge = functionSql('smyl_purge_expired_informed_consent_signature_links');
  assert.match(purge, /cancelled_at is not null[\s\S]*used_at is not null/i);
  assert.match(purge, /expires_at <= clock_timestamp\(\)/i);
  assert.match(purge, /submitted_at < clock_timestamp\(\) - interval '10 minutes'/i);
  assert.match(purge, /for update skip locked/i);
  assert.match(purge, /delete from public\.smyl_informed_consent_signature_links/i);
  assert.match(sql, /grant execute on function public\.smyl_purge_expired_informed_consent_signature_links\(integer\) to service_role/i);
  assert.match(sql, /pg_cron no está habilitado/i);
  assert.match(sql, /'smyl-purga-enlaces-consentimiento'[\s\S]*'\*\/10 \* \* \* \*'/i);
});
