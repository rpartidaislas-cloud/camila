-- Pilot disabled by default. LANA remains the message store and transport.
begin;
create table public.smyl_muse_settings (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  enabled boolean not null default false,
  allow_replies boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.smyl_muse_members (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  primary key(tenant_id,user_id)
);
create table public.smyl_muse_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, user_id uuid not null,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  allow_replies boolean not null default false,
  whatsapp_alerts boolean not null default false,
  expires_at timestamptz not null default now()+interval '7 days',
  revoked_at timestamptz, created_at timestamptz not null default now(),
  window_start timestamptz not null default now(), request_count integer not null default 0,
  foreign key(tenant_id,user_id) references public.smyl_muse_members(tenant_id,user_id) on delete cascade
);
create unique index smyl_muse_one_connection on public.smyl_muse_connections(tenant_id,user_id) where revoked_at is null;
create table public.smyl_muse_drafts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.smyl_muse_connections(id) on delete cascade,
  conversation_id uuid not null, assignment_version integer not null,
  content text not null check(char_length(content) between 1 and 4000),
  confirmation_hash text not null check(confirmation_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'draft' check(status in ('draft','sending','accepted','failed','unknown')),
  expires_at timestamptz not null default now()+interval '10 minutes',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  result_code text
);
create table public.smyl_muse_alerts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null, tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null, conversation_id uuid not null, assignment_version integer not null,
  status text not null default 'pending' check(status in ('pending','sending','accepted','skipped','failed','unknown')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  result_code text, unique(tenant_id,event_id)
);
create table public.smyl_muse_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid, connection_id uuid, conversation_id uuid,
  action text not null, outcome text not null,
  created_at timestamptz not null default now()
);
create index smyl_muse_alert_queue on public.smyl_muse_alerts(next_attempt_at) where status='pending';
do $$ declare tbl text; begin
  foreach tbl in array array['smyl_muse_settings','smyl_muse_members','smyl_muse_connections','smyl_muse_drafts','smyl_muse_alerts','smyl_muse_audit'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from public,anon,authenticated',tbl);
    execute format('grant all on public.%I to service_role',tbl);
  end loop;
end $$;
grant usage,select on sequence public.smyl_muse_audit_id_seq to service_role;

-- Uses the existing effective chat profile and branch policy, never a role name.
-- The pilot is deliberately narrower than the inbox: only personally assigned chats.
create function public.smyl_muse_allowed(p_connection uuid,p_conversation uuid default null,p_write boolean default false)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select s.enabled and m.enabled and c.revoked_at is null and c.expires_at>now()
    and public.smyl_chat_mode(c.tenant_id,c.user_id)<>'none'
    and (not p_write or (s.allow_replies and c.allow_replies))
    and (p_conversation is null or (
      public.smyl_chat_visible(c.tenant_id,c.user_id,p_conversation)
      and not exists(select 1 from public.smyl_professional_whatsapp_links l
        where l.tenant_id=c.tenant_id and l.lana_conversation_id=p_conversation and l.active)
      and exists(select 1 from public.smyl_chat_assignments a where a.tenant_id=c.tenant_id
        and a.conversation_id=p_conversation and a.assignee_id=c.user_id)))
    from public.smyl_muse_connections c
    join public.smyl_muse_settings s on s.tenant_id=c.tenant_id
    join public.smyl_muse_members m on (m.tenant_id,m.user_id)=(c.tenant_id,c.user_id)
    where c.id=p_connection),false)
$$;

create function public.smyl_muse_authenticate(p_hash text)
returns setof public.smyl_muse_connections language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.smyl_muse_connections;
begin
  select * into c from public.smyl_muse_connections where token_hash=p_hash for update;
  if not found or not public.smyl_muse_allowed(c.id) then return; end if;
  if c.window_start<now()-interval '1 minute' then c.request_count:=0; c.window_start:=now(); end if;
  if c.request_count>=60 then raise exception 'MUSE_RATE_LIMIT' using errcode='P0001'; end if;
  update public.smyl_muse_connections set request_count=c.request_count+1,window_start=c.window_start where id=c.id;
  return next c;
