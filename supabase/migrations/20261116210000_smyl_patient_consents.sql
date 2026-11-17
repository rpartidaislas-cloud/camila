-- Aviso de privacidad firmado en pantalla (Consultorio, etapa 4b).
-- Cada firma guarda el TEXTO EXACTO que la persona leyó (con su huella SHA-256 calculada aquí, no por el navegador), su versión,
-- si era el texto modelo provisional, quién firmó (paciente o tutor), la imagen de la firma y quién la capturó.
-- El registro no se edita. La tabla no se lee directamente: solo por tres funciones (registrar, estado sin firma, y ver la firma,
-- esta última solo con clinical.read). La auditoría registra el hecho de firmar, no copia la imagen (como la de radiografías).

create table if not exists public.smyl_patient_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  kind text not null default 'privacy_notice' check (kind in ('privacy_notice')),
  notice_version text not null check (char_length(btrim(notice_version)) between 1 and 80),
  notice_text text not null check (char_length(notice_text) between 50 and 8000),
  notice_sha256 text not null check (notice_sha256 ~ '^[a-f0-9]{64}$'),
  provisional boolean not null default false,
  signer_name text not null check (char_length(btrim(signer_name)) between 1 and 150),
  signer_relation text not null default 'patient' check (signer_relation in ('patient', 'guardian')),
  signature_png text not null check (signature_png ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$' and char_length(signature_png) between 300 and 120000),
  method text not null default 'on_screen' check (method in ('on_screen')),
  signed_at timestamptz not null default now(),
  captured_by uuid default auth.uid(),
  foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id) on delete cascade
);
create unique index if not exists smyl_patient_consents_once_idx on public.smyl_patient_consents (patient_id, kind, notice_sha256);
create index if not exists smyl_patient_consents_patient_idx on public.smyl_patient_consents (tenant_id, patient_id, signed_at desc);

alter table public.smyl_patient_consents enable row level security;
revoke all on public.smyl_patient_consents from public, anon, authenticated;

-- Un consentimiento firmado no se modifica: si cambia el aviso, se firma otra vez.
create or replace function public.smyl_patient_consents_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception using errcode = '55000', message = 'Un consentimiento firmado no se puede modificar.';
end;
$$;
drop trigger if exists smyl_patient_consents_no_update on public.smyl_patient_consents;
create trigger smyl_patient_consents_no_update before update on public.smyl_patient_consents
  for each row execute function public.smyl_patient_consents_immutable();

-- Registrar la firma. Quien puede gestionar pacientes o escribir datos clínicos. Firmar de nuevo el mismo texto no duplica.
create or replace function public.smyl_record_patient_consent(
  p_patient_id uuid, p_notice_version text, p_notice_text text, p_provisional boolean,
  p_signer_name text, p_signer_relation text, p_signature_png text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_name text := btrim(coalesce(p_signer_name, ''));
  v_hash text;
  v_id uuid;
begin
  if v_tenant is null
     or not (public.smyl_has_permission(v_tenant, 'patients.manage') or public.smyl_has_permission(v_tenant, 'clinical.write')) then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar firmas.';
  end if;
  if not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id) then
    raise exception using errcode = 'P0002', message = 'El paciente no existe.';
  end if;
  if not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
    raise exception using errcode = '42501', message = 'No tienes permiso para este paciente.';
  end if;
  if char_length(btrim(coalesce(p_notice_version, ''))) not between 1 and 80
     or char_length(coalesce(p_notice_text, '')) not between 50 and 8000
     or char_length(v_name) not between 1 and 150
     or coalesce(p_signer_relation, '') not in ('patient', 'guardian')
     or p_provisional is null then
    raise exception using errcode = '22023', message = 'Los datos de la firma no son válidos.';
  end if;
  if coalesce(p_signature_png, '') !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$'
     or char_length(p_signature_png) not between 300 and 120000 then
    raise exception using errcode = '22023', message = 'La firma no es válida. Vuelve a firmar.';
  end if;

  v_hash := encode(sha256(convert_to(p_notice_text, 'utf8')), 'hex');
  insert into public.smyl_patient_consents (tenant_id, patient_id, notice_version, notice_text, notice_sha256, provisional, signer_name, signer_relation, signature_png)
  values (v_tenant, p_patient_id, btrim(p_notice_version), p_notice_text, v_hash, p_provisional, v_name, p_signer_relation, p_signature_png)
  on conflict (patient_id, kind, notice_sha256) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.smyl_patient_consents where patient_id = p_patient_id and kind = 'privacy_notice' and notice_sha256 = v_hash;
    return v_id;
  end if;

  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values (v_tenant, auth.uid(), 'insert', 'smyl_patient_consents', v_id::text,
    jsonb_build_object('patient_id', p_patient_id, 'notice_version', btrim(p_notice_version), 'notice_sha256', v_hash, 'provisional', p_provisional, 'signer_relation', p_signer_relation));
  return v_id;
end;
$$;

-- Estado de la firma, sin la imagen ni el texto: para saber si falta y mostrar quién y cuándo firmó.
create or replace function public.smyl_patient_consent_status(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_patient_consents;
begin
  if v_tenant is null
     or not (public.smyl_has_permission(v_tenant, 'patients.read') or public.smyl_has_permission(v_tenant, 'patients.manage') or public.smyl_has_permission(v_tenant, 'clinical.read')) then
    raise exception using errcode = '42501', message = 'No tienes permiso para ver esto.';
  end if;
  if not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
    raise exception using errcode = '42501', message = 'No tienes permiso para este paciente.';
  end if;
  select * into v_row from public.smyl_patient_consents
   where tenant_id = v_tenant and patient_id = p_patient_id and kind = 'privacy_notice'
   order by signed_at desc limit 1;
  if not found then return jsonb_build_object('signed', false); end if;
  return jsonb_build_object('signed', true, 'id', v_row.id, 'signed_at', v_row.signed_at, 'notice_version', v_row.notice_version,
    'provisional', v_row.provisional, 'signer_name', v_row.signer_name, 'signer_relation', v_row.signer_relation);
end;
$$;

-- Ver la firma y el texto firmado: solo con acceso clínico.
create or replace function public.smyl_get_patient_consent(p_consent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_patient_consents;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.read') then
    raise exception using errcode = '42501', message = 'No tienes permiso para ver firmas.';
  end if;
  select * into v_row from public.smyl_patient_consents where id = p_consent_id and tenant_id = v_tenant;
  if not found or not public.smyl_can_access_patient(v_tenant, v_row.patient_id, 'clinical') then
    raise exception using errcode = 'P0002', message = 'No se encontró la firma.';
  end if;
  return jsonb_build_object('id', v_row.id, 'signed_at', v_row.signed_at, 'notice_version', v_row.notice_version, 'provisional', v_row.provisional,
    'notice_text', v_row.notice_text, 'notice_sha256', v_row.notice_sha256, 'signer_name', v_row.signer_name,
    'signer_relation', v_row.signer_relation, 'signature_png', v_row.signature_png);
end;
$$;

revoke all on function public.smyl_patient_consents_immutable() from public, anon, authenticated;
revoke all on function public.smyl_record_patient_consent(uuid, text, text, boolean, text, text, text) from public, anon;
revoke all on function public.smyl_patient_consent_status(uuid) from public, anon;
revoke all on function public.smyl_get_patient_consent(uuid) from public, anon;
grant execute on function public.smyl_record_patient_consent(uuid, text, text, boolean, text, text, text) to authenticated;
grant execute on function public.smyl_patient_consent_status(uuid) to authenticated;
grant execute on function public.smyl_get_patient_consent(uuid) to authenticated;
