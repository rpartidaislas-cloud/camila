-- Modalidad elegida por la administración; solicitudes internas y abastecimiento central.
begin;

do $$ declare definition text; begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid='public.smyl_role_permissions'::regclass and conname='smyl_role_permissions_permission_key_check';
  if definition is not null and position('inventory.request' in definition)=0 then
    alter table public.smyl_role_permissions drop constraint smyl_role_permissions_permission_key_check;
    execute 'alter table public.smyl_role_permissions add constraint smyl_role_permissions_permission_key_check '||
      regexp_replace(definition,'\)$',' OR permission_key IN (''inventory.request'',''inventory.central'',''inventory.receive''))');
  end if;
end $$;
do $$ begin
if to_regclass('public.smyl_inventory_purchasing_settings') is null then
insert into public.smyl_role_permissions(tenant_id,role_id,permission_key)
select tenant_id,role_id,'inventory.request' from public.smyl_role_permissions where permission_key='inventory.manage' on conflict do nothing;
insert into public.smyl_role_permissions(tenant_id,role_id,permission_key)
select tenant_id,role_id,'inventory.receive' from public.smyl_role_permissions where permission_key='inventory.purchase' on conflict do nothing;

end if;
end $$;

-- Las cuentas nuevas reciben los permisos equivalentes sin cambiar la siembra de otros módulos.
create or replace function public.smyl_seed_purchasing_permissions()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.system_role and new.code in ('propietario','administrador','inventario') then
    insert into public.smyl_role_permissions(tenant_id,role_id,permission_key)
    values(new.tenant_id,new.id,'inventory.request'),(new.tenant_id,new.id,'inventory.receive') on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.smyl_seed_purchasing_permissions() from public,anon,authenticated;
drop trigger if exists smyl_roles_purchasing_defaults on public.smyl_roles;
create trigger smyl_roles_purchasing_defaults after insert on public.smyl_roles for each row execute function public.smyl_seed_purchasing_permissions();

