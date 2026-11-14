-- SMYL · Categorías clínicas configurables para el archivo de evidencia.
-- La modalidad técnica del archivo permanece en smyl_clinical_evidence_studies.
-- Las categorías sólo organizan el uso clínico y conservan su historial.

create table public.smyl_evidence_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  template_key text,
  name text not null,
  normalized_name text not null,
  sort_order integer not null default 100 check (sort_order between 0 and 10000),
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null default auth.uid(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null default auth.uid(),
  check (char_length(btrim(name)) between 2 and 48),
  check (normalized_name = lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))),
  check (template_key is null or template_key in (
    'diagnostic_initial','orthodontics','endodontics','periodontics',
    'implants','oral_surgery','rehabilitation','followup'
  ))
);

create unique index smyl_evidence_categories_active_name_uq
  on public.smyl_evidence_categories(tenant_id, normalized_name)
  where archived_at is null;
create unique index smyl_evidence_categories_active_template_uq
  on public.smyl_evidence_categories(tenant_id, template_key)
  where template_key is not null and archived_at is null;
create index smyl_evidence_categories_tenant_idx
  on public.smyl_evidence_categories(tenant_id, archived_at, sort_order, name);

create table public.smyl_evidence_category_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  source_type text not null check (source_type in ('patient_file','clinical_photo_study','dental_record')),
  source_id text not null check (char_length(btrim(source_id)) between 1 and 120),
  category_id uuid not null references public.smyl_evidence_categories(id) on delete restrict,
  assigned_at timestamptz not null default clock_timestamp(),
  assigned_by uuid not null default auth.uid(),
  revoked_at timestamptz,
  revoked_by uuid,
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade
);

create unique index smyl_evidence_category_assignments_active_uq
  on public.smyl_evidence_category_assignments(tenant_id, patient_id, source_type, source_id, category_id)
  where revoked_at is null;
create index smyl_evidence_category_assignments_patient_idx
  on public.smyl_evidence_category_assignments(tenant_id, patient_id, source_type, source_id, assigned_at desc);
create index smyl_evidence_category_assignments_category_idx
  on public.smyl_evidence_category_assignments(tenant_id, category_id, revoked_at);

alter table public.smyl_evidence_categories enable row level security;
alter table public.smyl_evidence_category_assignments enable row level security;
revoke all on public.smyl_evidence_categories, public.smyl_evidence_category_assignments from public, anon, authenticated;
grant select on public.smyl_evidence_categories, public.smyl_evidence_category_assignments to authenticated;

create policy smyl_evidence_categories_read on public.smyl_evidence_categories
  for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read'));

create policy smyl_evidence_category_assignments_read on public.smyl_evidence_category_assignments
  for select to authenticated
  using (
    public.smyl_has_permission(tenant_id, 'clinical.read')
    and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical')
  );

