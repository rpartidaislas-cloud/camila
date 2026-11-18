-- SMYL owns chat authorization. LANA is only the transport: its previous assignments
-- do not grant access until a coordinator routes a conversation here. No patient data is copied.
begin;
create table if not exists public.smyl_chat_member_access (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_mode text not null check (chat_mode in ('none','agent','coordinator')),
  updated_at timestamptz not null default now(), primary key (tenant_id,user_id)
);
create table if not exists public.smyl_chat_assignments (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  conversation_id uuid not null, assignee_id uuid, version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(), primary key (tenant_id,conversation_id)
);
create index if not exists smyl_chat_assignee_queue on public.smyl_chat_assignments(tenant_id,assignee_id,updated_at desc);
create index if not exists smyl_chat_assignment_sync on public.smyl_chat_assignments(tenant_id,updated_at);
-- Only internal metadata. Never insert these rows into camila_mensajes, scheduled jobs, or LANA.
create table if not exists public.smyl_chat_handoffs (
  tenant_id uuid not null, conversation_id uuid not null, version integer not null, actor_id uuid,
  from_user_id uuid, to_user_id uuid, note text not null default '' check(char_length(note)<=1000),
  reason text not null check(reason in ('transfer','profile_disabled','account_disabled')),
  created_at timestamptz not null default now(), primary key(tenant_id,conversation_id,version),
  foreign key(tenant_id,conversation_id) references public.smyl_chat_assignments(tenant_id,conversation_id) on delete cascade
);
create index if not exists smyl_chat_incoming_handoffs on public.smyl_chat_handoffs(tenant_id,to_user_id,created_at desc);
alter table public.smyl_chat_member_access enable row level security;
alter table public.smyl_chat_assignments enable row level security;
alter table public.smyl_chat_handoffs enable row level security;
revoke all on public.smyl_chat_member_access,public.smyl_chat_assignments,public.smyl_chat_handoffs from public,anon,authenticated,service_role;
grant select on public.smyl_chat_member_access,public.smyl_chat_assignments,public.smyl_chat_handoffs to service_role;

-- Explicit choice wins, even for the titular; an inactive membership never gains access.
-- New staff are off by default. The active titular is the sole bootstrap coordinator.
create or replace function public.smyl_chat_mode(p_tenant uuid,p_user uuid) returns text
language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select coalesce(a.chat_mode,case when t.id=p_user then 'coordinator' else 'none' end)
    from public.camila_tenants t left join public.camila_usuarios u on u.id=p_user and u.tenant_id=t.id
    left join public.smyl_chat_member_access a on a.tenant_id=t.id and a.user_id=p_user
    where t.id=p_tenant and t.activo and (u.activo or (u.id is null and t.id=p_user))), 'none')
$$;
create or replace function public.smyl_my_chat_mode() returns text
language sql stable security definer set search_path=pg_catalog,public as $$
  select public.smyl_chat_mode(public.smyl_current_tenant(),auth.uid())
