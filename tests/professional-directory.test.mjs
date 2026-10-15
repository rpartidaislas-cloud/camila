import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const sql=read('../supabase/migrations/20261014090000_smyl_professional_directory.sql');
const verification=read('../supabase/migrations/20261014100000_smyl_professional_verification.sql');
const edge=read('../supabase/functions/public-appointment-request/index.ts');
const js=read('../smyl-professional-directory.js');
const css=read('../smyl-professional-directory.css');
const publicPage=read('../dentista.html');
const app=read('../app.html');
const sw=read('../sw.js');

test('el perfil profesional tiene borrador, revisión y publicación controlada',()=>{
  assert.match(sql,/create table if not exists public\.smyl_professional_profiles/);
  assert.match(sql,/status in \('draft','review','published','paused'\)/);
  assert.match(sql,/smyl_can_edit_professional_profile/);
  assert.match(sql,/Solo la administración de la clínica puede publicar o pausar perfiles/);
  assert.match(sql,/smyl_professional_profiles_audit/);
});

test('el CV queda privado y nunca forma parte del directorio público',()=>{
  assert.match(sql,/'smyl-professional-cv','smyl-professional-cv',false/);
  assert.match(sql,/allowed_mime_types=array\['application\/pdf'\]/);
  assert.match(sql,/smyl_professional_cv_read/);
  const view=sql.slice(sql.indexOf('create or replace view public.smyl_professional_directory'),sql.indexOf('revoke all on public.smyl_professional_directory'));
  assert.doesNotMatch(view,/cv_storage_path|cv_original_name/);
  assert.match(view,/where pp\.status='published'/);
  assert.match(sql,/grant select on public\.smyl_professional_directory to anon,authenticated/);
});

test('la ficha pública genera solicitudes pendientes, nunca citas',()=>{
  assert.match(edge,/checkLimitPorIpProspecto/);
  assert.match(edge,/smyl_professional_directory/);
  assert.match(edge,/smyl_appointment_requests/);
  assert.match(edge,/source: "patient_portal"/);
  assert.match(edge,/status: "pending"/);
  assert.doesNotMatch(edge,/smyl_appointments|smyl_create_appointment|status:\s*"confirmed"/);
  assert.match(edge,/honeypot/);
});

test('el dentista puede editar, subir CV y compartir enlace o QR',()=>{
  for(const token of ['CV para revisión','PDF privado','Publicar ficha','Copiar enlace','Compartir','Ver QR','api.qrserver.com']) assert.match(js,new RegExp(token));
  assert.match(js,/application\/pdf/);
  assert.match(js,/10\*1024\*1024/);
  assert.match(js,/smyl_save_professional_profile/);
  assert.match(css,/@media\(max-width:760px\)/);
});

test('la ficha se completa por avance y muestra una sola etapa a la vez',()=>{
  for(const token of ['profileProgress','directory-progress-card','data-progress-percent','directory-stepper','data-profile-step','data-step-panel','Siguiente →']) assert.match(js,new RegExp(token));
  assert.match(js,/state\.profileStep/);
  assert.match(js,/activateProfileStep/);
  assert.match(js,/Cada dato mejora la confianza del paciente/);
  assert.match(css,/directory-progress-ring/);
  assert.match(css,/directory-step-panel\[hidden\]\{display:none\}/);
});

test('ficha, casos y reseñas son espacios separados y la vista pública responde en vivo',()=>{
  for(const token of ['data-directory-area="profile"','data-directory-area="cases"','data-directory-area="reviews"','renderToolPreview','updateProfileLive']) assert.match(js,new RegExp(token));
  assert.match(js,/state\.area==='cases'\?casesPanel/);
  assert.match(js,/URL\.createObjectURL\(file\)/);
  assert.match(css,/directory-workspace-nav/);
  assert.match(css,/directory-guide-card/);
});

test('la verificación profesional exige revisión humana y se invalida al cambiar documentos',()=>{
  assert.match(verification,/verification_status in \('unverified','in_review','verified','rejected'\)/);
  assert.match(verification,/smyl_request_professional_verification/);
  assert.match(verification,/smyl_review_professional_verification/);
  assert.match(verification,/Solo la administración de la clínica puede resolver verificaciones/);
  assert.match(verification,/smyl_reset_profile_verification_on_cv/);
  assert.match(verification,/smyl_reset_profile_verification_on_license/);
  assert.match(verification,/no implica consulta automática a un registro gubernamental/);
  const publicVerification=verification.slice(verification.indexOf('create or replace view public.smyl_professional_directory'),verification.indexOf('revoke all on public.smyl_professional_directory'));
  assert.match(publicVerification,/verified_profile/);
  assert.doesNotMatch(publicVerification,/verification_note|verified_by|cv_storage_path/);
  assert.match(js,/Solicitar verificación/);
  assert.match(js,/Marcar verificado/);
  assert.match(js,/Nota privada/);
});

test('el paciente ve confianza y solicita una cita sin confirmación automática',()=>{
  for(const token of ['PERFIL PROFESIONAL DENTAL','Cédula declarada','Formación y trayectoria','SOLICITUD DE CITA','La clínica confirma cada solicitud de cita']) assert.match(publicPage,new RegExp(token));
  assert.match(publicPage,/public-appointment-request/);
  assert.match(publicPage,/Esto es una solicitud, no una cita confirmada/);
  assert.match(publicPage,/navigator\.share/);
  assert.match(publicPage,/Perfil y cédula revisados por la clínica/);
  assert.match(publicPage,/Cédula declarada/);
  assert.doesNotMatch(publicPage,/✓ Cédula profesional/);
});

test('directorio profesional se distribuye igual en web y PWA',()=>{
  assert.match(app,/smyl-professional-directory\.js\?v=5/);
  assert.match(sw,/smyl-v241-guided-directory/);
  assert.match(sw,/dentista\.html/);
  assert.equal(js,read('../mobile/www/smyl-professional-directory.js'));
  assert.equal(css,read('../mobile/www/smyl-professional-directory.css'));
  assert.equal(publicPage,read('../mobile/www/dentista.html'));
});
