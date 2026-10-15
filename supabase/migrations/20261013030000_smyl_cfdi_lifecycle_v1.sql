-- SMYL · Cierre fiscal previo a PAC: emisor, readiness y cancelación planeada.
-- No almacena certificados ni secretos y no envía, timbra o cancela CFDI.
begin;

create table public.smyl_issuer_fiscal_profiles (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  legal_name text not null check(char_length(btrim(legal_name)) between 2 and 240),
  rfc text not null check(rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  fiscal_regime text not null check(fiscal_regime ~ '^\d{3}$'),
  tax_postal_code text not null check(tax_postal_code ~ '^\d{5}$'),
  invoice_series text not null default 'A' check(invoice_series ~ '^[A-Z0-9-]{1,10}$'),
  fiscal_status text not null default 'pending' check(fiscal_status in ('pending','reviewed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  check(
    (fiscal_status='pending' and reviewed_by is null and reviewed_at is null)
    or (fiscal_status='reviewed' and reviewed_by is not null and reviewed_at is not null)
  )
);

create table public.smyl_cfdi_pac_readiness (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  provider_name text not null default '' check(char_length(provider_name)<=120),
  provider_authorization_checked_at timestamptz,
  sandbox_account_confirmed_at timestamptz,
  fiscal_policy_reviewed_at timestamptz,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.smyl_cfdi_cancellation_plans (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  draft_id uuid not null,
  idempotency_key uuid not null,
  reason_code text not null check(reason_code in ('01','02','03','04')),
  replacement_uuid uuid,
  note text not null default '' check(char_length(note)<=500),
  status text not null default 'planned' check(status in ('planned','submitted','accepted','rejected')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(tenant_id,id),
  unique(tenant_id,idempotency_key),
  foreign key(tenant_id,draft_id) references public.smyl_cfdi_drafts(tenant_id,id) on delete restrict,
  check((reason_code='01' and replacement_uuid is not null) or (reason_code<>'01' and replacement_uuid is null))
);
create unique index smyl_cfdi_one_open_cancel_plan_idx
  on public.smyl_cfdi_cancellation_plans(tenant_id,draft_id)
  where status in ('planned','submitted');

alter table public.smyl_cfdi_drafts
  add column issuer_snapshot jsonb not null default '{}'::jsonb,
  add constraint smyl_cfdi_drafts_issuer_snapshot check(jsonb_typeof(issuer_snapshot)='object');

alter table public.smyl_issuer_fiscal_profiles enable row level security;
alter table public.smyl_cfdi_pac_readiness enable row level security;
alter table public.smyl_cfdi_cancellation_plans enable row level security;
create policy smyl_issuer_fiscal_profiles_read on public.smyl_issuer_fiscal_profiles
  for select to authenticated using(public.smyl_has_permission(tenant_id,'finance.read'));
create policy smyl_cfdi_pac_readiness_read on public.smyl_cfdi_pac_readiness
  for select to authenticated using(public.smyl_has_permission(tenant_id,'finance.read'));
create policy smyl_cfdi_cancellation_plans_read on public.smyl_cfdi_cancellation_plans
  for select to authenticated using(public.smyl_has_permission(tenant_id,'finance.read'));
revoke all on table public.smyl_issuer_fiscal_profiles,public.smyl_cfdi_pac_readiness,public.smyl_cfdi_cancellation_plans from anon,authenticated;
grant select on table public.smyl_issuer_fiscal_profiles,public.smyl_cfdi_pac_readiness,public.smyl_cfdi_cancellation_plans to authenticated;
create trigger smyl_issuer_fiscal_profiles_touch before update on public.smyl_issuer_fiscal_profiles for each row execute function public.smyl_touch_updated_at();
create trigger smyl_cfdi_pac_readiness_touch before update on public.smyl_cfdi_pac_readiness for each row execute function public.smyl_touch_updated_at();
create trigger smyl_issuer_fiscal_profiles_audit after insert or update or delete on public.smyl_issuer_fiscal_profiles for each row execute function public.smyl_audit_row();
create trigger smyl_cfdi_pac_readiness_audit after insert or update or delete on public.smyl_cfdi_pac_readiness for each row execute function public.smyl_audit_row();
create trigger smyl_cfdi_cancellation_plans_audit after insert or update or delete on public.smyl_cfdi_cancellation_plans for each row execute function public.smyl_audit_row();

create function public.smyl_save_issuer_fiscal_profile(
  p_legal_name text,p_rfc text,p_fiscal_regime text,p_tax_postal_code text,p_invoice_series text,p_reviewed boolean
) returns public.smyl_issuer_fiscal_profiles
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_issuer_fiscal_profiles;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para configurar al emisor.'; end if;
  if btrim(coalesce(p_legal_name,''))='' or upper(btrim(coalesce(p_rfc,''))) !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'
    or coalesce(p_fiscal_regime,'') !~ '^\d{3}$' or coalesce(p_tax_postal_code,'') !~ '^\d{5}$'
    or upper(btrim(coalesce(p_invoice_series,''))) !~ '^[A-Z0-9-]{1,10}$'
  then raise exception using errcode='22023',message='Datos fiscales del emisor inválidos.'; end if;
  insert into public.smyl_issuer_fiscal_profiles(tenant_id,legal_name,rfc,fiscal_regime,tax_postal_code,invoice_series,fiscal_status,reviewed_by,reviewed_at,updated_by)
  values(v_tenant,upper(btrim(p_legal_name)),upper(btrim(p_rfc)),p_fiscal_regime,p_tax_postal_code,upper(btrim(p_invoice_series)),
    case when p_reviewed then 'reviewed' else 'pending' end,case when p_reviewed then auth.uid() else null end,case when p_reviewed then now() else null end,auth.uid())
  on conflict(tenant_id) do update set legal_name=excluded.legal_name,rfc=excluded.rfc,fiscal_regime=excluded.fiscal_regime,
    tax_postal_code=excluded.tax_postal_code,invoice_series=excluded.invoice_series,fiscal_status=excluded.fiscal_status,
    reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_by=auth.uid()
  returning * into v_row;
  return v_row;
end $$;

create function public.smyl_set_cfdi_pac_readiness(
  p_provider_name text,p_authorization_checked boolean,p_sandbox_confirmed boolean,p_policy_reviewed boolean
) returns public.smyl_cfdi_pac_readiness
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_cfdi_pac_readiness;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para preparar el PAC.'; end if;
  if char_length(btrim(coalesce(p_provider_name,'')))>120 or ((p_authorization_checked or p_sandbox_confirmed) and char_length(btrim(coalesce(p_provider_name,'')))<2)
  then raise exception using errcode='22023',message='Selecciona un proveedor antes de confirmar su autorización o sandbox.'; end if;
  insert into public.smyl_cfdi_pac_readiness(tenant_id,provider_name,provider_authorization_checked_at,sandbox_account_confirmed_at,fiscal_policy_reviewed_at,updated_by)
  values(v_tenant,btrim(coalesce(p_provider_name,'')),case when p_authorization_checked then now() else null end,
    case when p_sandbox_confirmed then now() else null end,case when p_policy_reviewed then now() else null end,auth.uid())
  on conflict(tenant_id) do update set provider_name=excluded.provider_name,
    provider_authorization_checked_at=case when p_authorization_checked then coalesce(public.smyl_cfdi_pac_readiness.provider_authorization_checked_at,now()) else null end,
    sandbox_account_confirmed_at=case when p_sandbox_confirmed then coalesce(public.smyl_cfdi_pac_readiness.sandbox_account_confirmed_at,now()) else null end,
    fiscal_policy_reviewed_at=case when p_policy_reviewed then coalesce(public.smyl_cfdi_pac_readiness.fiscal_policy_reviewed_at,now()) else null end,updated_by=auth.uid()
  returning * into v_row;
  return v_row;
end $$;

create function public.smyl_cfdi_readiness_report() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_issuer public.smyl_issuer_fiscal_profiles; v_pac public.smyl_cfdi_pac_readiness; v_pending integer; v_checks jsonb;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.read') then raise exception using errcode='42501',message='Sin permiso para revisar preparación fiscal.'; end if;
  select * into v_issuer from public.smyl_issuer_fiscal_profiles where tenant_id=v_tenant;
  select * into v_pac from public.smyl_cfdi_pac_readiness where tenant_id=v_tenant;
  select count(*) into v_pending from public.smyl_services where tenant_id=v_tenant and active and
    (fiscal_status<>'reviewed' or sat_product_service_code is null or sat_unit_code is null or tax_object_code is null);
  v_checks:=jsonb_build_array(
    jsonb_build_object('id','issuer','label','Datos del emisor revisados','passed',coalesce(v_issuer.fiscal_status,'')='reviewed'),
    jsonb_build_object('id','services','label','Servicios activos con claves fiscales revisadas','passed',v_pending=0,'detail',v_pending),
    jsonb_build_object('id','provider','label','PAC seleccionado y autorización SAT comprobada','passed',coalesce(v_pac.provider_name,'')<>'' and v_pac.provider_authorization_checked_at is not null),
    jsonb_build_object('id','sandbox','label','Cuenta sandbox confirmada','passed',v_pac.sandbox_account_confirmed_at is not null),
    jsonb_build_object('id','policy','label','Política fiscal revisada con contador','passed',v_pac.fiscal_policy_reviewed_at is not null)
  );
  return jsonb_build_object('generated_at',now(),'contains_phi',false,'ready',not exists(select 1 from jsonb_array_elements(v_checks) x where not (x->>'passed')::boolean),'checks',v_checks,'provider_name',coalesce(v_pac.provider_name,''));
end $$;

create function public.smyl_prepare_cfdi_draft_v3(p_id uuid,p_idempotency_key uuid,p_payment_id uuid)
returns public.smyl_cfdi_drafts language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_issuer public.smyl_issuer_fiscal_profiles; v_row public.smyl_cfdi_drafts;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para preparar CFDI.'; end if;
  select * into v_issuer from public.smyl_issuer_fiscal_profiles where tenant_id=v_tenant and fiscal_status='reviewed';
  if not found then raise exception using errcode='23514',message='Completa y revisa los datos fiscales del emisor.'; end if;
  v_row:=public.smyl_prepare_cfdi_draft_v2(p_id,p_idempotency_key,p_payment_id);
  if v_row.status<>'draft' and v_row.issuer_snapshot='{}'::jsonb then raise exception using errcode='23514',message='El comprobante ya avanzó sin snapshot de emisor y requiere revisión.'; end if;
  if v_row.issuer_snapshot='{}'::jsonb then
    update public.smyl_cfdi_drafts set issuer_snapshot=jsonb_build_object('legal_name',v_issuer.legal_name,'rfc',v_issuer.rfc,
      'fiscal_regime',v_issuer.fiscal_regime,'tax_postal_code',v_issuer.tax_postal_code,'invoice_series',v_issuer.invoice_series,'fiscal_status',v_issuer.fiscal_status)
    where tenant_id=v_tenant and id=v_row.id returning * into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.smyl_validate_cfdi_draft_sandbox(p_draft_id uuid)
returns public.smyl_cfdi_drafts language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_cfdi_drafts; v_item jsonb; v_errors jsonb:='[]'::jsonb; v_sum numeric(12,2):=0; v_stamp timestamptz:=clock_timestamp();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para validar el borrador.'; end if;
  select * into v_row from public.smyl_cfdi_drafts where tenant_id=v_tenant and id=p_draft_id for update;
  if not found then raise exception using errcode='P0002',message='Borrador no encontrado.'; end if;
  if coalesce(v_row.issuer_snapshot->>'rfc','') !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','issuer_rfc','message','RFC del emisor inválido o pendiente.')); end if;
  if length(trim(coalesce(v_row.issuer_snapshot->>'legal_name','')))<2 then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','issuer_name','message','Falta nombre o razón social del emisor.')); end if;
  if coalesce(v_row.issuer_snapshot->>'tax_postal_code','') !~ '^\d{5}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','issuer_postal','message','Código postal fiscal del emisor inválido.')); end if;
  if coalesce(v_row.issuer_snapshot->>'fiscal_regime','') !~ '^\d{3}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','issuer_regime','message','Régimen fiscal del emisor inválido.')); end if;
  if coalesce(v_row.fiscal_snapshot->>'rfc','') !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','rfc','message','RFC del receptor con formato inválido.')); end if;
  if length(trim(coalesce(v_row.fiscal_snapshot->>'legal_name','')))<2 then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','legal_name','message','Falta nombre o razón social del receptor.')); end if;
  if coalesce(v_row.fiscal_snapshot->>'tax_postal_code','') !~ '^\d{5}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','tax_postal_code','message','Código postal fiscal del receptor inválido.')); end if;
  if coalesce(v_row.fiscal_snapshot->>'fiscal_regime','') !~ '^\d{3}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','fiscal_regime','message','Régimen fiscal del receptor inválido.')); end if;
  if coalesce(v_row.fiscal_snapshot->>'cfdi_use','') !~ '^[A-Z0-9]{3,5}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','cfdi_use','message','Uso CFDI inválido.')); end if;
  if jsonb_array_length(v_row.concepts_snapshot)=0 then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','concepts','message','Faltan conceptos.')); end if;
  for v_item in select value from jsonb_array_elements(v_row.concepts_snapshot) loop
    v_sum:=v_sum+coalesce((v_item->>'amount')::numeric,0);
    if coalesce(v_item->>'fiscal_status','')<>'reviewed' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','concepts','message','Hay un servicio sin revisión fiscal.')); end if;
    if coalesce(v_item->>'product_service_code','') !~ '^\d{8}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','product_service_code','message','ClaveProdServ inválida o pendiente.')); end if;
    if coalesce(v_item->>'unit_code','') !~ '^[A-Z0-9]{1,8}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','unit_code','message','ClaveUnidad inválida o pendiente.')); end if;
    if coalesce(v_item->>'tax_object_code','') !~ '^\d{2}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','tax_object_code','message','ObjetoImp inválido o pendiente.')); end if;
  end loop;
  if v_sum<>(v_row.fiscal_snapshot->>'amount')::numeric then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','total','message','El total no coincide con los conceptos.')); end if;
  update public.smyl_cfdi_drafts set sandbox_status=case when jsonb_array_length(v_errors)=0 then 'passed' else 'blocked' end,
    sandbox_report=jsonb_build_object('validator','smyl_local_cfdi_4_rules_v2','errors',v_errors,'requires_pac_catalog_validation',true,
      'message',case when jsonb_array_length(v_errors)=0 then 'Prevalidación local aprobada; falta validar catálogos y timbrar en PAC sandbox.' else 'Corrige los campos indicados antes de usar un PAC sandbox.' end),
    sandbox_validated_by=auth.uid(),sandbox_validated_at=v_stamp where tenant_id=v_tenant and id=p_draft_id returning * into v_row;
  return v_row;
