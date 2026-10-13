-- Gmail delivery for approved mySmyl shares. PREPARED ONLY: do not apply remotely
-- until the matching Edge Functions have been reviewed and deployment is authorized.
-- Refresh tokens and PKCE verifiers are encrypted by the Edge runtime before DML.
begin;

create table public.smyl_gmail_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  tenant_id uuid not null references public.camila_tenants(id),
  actor_id uuid not null references auth.users(id),
  intent text not null check (intent in ('connect','reconnect')),
  pkce_verifier_ciphertext text not null check (length(pkce_verifier_ciphertext) between 40 and 6000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
create index smyl_gmail_oauth_states_expiry on public.smyl_gmail_oauth_states(expires_at);

create table public.smyl_gmail_connections (
  tenant_id uuid primary key references public.camila_tenants(id),
  sender_email text not null check (sender_email = 'apps@smyldesign.ai'),
  scope text not null check (scope = 'https://www.googleapis.com/auth/gmail.send'),
  status text not null check (status in ('active','reconnect_required','disconnected')),
  identity_status text not null check (identity_status in ('pending_send_verification','verified_by_send','unavailable')),
  refresh_token_ciphertext text check (refresh_token_ciphertext is null or length(refresh_token_ciphertext) between 40 and 6000),
  token_key_version integer not null default 1 check (token_key_version > 0),
  connected_by uuid references auth.users(id),
  connected_at timestamptz,
  disconnected_by uuid references auth.users(id),
  disconnected_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code in ('oauth_revoked','sender_mismatch','provider_unavailable','scope_rejected','refresh_failed','revocation_unconfirmed')),
  updated_at timestamptz not null default now(),
  check ((status = 'active' and refresh_token_ciphertext is not null and connected_by is not null and connected_at is not null)
    or (status <> 'active' and refresh_token_ciphertext is null))
);

create table public.smyl_gmail_deliveries (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id),
  actor_id uuid not null references auth.users(id),
  patient_id uuid not null,
  case_id uuid not null references public.smyl_patient_case_archive(id),
  share_id uuid not null references public.smyl_portal_shares(id),
  share_version integer not null check (share_version > 0),
  plan_revision integer not null check (plan_revision > 0),
  proposal_id uuid,
  proposal_revision integer check (proposal_revision is null or proposal_revision > 0),
  include_budget boolean not null,
  consent_confirmed_at timestamptz not null,
  status text not null check (status in ('claimed','sending','accepted','failed','uncertain')),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) between 1 and 255),
  provider_thread_id text check (provider_thread_id is null or length(provider_thread_id) between 1 and 255),
  error_code text check (error_code is null or error_code in ('oauth_revoked','sender_mismatch','gmail_rejected','gmail_rate_limited','provider_unavailable','request_uncertain','invalid_recipient','access_expired')),
  created_at timestamptz not null default now(),
  attempted_at timestamptz,
  accepted_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id),
  check ((include_budget and proposal_id is not null and proposal_revision is not null)
    or (not include_budget and proposal_id is null and proposal_revision is null)),
  check ((status = 'accepted' and accepted_at is not null and failed_at is null)
    or (status in ('failed','uncertain') and failed_at is not null and accepted_at is null)
    or (status in ('claimed','sending') and accepted_at is null and failed_at is null))
);
create index smyl_gmail_deliveries_tenant_date on public.smyl_gmail_deliveries(tenant_id,created_at desc);
create index smyl_gmail_deliveries_share_date on public.smyl_gmail_deliveries(share_id,created_at desc);

alter table public.smyl_gmail_oauth_states enable row level security;
alter table public.smyl_gmail_connections enable row level security;
alter table public.smyl_gmail_deliveries enable row level security;
revoke all on public.smyl_gmail_oauth_states,public.smyl_gmail_connections,public.smyl_gmail_deliveries from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.smyl_gmail_oauth_states to service_role;
grant select,insert,update on public.smyl_gmail_connections,public.smyl_gmail_deliveries to service_role;

