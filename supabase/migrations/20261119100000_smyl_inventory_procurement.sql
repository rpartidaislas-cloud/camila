-- Catálogo de proveedores, kits completos y compras por sede o consolidadas.
-- No modifica movimientos históricos. Los pedidos continúan recibiéndose por almacén.
begin;

alter table public.smyl_inventory_suppliers
  add column if not exists whatsapp_template text not null default '',
  add column if not exists email_template text not null default '',
  add column if not exists email_subject text not null default '';

create table if not exists public.smyl_supplier_items (
  tenant_id uuid not null references public.camila_tenants(id),
  supplier_id uuid not null, item_id uuid not null,
  supplier_sku text not null default '' check(char_length(supplier_sku)<=80),
  unit_cost numeric(14,4) check(unit_cost>=0 and unit_cost<'Infinity'::numeric),
  lead_days integer check(lead_days between 0 and 365),
  updated_at timestamptz not null default now(),
  primary key(tenant_id,supplier_id,item_id),
  foreign key(tenant_id,supplier_id) references public.smyl_inventory_suppliers(tenant_id,id),
  foreign key(tenant_id,item_id) references public.smyl_inventory_items(tenant_id,id)
);
alter table public.smyl_supplier_items enable row level security;
revoke all on public.smyl_supplier_items from public,anon,authenticated;
grant select on public.smyl_supplier_items to authenticated;
drop policy if exists smyl_supplier_items_read on public.smyl_supplier_items;
create policy smyl_supplier_items_read on public.smyl_supplier_items for select to authenticated
  using(public.smyl_has_permission(tenant_id,'inventory.manage'));
insert into public.smyl_supplier_items(tenant_id,supplier_id,item_id,unit_cost)
select tenant_id,preferred_supplier_id,id,reference_cost from public.smyl_inventory_items
where preferred_supplier_id is not null on conflict do nothing;

-- Mantiene asociadas también las altas por CSV y los cambios de proveedor habitual.
-- Cambiar la referencia del insumo no sobreescribe un precio ya acordado con el proveedor.
create or replace function public.smyl_inventory_item_supplier_link()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.preferred_supplier_id is null then return new; end if;
  if tg_op='UPDATE' and new.preferred_supplier_id is not distinct from old.preferred_supplier_id then return new; end if;
  if not exists(select 1 from public.smyl_inventory_suppliers where tenant_id=new.tenant_id and id=new.preferred_supplier_id and active) then
    raise exception using errcode='22023',message='Selecciona un proveedor activo.';
  end if;
  insert into public.smyl_supplier_items(tenant_id,supplier_id,item_id,unit_cost)
    values(new.tenant_id,new.preferred_supplier_id,new.id,new.reference_cost) on conflict do nothing;
  return new;
end $$;
revoke all on function public.smyl_inventory_item_supplier_link() from public,anon,authenticated;
drop trigger if exists smyl_inventory_item_supplier_link on public.smyl_inventory_items;
create trigger smyl_inventory_item_supplier_link after insert or update of preferred_supplier_id on public.smyl_inventory_items
  for each row execute function public.smyl_inventory_item_supplier_link();

create table if not exists public.smyl_purchase_batches (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id),
  reference text not null check(char_length(btrim(reference)) between 1 and 70),
  mode text not null check(mode in ('branch','consolidated')),
  branch_id uuid,
  status text not null default 'draft' check(status in ('draft','ordered','cancelled')),
  expected_on date,
  notes text not null default '' check(char_length(notes)<=2000),
  lines jsonb not null default '[]' check(jsonb_typeof(lines)='array'),
  revision integer not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,reference),
  foreign key(tenant_id,branch_id) references public.smyl_branches(tenant_id,id),
  check((mode='branch' and branch_id is not null) or (mode='consolidated' and branch_id is null))
);
alter table public.smyl_purchase_orders add column if not exists batch_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='smyl_purchase_orders_batch_fk') then
    alter table public.smyl_purchase_orders add constraint smyl_purchase_orders_batch_fk
      foreign key(tenant_id,batch_id) references public.smyl_purchase_batches(tenant_id,id);
  end if;
end $$;
create index if not exists smyl_purchase_orders_batch_idx on public.smyl_purchase_orders(tenant_id,batch_id);

