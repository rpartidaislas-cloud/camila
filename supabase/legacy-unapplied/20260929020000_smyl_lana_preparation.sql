-- Stage 5a: PREPARED ONLY. Depends on clinical_workspace and proposals.
-- Internal preparation, not LANA's remote contract. NO sender, cron or webhook.
-- Applying this migration must NOT activate delivery, even for prepared records.
begin;

-- Populated only by a future trusted connector AFTER verifying both identities.
-- Browser users cannot type arbitrary IDs, self-verify or alter these mappings.
create table public.smyl_lana_connections (
  tenant_id uuid primary key references public.camila_tenants(id),
  organization_id text not null unique check (length(trim(organization_id)) between 1 and 200),
  organization_label text not null check (length(trim(organization_label)) between 1 and 200),
  revision integer not null default 1 check (revision > 0),
  status text not null check (status in ('verified','paused')),
  verified_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create table public.smyl_lana_patient_links (
  tenant_id uuid not null references public.smyl_lana_connections(tenant_id),
  patient_id uuid not null,
  organization_id text not null check (length(trim(organization_id)) between 1 and 200),
  contact_id text not null check (length(trim(contact_id)) between 1 and 200),
  contact_label text not null check (length(trim(contact_label)) between 1 and 200),
  connection_revision integer not null check (connection_revision > 0),
  revision integer not null default 1 check (revision > 0),
  status text not null check (status in ('verified','paused')),
  verified_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,patient_id),
  unique (tenant_id,organization_id,contact_id),
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
-- Versions always move forward, including pauses/reverification or label edits.
-- Never silently retarget a previously prepared record.
create function public.smyl_lana_mapping_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.revision:=1;
  else
    if new.tenant_id is distinct from old.tenant_id then raise exception 'Immutable clinic' using errcode='42501'; end if;
    if tg_table_name='smyl_lana_patient_links' and (to_jsonb(new)->>'patient_id') is distinct from (to_jsonb(old)->>'patient_id') then
      raise exception 'Immutable patient' using errcode='42501';
    end if;
    new.revision:=old.revision+1;
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end;
$$;
create trigger smyl_lana_connection_revision before insert or update on public.smyl_lana_connections
for each row execute function public.smyl_lana_mapping_revision();
create trigger smyl_lana_link_revision before insert or update on public.smyl_lana_patient_links
for each row execute function public.smyl_lana_mapping_revision();

-- Durable, held preparation records. Only pointers and identity/version snapshots;
-- no copied diagnosis, notes, treatment text, photos, signed URLs or recipient PII.
create table public.smyl_lana_preparations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id),
  patient_id uuid not null,
  proposal_id uuid not null,
  proposal_revision integer not null,
  connection_revision integer not null,
  link_revision integer not null,
  organization_id text not null,
  contact_id text not null,
  event_type text not null default 'proposal.followup.prepared.v1' check (event_type='proposal.followup.prepared.v1'),
  status text not null default 'prepared' check (status in ('prepared','cancelled')),
  delivery_authorized boolean not null default false check (delivery_authorized=false),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  unique (tenant_id,proposal_id,proposal_revision),
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id),
  foreign key (proposal_id,proposal_revision) references public.smyl_proposal_versions(proposal_id,revision),
  check ((status='prepared' and cancelled_at is null and cancelled_by is null)
    or (status='cancelled' and cancelled_at is not null and cancelled_by is not null))
);
create index smyl_lana_preparations_date on public.smyl_lana_preparations(tenant_id,created_at desc);
alter table public.smyl_lana_connections enable row level security;
alter table public.smyl_lana_patient_links enable row level security;
alter table public.smyl_lana_preparations enable row level security;
revoke all on public.smyl_lana_connections,public.smyl_lana_patient_links,public.smyl_lana_preparations from public,anon,authenticated;
grant select on public.smyl_lana_connections,public.smyl_lana_patient_links,public.smyl_lana_preparations to authenticated;
create policy lana_connection_owner_read on public.smyl_lana_connections for select to authenticated using (tenant_id=(select auth.uid()));
create policy lana_link_owner_read on public.smyl_lana_patient_links for select to authenticated using (tenant_id=(select auth.uid()));
create policy lana_preparation_owner_read on public.smyl_lana_preparations for select to authenticated using (tenant_id=(select auth.uid()));

