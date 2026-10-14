-- SMYL · Casos profesionales autorizados (antes/después).
-- Las imágenes y el comprobante de autorización permanecen privados. Sólo una
-- Edge Function firma temporalmente las imágenes de casos publicados.

begin;

create table public.smyl_professional_cases (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  professional_id uuid not null,
  patient_id uuid not null,
  appointment_id uuid not null,
  title text not null default '' check (char_length(title) <= 120),
  treatment_label text not null default '' check (char_length(treatment_label) <= 120),
  summary text not null default '' check (char_length(summary) <= 600),
  before_path text,
  after_path text,
  consent_path text,
  consent_original_name text,
  consent_attested boolean not null default false,
  anonymization_attested boolean not null default false,
  consent_attested_at timestamptz,
  consent_attested_by uuid references auth.users(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','review','published','rejected','paused')),
  review_note text check (char_length(review_note) <= 500),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,appointment_id),
  foreign key (tenant_id,professional_id) references public.smyl_professionals(tenant_id,id) on delete cascade,
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete restrict,
  foreign key (tenant_id,appointment_id) references public.smyl_appointments(tenant_id,id) on delete restrict
);

create index smyl_professional_cases_profile_idx
  on public.smyl_professional_cases(tenant_id,professional_id,status,published_at desc);

alter table public.smyl_professional_cases enable row level security;
create policy smyl_professional_cases_read on public.smyl_professional_cases
  for select to authenticated using (public.camila_es_miembro(tenant_id));
revoke all on public.smyl_professional_cases from public,anon,authenticated;
grant select on public.smyl_professional_cases to authenticated;

create trigger smyl_professional_cases_touch before update on public.smyl_professional_cases
  for each row execute function public.smyl_touch_updated_at();
create trigger smyl_professional_cases_audit after insert or update or delete on public.smyl_professional_cases
  for each row execute function public.smyl_audit_row();

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'smyl-professional-cases','smyl-professional-cases',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update set
  public=false,file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];

create policy smyl_professional_cases_storage_read on storage.objects for select to authenticated
using (
  bucket_id='smyl-professional-cases'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);
create policy smyl_professional_cases_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id='smyl-professional-cases'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);
create policy smyl_professional_cases_storage_update on storage.objects for update to authenticated
using (
  bucket_id='smyl-professional-cases'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
) with check (
  bucket_id='smyl-professional-cases'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);
create policy smyl_professional_cases_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id='smyl-professional-cases'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);

create or replace function public.smyl_save_professional_case(
  p_case_id uuid,
  p_professional_id uuid,
  p_appointment_id uuid,
  p_title text,
  p_treatment_label text,
  p_summary text,
  p_before_path text,
  p_after_path text,
  p_consent_path text,
  p_consent_original_name text,
  p_consent_attested boolean,
  p_anonymization_attested boolean
)
returns public.smyl_professional_cases
language plpgsql
security definer
set search_path=pg_catalog,public,storage
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_appointment public.smyl_appointments;
  v_case public.smyl_professional_cases;
  v_prefix text;
begin
  if p_case_id is null or v_tenant is null
     or not public.smyl_can_edit_professional_profile(v_tenant,p_professional_id) then
    raise exception using errcode='42501',message='No tienes permiso para editar este caso.';
  end if;
  select * into v_appointment from public.smyl_appointments
   where tenant_id=v_tenant and id=p_appointment_id and professional_id=p_professional_id;
  if not found then
    raise exception using errcode='P0002',message='Selecciona una atención válida de este profesional.';
  end if;
  if char_length(btrim(coalesce(p_title,''))) not between 5 and 120
     or char_length(btrim(coalesce(p_treatment_label,''))) not between 2 and 120
     or char_length(btrim(coalesce(p_summary,''))) not between 20 and 600 then
    raise exception using errcode='22023',message='Completa título, tratamiento y una descripción de al menos 20 caracteres.';
  end if;
  v_prefix := v_tenant::text||'/'||p_professional_id::text||'/'||p_case_id::text||'/';
  if coalesce(p_before_path,'')<>'' and p_before_path not like v_prefix||'%' then
    raise exception using errcode='22023',message='La fotografía inicial no pertenece a este caso.';
  end if;
  if coalesce(p_after_path,'')<>'' and p_after_path not like v_prefix||'%' then
    raise exception using errcode='22023',message='La fotografía final no pertenece a este caso.';
  end if;
  if coalesce(p_consent_path,'')<>'' and p_consent_path not like v_prefix||'%' then
    raise exception using errcode='22023',message='La autorización no pertenece a este caso.';
  end if;

  insert into public.smyl_professional_cases(
    id,tenant_id,professional_id,patient_id,appointment_id,title,treatment_label,summary,
    before_path,after_path,consent_path,consent_original_name,consent_attested,
    anonymization_attested,consent_attested_at,consent_attested_by,status,created_by,updated_by
  ) values (
    p_case_id,v_tenant,p_professional_id,v_appointment.patient_id,p_appointment_id,
    btrim(p_title),btrim(p_treatment_label),btrim(p_summary),nullif(btrim(coalesce(p_before_path,'')),''),
    nullif(btrim(coalesce(p_after_path,'')),''),nullif(btrim(coalesce(p_consent_path,'')),''),
    nullif(left(btrim(coalesce(p_consent_original_name,'')),180),''),coalesce(p_consent_attested,false),
    coalesce(p_anonymization_attested,false),case when p_consent_attested then now() end,
    case when p_consent_attested then auth.uid() end,'draft',auth.uid(),auth.uid()
  ) on conflict (tenant_id,id) do update set
    appointment_id=excluded.appointment_id,patient_id=excluded.patient_id,title=excluded.title,
    treatment_label=excluded.treatment_label,summary=excluded.summary,before_path=excluded.before_path,
    after_path=excluded.after_path,consent_path=excluded.consent_path,
    consent_original_name=excluded.consent_original_name,consent_attested=excluded.consent_attested,
    anonymization_attested=excluded.anonymization_attested,
    consent_attested_at=case when excluded.consent_attested then now() end,
    consent_attested_by=case when excluded.consent_attested then auth.uid() end,
    status='draft',review_note=null,reviewed_by=null,reviewed_at=null,published_at=null,updated_by=auth.uid()
  where public.smyl_professional_cases.professional_id=p_professional_id
    and public.smyl_professional_cases.status in ('draft','rejected','paused')
  returning * into v_case;
  if not found then
    raise exception using errcode='23514',message='Un caso en revisión o publicado no puede modificarse. Paúsalo primero.';
  end if;
  return v_case;