create or replace function public.smyl_purchase_batch_access(p_tenant uuid,p_branch uuid,p_lines jsonb)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.smyl_has_permission(p_tenant,'inventory.manage')
    and public.smyl_has_permission(p_tenant,'inventory.purchase')
    and (p_branch is null or public.smyl_branch_access(p_tenant,p_branch))
    and not exists(select 1 from jsonb_array_elements(p_lines) x
      left join public.smyl_inventory_locations l on l.tenant_id=p_tenant and l.id=(x->>'destination_location_id')::uuid
      where l.id is null or not public.smyl_branch_access(p_tenant,l.branch_id));
$$;
revoke all on function public.smyl_purchase_batch_access(uuid,uuid,jsonb) from public,anon;
grant execute on function public.smyl_purchase_batch_access(uuid,uuid,jsonb) to authenticated;
alter table public.smyl_purchase_batches enable row level security;
revoke all on public.smyl_purchase_batches from public,anon,authenticated;
grant select on public.smyl_purchase_batches to authenticated;
drop policy if exists smyl_purchase_batches_read on public.smyl_purchase_batches;
create policy smyl_purchase_batches_read on public.smyl_purchase_batches for select to authenticated
  using(public.smyl_purchase_batch_access(tenant_id,branch_id,lines));
drop trigger if exists smyl_purchase_batches_audit on public.smyl_purchase_batches;
create trigger smyl_purchase_batches_audit after insert or update or delete on public.smyl_purchase_batches
  for each row execute function public.smyl_audit_row();

-- Protege también las rutas anteriores: no se archiva un almacén con saldo o pedidos abiertos.
create or replace function public.smyl_inventory_catalog_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':inventory',0));
  if tg_table_name='smyl_inventory_locations' then
    if auth.uid() is not null and (not public.smyl_branch_access(new.tenant_id,new.branch_id)
      or (tg_op='UPDATE' and not public.smyl_branch_access(old.tenant_id,old.branch_id))) then
      raise exception using errcode='42501',message='No tienes acceso a esa sucursal.';
    end if;
    if tg_op='UPDATE' and (new.branch_id is distinct from old.branch_id or (old.active and not new.active)) then
      if exists(select 1 from public.smyl_inventory_movements m
        join public.smyl_inventory_movement_lines l on l.tenant_id=m.tenant_id and l.movement_id=m.id
        where m.tenant_id=old.tenant_id and (m.source_location_id=old.id or m.destination_location_id=old.id)
        group by l.item_id,l.lot_id having sum(case when m.destination_location_id=old.id then l.quantity else -l.quantity end)<>0)
        or exists(select 1 from public.smyl_purchase_orders where tenant_id=old.tenant_id and destination_location_id=old.id and status in ('ordered','partially_received')) then
        raise exception using errcode='23514',message='Primero traslada las existencias y resuelve las compras pendientes de este almacén.';
      end if;
      if new.branch_id is distinct from old.branch_id and exists(select 1 from public.smyl_inventory_movements
        where tenant_id=old.tenant_id and (source_location_id=old.id or destination_location_id=old.id)) then
        raise exception using errcode='23514',message='Un almacén con movimientos conserva su sucursal. Crea otro almacén y registra un traslado.';
      end if;
    end if;
  elsif tg_table_name='smyl_inventory_suppliers' then
    if char_length(new.whatsapp_template)>6000 or char_length(new.email_template)>6000 or char_length(new.email_subject)>200 then
      raise exception using errcode='22023',message='La plantilla es demasiado larga.';
    end if;
    if tg_op='UPDATE' and old.active and not new.active and exists(select 1 from public.smyl_purchase_orders
      where tenant_id=old.tenant_id and supplier_id=old.id and status in ('ordered','partially_received')) then
      raise exception using errcode='23514',message='Resuelve las compras pendientes antes de desactivar al proveedor.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.smyl_inventory_catalog_guard() from public,anon,authenticated;
drop trigger if exists smyl_inventory_locations_lifecycle on public.smyl_inventory_locations;
create trigger smyl_inventory_locations_lifecycle before insert or update on public.smyl_inventory_locations
  for each row execute function public.smyl_inventory_catalog_guard();
drop trigger if exists smyl_inventory_suppliers_lifecycle on public.smyl_inventory_suppliers;
create trigger smyl_inventory_suppliers_lifecycle before insert or update on public.smyl_inventory_suppliers
  for each row execute function public.smyl_inventory_catalog_guard();

