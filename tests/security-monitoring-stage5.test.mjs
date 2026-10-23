import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014170000_smyl_security_monitoring.sql');
const edge=read('supabase/functions/security-monitor/index.ts');
const ui=read('smyl-security-center.js');
const css=read('smyl-security-center.css');
const app=read('app.html');
const mobile=read('mobile/www/app.html');

test('security telemetry is private, tenant scoped and contains no clinical payloads',()=>{
  for(const table of ['smyl_security_access_fingerprints','smyl_export_events','smyl_security_events']){
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql,new RegExp(`revoke all on public\\.${table} from public,anon,authenticated`));
  }
  assert.match(sql,/entity_fingerprint/);
  assert.match(sql,/digest\(p_tenant::text/);
  assert.doesNotMatch(sql,/patient_name|diagnosis|photo_url|email_address/i);
});

test('access and export anomalies are evidence signals, not intrusion claims',()=>{
  assert.match(sql,/fingerprints_24h/);
  assert.match(sql,/v_count>=4/);
  assert.match(sql,/created_at>=now\(\)-interval '15 minutes'/);
  assert.match(sql,/v_count>=20 then 'high'/);
  assert.match(sql,/no una confirmación de intrusión/);
  assert.match(sql,/status in \('open','investigating','resolved'\)/);
});

test('the private monitor derives clinic and actor from a verified session',()=>{
  assert.match(edge,/requireUser\(req,CORS\)/);
  assert.match(edge,/tenant=auth\.tenantId!,actor=auth\.user!\.id/);
  assert.match(edge,/crypto\.subtle\.digest\('SHA-256'/);
  assert.match(edge,/SERVICE}:\$\{tenant}:\$\{network}:\$\{agent}/);
  assert.doesNotMatch(edge,/body\.tenant|body\.actor/);
  assert.match(read('supabase/config.toml'),/\[functions\.security-monitor\]\s*verify_jwt = true/);
});

test('protected exports are recorded before the browser creates the file',()=>{
  assert.match(app,/await window\.SmylSecurity\.recordExport\(\{export_type:'clinical_pdf'/);
  assert.match(read('smyl-proposals.js'),/recordExport\(\{export_type:'proposal_pdf'/);
  assert.match(read('smyl-finance.js'),/recordExport\(\{export_type:'receipt_pdf'/);
  assert.match(read('smyl-reports.js'),/recordExport\(\{export_type:'executive_csv'/);
  assert.match(sql,/smyl_record_export_server/);
  assert.match(sql,/smyl_actor_has_permission_explicit/);
});

test('the security center includes alerts, investigation and a response runbook',()=>{
  assert.match(ui,/CENTRO DE SEGURIDAD/);
  assert.match(ui,/update_event/);
  assert.match(ui,/smyl:security-updated/);
  assert.match(ui,/no confirma por sí sola un incidente/i);
  assert.match(css,/@media\(max-width:620px\)/);
  assert.match(read('tests/fixtures/smyl-security-stage5-preview.html'),/Volumen inusual de exportaciones/);
  assert.match(read('docs/SMYL_SECURITY_INCIDENT_RUNBOOK.md'),/Contener[\s\S]*Verificar[\s\S]*Preservar[\s\S]*Corregir[\s\S]*Documentar/);
});

test('web, mobile and PWA ship the same stage 5 security center',()=>{
  assert.match(app,/smyl-security-center\.js\?v=1/);
  assert.match(app,/window\.SmylSecurity\.start\(sb\)/);
  assert.equal(app,mobile);
  assert.equal(ui,read('mobile/www/smyl-security-center.js'));
  assert.equal(css,read('mobile/www/smyl-security-center.css'));
  assert.equal(read('smyl-navigation.js'),read('mobile/www/smyl-navigation.js'));
  assert.match(read('sw.js'),/smyl-v261-secure-checkout/);
  assert.match(read('sw.js'),/smyl-security-center\.js\?v=1/);
});
