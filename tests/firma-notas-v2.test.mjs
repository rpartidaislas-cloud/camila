import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('la firma exige profesional con cédula, identidad reciente y deja huella del contenido', () => {
  const sql = read('supabase/migrations/20261126110000_smyl_clinical_note_signature_v2.sql');
  assert.match(sql, /Solo un profesional registrado en la clínica puede firmar/);
  assert.match(sql, /char_length\(btrim\(coalesce\(v_pro\.license_number, ''\)\)\) < 4/);
  assert.match(sql, /auth\.jwt\(\)->'amr'/);
  assert.match(sql, /v_method := public\.smyl_recent_auth_method\(600\)/);
  assert.match(sql, /Solo el profesional responsable de esta nota puede firmarla/);
  assert.match(sql, /signed_hash = encode\(sha256\(convert_to\(v_row\.document::text, 'UTF8'\)\), 'hex'\)/);
  assert.match(sql, /before update or delete on public\.smyl_clinical_notes/);
});

test('la pantalla confirma identidad antes de firmar y muestra quién firmó con su cédula', () => {
  const p360 = read('smyl-patient-360.js');
  assert.match(p360, /SmylAuthGuard\.reauthenticate\(window\.sb,'firmar la nota clínica'\)/);
  assert.match(p360, /' · Firmó '\+esc\(row\.signed_name\)/);
  assert.match(read('smyl-auth-guard.js'), /async function reauthenticate\(sb, purpose\)/);
});
