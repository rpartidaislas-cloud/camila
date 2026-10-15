-- SMYL · Etapa 1: alta atómica de profesionales y sede inicial.

begin;

create or replace function public.smyl_create_professional(
  p_display_name text,
  p_specialty text default '',
  p_license_number text default '',
  p_user_id uuid default null,
  p_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.smyl_current_tenant();
  v_professional_id uuid;
begin
  if v_tenant_id is null
     or not public.smyl_has_permission(v_tenant_id, 'team.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar profesionales.';
  end if;

  if char_length(btrim(coalesce(p_display_name, ''))) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Escribe el nombre del profesional.';
  end if;

  if p_user_id is not null and not exists (
    select 1 from public.camila_usuarios cu
    where cu.id = p_user_id and cu.tenant_id = v_tenant_id and cu.activo
  ) then
    raise exception using errcode = 'P0002', message = 'La cuenta seleccionada no pertenece al equipo activo.';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.smyl_branches b
    where b.id = p_branch_id and b.tenant_id = v_tenant_id and b.active
  ) then
    raise exception using errcode = 'P0002', message = 'La sucursal no existe o está inactiva.';
  end if;

  insert into public.smyl_professionals (
    tenant_id, user_id, display_name, specialty, license_number, created_by
  ) values (
    v_tenant_id,
    p_user_id,
    btrim(p_display_name),
    btrim(coalesce(p_specialty, '')),
    btrim(coalesce(p_license_number, '')),
    auth.uid()
  )
  returning id into v_professional_id;

  if p_branch_id is not null then
    insert into public.smyl_professional_branches (
      tenant_id, professional_id, branch_id
    ) values (
      v_tenant_id, v_professional_id, p_branch_id
    );
  end if;

  return v_professional_id;
end;
$$;

revoke all on function public.smyl_create_professional(text, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.smyl_create_professional(text, text, text, uuid, uuid)
  to authenticated;

comment on function public.smyl_create_professional(text, text, text, uuid, uuid)
  is 'Crea un profesional de SMYL y su primera sede en una única transacción.';

commit;
