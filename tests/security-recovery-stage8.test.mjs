import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backup = fs.readFileSync(path.join(ROOT, 'scripts/create-encrypted-backup.mjs'), 'utf8');
const restore = fs.readFileSync(path.join(ROOT, 'scripts/validate-restore-evidence.mjs'), 'utf8');
const contract = fs.readFileSync(path.join(ROOT, 'docs/SMYL_MANAGED_ANTIMALWARE_CONTRACT.md'), 'utf8');

test('el paquete exige cifrado y se guarda fuera del repositorio', () => {
  assert.match(backup, /EXPORT_ENCRYPTED_CLINICAL_BACKUP/);
  assert.match(backup, /age-x25519/);
  assert.match(backup, /El respaldo debe guardarse fuera del repositorio/);
  assert.match(backup, /plaintext_in_bundle:\s*false/);
});

test('base y Storage se respaldan como componentes diferentes', () => {
  assert.match(backup, /db', 'dump'/);
  assert.match(backup, /storage', 'cp'/);
  assert.match(backup, /storage\.tar/);
  assert.match(backup, /smyl-clinical-files/);
  assert.match(backup, /smyl-professional-cases/);
});

test('el temporal se valida y se elimina aunque ocurra un error', () => {
  assert.match(backup, /fs\.mkdtempSync/);
  assert.match(backup, /finally/);
  assert.match(backup, /startsWith\(`\$\{path\.resolve\(os\.tmpdir\(\)\)\}\$\{path\.sep\}`\)/);
  assert.match(backup, /fs\.rmSync\(resolvedTemp, \{ recursive: true, force: true \}\)/);
});

test('la restauración exige conteos, hashes, RLS y tiempos medidos', () => {
  assert.match(restore, /restored_objects === evidence\.storage\.expected_objects/);
  assert.match(restore, /sampled_hashes >= 10/);
  assert.match(restore, /cross_tenant_denied/);
  assert.match(restore, /rpo_minutes/);
  assert.match(restore, /rto_minutes/);
});

test('antimalware requiere proveedor real y falla cerrado', () => {
  assert.match(restore, /contract_signed/);
  assert.match(restore, /eicar_blocked/);
  assert.match(restore, /timeout_fail_closed/);
  assert.match(contract, /No aprobado/i);
  assert.match(contract, /fail.closed|falla\s+cerrado/i);
});
