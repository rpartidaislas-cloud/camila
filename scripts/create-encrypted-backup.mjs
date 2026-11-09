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
  'smyl-professional-public', 'mila-audio',
];
const dryRun = process.argv.includes('--dry-run');
const outputArg = process.argv.find((arg) => arg.startsWith('--out='));
const recipient = String(process.env.SMYL_BACKUP_AGE_RECIPIENT || '').trim();

class BackupAbort extends Error {}
// Lanza en vez de llamar a process.exit: process.exit no ejecuta los bloques finally y dejaría
// volcados y fotos clínicas en claro en el directorio temporal.
function abort(message) { console.error(`ABORTADO · ${message}`); process.exitCode = 1; throw new BackupAbort(message); }
function exec(command, args, options = {}) {
  let executable = command;
  let commandArgs = args;
  if (process.platform === 'win32' && command === 'npx') {
    executable = process.execPath;
    commandArgs = [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'), ...args];
  }
  return spawnSync(executable, commandArgs, { cwd: ROOT, encoding: 'utf8', windowsHide: true, ...options });
}
// Cuenta qué falló (últimas líneas de lo que respondió la herramienta) sin volcar contenido clínico ni la contraseña.
function failureDetail(result) {
  const password = process.env.SUPABASE_DB_PASSWORD;
  let text = `${result.stderr || ''}\n${result.stdout || ''}`.trim().split(/\r?\n/).filter(Boolean).slice(-8).join('\n');
  if (password) text = text.split(password).join('***');
  return text.slice(-900) || (result.error ? String(result.error.message || result.error) : 'sin mensaje');
}
function run(command, args, options = {}) {
  const result = exec(command, args, options);
  if (result.status !== 0) abort(`${command} ${args.slice(0, 3).join(' ')} falló.\n${failureDetail(result)}`);
  return result.stdout || '';
}
function sha256(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(1024 * 1024);
  try {
    for (let read = fs.readSync(fd, chunk, 0, chunk.length, null); read > 0; read = fs.readSync(fd, chunk, 0, chunk.length, null)) hash.update(chunk.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

try {
  if (process.env.SMYL_BACKUP_CONFIRM !== CONFIRMATION) abort(`Define SMYL_BACKUP_CONFIRM=${CONFIRMATION}.`);
  if (!/^age1[0-9a-z]{20,}$/i.test(recipient)) abort('Falta un destinatario público age válido. Nunca uses la clave privada aquí.');
  if (!outputArg) abort('Indica una carpeta externa nueva con --out=C:\\ruta\\paquete.');
  const outputDir = path.resolve(outputArg.slice('--out='.length));
  const relativeToRepo = path.relative(ROOT, outputDir);
  if (!path.isAbsolute(outputDir) || (!relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo))) abort('El respaldo debe guardarse fuera del repositorio.');
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) abort('La carpeta de salida debe estar vacía.');

  const cliVersion = run('npx', ['supabase', '--version']).trim().split(/\r?\n/).pop();
  run('age', ['--version']);
  run('tar', ['--version']);
  // Docker lo usa la CLI de Supabase para el volcado de la base (pg_dump).
  if (exec('docker', ['version', '--format', '{{.Server.Version}}']).status !== 0) abort('Docker no responde. Abre Docker Desktop y espera a que diga «Engine running».');
  if (!dryRun && !process.env.SUPABASE_DB_PASSWORD) abort('Define la contraseña de la base de datos en SUPABASE_DB_PASSWORD (ver docs/SMYL_RESPALDOS.md). No la escribas en archivos.');

  // La CLI cambió de --linked (2.x) a --remote (3.x) para apuntar al proyecto enlazado: se detecta cuál entiende la instalada.
  const dumpHelp = exec('npx', ['supabase', 'db', 'dump', '--help']);
  const dumpHelpText = `${dumpHelp.stdout || ''}\n${dumpHelp.stderr || ''}`;
  const TARGET = /--linked\b/.test(dumpHelpText) ? '--linked' : /--remote\b/.test(dumpHelpText) ? '--remote' : '--linked';
  // Los comandos de Storage son «experimentales» en algunas versiones: si fallan sin la bandera, se reintenta con ella.
  let experimental = false;
  const storageCmd = (...rest) => ['supabase', ...(experimental ? ['--experimental'] : []), 'storage', ...rest];
  let listing = exec('npx', storageCmd('ls', TARGET, 'ss:///'));
  if (listing.status !== 0) {
    experimental = true;
    const retry = exec('npx', storageCmd('ls', TARGET, 'ss:///'));
    if (retry.status !== 0) { experimental = false; abort(`supabase storage ls falló (CLI ${cliVersion}).\n${failureDetail(retry)}`); }
    listing = retry;
  }
  // Falla cerrado si el proyecto tiene buckets que este script no cubre (p. ej. uno nuevo creado en el panel).
  const remoteBuckets = (listing.stdout || '')
    .split('\n').map((line) => line.trim().replace(/\/+$/, '')).filter((line) => /^[a-z0-9][a-z0-9_-]*$/i.test(line));
  const unlisted = remoteBuckets.filter((name) => !BUCKETS.includes(name));
  if (unlisted.length && process.env.SMYL_BACKUP_ALLOW_UNLISTED !== '1') {
    abort(`El proyecto tiene buckets sin respaldo: ${unlisted.join(', ')}. Agrégalos a BUCKETS (o define SMYL_BACKUP_ALLOW_UNLISTED=1 sabiéndolo).`);
  }
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, mode: 'dry-run', encrypted: true, source: 'linked-project', cli: cliVersion, project_flag: TARGET, storage_experimental: experimental, buckets: BUCKETS.length, remote_buckets: remoteBuckets.length, unlisted }, null, 2));
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
      ['roles.sql', ['supabase', 'db', 'dump', TARGET, '--role-only', '--file']],
      ['schema.sql', ['supabase', 'db', 'dump', TARGET, '--file']],
      ['data.sql', ['supabase', 'db', 'dump', TARGET, '--data-only', '--use-copy', '--exclude', 'storage.buckets_vectors', '--exclude', 'storage.vector_indexes', '--file']],
    ];
    for (const [name, args] of dumps) run('npx', [...args, path.join(plain, name)]);

    const storageCounts = {};
    for (const bucket of BUCKETS) {
      const destination = path.join(storageDir, bucket);
      fs.mkdirSync(destination, { recursive: true });
      run('npx', storageCmd('cp', TARGET, '--recursive', `ss:///${bucket}`, destination));
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
      schema: 1, created_at: new Date().toISOString(), source: 'supabase-linked-project', cli: cliVersion,
      encryption: 'age-x25519', plaintext_in_bundle: false, buckets: BUCKETS, artifacts, storage: storageCounts,
    };
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(JSON.stringify({ ok: true, artifacts: artifacts.length, storage_objects: Object.values(storageCounts).reduce((sum, item) => sum + item.objects, 0) }, null, 2));
  } finally {
    if (resolvedTemp.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
} catch (error) {
  if (!(error instanceof BackupAbort)) { console.error(error); process.exitCode = 1; }
}
