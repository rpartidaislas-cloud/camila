-- SMYL · Backfill: asignar rol 'propietario' a usuarios con rol='dueño' que
-- no lo tienen en smyl_member_roles.
--
-- Por qué puede ocurrir: si smyl_bootstrap_clinic ya había corrido para una
-- clínica antes de que se incluyera la asignación de propietario para dueños,
-- los usuarios existentes quedan sin ese rol y no pasan el check team.manage
-- en smyl_has_permission, lo que impide editar perfiles profesionales.

begin;

insert into public.smyl_member_roles (tenant_id, user_id, role_id)
select cu.tenant_id, cu.id, r.id
from public.camila_usuarios cu
join public.smyl_roles r
  on r.tenant_id = cu.tenant_id
 and r.code = 'propietario'
 and r.active
where cu.rol = 'dueño'
  and cu.activo
  and not exists (
    select 1
    from public.smyl_member_roles mr
    join public.smyl_roles r2
      on r2.id = mr.role_id
     and r2.tenant_id = mr.tenant_id
     and r2.code = 'propietario'
    where mr.tenant_id = cu.tenant_id
      and mr.user_id = cu.id
  )
on conflict do nothing;

commit;