end $$;

create function public.smyl_plan_cfdi_cancellation(p_id uuid,p_idempotency_key uuid,p_draft_id uuid,p_reason_code text,p_replacement_uuid uuid,p_note text default '')
returns public.smyl_cfdi_cancellation_plans language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_draft public.smyl_cfdi_drafts; v_row public.smyl_cfdi_cancellation_plans;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para preparar cancelaciones.'; end if;
  select * into v_row from public.smyl_cfdi_cancellation_plans where tenant_id=v_tenant and idempotency_key=p_idempotency_key; if found then return v_row; end if;
  select * into v_draft from public.smyl_cfdi_drafts where tenant_id=v_tenant and id=p_draft_id for update;
  if not found or v_draft.status<>'issued' or v_draft.external_uuid is null then raise exception using errcode='23514',message='Solo un CFDI timbrado puede preparar una solicitud de cancelación.'; end if;
  if p_reason_code not in ('01','02','03','04') or (p_reason_code='01' and p_replacement_uuid is null) or (p_reason_code<>'01' and p_replacement_uuid is not null)
  then raise exception using errcode='22023',message='Motivo o folio de sustitución inválido.'; end if;
  insert into public.smyl_cfdi_cancellation_plans(id,tenant_id,draft_id,idempotency_key,reason_code,replacement_uuid,note,created_by)
  values(p_id,v_tenant,p_draft_id,p_idempotency_key,p_reason_code,p_replacement_uuid,btrim(coalesce(p_note,'')),auth.uid()) returning * into v_row;
  return v_row;