$$;
-- Only this scope is allowed to operate on branchless/unrouted conversations.
create or replace function public.smyl_chat_clinic_wide(p_tenant uuid,p_user uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select p_user=p_tenant or exists(select 1 from public.camila_usuarios u where u.id=p_user and u.tenant_id=p_tenant and u.activo and u.rol='dueño')
    or exists(select 1 from public.smyl_member_roles mr join public.smyl_roles r on (r.tenant_id,r.id)=(mr.tenant_id,mr.role_id) and r.active
      join public.smyl_role_scopes s on (s.tenant_id,s.role_id)=(r.tenant_id,r.id)
      where mr.tenant_id=p_tenant and mr.user_id=p_user and s.domain='messages' and s.scope='clinic')
$$;
create or replace function public.smyl_chat_visible(p_tenant uuid,p_actor uuid,p_conversation uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select p_actor is not null and p_conversation is not null and mode <> 'none' and (
    exists(select 1 from public.smyl_chat_assignments a where a.tenant_id=p_tenant and a.conversation_id=p_conversation and a.assignee_id=p_actor)
    or (mode='coordinator' and (public.smyl_chat_clinic_wide(p_tenant,p_actor) or
      exists(select 1 from public.smyl_conversation_branches b join public.smyl_member_branches mb on mb.tenant_id=b.tenant_id and mb.branch_id=b.branch_id
        where b.tenant_id=p_tenant and b.conversation_id=p_conversation and mb.user_id=p_actor))))
  from public.smyl_chat_mode(p_tenant,p_actor) m(mode)
$$;
create or replace function public.smyl_my_chat_visible(p_tenant uuid,p_conversation uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select p_tenant=public.smyl_current_tenant() and public.smyl_chat_visible(p_tenant,auth.uid(),p_conversation)
$$;
create or replace function public.smyl_chat_assistants(p_tenant uuid)
returns table(id uuid,name text,chat_mode text,kind text)
language sql stable security definer set search_path=pg_catalog,public as $$
  with people as (
    select u.id,coalesce(nullif(btrim(u.nombre),''),nullif(btrim(u.email),''),'Integrante del equipo') as name,u.rol from public.camila_usuarios u
      where u.tenant_id=p_tenant and u.activo
    union all select t.id, 'Titular de la clínica','dueño' from public.camila_tenants t where t.id=p_tenant and t.activo
      and not exists(select 1 from public.camila_usuarios u where u.tenant_id=t.id and u.id=t.id))
  select p.id,p.name,m.mode,case when p.rol='dueño' or p.id=p_tenant then 'owner'
    when exists(select 1 from public.smyl_professionals pr where pr.tenant_id=p_tenant and pr.user_id=p.id and pr.active)
    then 'professional' else 'staff' end
  from people p cross join lateral public.smyl_chat_mode(p_tenant,p.id) m(mode) where m.mode<>'none' order by p.name,p.id
$$;
-- Serialize member revocation, unassignment and transfers in a clinic. These are short,
-- low-frequency writes; ordinary message delivery and reads never acquire this lock.
create or replace function public.smyl_transfer_chat(p_tenant uuid,p_actor uuid,p_conversation uuid,p_target uuid,p_note text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare mode text; old_owner uuid; new_version integer; saved_at timestamptz; clean_note text:=btrim(coalesce(p_note,''));
begin
  if p_conversation is null or p_actor is null or p_tenant is null or p_expected_version is null or p_expected_version<0 or char_length(clean_note)>1000 then
    raise exception using errcode='22023',message='Revisa los datos del traspaso.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('smyl-chat:'||p_tenant::text,0));
  mode:=public.smyl_chat_mode(p_tenant,p_actor);
  if mode='none' or not public.smyl_chat_visible(p_tenant,p_actor,p_conversation) or (p_target is null and mode<>'coordinator') then
    raise insufficient_privilege; end if;
  if p_target is not null and public.smyl_chat_mode(p_tenant,p_target)='none' then
    raise exception using errcode='22023',message='Elige un responsable habilitado en esta clínica.'; end if;
  insert into public.smyl_chat_assignments(tenant_id,conversation_id) values (p_tenant,p_conversation) on conflict do nothing;
  select assignee_id,version into old_owner,new_version from public.smyl_chat_assignments where tenant_id=p_tenant and conversation_id=p_conversation for update;
  if new_version<>p_expected_version then raise exception using errcode='40001',message='La asignación cambió; actualiza el chat.'; end if;
  if old_owner is not distinct from p_target then raise exception using errcode='22023',message='Selecciona un responsable distinto.'; end if;
  update public.smyl_chat_assignments set assignee_id=p_target,version=version+1,updated_at=clock_timestamp()
    where tenant_id=p_tenant and conversation_id=p_conversation returning version,updated_at into new_version,saved_at;
  insert into public.smyl_chat_handoffs(tenant_id,conversation_id,version,actor_id,from_user_id,to_user_id,note,reason,created_at)
    values(p_tenant,p_conversation,new_version,p_actor,old_owner,p_target,clean_note,'transfer',saved_at);
  return jsonb_build_object('assignee_id',p_target,'version',new_version,'updated_at',saved_at);
end;
$$;
-- All-person access labels are only available in Equipo, not in the chat's assignment picker.
create or replace function public.smyl_chat_can_configure(t uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select public.smyl_has_permission(t,'team.manage') and exists (
    select 1 from public.camila_tenants ct left join public.camila_usuarios u
      on u.id=auth.uid() and u.tenant_id=ct.id
    where ct.id=t and ct.activo and (u.activo or (u.id is null and ct.id=auth.uid())))
$$;
revoke all on function public.smyl_chat_can_configure(uuid) from public,anon,authenticated,service_role;
create or replace function public.smyl_chat_team_settings() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); result jsonb;
begin
  if not public.smyl_chat_can_configure(t) then raise insufficient_privilege; end if;
  with users as (select u.id,u.nombre,u.email,u.activo from public.camila_usuarios u where u.tenant_id=t
    union all select t,'Titular de la clínica',null,true where not exists(select 1 from public.camila_usuarios u where u.tenant_id=t and u.id=t)),
  counts as (select a.assignee_id,count(*) as n from public.smyl_chat_assignments a where a.tenant_id=t and a.assignee_id is not null group by a.assignee_id),
  rows as (select u.id as user_id,coalesce(nullif(btrim(u.nombre),''),nullif(btrim(u.email),''),'Integrante del equipo') as name,
          u.activo as active,public.smyl_chat_mode(t,u.id) as chat_mode,coalesce(c.n,0) as assigned_count
    from users u left join counts c on c.assignee_id=u.id)
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.user_id),'[]'::jsonb) into result from rows x;
  return result;
end;
$$;
-- Notes are excluded intentionally from generic auditing. The protected handoff ledger
-- is the only record of note text; one event and version for each assignment change.
create or replace function public.smyl_move_chat_work(t uuid,member uuid,replacement uuid,by_actor uuid,why text)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
  with moved as (update public.smyl_chat_assignments set assignee_id=replacement,version=version+1,updated_at=clock_timestamp()
    where tenant_id=t and assignee_id=member returning conversation_id,version,updated_at)
  insert into public.smyl_chat_handoffs(tenant_id,conversation_id,version,actor_id,from_user_id,to_user_id,reason,created_at)
    select t,conversation_id,version,by_actor,member,replacement,why,updated_at from moved;
  get diagnostics n=row_count;
  return n;
end;
$$;
create or replace function public.smyl_set_chat_access(p_user_id uuid,p_mode text,p_expected_mode text,p_disposition text default null,p_replacement_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); actor uuid:=auth.uid(); prior_mode text; cnt int:=0;
begin
  if not public.smyl_chat_can_configure(t) then raise insufficient_privilege; end if;
  if p_user_id is null or p_mode is null or p_mode not in ('none','agent','coordinator') or p_expected_mode is null then raise invalid_parameter_value; end if;
  perform pg_advisory_xact_lock(hashtextextended('smyl-chat:'||t::text,0));
  if not exists(select 1 from public.camila_tenants where id=t and activo)
    or exists(select 1 from public.camila_usuarios u where u.id=p_user_id and u.tenant_id=t and not u.activo)
    or (p_user_id<>t and not exists(select 1 from public.camila_usuarios u where u.id=p_user_id and u.tenant_id=t and u.activo)) then
    raise exception using errcode='22023',message='Integrante no disponible en esta clínica.'; end if;
  prior_mode:=public.smyl_chat_mode(t,p_user_id);
  if prior_mode<>p_expected_mode then raise exception using errcode='40001',message='El perfil cambió. Vuelve a abrir la ficha.'; end if;
  if p_mode='none' and exists(select 1 from public.smyl_chat_assignments where tenant_id=t and assignee_id=p_user_id) then
    if p_disposition is null or p_disposition not in ('queue','transfer') or
      (p_disposition='queue' and p_replacement_id is not null) or
      (p_disposition='transfer' and (p_replacement_id is null or p_replacement_id=p_user_id or public.smyl_chat_mode(t,p_replacement_id)='none')) then
      raise exception using errcode='22023',message='Elige un responsable habilitado o devuelve los chats a Sin asignar.'; end if;
    cnt:=public.smyl_move_chat_work(t,p_user_id,p_replacement_id,actor,'profile_disabled');
  end if;
  insert into public.smyl_chat_member_access(tenant_id,user_id,chat_mode) values(t,p_user_id,p_mode)
    on conflict(tenant_id,user_id) do update set chat_mode=excluded.chat_mode,updated_at=clock_timestamp();
  return jsonb_build_object('user_id',p_user_id,'chat_mode',p_mode,'moved',cnt);
end;
$$;
-- Other Equipo screens may deactivate/delete a member without opening chat settings.
create or replace function public.smyl_chat_member_departure() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=old.tenant_id;
begin
  if tg_op='UPDATE' then
    if (new.tenant_id=old.tenant_id and (new.activo or not old.activo)) then return new; end if;
  end if;
  if exists(select 1 from public.camila_tenants where id=t) then
    perform pg_advisory_xact_lock(hashtextextended('smyl-chat:'||t::text,0));
    perform public.smyl_move_chat_work(t,old.id,null,auth.uid(),'account_disabled');
    -- During hard deletion of the auth identity the FK may already be cascading.
    if exists(select 1 from auth.users where id=old.id) then
      insert into public.smyl_chat_member_access(tenant_id,user_id,chat_mode) values(t,old.id,'none')
        on conflict(tenant_id,user_id) do update set chat_mode='none',updated_at=clock_timestamp();
    end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end;
$$;
drop trigger if exists smyl_chat_member_departure_guard on public.camila_usuarios;
create trigger smyl_chat_member_departure_guard before update of activo,tenant_id or delete on public.camila_usuarios
for each row execute function public.smyl_chat_member_departure();

-- Metadata-only audit of profile edits; never attach this public audit trigger to the note table.
drop trigger if exists smyl_chat_access_audit on public.smyl_chat_member_access;
create trigger smyl_chat_access_audit after insert or update on public.smyl_chat_member_access
for each row execute function public.smyl_audit_row();

-- Keep the original permission model outside messaging. Explicit chat settings also
-- govern older SQL consumers (quick replies etc), even when a role historically granted chat.
create or replace function public.smyl_has_permission(p_tenant_id uuid,p_permission text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select case
    when p_permission in ('messages.read','messages.respond') then public.smyl_chat_mode(p_tenant_id,auth.uid()) in ('agent','coordinator')
    when p_permission='messages.manage' then public.smyl_chat_mode(p_tenant_id,auth.uid())='coordinator'
    else exists(select 1 from public.camila_tenants ct where ct.id=p_tenant_id and ct.id=auth.uid() and ct.activo)
      or exists(select 1 from public.camila_usuarios cu
        join public.smyl_member_roles mr on mr.tenant_id=cu.tenant_id and mr.user_id=cu.id
        join public.smyl_roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id and r.active
        join public.smyl_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id
        where cu.id=auth.uid() and cu.tenant_id=p_tenant_id and cu.activo and rp.permission_key=p_permission)
    end
$$;
-- Browser-accessible row readers must never inherit a second permissive policy from
-- the patient link/legacy transition. Restrictive policies are ANDed with every permissive path.
do $chat_rls$
declare r record;
begin
  for r in select * from (values
    ('camila_conversaciones','public.smyl_my_chat_visible(tenant_id,id)'),
    ('camila_lana_handoffs','public.smyl_my_chat_visible(tenant_id,lana_conversation_id)'),
    ('camila_lana_clinical_links','public.smyl_my_chat_visible(tenant_id,lana_conversation_id)'),
    ('camila_mensajes','exists(select 1 from public.camila_conversaciones c where c.id=conversacion_id and public.smyl_my_chat_visible(c.tenant_id,c.id))')
  ) as t(tbl,rule) loop
    if to_regclass('public.'||r.tbl) is not null then
      execute format('drop policy if exists smyl_chat_assignment_guard on public.%I',r.tbl);
      execute format('create policy smyl_chat_assignment_guard on public.%I as restrictive for all to authenticated using (%s) with check (%s)',r.tbl,r.rule,r.rule);
    end if;
  end loop;
end;
$chat_rls$;
-- Privileged helpers take an actor only from a trusted server; browsers have no
-- ability to impersonate users, transfer someone else's chat, or create a fake remote ID.
revoke all on function public.smyl_chat_mode(uuid,uuid),public.smyl_chat_clinic_wide(uuid,uuid),
 public.smyl_chat_visible(uuid,uuid,uuid),public.smyl_chat_assistants(uuid),
 public.smyl_transfer_chat(uuid,uuid,uuid,uuid,text,integer),public.smyl_move_chat_work(uuid,uuid,uuid,uuid,text),
 public.smyl_chat_member_departure(),public.smyl_my_chat_mode(),public.smyl_my_chat_visible(uuid,uuid),
 public.smyl_chat_team_settings(),public.smyl_set_chat_access(uuid,text,text,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.smyl_chat_mode(uuid,uuid), public.smyl_chat_clinic_wide(uuid,uuid),
 public.smyl_chat_visible(uuid,uuid,uuid), public.smyl_chat_assistants(uuid),
 public.smyl_transfer_chat(uuid,uuid,uuid,uuid,text,integer) to service_role;
grant execute on function public.smyl_my_chat_mode(),public.smyl_my_chat_visible(uuid,uuid),
 public.smyl_chat_team_settings(),public.smyl_set_chat_access(uuid,text,text,text,uuid) to authenticated;
-- The set-based permission helper must match smyl_has_permission, including legacy role grants.
create or replace function public.smyl_tenants_with_permission(p_permission text) returns setof uuid
language sql stable security definer set search_path=pg_catalog,public as $$
  select t.id from (
    select id from public.camila_tenants where id=auth.uid() and activo
    union select tenant_id from public.camila_usuarios where id=auth.uid() and activo
  ) as t where public.smyl_has_permission(t.id,p_permission)
$$;
revoke all on function public.smyl_tenants_with_permission(text) from public,anon;
grant execute on function public.smyl_tenants_with_permission(text) to authenticated;

-- Timeline is SECURITY DEFINER. Its two chat event readers enforce the same
-- assignment boundary as the direct row policies, before the page limit is applied.
create or replace function public.smyl_patient_timeline(p_patient_id uuid,p_limit integer default 100)
returns table(event_at timestamptz,event_type text,title text,status text,reference_id uuid,metadata jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_limit integer:=greatest(1,least(coalesce(p_limit,100),250));
  v_schedule boolean:=false;
  v_proposal boolean:=false;
  v_finance boolean:=false;
  v_messages boolean:=false;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.read') then
    raise exception using errcode='42501',message='No tienes permiso para consultar la ficha clínica.';
  end if;
  if not exists(
    select 1 from public.camila_pacientes patient
    where patient.tenant_id=v_tenant and patient.id=p_patient_id
      and public.smyl_can_access_patient(patient.tenant_id,patient.id,'clinical')
  ) then
    raise exception using errcode='42501',message='El paciente no está disponible para tu rol.';
  end if;

  v_schedule:=public.smyl_has_permission(v_tenant,'schedule.read');
  v_proposal:=public.smyl_has_permission(v_tenant,'proposal.read');
  v_finance:=public.smyl_has_permission(v_tenant,'finance.read');
  v_messages:=public.smyl_has_permission(v_tenant,'messages.read')
    and public.smyl_can_access_patient(v_tenant,p_patient_id,'messages');

  return query
  select timeline.event_at,timeline.event_type,timeline.title,timeline.status,timeline.reference_id,timeline.metadata
  from (
    -- La primera rama nombra las columnas de la subconsulta: sin estos alias `timeline.event_at` no existe
    -- (así está en 20261027130000; aquí se corrige al re-crear la función).
    select appointment.starts_at as event_at,'appointment'::text as event_type,'Cita registrada'::text as title,
      appointment.status::text as status,appointment.id as reference_id,'{}'::jsonb as metadata
    from public.smyl_appointments appointment
    where appointment.tenant_id=v_tenant and appointment.patient_id=p_patient_id and v_schedule
      and public.smyl_can_access_schedule_row(appointment.tenant_id,appointment.branch_id,appointment.professional_id,appointment.patient_id)

    union all
    select note.created_at,'clinical_note','Evolución clínica',note.status,note.id,
      jsonb_build_object('revision',note.revision)
    from public.smyl_clinical_notes note
    where note.tenant_id=v_tenant and note.patient_id=p_patient_id

    union all
    select patient_file.created_at,'file','Archivo clínico registrado',patient_file.status,patient_file.id,'{}'::jsonb
    from public.smyl_patient_files patient_file
    where patient_file.tenant_id=v_tenant and patient_file.patient_id=p_patient_id

    union all
    select dental.updated_at,'dental_record','Odontograma actualizado','documented',dental.patient_id,
      jsonb_build_object('revision',dental.revision)
    from public.smyl_dental_versions dental
    where dental.tenant_id=v_tenant and dental.patient_id=p_patient_id

    union all
    select photo.updated_at,'photo_review','Revisión fotográfica actualizada','reviewed',photo.case_id,
      jsonb_build_object('revision',photo.revision)
    from public.smyl_photo_reviews photo
    where photo.tenant_id=v_tenant and photo.patient_id=p_patient_id

    union all
    select radiograph.updated_at,'radiograph_review','Revisión radiográfica actualizada','reviewed',radiograph.study_id,
      jsonb_build_object('revision',radiograph.revision)
    from public.smyl_radiograph_reviews radiograph
    where radiograph.tenant_id=v_tenant and radiograph.patient_id=p_patient_id

    union all
    select source.created_at,'radiograph_source','Radiografía registrada para revisión asistida','registered',source.id,
      jsonb_build_object('studyType',public.smyl_radiograph_effective_study_type(v_tenant,source.id),'studyId',source.study_id)
    from public.smyl_radiograph_sources source
    where source.tenant_id=v_tenant and source.patient_id=p_patient_id

    union all
    select coalesce(report.signed_at,report.updated_at),'radiograph_report',
      case when report.status='signed' then 'Informe radiográfico firmado' else 'Informe radiográfico en borrador' end,
      report.status,report.id,jsonb_build_object('revision',report.revision,'sourceId',report.source_id)
    from public.smyl_radiograph_reports report
    where report.tenant_id=v_tenant and report.patient_id=p_patient_id

    union all
    select plan.updated_at,'clinical_plan',
      case when plan.status='reviewed' then 'Plan de tratamiento revisado' else 'Plan de tratamiento actualizado' end,
      plan.status,plan.patient_id,jsonb_build_object('revision',plan.revision)
    from public.smyl_clinical_versions plan
    where plan.tenant_id=v_tenant and plan.patient_id=p_patient_id

    union all
    select proposal.updated_at,'proposal','Cotización actualizada',proposal.status,proposal.id,
      jsonb_build_object('revision',proposal.revision)
    from public.smyl_proposals proposal
    where proposal.tenant_id=v_tenant and proposal.patient_id=p_patient_id and v_proposal

    union all
    select proposal_event.occurred_at,'proposal_event',
      case proposal_event.event_type when 'presented' then 'Cotización presentada'
        when 'accepted' then 'Cotización aceptada' when 'declined' then 'Cotización no aceptada'
        else 'Cambios solicitados en cotización' end,
      proposal_event.event_type,proposal_event.id,
      jsonb_build_object('revision',proposal_event.proposal_revision,'channel',proposal_event.channel)
    from public.smyl_proposal_events proposal_event
    join public.smyl_proposals proposal on proposal.tenant_id=proposal_event.tenant_id and proposal.id=proposal_event.proposal_id
    where proposal.tenant_id=v_tenant and proposal.patient_id=p_patient_id and v_proposal

    union all
    select charge.created_at,'finance_charge','Cargo registrado',charge.status,charge.id,'{}'::jsonb
    from public.smyl_finance_charges charge
    where charge.tenant_id=v_tenant and charge.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(charge.tenant_id,charge.patient_id,charge.branch_id)

    union all
    select charge.voided_at,'finance_charge_voided','Cargo cancelado','voided',charge.id,'{}'::jsonb
    from public.smyl_finance_charges charge
    where charge.tenant_id=v_tenant and charge.patient_id=p_patient_id and charge.status='voided'
      and charge.voided_at is not null and v_finance
      and public.smyl_can_access_finance_patient(charge.tenant_id,charge.patient_id,charge.branch_id)

    union all
    select payment.paid_at,'finance_payment','Pago registrado','paid',payment.id,'{}'::jsonb
    from public.smyl_finance_payments payment
    where payment.tenant_id=v_tenant and payment.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(payment.tenant_id,payment.patient_id,payment.branch_id)

    union all
    select refund.refunded_at,'finance_refund','Reembolso registrado','refunded',refund.id,'{}'::jsonb
    from public.smyl_finance_refunds refund
    join public.smyl_finance_payments payment on payment.tenant_id=refund.tenant_id and payment.id=refund.payment_id
    where payment.tenant_id=v_tenant and payment.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(payment.tenant_id,payment.patient_id,payment.branch_id)

    union all
    select receipt.issued_at,'finance_receipt','Recibo emitido','issued',receipt.id,'{}'::jsonb
    from public.smyl_finance_receipts receipt
    join public.smyl_finance_payments payment on payment.tenant_id=receipt.tenant_id and payment.id=receipt.payment_id
    where payment.tenant_id=v_tenant and payment.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(payment.tenant_id,payment.patient_id,payment.branch_id)

    union all
    select draft.created_at,'cfdi','CFDI preparado',draft.status,draft.id,'{}'::jsonb
    from public.smyl_cfdi_drafts draft
    where draft.tenant_id=v_tenant and draft.patient_id=p_patient_id and v_finance
      and public.smyl_can_access_finance_patient(draft.tenant_id,draft.patient_id,null)

    union all
    select handoff.created_at,'conversation_link','Conversación vinculada','linked',handoff.id,
      jsonb_build_object('channel',handoff.lana_channel)
    from public.camila_lana_handoffs handoff
    where handoff.tenant_id=v_tenant and handoff.patient_id=p_patient_id and v_messages
      and public.smyl_chat_visible(v_tenant,auth.uid(),handoff.lana_conversation_id)

    union all
    select clinical_link.created_at,'conversation_file','Archivo de conversación vinculado',clinical_link.status,
      clinical_link.id,jsonb_build_object('channel',clinical_link.lana_channel)
    from public.camila_lana_clinical_links clinical_link
    where clinical_link.tenant_id=v_tenant and clinical_link.patient_id=p_patient_id and v_messages
      and public.smyl_chat_visible(v_tenant,auth.uid(),clinical_link.lana_conversation_id)
  ) timeline
  order by timeline.event_at desc,timeline.event_type,timeline.reference_id,timeline.metadata::text
  limit v_limit;
end $$;
revoke all on function public.smyl_patient_timeline(uuid,integer) from public,anon;
grant execute on function public.smyl_patient_timeline(uuid,integer) to authenticated;
create or replace function public.smyl_chat_visible_ids(p_tenant uuid,p_actor uuid,p_conversations uuid[])
returns uuid[] language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(array_agg(distinct id),'{}'::uuid[]) from unnest(p_conversations) as c(id)
  where public.smyl_chat_visible(p_tenant,p_actor,c.id)
$$;
revoke all on function public.smyl_chat_visible_ids(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.smyl_chat_visible_ids(uuid,uuid,uuid[]) to service_role;
commit;