end;
$$;

revoke all on function public.smyl_save_professional_case(uuid,uuid,uuid,text,text,text,text,text,text,text,boolean,boolean) from public,anon;
grant execute on function public.smyl_save_professional_case(uuid,uuid,uuid,text,text,text,text,text,text,text,boolean,boolean) to authenticated;

create or replace function public.smyl_submit_professional_case(p_case_id uuid)
returns public.smyl_professional_cases
language plpgsql security definer set search_path=pg_catalog,public,storage
as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_case public.smyl_professional_cases;
begin
  select * into v_case from public.smyl_professional_cases
   where tenant_id=v_tenant and id=p_case_id for update;
  if not found or not public.smyl_can_edit_professional_profile(v_tenant,v_case.professional_id) then
    raise exception using errcode='42501',message='No tienes permiso para enviar este caso.';
  end if;
  if v_case.status not in ('draft','rejected') then
    raise exception using errcode='23514',message='El caso no está disponible para enviarse.';
  end if;
  if not v_case.consent_attested or not v_case.anonymization_attested
     or v_case.before_path is null or v_case.after_path is null or v_case.consent_path is null
     or not exists(select 1 from public.smyl_appointments a where a.tenant_id=v_tenant and a.id=v_case.appointment_id and a.status='completed')
     or not exists(select 1 from storage.objects o where o.bucket_id='smyl-professional-cases' and o.name=v_case.before_path)
     or not exists(select 1 from storage.objects o where o.bucket_id='smyl-professional-cases' and o.name=v_case.after_path)
     or not exists(select 1 from storage.objects o where o.bucket_id='smyl-professional-cases' and o.name=v_case.consent_path) then
    raise exception using errcode='23514',message='Para revisión necesitas una atención terminada, ambas fotos, autorización privada y las dos confirmaciones.';
  end if;
  update public.smyl_professional_cases set status='review',review_note=null,updated_by=auth.uid()
   where tenant_id=v_tenant and id=p_case_id returning * into v_case;
  return v_case;
end;
$$;
revoke all on function public.smyl_submit_professional_case(uuid) from public,anon;
grant execute on function public.smyl_submit_professional_case(uuid) to authenticated;

create or replace function public.smyl_review_professional_case(p_case_id uuid,p_decision text,p_note text default null)
returns public.smyl_professional_cases
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_decision text:=lower(btrim(coalesce(p_decision,''))); v_case public.smyl_professional_cases;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'team.manage') then
    raise exception using errcode='42501',message='Solo la administración puede revisar casos públicos.';
  end if;
  if v_decision not in ('published','rejected','paused') then
    raise exception using errcode='22023',message='Decisión no válida.';
  end if;
  if v_decision='rejected' and char_length(btrim(coalesce(p_note,'')))<5 then
    raise exception using errcode='22023',message='Explica brevemente qué debe corregirse.';
  end if;
  update public.smyl_professional_cases set status=v_decision,
    review_note=nullif(left(btrim(coalesce(p_note,'')),500),''),reviewed_by=auth.uid(),reviewed_at=now(),
    published_at=case when v_decision='published' then coalesce(published_at,now()) end,updated_by=auth.uid()
   where tenant_id=v_tenant and id=p_case_id
     and ((v_decision in ('published','rejected') and status='review') or (v_decision='paused' and status='published'))
   returning * into v_case;
  if not found then raise exception using errcode='P0002',message='El caso no está en un estado compatible con esta decisión.'; end if;
  return v_case;
end;
$$;
revoke all on function public.smyl_review_professional_case(uuid,text,text) from public,anon;
grant execute on function public.smyl_review_professional_case(uuid,text,text) to authenticated;

comment on table public.smyl_professional_cases is
  'Casos antes/después ligados a atención terminada. Paciente, cita, autorización, rutas y notas son privados.';

commit;
