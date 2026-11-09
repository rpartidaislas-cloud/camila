import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupScript = path.join(root, 'scripts/create-encrypted-backup.mjs');
const verifyScript = path.join(root, 'scripts/verify-encrypted-backup.mjs');
const source = fs.readFileSync(backupScript, 'utf8');
const BUCKETS = [...source.match(/const BUCKETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const has = (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0 || spawnSync(cmd, ['--help'], { encoding: 'utf8' }).status === 0;
const canRun = process.platform !== 'win32' && has('age') && has('age-keygen') && has('tar') && has('bash');
const skip = canRun ? false : 'requiere bash, age y tar';

// Dobla la CLI de Supabase con datos inventados: ejercita el empaquetado, el cifrado y la verificación reales.
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smyl-backup-test-'));
  const bin = path.join(dir, 'bin'); const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(bin); fs.mkdirSync(tmp);
  fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/bash
[ "$1" = "supabase" ] || exit 1; shift
[ -n "$FAKE_LOG" ] && echo "$@" >> "$FAKE_LOG"
EXP=""; if [ "$1" = "--experimental" ]; then EXP=1; shift; fi
bad_flag() {
  if [ "$FAKE_CLI" = "3" ] && [[ "$*" == *"--linked"* ]]; then echo "unknown flag: --linked" >&2; exit 1; fi
  if [ "$FAKE_CLI" != "3" ] && [[ "$*" == *"--remote"* ]]; then echo "unknown flag: --remote" >&2; exit 1; fi
}
case "$1 $2" in
  "--version "*) if [ "$FAKE_CLI" = "3" ]; then echo "3.0.0"; else echo "2.110.0"; fi;;
  "storage ls") bad_flag "$@"
    if [ -n "$FAKE_STORAGE_EXPERIMENTAL" ] && [ -z "$EXP" ]; then echo "Experimental: use --experimental to enable storage" >&2; exit 1; fi
    printf '%s\\n' $FAKE_BUCKETS;;
  "db dump")
    if [[ "$*" == *"--help"* ]]; then if [ "$FAKE_CLI" = "3" ]; then echo "  --remote[=<ref>]    Target a remote database"; else echo "  --linked    Dumps from the linked project"; fi; exit 0; fi
    bad_flag "$@"
    f="\${@: -1}"
    if [[ "$*" == *"--role-only"* ]]; then echo "CREATE ROLE anon;" > "$f"
    elif [[ "$*" == *"--data-only"* ]]; then printf 'COPY public.camila_tenants (id) FROM stdin;\\n1\\n\\\\.\\nCOPY auth.users (id) FROM stdin;\\n1\\n\\\\.\\n' > "$f"
    else echo "CREATE TABLE public.camila_tenants (id uuid);" > "$f"; fi;;
  "storage cp") bad_flag "$@"
    dest="\${@: -1}"; [ -n "$FAIL_BUCKET" ] && [[ "$*" == *"$FAIL_BUCKET"* ]] && { echo "error de prueba: sin permiso (clave $SUPABASE_DB_PASSWORD)" >&2; exit 1; }
    mkdir -p "$dest"; echo "objeto uno" > "$dest/a.png"; echo "objeto dos" > "$dest/b.png";;
esac
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/bash
[ -n "$FAKE_DOCKER_DOWN" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
echo "28.0.0"
`, { mode: 0o755 });
  const key = path.join(dir, 'key.txt');
  spawnSync('age-keygen', ['-o', key], { encoding: 'utf8' });
  const recipient = fs.readFileSync(key, 'utf8').match(/age1[0-9a-z]+/)[0];
  return { dir, bin, tmp, key, recipient };
}
function runBackup(ctx, out, extraEnv = {}) {
  return spawnSync(process.execPath, [backupScript, `--out=${out}`, ...(extraEnv.args || [])], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${ctx.bin}:${process.env.PATH}`, TMPDIR: ctx.tmp, FAKE_BUCKETS: BUCKETS.join(' '),
      SMYL_BACKUP_CONFIRM: 'EXPORT_ENCRYPTED_CLINICAL_BACKUP', SMYL_BACKUP_AGE_RECIPIENT: ctx.recipient, SUPABASE_DB_PASSWORD: 'secreto123', FAKE_LOG: path.join(ctx.dir, 'cli.log'), FAKE_CLI: '', FAKE_STORAGE_EXPERIMENTAL: '', FAKE_DOCKER_DOWN: '', ...extraEnv.env }
  });
}
const verify = (ctx, bundle, key = ctx.key) => spawnSync(process.execPath, [verifyScript, `--bundle=${bundle}`, `--identity=${key}`], { encoding: 'utf8', env: { ...process.env, TMPDIR: ctx.tmp } });

