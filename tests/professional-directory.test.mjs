import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const sql=read('../supabase/migrations/20261014090000_smyl_professional_directory.sql');
const verification=read('../supabase/migrations/20261014100000_smyl_professional_verification.sql');
const publicIntake=read('../supabase/migrations/20261021170000_smyl_public_appointment_intake.sql');
const publishGuard=read('../supabase/migrations/20261021180000_smyl_professional_publication_guard.sql');
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
  assert.match(edge,/smyl_create_public_appointment_intake/);
  assert.doesNotMatch(edge,/\.from\("camila_pacientes"\)/);
  assert.doesNotMatch(edge,/smyl_appointments|smyl_create_appointment|status:\s*"confirmed"/);
  assert.match(edge,/honeypot/);
});

test('la captación anónima queda separada del expediente hasta revisión humana',()=>{
  assert.match(publicIntake,/create table public\.smyl_public_appointment_intakes/);
  assert.match(publicIntake,/patient_id, service_id, professional_id,[\s\S]*?p_request_id, p_tenant_id, null,/);
  assert.match(publicIntake,/Solicitud pública pendiente de validar contacto/);
  assert.match(publicIntake,/create or replace function public\.smyl_link_public_appointment_intake/);
  assert.match(publicIntake,/public\.smyl_has_permission\(v_tenant, 'schedule\.manage'\)/);
  assert.match(publicIntake,/public\.smyl_has_permission\(v_tenant, 'patients\.manage'\)/);
  assert.match(publicIntake,/linked_patient_id = p_patient_id/);
  assert.doesNotMatch(publicIntake,/insert into public\.camila_pacientes/);
  assert.match(publicIntake,/revoke all on public\.smyl_public_appointment_intakes from public, anon, authenticated/);
  assert.match(publicIntake,/smyl_audit_public_appointment_intake/);
  const audit=publicIntake.slice(publicIntake.indexOf('create or replace function public.smyl_audit_public_appointment_intake'),publicIntake.indexOf('create trigger smyl_public_appointment_intakes_audit'));
  assert.doesNotMatch(audit,/contact_name|patient_message|\bemail\b|\bphone\b/, 'la auditoría no debe copiar PII del prospecto');
  assert.match(publicIntake,/grant execute on function public\.smyl_create_public_appointment_intake\([\s\S]*?\) to service_role/);
  assert.doesNotMatch(publicIntake,/grant execute on function public\.smyl_create_public_appointment_intake\([\s\S]*?\) to (?:anon|authenticated)/);
});

test('la captación conserva preferencias y consentimiento sin inventar una hora de cita',()=>{
  for(const column of ['preferred_contact','requested_date','requested_period','privacy_consent','privacy_consent_at','privacy_notice_version']) {
    assert.match(publicIntake,new RegExp(`\\b${column}\\b`),`falta ${column}`);
  }
  assert.match(publicIntake,/privacy_consent boolean not null check \(privacy_consent\)/);
  assert.match(publicIntake,/privacy_notice_version ~ '\^public-appointment-v\[0-9\]\+\$'/);
  assert.match(publicIntake,/p_requested_date is not null and p_requested_date < current_date/);
  assert.match(publicIntake,/preferred_professional_id, preferred_branch_id, requested_start,[\s\S]*?p_professional_id, p_branch_id, null,/);
  for(const field of ['body.requested_date','body.requested_period','body.preferred_contact','body.privacy_consent']) {
    assert.match(edge,new RegExp(field.replace('.', '\\.')));
  }
  assert.match(edge,/p_privacy_notice_version: "public-appointment-v1"/);
  assert.doesNotMatch(edge,/body\.requested_start/);
  assert.doesNotMatch(publicIntake,/consentimiento_whatsapp/, 'la preferencia de contacto no concede consentimiento de WhatsApp');
});

test('la base impide presentar como verificadas fichas incompletas',()=>{
  assert.match(publishGuard,/create or replace function public\.smyl_guard_professional_profile_publication/);
  assert.match(publishGuard,/new\.status <> 'published'/);
  assert.match(publishGuard,/new\.verification_status <> 'verified'/);
  assert.match(publishGuard,/new\.photo_path/);
  assert.match(publishGuard,/new\.headline[\s\S]*?< 12/);
  assert.match(publishGuard,/new\.bio[\s\S]*?< 80/);
  assert.match(publishGuard,/v_specialty/);
  assert.match(publishGuard,/v_license/);
  assert.match(publishGuard,/smyl_professional_branches[\s\S]*?branch\.active/);
  assert.match(publishGuard,/smyl_professional_services[\s\S]*?service\.active/);
  assert.match(publishGuard,/smyl_professional_profiles_z_publication_guard/);
  assert.doesNotMatch(publishGuard,/update public\.smyl_professional_profiles profile\s+set status = 'review'/,
    'la transición no debe ocultar perfiles heredados antes de que la clínica pueda completarlos');
});

