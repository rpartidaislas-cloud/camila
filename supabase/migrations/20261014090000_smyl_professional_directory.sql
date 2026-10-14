-- SMYL · Directorio profesional dental y CV privado.
-- El CV nunca forma parte de la vista pública. Los pacientes solo reciben
-- campos expresamente publicados por la clínica.

begin;

create table if not exists public.smyl_professional_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  professional_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  headline text not null default '' check (char_length(headline) <= 160),
  bio text not null default '' check (char_length(bio) <= 1600),
  years_experience smallint not null default 0 check (years_experience between 0 and 80),
  languages text[] not null default '{}',
  treatment_focus text[] not null default '{}',
  education jsonb not null default '[]'::jsonb check (jsonb_typeof(education) = 'array'),
  memberships jsonb not null default '[]'::jsonb check (jsonb_typeof(memberships) = 'array'),
  public_phone text not null default '' check (char_length(public_phone) <= 40),
  photo_path text,
  cv_storage_path text,
  cv_original_name text,
  cv_uploaded_at timestamptz,
  accepts_new_patients boolean not null default true,
  status text not null default 'draft' check (status in ('draft','review','published','paused')),
  published_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, professional_id),
  foreign key (tenant_id, professional_id)
    references public.smyl_professionals(tenant_id, id) on delete cascade
);

create unique index if not exists smyl_professional_profiles_slug_idx
  on public.smyl_professional_profiles(lower(slug));

alter table public.smyl_appointment_requests
  add column if not exists professional_id uuid;

do $$ begin
  alter table public.smyl_appointment_requests
    add constraint smyl_appointment_requests_professional_fk
    foreign key (tenant_id,professional_id)
    references public.smyl_professionals(tenant_id,id) on delete restrict;
exception when duplicate_object then null;
end $$;

