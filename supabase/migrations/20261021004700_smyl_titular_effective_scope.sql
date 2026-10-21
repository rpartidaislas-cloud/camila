-- La cuenta titular de una clínica (su identificador es el de la clínica) debe
-- tener alcance de toda la clínica en cada dominio, igual que ya tiene todos los
-- permisos en smyl_has_permission y la clínica en smyl_current_tenant.
--
-- Antes sólo recibía 'clinic' quien tuviera una fila activa de dueño en
-- camila_usuarios. Las cuentas anteriores a la etapa 4 del equipo no la tienen,
-- así que caían en el alcance 'own' y, sin ficha de profesional, no podían
-- acceder a ningún paciente: guardar un paciente fallaba con 42501 al pedir la
-- fila de vuelta y la lista de pacientes aparecía vacía.
create or replace function public.smyl_effective_scope(p_tenant uuid, p_domain text)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_scope text;
begin
  if p_tenant is not null and p_tenant = auth.uid() and exists (
    select 1 from public.camila_tenants ct where ct.id = p_tenant and ct.activo
  ) then
    return 'clinic';
  end if;
  if exists(select 1 from public.camila_usuarios u where u.id=auth.uid() and u.tenant_id=p_tenant and u.activo and u.rol='dueño') then
    return 'clinic';
  end if;
  select rs.scope into v_scope
  from public.smyl_member_roles mr
  join public.smyl_roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id and r.active
  left join public.smyl_role_scopes rs on rs.tenant_id=r.tenant_id and rs.role_id=r.id and rs.domain=p_domain
  where mr.tenant_id=p_tenant and mr.user_id=auth.uid()
  order by public.smyl_scope_rank(coalesce(rs.scope,'own')) desc limit 1;
  return coalesce(v_scope,'own');
end;
$function$;