create or replace function public.smyl_purchase_destination_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_branch uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':inventory',0));
  select branch_id into v_branch from public.smyl_inventory_locations
    where tenant_id=new.tenant_id and id=new.destination_location_id and active;
  if v_branch is null then raise exception using errcode='23514',message='El almacén no está activo.'; end if;
  if not exists(select 1 from public.smyl_inventory_suppliers where tenant_id=new.tenant_id and id=new.supplier_id and active) then
    raise exception using errcode='23514',message='El proveedor no está activo.';
  end if;
  if auth.uid() is not null and not public.smyl_branch_access(new.tenant_id,v_branch) then
    raise exception using errcode='42501',message='No tienes acceso al almacén de esta compra.';
  end if;
  return new;
end $$;
revoke all on function public.smyl_purchase_destination_guard() from public,anon,authenticated;
drop trigger if exists smyl_purchase_destination_guard on public.smyl_purchase_orders;
create trigger smyl_purchase_destination_guard before insert or update of destination_location_id,status on public.smyl_purchase_orders
  for each row execute function public.smyl_purchase_destination_guard();

-- Revalida después de tomar el mismo bloqueo que el archivo de almacenes. Cierra la carrera
-- entre una operación que ya había leído active=true y una desactivación concurrente.
create or replace function public.smyl_inventory_active_locations_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':inventory',0));
  if (new.source_location_id is not null and not exists(select 1 from public.smyl_inventory_locations where tenant_id=new.tenant_id and id=new.source_location_id and active))
    or (new.destination_location_id is not null and not exists(select 1 from public.smyl_inventory_locations where tenant_id=new.tenant_id and id=new.destination_location_id and active)) then
    raise exception using errcode='23514',message='Una ubicación del movimiento está inactiva. Actualiza el inventario.';
  end if;
  if auth.uid() is not null and exists(select 1 from public.smyl_inventory_locations
    where tenant_id=new.tenant_id and id in (new.source_location_id,new.destination_location_id)
      and not public.smyl_branch_access(new.tenant_id,branch_id)) then
    raise exception using errcode='42501',message='No tienes acceso a todos los almacenes de este movimiento.';
  end if;
  return new;
end $$;
revoke all on function public.smyl_inventory_active_locations_guard() from public,anon,authenticated;
drop trigger if exists smyl_inventory_active_locations on public.smyl_inventory_movements;
create trigger smyl_inventory_active_locations before insert on public.smyl_inventory_movements
  for each row execute function public.smyl_inventory_active_locations_guard();

create or replace function public.smyl_create_inventory_item(p_id uuid,p_item jsonb,p_setup jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); loc uuid:=(p_setup->>'location_id')::uuid;
  qty numeric:=(p_setup->>'quantity')::numeric; minimum numeric:=coalesce((p_setup->>'minimum')::numeric,0);
  target numeric:=coalesce((p_setup->>'target')::numeric,0); supplier uuid:=(p_item->>'preferred_supplier_id')::uuid;
begin
  if t is null or not public.smyl_has_permission(t,'inventory.manage') then raise exception using errcode='42501',message='No puedes agregar insumos.'; end if;
  if p_id is null then raise exception using errcode='22023',message='Falta la identidad del insumo.'; end if;
  if (p_item->>'reference_cost')::numeric<0 or (p_item->>'reference_cost')::numeric>999999999
    or (p_item->>'package_quantity')::numeric<=0 or (p_item->>'package_quantity')::numeric>99999999 then
    raise exception using errcode='22023',message='Revisa el precio y las unidades por presentación.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  if exists(select 1 from public.smyl_inventory_items where tenant_id=t and id=p_id) then return p_id; end if;
  if loc is not null and not exists(select 1 from public.smyl_inventory_locations where tenant_id=t and id=loc and active and public.smyl_branch_access(t,branch_id)) then
    raise exception using errcode='42501',message='No tienes acceso a ese almacén.';
  end if;
  if qty is not null and (qty<=0 or qty>99999999 or loc is null) then raise exception using errcode='22023',message='Revisa la existencia inicial y su almacén.'; end if;
  if minimum<0 or target<minimum or target>99999999 or ((minimum>0 or target>0) and loc is null) then
    raise exception using errcode='22023',message='Revisa el mínimo, el objetivo y su almacén.';
  end if;
  if supplier is not null and not exists(select 1 from public.smyl_inventory_suppliers where tenant_id=t and id=supplier and active) then
    raise exception using errcode='22023',message='Selecciona un proveedor activo.';
  end if;
  insert into public.smyl_inventory_items(id,tenant_id,sku,name,category,unit,barcode,reference_cost,package_label,package_quantity,
    preferred_supplier_id,track_lot,track_expiry,track_serial,requires_patient_trace,created_by)
  values(p_id,t,p_item->>'sku',p_item->>'name',p_item->>'category',p_item->>'unit',coalesce(p_item->>'barcode',''),
    (p_item->>'reference_cost')::numeric,coalesce(p_item->>'package_label',''),(p_item->>'package_quantity')::numeric,supplier,
    coalesce((p_item->>'track_lot')::boolean,false),coalesce((p_item->>'track_expiry')::boolean,false),
    coalesce((p_item->>'track_serial')::boolean,false),coalesce((p_item->>'requires_patient_trace')::boolean,false),auth.uid());
  if qty is not null then perform public.smyl_register_initial_stock(p_id,loc,qty,coalesce(p_setup->>'lot_code',''),
    (p_setup->>'expires_on')::date,(p_item->>'reference_cost')::numeric,p_id); end if;
  if loc is not null and (minimum>0 or target>0) then insert into public.smyl_inventory_reorder_levels(tenant_id,location_id,item_id,minimum_quantity,target_quantity,updated_by)
    values(t,loc,p_id,minimum,target,auth.uid()); end if;
  return p_id;