create function public.smyl_gmail_claim_delivery(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_id uuid,
  p_share_id uuid,
  p_token_hash text,
  p_consent_confirmed boolean
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  existing public.smyl_gmail_deliveries;
  connection public.smyl_gmail_connections;
  share public.smyl_portal_shares;
  patient public.camila_pacientes;
  include_budget boolean;
  proposal_id uuid;
  proposal_revision integer;
  stamp timestamptz:=clock_timestamp();
begin
  if p_actor_id is null or p_tenant_id is null or p_actor_id is distinct from p_tenant_id
    or p_id is null or p_share_id is null or p_consent_confirmed is distinct from true
    or coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from public.camila_tenants t where t.id=p_tenant_id and t.activo)
    or not exists(select 1 from public.camila_usuarios u where u.id=p_actor_id and u.tenant_id=p_tenant_id and u.rol='dueño' and u.activo)
  then raise exception 'Gmail delivery denied' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text,41));
  select * into existing from public.smyl_gmail_deliveries where id=p_id for update;
  if found then
    if existing.tenant_id is distinct from p_tenant_id or existing.actor_id is distinct from p_actor_id or existing.share_id is distinct from p_share_id then
      raise exception 'Idempotency identity mismatch' using errcode='42501';
    end if;
    return jsonb_build_object('id',existing.id,'status',existing.status,'should_send',existing.status='claimed',
      'accepted_at',existing.accepted_at,'failed_at',existing.failed_at,'error_code',existing.error_code);
  end if;

  select * into connection from public.smyl_gmail_connections where tenant_id=p_tenant_id for update;
  if not found or connection.status<>'active' or connection.sender_email<>'apps@smyldesign.ai' or connection.refresh_token_ciphertext is null then
    raise exception 'Gmail reconnect required' using errcode='PT412';
  end if;
  select * into share from public.smyl_portal_shares where id=p_share_id and tenant_id=p_tenant_id for update;
  if not found or share.revoked_at is not null or share.expires_at<=stamp or share.token_hash<>p_token_hash
    or share.selection->'approved' is distinct from 'true'::jsonb or share.approved_by is null
    or not exists(select 1 from public.smyl_portal_activation a where a.tenant_id=p_tenant_id and a.enabled)
    or not exists(select 1 from public.smyl_case_activation a where a.tenant_id=p_tenant_id and a.enabled)
  then raise exception 'Approved mySmyl access required' using errcode='PT412'; end if;

  if not exists(select 1 from public.smyl_clinical_plans p where p.patient_id=share.patient_id and p.tenant_id=share.tenant_id
    and p.status='reviewed' and to_jsonb(p.revision)=share.selection->'plan_revision')
    or (exists(select 1 from jsonb_array_elements(share.selection->'observations') x where x->>'source'='photo')
      and not exists(select 1 from public.smyl_photo_reviews p where p.case_id=share.case_id and to_jsonb(p.revision)=share.selection->'photo_revision'))
    or (exists(select 1 from jsonb_array_elements(share.selection->'observations') x where x->>'source'='manual')
      and not exists(select 1 from public.smyl_dental_records d where d.patient_id=share.patient_id and to_jsonb(d.revision)=share.selection->'dental_revision'))
  then raise exception 'mySmyl source changed' using errcode='PT409'; end if;

  include_budget:=coalesce((share.selection->>'include_budget')::boolean,false);
  if include_budget then
    begin
      proposal_id:=(share.selection->>'proposal_id')::uuid;
      proposal_revision:=(share.selection->>'proposal_revision')::integer;
    exception when others then
      raise exception 'Approved budget required' using errcode='PT412';
    end;
    if not (share.document ? 'budget') or not exists(select 1 from public.smyl_proposals q where q.id=proposal_id
      and q.tenant_id=share.tenant_id and q.patient_id=share.patient_id and q.status='approved'
      and q.revision=proposal_revision and q.plan_revision=(share.selection->>'plan_revision')::integer
      and (q.document->>'valid_until')::date>=(stamp at time zone 'America/Mexico_City')::date)
    then raise exception 'Approved budget required' using errcode='PT412'; end if;
  else
    proposal_id:=null;proposal_revision:=null;
    if share.document ? 'budget' then raise exception 'Unexpected budget' using errcode='PT412'; end if;
  end if;

  select * into patient from public.camila_pacientes where tenant_id=share.tenant_id and id=share.patient_id;
  if not found or length(trim(patient.email)) not between 3 and 254 or patient.email ~ '[\r\n]'
    or lower(trim(patient.email)) !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  then raise exception 'Valid patient email required' using errcode='22023'; end if;

  if (select count(*) from public.smyl_gmail_deliveries where tenant_id=p_tenant_id and created_at>stamp-interval '1 hour')>=10
    or (select count(*) from public.smyl_gmail_deliveries where tenant_id=p_tenant_id and created_at>stamp-interval '1 day')>=50
    or (select count(*) from public.smyl_gmail_deliveries where share_id=p_share_id and created_at>stamp-interval '1 day')>=3
  then raise exception 'Gmail delivery limit reached' using errcode='PT429'; end if;

  insert into public.smyl_gmail_deliveries(id,tenant_id,actor_id,patient_id,case_id,share_id,share_version,plan_revision,
    proposal_id,proposal_revision,include_budget,consent_confirmed_at,status)
  values(p_id,p_tenant_id,p_actor_id,share.patient_id,share.case_id,share.id,share.version,(share.selection->>'plan_revision')::integer,
    proposal_id,proposal_revision,include_budget,stamp,'claimed');
  return jsonb_build_object('id',p_id,'status','claimed','should_send',true,'recipient_email',lower(trim(patient.email)),
    'sender_email',connection.sender_email,'refresh_token_ciphertext',connection.refresh_token_ciphertext);
