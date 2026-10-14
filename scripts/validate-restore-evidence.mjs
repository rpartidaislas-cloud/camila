import fs from 'node:fs';
import path from 'node:path';

const evidenceArg = process.argv.find((arg) => arg.startsWith('--evidence='));
if (!evidenceArg) { console.error('ABORTADO · Indica --evidence=ruta.json'); process.exit(1); }
const evidencePath = path.resolve(evidenceArg.slice('--evidence='.length));
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });

check('Destino desechable', evidence.target?.type === 'disposable' && evidence.target?.production === false,
  'La restauración nunca debe apuntar a producción.');
check('Base restaurada', evidence.database?.restored === true && evidence.database?.migration_count_match === true && evidence.database?.lint_clean === true,
  'Restauración, historial de migraciones y lint deben aprobar.');
check('Storage completo', Number.isInteger(evidence.storage?.expected_objects) && evidence.storage.expected_objects > 0 && evidence.storage.restored_objects === evidence.storage.expected_objects,
  'La cantidad de objetos debe coincidir.');
check('Integridad de objetos', Number.isInteger(evidence.storage?.sampled_hashes) && evidence.storage.sampled_hashes >= 10 && evidence.storage.hash_mismatches === 0,
  'Comparar al menos diez objetos o todos cuando existan menos.');
check('Frontera de Storage', evidence.storage?.cross_tenant_denied === true && evidence.storage?.expired_url_denied === true,
  'Acceso cruzado y URL expirada deben fallar.');
check('Aplicación recuperada', evidence.application?.auth === true && evidence.application?.rls === true && evidence.application?.signed_urls === true && evidence.application?.private_edge_jwt === true,
  'Autenticación, RLS, firmado y funciones privadas deben operar.');
check('Tiempos medidos', Number.isFinite(evidence.timing?.rpo_minutes) && Number.isFinite(evidence.timing?.rto_minutes) && evidence.timing.rpo_minutes >= 0 && evidence.timing.rto_minutes > 0,
  'RPO y RTO deben medirse, no estimarse.');
check('Antimalware administrado', Boolean(evidence.antimalware?.provider) && evidence.antimalware?.contract_signed === true && evidence.antimalware?.clean_file_passed === true && evidence.antimalware?.eicar_blocked === true && evidence.antimalware?.timeout_fail_closed === true,
  'Proveedor, contrato y pruebas limpia/EICAR/timeout deben aprobar.');

const report = { schema: 1, checked_at: new Date().toISOString(), decision: checks.every((item) => item.pass) ? 'PASS' : 'BLOCKED', checks };
console.log(JSON.stringify(report, null, 2));
if (report.decision !== 'PASS') process.exitCode = 1;