create table if not exists public.smyl_inventory_purchasing_settings(
  tenant_id uuid primary key references public.camila_tenants(id),
  mode text not null check(mode in ('branch','centralized')),
  central_location_id uuid,
  revision integer not null default 1,
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
  foreign key(tenant_id,central_location_id) references public.smyl_inventory_locations(tenant_id,id),
  check((mode='branch' and central_location_id is null) or (mode='centralized' and central_location_id is not null))
);
create or replace function public.smyl_inventory_policy_admin(t uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and public.smyl_has_permission(t,'settings.manage') and public.smyl_has_permission(t,'branches.all');
$$;
create or replace function public.smyl_inventory_central_access(t uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and public.smyl_has_permission(t,'inventory.manage')
    and public.smyl_has_permission(t,'inventory.purchase') and public.smyl_has_permission(t,'branches.all')
    and (public.smyl_inventory_policy_admin(t) or public.smyl_has_permission(t,'inventory.central'));
$$;
create or replace function public.smyl_inventory_request_access(t uuid,b uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.smyl_inventory_central_access(t) or (public.smyl_has_permission(t,'inventory.read')
    and (public.smyl_has_permission(t,'inventory.request') or public.smyl_has_permission(t,'inventory.manage'))
    and public.smyl_branch_access(t,b));
$$;

create table if not exists public.smyl_supply_requests(
  id uuid primary key, tenant_id uuid not null references public.camila_tenants(id),
  reference text not null, branch_id uuid not null, destination_location_id uuid not null, central_location_id uuid not null,
  status text not null default 'draft' check(status in ('draft','submitted','approved','delivered','fulfilled','rejected','cancelled')),
  priority text not null default 'normal' check(priority in ('normal','urgent')), needed_on date,
  notes text not null default '' check(char_length(notes)<=2000), review_note text not null default '' check(char_length(review_note)<=2000),
  revision integer not null default 1, created_by uuid not null references auth.users(id), reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,id),unique(tenant_id,reference),
  foreign key(tenant_id,branch_id) references public.smyl_branches(tenant_id,id),
  foreign key(tenant_id,destination_location_id) references public.smyl_inventory_locations(tenant_id,id),
  foreign key(tenant_id,central_location_id) references public.smyl_inventory_locations(tenant_id,id),
  check(destination_location_id<>central_location_id)
);
create table if not exists public.smyl_supply_request_lines(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,request_id uuid not null,item_id uuid not null,
  requested_quantity numeric(14,3) not null check(requested_quantity>0 and requested_quantity<99999999),
  approved_quantity numeric(14,3) check(approved_quantity>=0 and approved_quantity<=requested_quantity),
  delivered_quantity numeric(14,3) not null default 0 check(delivered_quantity>=0 and delivered_quantity<=approved_quantity),
  unique(tenant_id,id),unique(tenant_id,request_id,item_id),
  foreign key(tenant_id,request_id) references public.smyl_supply_requests(tenant_id,id),
  foreign key(tenant_id,item_id) references public.smyl_inventory_items(tenant_id,id)
);
create table if not exists public.smyl_supply_purchase_allocations(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,batch_id uuid not null,request_line_id uuid not null,
  quantity numeric(14,3) not null check(quantity>0 and quantity<99999999), fulfilled_quantity numeric(14,3) not null default 0,
  purchase_order_line_id uuid, unique(tenant_id,batch_id,request_line_id),check(fulfilled_quantity>=0 and fulfilled_quantity<=quantity),
  foreign key(tenant_id,batch_id) references public.smyl_purchase_batches(tenant_id,id),
  foreign key(tenant_id,request_line_id) references public.smyl_supply_request_lines(tenant_id,id),
  foreign key(tenant_id,purchase_order_line_id) references public.smyl_purchase_order_lines(tenant_id,id)
);
create table if not exists public.smyl_supply_deliveries(
  id uuid primary key,tenant_id uuid not null,request_id uuid not null,movement_id uuid not null,
  lines jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id),confirmed_at timestamptz,
  foreign key(tenant_id,request_id) references public.smyl_supply_requests(tenant_id,id),
  foreign key(tenant_id,movement_id) references public.smyl_inventory_movements(tenant_id,id),
  unique(tenant_id,movement_id), check(jsonb_typeof(lines)='array')
);
create index if not exists smyl_supply_requests_branch_idx on public.smyl_supply_requests(tenant_id,branch_id,status);
create index if not exists smyl_supply_allocations_line_idx on public.smyl_supply_purchase_allocations(tenant_id,request_line_id);

create index if not exists smyl_supply_allocations_order_line_idx on public.smyl_supply_purchase_allocations(tenant_id,purchase_order_line_id);
create index if not exists smyl_supply_deliveries_request_idx on public.smyl_supply_deliveries(tenant_id,request_id);

alter table public.smyl_inventory_purchasing_settings enable row level security;
alter table public.smyl_supply_requests enable row level security;
alter table public.smyl_supply_request_lines enable row level security;
alter table public.smyl_supply_purchase_allocations enable row level security;
alter table public.smyl_supply_deliveries enable row level security;
revoke all on public.smyl_inventory_purchasing_settings,public.smyl_supply_requests,public.smyl_supply_request_lines,
  public.smyl_supply_purchase_allocations,public.smyl_supply_deliveries from public,anon,authenticated;
grant select on public.smyl_inventory_purchasing_settings,public.smyl_supply_requests,public.smyl_supply_request_lines,
  public.smyl_supply_purchase_allocations,public.smyl_supply_deliveries to authenticated;
drop policy if exists smyl_purchasing_settings_read on public.smyl_inventory_purchasing_settings;
create policy smyl_purchasing_settings_read on public.smyl_inventory_purchasing_settings for select to authenticated
  using(public.smyl_has_permission(tenant_id,'inventory.read') or public.smyl_inventory_policy_admin(tenant_id));
drop policy if exists smyl_supply_requests_read on public.smyl_supply_requests;
create policy smyl_supply_requests_read on public.smyl_supply_requests for select to authenticated using(public.smyl_inventory_request_access(tenant_id,branch_id) or (public.smyl_has_permission(tenant_id,'inventory.receive') and public.smyl_has_permission(tenant_id,'inventory.read') and public.smyl_branch_access(tenant_id,branch_id)));
drop policy if exists smyl_supply_request_lines_read on public.smyl_supply_request_lines;
create policy smyl_supply_request_lines_read on public.smyl_supply_request_lines for select to authenticated
  using(exists(select 1 from public.smyl_supply_requests r where r.tenant_id=smyl_supply_request_lines.tenant_id and r.id=request_id));
drop policy if exists smyl_supply_allocations_read on public.smyl_supply_purchase_allocations;
create policy smyl_supply_allocations_read on public.smyl_supply_purchase_allocations for select to authenticated
  using(exists(select 1 from public.smyl_supply_request_lines l where l.tenant_id=smyl_supply_purchase_allocations.tenant_id and l.id=request_line_id));
drop policy if exists smyl_supply_deliveries_read on public.smyl_supply_deliveries;
create policy smyl_supply_deliveries_read on public.smyl_supply_deliveries for select to authenticated
  using(exists(select 1 from public.smyl_supply_requests r where r.tenant_id=smyl_supply_deliveries.tenant_id and r.id=request_id));
-- La sucursal consulta sus órdenes. El centro autorizado puede ver todos los destinos.
drop policy if exists smyl_purchase_orders_branch_read on public.smyl_purchase_orders;
create policy smyl_purchase_orders_branch_read on public.smyl_purchase_orders as restrictive for select to authenticated
  using(exists(select 1 from public.smyl_inventory_locations l where l.tenant_id=smyl_purchase_orders.tenant_id
    and l.id=destination_location_id and public.smyl_branch_access(l.tenant_id,l.branch_id)));
drop policy if exists smyl_purchase_lines_branch_read on public.smyl_purchase_order_lines;
create policy smyl_purchase_lines_branch_read on public.smyl_purchase_order_lines as restrictive for select to authenticated
  using(exists(select 1 from public.smyl_purchase_orders o where o.tenant_id=smyl_purchase_order_lines.tenant_id and o.id=purchase_order_id));

do $$ declare tab text; begin
  foreach tab in array array['smyl_inventory_purchasing_settings','smyl_supply_requests','smyl_supply_request_lines','smyl_supply_purchase_allocations','smyl_supply_deliveries'] loop
    execute format('drop trigger if exists %I on public.%I',tab||'_audit',tab);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.smyl_audit_row()',tab||'_audit',tab);
  end loop;
end $$;

create or replace function public.smyl_inventory_purchasing_context()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); p public.smyl_inventory_purchasing_settings; adm boolean; central boolean;
begin
  if t is null or not (public.smyl_has_permission(t,'inventory.read') or public.smyl_inventory_policy_admin(t)) then
    raise exception using errcode='42501',message='No puedes consultar la modalidad de compras.'; end if;
  select * into p from public.smyl_inventory_purchasing_settings where tenant_id=t;
  adm:=public.smyl_inventory_policy_admin(t);central:=public.smyl_inventory_central_access(t);
  return jsonb_build_object('configured',p.tenant_id is not null,'mode',p.mode,'central_location_id',p.central_location_id,'revision',coalesce(p.revision,0),
    'can_admin',adm,'can_central',central,'can_request',public.smyl_has_permission(t,'inventory.request') or public.smyl_has_permission(t,'inventory.manage'),
    'can_receive',public.smyl_has_permission(t,'inventory.receive'),
    'can_buy',public.smyl_has_permission(t,'inventory.manage') and public.smyl_has_permission(t,'inventory.purchase') and
      (p.mode='branch' or (p.mode='centralized' and central)));
