import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const sql=read('../supabase/migrations/20261014110000_smyl_professional_cases.sql');
const assetLock=read('../supabase/migrations/20261014120000_smyl_professional_case_asset_lock.sql');
const edge=read('../supabase/functions/public-professional-cases/index.ts');
const js=read('../smyl-professional-directory.js');
const css=read('../smyl-professional-directory.css');
const profile=read('../dentista.html');
const app=read('../app.html');
const sw=read('../sw.js');

test('los casos están ligados a una atención y conservan los datos clínicos privados',()=>{
  assert.match(sql,/create table public\.smyl_professional_cases/);
  assert.match(sql,/foreign key \(tenant_id,appointment_id\) references public\.smyl_appointments/);
  assert.match(sql,/foreign key \(tenant_id,patient_id\) references public\.camila_pacientes/);
  assert.match(sql,/status in \('draft','review','published','rejected','paused'\)/);
  assert.match(sql,/smyl_professional_cases_audit/);
  assert.match(sql,/revoke all on public\.smyl_professional_cases from public,anon,authenticated/);
  assert.match(assetLock,/smyl_can_mutate_professional_case_asset/);
  assert.match(assetLock,/status in \('review','published'\)/);
  assert.match(assetLock,/smyl_professional_cases_storage_(insert|update|delete)/);
});

test('la revisión exige atención terminada, fotos, consentimiento y anonimización',()=>{
  assert.match(sql,/smyl_submit_professional_case/);
  assert.match(sql,/a\.status='completed'/);
  assert.match(sql,/not v_case\.consent_attested or not v_case\.anonymization_attested/);
  assert.match(sql,/v_case\.before_path is null or v_case\.after_path is null or v_case\.consent_path is null/);
  assert.match(sql,/Solo la administración puede revisar casos públicos/);
});

test('las imágenes permanecen privadas y el público recibe enlaces temporales seguros',()=>{
  assert.match(sql,/'smyl-professional-cases','smyl-professional-cases',false/);
  assert.match(edge,/eq\("status", "published"\)/);
  assert.match(edge,/createSignedUrls\(\[item\.before_path, item\.after_path\], 600\)/);
  assert.doesNotMatch(edge,/patient_id|appointment_id|consent_path|review_note/);
  assert.match(edge,/limit\(12\)/);
});

test('el panel permite preparar, revisar, publicar y pausar casos autorizados',()=>{
  for(const token of ['CASOS AUTORIZADOS','Autorización firmada','Confirmo que el paciente autorizó','smyl_save_professional_case','smyl_submit_professional_case','smyl_review_professional_case']) assert.match(js,new RegExp(token));
  assert.match(js,/smyl-professional-cases/);
  assert.match(css,/directory-case-compare/);
});

test('la ficha pública explica límites clínicos y carga sólo casos aprobados',()=>{
  assert.match(profile,/Casos compartidos con autorización/);
  assert.match(profile,/no predicen ni garantizan un resultado/);
  assert.match(profile,/public-professional-cases/);
  assert.match(profile,/loading="lazy"/);
});

test('la etapa se distribuye igual en web y PWA',()=>{
  assert.match(app,/smyl-professional-directory\.js\?v=11/);
  assert.match(sw,/smyl-v263-lana-connection-recovery/);
  assert.equal(js,read('../mobile/www/smyl-professional-directory.js'));
  assert.equal(css,read('../mobile/www/smyl-professional-directory.css'));
  assert.equal(profile,read('../mobile/www/dentista.html'));
});
