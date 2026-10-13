-- mySmyl: additive, explicitly approved snapshots and a private request inbox.
-- Activation remains OFF until real Auth/REST/Storage/Edge checks are complete.
begin;
create table public.smyl_portal_activation(tenant_id uuid primary key references public.camila_tenants(id),enabled boolean not null default false);
create table public.smyl_portal_shares(
 id uuid primary key,tenant_id uuid not null,patient_id uuid not null,case_id uuid not null references public.smyl_patient_case_archive(id),
 version integer not null,document jsonb not null,selection jsonb not null,assets jsonb not null,
 token_hash text not null,code_hash text not null,approved_by uuid not null references auth.users(id),approved_at timestamptz not null,
 expires_at timestamptz not null,revoked_at timestamptz,failed_attempts integer not null default 0,locked_until timestamptz,
 unique(case_id,version),foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
create table public.smyl_portal_sessions(
 share_id uuid not null references public.smyl_portal_shares(id),secret_hash text not null,expires_at timestamptz not null,
 primary key(share_id,secret_hash)
);
create table public.smyl_portal_requests(
 id uuid primary key,share_id uuid not null references public.smyl_portal_shares(id),tenant_id uuid not null,patient_id uuid not null,
 kind text not null check(kind in ('question','appointment')),message text not null check(length(message) between 1 and 1000),
 state text not null default 'new' check(state in ('new','contacted','closed')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
create index smyl_portal_inbox on public.smyl_portal_requests(tenant_id,patient_id,created_at desc);
create index smyl_portal_case_links on public.smyl_portal_shares(tenant_id,case_id,version desc);
alter table public.smyl_portal_activation enable row level security;
alter table public.smyl_portal_shares enable row level security;
alter table public.smyl_portal_sessions enable row level security;
alter table public.smyl_portal_requests enable row level security;
revoke all on public.smyl_portal_activation,public.smyl_portal_shares,public.smyl_portal_sessions,public.smyl_portal_requests from public,anon,authenticated,service_role;
grant select(id,tenant_id,patient_id,case_id,version,document,approved_at,expires_at,revoked_at) on public.smyl_portal_shares to authenticated;
grant select on public.smyl_portal_requests to authenticated;
create policy portal_share_owner on public.smyl_portal_shares for select to authenticated using(tenant_id=(select auth.uid()) and (select public.smyl_case_owner()));
create policy portal_request_owner on public.smyl_portal_requests for select to authenticated using(tenant_id=(select auth.uid()) and (select public.smyl_case_owner()));

create function public.smyl_portal_capabilities() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema',1,'tenant_id',auth.uid(),'enabled',public.smyl_case_owner() and exists(select 1 from public.smyl_portal_activation where tenant_id=auth.uid() and enabled));
$$;
create function public.smyl_portal_sources(p_case_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.smyl_patient_case_archive;p public.smyl_clinical_plans;cl public.camila_tenants;d public.smyl_dental_records;r public.smyl_photo_reviews;items jsonb;
begin
 if not public.smyl_case_owner() then raise exception 'Access denied' using errcode='42501';end if;
 select * into c from public.smyl_patient_case_archive where id=p_case_id and tenant_id=auth.uid();
 if not found then raise exception 'Case unavailable' using errcode='42501';end if;
 select * into p from public.smyl_clinical_plans where patient_id=c.patient_id and tenant_id=c.tenant_id;
 if p.status is distinct from 'reviewed' then raise exception 'Review plan first' using errcode='PT412';end if;
 select * into cl from public.camila_tenants where id=c.tenant_id;
 select * into d from public.smyl_dental_records where patient_id=c.patient_id and tenant_id=c.tenant_id;
 select * into r from public.smyl_photo_reviews where case_id=c.id and tenant_id=c.tenant_id;
 select coalesce(jsonb_agg(x),'[]') into items from (
  select jsonb_build_object('source','photo','id',v->>'id','tooth',v->>'tooth','text',v->>'text') x from jsonb_array_elements(coalesce(r.document->'items','[]')) v where v->>'state'='confirmed'
  union all
  select jsonb_build_object('source','manual','id',key,'tooth',key,'text',value->>'observation') from jsonb_each(coalesce(d.document->'teeth','{}')) where length(trim(coalesce(value->>'observation','')))>0
 ) s;
 return jsonb_build_object('schema',1,'case_id',c.id,'patient_id',c.patient_id,'tenant_id',c.tenant_id,
 'clinic',jsonb_build_object('name',left(coalesce(nullif(cl.config->>'consultorio',''),cl.nombre,'Clínica dental'),150),'professional',left(coalesce(cl.config->>'doctor',''),150)),
 'patient_name',(select concat_ws(' ',nombre,apellido) from public.camila_pacientes where id=c.patient_id and tenant_id=c.tenant_id),
 'plan_revision',p.revision,'photo_revision',coalesce(r.revision,0),'dental_revision',coalesce(d.revision,0),
 'summary',p.document->>'assessment','steps',(select jsonb_agg(jsonb_build_object('title',v->>'name','text',v->>'area')) from jsonb_array_elements(p.document->'treatments') v),
 'observations',items,'views',(select jsonb_agg(v->'view') from jsonb_array_elements(c.document->'views') v where jsonb_typeof(v->'result')='object'),
 'proposals',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'revision',q.revision,'title',q.document->>'title','items',q.document->'items','total_cents',q.total_cents,'terms',q.document->>'terms','valid_until',q.document->>'valid_until')),'[]') from public.smyl_proposals q where q.tenant_id=c.tenant_id and q.patient_id=c.patient_id and q.status='approved' and q.plan_revision=p.revision and (q.document->>'valid_until')::date>=(now() at time zone 'America/Mexico_City')::date));