end $$;

create or replace function public.smyl_save_purchasing_settings(p_revision integer,p_mode text,p_central_location_id uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); oldrow public.smyl_inventory_purchasing_settings;
begin
  if not public.smyl_inventory_policy_admin(t) then raise exception using errcode='42501',message='Sólo la administración de la cuenta puede elegir la modalidad.';end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  select * into oldrow from public.smyl_inventory_purchasing_settings where tenant_id=t for update;
  if p_revision is null or coalesce(oldrow.revision,0)<>p_revision then raise exception using errcode='40001',message='La configuración cambió. Actualiza antes de guardar.';end if;
  if p_mode is null or p_mode not in ('branch','centralized') or (p_mode='branch' and p_central_location_id is not null)
    or (p_mode='centralized' and not exists(select 1 from public.smyl_inventory_locations where tenant_id=t and id=p_central_location_id and active
      and public.smyl_branch_access(t,branch_id))) then raise exception using errcode='22023',message='Elige la modalidad y un almacén central activo cuando corresponda.';end if;
  if oldrow.tenant_id is not null and (oldrow.mode<>p_mode or oldrow.central_location_id is distinct from p_central_location_id)
    and exists(select 1 from public.smyl_supply_requests where tenant_id=t and status in ('draft','submitted','approved','delivered')) then
    raise exception using errcode='23514',message='Resuelve o cancela las solicitudes pendientes antes de cambiar de modalidad o centro.';end if;
  insert into public.smyl_inventory_purchasing_settings(tenant_id,mode,central_location_id,updated_by)
    values(t,p_mode,p_central_location_id,auth.uid()) on conflict(tenant_id) do update
    set mode=excluded.mode,central_location_id=excluded.central_location_id,revision=smyl_inventory_purchasing_settings.revision+1,updated_by=auth.uid(),updated_at=now();
end $$;