exception when unique_violation then
  select * into v_row from public.smyl_cfdi_cancellation_plans where tenant_id=v_tenant and draft_id=p_draft_id and status in ('planned','submitted'); return v_row;
end $$;

revoke all on function public.smyl_save_issuer_fiscal_profile(text,text,text,text,text,boolean),
  public.smyl_set_cfdi_pac_readiness(text,boolean,boolean,boolean),public.smyl_cfdi_readiness_report(),
  public.smyl_prepare_cfdi_draft_v3(uuid,uuid,uuid),public.smyl_plan_cfdi_cancellation(uuid,uuid,uuid,text,uuid,text) from public,anon;
grant execute on function public.smyl_save_issuer_fiscal_profile(text,text,text,text,text,boolean),
  public.smyl_set_cfdi_pac_readiness(text,boolean,boolean,boolean),public.smyl_cfdi_readiness_report(),
  public.smyl_prepare_cfdi_draft_v3(uuid,uuid,uuid),public.smyl_plan_cfdi_cancellation(uuid,uuid,uuid,text,uuid,text) to authenticated;

comment on table public.smyl_cfdi_pac_readiness is 'Manual PAC sandbox readiness only; stores no secrets or certificates.';
comment on table public.smyl_cfdi_cancellation_plans is 'Local cancellation intent; planned does not mean submitted to or accepted by SAT/PAC.';
comment on function public.smyl_plan_cfdi_cancellation(uuid,uuid,uuid,text,uuid,text) is 'Creates a local cancellation plan only. No PAC/SAT transmission.';
commit;