end $$;
revoke all on function public.smyl_create_inventory_item(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.smyl_create_inventory_item(uuid,jsonb,jsonb) to authenticated;

create or replace function public.smyl_save_supplier_catalog(p_supplier_id uuid,p_items jsonb,p_expected jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); actual jsonb; x record;
begin
  if t is null or not public.smyl_has_permission(t,'inventory.manage') then raise exception using errcode='42501',message='No puedes editar proveedores.'; end if;
  perform 1 from public.smyl_inventory_suppliers where tenant_id=t and id=p_supplier_id and active for update;
  if not found then raise exception using errcode='22023',message='El proveedor no está activo.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'supplier_sku',supplier_sku,'unit_cost',unit_cost,'lead_days',lead_days) order by item_id),'[]') into actual
    from public.smyl_supplier_items where tenant_id=t and supplier_id=p_supplier_id;
  if actual is distinct from p_expected then raise exception using errcode='40001',message='El catálogo cambió. Actualiza antes de guardar.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>500 then raise exception using errcode='22023',message='El catálogo admite hasta 500 insumos.'; end if;
  delete from public.smyl_supplier_items where tenant_id=t and supplier_id=p_supplier_id;
  for x in select * from jsonb_to_recordset(p_items) a(item_id uuid,supplier_sku text,unit_cost numeric,lead_days integer) loop
    if not exists(select 1 from public.smyl_inventory_items where tenant_id=t and id=x.item_id and active) then
      raise exception using errcode='22023',message='El catálogo contiene un insumo que no está activo.';
    end if;
    insert into public.smyl_supplier_items(tenant_id,supplier_id,item_id,supplier_sku,unit_cost,lead_days)
      values(t,p_supplier_id,x.item_id,coalesce(x.supplier_sku,''),x.unit_cost,x.lead_days);
  end loop;
  insert into public.smyl_audit_events(tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data)
    values(t,auth.uid(),'update','smyl_supplier_items',p_supplier_id::text,actual,p_items);
end $$;

create or replace function public.smyl_save_treatment_kit(p_service_id uuid,p_lines jsonb,p_expected jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); actual jsonb; x record;
begin
  if t is null or not public.smyl_has_permission(t,'inventory.manage') then raise exception using errcode='42501',message='No puedes editar kits.'; end if;
  perform 1 from public.smyl_services where tenant_id=t and id=p_service_id and active for update;
  if not found then raise exception using errcode='22023',message='Selecciona un tratamiento activo.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'expected_quantity',expected_quantity) order by item_id),'[]') into actual
    from public.smyl_service_materials where tenant_id=t and service_id=p_service_id;
  if actual is distinct from p_expected then raise exception using errcode='40001',message='El kit cambió en otra sesión. Actualiza antes de guardar.'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)>100 then raise exception using errcode='22023',message='El kit admite hasta 100 materiales.'; end if;
  delete from public.smyl_service_materials where tenant_id=t and service_id=p_service_id;
  for x in select * from jsonb_to_recordset(p_lines) a(item_id uuid,expected_quantity numeric) loop
    if not exists(select 1 from public.smyl_inventory_items where tenant_id=t and id=x.item_id and active)
      or x.expected_quantity is null or x.expected_quantity<=0 or x.expected_quantity>99999999 then
      raise exception using errcode='22023',message='Revisa los insumos y las cantidades del kit.';
    end if;
    insert into public.smyl_service_materials(tenant_id,service_id,item_id,expected_quantity,updated_by)
      values(t,p_service_id,x.item_id,x.expected_quantity,auth.uid());
  end loop;
  insert into public.smyl_audit_events(tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data)
    values(t,auth.uid(),'update','smyl_service_materials',p_service_id::text,actual,p_lines);
