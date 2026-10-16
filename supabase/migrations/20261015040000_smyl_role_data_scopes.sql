-- SMYL: alcances configurables por rol y equipo tratante.
begin;

create table public.smyl_role_scopes (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  role_id uuid not null,
  domain text not null check (domain in ('patients','schedule','clinical','messages','finance')),
  scope text not null check (scope in ('own','care_team','branches','clinic')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, role_id, domain),
  foreign key (tenant_id, role_id) references public.smyl_roles(tenant_id,id) on delete cascade
);

insert into public.smyl_role_scopes(tenant_id,role_id,domain,scope)
select r.tenant_id,r.id,d.domain,
  case r.code
    when 'odontologo' then case when d.domain in ('patients','schedule','clinical','messages') then 'own' else 'own' end
    when 'asistente' then case when d.domain in ('patients','schedule','clinical','messages') then 'care_team' else 'own' end
    when 'inventario' then 'branches'
    else 'clinic'
  end
from public.smyl_roles r
cross join (values ('patients'),('schedule'),('clinical'),('messages'),('finance')) d(domain)
on conflict do nothing;

create table public.smyl_patient_care_team (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  professional_id uuid not null,
  relationship text not null default 'treating' check (relationship in ('primary','treating','specialist','assistant','cover')),
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  assigned_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id,patient_id,professional_id),
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete cascade,
  foreign key (tenant_id,professional_id) references public.smyl_professionals(tenant_id,id) on delete cascade,
  check (ends_at is null or ends_at > starts_at)
);
create index smyl_patient_care_team_professional_idx
  on public.smyl_patient_care_team(tenant_id,professional_id,patient_id) where active;

create or replace function public.smyl_scope_rank(p_scope text) returns integer
language sql immutable set search_path = pg_catalog
as $$ select case p_scope when 'clinic' then 4 when 'branches' then 3 when 'care_team' then 2 else 1 end $$;

create or replace function public.smyl_current_professional_id(p_tenant uuid) returns uuid
language sql stable security definer set search_path = pg_catalog,public
as $$
  select p.id from public.smyl_professionals p
  where p.tenant_id=p_tenant and p.user_id=auth.uid() and p.active limit 1
$$;

create or replace function public.smyl_effective_scope(p_tenant uuid,p_domain text) returns text
language plpgsql stable security definer set search_path = pg_catalog,public
as $$
declare v_scope text;
begin
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
$$;

create or replace function public.smyl_can_access_patient(p_tenant uuid,p_patient uuid,p_domain text default 'patients') returns boolean
language plpgsql stable security definer set search_path = pg_catalog,public
as $$
declare v_scope text:=public.smyl_effective_scope(p_tenant,p_domain); v_professional uuid:=public.smyl_current_professional_id(p_tenant);
begin
  if p_tenant is null or p_patient is null then return false; end if;
  if v_scope='clinic' then return true; end if;
  if v_scope='branches' then
    return exists(
      select 1 from public.smyl_appointments a
      join public.smyl_member_branches mb on mb.tenant_id=a.tenant_id and mb.branch_id=a.branch_id and mb.user_id=auth.uid()
      where a.tenant_id=p_tenant and a.patient_id=p_patient
    );
  end if;
  if v_professional is null then return false; end if;
  return exists(select 1 from public.smyl_patient_care_team ct where ct.tenant_id=p_tenant and ct.patient_id=p_patient and ct.professional_id=v_professional and ct.active and (ct.ends_at is null or ct.ends_at>now()))
    or exists(select 1 from public.smyl_appointments a where a.tenant_id=p_tenant and a.patient_id=p_patient and a.professional_id=v_professional);
end;
$$;

create or replace function public.smyl_can_access_schedule_row(p_tenant uuid,p_branch uuid,p_professional uuid,p_patient uuid default null) returns boolean
language plpgsql stable security definer set search_path = pg_catalog,public
as $$
declare v_scope text:=public.smyl_effective_scope(p_tenant,'schedule'); v_own uuid:=public.smyl_current_professional_id(p_tenant);
begin
  if v_scope='clinic' then return true; end if;
  if v_scope='branches' then return exists(select 1 from public.smyl_member_branches mb where mb.tenant_id=p_tenant and mb.user_id=auth.uid() and mb.branch_id=p_branch); end if;
  if v_scope='care_team' and p_patient is not null and public.smyl_can_access_patient(p_tenant,p_patient,'clinical') then return true; end if;
  return v_own is not null and p_professional=v_own;
end;
$$;

alter table public.smyl_role_scopes enable row level security;
alter table public.smyl_patient_care_team enable row level security;
revoke all on public.smyl_role_scopes,public.smyl_patient_care_team from public,anon,authenticated;
grant select on public.smyl_role_scopes,public.smyl_patient_care_team to authenticated;
create policy smyl_role_scopes_read on public.smyl_role_scopes for select to authenticated using(public.camila_es_miembro(tenant_id));
create policy smyl_patient_care_team_read on public.smyl_patient_care_team for select to authenticated
  using(public.smyl_has_permission(tenant_id,'patients.read') and public.smyl_can_access_patient(tenant_id,patient_id,'patients'));

