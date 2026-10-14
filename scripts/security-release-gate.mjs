import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
  const relative = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(relative) : [relative];
});

export function runSecurityReleaseGate() {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  const config = read('supabase/config.toml');
  const htmlFiles = walk('.').filter((file) => !file.startsWith(`.git${path.sep}`) && file.endsWith('.html'));
  const sourceFiles = walk('.').filter((file) =>
    !file.startsWith(`.git${path.sep}`) &&
    !file.startsWith(`docs${path.sep}`) &&
    !file.startsWith(`tests${path.sep}`) &&
    !file.startsWith(`supabase${path.sep}migrations${path.sep}`) &&
    /\.(?:html|js|mjs|ts|css)$/.test(file)
  );

  const floatingBrowser = htmlFiles.filter((file) => /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2(?:["'/]|$)/.test(read(file)));
  check('Cliente Supabase del navegador fijado', floatingBrowser.length === 0,
    floatingBrowser.length ? floatingBrowser.join(', ') : 'No hay referencias flotantes @2 en HTML.');

  const literalSecretPatterns = [
    /(?:service_role|secret)["']?\s*[:=]\s*["']eyJ[a-zA-Z0-9._-]{20,}/i,
    /sk-ant-[a-zA-Z0-9_-]{20,}/,
    /sk-proj-[a-zA-Z0-9_-]{20,}/,
    /whsec_[a-zA-Z0-9]{20,}/,
  ];
  const secretHits = sourceFiles.filter((file) => literalSecretPatterns.some((pattern) => pattern.test(read(file))));
  check('Sin secretos privados literales en cliente o funciones', secretHits.length === 0,
    secretHits.length ? secretHits.join(', ') : 'Sólo se permiten lecturas desde variables de entorno.');

  const privateFunctions = ['claude','segment-teeth','secure-clinical-file','sign-segmentation-masks','file-lifecycle-maintenance','security-monitor'];
  const missingJwt = privateFunctions.filter((name) => !new RegExp(`\\[functions\\.${name.replace('-', '\\-')}\\][\\s\\S]*?verify_jwt\\s*=\\s*true`).test(config));
  check('Funciones clínicas críticas exigen JWT', missingJwt.length === 0,
    missingJwt.length ? missingJwt.join(', ') : `${privateFunctions.length} funciones privadas declaradas con verify_jwt=true.`);

  const stage3 = read('supabase/migrations/20261014150000_smyl_secure_clinical_files.sql');
  check('Archivos clínicos con cuarentena y lectura limpia',
    /status\s+(?:=|in\s*\()[^\n]*'clean'/.test(stage3) && /create policy/i.test(stage3) && /revoke all/i.test(stage3),
    'La migración exige estado limpio, políticas y revocación explícita.');

  const stage5 = read('supabase/migrations/20261014170000_smyl_security_monitoring.sql');
  check('Bitácoras de seguridad sin acceso directo del navegador',
    /smyl_export_events/.test(stage5) && /smyl_security_events/.test(stage5) && /from public,anon,authenticated/i.test(stage5),
    'Exportaciones y señales quedan reservadas al servidor.');

  const stage6 = read('supabase/migrations/20261014180000_smyl_security_validation_fixes.sql');
  check('Correcciones de lint incluidas',
    /c\.item_id/.test(stage6) && /interval '1 day'/.test(stage6) && /extensions\.digest\(convert_to/.test(stage6),
    'Inventario, reporte diario y huella de exportación tienen corrección versionada.');

  const isolationHarness = read('scripts/two-tenant-isolation.mjs');
  check('Arnés de dos clínicas protegido contra producción',
    /DISPOSABLE_TWO_TENANT_PROJECT/.test(isolationHarness) &&
      /PRODUCTION_PROJECT_REF\s*=\s*'rpxshsiwoxdbuevjjpfw'/.test(isolationHarness) &&
      /baseUrl\.includes\(PRODUCTION_PROJECT_REF\)/.test(isolationHarness),
    'Exige confirmación explícita y rechaza el proyecto productivo conocido.');

  const backupTool = read('scripts/create-encrypted-backup.mjs');
  const recoveryGate = read('scripts/validate-restore-evidence.mjs');
  check('Recuperación exige cifrado, Storage e integridad',
    /EXPORT_ENCRYPTED_CLINICAL_BACKUP/.test(backupTool) && /age-x25519/.test(backupTool) &&
      /storage', 'cp'/.test(backupTool) && /cross_tenant_denied/.test(recoveryGate) &&
      /eicar_blocked/.test(recoveryGate),
    'El paquete separa base/objetos y la restauración exige hashes, RLS y antimalware real.');

  const parity = ['app.html','dentista.html','revision-clinica.html','simulacion.html','simulacion-rapida.html'].filter((file) => {
    const mobile = path.join('mobile', 'www', file);
    return !fs.existsSync(path.join(ROOT, mobile)) || read(file) !== read(mobile);
  });
  check('Paridad web y aplicación móvil', parity.length === 0,
    parity.length ? parity.join(', ') : 'Las pantallas sensibles coinciden byte por byte.');

  return { ok: checks.every((item) => item.pass), checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runSecurityReleaseGate();
  for (const item of result.checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} · ${item.name} — ${item.detail}`);
  if (!result.ok) process.exitCode = 1;
}