test('el respaldo cubre todos los buckets creados por las migraciones', () => {
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).map((f) => fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8')).join('\n');
  const created = new Set();
  for (const block of migrations.matchAll(/insert\s+into\s+storage\.buckets\s*\([^)]*\)\s*(?:values|select)\s*([\s\S]*?)(?:on\s+conflict|;)/gi)) {
    for (const m of block[1].matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'[a-z0-9-]+'\s*,\s*(?:true|false)/gi)) created.add(m[1]);
  }
  assert.ok(created.size >= 8, `se esperaban los buckets de las migraciones, hay ${created.size}`);
  const missing = [...created].filter((bucket) => !BUCKETS.includes(bucket));
  assert.deepEqual(missing, [], `buckets sin respaldo: ${missing.join(', ')}`);
  assert.ok(BUCKETS.includes('smyl-professional-public') && BUCKETS.includes('mila-audio'));
});

test('un respaldo completo se cifra, tiene manifiesto íntegro y se verifica de punta a punta', { skip }, () => {
  const ctx = setup();
  try {
    const out = path.join(ctx.dir, 'paquete');
    const result = runBackup(ctx, out);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(out).sort(), ['data.sql.age', 'manifest.json', 'roles.sql.age', 'schema.sql.age', 'storage.tar.age']);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.buckets, BUCKETS);
    assert.equal(Object.values(manifest.storage).reduce((sum, item) => sum + item.objects, 0), BUCKETS.length * 2);
    assert.deepEqual(fs.readdirSync(ctx.tmp), [], 'sin temporales tras un respaldo correcto');
    const checked = verify(ctx, out);
    assert.equal(checked.status, 0, checked.stdout);
    assert.equal(JSON.parse(checked.stdout).decision, 'PASS');
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});