end;$$;

create function public.smyl_portal_publish(p_id uuid,p_case_id uuid,p_selection jsonb,p_token_hash text,p_code_hash text,p_days integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.smyl_patient_case_archive;old public.smyl_portal_shares;s jsonb;v jsonb;o jsonb;b jsonb;a jsonb:='[]';doc jsonb;obs jsonb:='[]';selected text[]:=array[]::text[];keys text[]:=array[]::text[];stamp timestamptz:=clock_timestamp();ver integer;
begin
 if (public.smyl_portal_capabilities()->>'enabled')::boolean is distinct from true then raise exception 'Portal disabled' using errcode='42501';end if;
 if p_id is null or p_case_id is null or p_days is null or p_days not in (1,7,14) or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' or coalesce(p_code_hash,'')!~'^[a-f0-9]{64}$' then raise exception 'Invalid access' using errcode='22023';end if;
 select * into c from public.smyl_patient_case_archive where id=p_case_id and tenant_id=auth.uid();
 if not found then raise exception 'Case unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.patient_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended(c.id::text,19));
 perform pg_advisory_xact_lock(hashtextextended(c.patient_id::text,13));
 perform pg_advisory_xact_lock(hashtextextended(c.id::text,73));
 select * into old from public.smyl_portal_shares where id=p_id;
 if found then
  if old.tenant_id=auth.uid() and old.case_id=p_case_id and old.selection=p_selection and old.token_hash=p_token_hash and old.code_hash=p_code_hash and old.expires_at=old.approved_at+make_interval(days=>p_days) then return jsonb_build_object('id',old.id,'version',old.version,'approved_at',old.approved_at,'expires_at',old.expires_at,'revoked_at',old.revoked_at);end if;
  raise exception 'Share conflict' using errcode='PT409';
 end if;
 if p_selection is null or jsonb_typeof(p_selection) is distinct from 'object' or octet_length(p_selection::text)>40000
 or p_selection-array['schema','title','summary','steps','observations','views','plan_revision','photo_revision','dental_revision','proposal_id','proposal_revision','include_budget','approved']<>'{}'
 or not(p_selection ?& array['schema','title','summary','steps','observations','views','plan_revision','photo_revision','dental_revision','proposal_id','proposal_revision','include_budget','approved'])
 or p_selection->'schema' is distinct from '1'::jsonb or p_selection->'approved' is distinct from 'true'::jsonb
 or jsonb_typeof(p_selection->'include_budget') is distinct from 'boolean'
 or jsonb_typeof(p_selection->'title') is distinct from 'string' or length(trim(p_selection->>'title')) not between 1 and 150
 or jsonb_typeof(p_selection->'summary') is distinct from 'string' or length(trim(p_selection->>'summary')) not between 1 and 5000
 or jsonb_typeof(p_selection->'steps') is distinct from 'array' or jsonb_typeof(p_selection->'observations') is distinct from 'array' or jsonb_typeof(p_selection->'views') is distinct from 'array'
 then raise exception 'Invalid selection' using errcode='22023';end if;
 if jsonb_array_length(p_selection->'steps') not between 1 and 20 or jsonb_array_length(p_selection->'observations')>64 or jsonb_array_length(p_selection->'views') not between 1 and 8 then raise exception 'Invalid size' using errcode='22023';end if;
 s:=public.smyl_portal_sources(c.id);
 if p_selection->'plan_revision' is distinct from s->'plan_revision' or p_selection->'photo_revision' is distinct from s->'photo_revision' or p_selection->'dental_revision' is distinct from s->'dental_revision' then raise exception 'Sources changed' using errcode='PT409';end if;
 for v in select value from jsonb_array_elements(p_selection->'steps') loop
  if jsonb_typeof(v) is distinct from 'object' or v-array['title','text']<>'{}' or jsonb_typeof(v->'title') is distinct from 'string' or length(trim(v->>'title')) not between 1 and 200 or jsonb_typeof(v->'text') is distinct from 'string' or length(v->>'text')>1000 then raise exception 'Invalid step' using errcode='22023';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_selection->'observations') loop
  if jsonb_typeof(v) is distinct from 'object' or v-array['source','id','tooth','text']<>'{}' or jsonb_typeof(v->'text') is distinct from 'string' or length(trim(v->>'text')) not between 1 and 600 or ((v->>'source')||':'||(v->>'id'))=any(keys) then raise exception 'Invalid observation' using errcode='22023';end if;
  if not exists(select 1 from jsonb_array_elements(s->'observations') q where q->'source'=v->'source' and q->'id'=v->'id' and q->'tooth'=v->'tooth') then raise exception 'Unreviewed observation' using errcode='22023';end if;
  keys:=array_append(keys,(v->>'source')||':'||(v->>'id'));obs:=obs||jsonb_build_array(jsonb_build_object('tooth',v->>'tooth','text',trim(v->>'text')));
 end loop;
 for v in select value from jsonb_array_elements(p_selection->'views') loop
  if jsonb_typeof(v) is distinct from 'string' or v#>>'{}'=any(selected) then raise exception 'Invalid view' using errcode='22023';end if;
  select x into o from jsonb_array_elements(c.document->'views') x where x->'view'=v and jsonb_typeof(x->'result')='object';
  if not found then raise exception 'Foreign view' using errcode='22023';end if;
  selected:=array_append(selected,v#>>'{}');a:=a||jsonb_build_array(o);
 end loop;
 doc:=jsonb_build_object('schema',1,'title',trim(p_selection->>'title'),'summary',trim(p_selection->>'summary'),'clinic',s->'clinic','steps',p_selection->'steps','observations',obs);
 if p_selection->'include_budget'='true'::jsonb then
  select q into b from jsonb_array_elements(s->'proposals') q where q->'id'=p_selection->'proposal_id' and q->'revision'=p_selection->'proposal_revision';
  if not found then raise exception 'Budget changed or unavailable' using errcode='PT409';end if;
  doc:=doc||jsonb_build_object('budget',jsonb_build_object('currency','MXN','items',b->'items','total_cents',b->'total_cents','terms',b->>'terms','valid_until',b->>'valid_until'));
 elsif p_selection->'proposal_id'<>'null'::jsonb or p_selection->'proposal_revision'<>'0'::jsonb then raise exception 'Omit budget source' using errcode='22023';
 end if;
 select coalesce(max(version),0)+1 into ver from public.smyl_portal_shares where case_id=c.id;
 -- A newly approved version withdraws older links for this case atomically.
 update public.smyl_portal_shares set revoked_at=stamp where case_id=c.id and revoked_at is null;
 insert into public.smyl_portal_shares(id,tenant_id,patient_id,case_id,version,document,selection,assets,token_hash,code_hash,approved_by,approved_at,expires_at)
 values(p_id,c.tenant_id,c.patient_id,c.id,ver,doc,p_selection,a,p_token_hash,p_code_hash,auth.uid(),stamp,stamp+make_interval(days=>p_days));
 return jsonb_build_object('id',p_id,'version',ver,'approved_at',stamp,'expires_at',stamp+make_interval(days=>p_days),'revoked_at',null);
end;$$;

create function public.smyl_portal_revoke(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.smyl_case_owner() then raise exception 'Access denied' using errcode='42501';end if;
 update public.smyl_portal_shares set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id and tenant_id=auth.uid();
 if not found then raise exception 'Unavailable' using errcode='42501';end if;return true;
end;$$;
create function public.smyl_portal_request_state(p_id uuid,p_state text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.smyl_case_owner() then raise exception 'Access denied' using errcode='42501';end if;
 if p_state is null or p_state not in ('new','contacted','closed') then raise exception 'Invalid state' using errcode='22023';end if;
 update public.smyl_portal_requests set state=p_state,updated_at=clock_timestamp() where id=p_id and tenant_id=auth.uid();
 if not found then raise exception 'Unavailable' using errcode='42501';end if;return true;
end;$$;

-- ONLY the Edge service role can redeem credentials or proxy an image.
-- Failure counters are committed via ordinary JSON denials, not exceptions.
create function public.smyl_portal_access(p_id uuid,p_token_hash text,p_session_hash text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.smyl_portal_shares;r public.smyl_portal_requests;a jsonb;stamp timestamptz:=clock_timestamp();
begin
 select * into s from public.smyl_portal_shares where id=p_id for update;
 if not found or s.token_hash is distinct from p_token_hash or s.revoked_at is not null or s.expires_at<=stamp
 or not exists(select 1 from public.smyl_portal_activation where tenant_id=s.tenant_id and enabled)
 or not exists(select 1 from public.smyl_case_activation where tenant_id=s.tenant_id and enabled)
 or not exists(select 1 from auth.users where id=s.tenant_id and is_anonymous=false)
 then return jsonb_build_object('ok',false);end if;
 -- Editing a source requires a fresh approval; never silently republish it.
 if not exists(select 1 from public.smyl_clinical_plans p where p.patient_id=s.patient_id and p.tenant_id=s.tenant_id and p.status='reviewed' and to_jsonb(p.revision)=s.selection->'plan_revision')
 or (exists(select 1 from jsonb_array_elements(s.selection->'observations') x where x->>'source'='photo') and not exists(select 1 from public.smyl_photo_reviews p where p.case_id=s.case_id and to_jsonb(p.revision)=s.selection->'photo_revision'))
 or (exists(select 1 from jsonb_array_elements(s.selection->'observations') x where x->>'source'='manual') and not exists(select 1 from public.smyl_dental_records d where d.patient_id=s.patient_id and to_jsonb(d.revision)=s.selection->'dental_revision'))
 or (s.document ? 'budget' and not exists(select 1 from public.smyl_proposals q where to_jsonb(q.id)=s.selection->'proposal_id' and q.tenant_id=s.tenant_id and q.patient_id=s.patient_id and q.status='approved' and to_jsonb(q.revision)=s.selection->'proposal_revision' and (q.document->>'valid_until')::date>=(stamp at time zone 'America/Mexico_City')::date))
 then return jsonb_build_object('ok',false);end if;
 if coalesce(p_session_hash,'')!~'^[a-f0-9]{64}$' or p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then return jsonb_build_object('ok',false);end if;
 if p_action='unlock' then
  if s.locked_until>stamp then return jsonb_build_object('ok',false);end if;
  if s.code_hash is distinct from p_payload->>'code_hash' then
   update public.smyl_portal_shares set failed_attempts=(case when locked_until<=stamp then 1 else failed_attempts+1 end),locked_until=(case when locked_until<=stamp then null when failed_attempts>=4 then stamp+interval '15 minutes' else locked_until end) where id=s.id;
   return jsonb_build_object('ok',false);
  end if;
  delete from public.smyl_portal_sessions where share_id=s.id and expires_at<=stamp;
  if not exists(select 1 from public.smyl_portal_sessions where share_id=s.id and secret_hash=p_session_hash) and (select count(*) from public.smyl_portal_sessions where share_id=s.id)>=5 then return jsonb_build_object('ok',false);end if;
  insert into public.smyl_portal_sessions values(s.id,p_session_hash,least(s.expires_at,stamp+interval '15 minutes')) on conflict do nothing;
  update public.smyl_portal_shares set failed_attempts=0,locked_until=null where id=s.id;
  return jsonb_build_object('ok',true,'expires_at',(select expires_at from public.smyl_portal_sessions where share_id=s.id and secret_hash=p_session_hash));
 end if;
 if not exists(select 1 from public.smyl_portal_sessions where share_id=s.id and secret_hash=p_session_hash and expires_at>stamp) then return jsonb_build_object('ok',false);end if;
 if p_action='read' then return jsonb_build_object('ok',true,'document',s.document,'assets',s.assets,'version',s.version,'approved_at',s.approved_at,'expires_at',s.expires_at);end if;
 if p_action='image' then
  if coalesce(p_payload->>'role','') not in ('original','result') then return jsonb_build_object('ok',false);end if;
  select x->(p_payload->>'role') into a from jsonb_array_elements(s.assets) x where x->>'view'=p_payload->>'view';
  if a is null then return jsonb_build_object('ok',false);end if;
  return jsonb_build_object('ok',true,'asset',a);
 end if;
 if p_action='request' then
  if p_payload-array['id','kind','message']<>'{}' or coalesce(p_payload->>'id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or coalesce(p_payload->>'kind','') not in ('question','appointment') or jsonb_typeof(p_payload->'message') is distinct from 'string' or length(trim(p_payload->>'message')) not between 1 and 1000 then return jsonb_build_object('ok',false);end if;
  select * into r from public.smyl_portal_requests where id=(p_payload->>'id')::uuid;
  if found then return jsonb_build_object('ok',r.share_id=s.id and r.kind=p_payload->>'kind' and r.message=trim(p_payload->>'message'),'received',r.share_id=s.id and r.kind=p_payload->>'kind' and r.message=trim(p_payload->>'message'));end if;
  if (select count(*) from public.smyl_portal_requests where share_id=s.id and created_at>stamp-interval '1 day')>=3 or (select count(*) from public.smyl_portal_requests where share_id=s.id)>=10 then return jsonb_build_object('ok',false,'limited',true);end if;
  insert into public.smyl_portal_requests(id,share_id,tenant_id,patient_id,kind,message) values((p_payload->>'id')::uuid,s.id,s.tenant_id,s.patient_id,p_payload->>'kind',trim(p_payload->>'message'));
  return jsonb_build_object('ok',true,'received',true);
 end if;
 return jsonb_build_object('ok',false);
end;$$;
revoke all on function public.smyl_portal_capabilities(),public.smyl_portal_sources(uuid),public.smyl_portal_publish(uuid,uuid,jsonb,text,text,integer),public.smyl_portal_revoke(uuid),public.smyl_portal_request_state(uuid,text),public.smyl_portal_access(uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.smyl_portal_capabilities(),public.smyl_portal_sources(uuid),public.smyl_portal_publish(uuid,uuid,jsonb,text,text,integer),public.smyl_portal_revoke(uuid),public.smyl_portal_request_state(uuid,text) to authenticated;
grant execute on function public.smyl_portal_access(uuid,text,text,text,jsonb) to service_role;
comment on table public.smyl_portal_shares is 'Immutable approved selection. Bearer fragment + separately conveyed code; NOT verified personal identity. Revocation prevents future requests, not retention of previously viewed material.';
commit;
