import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIRMATION = 'EXPORT_ENCRYPTED_CLINICAL_BACKUP';
const BUCKETS = [
  'camila-fotos', 'camila-masks', 'camila-analisis',
  'smyl-case-photos', 'smyl-radiographs', 'smyl-clinical-files',
  'smyl-proposal-photos', 'smyl-professional-cv', 'smyl-professional-cases',
];
const dryRun = process.argv.includes('--dry-run');
const outputArg = process.argv.find((arg) => arg.startsWith('--out='));
const recipient = String(process.env.SMYL_BACKUP_AGE_RECIPIENT || '').trim();

function abort(message) { console.error(`ABORTADO · ${message}`); process.exit(1); }
function run(command, args, options = {}) {
  let executable = command;
  let commandArgs = args;
  if (process.platform === 'win32' && command === 'npx') {
    executable = process.execPath;
    commandArgs = [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'), ...args];
  }
  const result = spawnSync(executable, commandArgs, { cwd: ROOT, encoding: 'utf8', windowsHide: true, ...options });
  if (result.status !== 0) abort(`${command} falló sin crear un paquete válido.`);
  return result.stdout || '';
}
function sha256(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

if (process.env.SMYL_BACKUP_CONFIRM !== CONFIRMATION) abort(`Define SMYL_BACKUP_CONFIRM=${CONFIRMATION}.`);
if (!/^age1[0-9a-z]{20,}$/i.test(recipient)) abort('Falta un destinatario público age válido. Nunca uses la clave privada aquí.');
if (!outputArg) abort('Indica una carpeta externa nueva con --out=C:\\ruta\\paquete.');
const outputDir = path.resolve(outputArg.slice('--out='.length));
const relativeToRepo = path.relative(ROOT, outputDir);
if (!path.isAbsolute(outputDir) || (!relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo))) abort('El respaldo debe guardarse fuera del repositorio.');
if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) abort('La carpeta de salida debe estar vacía.');

run('npx', ['supabase', '--version']);
run('age', ['--version']);
run('tar', ['--version']);
if (dryRun) {
  console.log(JSON.stringify({ ok: true, mode: 'dry-run', encrypted: true, source: 'linked-project', buckets: BUCKETS.length }, null, 2));
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smyl-backup-'));
const resolvedTemp = path.resolve(tempRoot);
if (path.dirname(resolvedTemp) !== path.resolve(os.tmpdir())) abort('No fue posible validar el directorio temporal.');

try {
  const plain = path.join(tempRoot, 'plain');
  const storageDir = path.join(plain, 'storage');
  fs.mkdirSync(storageDir, { recursive: true });
  const dumps = [
    ['roles.sql', ['supabase', 'db', 'dump', '--linked', '--role-only', '--file']],
    ['schema.sql', ['supabase', 'db', 'dump', '--linked', '--file']],
    ['data.sql', ['supabase', 'db', 'dump', '--linked', '--data-only', '--use-copy', '--exclude', 'storage.buckets_vectors', '--exclude', 'storage.vector_indexes', '--file']],
  ];
  for (const [name, args] of dumps) run('npx', [...args, path.join(plain, name)]);

  const storageCounts = {};
  for (const bucket of BUCKETS) {
    const destination = path.join(storageDir, bucket);
    fs.mkdirSync(destination, { recursive: true });
    run('npx', ['supabase', 'storage', 'cp', '--linked', '--recursive', `ss:///${bucket}`, destination]);
    const files = listFiles(destination);
    storageCounts[bucket] = { objects: files.length, bytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0) };
  }

  const archive = path.join(plain, 'storage.tar');
  run('tar', ['-cf', archive, '-C', storageDir, '.']);
  const sources = ['roles.sql', 'schema.sql', 'data.sql', 'storage.tar'];
  const artifacts = [];
  for (const name of sources) {
    const source = path.join(plain, name);
    const encryptedName = `${name}.age`;
    const encrypted = path.join(outputDir, encryptedName);
    run('age', ['--recipient', recipient, '--output', encrypted, source]);
    artifacts.push({ name: encryptedName, bytes: fs.statSync(encrypted).size, sha256: sha256(encrypted) });
  }
  const manifest = {
    schema: 1, created_at: new Date().toISOString(), source: 'supabase-linked-project',
    encryption: 'age-x25519', plaintext_in_bundle: false, artifacts, storage: storageCounts,
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ ok: true, artifacts: artifacts.length, storage_objects: Object.values(storageCounts).reduce((sum, item) => sum + item.objects, 0) }, null, 2));
} finally {
  if (resolvedTemp.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) fs.rmSync(resolvedTemp, { recursive: true, force: true });
}