test('si el respaldo falla a mitad no quedan volcados ni fotos en claro en el temporal', { skip }, () => {
  const ctx = setup();
  try {
    const result = runBackup(ctx, path.join(ctx.dir, 'paquete'), { env: { FAIL_BUCKET: 'camila-analisis' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ABORTADO/);
    assert.deepEqual(fs.readdirSync(ctx.tmp), [], 'el bloque finally debe borrar los temporales');
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});

test('si el proyecto tiene un bucket que el script no cubre, falla cerrado', { skip }, () => {
  const ctx = setup();
  try {
    const result = runBackup(ctx, path.join(ctx.dir, 'paquete'), { env: { FAKE_BUCKETS: `${BUCKETS.join(' ')} bucket-nuevo` } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bucket-nuevo/);
    assert.equal(fs.existsSync(path.join(ctx.dir, 'paquete')), false, 'no crea el paquete');
    const allowed = runBackup(ctx, path.join(ctx.dir, 'paquete2'), { env: { FAKE_BUCKETS: `${BUCKETS.join(' ')} bucket-nuevo`, SMYL_BACKUP_ALLOW_UNLISTED: '1' } });
    assert.equal(allowed.status, 0, allowed.stderr);
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});

test('la verificación detecta un paquete alterado y una clave equivocada', { skip }, () => {
  const ctx = setup();
  try {
    const out = path.join(ctx.dir, 'paquete');
    assert.equal(runBackup(ctx, out).status, 0);
    const other = path.join(ctx.dir, 'otra.txt');
    spawnSync('age-keygen', ['-o', other], { encoding: 'utf8' });
    const wrongKey = verify(ctx, out, other);
    assert.equal(wrongKey.status, 1);
    assert.match(wrongKey.stdout, /No se pudo descifrar/);
    const file = path.join(out, 'data.sql.age');
    const bytes = fs.readFileSync(file); bytes[bytes.length - 5] ^= 0xff; fs.writeFileSync(file, bytes);
    const tampered = verify(ctx, out);
    assert.equal(tampered.status, 1);
    assert.match(tampered.stdout, /hash no coincide/);
    assert.deepEqual(fs.readdirSync(ctx.tmp), [], 'la verificación también limpia sus temporales');
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});

test('la verificación avisa si faltan las cuentas de acceso (auth.users)', { skip }, () => {
  const ctx = setup();
  try {
    const fake = fs.readFileSync(path.join(ctx.bin, 'npx'), 'utf8').replace('COPY auth.users', 'COPY otra.tabla');
    fs.writeFileSync(path.join(ctx.bin, 'npx'), fake, { mode: 0o755 });
    const out = path.join(ctx.dir, 'paquete');
    assert.equal(runBackup(ctx, out).status, 0);
    const checked = verify(ctx, out);
    assert.equal(checked.status, 1);
    assert.match(checked.stdout, /auth\.users/);
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});

test('se adapta a la CLI 3.x, que usa --remote en lugar de --linked', { skip }, () => {
  const ctx = setup();
  try {
    const out = path.join(ctx.dir, 'paquete');
    const result = runBackup(ctx, out, { env: { FAKE_CLI: '3' } });
    assert.equal(result.status, 0, result.stderr);
    const log = fs.readFileSync(path.join(ctx.dir, 'cli.log'), 'utf8');
    assert.match(log, /db dump --remote --role-only/);
    assert.doesNotMatch(log, /storage (?:ls|cp) --linked/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).cli, '3.0.0');
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});

test('con la CLI 2.x usa --linked y, si Storage exige --experimental, reintenta con esa bandera', { skip }, () => {
  const ctx = setup();
  try {
    const dry = runBackup(ctx, path.join(ctx.dir, 'seco'), { args: ['--dry-run'], env: { FAKE_STORAGE_EXPERIMENTAL: '1' } });
    assert.equal(dry.status, 0, dry.stderr);
    const info = JSON.parse(dry.stdout);
    assert.equal(info.project_flag, '--linked');
    assert.equal(info.storage_experimental, true);
    assert.equal(info.cli, '2.110.0');
    const real = runBackup(ctx, path.join(ctx.dir, 'paquete'), { env: { FAKE_STORAGE_EXPERIMENTAL: '1' } });
    assert.equal(real.status, 0, real.stderr);
    assert.match(fs.readFileSync(path.join(ctx.dir, 'cli.log'), 'utf8'), /--experimental storage cp --linked/);
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});

test('sin Docker abortar con un mensaje claro; sin contraseña sólo el respaldo real aborta, no la prueba previa', { skip }, () => {
  const ctx = setup();
  try {
    const noDocker = runBackup(ctx, path.join(ctx.dir, 'a'), { args: ['--dry-run'], env: { FAKE_DOCKER_DOWN: '1' } });
    assert.equal(noDocker.status, 1);
    assert.match(noDocker.stderr, /Docker no responde[\s\S]*Engine running/);
    const dry = runBackup(ctx, path.join(ctx.dir, 'b'), { args: ['--dry-run'], env: { SUPABASE_DB_PASSWORD: '' } });
    assert.equal(dry.status, 0, dry.stderr);
    const real = runBackup(ctx, path.join(ctx.dir, 'c'), { env: { SUPABASE_DB_PASSWORD: '' } });
    assert.equal(real.status, 1);
    assert.match(real.stderr, /SUPABASE_DB_PASSWORD/);
    assert.equal(fs.existsSync(path.join(ctx.dir, 'c')), false, 'no crea el paquete');
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});

test('cuando la CLI falla se muestra el motivo, sin la contraseña', { skip }, () => {
  const ctx = setup();
  try {
    const result = runBackup(ctx, path.join(ctx.dir, 'paquete'), { env: { FAIL_BUCKET: 'camila-analisis' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /error de prueba: sin permiso/);
    assert.doesNotMatch(result.stderr, /secreto123/, 'la contraseña nunca se imprime');
    assert.match(result.stderr, /\*\*\*/);
    assert.deepEqual(fs.readdirSync(ctx.tmp), []);
  } finally { fs.rmSync(ctx.dir, { recursive: true, force: true }); }
});
