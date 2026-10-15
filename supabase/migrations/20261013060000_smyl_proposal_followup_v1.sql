-- SMYL · Etapa UX 4: seguimiento auditable de cotizaciones.
-- Aditiva: no modifica propuestas ni decisiones históricas.
begin;

alter table public.smyl_role_permissions
  drop constraint if exists smyl_role_permissions_permission_key_check;
alter table public.smyl_role_permissions
  add constraint smyl_role_permissions_permission_key_check check (permission_key in (
    'clinic.read', 'clinic.manage',
    'team.read', 'team.manage', 'audit.read',
    'schedule.read', 'schedule.manage',
    'patients.read', 'patients.manage',
    'clinical.read', 'clinical.write', 'clinical.approve',
    'proposal.read', 'proposal.write', 'proposal.approve', 'proposal.followup',
    'messages.read', 'messages.respond', 'messages.manage',
    'inventory.read', 'inventory.manage',
    'finance.read', 'finance.manage',
    'settings.manage'
  ));

insert into public.smyl_role_permissions(tenant_id,role_id,permission_key)
select r.tenant_id,r.id,'proposal.followup'
from public.smyl_roles r
where r.code in ('propietario','administrador','odontologo')
on conflict do nothing;

create table public.smyl_proposal_events (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete restrict,
  proposal_id uuid not null references public.smyl_proposals(id) on delete restrict,
  proposal_revision integer not null check (proposal_revision > 0),
  event_type text not null check (event_type in ('presented','accepted','declined','changes_requested')),
  channel text not null check (channel in ('in_person','email','whatsapp','phone','other')),
  note text not null default '' check (length(note) <= 1000),
  occurred_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(tenant_id,id),
  unique(tenant_id,proposal_id,proposal_revision,id)
);

create index smyl_proposal_events_timeline_idx
  on public.smyl_proposal_events(tenant_id,proposal_id,proposal_revision,occurred_at desc,created_at desc);

alter table public.smyl_proposal_events enable row level security;
create policy smyl_proposal_events_permission_read on public.smyl_proposal_events
  for select to authenticated
  using(public.smyl_has_permission(tenant_id,'proposal.read'));

revoke all on table public.smyl_proposal_events from public,anon,authenticated;
grant select on table public.smyl_proposal_events to authenticated;

create trigger smyl_proposal_events_audit
  after insert or update or delete on public.smyl_proposal_events
  for each row execute function public.smyl_audit_row();

create function public.smyl_record_proposal_event(
  p_event_id uuid,
  p_proposal_id uuid,
  p_proposal_revision integer,
  p_event_type text,
  p_channel text,
  p_note text default '',
  p_occurred_at timestamptz default now()
) returns public.smyl_proposal_events
language plpgsql security definer set search_path='' as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_proposal public.smyl_proposals;
  v_existing public.smyl_proposal_events;
  v_previous text;
  v_result public.smyl_proposal_events;
  v_note text:=btrim(coalesce(p_note,''));
begin
  if auth.uid() is null or v_tenant is null
    or not public.smyl_has_permission(v_tenant,'proposal.followup')
  then raise exception 'Proposal follow-up access denied' using errcode='42501'; end if;
  if p_event_id is null or p_proposal_id is null or p_proposal_revision is null
    or p_event_type not in ('presented','accepted','declined','changes_requested')
    or p_channel not in ('in_person','email','whatsapp','phone','other')
    or p_occurred_at is null or p_occurred_at>clock_timestamp()+interval '5 minutes'
    or length(v_note)>1000
    or (p_event_type in ('declined','changes_requested') and length(v_note)=0)
  then raise exception 'Invalid proposal event' using errcode='22023'; end if;

  select * into v_existing from public.smyl_proposal_events
   where tenant_id=v_tenant and id=p_event_id;
  if found then
    if v_existing.proposal_id<>p_proposal_id
      or v_existing.proposal_revision<>p_proposal_revision
      or v_existing.event_type<>p_event_type
      or v_existing.channel<>p_channel
      or v_existing.note<>v_note
    then raise exception 'Proposal event identity mismatch' using errcode='40001'; end if;
    return v_existing;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_proposal_id::text||':'||p_proposal_revision::text,4));
  select * into v_proposal from public.smyl_proposals
   where tenant_id=v_tenant and id=p_proposal_id for update;
  if not found or v_proposal.status<>'approved' or v_proposal.revision<>p_proposal_revision
    or p_occurred_at<v_proposal.approved_at
  then raise exception 'Only the current approved proposal can be followed up' using errcode='40001'; end if;

  select event_type into v_previous from public.smyl_proposal_events
   where tenant_id=v_tenant and proposal_id=p_proposal_id and proposal_revision=p_proposal_revision
   order by occurred_at desc,created_at desc limit 1;
  if v_previous in ('accepted','declined','changes_requested')
  then raise exception 'Proposal decision already recorded' using errcode='40001'; end if;
  if p_event_type<>'presented' and v_previous is distinct from 'presented'
  then raise exception 'Record presentation before the patient decision' using errcode='40001'; end if;

  insert into public.smyl_proposal_events(
    id,tenant_id,proposal_id,proposal_revision,event_type,channel,note,occurred_at,created_by
  ) values (
    p_event_id,v_tenant,p_proposal_id,p_proposal_revision,p_event_type,p_channel,v_note,p_occurred_at,auth.uid()
  ) returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.smyl_record_proposal_event(uuid,uuid,integer,text,text,text,timestamptz) from public,anon;
grant execute on function public.smyl_record_proposal_event(uuid,uuid,integer,text,text,text,timestamptz) to authenticated;

comment on table public.smyl_proposal_events is
  'Append-only staff record of proposal presentation and patient-reported decision. It is not a digital signature or consent form.';
comment on function public.smyl_record_proposal_event(uuid,uuid,integer,text,text,text,timestamptz) is
  'Records one idempotent event for the current approved proposal revision; decisions require a prior presentation.';

commit;