create function public.smyl_prepare_lana_followup(
  p_proposal_id uuid,p_revision integer,p_connection_revision integer,p_link_revision integer
) returns public.smyl_lana_preparations language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid:=auth.uid();
  person_id uuid;
  proposal public.smyl_proposals;
  plan public.smyl_clinical_plans;
  connection public.smyl_lana_connections;
  link public.smyl_lana_patient_links;
  result public.smyl_lana_preparations;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select patient_id into person_id from public.smyl_proposals where id=p_proposal_id and tenant_id=owner_id;
  if not found then raise exception 'Proposal access denied' using errcode='42501'; end if;
  -- Same lock ordering as clinical/proposal saves; serialize version checks.
  perform pg_advisory_xact_lock(hashtextextended(person_id::text,0));
  select * into plan from public.smyl_clinical_plans where patient_id=person_id and tenant_id=owner_id for share;
  perform pg_advisory_xact_lock(hashtextextended(p_proposal_id::text,1));
  select * into proposal from public.smyl_proposals where id=p_proposal_id and tenant_id=owner_id for share;
  select * into connection from public.smyl_lana_connections where tenant_id=owner_id for share;
  select * into link from public.smyl_lana_patient_links where tenant_id=owner_id and patient_id=person_id for share;
  if proposal.status is distinct from 'approved' or proposal.revision is distinct from p_revision
    or plan.status is distinct from 'reviewed' or plan.revision is distinct from proposal.plan_revision
    or coalesce(proposal.document->>'valid_until','')=''
    or (proposal.document->>'valid_until')::date<(now() at time zone 'America/Mexico_City')::date
    or connection.status is distinct from 'verified' or connection.revision is distinct from p_connection_revision
    or link.status is distinct from 'verified' or link.revision is distinct from p_link_revision
    or link.organization_id is distinct from connection.organization_id
    or link.connection_revision is distinct from connection.revision then
    raise exception 'Review current proposal and verified mappings' using errcode='40001';
  end if;
  select * into result from public.smyl_lana_preparations
    where tenant_id=owner_id and proposal_id=p_proposal_id and proposal_revision=p_revision for update;
  if found then
    -- Lost-response retries return the SAME event. Cancellation/retargeting never
    -- recreates it. A new, explicitly approved proposal revision is required.
    if result.status<>'prepared' or result.connection_revision<>connection.revision
      or result.link_revision<>link.revision or result.organization_id<>connection.organization_id
      or result.contact_id<>link.contact_id then raise exception 'Preparation changed' using errcode='40001'; end if;
    return result;
  end if;
  insert into public.smyl_lana_preparations(tenant_id,patient_id,proposal_id,proposal_revision,
    connection_revision,link_revision,organization_id,contact_id,created_by)
  values(owner_id,person_id,p_proposal_id,p_revision,connection.revision,link.revision,
    connection.organization_id,link.contact_id,owner_id) returning * into result;
  return result;
end;
$$;

create function public.smyl_cancel_lana_preparation(p_id uuid)
returns public.smyl_lana_preparations language plpgsql security definer set search_path='' as $$
declare result public.smyl_lana_preparations;
begin
  select * into result from public.smyl_lana_preparations where id=p_id and tenant_id=auth.uid() for update;
  if not found then raise exception 'Preparation access denied' using errcode='42501'; end if;
  if result.status='prepared' then
    update public.smyl_lana_preparations set status='cancelled',cancelled_by=auth.uid(),cancelled_at=clock_timestamp()
      where id=result.id returning * into result;
  end if;
  return result;
end;
$$;

-- One consistent read, minimum metadata. Clinical documents are never returned.
create function public.smyl_lana_workspace()
returns jsonb language sql stable security definer set search_path='' as $$
  with proposals as (
    select * from public.smyl_proposals where tenant_id=auth.uid() order by updated_at desc,id limit 100
  ), history as (
    select * from public.smyl_lana_preparations where tenant_id=auth.uid() order by created_at desc,id limit 100
  ), ids as (
    select id from proposals union select proposal_id from history
  ), items as (
    select jsonb_build_object(
      'proposal',jsonb_build_object('id',p.id,'tenant_id',p.tenant_id,'patient_id',p.patient_id,
        'revision',p.revision,'plan_revision',p.plan_revision,'status',p.status,
        'title',p.document->>'title','valid_until',p.document->>'valid_until','patient_name',p.patient_name,'updated_at',p.updated_at),
      'plan',jsonb_build_object('status',plan.status,'revision',plan.revision),
      'link',to_jsonb(link),'preparation',to_jsonb(preparation)) as item,p.id,p.updated_at
    from ids join public.smyl_proposals p on p.id=ids.id and p.tenant_id=auth.uid()
    left join public.smyl_clinical_plans plan on plan.patient_id=p.patient_id and plan.tenant_id=p.tenant_id
    left join public.smyl_lana_patient_links link on link.patient_id=p.patient_id and link.tenant_id=p.tenant_id
    left join public.smyl_lana_preparations preparation on preparation.proposal_id=p.id
      and preparation.tenant_id=p.tenant_id and preparation.proposal_revision=p.revision
  )
  select jsonb_build_object('tenant_id',auth.uid(),
    'connection',(select to_jsonb(c) from public.smyl_lana_connections c where tenant_id=auth.uid()),
    'items',coalesce((select jsonb_agg(item order by updated_at desc,id) from items),'[]'::jsonb),
    'proposal_ids',coalesce((select jsonb_agg(id order by updated_at desc,id) from proposals),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by created_at desc,id) from history h),'[]'::jsonb));
$$;
revoke all on function public.smyl_prepare_lana_followup(uuid,integer,integer,integer),
  public.smyl_cancel_lana_preparation(uuid),public.smyl_lana_workspace() from public,anon;
grant execute on function public.smyl_prepare_lana_followup(uuid,integer,integer,integer),
  public.smyl_cancel_lana_preparation(uuid),public.smyl_lana_workspace() to authenticated;
comment on table public.smyl_lana_preparations is 'Held internal outbox. NEVER dispatch these records. A future reviewed integration must require separate explicit authorization of recipient, channel and current approved version.';
commit;
