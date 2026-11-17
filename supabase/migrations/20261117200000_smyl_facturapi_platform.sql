-- SMYL · Facturapi como plataforma: una organización de Facturapi por clínica, CSD y producción por clínica.
-- Aditiva sobre 20261014020000_smyl_facturapi_sandbox.sql. Las llaves siguen cifradas y fuera del alcance del navegador.
begin;

-- Permite producción y distingue «cuenta propia» (la clínica trae su llave) de «plataforma» (SMYL crea la organización).
alter table public.smyl_facturapi_connections drop constraint if exists smyl_facturapi_connections_environment_check;
alter table public.smyl_facturapi_connections
  add column if not exists mode text not null default 'own_key',
  add column if not exists csd_valid_until timestamptz,
  add column if not exists csd_serial text,
  add column if not exists pending_steps jsonb not null default '[]'::jsonb,
  add column if not exists production_ready boolean not null default false,
  add column if not exists live_secret_ciphertext text,
  add column if not exists live_secret_iv text,
  add column if not exists live_key_fingerprint text,
  add column if not exists live_enabled_at timestamptz,
  add column if not exists live_enabled_by uuid references auth.users(id);

alter table public.smyl_facturapi_connections
  add constraint smyl_facturapi_connections_environment_check check(environment in ('test','live')),
  add constraint smyl_facturapi_connections_mode_check check(mode in ('own_key','platform')),
  add constraint smyl_facturapi_connections_steps_check check(jsonb_typeof(pending_steps)='array'),
  add constraint smyl_facturapi_connections_live_fp_check check(live_key_fingerprint is null or live_key_fingerprint ~ '^[A-F0-9]{12}$'),
  -- Solo se puede operar en producción con una llave live guardada y una cuenta de plataforma lista.
  add constraint smyl_facturapi_connections_live_check check(
    environment='test'
    or (mode='platform' and production_ready and live_secret_ciphertext is not null and live_secret_iv is not null
        and live_enabled_at is not null and live_enabled_by is not null)
  );

-- Nuevas acciones de auditoría (organización creada, CSD, producción).
alter table public.smyl_facturapi_connection_events drop constraint if exists smyl_facturapi_connection_events_action_check;
alter table public.smyl_facturapi_connection_events
  add constraint smyl_facturapi_connection_events_action_check check(action in (
    'connected','verified','disconnected','organization_created','csd_uploaded','csd_removed','went_live','went_test'));

create index if not exists smyl_facturapi_events_action_idx
  on public.smyl_facturapi_connection_events(tenant_id,action,status,created_at desc);

-- El reporte de preparación ya no exige «sandbox»: basta con una conexión activa (pruebas o producción).
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
    jsonb_build_object('id','sandbox','label','Facturapi conectado','passed',coalesce(v_connection.status,'')='connected'),
    jsonb_build_object('id','policy','label','Política fiscal revisada con contador','passed',v_pac.fiscal_policy_reviewed_at is not null)
  );
  return jsonb_build_object('generated_at',now(),'contains_phi',false,'ready',not exists(select 1 from jsonb_array_elements(v_checks) x where not (x->>'passed')::boolean),'checks',v_checks,'provider_name',coalesce(v_pac.provider_name,''));
end $$;

comment on column public.smyl_facturapi_connections.mode is 'own_key: la clínica trae su llave de Facturapi. platform: SMYL crea la organización con la User Secret Key de la plataforma.';
comment on column public.smyl_facturapi_connections.live_secret_ciphertext is 'Server-only encrypted Facturapi live key. Never selectable by browser roles (the table grants nothing to them).';
commit;
