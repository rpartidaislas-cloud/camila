-- SMYL · Conexión Facturapi sandbox aislada por clínica.
-- Las llaves sólo existen cifradas y nunca se exponen a roles del navegador.
begin;

create table public.smyl_facturapi_connections (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  provider text not null default 'facturapi' check(provider='facturapi'),
  environment text not null default 'test' check(environment='test'),
  organization_id text check(organization_id is null or char_length(organization_id) between 3 and 120),
  organization_name text check(organization_name is null or char_length(organization_name)<=180),
  secret_ciphertext text,
  secret_iv text,
  key_fingerprint text check(key_fingerprint is null or key_fingerprint ~ '^[A-F0-9]{12}$'),
  status text not null default 'disconnected' check(status in ('disconnected','connected','error')),
  connected_at timestamptz,
  last_verified_at timestamptz,
  last_error text check(last_error is null or char_length(last_error)<=500),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  check(
    (status='disconnected' and secret_ciphertext is null and secret_iv is null)
    or (status in ('connected','error') and organization_id is not null and secret_ciphertext is not null and secret_iv is not null)
  )
);

create table public.smyl_facturapi_connection_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  action text not null check(action in ('connected','verified','disconnected')),
  status text not null check(status in ('success','failed')),
  detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
  created_at timestamptz not null default now()
);

alter table public.smyl_facturapi_connections enable row level security;
alter table public.smyl_facturapi_connection_events enable row level security;

-- No role del navegador puede leer la fila que contiene el secreto cifrado.
revoke all on table public.smyl_facturapi_connections from public,anon,authenticated;
revoke all on table public.smyl_facturapi_connection_events from public,anon,authenticated;
grant select on table public.smyl_facturapi_connection_events to authenticated;
create policy smyl_facturapi_events_read on public.smyl_facturapi_connection_events
  for select to authenticated using(public.smyl_has_permission(tenant_id,'finance.manage'));

create index smyl_facturapi_events_tenant_idx on public.smyl_facturapi_connection_events(tenant_id,created_at desc);

create or replace function public.smyl_cfdi_readiness_report() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_issuer public.smyl_issuer_fiscal_profiles;
  v_pac public.smyl_cfdi_pac_readiness; v_connection public.smyl_facturapi_connections;
  v_pending integer; v_checks jsonb;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.read') then raise exception using errcode='42501',message='Sin permiso para revisar preparación fiscal.'; end if;
  select * into v_issuer from public.smyl_issuer_fiscal_profiles where tenant_id=v_tenant;
  select * into v_pac from public.smyl_cfdi_pac_readiness where tenant_id=v_tenant;
  select * into v_connection from public.smyl_facturapi_connections where tenant_id=v_tenant;
  select count(*) into v_pending from public.smyl_services where tenant_id=v_tenant and active and
    (fiscal_status<>'reviewed' or tax_treatment='pending' or sat_product_service_code is null or sat_unit_code is null or tax_object_code is null);
  v_checks:=jsonb_build_array(
    jsonb_build_object('id','issuer','label','Datos del emisor revisados','passed',coalesce(v_issuer.fiscal_status,'')='reviewed'),
    jsonb_build_object('id','services','label','Servicios dentales con política fiscal revisada','passed',v_pending=0,'detail',v_pending),
    jsonb_build_object('id','provider','label','PAC seleccionado y autorización SAT comprobada','passed',coalesce(v_pac.provider_name,'')<>'' and v_pac.provider_authorization_checked_at is not null),
    jsonb_build_object('id','sandbox','label','Facturapi sandbox conectado','passed',coalesce(v_connection.status,'')='connected' and v_connection.environment='test'),
    jsonb_build_object('id','policy','label','Política fiscal revisada con contador','passed',v_pac.fiscal_policy_reviewed_at is not null)
  );
  return jsonb_build_object('generated_at',now(),'contains_phi',false,'ready',not exists(select 1 from jsonb_array_elements(v_checks) x where not (x->>'passed')::boolean),'checks',v_checks,'provider_name',coalesce(v_pac.provider_name,''));
end $$;

comment on table public.smyl_facturapi_connections is 'Server-only encrypted Facturapi test credential, isolated by SMYL tenant. Never selectable by browser roles.';
comment on table public.smyl_facturapi_connection_events is 'Credential lifecycle audit without secret material, patient data or clinical data.';
commit;