-- Se verifica también en los puntos anteriores de creación: cambiar el cliente no evita la política.
create or replace function public.smyl_inventory_purchasing_policy_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.smyl_inventory_purchasing_settings;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':inventory',0));
  if tg_table_name='smyl_inventory_locations' then
    if (not new.active or new.branch_id is distinct from old.branch_id) and exists(select 1 from public.smyl_supply_requests
      where tenant_id=new.tenant_id and (destination_location_id=new.id or central_location_id=new.id) and status in ('draft','submitted','approved','delivered')) then
      raise exception using errcode='23514',message='Resuelve las solicitudes pendientes de este almacén antes de desactivarlo o cambiarlo de sucursal.';end if;
    if (not new.active or new.branch_id is distinct from old.branch_id) and exists(select 1 from public.smyl_inventory_purchasing_settings
      where tenant_id=new.tenant_id and central_location_id=new.id) then
      raise exception using errcode='23514',message='Configura otro almacén central antes de desactivar o cambiar éste de sucursal.';end if;
    return new;
  end if;
  if tg_table_name='smyl_purchase_orders' then
  if auth.uid() is not null and not exists(select 1 from public.smyl_inventory_locations
    where tenant_id=new.tenant_id and id=new.destination_location_id and public.smyl_branch_access(new.tenant_id,branch_id)) then
    raise exception using errcode='42501',message='No tienes acceso a la sucursal de esta orden.';end if;
  end if;
  if tg_op='UPDATE' and tg_table_name='smyl_purchase_orders' then
    if new.status='cancelled' and old.status<>'cancelled' and exists(select 1 from public.smyl_purchase_batches where tenant_id=old.tenant_id and id=old.batch_id and mode='consolidated')
      and not public.smyl_inventory_central_access(new.tenant_id) then raise exception using errcode='42501',message='Sólo el centro puede cancelar una compra centralizada.';end if;
    return new;
  end if;
  if tg_op='UPDATE' and tg_table_name='smyl_purchase_batches' and new.status='cancelled' then
    if old.mode='consolidated' and not public.smyl_inventory_central_access(new.tenant_id) then
      raise exception using errcode='42501',message='Sólo el centro puede cancelar una compra centralizada.';end if;
    return new;
  end if;
  select * into p from public.smyl_inventory_purchasing_settings where tenant_id=new.tenant_id;
  if not found then raise exception using errcode='23514',message='La administración debe habilitar una modalidad de compras.';end if;
  if p.mode='centralized' and not public.smyl_inventory_central_access(new.tenant_id) then
    raise exception using errcode='42501',message='Las compras las realiza el centro. Envía una solicitud de insumos.';end if;
  if tg_table_name='smyl_purchase_batches' then
    if (p.mode='branch' and new.mode<>'branch') or (p.mode='centralized' and new.mode<>'consolidated') then
      raise exception using errcode='23514',message='La modalidad de esta compra no coincide con la configuración de la cuenta.';end if;
    if p.mode='centralized' and exists(select 1 from jsonb_array_elements(new.lines) x where (x->>'destination_location_id')::uuid<>p.central_location_id) then
      raise exception using errcode='23514',message='Las compras centrales deben recibirse en el almacén central configurado.';end if;
  elsif p.mode='centralized' and new.destination_location_id<>p.central_location_id then
    raise exception using errcode='23514',message='La orden debe entregarse en el almacén central configurado.';
  end if;
  return new;
end $$;
drop trigger if exists smyl_purchase_policy on public.smyl_purchase_orders;
create trigger smyl_purchase_policy before insert or update of status on public.smyl_purchase_orders for each row execute function public.smyl_inventory_purchasing_policy_guard();
drop trigger if exists smyl_batch_policy on public.smyl_purchase_batches;
create trigger smyl_batch_policy before insert or update of mode,branch_id,lines,status on public.smyl_purchase_batches for each row execute function public.smyl_inventory_purchasing_policy_guard();
drop trigger if exists smyl_central_location_policy on public.smyl_inventory_locations;
create trigger smyl_central_location_policy before update of active,branch_id on public.smyl_inventory_locations for each row execute function public.smyl_inventory_purchasing_policy_guard();

-- El permiso de recepción se puede retirar sin retirar el de preparar compras.
create or replace function public.smyl_inventory_movement_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null then return new;end if;
  if new.movement_type='reversal' and exists(select 1 from public.smyl_supply_deliveries where tenant_id=new.tenant_id and movement_id=new.reversal_of) then
    raise exception using errcode='23514',message='Esta entrega está vinculada a una solicitud. Conserva su historial y registra una devolución como traslado separado.';end if;
  if new.movement_type in ('waste','adjustment_in','adjustment_out','reversal') and not public.smyl_has_permission(new.tenant_id,'inventory.adjust') then
    raise exception using errcode='42501',message='No tienes permiso para registrar mermas, ajustes o correcciones.';
  elsif new.movement_type='receipt' and not public.smyl_has_permission(new.tenant_id,'inventory.receive') then
    raise exception using errcode='42501',message='No tienes permiso para confirmar recepciones.';end if;
  return new;
end $$;
create or replace function public.smyl_save_supply_request(p_id uuid,p_revision integer,p_document jsonb,p_submit boolean default false)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); p public.smyl_inventory_purchasing_settings; r public.smyl_supply_requests;
  dest uuid:=(p_document->>'destination_location_id')::uuid; b uuid; x record; lines jsonb:=p_document->'lines';
