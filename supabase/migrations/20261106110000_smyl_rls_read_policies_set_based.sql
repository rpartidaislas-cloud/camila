-- Rendimiento de RLS en lecturas de pacientes y citas (auditoría del panel admin, 2026-11-06).
-- Antes: cada fila evaluaba 5 funciones plpgsql (permiso, alcance, profesional, rango, acceso al paciente) y el planner,
-- al no poder estimar su selectividad, las repetía sobre todo el tenant en cada página: con 20 000 pacientes, contar o
-- cargar la lista tardaba 10-50 veces más que sin RLS.
-- Ahora: lo que no depende de la fila (clínicas donde tengo el permiso, clínicas donde mi alcance es X, mis profesionales,
-- pacientes dentro de mi alcance) se calcula UNA vez como conjunto. La decisión de acceso es la misma que la de
-- smyl_has_permission / smyl_effective_scope / smyl_can_access_patient / smyl_can_access_schedule_row (se siguen usando
-- para el alcance «branches» y «care_team» de la agenda, que necesitan la fila).
-- Idempotente. No cambia quién ve qué; sólo cómo se calcula.

-- Las políticas dependen de las funciones: se sueltan primero para poder recrearlas (idempotente).
drop policy if exists pacientes_read on public.camila_pacientes;
drop policy if exists smyl_appointments_read on public.smyl_appointments;
drop function if exists public.smyl_my_professional_ids();
drop function if exists public.smyl_patient_ids_in_scope(text);

create or replace function public.smyl_tenants_with_permission(p_permission text)
returns setof uuid
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select ct.id from public.camila_tenants ct where ct.id = auth.uid() and ct.activo
  union
  select cu.tenant_id
  from public.camila_usuarios cu
  join public.smyl_member_roles mr on mr.tenant_id = cu.tenant_id and mr.user_id = cu.id
  join public.smyl_roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id and r.active
  join public.smyl_role_permissions rp on rp.tenant_id = r.tenant_id and rp.role_id = r.id
  where cu.id = auth.uid() and cu.activo and rp.permission_key = p_permission
$$;

create or replace function public.smyl_tenants_with_scope(p_domain text, p_scopes text[])
returns setof uuid
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select c.t from (
    select ct.id as t from public.camila_tenants ct where ct.id = auth.uid()
    union
    select cu.tenant_id from public.camila_usuarios cu where cu.id = auth.uid()
  ) c
  where public.smyl_effective_scope(c.t, p_domain) = any (p_scopes)
$$;

create or replace function public.smyl_my_professional_ids()
returns table (tenant_id uuid, professional_id uuid)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select p.tenant_id, p.id from public.smyl_professionals p where p.user_id = auth.uid() and p.active
$$;

-- Pacientes accesibles cuando el alcance NO es «clinic» (misma lógica que smyl_can_access_patient, como conjunto).
create or replace function public.smyl_patient_ids_in_scope(p_domain text)
returns table (tenant_id uuid, patient_id uuid)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare r record; v_scope text; v_prof uuid;
begin
  for r in
    select c.t from (
      select ct.id as t from public.camila_tenants ct where ct.id = auth.uid()
      union
      select cu.tenant_id from public.camila_usuarios cu where cu.id = auth.uid()
    ) c
  loop
    v_scope := public.smyl_effective_scope(r.t, p_domain);
    if v_scope = 'branches' then
      return query
        select a.tenant_id, a.patient_id from public.smyl_appointments a
        join public.smyl_member_branches mb on mb.tenant_id = a.tenant_id and mb.branch_id = a.branch_id and mb.user_id = auth.uid()
        where a.tenant_id = r.t;
    elsif v_scope in ('own', 'care_team') then
      v_prof := public.smyl_current_professional_id(r.t);
      if v_prof is not null then
        return query
          select pct.tenant_id, pct.patient_id from public.smyl_patient_care_team pct
          where pct.tenant_id = r.t and pct.professional_id = v_prof and pct.active and (pct.ends_at is null or pct.ends_at > now())
          union
          select a.tenant_id, a.patient_id from public.smyl_appointments a
          where a.tenant_id = r.t and a.professional_id = v_prof;
      end if;
    end if;
  end loop;
end
$$;

revoke all on function public.smyl_tenants_with_permission(text), public.smyl_tenants_with_scope(text, text[]),
  public.smyl_my_professional_ids(), public.smyl_patient_ids_in_scope(text) from public, anon;
grant execute on function public.smyl_tenants_with_permission(text), public.smyl_tenants_with_scope(text, text[]),
  public.smyl_my_professional_ids(), public.smyl_patient_ids_in_scope(text) to authenticated;

create policy pacientes_read on public.camila_pacientes for select to authenticated
  using (
    tenant_id in (select public.smyl_tenants_with_permission('patients.read'))
    and (
      tenant_id in (select public.smyl_tenants_with_scope('patients', array['clinic']))
      or (tenant_id, id) in (select s.tenant_id, s.patient_id from public.smyl_patient_ids_in_scope('patients') s)
    )
  );

create policy smyl_appointments_read on public.smyl_appointments for select to authenticated
  using (
    tenant_id in (select public.smyl_tenants_with_permission('schedule.read'))
    and (
      tenant_id in (select public.smyl_tenants_with_scope('schedule', array['clinic']))
      or (
        tenant_id in (select public.smyl_tenants_with_scope('schedule', array['own']))
        and (tenant_id, professional_id) in (select m.tenant_id, m.professional_id from public.smyl_my_professional_ids() m)
      )
      or (
        tenant_id in (select public.smyl_tenants_with_scope('schedule', array['branches', 'care_team']))
        and public.smyl_can_access_schedule_row(tenant_id, branch_id, professional_id, patient_id)
      )
    )
  );
