-- SMYL · Fix: permitir guardar un perfil ya publicado sin requerir team.manage.
--
-- Problema: smyl_save_professional_profile bloqueaba CUALQUIER guardado con
-- status='published' a menos que el usuario tuviera team.manage. Esto hacía
-- que "Guardar cambios" fallara con 42501 cada vez que el perfil ya estaba
-- publicado, porque el frontend devuelve el estado actual ('published').
--
-- Corrección: team.manage solo es necesario para TRANSICIONAR un perfil a
-- 'published' (publicar por primera vez) o a 'paused' (pausar). Si el perfil
-- ya está publicado, cualquier editor con smyl_can_edit_professional_profile
-- puede volver a guardarlo como 'published' (actualizar contenido).

begin;

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
  v_current_status text;
  v_status text := lower(btrim(coalesce(p_status,'draft')));
begin
  if v_tenant is null or not public.smyl_can_edit_professional_profile(v_tenant,p_professional_id) then
    raise exception using errcode='42501', message='No tienes permiso para editar este perfil profesional.';
  end if;

  select public.smyl_has_permission(v_tenant,'team.manage') into v_can_manage;

  if v_status not in ('draft','review','published','paused') then
    raise exception using errcode='22023', message='Estado de publicación no válido.';
  end if;

  -- team.manage requerido para publicar por primera vez o para pausar.
  -- Excepción: si el perfil YA está publicado, cualquier editor puede
  -- seguir guardándolo como 'published' (solo actualiza contenido).
  if v_status in ('published','paused') and not v_can_manage then
    select status into v_current_status
    from public.smyl_professional_profiles
    where tenant_id = v_tenant and professional_id = p_professional_id;

    if v_status = 'paused' or coalesce(v_current_status,'') <> 'published' then
      raise exception using errcode='42501', message='Solo la administración de la clínica puede publicar o pausar perfiles.';
    end if;
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

commit;