begin
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  select * into p from public.smyl_inventory_purchasing_settings where tenant_id=t;
  if p.mode is distinct from 'centralized' then raise exception using errcode='23514',message='Las solicitudes al centro no están habilitadas.';end if;
  select branch_id into b from public.smyl_inventory_locations where tenant_id=t and id=dest and active;
  if b is null or not public.smyl_inventory_request_access(t,b) then raise exception using errcode='42501',message='No puedes solicitar insumos para esta sucursal.';end if;
  if p_id is null or p_revision is null or p_submit is null or dest=p.central_location_id then raise exception using errcode='22023',message='Selecciona un almacén de sucursal diferente al centro.';end if;
  select * into r from public.smyl_supply_requests where tenant_id=t and id=p_id for update;
  if r.id is not null and not public.smyl_inventory_request_access(t,r.branch_id) then raise exception using errcode='42501',message='No puedes editar esta solicitud.';end if;
  if r.id is not null and r.status='submitted' and p_submit and r.revision=p_revision+1 then return p_id;end if;
  if coalesce(r.revision,0)<>p_revision or (r.id is not null and r.status<>'draft') then raise exception using errcode='40001',message='La solicitud cambió. Actualiza antes de continuar.';end if;
  if lines is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines) not between 1 and 100 then raise exception using errcode='22023',message='Agrega entre 1 y 100 insumos.';end if;
  if exists(select 1 from jsonb_to_recordset(lines) a(item_id uuid,quantity numeric) group by item_id having count(*)>1) then
    raise exception using errcode='22023',message='Combina los materiales repetidos.';end if;
  for x in select * from jsonb_to_recordset(lines) a(item_id uuid,quantity numeric) loop
    if x.quantity is null or round(x.quantity,3)<=0 or x.quantity>=99999999 or not exists(select 1 from public.smyl_inventory_items where tenant_id=t and id=x.item_id and active) then
      raise exception using errcode='22023',message='Revisa los insumos y sus cantidades.';end if;
  end loop;
  insert into public.smyl_supply_requests(id,tenant_id,reference,branch_id,destination_location_id,central_location_id,status,priority,needed_on,notes,created_by)
    values(p_id,t,'SOL-'||to_char(now(),'YYYYMMDD')||'-'||upper(left(p_id::text,8)),b,dest,p.central_location_id,
      case when p_submit then 'submitted' else 'draft' end,coalesce(p_document->>'priority','normal'),(p_document->>'needed_on')::date,coalesce(p_document->>'notes',''),auth.uid())
    on conflict(id) do update set branch_id=excluded.branch_id,destination_location_id=excluded.destination_location_id,status=excluded.status,
      priority=excluded.priority,needed_on=excluded.needed_on,notes=excluded.notes,revision=smyl_supply_requests.revision+1,updated_at=now()
      where smyl_supply_requests.tenant_id=t;
  if not found then raise exception using errcode='42501',message='La solicitud no está disponible.';end if;
  delete from public.smyl_supply_request_lines where tenant_id=t and request_id=p_id;
  insert into public.smyl_supply_request_lines(tenant_id,request_id,item_id,requested_quantity)
    select t,p_id,item_id,quantity from jsonb_to_recordset(lines) a(item_id uuid,quantity numeric);
  return p_id;
end $$;

create or replace function public.smyl_review_supply_request(p_id uuid,p_revision integer,p_lines jsonb,p_note text default '')
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); r public.smyl_supply_requests; x record; n integer; accepted boolean:=false;
begin
  if not public.smyl_inventory_central_access(t) then raise exception using errcode='42501',message='Sólo compras centrales puede revisar solicitudes.';end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  select * into r from public.smyl_supply_requests where tenant_id=t and id=p_id for update;
  if r.id is null or r.status<>'submitted' or r.revision is distinct from p_revision then raise exception using errcode='40001',message='La solicitud cambió. Actualiza antes de revisarla.';end if;
  select count(*) into n from public.smyl_supply_request_lines where tenant_id=t and request_id=p_id;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<>n
    or exists(select 1 from jsonb_to_recordset(p_lines) a(line_id uuid) group by line_id having count(*)>1) then
    raise exception using errcode='22023',message='Revisa todos los renglones una sola vez.';end if;
  for x in select * from jsonb_to_recordset(p_lines) a(line_id uuid,quantity numeric) loop
    x.quantity:=round(x.quantity,3);
    if x.quantity is null or x.quantity<0 or x.quantity>=99999999 or not exists(select 1 from public.smyl_supply_request_lines
      where tenant_id=t and request_id=p_id and id=x.line_id and x.quantity<=requested_quantity) then
      raise exception using errcode='22023',message='La cantidad autorizada debe estar entre cero y lo solicitado.';end if;
    update public.smyl_supply_request_lines set approved_quantity=x.quantity where tenant_id=t and id=x.line_id;
    accepted:=accepted or x.quantity>0;
  end loop;
  if not accepted and char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='Indica el motivo de rechazo.';end if;
  update public.smyl_supply_requests set status=case when accepted then 'approved' else 'rejected' end,review_note=coalesce(p_note,''),
    reviewed_by=auth.uid(),revision=revision+1,updated_at=now() where tenant_id=t and id=p_id;
end $$;

create or replace function public.smyl_supply_committed_quantity(t uuid,l uuid)
returns numeric language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(sum(a.quantity-a.fulfilled_quantity),0) from public.smyl_supply_purchase_allocations a
    join public.smyl_purchase_batches b on b.tenant_id=a.tenant_id and b.id=a.batch_id
    left join public.smyl_purchase_order_lines ol on ol.tenant_id=a.tenant_id and ol.id=a.purchase_order_line_id
    left join public.smyl_purchase_orders o on o.tenant_id=ol.tenant_id and o.id=ol.purchase_order_id
  where a.tenant_id=t and a.request_line_id=l and b.status<>'cancelled' and coalesce(o.status,'ordered')<>'cancelled';
$$;