create or replace function public.smyl_can_edit_professional_profile(
  p_tenant_id uuid,
  p_professional_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select p_tenant_id = public.smyl_current_tenant()
    and (
      public.smyl_has_permission(p_tenant_id, 'team.manage')
      or exists (
        select 1 from public.smyl_professionals p
        where p.tenant_id = p_tenant_id
          and p.id = p_professional_id
          and p.user_id = auth.uid()
          and p.active
      )
    );
$$;

revoke all on function public.smyl_can_edit_professional_profile(uuid,uuid)
  from public, anon;
grant execute on function public.smyl_can_edit_professional_profile(uuid,uuid)
  to authenticated;

create or replace function public.smyl_save_professional_profile(
  p_professional_id uuid,
  p_display_name text,
  p_specialty text default '',
  p_license_number text default '',
  p_slug text default '',
  p_headline text default '',
  p_bio text default '',
  p_years_experience integer default 0,
  p_languages text[] default '{}',
  p_treatment_focus text[] default '{}',
  p_education jsonb default '[]'::jsonb,
  p_memberships jsonb default '[]'::jsonb,
  p_public_phone text default '',
  p_photo_path text default null,
  p_cv_storage_path text default null,
  p_cv_original_name text default null,
  p_accepts_new_patients boolean default true,
  p_status text default 'draft'
)
returns public.smyl_professional_profiles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_profile public.smyl_professional_profiles;
  v_can_manage boolean;
  v_status text := lower(btrim(coalesce(p_status,'draft')));
begin
  if v_tenant is null or not public.smyl_can_edit_professional_profile(v_tenant,p_professional_id) then
    raise exception using errcode='42501', message='No tienes permiso para editar este perfil profesional.';
  end if;

  select public.smyl_has_permission(v_tenant,'team.manage') into v_can_manage;
  if v_status not in ('draft','review','published','paused') then
    raise exception using errcode='22023', message='Estado de publicación no válido.';
  end if;
  if v_status in ('published','paused') and not v_can_manage then
    raise exception using errcode='42501', message='Solo la administración de la clínica puede publicar o pausar perfiles.';
  end if;
  if char_length(btrim(coalesce(p_display_name,''))) not between 2 and 120 then
    raise exception using errcode='22023', message='Escribe el nombre profesional.';
  end if;
  if btrim(coalesce(p_slug,'')) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(btrim(p_slug)) not between 3 and 80 then
    raise exception using errcode='22023', message='La dirección pública debe usar letras, números y guiones.';
  end if;
  if cardinality(coalesce(p_languages,'{}')) > 12 or cardinality(coalesce(p_treatment_focus,'{}')) > 20 then
    raise exception using errcode='22023', message='El perfil contiene demasiadas etiquetas.';
  end if;
  if jsonb_typeof(coalesce(p_education,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_memberships,'[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023', message='La formación y membresías deben ser listas.';
  end if;
  if v_status='published' and (
    btrim(coalesce(p_specialty,''))='' or btrim(coalesce(p_license_number,''))=''
    or char_length(btrim(coalesce(p_headline,''))) < 12
    or char_length(btrim(coalesce(p_bio,''))) < 80
    or not exists (
      select 1 from public.smyl_professional_branches pb
      join public.smyl_branches b on b.tenant_id=pb.tenant_id and b.id=pb.branch_id and b.active
      where pb.tenant_id=v_tenant and pb.professional_id=p_professional_id
    )
  ) then
    raise exception using errcode='22023', message='Completa especialidad, cédula, presentación, biografía y al menos una sede antes de publicar.';
  end if;

  update public.smyl_professionals set
    display_name=btrim(p_display_name),
    specialty=btrim(coalesce(p_specialty,'')),
    license_number=btrim(coalesce(p_license_number,''))
  where tenant_id=v_tenant and id=p_professional_id and active;
  if not found then
    raise exception using errcode='P0002', message='El profesional no existe o está inactivo.';
  end if;

  insert into public.smyl_professional_profiles (
    tenant_id,professional_id,slug,headline,bio,years_experience,languages,
    treatment_focus,education,memberships,public_phone,photo_path,
    cv_storage_path,cv_original_name,cv_uploaded_at,accepts_new_patients,
    status,published_at,updated_by
  ) values (
    v_tenant,p_professional_id,btrim(p_slug),btrim(coalesce(p_headline,'')),
    btrim(coalesce(p_bio,'')),greatest(0,least(80,coalesce(p_years_experience,0))),
    coalesce(p_languages,'{}'),coalesce(p_treatment_focus,'{}'),
    coalesce(p_education,'[]'::jsonb),coalesce(p_memberships,'[]'::jsonb),
    btrim(coalesce(p_public_phone,'')),nullif(btrim(coalesce(p_photo_path,'')),''),
    nullif(btrim(coalesce(p_cv_storage_path,'')),''),
    nullif(btrim(coalesce(p_cv_original_name,'')),''),
    case when nullif(btrim(coalesce(p_cv_storage_path,'')),'') is null then null else now() end,
    coalesce(p_accepts_new_patients,true),v_status,
    case when v_status='published' then now() else null end,auth.uid()
  )
  on conflict (tenant_id,professional_id) do update set
    slug=excluded.slug,headline=excluded.headline,bio=excluded.bio,
    years_experience=excluded.years_experience,languages=excluded.languages,
    treatment_focus=excluded.treatment_focus,education=excluded.education,
    memberships=excluded.memberships,public_phone=excluded.public_phone,
    photo_path=excluded.photo_path,cv_storage_path=excluded.cv_storage_path,
    cv_original_name=excluded.cv_original_name,
    cv_uploaded_at=case
      when public.smyl_professional_profiles.cv_storage_path is distinct from excluded.cv_storage_path
      then excluded.cv_uploaded_at else public.smyl_professional_profiles.cv_uploaded_at end,
    accepts_new_patients=excluded.accepts_new_patients,status=excluded.status,
    published_at=case when excluded.status='published'
      then coalesce(public.smyl_professional_profiles.published_at,now()) else null end,
    updated_by=auth.uid()
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke all on function public.smyl_save_professional_profile(
  uuid,text,text,text,text,text,text,integer,text[],text[],jsonb,jsonb,text,text,text,text,boolean,text
) from public,anon;
grant execute on function public.smyl_save_professional_profile(
  uuid,text,text,text,text,text,text,integer,text[],text[],jsonb,jsonb,text,text,text,text,boolean,text
) to authenticated;

alter table public.smyl_professional_profiles enable row level security;
create policy smyl_professional_profiles_read on public.smyl_professional_profiles
  for select to authenticated using (public.camila_es_miembro(tenant_id));
grant select on public.smyl_professional_profiles to authenticated;

create trigger smyl_professional_profiles_touch before update on public.smyl_professional_profiles
  for each row execute function public.smyl_touch_updated_at();
create trigger smyl_professional_profiles_audit after insert or update or delete on public.smyl_professional_profiles
  for each row execute function public.smyl_audit_row();

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
  ),'[]'::jsonb) as services
from public.smyl_professional_profiles pp
join public.smyl_professionals p
  on p.tenant_id=pp.tenant_id and p.id=pp.professional_id and p.active
where pp.status='published';

revoke all on public.smyl_professional_directory from public;
grant select on public.smyl_professional_directory to anon,authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('smyl-professional-cv','smyl-professional-cv',false,10485760,array['application/pdf'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf'];

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('smyl-professional-public','smyl-professional-public',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create policy smyl_professional_cv_read on storage.objects for select to authenticated
using (
  bucket_id='smyl-professional-cv'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);
create policy smyl_professional_cv_insert on storage.objects for insert to authenticated
with check (
  bucket_id='smyl-professional-cv'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);
create policy smyl_professional_cv_update on storage.objects for update to authenticated
using (
  bucket_id='smyl-professional-cv'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
) with check (
  bucket_id='smyl-professional-cv'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);

create policy smyl_professional_photo_insert on storage.objects for insert to authenticated
with check (
  bucket_id='smyl-professional-public'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);
create policy smyl_professional_photo_update on storage.objects for update to authenticated
using (
  bucket_id='smyl-professional-public'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
) with check (
  bucket_id='smyl-professional-public'
  and public.smyl_can_edit_professional_profile(
    ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid
  )
);

comment on table public.smyl_professional_profiles is
  'Perfil profesional dental. El CV es privado y la vista pública expone solo campos publicados.';
comment on view public.smyl_professional_directory is
  'Directorio público de profesionales publicados; excluye CV, usuarios, correo y datos clínicos.';

commit;
