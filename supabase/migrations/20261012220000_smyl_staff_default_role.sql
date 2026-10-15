-- SMYL · Etapa 1: acceso mínimo para integrantes recién invitados.

begin;

-- El alta histórica distingue solo dueño/staff. Un staff nuevo empieza en
-- Recepción; el propietario puede asignarle después un rol clínico explícito.
create or replace function public.smyl_bootstrap_member_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role_id uuid;
begin
  perform public.smyl_bootstrap_clinic(new.tenant_id);

  if new.rol <> 'dueño' then
    select r.id into v_role_id
    from public.smyl_roles r
    where r.tenant_id = new.tenant_id and r.code = 'recepcion' and r.active;

    if v_role_id is not null then
      delete from public.smyl_member_roles
      where tenant_id = new.tenant_id and user_id = new.id;

      insert into public.smyl_member_roles (tenant_id, user_id, role_id)
      values (new.tenant_id, new.id, v_role_id);
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.smyl_bootstrap_member_trigger()
  from public, anon, authenticated;

comment on function public.smyl_bootstrap_member_trigger()
  is 'Aprovisiona cada integrante nuevo con sede principal y acceso mínimo de Recepción.';

commit;