create or replace function public.smyl_save_role_access(
  p_role_id uuid,p_name text,p_description text,p_active boolean,p_permissions text[],p_scopes jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_role_id uuid; v_owner boolean; v_domain text; v_scope text;
begin
  select exists(select 1 from public.camila_usuarios u where u.id=auth.uid() and u.tenant_id=v_tenant and u.activo and u.rol='dueño') into v_owner;
  if jsonb_typeof(coalesce(p_scopes,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='Los alcances no son válidos.'; end if;
  v_role_id:=public.smyl_save_role(p_role_id,p_name,p_description,p_active,p_permissions);
  for v_domain in select unnest(array['patients','schedule','clinical','messages','finance']) loop
    v_scope:=coalesce(p_scopes->>v_domain,'own');
    if v_scope not in ('own','care_team','branches','clinic') then raise exception using errcode='22023',message='El alcance no es válido.'; end if;
    if not v_owner and public.smyl_scope_rank(v_scope)>public.smyl_scope_rank(public.smyl_effective_scope(v_tenant,v_domain)) then
      raise exception using errcode='42501',message='No puedes conceder un alcance mayor al tuyo.';
    end if;
    insert into public.smyl_role_scopes(tenant_id,role_id,domain,scope,updated_by)
    values(v_tenant,v_role_id,v_domain,v_scope,auth.uid())
    on conflict(tenant_id,role_id,domain) do update set scope=excluded.scope,updated_by=auth.uid(),updated_at=now();
  end loop;
  return v_role_id;
end $$;
revoke all on function public.smyl_save_role_access(uuid,text,text,boolean,text[],jsonb) from public,anon;
grant execute on function public.smyl_save_role_access(uuid,text,text,boolean,text[],jsonb) to authenticated;

create or replace function public.smyl_assign_patient_professional(p_patient uuid,p_professional uuid,p_relationship text,p_active boolean default true)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not (public.smyl_has_permission(v_tenant,'patients.manage') or public.smyl_has_permission(v_tenant,'team.manage')) then raise exception using errcode='42501',message='No tienes permiso para administrar el equipo tratante.'; end if;
  if p_relationship not in ('primary','treating','specialist','assistant','cover') then raise exception using errcode='22023',message='La relación clínica no es válida.'; end if;
  if not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient) or not exists(select 1 from public.smyl_professionals where tenant_id=v_tenant and id=p_professional and active) then raise exception using errcode='P0002',message='Paciente o profesional no disponible.'; end if;
  insert into public.smyl_patient_care_team(tenant_id,patient_id,professional_id,relationship,active,assigned_by,ends_at)
  values(v_tenant,p_patient,p_professional,p_relationship,p_active,auth.uid(),case when p_active then null else now() end)
  on conflict(tenant_id,patient_id,professional_id) do update set relationship=excluded.relationship,active=excluded.active,ends_at=excluded.ends_at,assigned_by=auth.uid();
end $$;
revoke all on function public.smyl_assign_patient_professional(uuid,uuid,text,boolean) from public,anon;
grant execute on function public.smyl_assign_patient_professional(uuid,uuid,text,boolean) to authenticated;

drop policy if exists pacientes_read on public.camila_pacientes;
create policy pacientes_read on public.camila_pacientes for select to authenticated
  using(public.smyl_has_permission(tenant_id,'patients.read') and public.smyl_can_access_patient(tenant_id,id,'patients'));
drop policy if exists pacientes_create on public.camila_pacientes;
create policy pacientes_create on public.camila_pacientes for insert to authenticated
  with check(tenant_id=public.smyl_current_tenant() and public.smyl_has_permission(tenant_id,'patients.manage'));
drop policy if exists pacientes_edit on public.camila_pacientes;
create policy pacientes_edit on public.camila_pacientes for update to authenticated
  using(public.smyl_has_permission(tenant_id,'patients.manage') and public.smyl_can_access_patient(tenant_id,id,'patients'))
  with check(public.smyl_has_permission(tenant_id,'patients.manage') and public.smyl_can_access_patient(tenant_id,id,'patients'));

drop policy if exists smyl_appointments_read on public.smyl_appointments;
create policy smyl_appointments_read on public.smyl_appointments for select to authenticated
  using(public.smyl_has_permission(tenant_id,'schedule.read') and public.smyl_can_access_schedule_row(tenant_id,branch_id,professional_id,patient_id));
drop policy if exists smyl_professional_hours_read on public.smyl_professional_hours;
create policy smyl_professional_hours_read on public.smyl_professional_hours for select to authenticated
  using(public.smyl_has_permission(tenant_id,'schedule.read') and public.smyl_can_access_schedule_row(tenant_id,branch_id,professional_id,null));
drop policy if exists smyl_schedule_blocks_read on public.smyl_schedule_blocks;
create policy smyl_schedule_blocks_read on public.smyl_schedule_blocks for select to authenticated
  using(public.smyl_has_permission(tenant_id,'schedule.read') and public.smyl_can_access_schedule_row(tenant_id,branch_id,professional_id,null));
drop policy if exists smyl_appointment_requests_read on public.smyl_appointment_requests;
create policy smyl_appointment_requests_read on public.smyl_appointment_requests for select to authenticated
  using(public.smyl_has_permission(tenant_id,'schedule.read') and public.smyl_can_access_schedule_row(tenant_id,preferred_branch_id,preferred_professional_id,patient_id));
drop policy if exists smyl_appointment_events_read on public.smyl_appointment_events;
create policy smyl_appointment_events_read on public.smyl_appointment_events for select to authenticated
  using(public.smyl_has_permission(tenant_id,'schedule.read') and exists(select 1 from public.smyl_appointments a where a.tenant_id=smyl_appointment_events.tenant_id and a.id=smyl_appointment_events.appointment_id and public.smyl_can_access_schedule_row(a.tenant_id,a.branch_id,a.professional_id,a.patient_id)));
drop policy if exists smyl_appointment_reminders_read on public.smyl_appointment_reminders;
create policy smyl_appointment_reminders_read on public.smyl_appointment_reminders for select to authenticated
  using(public.smyl_has_permission(tenant_id,'schedule.read') and exists(select 1 from public.smyl_appointments a where a.tenant_id=smyl_appointment_reminders.tenant_id and a.id=smyl_appointment_reminders.appointment_id and public.smyl_can_access_schedule_row(a.tenant_id,a.branch_id,a.professional_id,a.patient_id)));

drop policy if exists smyl_patient_histories_read on public.smyl_patient_histories;
create policy smyl_patient_histories_read on public.smyl_patient_histories for select to authenticated using(public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
drop policy if exists smyl_patient_history_versions_read on public.smyl_patient_history_versions;
create policy smyl_patient_history_versions_read on public.smyl_patient_history_versions for select to authenticated using(public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
drop policy if exists smyl_clinical_notes_read on public.smyl_clinical_notes;
create policy smyl_clinical_notes_read on public.smyl_clinical_notes for select to authenticated using(public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
drop policy if exists smyl_clinical_note_versions_read on public.smyl_clinical_note_versions;
create policy smyl_clinical_note_versions_read on public.smyl_clinical_note_versions for select to authenticated
  using(public.smyl_has_permission(tenant_id,'clinical.read') and exists(select 1 from public.smyl_clinical_notes n where n.tenant_id=smyl_clinical_note_versions.tenant_id and n.id=smyl_clinical_note_versions.note_id and public.smyl_can_access_patient(n.tenant_id,n.patient_id,'clinical')));
drop policy if exists smyl_clinical_note_addenda_read on public.smyl_clinical_note_addenda;
create policy smyl_clinical_note_addenda_read on public.smyl_clinical_note_addenda for select to authenticated
  using(public.smyl_has_permission(tenant_id,'clinical.read') and exists(select 1 from public.smyl_clinical_notes n where n.tenant_id=smyl_clinical_note_addenda.tenant_id and n.id=smyl_clinical_note_addenda.note_id and public.smyl_can_access_patient(n.tenant_id,n.patient_id,'clinical')));
drop policy if exists smyl_patient_files_read on public.smyl_patient_files;
create policy smyl_patient_files_read on public.smyl_patient_files for select to authenticated using(public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));

create or replace function public.smyl_guard_scoped_write() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()='service_role' then return new; end if;
  if tg_table_name='smyl_appointments' then
    if not public.smyl_can_access_schedule_row(new.tenant_id,new.branch_id,new.professional_id,new.patient_id) then raise exception using errcode='42501',message='La cita queda fuera del alcance de tu rol.'; end if;
  elsif not public.smyl_can_access_patient(new.tenant_id,new.patient_id,'clinical') then
    raise exception using errcode='42501',message='El paciente queda fuera del alcance clínico de tu rol.';
  end if;
  return new;
end $$;

create trigger smyl_appointments_scope_guard before insert or update on public.smyl_appointments for each row execute function public.smyl_guard_scoped_write();
create trigger smyl_patient_histories_scope_guard before insert or update on public.smyl_patient_histories for each row execute function public.smyl_guard_scoped_write();
create trigger smyl_clinical_notes_scope_guard before insert or update on public.smyl_clinical_notes for each row execute function public.smyl_guard_scoped_write();
create trigger smyl_patient_files_scope_guard before insert or update on public.smyl_patient_files for each row execute function public.smyl_guard_scoped_write();

commit;
