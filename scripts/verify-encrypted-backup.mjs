// Verifica un paquete creado por create-encrypted-backup.mjs SIN restaurarlo: manifiesto, hashes,
// descifrado real con la clave privada y contenido mínimo esperado. No imprime datos clínicos.
//
//   node scripts/verify-encrypted-backup.mjs --bundle=D:\smyl-backups\2026-11-08 --identity=D:\llaves\smyl-age.txt [--max-age-days=2]
//
// Úsalo justo después de cada respaldo, en la estación donde está la clave privada (disco cifrado).
// Esto prueba que el paquete es legible; el simulacro de restauración sigue siendo necesario (docs/SMYL_RESPALDOS.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const arg = (name) => (process.argv.find((item) => item.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const bundle = arg('bundle');
const identity = arg('identity');
const maxAgeDays = Number(arg('max-age-days') || 2);

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });

function sha256(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(1024 * 1024);
  try {
    for (let read = fs.readSync(fd, chunk, 0, chunk.length, null); read > 0; read = fs.readSync(fd, chunk, 0, chunk.length, null)) hash.update(chunk.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function finish() {
  const report = { schema: 1, checked_at: new Date().toISOString(), decision: checks.every((item) => item.pass) ? 'PASS' : 'FAIL', checks };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.decision === 'PASS' ? 0 : 1;
}
// Cuenta líneas con un patrón sin cargar el archivo en memoria.
function fileContains(file, pattern) {
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(4 * 1024 * 1024);
  let tail = '';
  try {
    for (let read = fs.readSync(fd, chunk, 0, chunk.length, null); read > 0; read = fs.readSync(fd, chunk, 0, chunk.length, null)) {
      const text = tail + chunk.toString('utf8', 0, read);
      if (pattern.test(text)) return true;
      tail = text.slice(-256);
    }
  } finally { fs.closeSync(fd); }
  return false;
}

if (!bundle || !identity) { console.error('ABORTADO · Indica --bundle=carpeta y --identity=archivo de clave privada age.'); process.exit(1); }
const bundleDir = path.resolve(bundle);
const identityFile = path.resolve(identity);
if (!fs.existsSync(path.join(bundleDir, 'manifest.json'))) { console.error('ABORTADO · No hay manifest.json en el paquete.'); process.exit(1); }
if (!fs.existsSync(identityFile)) { console.error('ABORTADO · No existe el archivo de clave privada.'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smyl-verify-'));
try {
  const created = Date.parse(manifest.created_at);
  const ageDays = (Date.now() - created) / 86400000;
  check('Manifiesto válido y sin texto en claro', manifest.schema === 1 && manifest.plaintext_in_bundle === false && Array.isArray(manifest.artifacts) && manifest.artifacts.length === 4,
    'Esquema 1, cuatro artefactos y plaintext_in_bundle=false.');
  check('Paquete reciente', Number.isFinite(created) && ageDays >= 0 && ageDays <= maxAgeDays, `Antigüedad ${Number.isFinite(ageDays) ? ageDays.toFixed(1) : '?'} días (máximo ${maxAgeDays}).`);
  const leftovers = fs.readdirSync(bundleDir).filter((name) => name !== 'manifest.json' && !name.endsWith('.age'));
  check('La carpeta sólo contiene archivos cifrados', leftovers.length === 0, leftovers.length ? `Archivos sin cifrar: ${leftovers.join(', ')}` : 'Sólo .age y manifest.json.');

  const decrypted = {};
  for (const artifact of manifest.artifacts || []) {
    const file = path.join(bundleDir, artifact.name);
    const exists = fs.existsSync(file);
    const sizeOk = exists && fs.statSync(file).size === artifact.bytes && artifact.bytes > 0;
    const hashOk = exists && sha256(file) === artifact.sha256;
    check(`Integridad de ${artifact.name}`, exists && sizeOk && hashOk, exists ? (hashOk ? 'Tamaño y SHA-256 coinciden con el manifiesto.' : 'El hash no coincide: archivo alterado o dañado.') : 'No existe.');
    if (!hashOk) continue;
    const target = path.join(tempRoot, artifact.name.replace(/\.age$/, ''));
    const result = spawnSync('age', ['--decrypt', '-i', identityFile, '-o', target, file], { encoding: 'utf8' });
    check(`Descifrado de ${artifact.name}`, result.status === 0 && fs.existsSync(target) && fs.statSync(target).size > 0, result.status === 0 ? 'Se descifra con la clave privada y no está vacío.' : 'No se pudo descifrar: clave equivocada o archivo dañado.');
    if (result.status === 0) decrypted[artifact.name.replace(/\.age$/, '')] = target;
  }

  if (decrypted['schema.sql']) {
    check('Esquema con tablas de la aplicación', fileContains(decrypted['schema.sql'], /CREATE TABLE[^;]*camila_tenants/i), 'schema.sql define camila_tenants.');
  }
  if (decrypted['data.sql']) {
    check('Datos de la aplicación incluidos', fileContains(decrypted['data.sql'], /COPY public\.camila_tenants|INSERT INTO "?public"?\.camila_tenants/i), 'data.sql trae filas de camila_tenants.');
    check('Cuentas de acceso (auth.users) incluidas', fileContains(decrypted['data.sql'], /COPY auth\.users|INSERT INTO "?auth"?\.users/i), 'Sin auth.users no se podría iniciar sesión tras restaurar.');
  }
  if (decrypted['roles.sql']) check('Roles incluidos', fileContains(decrypted['roles.sql'], /CREATE ROLE|ALTER ROLE/i), 'roles.sql define roles.');

  if (decrypted['storage.tar']) {
    const listing = spawnSync('tar', ['-tf', decrypted['storage.tar']], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    const entries = listing.status === 0 ? listing.stdout.split('\n').map((line) => line.replace(/^\.\//, '')).filter(Boolean) : [];
    const files = entries.filter((entry) => !entry.endsWith('/'));
    const expected = Object.values(manifest.storage || {}).reduce((sum, item) => sum + item.objects, 0);
    check('Storage: cantidad de objetos igual al manifiesto', listing.status === 0 && files.length === expected, `El tar trae ${files.length} objetos; el manifiesto declara ${expected}.`);
    const missing = Object.keys(manifest.storage || {}).filter((bucket) => manifest.storage[bucket].objects !== files.filter((entry) => entry.startsWith(`${bucket}/`)).length);
    check('Storage: cada bucket coincide', missing.length === 0, missing.length ? `Difieren: ${missing.join(', ')}` : `${Object.keys(manifest.storage || {}).length} buckets coinciden uno a uno.`);
    check('Storage: incluye todos los buckets declarados', Array.isArray(manifest.buckets) && manifest.buckets.every((bucket) => bucket in (manifest.storage || {})), 'Cada bucket de la lista figura en el manifiesto.');
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
finish();