end $$;

create function public.smyl_muse_claim_draft(p_connection uuid,p_draft uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.smyl_muse_drafts; c public.smyl_muse_connections; a public.smyl_chat_assignments;
begin
  select * into c from public.smyl_muse_connections where id=p_connection;
  select * into d from public.smyl_muse_drafts where id=p_draft and connection_id=p_connection for update;
  if not found or d.confirmation_hash<>p_confirmation then raise exception 'MUSE_DENIED' using errcode='42501'; end if;
  select * into a from public.smyl_chat_assignments where tenant_id=c.tenant_id and conversation_id=d.conversation_id for share;
  if not public.smyl_muse_allowed(c.id,d.conversation_id,true) or a.version is distinct from d.assignment_version then
    raise exception 'MUSE_DENIED' using errcode='42501';
  end if;
  if d.status<>'draft' then return jsonb_build_object('id',d.id,'status',d.status,'claimed',false); end if;
  if d.expires_at<=now() then raise exception 'MUSE_DRAFT_EXPIRED' using errcode='22023'; end if;
  update public.smyl_muse_drafts set status='sending',updated_at=now() where id=d.id;
  insert into public.smyl_muse_audit(tenant_id,user_id,connection_id,conversation_id,action,outcome)
    values(c.tenant_id,c.user_id,c.id,d.conversation_id,'reply','sending');
  return jsonb_build_object('id',d.id,'conversation_id',d.conversation_id,'content',d.content,'status','sending','claimed',true);
end $$;

create function public.smyl_muse_claim_alerts()
returns setof public.smyl_muse_alerts language sql security definer set search_path=pg_catalog,public as $$
  update public.smyl_muse_alerts set status='sending',attempts=attempts+1,updated_at=now()
  where id in (select id from public.smyl_muse_alerts where status='pending' and next_attempt_at<=now()
    order by next_attempt_at for update skip locked limit 3) returning *
$$;

create function public.smyl_muse_cleanup() returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  -- Never retry a send of uncertain delivery with a new key.
  update public.smyl_muse_drafts set status='unknown',updated_at=now() where status='sending' and updated_at<now()-interval '5 minutes';
  update public.smyl_muse_alerts set status='unknown',updated_at=now() where status='sending' and updated_at<now()-interval '5 minutes';
  delete from public.smyl_muse_drafts where (status='draft' and expires_at<now()) or created_at<now()-interval '1 day';
  delete from public.smyl_muse_alerts where created_at<now()-interval '30 days';
  delete from public.smyl_muse_audit where created_at<now()-interval '90 days';
end $$;
revoke all on function public.smyl_muse_allowed(uuid,uuid,boolean),public.smyl_muse_authenticate(text),
  public.smyl_muse_claim_draft(uuid,uuid,text),public.smyl_muse_claim_alerts(),public.smyl_muse_cleanup() from public,anon,authenticated;
grant execute on function public.smyl_muse_allowed(uuid,uuid,boolean),public.smyl_muse_authenticate(text),
  public.smyl_muse_claim_draft(uuid,uuid,text),public.smyl_muse_claim_alerts(),public.smyl_muse_cleanup() to service_role;

-- A coordinator's existing assignment flow is the authority for routing a patient
-- who requests a particular doctor. Names in free text never grant access.
create function public.smyl_muse_assignment_alert() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.smyl_muse_connections;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op='UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  select * into c from public.smyl_muse_connections where tenant_id=new.tenant_id and user_id=new.assignee_id and revoked_at is null;
  if not found or not c.whatsapp_alerts or not public.smyl_muse_allowed(c.id,new.conversation_id) then return new; end if;
  insert into public.smyl_muse_alerts(event_id,tenant_id,user_id,conversation_id,assignment_version)
    values(gen_random_uuid(),new.tenant_id,new.assignee_id,new.conversation_id,new.version);
  return new;
end $$;
revoke all on function public.smyl_muse_assignment_alert() from public,anon,authenticated;
create trigger smyl_muse_assigned after insert or update of assignee_id on public.smyl_chat_assignments
  for each row execute function public.smyl_muse_assignment_alert();
commit;
