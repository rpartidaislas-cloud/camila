-- Reparación idempotente de compatibilidad.
-- Una migración experimental anterior pudo crear un segundo bloqueo inmutable y reemplazar
-- smyl_get_informed_consent(uuid) con una firma de datos incompatible. Se elimina únicamente
-- ese bloqueo extra y, a continuación, se reinstala el contrato canónico completo.
drop trigger if exists smyl_informed_consents_no_change on public.smyl_informed_consents;
drop function if exists public.smyl_informed_consent_immutable();

-- Consentimiento informado por procedimiento (NOM-004-SSA3-2012, 10.1 y 4.2; NOM-013-SSA2-2015).
-- Cada registro guarda el TEXTO EXACTO que el paciente leyó (procedimiento, beneficios, riesgos, alternativas),
-- su huella SHA-256 calculada aquí, la firma del paciente (o su tutor) y los datos del profesional que informó:
-- nombre, cédula y el método con que confirmó su identidad (la sesión debe haberla confirmado en los últimos
-- 10 minutos). El registro no se edita; si el paciente lo revoca, se agrega una revocación fechada.
-- La tabla no se lee directo: solo con funciones (listar, ver para imprimir, registrar, revocar).
-- Idempotente.

create table if not exists public.smyl_informed_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  template_key text not null default 'custom' check (template_key ~ '^[a-z0-9_]{1,40}$'),
  procedure_title text not null check (char_length(btrim(procedure_title)) between 3 and 160),
  document_text text not null check (char_length(document_text) between 200 and 20000),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  signer_name text not null check (char_length(btrim(signer_name)) between 2 and 150),
  signer_relation text not null default 'patient' check (signer_relation in ('patient', 'guardian')),
  signature_png text not null check (signature_png ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$' and char_length(signature_png) between 300 and 120000),
  professional_id uuid not null,
  professional_name text not null,
  professional_license text not null,
  professional_auth_method text not null,
  signed_at timestamptz not null default now(),
  captured_by uuid not null default auth.uid(),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(btrim(revoked_reason)) between 3 and 500),
  revoked_by uuid,
  foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id)
);
create index if not exists smyl_informed_consents_patient_idx on public.smyl_informed_consents (tenant_id, patient_id, signed_at desc);

alter table public.smyl_informed_consents enable row level security;
revoke all on public.smyl_informed_consents from public, anon, authenticated;

-- Solo puede cambiar, una vez, el estado de revocación. Nada más; y no se borra (retención NOM-004).
create or replace function public.smyl_informed_consents_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 and coalesce(current_setting('smyl.retention_purge', true), '') <> 'nom004-5y' then
      raise exception using errcode = '55000', message = 'Un consentimiento informado no se puede eliminar.';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - array['revoked_at', 'revoked_reason', 'revoked_by']) is distinct from (to_jsonb(old) - array['revoked_at', 'revoked_reason', 'revoked_by'])
     or old.revoked_at is not null then
    raise exception using errcode = '55000', message = 'Un consentimiento informado firmado no se modifica.';
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_informed_consents_immutable on public.smyl_informed_consents;
create trigger smyl_informed_consents_immutable before update or delete on public.smyl_informed_consents
  for each row execute function public.smyl_informed_consents_immutable();

-- Registrar: lo hace el profesional que informó al paciente (con cédula e identidad confirmada).
create or replace function public.smyl_record_informed_consent(
  p_patient_id uuid, p_template_key text, p_procedure_title text, p_document_text text,
  p_signer_name text, p_signer_relation text, p_signature_png text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_pro public.smyl_professionals;
  v_method text;
  v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar consentimientos informados.';
  end if;
  if not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id)
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  select * into v_pro from public.smyl_professionals p where p.tenant_id = v_tenant and p.user_id = auth.uid() and p.active limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'Solo un profesional registrado puede recabar un consentimiento informado.';
  end if;
  if char_length(btrim(coalesce(v_pro.license_number, ''))) < 4 then
    raise exception using errcode = '23514', message = 'Registra tu cédula profesional en Equipo antes de recabar consentimientos.';
  end if;
  v_method := public.smyl_recent_auth_method(600);
  if v_method is null then
    raise exception using errcode = '28000', message = 'Confirma tu identidad para firmar (contraseña o código de verificación).', hint = 'reauth_required';
  end if;
  if coalesce(p_signature_png, '') !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$'
     or char_length(p_signature_png) not between 300 and 120000 then
    raise exception using errcode = '22023', message = 'La firma del paciente no es válida. Vuelve a firmar.';
  end if;
  if char_length(coalesce(p_document_text, '')) not between 200 and 20000
     or char_length(btrim(coalesce(p_procedure_title, ''))) not between 3 and 160
     or char_length(btrim(coalesce(p_signer_name, ''))) not between 2 and 150
     or coalesce(p_signer_relation, '') not in ('patient', 'guardian') then
    raise exception using errcode = '22023', message = 'Faltan datos del consentimiento.';
  end if;

  insert into public.smyl_informed_consents (tenant_id, patient_id, template_key, procedure_title, document_text, document_sha256,
    signer_name, signer_relation, signature_png, professional_id, professional_name, professional_license, professional_auth_method)
  values (v_tenant, p_patient_id, coalesce(nullif(p_template_key, ''), 'custom'), btrim(p_procedure_title), p_document_text,
    encode(sha256(convert_to(p_document_text, 'UTF8')), 'hex'), btrim(p_signer_name), p_signer_relation, p_signature_png,
    v_pro.id, v_pro.display_name, btrim(v_pro.license_number), v_method)
  returning id into v_id;
  return v_id;