create or replace function public.smyl_cancel_purchase_batch(p_id uuid,p_revision integer)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); b public.smyl_purchase_batches; o record;
begin
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  select * into b from public.smyl_purchase_batches where tenant_id=t and id=p_id for update;
  if not found or not public.smyl_purchase_batch_access(t,b.branch_id,b.lines) then raise exception using errcode='42501',message='No puedes cancelar esta compra.'; end if;
  if b.status='cancelled' then return; end if;
  if b.revision<>p_revision then raise exception using errcode='40001',message='La compra cambió. Actualiza antes de cancelarla.'; end if;
  for o in select * from public.smyl_purchase_orders where tenant_id=t and batch_id=p_id order by id for update loop
    if o.status in ('partially_received','received') then raise exception using errcode='23514',message='Hay material recibido. Conserva esta compra y registra las correcciones necesarias.'; end if;
    if o.status='ordered' then perform public.smyl_cancel_purchase_order(o.id,o.revision); end if;
  end loop;
  update public.smyl_purchase_batches set status='cancelled',revision=revision+1,updated_at=now() where tenant_id=t and id=p_id;
end $$;

-- Envuelve el guardado existente para conservar los vínculos con solicitudes al editar un borrador.
do $$ begin
  if to_regprocedure('public.smyl_save_purchase_batch_v1(uuid,integer,jsonb,boolean)') is null then
    alter function public.smyl_save_purchase_batch(uuid,integer,jsonb,boolean) rename to smyl_save_purchase_batch_v1;
  end if;
end $$;
revoke all on function public.smyl_save_purchase_batch_v1(uuid,integer,jsonb,boolean) from public,anon,authenticated;
create or replace function public.smyl_save_purchase_batch(p_id uuid,p_revision integer,p_document jsonb,p_issue boolean default false)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); x record; qty numeric; n integer; target uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  for x in select l.item_id,r.central_location_id,sum(a.quantity) as quantity from public.smyl_supply_purchase_allocations a
    join public.smyl_supply_request_lines l on l.tenant_id=a.tenant_id and l.id=a.request_line_id
    join public.smyl_supply_requests r on r.tenant_id=l.tenant_id and r.id=l.request_id
    where a.tenant_id=t and a.batch_id=p_id group by l.item_id,r.central_location_id loop
    select count(*),sum(quantity) into n,qty from jsonb_to_recordset(p_document->'lines') j(item_id uuid,destination_location_id uuid,quantity numeric)
      where j.item_id=x.item_id and j.destination_location_id=x.central_location_id;
    if n<>1 or qty<x.quantity then raise exception using errcode='23514',message='Conserva una línea por insumo y las cantidades vinculadas a solicitudes. Para rehacer la selección, cancela este borrador.';end if;
  end loop;
  perform public.smyl_save_purchase_batch_v1(p_id,p_revision,p_document,p_issue);
  if p_issue then
    for x in select a.id,l.item_id from public.smyl_supply_purchase_allocations a join public.smyl_supply_request_lines l
      on l.tenant_id=a.tenant_id and l.id=a.request_line_id where a.tenant_id=t and a.batch_id=p_id loop
      select ol.id into target from public.smyl_purchase_order_lines ol join public.smyl_purchase_orders o on o.tenant_id=ol.tenant_id and o.id=ol.purchase_order_id
        where o.tenant_id=t and o.batch_id=p_id and ol.item_id=x.item_id;
      update public.smyl_supply_purchase_allocations set purchase_order_line_id=target where tenant_id=t and id=x.id;
    end loop;
  end if;
  return p_id;
end $$;

create or replace function public.smyl_prepare_supply_purchase(p_id uuid,p_request_ids uuid[])
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); p public.smyl_inventory_purchasing_settings; request_line record; qty numeric; draft jsonb; ids integer;
begin
  if not public.smyl_inventory_central_access(t) then raise exception using errcode='42501',message='Sólo compras centrales prepara estas órdenes.';end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  if exists(select 1 from public.smyl_purchase_batches where tenant_id=t and id=p_id) then return p_id;end if;
  select * into p from public.smyl_inventory_purchasing_settings where tenant_id=t;
  if p.mode is distinct from 'centralized' then raise exception using errcode='23514',message='Las compras centrales no están habilitadas.';end if;
  select count(distinct x) into ids from unnest(p_request_ids) x;
  if ids not between 1 and 100 or ids<>(select count(*) from public.smyl_supply_requests where tenant_id=t and id=any(p_request_ids)
    and status='approved' and central_location_id=p.central_location_id) then raise exception using errcode='22023',message='Selecciona solicitudes aprobadas pendientes del centro actual.';end if;
  select jsonb_agg(jsonb_build_object('item_id',item_id,'supplier_id',supplier,'destination_location_id',p.central_location_id,'quantity',amount,'unit_cost',price,'purchase_unit','unit')) into draft
    from (select l.item_id,sp.id supplier,i.reference_cost price,sum(greatest(l.approved_quantity-l.delivered_quantity-public.smyl_supply_committed_quantity(t,l.id),0)) amount
      from public.smyl_supply_request_lines l join public.smyl_inventory_items i on i.tenant_id=l.tenant_id and i.id=l.item_id
      left join public.smyl_inventory_suppliers sp on sp.tenant_id=i.tenant_id and sp.id=i.preferred_supplier_id and sp.active
      where l.tenant_id=t and l.request_id=any(p_request_ids)
      group by l.item_id,sp.id,i.reference_cost having sum(greatest(l.approved_quantity-l.delivered_quantity-public.smyl_supply_committed_quantity(t,l.id),0))>0) pending;
  if draft is null then raise exception using errcode='23514',message='Estas solicitudes ya están atendidas o incluidas en otra compra.';end if;
  perform public.smyl_save_purchase_batch(p_id,0,jsonb_build_object('reference','OC-CENTRAL-'||upper(left(p_id::text,8)),
    'mode','consolidated','branch_id',null,'notes','Abastecimiento de solicitudes de sucursales.','lines',draft),false);
  for request_line in select * from public.smyl_supply_request_lines where tenant_id=t and request_id=any(p_request_ids) loop
    qty:=greatest(request_line.approved_quantity-request_line.delivered_quantity-public.smyl_supply_committed_quantity(t,request_line.id),0);
    if qty>0 then insert into public.smyl_supply_purchase_allocations(tenant_id,batch_id,request_line_id,quantity) values(t,p_id,request_line.id,qty);end if;
  end loop;
  return p_id;