end;
$$;

create function public.smyl_gmail_begin_delivery(p_id uuid,p_tenant_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.smyl_gmail_deliveries set status='sending',attempted_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_id and tenant_id=p_tenant_id and status='claimed';
  return found;
end;
$$;

create function public.smyl_gmail_finish_delivery(
  p_id uuid,p_tenant_id uuid,p_status text,p_message_id text default null,p_thread_id text default null,p_error_code text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.smyl_gmail_deliveries;stamp timestamptz:=clock_timestamp();
begin
  if p_status not in ('accepted','failed','uncertain')
    or (p_status='accepted' and (coalesce(p_message_id,'')='' or p_error_code is not null))
    or (p_status<>'accepted' and coalesce(p_error_code,'') not in ('oauth_revoked','sender_mismatch','gmail_rejected','gmail_rate_limited','provider_unavailable','request_uncertain','invalid_recipient','access_expired'))
    or length(coalesce(p_message_id,''))>255 or length(coalesce(p_thread_id,''))>255
  then raise exception 'Invalid Gmail result' using errcode='22023'; end if;
  update public.smyl_gmail_deliveries set status=p_status,provider_message_id=p_message_id,provider_thread_id=p_thread_id,error_code=p_error_code,
    accepted_at=case when p_status='accepted' then stamp end,failed_at=case when p_status<>'accepted' then stamp end,updated_at=stamp
  where id=p_id and tenant_id=p_tenant_id and status in ('claimed','sending') returning * into result;
  if not found then select * into result from public.smyl_gmail_deliveries where id=p_id and tenant_id=p_tenant_id;end if;
  if not found then raise exception 'Gmail delivery not found' using errcode='42501';end if;
  return jsonb_build_object('id',result.id,'status',result.status,'accepted_at',result.accepted_at,'failed_at',result.failed_at,'error_code',result.error_code);
end;
$$;

revoke all on function public.smyl_gmail_claim_delivery(uuid,uuid,uuid,uuid,text,boolean),
  public.smyl_gmail_begin_delivery(uuid,uuid),
  public.smyl_gmail_finish_delivery(uuid,uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.smyl_gmail_claim_delivery(uuid,uuid,uuid,uuid,text,boolean),
  public.smyl_gmail_begin_delivery(uuid,uuid),
  public.smyl_gmail_finish_delivery(uuid,uuid,text,text,text,text)
  to service_role;

comment on table public.smyl_gmail_connections is 'Encrypted refresh-token envelope only. gmail.send for apps@smyldesign.ai; never readable by browser roles.';
comment on table public.smyl_gmail_deliveries is 'Audits provider acceptance, not final delivery or reading. No message body, portal token, PIN, recipient address, images or clinical document is stored.';
commit;