end;
$$;

-- Listar (sin la imagen de la firma ni el texto completo).
create or replace function public.smyl_list_informed_consents(p_patient_id uuid)
returns table (id uuid, procedure_title text, signer_name text, signer_relation text, professional_name text,
               professional_license text, signed_at timestamptz, revoked_at timestamptz, revoked_reason text, document_sha256 text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.read')
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  return query select c.id, c.procedure_title, c.signer_name, c.signer_relation, c.professional_name, c.professional_license,
                      c.signed_at, c.revoked_at, c.revoked_reason, c.document_sha256
                 from public.smyl_informed_consents c
                where c.tenant_id = v_tenant and c.patient_id = p_patient_id
                order by c.signed_at desc;
end;
$$;

-- Ver completo para imprimir o entregar copia al paciente.
create or replace function public.smyl_get_informed_consent(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_informed_consents;
begin
  select * into v_row from public.smyl_informed_consents where tenant_id = v_tenant and id = p_id;
  if not found or not public.smyl_has_permission(v_tenant, 'clinical.read')
     or not public.smyl_can_access_patient(v_tenant, v_row.patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso a este consentimiento.';
  end if;
  return to_jsonb(v_row) - 'tenant_id' - 'captured_by';
end;
$$;

-- Revocar (el paciente puede retirar su consentimiento antes del procedimiento).
create or replace function public.smyl_revoke_informed_consent(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_patient uuid;
begin
  select patient_id into v_patient from public.smyl_informed_consents where tenant_id = v_tenant and id = p_id and revoked_at is null;
  if not found or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not public.smyl_can_access_patient(v_tenant, v_patient, 'clinical') then
    raise exception using errcode = '42501', message = 'No se puede revocar este consentimiento.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'Escribe el motivo de la revocación.';
  end if;
  update public.smyl_informed_consents set revoked_at = now(), revoked_reason = btrim(p_reason), revoked_by = auth.uid()
   where tenant_id = v_tenant and id = p_id;
end;
$$;

revoke all on function public.smyl_record_informed_consent(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.smyl_list_informed_consents(uuid) from public, anon;
revoke all on function public.smyl_get_informed_consent(uuid) from public, anon;
revoke all on function public.smyl_revoke_informed_consent(uuid, text) from public, anon;
grant execute on function public.smyl_record_informed_consent(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.smyl_list_informed_consents(uuid) to authenticated;
grant execute on function public.smyl_get_informed_consent(uuid) to authenticated;
grant execute on function public.smyl_revoke_informed_consent(uuid, text) to authenticated;

-- El candado de retención también cuenta los consentimientos informados como expediente.
create or replace function public.smyl_patient_last_clinical_activity(p_tenant uuid, p_patient uuid)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select max(t) from (
    select max(greatest(created_at, updated_at)) t from public.smyl_clinical_notes where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_patient_histories where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_dental_records where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_clinical_plans where tenant_id = p_tenant and patient_id = p_patient
    union all select max(greatest(created_at, updated_at)) from public.smyl_patient_files where tenant_id = p_tenant and patient_id = p_patient
    union all select max(created_at) from public.smyl_radiograph_sources where tenant_id = p_tenant and patient_id = p_patient
    union all select max(greatest(created_at, updated_at)) from public.smyl_clinical_evidence_studies where tenant_id = p_tenant and patient_id = p_patient
    union all select max(greatest(created_at, updated_at)) from public.mila_clinical_notes where tenant_id = p_tenant and paciente_id = p_patient
    union all select max(signed_at) from public.smyl_informed_consents where tenant_id = p_tenant and patient_id = p_patient
    union all select case when exists (select 1 from public.smyl_patient_consents c where c.tenant_id = p_tenant and c.patient_id = p_patient)
                          then clock_timestamp() end
  ) actos;
$$;
revoke all on function public.smyl_patient_last_clinical_activity(uuid, uuid) from public, anon, authenticated;