end $$;

create or replace function public.smyl_refresh_supply_request(t uuid,rid uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.smyl_supply_requests set status=case
    when not exists(select 1 from public.smyl_supply_request_lines where tenant_id=t and request_id=rid and delivered_quantity<approved_quantity)
    then case when exists(select 1 from public.smyl_supply_deliveries where tenant_id=t and request_id=rid and confirmed_at is null) then 'delivered' else 'fulfilled' end
    else 'approved' end,revision=revision+1,updated_at=now() where tenant_id=t and id=rid;
end $$;

create or replace function public.smyl_deliver_supply_request(p_id uuid,p_request_id uuid,p_revision integer,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); r public.smyl_supply_requests; x record; l public.smyl_supply_request_lines;
  a record; remaining numeric; available numeric; take numeric; payload jsonb; clean jsonb;
begin
  if not public.smyl_inventory_central_access(t) then raise exception using errcode='42501',message='Sólo el centro puede registrar estas entregas.';end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  if exists(select 1 from public.smyl_supply_deliveries where tenant_id=t and id=p_id and request_id=p_request_id) then return p_id;end if;
  select * into r from public.smyl_supply_requests where tenant_id=t and id=p_request_id for update;
  if r.id is null or r.status<>'approved' or r.revision is distinct from p_revision then raise exception using errcode='40001',message='La solicitud cambió. Actualiza antes de entregar.';end if;
  if p_id is null or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception using errcode='22023',message='Agrega las cantidades realmente entregadas.';end if;
  for x in select * from jsonb_to_recordset(p_lines) j(line_id uuid,quantity numeric,lot_id uuid) loop
    if x.quantity is null or round(x.quantity,3)<=0 or x.quantity>=99999999 or not exists(select 1 from public.smyl_supply_request_lines where tenant_id=t and request_id=p_request_id and id=x.line_id) then
      raise exception using errcode='22023',message='Revisa los materiales y cantidades de la entrega.';end if;
  end loop;
  for x in select line_id,sum(quantity) quantity from jsonb_to_recordset(p_lines) j(line_id uuid,quantity numeric) group by line_id loop
    select * into l from public.smyl_supply_request_lines where tenant_id=t and id=x.line_id;
    if l.delivered_quantity+x.quantity>l.approved_quantity then raise exception using errcode='23514',message='La entrega supera lo autorizado pendiente.';end if;
    remaining:=x.quantity;
    for a in select al.*,ol.received_quantity from public.smyl_supply_purchase_allocations al
      join public.smyl_purchase_batches b on b.tenant_id=al.tenant_id and b.id=al.batch_id
      join public.smyl_purchase_order_lines ol on ol.tenant_id=al.tenant_id and ol.id=al.purchase_order_line_id
      join public.smyl_purchase_orders o on o.tenant_id=ol.tenant_id and o.id=ol.purchase_order_id
      where al.tenant_id=t and al.request_line_id=l.id and b.status='ordered' and o.status<>'cancelled' order by al.id loop
      select a.received_quantity-coalesce(sum(fulfilled_quantity),0) into available from public.smyl_supply_purchase_allocations
        where tenant_id=t and purchase_order_line_id=a.purchase_order_line_id;
      take:=greatest(least(remaining,a.quantity-a.fulfilled_quantity,available),0);
      if take>0 then update public.smyl_supply_purchase_allocations set fulfilled_quantity=fulfilled_quantity+take where tenant_id=t and id=a.id;remaining:=remaining-take;end if;
    end loop;
    if remaining>greatest(l.approved_quantity-l.delivered_quantity-(x.quantity-remaining)-public.smyl_supply_committed_quantity(t,l.id),0) then
      raise exception using errcode='23514',message='Hay cantidades incluidas en una compra pendiente. Recíbela o cancélala antes de surtirlas desde existencias.';end if;
    update public.smyl_supply_request_lines set delivered_quantity=delivered_quantity+x.quantity where tenant_id=t and id=l.id;
  end loop;
  select jsonb_agg(jsonb_build_object('item_id',rl.item_id,'quantity',j.quantity,'lot_id',j.lot_id)),
    jsonb_agg(jsonb_build_object('line_id',rl.id,'item_id',rl.item_id,'quantity',j.quantity,'lot_id',j.lot_id)) into payload,clean
    from jsonb_to_recordset(p_lines) j(line_id uuid,quantity numeric,lot_id uuid)
    join public.smyl_supply_request_lines rl on rl.tenant_id=t and rl.id=j.line_id;
  perform public.smyl_post_inventory_movement(p_id,p_id,'transfer',r.central_location_id,r.destination_location_id,null,null,null,'Entrega de '||r.reference,payload,now());
  insert into public.smyl_supply_deliveries(id,tenant_id,request_id,movement_id,lines,created_by) values(p_id,t,p_request_id,p_id,clean,auth.uid());
  perform public.smyl_refresh_supply_request(t,p_request_id);return p_id;
end $$;

create or replace function public.smyl_confirm_supply_delivery(p_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); d public.smyl_supply_deliveries; b uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  select * into d from public.smyl_supply_deliveries where tenant_id=t and id=p_id for update;
  select branch_id into b from public.smyl_supply_requests where tenant_id=t and id=d.request_id;
  if d.id is null or not public.smyl_has_permission(t,'inventory.receive') or not public.smyl_branch_access(t,b) then
    raise exception using errcode='42501',message='Sólo personal autorizado de la sucursal puede confirmar esta recepción.';end if;
  if d.confirmed_at is not null then return;end if;
  update public.smyl_supply_deliveries set confirmed_at=now(),confirmed_by=auth.uid() where tenant_id=t and id=p_id;
  perform public.smyl_refresh_supply_request(t,d.request_id);
end $$;

create or replace function public.smyl_cancel_supply_request(p_id uuid,p_revision integer)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); r public.smyl_supply_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  select * into r from public.smyl_supply_requests where tenant_id=t and id=p_id for update;
  if r.id is null or not public.smyl_inventory_request_access(t,r.branch_id) then raise exception using errcode='42501',message='No puedes cancelar esta solicitud.';end if;
  if r.status='cancelled' then return;end if;
  if r.revision is distinct from p_revision then raise exception using errcode='40001',message='La solicitud cambió.';end if;
  if r.status not in ('draft','submitted','approved') or (r.status='approved' and not public.smyl_inventory_central_access(t))
    or exists(select 1 from public.smyl_supply_request_lines where tenant_id=t and request_id=p_id and (delivered_quantity>0 or public.smyl_supply_committed_quantity(t,id)>0)) then
    raise exception using errcode='23514',message='Resuelve primero las compras vinculadas. Una solicitud con entregas conserva su historial.';end if;
  update public.smyl_supply_requests set status='cancelled',revision=revision+1,updated_at=now() where tenant_id=t and id=p_id;
