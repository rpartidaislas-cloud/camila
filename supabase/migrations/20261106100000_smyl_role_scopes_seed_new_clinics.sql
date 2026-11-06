-- Las clínicas nuevas no recibían alcances de datos por rol (smyl_role_scopes): la migración 20261015040000 solo
-- sembró los roles que existían ese día, y smyl_bootstrap_clinic nunca los creó. Sin fila, smyl_effective_scope cae a 'own',
-- así que recepción/administrador/finanzas veían 0 pacientes si no tenían ficha de profesional.
-- Esta migración: (1) siembra los alcances de los roles del sistema que no los tengan y (2) deja un trigger que lo hace
-- para cada rol nuevo. Es idempotente y nunca pisa un alcance ya definido por el propietario.

create or replace function public.smyl_seed_role_scopes()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  insert into public.smyl_role_scopes(tenant_id, role_id, domain, scope)
  select new.tenant_id, new.id, d.domain,
    case
      when not new.system_role then 'own'            -- roles personalizados: mínimo privilegio hasta que el propietario decida
      when new.code = 'odontologo' then 'own'
      when new.code = 'asistente' then case when d.domain in ('patients','schedule','clinical','messages') then 'care_team' else 'own' end
      when new.code = 'inventario' then 'branches'
      else 'clinic'
    end
  from (values ('patients'),('schedule'),('clinical'),('messages'),('finance')) d(domain)
  on conflict do nothing;
  return new;
end;
$function$;

revoke all on function public.smyl_seed_role_scopes() from public, anon, authenticated;

drop trigger if exists smyl_seed_role_scopes_after_role on public.smyl_roles;
create trigger smyl_seed_role_scopes_after_role
  after insert on public.smyl_roles
  for each row execute function public.smyl_seed_role_scopes();

-- Relleno de los roles del sistema existentes que carezcan de alcance (mismo mapeo que 20261015040000).
insert into public.smyl_role_scopes(tenant_id, role_id, domain, scope)
select r.tenant_id, r.id, d.domain,
  case r.code
    when 'odontologo' then 'own'
    when 'asistente' then case when d.domain in ('patients','schedule','clinical','messages') then 'care_team' else 'own' end
    when 'inventario' then 'branches'
    else 'clinic'
  end
from public.smyl_roles r
cross join (values ('patients'),('schedule'),('clinical'),('messages'),('finance')) d(domain)
where r.system_role
on conflict do nothing;
