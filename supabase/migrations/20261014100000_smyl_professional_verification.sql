-- SMYL · Verificación profesional controlada por la clínica.
-- No consulta registros externos ni afirma una validación gubernamental automática.

begin;

alter table public.smyl_professional_profiles
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verification_requested_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists verification_note text;

do $$ begin
  alter table public.smyl_professional_profiles
    add constraint smyl_professional_profiles_verification_status
    check (verification_status in ('unverified','in_review','verified','rejected'));
exception when duplicate_object then null;
end $$;

create policy smyl_professional_cv_delete on storage.objects for delete to authenticated
using (
  bucket_id='smyl-professional-cv'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);

create or replace function public.smyl_request_professional_verification(
  p_professional_id uuid
)
returns public.smyl_professional_profiles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_profile public.smyl_professional_profiles;
begin
  if v_tenant is null or not public.smyl_can_edit_professional_profile(v_tenant,p_professional_id) then
    raise exception using errcode='42501', message='No tienes permiso para solicitar la verificación.';
  end if;

  select pp.* into v_profile
  from public.smyl_professional_profiles pp
  join public.smyl_professionals p
    on p.tenant_id=pp.tenant_id and p.id=pp.professional_id and p.active
  where pp.tenant_id=v_tenant and pp.professional_id=p_professional_id
    and btrim(p.license_number)<>'' and pp.cv_storage_path is not null
  for update of pp;

  if not found then
    raise exception using errcode='23514', message='Carga el CV y registra la cédula antes de solicitar revisión.';
  end if;

  update public.smyl_professional_profiles set
    verification_status='in_review', verification_requested_at=now(),
    verified_at=null, verified_by=null, verification_note=null,
    updated_by=auth.uid()
  where tenant_id=v_tenant and professional_id=p_professional_id
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.smyl_request_professional_verification(uuid) from public,anon;
grant execute on function public.smyl_request_professional_verification(uuid) to authenticated;

create or replace function public.smyl_review_professional_verification(
  p_professional_id uuid,
  p_decision text,
  p_note text default null
)
returns public.smyl_professional_profiles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_decision text := lower(btrim(coalesce(p_decision,'')));
  v_profile public.smyl_professional_profiles;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'team.manage') then
    raise exception using errcode='42501', message='Solo la administración de la clínica puede resolver verificaciones.';
  end if;
  if v_decision not in ('verified','rejected') then
    raise exception using errcode='22023', message='La decisión de verificación no es válida.';
  end if;

  if v_decision='verified' and not exists (
    select 1 from public.smyl_professional_profiles pp
    join public.smyl_professionals p
      on p.tenant_id=pp.tenant_id and p.id=pp.professional_id and p.active
    where pp.tenant_id=v_tenant and pp.professional_id=p_professional_id
      and pp.verification_status='in_review'
      and pp.cv_storage_path is not null and btrim(p.license_number)<>''
  ) then
    raise exception using errcode='23514', message='Revisa una solicitud completa antes de verificar el perfil.';
  end if;

  update public.smyl_professional_profiles set
    verification_status=v_decision,
    verified_at=case when v_decision='verified' then now() else null end,
    verified_by=case when v_decision='verified' then auth.uid() else null end,
    verification_note=nullif(left(btrim(coalesce(p_note,'')),500),''),
    updated_by=auth.uid()
  where tenant_id=v_tenant and professional_id=p_professional_id
    and verification_status='in_review'
  returning * into v_profile;

  if not found then
    raise exception using errcode='P0002', message='No hay una verificación pendiente para este profesional.';
  end if;
  return v_profile;
end;
$$;

revoke all on function public.smyl_review_professional_verification(uuid,text,text) from public,anon;
grant execute on function public.smyl_review_professional_verification(uuid,text,text) to authenticated;

create or replace function public.smyl_reset_profile_verification_on_cv()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.cv_storage_path is distinct from new.cv_storage_path then
    new.verification_status := 'unverified';
    new.verification_requested_at := null;
    new.verified_at := null;
    new.verified_by := null;
    new.verification_note := null;
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_professional_profiles_reset_verification on public.smyl_professional_profiles;
create trigger smyl_professional_profiles_reset_verification
  before update of cv_storage_path on public.smyl_professional_profiles
  for each row execute function public.smyl_reset_profile_verification_on_cv();

create or replace function public.smyl_reset_profile_verification_on_license()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.license_number is distinct from new.license_number then
    update public.smyl_professional_profiles set
      verification_status='unverified', verification_requested_at=null,
      verified_at=null, verified_by=null, verification_note=null,
      updated_by=auth.uid()
    where tenant_id=new.tenant_id and professional_id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_professionals_reset_profile_verification on public.smyl_professionals;
create trigger smyl_professionals_reset_profile_verification
  after update of license_number on public.smyl_professionals
  for each row execute function public.smyl_reset_profile_verification_on_license();

create or replace view public.smyl_professional_directory
with (security_barrier=true)
as
select
  pp.slug,pp.tenant_id,p.display_name,p.specialty,p.license_number,
  pp.headline,pp.bio,pp.years_experience,pp.languages,pp.treatment_focus,
  pp.education,pp.memberships,pp.public_phone,pp.photo_path,
  pp.accepts_new_patients,pp.published_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',b.id,'name',b.name,'city',b.city,'state',b.state,'address',b.address_line
    ) order by b.is_default desc,b.name)
    from public.smyl_professional_branches pb
    join public.smyl_branches b on b.tenant_id=pb.tenant_id and b.id=pb.branch_id
    where pb.tenant_id=pp.tenant_id and pb.professional_id=pp.professional_id and b.active
  ),'[]'::jsonb) as locations,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id,'name',s.name,'duration_minutes',s.duration_minutes
    ) order by s.name)
    from public.smyl_professional_services ps
    join public.smyl_services s on s.tenant_id=ps.tenant_id and s.id=ps.service_id
    where ps.tenant_id=pp.tenant_id and ps.professional_id=pp.professional_id and s.active
  ),'[]'::jsonb) as services,
  (pp.verification_status='verified') as verified_profile,
  case when pp.verification_status='verified' then pp.verified_at end as verified_at
from public.smyl_professional_profiles pp
join public.smyl_professionals p
  on p.tenant_id=pp.tenant_id and p.id=pp.professional_id and p.active
where pp.status='published';

revoke all on public.smyl_professional_directory from public;
grant select on public.smyl_professional_directory to anon,authenticated;

comment on column public.smyl_professional_profiles.verification_status is
  'Revisión interna de identidad profesional por la clínica; no implica consulta automática a un registro gubernamental.';

commit;