end $$;

revoke all on function public.smyl_supply_committed_quantity(uuid,uuid),public.smyl_refresh_supply_request(uuid,uuid),
  public.smyl_inventory_purchasing_policy_guard() from public,anon,authenticated;
revoke all on function public.smyl_inventory_policy_admin(uuid),public.smyl_inventory_central_access(uuid),public.smyl_inventory_request_access(uuid,uuid),
  public.smyl_inventory_purchasing_context(),public.smyl_save_purchasing_settings(integer,text,uuid),public.smyl_save_supply_request(uuid,integer,jsonb,boolean),
  public.smyl_review_supply_request(uuid,integer,jsonb,text),public.smyl_save_purchase_batch(uuid,integer,jsonb,boolean),
  public.smyl_prepare_supply_purchase(uuid,uuid[]),public.smyl_deliver_supply_request(uuid,uuid,integer,jsonb),
  public.smyl_confirm_supply_delivery(uuid),public.smyl_cancel_supply_request(uuid,integer) from public,anon;
grant execute on function public.smyl_inventory_policy_admin(uuid),public.smyl_inventory_central_access(uuid),public.smyl_inventory_request_access(uuid,uuid),
  public.smyl_inventory_purchasing_context(),public.smyl_save_purchasing_settings(integer,text,uuid),public.smyl_save_supply_request(uuid,integer,jsonb,boolean),
  public.smyl_review_supply_request(uuid,integer,jsonb,text),public.smyl_save_purchase_batch(uuid,integer,jsonb,boolean),
  public.smyl_prepare_supply_purchase(uuid,uuid[]),public.smyl_deliver_supply_request(uuid,uuid,integer,jsonb),
  public.smyl_confirm_supply_delivery(uuid),public.smyl_cancel_supply_request(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
