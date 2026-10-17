import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const sql=read('../supabase/migrations/20261014130000_smyl_verified_patient_reviews.sql');
const edge=read('../supabase/functions/public-patient-reviews/index.ts');
const admin=read('../smyl-professional-directory.js');
const profile=read('../dentista.html');
const patient=read('../resena.html');
const app=read('../app.html');
const sw=read('../sw.js');

test('cada invitación nace de una cita terminada y conserva sólo la huella del token',()=>{
  assert.match(sql,/create table public\.smyl_review_invitations/);
  assert.match(sql,/status='completed'/);
  assert.match(sql,/encode\(digest\(v_token,'sha256'\),'hex'\)/);
  assert.match(sql,/token_hash text not null unique/);
  assert.doesNotMatch(sql,/token_plain|raw_token/);
  assert.match(sql,/unique \(tenant_id,appointment_id\)/);
});

test('la entrega pública es atómica, de un solo uso y no confía en escrituras anónimas',()=>{
  assert.match(sql,/smyl_submit_patient_review/);
  assert.match(sql,/where token_hash=p_token_hash for update/);
  assert.match(sql,/used_at is not null or v_invite\.expires_at<=now\(\)/);
  assert.match(sql,/grant execute on function public\.smyl_submit_patient_review\(text,integer,text,text\) to service_role/);
  assert.match(sql,/revoke all on public\.smyl_review_invitations,public\.smyl_patient_reviews from public,anon,authenticated/);
  assert.match(edge,/checkLimitPorIpProspecto/);
  assert.match(edge,/smyl_submit_patient_review/);
});

test('la moderación es administrativa y el público no recibe identidad clínica',()=>{
  assert.match(sql,/Solo la administración puede moderar reseñas/);
  assert.match(sql,/status in \('review','published','rejected','hidden'\)/);
  assert.match(edge,/eq\("status", "published"\)/);
  const publicSelect=edge.match(/select\("rating,body,public_name,published_at"\)/);
  assert.ok(publicSelect);
  assert.doesNotMatch(edge,/patient_id\s*:/);
  assert.match(sql,/smyl_public_review_summary/);
});

test('panel, paciente y perfil público cubren el flujo completo',()=>{
  for(const token of ['RESEÑAS VERIFICADAS','Generar enlace privado','smyl_create_review_invitation','smyl_moderate_patient_review']) assert.match(admin,new RegExp(token));
  for(const token of ['TU EXPERIENCIA IMPORTA','¿Cómo quieres aparecer?','Paciente verificado','Este enlace ya fue utilizado']) assert.match(patient,new RegExp(token));
  assert.match(profile,/Experiencias verificadas/);
  assert.match(profile,/public-patient-reviews/);
});

test('reseñas verificadas se distribuyen igual en web y PWA',()=>{
  assert.match(app,/smyl-professional-directory\.js\?v=5/);
  assert.match(sw,/smyl-v254-visible-shell-v4/);
  assert.match(sw,/resena\.html/);
  assert.equal(admin,read('../mobile/www/smyl-professional-directory.js'));
  assert.equal(profile,read('../mobile/www/dentista.html'));
  assert.equal(patient,read('../mobile/www/resena.html'));
});