test('cambiar CV o cédula retira la publicación y la vista distingue la verificación',()=>{
  const cvReset=publishGuard.slice(publishGuard.indexOf('create or replace function public.smyl_reset_profile_verification_on_cv'),publishGuard.indexOf('create or replace function public.smyl_reset_profile_verification_on_license'));
  const licenseReset=publishGuard.slice(publishGuard.indexOf('create or replace function public.smyl_reset_profile_verification_on_license'),publishGuard.indexOf('create or replace function public.smyl_guard_professional_profile_publication'));
  assert.match(cvReset,/new\.status := 'review'/);
  assert.match(cvReset,/new\.published_at := null/);
  assert.match(licenseReset,/status = case when status = 'published' then 'review'/);
  assert.match(licenseReset,/published_at = case when status = 'published' then null/);
  const directory=publishGuard.slice(publishGuard.indexOf('create or replace view public.smyl_professional_directory'),publishGuard.indexOf('revoke all on public.smyl_professional_directory'));
  assert.match(directory,/profile\.status = 'published'/);
  assert.match(directory,/profile\.verification_status = 'verified'/);
  assert.match(directory,/\) as verified_profile/);
  assert.match(directory,/profile\.photo_path/);
  assert.match(directory,/exists \([\s\S]*?smyl_professional_branches/);
  assert.match(directory,/exists \([\s\S]*?smyl_professional_services/);
  const directoryFilter=directory.slice(directory.indexOf("where profile.status = 'published'"));
  assert.doesNotMatch(directoryFilter,/profile\.verification_status = 'verified'/,
    'un perfil publicado heredado permanece visible, aunque no obtenga la insignia ni el formulario');
});

test('la RPC pública exige perfil verificado que acepte pacientes nuevos',()=>{
  const intakeRpc=publishGuard.slice(publishGuard.indexOf('create or replace function public.smyl_create_public_appointment_intake'),publishGuard.indexOf('comment on function public.smyl_guard_professional_profile_publication'));
  assert.match(intakeRpc,/profile\.status = 'published'/);
  assert.match(intakeRpc,/profile\.verification_status = 'verified'/);
  assert.match(intakeRpc,/profile\.accepts_new_patients/);
  assert.match(intakeRpc,/p_tenant_id, null, p_service_id/);
  assert.doesNotMatch(intakeRpc,/insert into public\.camila_pacientes/);
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

test('el formulario profesional agrupa la identidad y ofrece una vista previa útil',()=>{
  for(const token of ['directory-builder-overview','directory-photo-picker','data-photo-preview','directory-form-section','directory-field-label','directory-preview-hero','directory-preview-stats','directory-preview-details']) assert.match(js,new RegExp(token));
  for(const field of ['display_name','specialty','license_number','slug','headline']) assert.match(js,new RegExp(`name="${field}"`));
  assert.match(js,/dataset\.single/);
  assert.match(js,/Construye un perfil que inspire confianza/);
  assert.match(css,/directory-layout\[data-single=true\]/);
  assert.match(css,/directory-photo-section/);
  assert.match(css,/directory-form-section/);
  assert.match(css,/directory-preview-hero/);
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
  for(const token of ['Perfil profesional dental','Cédula declarada','Formación y trayectoria','Solicitud de cita','La clínica confirma cada solicitud de cita']) assert.match(publicPage,new RegExp(token));
  assert.match(publicPage,/public-appointment-request/);
  assert.match(publicPage,/Enviar una solicitud no confirma la cita/);
  assert.match(publicPage,/navigator\.share/);
  assert.match(publicPage,/Documentación profesional revisada internamente/);
  assert.match(publicPage,/Cédula declarada/);
  assert.doesNotMatch(publicPage,/✓ Cédula profesional/);
});

test('directorio profesional se distribuye igual en web y PWA',()=>{
  assert.match(app,/smyl-professional-directory\.js\?v=12/);
  assert.match(app,/smyl-professional-directory\.css\?v=12/);
  assert.match(sw,/smyl-v263-lana-connection-recovery/);
  assert.match(sw,/dentista\.html/);
  assert.equal(js,read('../mobile/www/smyl-professional-directory.js'));
  assert.equal(css,read('../mobile/www/smyl-professional-directory.css'));
  assert.equal(publicPage,read('../mobile/www/dentista.html'));
});