end $$;

-- Guardado y emisión en una sola transacción. Un ID estable permite repetir un envío tras un corte de red.
create or replace function public.smyl_save_purchase_batch(p_id uuid,p_revision integer,p_document jsonb,p_issue boolean default false)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); oldrow public.smyl_purchase_batches; x record; g record;
  v_lines jsonb:=p_document->'lines'; v_branch uuid:=(p_document->>'branch_id')::uuid;
  v_mode text:=p_document->>'mode'; v_reference text:=btrim(p_document->>'reference');
  v_expected date:=(p_document->>'expected_on')::date; v_notes text:=coalesce(p_document->>'notes','');
  v_order uuid; v_index integer:=0; v_payload jsonb; v_clean jsonb;
begin
  if t is null or not public.smyl_has_permission(t,'inventory.manage') or not public.smyl_has_permission(t,'inventory.purchase') then
    raise exception using errcode='42501',message='No tienes permiso para preparar compras.';
  end if;
  if p_id is null or p_revision is null or p_issue is null then raise exception using errcode='22023',message='Falta la identidad de la compra.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(t::text||':inventory',0));
  select * into oldrow from public.smyl_purchase_batches where tenant_id=t and id=p_id for update;
  if found and not public.smyl_purchase_batch_access(t,oldrow.branch_id,oldrow.lines) then
    raise exception using errcode='42501',message='No tienes acceso a esta compra.';
  end if;
  if oldrow.id is not null and oldrow.status='ordered' and p_issue then return p_id; end if;
  if found and (oldrow.status<>'draft' or oldrow.revision<>p_revision) then raise exception using errcode='40001',message='La compra cambió. Actualiza antes de continuar.'; end if;
  if not found and p_revision<>0 then raise exception using errcode='40001',message='La compra ya no está disponible.'; end if;
  if v_mode is null or v_mode not in ('branch','consolidated') or v_reference is null or char_length(v_reference) not between 1 and 70
    or (v_mode='branch' and v_branch is null) or (v_mode='consolidated' and v_branch is not null) then
    raise exception using errcode='22023',message='Revisa la modalidad, la clínica y el nombre de la compra.';
  end if;
  if v_lines is null or jsonb_typeof(v_lines)<>'array' or jsonb_array_length(v_lines) not between 1 and 100 then
    raise exception using errcode='22023',message='Agrega entre 1 y 100 renglones a la compra.';
  end if;
  if not public.smyl_purchase_batch_access(t,v_branch,v_lines) then raise exception using errcode='42501',message='No tienes acceso a todas las sucursales de esta compra.'; end if;
  for x in select * from jsonb_to_recordset(v_lines) a(item_id uuid,supplier_id uuid,destination_location_id uuid,quantity numeric,unit_cost numeric,purchase_unit text) loop
    if x.item_id is null or x.quantity is null or round(x.quantity,3)<=0 or x.quantity>99999999
      or (x.unit_cost is not null and (x.unit_cost<0 or x.unit_cost>999999999)) then
      raise exception using errcode='22023',message='Revisa cantidades y precios de cada insumo.';
    end if;
    if not exists(select 1 from public.smyl_inventory_items where tenant_id=t and id=x.item_id and active)
      or not exists(select 1 from public.smyl_inventory_locations where tenant_id=t and id=x.destination_location_id and active and (v_mode='consolidated' or branch_id=v_branch)) then
      raise exception using errcode='22023',message='Un insumo o almacén no está activo o no pertenece a la clínica elegida.';
    end if;
    if coalesce(x.purchase_unit,'unit') not in ('unit','pack') or (x.purchase_unit='pack' and not exists(
      select 1 from public.smyl_inventory_items where tenant_id=t and id=x.item_id and package_quantity>0 and package_label<>'')) then
      raise exception using errcode='22023',message='Revisa la presentación de compra del insumo.';
    end if;
    if x.supplier_id is not null and not exists(select 1 from public.smyl_inventory_suppliers where tenant_id=t and id=x.supplier_id and active) then
      raise exception using errcode='22023',message='Uno de los proveedores no está activo.';
    end if;
    if p_issue and (x.supplier_id is null or x.unit_cost is null) then
      raise exception using errcode='22023',message='Asigna proveedor y precio a todos los insumos antes de emitir las órdenes.';
    end if;
  end loop;
  if exists(select 1 from jsonb_to_recordset(v_lines) a(item_id uuid,supplier_id uuid,destination_location_id uuid)
    group by item_id,supplier_id,destination_location_id having count(*)>1) then
    raise exception using errcode='22023',message='Combina los renglones repetidos del mismo insumo, proveedor y almacén.';
  end if;
  if exists(select 1 from public.smyl_purchase_batches where id=p_id and tenant_id<>t) then
    raise exception using errcode='42501',message='La compra no está disponible.';
  end if;
  select jsonb_agg(jsonb_build_object('item_id',a.x->>'item_id','supplier_id',a.x->>'supplier_id',
    'destination_location_id',a.x->>'destination_location_id','quantity',round((a.x->>'quantity')::numeric,3),
    'unit_cost',round((a.x->>'unit_cost')::numeric,4),'purchase_unit',coalesce(a.x->>'purchase_unit','unit'),
    'package_label',case when a.x->>'purchase_unit'='pack' then i.package_label else '' end,
    'package_quantity',case when a.x->>'purchase_unit'='pack' then i.package_quantity else null end) order by n) into v_clean
    from jsonb_array_elements(v_lines) with ordinality as a(x,n)
    join public.smyl_inventory_items i on i.tenant_id=t and i.id=(a.x->>'item_id')::uuid;
  insert into public.smyl_purchase_batches(id,tenant_id,reference,mode,branch_id,expected_on,notes,lines,created_by)
    values(p_id,t,v_reference,v_mode,v_branch,v_expected,v_notes,v_clean,auth.uid())
    on conflict(id) do update set reference=excluded.reference,mode=excluded.mode,branch_id=excluded.branch_id,
      expected_on=excluded.expected_on,notes=excluded.notes,lines=excluded.lines,revision=smyl_purchase_batches.revision+1,updated_at=now()
      where smyl_purchase_batches.tenant_id=t;
  if p_issue then
    for g in select supplier_id,destination_location_id from jsonb_to_recordset(v_clean) a(supplier_id uuid,destination_location_id uuid)
      group by supplier_id,destination_location_id order by supplier_id,destination_location_id loop
      v_index:=v_index+1; v_order:=gen_random_uuid();
      select jsonb_agg(jsonb_build_object('item_id',item_id,'quantity',quantity,'unit_cost',unit_cost)) into v_payload
        from jsonb_to_recordset(v_clean) a(item_id uuid,supplier_id uuid,destination_location_id uuid,quantity numeric,unit_cost numeric)
        where supplier_id=g.supplier_id and destination_location_id=g.destination_location_id;
      perform public.smyl_create_purchase_order(v_order,g.supplier_id,g.destination_location_id,v_reference||'-'||lpad(v_index::text,2,'0'),v_expected,v_notes,v_payload);
      update public.smyl_purchase_orders set batch_id=p_id where tenant_id=t and id=v_order;
    end loop;
    update public.smyl_purchase_batches set status='ordered',updated_at=now() where tenant_id=t and id=p_id;
  end if;
  return p_id;
end $$;

create or replace function public.smyl_cancel_purchase_batch(p_id uuid,p_revision integer)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare t uuid:=public.smyl_current_tenant(); b public.smyl_purchase_batches; o record;
begin
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

revoke all on function public.smyl_save_supplier_catalog(uuid,jsonb,jsonb),public.smyl_save_treatment_kit(uuid,jsonb,jsonb),
  public.smyl_save_purchase_batch(uuid,integer,jsonb,boolean),public.smyl_cancel_purchase_batch(uuid,integer) from public,anon;
grant execute on function public.smyl_save_supplier_catalog(uuid,jsonb,jsonb),public.smyl_save_treatment_kit(uuid,jsonb,jsonb),
  public.smyl_save_purchase_batch(uuid,integer,jsonb,boolean),public.smyl_cancel_purchase_batch(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
