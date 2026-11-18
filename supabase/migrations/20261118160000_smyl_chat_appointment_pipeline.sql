-- A conversation may change pipeline stage; the calendar remains authoritative for appointments.
begin;

create table if not exists public.smyl_chat_pipeline_overrides (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  conversation_id uuid not null,
  stage_id text check (stage_id is null or stage_id in ('smyl:confirmed','smyl:arrived','smyl:attended')
    or stage_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  revision integer not null check (revision>0),
  actor_id uuid not null,
  appointment_when_moved uuid,
  changed_at timestamptz not null,
  primary key(tenant_id,conversation_id)
);
-- Sparse change timestamps, including removal from a patient or branch. Existing
-- appointments are read directly. Billing edits, notes, reminders and repeated status
-- updates must never reopen a manual stage. No appointment content is copied.
create table if not exists public.smyl_chat_appointment_ticks (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null, branch_id uuid not null, professional_id uuid not null, appointment_id uuid not null,
  changed_at timestamptz not null,
  primary key(tenant_id,patient_id,branch_id,professional_id,appointment_id)
);
alter table public.smyl_chat_pipeline_overrides enable row level security;
alter table public.smyl_chat_appointment_ticks enable row level security;
revoke all on public.smyl_chat_pipeline_overrides, public.smyl_chat_appointment_ticks from public,anon,authenticated,service_role;
-- Remember when a real, visible competing appointment superseded a manual choice.
-- Otherwise cancelling/deleting that appointment could resurrect the old choice.
-- Scope the witness to the viewer and visit; another teammate may not see that visit.
create table if not exists public.smyl_chat_pipeline_reopenings (
  tenant_id uuid not null,conversation_id uuid not null,revision integer not null,viewer_id uuid not null,
  patient_id uuid not null,branch_id uuid not null,professional_id uuid not null,appointment_id uuid not null,
  primary key(tenant_id,conversation_id,revision,viewer_id,patient_id,branch_id,professional_id,appointment_id),
  foreign key(tenant_id,conversation_id) references public.smyl_chat_pipeline_overrides(tenant_id,conversation_id) on delete cascade
);
alter table public.smyl_chat_pipeline_reopenings enable row level security;
revoke all on public.smyl_chat_pipeline_reopenings from public,anon,authenticated,service_role;
create index if not exists smyl_chat_request_appointment_origin on public.smyl_appointment_requests(tenant_id,appointment_id,lana_conversation_id)
  where appointment_id is not null and lana_conversation_id is not null;

create or replace function public.smyl_chat_touch_appointment_pipeline() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare stamp timestamptz:=clock_timestamp();
begin
  if tg_op='UPDATE' and (old.tenant_id,old.patient_id,old.branch_id,old.professional_id,old.id,old.status,old.starts_at,old.ends_at)
    is not distinct from (new.tenant_id,new.patient_id,new.branch_id,new.professional_id,new.id,new.status,new.starts_at,new.ends_at) then return null; end if;
  -- Record the previous visibility scope only if the appointment left it.
  if (tg_op='DELETE' or (tg_op='UPDATE' and (old.tenant_id,old.patient_id,old.branch_id,old.professional_id,old.id)
     is distinct from (new.tenant_id,new.patient_id,new.branch_id,new.professional_id,new.id)))
     and exists(select 1 from public.camila_tenants t where t.id=old.tenant_id) then
    insert into public.smyl_chat_appointment_ticks values(old.tenant_id,old.patient_id,old.branch_id,old.professional_id,old.id,stamp)
      on conflict (tenant_id,patient_id,branch_id,professional_id,appointment_id) do update set changed_at=excluded.changed_at;
  end if;
  if tg_op<>'DELETE' then
    insert into public.smyl_chat_appointment_ticks values(new.tenant_id,new.patient_id,new.branch_id,new.professional_id,new.id,stamp)
      on conflict (tenant_id,patient_id,branch_id,professional_id,appointment_id) do update set changed_at=excluded.changed_at;
  end if;
  return null;
end;
$$;
revoke all on function public.smyl_chat_touch_appointment_pipeline() from public,anon,authenticated,service_role;
drop trigger if exists smyl_chat_pipeline_appointment_change on public.smyl_appointments;
create trigger smyl_chat_pipeline_appointment_change after insert or update of tenant_id,patient_id,branch_id,professional_id,id,status,starts_at,ends_at or delete
on public.smyl_appointments for each row execute function public.smyl_chat_touch_appointment_pipeline();

-- Actor-bound equivalent of the authenticated schedule and chat branch policies.
-- The bridge's service role never substitutes its own broader schedule access.
create or replace function public.smyl_chat_reads_visit(t uuid,actor uuid,branch uuid,professional uuid,patient uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  with access as (
    select u.rol,
      case when u.rol='dueño' then 'clinic' else coalesce(s.scope,'own') end as schedule_scope,
      case when u.rol='dueño' then 'clinic' else coalesce(c.scope,'own') end as clinical_scope,
      exists(select 1 from public.smyl_role_permissions rp where rp.tenant_id=r.tenant_id and rp.role_id=r.id
        and rp.permission_key='schedule.read') as permitted
    from public.camila_usuarios u join public.smyl_member_roles mr on (mr.tenant_id,mr.user_id)=(u.tenant_id,u.id)
    join public.smyl_roles r on (r.tenant_id,r.id)=(mr.tenant_id,mr.role_id) and r.active
    left join public.smyl_role_scopes s on (s.tenant_id,s.role_id)=(r.tenant_id,r.id) and s.domain='schedule'
    left join public.smyl_role_scopes c on (c.tenant_id,c.role_id)=(r.tenant_id,r.id) and c.domain='clinical'
    where u.tenant_id=t and u.id=actor and u.activo
  ), own_prof as (select p.id from public.smyl_professionals p where p.tenant_id=t and p.user_id=actor and p.active)
  select branch is not null and public.smyl_chat_route_allowed(t,actor,branch) and (t=actor or exists(select 1 from access ac where ac.permitted and (
    ac.schedule_scope='clinic'
    or (ac.schedule_scope='branches' and exists(select 1 from public.smyl_member_branches b where b.tenant_id=t and b.user_id=actor and b.branch_id=branch))
    or (ac.schedule_scope in ('own','care_team') and professional in(select id from own_prof))
    or (ac.schedule_scope='care_team' and (ac.clinical_scope='clinic'
      or (ac.clinical_scope='branches' and exists(select 1 from public.smyl_appointments a join public.smyl_member_branches b
        on b.tenant_id=a.tenant_id and b.branch_id=a.branch_id where a.tenant_id=t and a.patient_id=patient and b.user_id=actor))
      or (ac.clinical_scope in ('own','care_team') and (
        exists(select 1 from public.smyl_patient_care_team ct where ct.tenant_id=t and ct.patient_id=patient and ct.professional_id in(select id from own_prof)
          and ct.active and (ct.ends_at is null or ct.ends_at>now()))
        or exists(select 1 from public.smyl_appointments a where a.tenant_id=t and a.patient_id=patient and a.professional_id in(select id from own_prof))
      )))
  ))))
$$;
revoke all on function public.smyl_chat_reads_visit(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Historical branch time zones are free text. Invalid configuration must never
-- interrupt a calendar write when a linked chat is recalculated.
create or replace function public.smyl_chat_appointment_timezone(zone text) returns text
language plpgsql stable set search_path=pg_catalog as $$
begin
  if nullif(btrim(zone),'') is null then return 'UTC'; end if;
  perform timezone(zone,now());
  return zone;
exception when invalid_parameter_value then return 'UTC';
end;
$$;
revoke all on function public.smyl_chat_appointment_timezone(text) from public,anon,authenticated,service_role;

-- Match verified patient links only. An appointment originating in a particular
-- chat belongs to that thread. Ordinary Agenda appointments follow the patient.
create or replace function public.smyl_chat_pipeline_context(p_tenant uuid,p_actor uuid,p_conversations uuid[])
returns table(conversation_id uuid, appointment jsonb, auto_stage_key text, manual_active boolean, manual_stage_id text,
  manual_revision integer, changed_at timestamptz, stage_source text, effective_stage_id text)
language sql stable security definer set search_path=pg_catalog,public as $$
 with visible as materialized (
   select id from unnest(public.smyl_chat_visible_ids(p_tenant,p_actor,p_conversations)) x(id)
 ), links as materialized (
   select v.id,h.patient_id,h.updated_at as linked_at from visible v left join public.camila_lana_handoffs h
   on h.tenant_id=p_tenant and h.lana_conversation_id=v.id
 ), patients as (select distinct patient_id from links where patient_id is not null),
 visits as materialized (
   select a.id,a.patient_id,a.branch_id,a.professional_id,a.status,a.starts_at,a.ends_at,
     public.smyl_chat_appointment_timezone(b.timezone) as timezone,a.created_at
   from patients p join public.smyl_appointments a on a.tenant_id=p_tenant and a.patient_id=p.patient_id
   join public.smyl_branches b on b.id=a.branch_id and b.tenant_id=a.tenant_id
   where public.smyl_chat_reads_visit(p_tenant,p_actor,a.branch_id,a.professional_id,a.patient_id)
 ), facts as (
   select v.patient_id,v.id as appointment_id,v.created_at as stamp from visits v
   union all
   select tick.patient_id,tick.appointment_id,tick.changed_at from public.smyl_chat_appointment_ticks tick
   join patients p on p.patient_id=tick.patient_id where tick.tenant_id=p_tenant
     and public.smyl_chat_reads_visit(p_tenant,p_actor,tick.branch_id,tick.professional_id,tick.patient_id)
 ), linked_facts as materialized (
   select l.id as thread,f.appointment_id,max(f.stamp) as stamp
   from links l join facts f on f.patient_id=l.patient_id
   where not exists(select 1 from public.smyl_appointment_requests r where r.tenant_id=p_tenant and r.appointment_id=f.appointment_id
     and r.lana_conversation_id is not null and (r.lana_conversation_id<>l.id or r.patient_id is distinct from l.patient_id))
   group by l.id,f.appointment_id
 ), candidates as (
   select f.thread,v.*,case
     when v.status in ('arrived','checked_in','in_progress') and (v.ends_at at time zone v.timezone)::date >= (now() at time zone v.timezone)::date then 1
     when v.status in ('confirmed','scheduled') and v.ends_at>now() then 2
     when v.status in ('completed','attended') then 3
     when v.status in ('cancelled','no_show') then 4
     else 5 end as priority
   from linked_facts f join visits v on v.id=f.appointment_id
   join links l on l.id=f.thread and l.patient_id=v.patient_id
 ), chosen as (
   select distinct on(thread) c.* from candidates c where priority<=4
   order by thread,priority,case when priority=2 then starts_at end asc,
     case when priority<>2 then starts_at end desc,id
 ), projected as (
   select l.id,case when c.id is not null then jsonb_build_object('id',c.id,'status',c.status,'starts_at',c.starts_at,'ends_at',c.ends_at,'timezone',c.timezone) end as appt,
     case when c.priority=1 then 'arrived' when c.priority=2 and c.status='confirmed' then 'confirmed' when c.priority=3 then 'attended' end as auto_key,
     m.revision is not null and coalesce(greatest(selected_fact.stamp,original_fact.stamp)<=m.changed_at,true)
       and not exists(select 1 from public.smyl_chat_pipeline_reopenings w join linked_facts f on f.thread=w.conversation_id and f.appointment_id=w.appointment_id
         where w.tenant_id=m.tenant_id and w.conversation_id=m.conversation_id and w.revision=m.revision and w.viewer_id=p_actor and w.patient_id=l.patient_id
           and public.smyl_chat_reads_visit(w.tenant_id,p_actor,w.branch_id,w.professional_id,w.patient_id)) as manual,
     m.stage_id as manual_id,coalesce(m.revision,0) as revision,
     greatest(m.changed_at,events.stamp,l.linked_at,expired.expired_at) as modified
   from links l left join chosen c on c.thread=l.id
   left join public.smyl_chat_pipeline_overrides m on m.tenant_id=p_tenant and m.conversation_id=l.id
   left join linked_facts selected_fact on selected_fact.thread=l.id and selected_fact.appointment_id=c.id
   left join linked_facts original_fact on original_fact.thread=l.id and original_fact.appointment_id=m.appointment_when_moved
   left join (select thread,max(stamp) as stamp from linked_facts group by thread) events on events.thread=l.id
   left join (select thread,max(boundary) as expired_at from (
     select thread,case when status in ('confirmed','scheduled') then ends_at
       when status in ('arrived','checked_in','in_progress') then
         ((ends_at at time zone timezone)::date+1)::timestamp at time zone timezone end as boundary
     from candidates
   ) boundaries where boundary<=now() group by thread) expired on expired.thread=l.id
 )
 select id,appt,auto_key,manual,case when manual then manual_id end,revision,modified,
   case when manual then 'manual' when auto_key is not null then 'appointment' else 'lana' end,
   case when manual then manual_id when auto_key is not null then 'smyl:'||auto_key end from projected
$$;
-- Run at transaction end: inbox appointment confirmation creates the appointment
-- before linking its request. Both rows must be visible before recording a reopening.
create or replace function public.smyl_chat_record_pipeline_reopening() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.camila_lana_handoffs h join public.smyl_chat_pipeline_overrides m
      on m.tenant_id=h.tenant_id and m.conversation_id=h.lana_conversation_id
      where h.tenant_id=new.tenant_id and h.patient_id=new.patient_id and m.changed_at<new.changed_at) then return null; end if;
  insert into public.smyl_chat_pipeline_reopenings(tenant_id,conversation_id,revision,viewer_id,patient_id,branch_id,professional_id,appointment_id)
    select m.tenant_id,m.conversation_id,m.revision,v.id,new.patient_id,new.branch_id,new.professional_id,new.appointment_id
    from public.camila_lana_handoffs h join public.smyl_chat_pipeline_overrides m
      on m.tenant_id=h.tenant_id and m.conversation_id=h.lana_conversation_id
    cross join public.smyl_chat_assistants(new.tenant_id) v
    cross join lateral public.smyl_chat_pipeline_context(m.tenant_id,v.id,array[m.conversation_id]) resolved
    where h.tenant_id=new.tenant_id and h.patient_id=new.patient_id and m.changed_at<new.changed_at
      and public.smyl_chat_reads_visit(m.tenant_id,v.id,new.branch_id,new.professional_id,new.patient_id)
      and not resolved.manual_active and new.appointment_id=(resolved.appointment->>'id')::uuid
      and new.appointment_id is distinct from m.appointment_when_moved
      -- Once the manual choice is retired, later unrelated appointments need no witnesses.
      and not exists(select 1 from public.smyl_chat_pipeline_reopenings w where w.tenant_id=m.tenant_id and w.conversation_id=m.conversation_id
        and w.revision=m.revision and w.viewer_id=v.id and w.patient_id=new.patient_id and w.branch_id=new.branch_id and w.professional_id=new.professional_id)
    on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.smyl_chat_record_pipeline_reopening() from public,anon,authenticated,service_role;
drop trigger if exists smyl_chat_pipeline_real_transition on public.smyl_chat_appointment_ticks;
create constraint trigger smyl_chat_pipeline_real_transition after insert or update on public.smyl_chat_appointment_ticks
deferrable initially deferred for each row execute function public.smyl_chat_record_pipeline_reopening();

-- Edge verifies the conversation belongs to the provider tenant, and verifies custom
-- UUIDs against that clinic's stage catalog. A NULL target is an explicit manual choice.
create or replace function public.smyl_chat_set_pipeline_stage(p_tenant uuid,p_actor uuid,p_conversation uuid,p_stage_id text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_row record; stage text:=lower(p_stage_id);
begin
  if p_tenant is null or p_actor is null or p_conversation is null or p_expected_revision is null or p_expected_revision<0
    or (stage is not null and stage not in ('smyl:confirmed','smyl:arrived','smyl:attended')
      and stage !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise invalid_parameter_value; end if;
  -- Same short lock used by transfers and profile changes: a stale tab cannot
  -- change the stage after the responsible teammate or clinic scope has changed.
  perform pg_advisory_xact_lock(hashtextextended('smyl-chat:'||p_tenant::text,0));
  select * into current_row from public.smyl_chat_pipeline_context(p_tenant,p_actor,array[p_conversation]);
  if not found then raise insufficient_privilege; end if;
  if current_row.manual_revision<>p_expected_revision then
    if current_row.manual_revision=p_expected_revision+1 and current_row.manual_active and current_row.manual_stage_id is not distinct from stage then
      return to_jsonb(current_row);
    end if;
    raise exception using errcode='40001',message='La etapa cambió. Actualiza el chat.'; end if;
  delete from public.smyl_chat_pipeline_reopenings where tenant_id=p_tenant and conversation_id=p_conversation;
  insert into public.smyl_chat_pipeline_overrides(tenant_id,conversation_id,stage_id,revision,actor_id,changed_at,appointment_when_moved)
    values(p_tenant,p_conversation,stage,1,p_actor,clock_timestamp(),(current_row.appointment->>'id')::uuid)
    on conflict(tenant_id,conversation_id) do update set stage_id=excluded.stage_id,actor_id=excluded.actor_id,
      revision=smyl_chat_pipeline_overrides.revision+1,changed_at=excluded.changed_at,appointment_when_moved=excluded.appointment_when_moved;
  select * into current_row from public.smyl_chat_pipeline_context(p_tenant,p_actor,array[p_conversation]);
  return to_jsonb(current_row);
end;
$$;
create or replace function public.smyl_chat_pipeline_changed(p_tenant uuid,p_actor uuid,p_conversations uuid[],p_since timestamptz)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.smyl_chat_pipeline_context(p_tenant,p_actor,p_conversations) c where c.changed_at>=p_since)
$$;
revoke all on function public.smyl_chat_pipeline_context(uuid,uuid,uuid[]),public.smyl_chat_set_pipeline_stage(uuid,uuid,uuid,text,integer),
 public.smyl_chat_pipeline_changed(uuid,uuid,uuid[],timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.smyl_chat_pipeline_context(uuid,uuid,uuid[]),public.smyl_chat_set_pipeline_stage(uuid,uuid,uuid,text,integer),
 public.smyl_chat_pipeline_changed(uuid,uuid,uuid[],timestamptz) to service_role;
-- The current handoff fixes the patient. A request and its resulting appointment must
-- both stay inside that patient's thread and the reader's Agenda scope.
create or replace function public.smyl_chat_request_context(p_tenant uuid,p_actor uuid,p_conversation uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare patient uuid; result jsonb;
begin
  if not public.smyl_chat_visible(p_tenant,p_actor,p_conversation) then raise insufficient_privilege; end if;
  select h.patient_id into patient from public.camila_lana_handoffs h
    where h.tenant_id=p_tenant and h.lana_conversation_id=p_conversation;
  if patient is null then return jsonb_build_object('linked',false,'items','[]'::jsonb); end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id),'[]'::jsonb) into result from (
    select r.id,r.service_id,r.preferred_branch_id,r.preferred_professional_id,r.requested_start,r.requested_end,
      r.status,r.appointment_id,r.created_at,r.decided_at,
      case when s.id is not null then jsonb_build_object('id',s.id,'name',s.name,'duration_minutes',s.duration_minutes) end as service,
      case when b.id is not null then jsonb_build_object('id',b.id,'name',b.name,'timezone',b.timezone) end as branch,
      case when p.id is not null then jsonb_build_object('id',p.id,'display_name',p.display_name,'specialty',p.specialty) end as professional,
      case when a.id is not null then jsonb_build_object('id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at) end as appointment
    from public.smyl_appointment_requests r
    left join public.smyl_appointments a on a.tenant_id=r.tenant_id and a.id=r.appointment_id and a.patient_id=r.patient_id
    left join public.smyl_services s on s.tenant_id=r.tenant_id and s.id=r.service_id
    left join public.smyl_branches b on b.tenant_id=r.tenant_id and b.id=r.preferred_branch_id
    left join public.smyl_professionals p on p.tenant_id=r.tenant_id and p.id=r.preferred_professional_id
    where r.tenant_id=p_tenant and r.lana_conversation_id=p_conversation and r.patient_id=patient
      and public.smyl_chat_reads_visit(p_tenant,p_actor,r.preferred_branch_id,r.preferred_professional_id,patient)
      and (r.appointment_id is null or (a.id is not null and public.smyl_chat_reads_visit(p_tenant,p_actor,a.branch_id,a.professional_id,patient)))
    order by r.created_at desc,r.id limit greatest(1,least(coalesce(p_limit,10),20))
  ) q;
  return jsonb_build_object('linked',true,'patient_id',patient,'items',result);
end;
$$;

-- Scope the existing idempotent Agenda action to the chat that initiated it.
create or replace function public.smyl_chat_confirm_request(p_tenant uuid,p_actor uuid,p_conversation uuid,p_request uuid,p_appointment uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare request_row public.smyl_appointment_requests; existing public.smyl_appointments;
begin
  perform pg_advisory_xact_lock(hashtextextended('smyl-chat:'||p_tenant::text,0));
  if not public.smyl_chat_visible(p_tenant,p_actor,p_conversation) then raise insufficient_privilege; end if;
  select r.* into request_row from public.smyl_appointment_requests r
    join public.camila_lana_handoffs h on h.tenant_id=r.tenant_id and h.lana_conversation_id=r.lana_conversation_id and h.patient_id=r.patient_id
    where r.tenant_id=p_tenant and r.lana_conversation_id=p_conversation and r.id=p_request
    for update of r,h;
  if not found or not public.smyl_chat_reads_visit(p_tenant,p_actor,request_row.preferred_branch_id,request_row.preferred_professional_id,request_row.patient_id) then
    raise insufficient_privilege;
  end if;
  if request_row.appointment_id is not null and request_row.appointment_id<>p_appointment then raise insufficient_privilege; end if;
  select a.* into existing from public.smyl_appointments a where a.tenant_id=p_tenant and a.id=p_appointment for update;
  if found and (request_row.appointment_id is distinct from existing.id or existing.patient_id is distinct from request_row.patient_id
      or not public.smyl_chat_reads_visit(p_tenant,p_actor,existing.branch_id,existing.professional_id,existing.patient_id)) then
    raise insufficient_privilege;
  end if;
  return public.smyl_inbox_confirm_appointment_request(p_tenant,p_actor,p_request,p_appointment);
end;
$$;
revoke all on function public.smyl_chat_request_context(uuid,uuid,uuid,integer), public.smyl_chat_confirm_request(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.smyl_chat_request_context(uuid,uuid,uuid,integer), public.smyl_chat_confirm_request(uuid,uuid,uuid,uuid,uuid) to service_role;
commit;
