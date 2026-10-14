-- SMYL · Seguridad etapa 5: monitoreo, exportaciones e incidentes sin PHI.
begin;

create table public.smyl_security_access_fingerprints(
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  fingerprint_sha256 text not null check(fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1 check(seen_count>0),
  primary key(tenant_id,actor_id,fingerprint_sha256)
);
create index smyl_security_access_recent_idx on public.smyl_security_access_fingerprints(tenant_id,actor_id,last_seen_at desc);

create table public.smyl_export_events(
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  export_type text not null check(export_type in ('clinical_pdf','proposal_pdf','receipt_pdf','executive_csv')),
  entity_type text not null check(entity_type in ('smile_analysis','proposal','receipt','executive_report')),
  entity_fingerprint text check(entity_fingerprint is null or entity_fingerprint ~ '^[0-9a-f]{64}$'),
  record_count integer not null default 1 check(record_count between 0 and 100000),
  purpose text not null check(purpose in ('patient_copy','clinical_continuity','administration','fiscal')),
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create index smyl_export_events_tenant_created_idx on public.smyl_export_events(tenant_id,created_at desc);
create index smyl_export_events_actor_created_idx on public.smyl_export_events(tenant_id,actor_id,created_at desc);

create table public.smyl_security_events(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  event_type text not null check(event_type in ('access_fingerprint_velocity','export_volume','rejected_file_volume','file_maintenance_error','legacy_file_review','privilege_change_volume')),
  severity text not null check(severity in ('info','warning','high','critical')),
  source text not null check(source in ('access','exports','files','permissions')),
  fingerprint text not null,
  title text not null check(char_length(title) between 3 and 120),
  summary text not null check(char_length(summary) between 3 and 300),
  evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=2000),
  status text not null default 'open' check(status in ('open','investigating','resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 1 check(occurrence_count>0),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text check(resolution_note is null or char_length(resolution_note) between 8 and 500),
  unique(tenant_id,fingerprint)
);
create index smyl_security_events_open_idx on public.smyl_security_events(tenant_id,severity,last_seen_at desc) where status<>'resolved';

alter table public.smyl_security_access_fingerprints enable row level security;
alter table public.smyl_export_events enable row level security;
alter table public.smyl_security_events enable row level security;
revoke all on public.smyl_security_access_fingerprints from public,anon,authenticated;
revoke all on public.smyl_export_events from public,anon,authenticated;
revoke all on public.smyl_security_events from public,anon,authenticated;

create or replace function public.smyl_actor_has_permission_explicit(p_actor uuid,p_tenant uuid,p_permission text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.camila_tenants t where t.id=p_tenant and t.id=p_actor and t.activo)
  or exists(
    select 1 from public.camila_usuarios u
    join public.smyl_member_roles mr on mr.tenant_id=u.tenant_id and mr.user_id=u.id
    join public.smyl_roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id and r.active
    join public.smyl_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id
    where u.id=p_actor and u.tenant_id=p_tenant and u.activo and rp.permission_key=p_permission
  );
$$;
revoke all on function public.smyl_actor_has_permission_explicit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.smyl_actor_has_permission_explicit(uuid,uuid,text) to service_role;

create or replace function public.smyl_upsert_security_event(
  p_tenant uuid,p_type text,p_severity text,p_source text,p_fingerprint text,
  p_title text,p_summary text,p_evidence jsonb
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_type not in ('access_fingerprint_velocity','export_volume','rejected_file_volume','file_maintenance_error','legacy_file_review','privilege_change_volume')
    or p_severity not in ('info','warning','high','critical') or p_source not in ('access','exports','files','permissions')
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object' or octet_length(p_evidence::text)>2000
  then raise exception 'Invalid security event' using errcode='22023'; end if;
  insert into public.smyl_security_events(tenant_id,event_type,severity,source,fingerprint,title,summary,evidence)
  values(p_tenant,p_type,p_severity,p_source,left(p_fingerprint,180),left(p_title,120),left(p_summary,300),p_evidence)
  on conflict(tenant_id,fingerprint) do update set
    severity=excluded.severity,title=excluded.title,summary=excluded.summary,evidence=excluded.evidence,
    last_seen_at=now(),occurrence_count=public.smyl_security_events.occurrence_count+
      case when public.smyl_security_events.last_seen_at<now()-interval '10 minutes' then 1 else 0 end,
    status=case when public.smyl_security_events.status='resolved' then 'open' else public.smyl_security_events.status end,
    resolved_at=null,resolved_by=null,resolution_note=null;
end;
$$;
revoke all on function public.smyl_upsert_security_event(uuid,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.smyl_upsert_security_event(uuid,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.smyl_observe_security_session(p_tenant uuid,p_actor uuid,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_count integer; v_bucket text;
begin
  if not public.smyl_actor_has_permission_explicit(p_actor,p_tenant,'clinic.read') or p_fingerprint !~ '^[0-9a-f]{64}$'
  then raise exception 'Security access denied' using errcode='42501'; end if;
  insert into public.smyl_security_access_fingerprints(tenant_id,actor_id,fingerprint_sha256)
  values(p_tenant,p_actor,p_fingerprint)
  on conflict(tenant_id,actor_id,fingerprint_sha256) do update set last_seen_at=now(),seen_count=public.smyl_security_access_fingerprints.seen_count+1;
  select count(*) into v_count from public.smyl_security_access_fingerprints
   where tenant_id=p_tenant and actor_id=p_actor and last_seen_at>=now()-interval '24 hours';
  if v_count>=4 then
    v_bucket:=to_char(now() at time zone 'UTC','YYYYMMDD');
    perform public.smyl_upsert_security_event(p_tenant,'access_fingerprint_velocity',case when v_count>=8 then 'high' else 'warning' end,'access',
      'access:'||p_actor::text||':'||v_bucket,'Varios entornos de acceso en 24 horas',
      'Un miembro usó más entornos de acceso de lo habitual. Es una señal para verificar, no una confirmación de intrusión.',
      jsonb_build_object('fingerprints_24h',v_count));
  end if;
  return jsonb_build_object('ok',true,'fingerprints_24h',v_count);
end;
$$;
revoke all on function public.smyl_observe_security_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.smyl_observe_security_session(uuid,uuid,text) to service_role;

create or replace function public.smyl_record_export_server(
  p_tenant uuid,p_actor uuid,p_export_type text,p_entity_type text,p_entity_id text,p_record_count integer,p_purpose text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_permission text; v_count integer; v_bucket text; v_hash text;
begin
  v_permission:=case p_export_type when 'clinical_pdf' then 'clinical.read' when 'proposal_pdf' then 'proposal.read'
    when 'receipt_pdf' then 'finance.read' when 'executive_csv' then 'clinic.read' else null end;
  if v_permission is null or not public.smyl_actor_has_permission_explicit(p_actor,p_tenant,v_permission)
    or p_entity_type not in ('smile_analysis','proposal','receipt','executive_report')
    or p_purpose not in ('patient_copy','clinical_continuity','administration','fiscal')
    or coalesce(p_record_count,0) not between 0 and 100000
  then raise exception 'Export access denied' using errcode='42501'; end if;
  v_hash:=case when nullif(trim(coalesce(p_entity_id,'')),'') is null then null
    else encode(digest(p_tenant::text||':'||left(p_entity_id,200),'sha256'),'hex') end;
  insert into public.smyl_export_events(tenant_id,actor_id,export_type,entity_type,entity_fingerprint,record_count,purpose)
  values(p_tenant,p_actor,p_export_type,p_entity_type,v_hash,coalesce(p_record_count,0),p_purpose);
  select count(*) into v_count from public.smyl_export_events
   where tenant_id=p_tenant and actor_id=p_actor and created_at>=now()-interval '15 minutes';
  if v_count>=5 then
    v_bucket:=to_char(date_trunc('hour',now()) + floor(extract(minute from now())/15)*interval '15 minutes','YYYYMMDDHH24MI');
    perform public.smyl_upsert_security_event(p_tenant,'export_volume',case when v_count>=20 then 'high' else 'warning' end,'exports',
      'exports:'||p_actor::text||':'||v_bucket,'Volumen inusual de exportaciones',
      'Se registraron varias exportaciones en una ventana corta. Confirma que correspondan al trabajo autorizado.',
      jsonb_build_object('exports_15m',v_count));
  end if;
  return jsonb_build_object('ok',true,'recorded_at',now());
end;
$$;
revoke all on function public.smyl_record_export_server(uuid,uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.smyl_record_export_server(uuid,uuid,text,text,text,integer,text) to service_role;

create or replace function public.smyl_refresh_security_signals(p_tenant uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_count integer; v_errors integer; v_started timestamptz; v_bucket text;
begin
  if not public.smyl_actor_has_permission_explicit(p_actor,p_tenant,'audit.read')
  then raise exception 'Security dashboard denied' using errcode='42501'; end if;
  v_bucket:=to_char(now() at time zone 'UTC','YYYYMMDD');
  select count(*) into v_count from public.smyl_file_security where tenant_id=p_tenant and status='rejected' and created_at>=now()-interval '15 minutes';
  if v_count>=3 then perform public.smyl_upsert_security_event(p_tenant,'rejected_file_volume','high','files','rejected-files:'||v_bucket,
    'Varias cargas de archivo fueron rechazadas','El verificador bloqueó varios archivos en una ventana corta. Revisa el origen antes de permitir nuevos intentos.',jsonb_build_object('rejected_15m',v_count)); end if;
  select error_count,last_started_at into v_errors,v_started from public.smyl_file_maintenance_runs where tenant_id=p_tenant;
  if coalesce(v_errors,0)>0 and v_started>=now()-interval '24 hours' then perform public.smyl_upsert_security_event(p_tenant,'file_maintenance_error','warning','files','maintenance:'||coalesce(v_started::date::text,v_bucket),
    'El mantenimiento de archivos reportó errores','La última limpieza o revisión de archivos terminó con errores. Conserva la evidencia y revisa la ejecución.',jsonb_build_object('errors',v_errors)); end if;
  select count(*) into v_count from public.smyl_file_security where tenant_id=p_tenant and status='legacy_review';
  if v_count>0 then perform public.smyl_upsert_security_event(p_tenant,'legacy_file_review','info','files','legacy-review:'||v_bucket,
    'Archivos históricos pendientes de revisión','Hay archivos históricos conservados que requieren una decisión humana; no fueron eliminados.',jsonb_build_object('files',v_count)); end if;
  select count(*) into v_count from public.smyl_audit_events where tenant_id=p_tenant and created_at>=now()-interval '1 hour'
    and entity_type in ('smyl_roles','smyl_role_permissions','smyl_member_roles');
  if v_count>=3 then perform public.smyl_upsert_security_event(p_tenant,'privilege_change_volume','warning','permissions','privileges:'||to_char(date_trunc('hour',now()),'YYYYMMDDHH24'),
    'Varios cambios de acceso en una hora','Se modificaron roles o permisos varias veces. Confirma que la administración del equipo esté autorizada.',jsonb_build_object('changes_1h',v_count)); end if;
end;
$$;
revoke all on function public.smyl_refresh_security_signals(uuid,uuid) from public,anon,authenticated;
grant execute on function public.smyl_refresh_security_signals(uuid,uuid) to service_role;

create or replace function public.smyl_security_dashboard_server(p_tenant uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if not public.smyl_actor_has_permission_explicit(p_actor,p_tenant,'audit.read')
  then raise exception 'Security dashboard denied' using errcode='42501'; end if;
  perform public.smyl_refresh_security_signals(p_tenant,p_actor);
  select jsonb_build_object(
    'generated_at',now(),
    'metrics',jsonb_build_object(
      'open_events',(select count(*) from public.smyl_security_events where tenant_id=p_tenant and status<>'resolved'),
      'high_events',(select count(*) from public.smyl_security_events where tenant_id=p_tenant and status<>'resolved' and severity in ('high','critical')),
      'exports_24h',(select count(*) from public.smyl_export_events where tenant_id=p_tenant and created_at>=now()-interval '24 hours'),
      'exports_7d',(select count(*) from public.smyl_export_events where tenant_id=p_tenant and created_at>=now()-interval '7 days'),
      'access_fingerprints_24h',(select count(*) from public.smyl_security_access_fingerprints where tenant_id=p_tenant and last_seen_at>=now()-interval '24 hours'),
      'audit_events_24h',(select count(*) from public.smyl_audit_events where tenant_id=p_tenant and created_at>=now()-interval '24 hours')
    ),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'event_type',event_type,'severity',severity,'source',source,'title',title,'summary',summary,'evidence',evidence,'status',status,'first_seen_at',first_seen_at,'last_seen_at',last_seen_at,'occurrence_count',occurrence_count,'resolution_note',resolution_note) order by case severity when 'critical' then 1 when 'high' then 2 when 'warning' then 3 else 4 end,last_seen_at desc) from (select * from public.smyl_security_events where tenant_id=p_tenant order by status='resolved',last_seen_at desc limit 30) e),'[]'::jsonb),
    'exports',coalesce((select jsonb_agg(jsonb_build_object('export_type',export_type,'purpose',purpose,'count',total,'last_at',last_at) order by last_at desc) from (select export_type,purpose,count(*) total,max(created_at) last_at from public.smyl_export_events where tenant_id=p_tenant and created_at>=now()-interval '7 days' group by export_type,purpose) x),'[]'::jsonb),
    'maintenance',(select jsonb_build_object('last_started_at',last_started_at,'last_finished_at',last_finished_at,'deleted_count',deleted_count,'rescanned_count',rescanned_count,'review_count',review_count,'error_count',error_count) from public.smyl_file_maintenance_runs where tenant_id=p_tenant)
  ) into result;
  return result;
end;
$$;
revoke all on function public.smyl_security_dashboard_server(uuid,uuid) from public,anon,authenticated;
grant execute on function public.smyl_security_dashboard_server(uuid,uuid) to service_role;

create or replace function public.smyl_update_security_event_server(p_tenant uuid,p_actor uuid,p_event uuid,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare changed public.smyl_security_events;
begin
  if not public.smyl_actor_has_permission_explicit(p_actor,p_tenant,'audit.read') or p_status not in ('investigating','resolved')
    or char_length(trim(coalesce(p_note,''))) not between 8 and 500
  then raise exception 'Security event update denied' using errcode='42501'; end if;
  update public.smyl_security_events set status=p_status,resolution_note=trim(p_note),resolved_by=p_actor,
    resolved_at=case when p_status='resolved' then now() else null end,last_seen_at=now()
    where id=p_event and tenant_id=p_tenant returning * into changed;
  if not found then raise exception 'Security event unavailable' using errcode='P0002'; end if;
  insert into public.smyl_audit_events(tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data)
  values(p_tenant,p_actor,'update','smyl_security_events',p_event::text,null,jsonb_build_object('status',p_status,'note_recorded',true));
  return jsonb_build_object('ok',true,'status',changed.status,'resolved_at',changed.resolved_at);
end;
$$;
revoke all on function public.smyl_update_security_event_server(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.smyl_update_security_event_server(uuid,uuid,uuid,text,text) to service_role;

comment on table public.smyl_export_events is 'Bitácora append-only de exportaciones; conserva huellas, nunca identificadores clínicos en claro.';
comment on table public.smyl_security_events is 'Señales operativas sin PHI; una alerta no equivale por sí sola a una intrusión confirmada.';
commit;