create or replace function public.smyl_activate_evidence_category(
  p_template_key text default null,
  p_name text default null
) returns public.smyl_evidence_categories
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_name text;
  v_normalized text;
  v_sort integer := 100;
  v_row public.smyl_evidence_categories;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar categorías clínicas.';
  end if;

  if p_template_key is not null then
    select x.name, x.sort_order into v_name, v_sort
    from (values
      ('diagnostic_initial','Diagnóstico inicial',10),
      ('orthodontics','Ortodoncia',20),
      ('endodontics','Endodoncia',30),
      ('periodontics','Periodoncia',40),
      ('implants','Implantes',50),
      ('oral_surgery','Cirugía',60),
      ('rehabilitation','Rehabilitación',70),
      ('followup','Seguimiento',80)
    ) as x(template_key, name, sort_order)
    where x.template_key = p_template_key;
    if v_name is null then
      raise exception using errcode = '22023', message = 'La categoría sugerida no es válida.';
    end if;
  else
    v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
    if char_length(v_name) < 2 or char_length(v_name) > 48 then
      raise exception using errcode = '22023', message = 'Escribe un nombre de 2 a 48 caracteres.';
    end if;
  end if;

  v_normalized := lower(v_name);
  select * into v_row
  from public.smyl_evidence_categories
  where tenant_id = v_tenant
    and archived_at is null
    and (normalized_name = v_normalized or (p_template_key is not null and template_key = p_template_key))
  order by created_at
  limit 1;
  if found then return v_row; end if;

  select * into v_row
  from public.smyl_evidence_categories
  where tenant_id = v_tenant
    and archived_at is not null
    and (normalized_name = v_normalized or (p_template_key is not null and template_key = p_template_key))
  order by updated_at desc
  limit 1
  for update;

  if found then
    update public.smyl_evidence_categories
    set name = v_name,
        normalized_name = v_normalized,
        template_key = coalesce(p_template_key, template_key),
        sort_order = v_sort,
        archived_at = null,
        archived_by = null,
        updated_at = clock_timestamp(),
        updated_by = auth.uid()
    where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.smyl_evidence_categories(
    tenant_id, template_key, name, normalized_name, sort_order, created_by, updated_by
  ) values (
    v_tenant, p_template_key, v_name, v_normalized, v_sort, auth.uid(), auth.uid()
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.smyl_archive_evidence_category(p_category_id uuid)
returns public.smyl_evidence_categories
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_evidence_categories;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar categorías clínicas.';
  end if;
  update public.smyl_evidence_categories
  set archived_at = coalesce(archived_at, clock_timestamp()),
      archived_by = coalesce(archived_by, auth.uid()),
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where tenant_id = v_tenant and id = p_category_id
  returning * into v_row;
  if not found then
    raise exception using errcode = '42501', message = 'La categoría no está disponible.';
  end if;
  return v_row;
end;
$$;

create or replace function public.smyl_set_evidence_category(
  p_patient_id uuid,
  p_source_type text,
  p_source_id text,
  p_category_id uuid,
  p_active boolean default true
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_evidence_guard(p_patient_id, 'clinical.write');
  v_assignment public.smyl_evidence_category_assignments;
begin
  if p_source_type not in ('patient_file','clinical_photo_study','dental_record')
     or char_length(btrim(coalesce(p_source_id, ''))) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'La evidencia no es válida.';
  end if;
  if not exists (
    select 1 from public.smyl_evidence_categories
    where tenant_id = v_tenant and id = p_category_id and archived_at is null
  ) then
    raise exception using errcode = '22023', message = 'La categoría no está activa.';
  end if;

  if coalesce(p_active, true) then
    select * into v_assignment
    from public.smyl_evidence_category_assignments
    where tenant_id = v_tenant and patient_id = p_patient_id
      and source_type = p_source_type and source_id = btrim(p_source_id)
      and category_id = p_category_id and revoked_at is null
    limit 1;
    if not found then
      insert into public.smyl_evidence_category_assignments(
        tenant_id, patient_id, source_type, source_id, category_id, assigned_by
      ) values (
        v_tenant, p_patient_id, p_source_type, btrim(p_source_id), p_category_id, auth.uid()
      ) returning * into v_assignment;
    end if;
  else
    update public.smyl_evidence_category_assignments
    set revoked_at = clock_timestamp(), revoked_by = auth.uid()
    where tenant_id = v_tenant and patient_id = p_patient_id
      and source_type = p_source_type and source_id = btrim(p_source_id)
      and category_id = p_category_id and revoked_at is null
    returning * into v_assignment;
  end if;

  return jsonb_build_object(
    'categoryId', p_category_id,
    'sourceType', p_source_type,
    'sourceId', btrim(p_source_id),
    'active', coalesce(p_active, true),
    'assignmentId', v_assignment.id
  );
end;
$$;

revoke all on function public.smyl_activate_evidence_category(text,text),
  public.smyl_archive_evidence_category(uuid),
  public.smyl_set_evidence_category(uuid,text,text,uuid,boolean)
  from public, anon;
grant execute on function public.smyl_activate_evidence_category(text,text),
  public.smyl_archive_evidence_category(uuid),
  public.smyl_set_evidence_category(uuid,text,text,uuid,boolean)
  to authenticated;

comment on table public.smyl_evidence_categories is
  'Categorías clínicas configurables por tenant. Organizan evidencia sin alterar modalidad, original ni historial.';
comment on table public.smyl_evidence_category_assignments is
  'Historial append-only de categorías aplicadas a evidencia clínica de cualquier fuente canónica.';
