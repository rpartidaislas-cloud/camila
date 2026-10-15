-- SMYL · Etapa 4: acciones atómicas e idempotentes de inventario.
begin;

create or replace function public.smyl_inventory_balance(p_tenant uuid,p_location uuid,p_item uuid,p_lot uuid)
returns numeric language sql security definer stable set search_path=pg_catalog,public as $$
  select coalesce(sum((case when m.destination_location_id=p_location then l.quantity else 0 end)-(case when m.source_location_id=p_location then l.quantity else 0 end)),0)
  from public.smyl_inventory_movements m join public.smyl_inventory_movement_lines l on l.tenant_id=m.tenant_id and l.movement_id=m.id
  where m.tenant_id=p_tenant and l.item_id=p_item and l.lot_id is not distinct from p_lot;
$$;
revoke all on function public.smyl_inventory_balance(uuid,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.smyl_post_inventory_movement(
  p_id uuid,p_idempotency_key uuid,p_movement_type text,p_source_location_id uuid,p_destination_location_id uuid,
  p_patient_id uuid,p_appointment_id uuid,p_professional_id uuid,p_reason text,p_lines jsonb,p_occurred_at timestamptz default now()
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_existing uuid; v_line record; v_item public.smyl_inventory_items; v_lot public.smyl_inventory_lots;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'inventory.manage') then raise exception using errcode='42501',message='No tienes permiso para registrar movimientos.'; end if;
  if p_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='Falta la identidad idempotente del movimiento.'; end if;
  select id into v_existing from public.smyl_inventory_movements where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;
  if p_movement_type not in ('transfer','consumption','waste','adjustment_in','adjustment_out') then raise exception using errcode='22023',message='Tipo de movimiento no permitido.'; end if;
  if p_movement_type='transfer' and (p_source_location_id is null or p_destination_location_id is null or p_source_location_id=p_destination_location_id) then raise exception using errcode='23514',message='El traslado requiere ubicaciones diferentes.'; end if;
  if p_movement_type in ('consumption','waste','adjustment_out') and (p_source_location_id is null or p_destination_location_id is not null) then raise exception using errcode='23514',message='El movimiento requiere una ubicación de salida.'; end if;
  if p_movement_type='adjustment_in' and (p_destination_location_id is null or p_source_location_id is not null) then raise exception using errcode='23514',message='El ajuste de entrada requiere una ubicación de destino.'; end if;
  if p_source_location_id is not null and not exists(select 1 from public.smyl_inventory_locations where tenant_id=v_tenant and id=p_source_location_id and active) then raise exception using errcode='P0002',message='La ubicación de salida no existe.'; end if;
  if p_destination_location_id is not null and not exists(select 1 from public.smyl_inventory_locations where tenant_id=v_tenant and id=p_destination_location_id and active) then raise exception using errcode='P0002',message='La ubicación de destino no existe.'; end if;
  if p_patient_id is not null and not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient_id) then raise exception using errcode='P0002',message='El paciente no existe.'; end if;
  if p_appointment_id is not null and not exists(select 1 from public.smyl_appointments where tenant_id=v_tenant and id=p_appointment_id and (p_patient_id is null or patient_id=p_patient_id)) then raise exception using errcode='23514',message='La cita no pertenece al paciente.'; end if;
  if p_professional_id is not null and not exists(select 1 from public.smyl_professionals where tenant_id=v_tenant and id=p_professional_id) then raise exception using errcode='P0002',message='El profesional no existe.'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then raise exception using errcode='22023',message='Agrega entre 1 y 100 insumos.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':inventory',0));
  insert into public.smyl_inventory_movements(id,tenant_id,idempotency_key,movement_type,source_location_id,destination_location_id,patient_id,appointment_id,professional_id,reason,occurred_at,created_by)
  values(p_id,v_tenant,p_idempotency_key,p_movement_type,p_source_location_id,p_destination_location_id,p_patient_id,p_appointment_id,p_professional_id,btrim(p_reason),coalesce(p_occurred_at,now()),auth.uid());
  for v_line in
    select x.item_id,x.lot_id,sum(x.quantity)::numeric as quantity,max(x.unit_cost) as unit_cost
    from jsonb_to_recordset(p_lines) as x(item_id uuid,lot_id uuid,quantity numeric,unit_cost numeric)
    group by x.item_id,x.lot_id
  loop
    if v_line.item_id is null or v_line.quantity is null or v_line.quantity<=0 then raise exception using errcode='22023',message='Cada cantidad debe ser mayor a cero.'; end if;
    select * into v_item from public.smyl_inventory_items where tenant_id=v_tenant and id=v_line.item_id and active;
    if not found then raise exception using errcode='P0002',message='Un insumo no existe o está inactivo.'; end if;
    if v_item.track_lot and v_line.lot_id is null then raise exception using errcode='23514',message='El insumo requiere lote.'; end if;
    if v_line.lot_id is not null then
      select * into v_lot from public.smyl_inventory_lots where tenant_id=v_tenant and id=v_line.lot_id and item_id=v_line.item_id;
      if not found then raise exception using errcode='23514',message='El lote no pertenece al insumo.'; end if;
      if p_movement_type='consumption' and v_lot.expires_on is not null and v_lot.expires_on<current_date then raise exception using errcode='23514',message='No se puede consumir un lote caducado; regístralo como merma.'; end if;
    end if;
    if p_movement_type='consumption' and v_item.requires_patient_trace and p_patient_id is null then raise exception using errcode='23514',message='Este insumo exige trazabilidad por paciente.'; end if;
    if p_source_location_id is not null and public.smyl_inventory_balance(v_tenant,p_source_location_id,v_line.item_id,v_line.lot_id)<v_line.quantity then raise exception using errcode='23514',message='Existencia insuficiente en la ubicación y lote seleccionados.'; end if;
    insert into public.smyl_inventory_movement_lines(tenant_id,movement_id,item_id,lot_id,quantity,unit_cost)
    values(v_tenant,p_id,v_line.item_id,v_line.lot_id,v_line.quantity,v_line.unit_cost);
  end loop;
  return p_id;
end; $$;

create or replace function public.smyl_create_purchase_order(p_id uuid,p_supplier_id uuid,p_destination_location_id uuid,p_reference text,p_expected_on date,p_notes text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_line record;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'inventory.manage') then raise exception using errcode='42501',message='No tienes permiso para crear pedidos.'; end if;
  if exists(select 1 from public.smyl_purchase_orders where tenant_id=v_tenant and id=p_id) then return p_id; end if;
  if not exists(select 1 from public.smyl_inventory_suppliers where tenant_id=v_tenant and id=p_supplier_id and active) then raise exception using errcode='P0002',message='El proveedor no existe.'; end if;
  if not exists(select 1 from public.smyl_inventory_locations where tenant_id=v_tenant and id=p_destination_location_id and active) then raise exception using errcode='P0002',message='La ubicación no existe.'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then raise exception using errcode='22023',message='Agrega entre 1 y 100 insumos al pedido.'; end if;
  insert into public.smyl_purchase_orders(id,tenant_id,supplier_id,destination_location_id,reference,expected_on,notes,created_by,updated_by)
  values(p_id,v_tenant,p_supplier_id,p_destination_location_id,left(btrim(coalesce(p_reference,'')),100),p_expected_on,left(coalesce(p_notes,''),2000),auth.uid(),auth.uid());
  for v_line in select x.item_id,sum(x.quantity)::numeric quantity,max(x.unit_cost) unit_cost from jsonb_to_recordset(p_lines) x(item_id uuid,quantity numeric,unit_cost numeric) group by x.item_id loop
    if v_line.item_id is null or v_line.quantity<=0 or not exists(select 1 from public.smyl_inventory_items where tenant_id=v_tenant and id=v_line.item_id and active) then raise exception using errcode='22023',message='El pedido contiene un insumo o cantidad inválida.'; end if;
    insert into public.smyl_purchase_order_lines(tenant_id,purchase_order_id,item_id,ordered_quantity,unit_cost) values(v_tenant,p_id,v_line.item_id,v_line.quantity,v_line.unit_cost);
  end loop;
  return p_id;
end; $$;

create or replace function public.smyl_receive_purchase_order(p_order_id uuid,p_movement_id uuid,p_idempotency_key uuid,p_receipt_lines jsonb)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_order public.smyl_purchase_orders; v_line record; v_po_line public.smyl_purchase_order_lines; v_item public.smyl_inventory_items; v_lot_id uuid; v_existing uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'inventory.manage') then raise exception using errcode='42501',message='No tienes permiso para recibir compras.'; end if;
  select id into v_existing from public.smyl_inventory_movements where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;
  if p_receipt_lines is null or jsonb_typeof(p_receipt_lines)<>'array' or jsonb_array_length(p_receipt_lines)=0 or jsonb_array_length(p_receipt_lines)>100 then raise exception using errcode='22023',message='Agrega los lotes recibidos.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':purchase:'||p_order_id::text,0));
  select * into v_order from public.smyl_purchase_orders where tenant_id=v_tenant and id=p_order_id for update;
  if not found or v_order.status not in ('ordered','partially_received') then raise exception using errcode='23514',message='El pedido no está disponible para recepción.'; end if;
  insert into public.smyl_inventory_movements(id,tenant_id,idempotency_key,movement_type,destination_location_id,purchase_order_id,reason,created_by)
  values(p_movement_id,v_tenant,p_idempotency_key,'receipt',v_order.destination_location_id,p_order_id,'Recepción de compra '||coalesce(nullif(v_order.reference,''),left(p_order_id::text,8)),auth.uid());
  for v_line in select * from jsonb_to_recordset(p_receipt_lines) x(line_id uuid,quantity numeric,lot_code text,expires_on date,serial_number text) loop
    select * into v_po_line from public.smyl_purchase_order_lines where tenant_id=v_tenant and id=v_line.line_id and purchase_order_id=p_order_id for update;
    if not found or v_line.quantity is null or v_line.quantity<=0 or v_po_line.received_quantity+v_line.quantity>v_po_line.ordered_quantity then raise exception using errcode='23514',message='La cantidad recibida supera lo pendiente.'; end if;
    select * into v_item from public.smyl_inventory_items where tenant_id=v_tenant and id=v_po_line.item_id;
    v_lot_id:=null;
    if v_item.track_lot then
      if char_length(btrim(coalesce(v_line.lot_code,'')))<1 then raise exception using errcode='23514',message='Captura el lote de cada insumo controlado.'; end if;
      if v_item.track_expiry and v_line.expires_on is null then raise exception using errcode='23514',message='Captura la caducidad del lote.'; end if;
      if v_item.track_serial and char_length(btrim(coalesce(v_line.serial_number,'')))<1 then raise exception using errcode='23514',message='Captura el número de serie.'; end if;
      insert into public.smyl_inventory_lots(tenant_id,item_id,supplier_id,lot_code,serial_number,expires_on,created_by)
      values(v_tenant,v_item.id,v_order.supplier_id,btrim(v_line.lot_code),btrim(coalesce(v_line.serial_number,'')),v_line.expires_on,auth.uid()) on conflict do nothing returning id into v_lot_id;
      if v_lot_id is null then select id into v_lot_id from public.smyl_inventory_lots where tenant_id=v_tenant and item_id=v_item.id and lower(lot_code)=lower(btrim(v_line.lot_code)) and lower(serial_number)=lower(btrim(coalesce(v_line.serial_number,''))); end if;
      if v_item.track_expiry and exists(select 1 from public.smyl_inventory_lots where tenant_id=v_tenant and id=v_lot_id and expires_on is distinct from v_line.expires_on) then raise exception using errcode='23514',message='Ese lote ya existe con una caducidad diferente.'; end if;
    end if;
    insert into public.smyl_inventory_movement_lines(tenant_id,movement_id,item_id,lot_id,quantity,unit_cost) values(v_tenant,p_movement_id,v_item.id,v_lot_id,v_line.quantity,v_po_line.unit_cost);
    update public.smyl_purchase_order_lines set received_quantity=received_quantity+v_line.quantity where tenant_id=v_tenant and id=v_po_line.id;
  end loop;
  update public.smyl_purchase_orders set status=case when exists(select 1 from public.smyl_purchase_order_lines where tenant_id=v_tenant and purchase_order_id=p_order_id and received_quantity<ordered_quantity) then 'partially_received' else 'received' end, received_at=case when not exists(select 1 from public.smyl_purchase_order_lines where tenant_id=v_tenant and purchase_order_id=p_order_id and received_quantity<ordered_quantity) then now() else received_at end, revision=revision+1,updated_by=auth.uid() where tenant_id=v_tenant and id=p_order_id;
  return p_movement_id;
end; $$;

create or replace function public.smyl_cancel_purchase_order(p_order_id uuid,p_expected_revision integer)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'inventory.manage') then raise exception using errcode='42501',message='No tienes permiso para cancelar pedidos.'; end if;
  update public.smyl_purchase_orders set status='cancelled',revision=revision+1,updated_by=auth.uid() where tenant_id=v_tenant and id=p_order_id and status='ordered' and revision=p_expected_revision and not exists(select 1 from public.smyl_purchase_order_lines l where l.tenant_id=v_tenant and l.purchase_order_id=p_order_id and l.received_quantity>0);
  if not found then raise exception using errcode='40001',message='El pedido cambió, ya recibió material o no puede cancelarse.'; end if;
end; $$;

create or replace function public.smyl_reverse_inventory_movement(p_movement_id uuid,p_reversal_id uuid,p_idempotency_key uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_original public.smyl_inventory_movements; v_line record; v_existing uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'inventory.manage') then raise exception using errcode='42501',message='No tienes permiso para corregir movimientos.'; end if;
  select id into v_existing from public.smyl_inventory_movements where tenant_id=v_tenant and idempotency_key=p_idempotency_key; if found then return v_existing; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':inventory',0));
  select * into v_original from public.smyl_inventory_movements where tenant_id=v_tenant and id=p_movement_id;
  if not found or v_original.reversal_of is not null or exists(select 1 from public.smyl_inventory_movements where tenant_id=v_tenant and reversal_of=p_movement_id) then raise exception using errcode='23514',message='El movimiento no puede revertirse o ya fue compensado.'; end if;
  for v_line in select * from public.smyl_inventory_movement_lines where tenant_id=v_tenant and movement_id=p_movement_id loop
    if v_original.destination_location_id is not null and public.smyl_inventory_balance(v_tenant,v_original.destination_location_id,v_line.item_id,v_line.lot_id)<v_line.quantity then raise exception using errcode='23514',message='No hay existencia suficiente para compensar este movimiento.'; end if;
  end loop;
  insert into public.smyl_inventory_movements(id,tenant_id,idempotency_key,movement_type,source_location_id,destination_location_id,patient_id,appointment_id,professional_id,reversal_of,reason,created_by)
  values(p_reversal_id,v_tenant,p_idempotency_key,'reversal',v_original.destination_location_id,v_original.source_location_id,v_original.patient_id,v_original.appointment_id,v_original.professional_id,p_movement_id,btrim(p_reason),auth.uid());
  insert into public.smyl_inventory_movement_lines(tenant_id,movement_id,item_id,lot_id,quantity,unit_cost)
  select tenant_id,p_reversal_id,item_id,lot_id,quantity,unit_cost from public.smyl_inventory_movement_lines where tenant_id=v_tenant and movement_id=p_movement_id;
  if v_original.purchase_order_id is not null then
    update public.smyl_purchase_order_lines pol set received_quantity=pol.received_quantity-x.quantity
    from (select item_id,sum(quantity) quantity from public.smyl_inventory_movement_lines where tenant_id=v_tenant and movement_id=p_movement_id group by item_id) x
    where pol.tenant_id=v_tenant and pol.purchase_order_id=v_original.purchase_order_id and pol.item_id=x.item_id and pol.received_quantity>=x.quantity;
    update public.smyl_purchase_orders po set status=case
      when not exists(select 1 from public.smyl_purchase_order_lines l where l.tenant_id=v_tenant and l.purchase_order_id=po.id and l.received_quantity>0) then 'ordered'
      else 'partially_received' end,received_at=null,revision=revision+1,updated_by=auth.uid()
    where po.tenant_id=v_tenant and po.id=v_original.purchase_order_id;
  end if;
  return p_reversal_id;
end; $$;

create or replace function public.smyl_inventory_snapshot(p_location_id uuid default null)
returns table(location_id uuid,location_name text,branch_id uuid,item_id uuid,sku text,item_name text,category text,unit text,on_hand numeric,minimum_quantity numeric,below_minimum boolean,nearest_expiry date,days_to_expiry integer,lot_count bigint,requires_patient_trace boolean)
language plpgsql security definer stable set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'inventory.read') then raise exception using errcode='42501',message='No tienes permiso para consultar inventario.'; end if;
  return query with contributions as (
    select m.destination_location_id loc,l.item_id,l.lot_id,l.quantity qty from public.smyl_inventory_movements m join public.smyl_inventory_movement_lines l on l.tenant_id=m.tenant_id and l.movement_id=m.id where m.tenant_id=v_tenant and m.destination_location_id is not null
    union all select m.source_location_id,l.item_id,l.lot_id,-l.quantity from public.smyl_inventory_movements m join public.smyl_inventory_movement_lines l on l.tenant_id=m.tenant_id and l.movement_id=m.id where m.tenant_id=v_tenant and m.source_location_id is not null
  ), lot_balance as (select loc,item_id,lot_id,sum(qty) qty from contributions group by loc,item_id,lot_id), item_balance as (
    select lb.loc,lb.item_id,sum(lb.qty) qty,min(lo.expires_on) filter(where lb.qty>0 and lo.expires_on is not null) expiry,count(*) filter(where lb.qty>0 and lb.lot_id is not null) lots from lot_balance lb left join public.smyl_inventory_lots lo on lo.tenant_id=v_tenant and lo.id=lb.lot_id group by lb.loc,lb.item_id
  ) select loc.id,loc.name,loc.branch_id,i.id,i.sku,i.name,i.category,i.unit,coalesce(b.qty,0),coalesce(r.minimum_quantity,0),coalesce(b.qty,0)<=coalesce(r.minimum_quantity,0) and coalesce(r.minimum_quantity,0)>0,b.expiry,case when b.expiry is null then null else b.expiry-current_date end,coalesce(b.lots,0),i.requires_patient_trace
  from public.smyl_inventory_locations loc cross join public.smyl_inventory_items i left join item_balance b on b.loc=loc.id and b.item_id=i.id left join public.smyl_inventory_reorder_levels r on r.tenant_id=v_tenant and r.location_id=loc.id and r.item_id=i.id
  where loc.tenant_id=v_tenant and loc.active and i.tenant_id=v_tenant and i.active and (p_location_id is null or loc.id=p_location_id)
  order by loc.name,i.name;
end; $$;

create or replace function public.smyl_inventory_lot_stock(p_location_id uuid default null)
returns table(location_id uuid,item_id uuid,lot_id uuid,lot_code text,serial_number text,expires_on date,on_hand numeric)
language plpgsql security definer stable set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'inventory.read') then raise exception using errcode='42501',message='No tienes permiso para consultar lotes.'; end if;
  return query with c as (
    select m.destination_location_id loc,l.item_id,l.lot_id,l.quantity qty from public.smyl_inventory_movements m join public.smyl_inventory_movement_lines l on l.tenant_id=m.tenant_id and l.movement_id=m.id where m.tenant_id=v_tenant and m.destination_location_id is not null
    union all select m.source_location_id,l.item_id,l.lot_id,-l.quantity from public.smyl_inventory_movements m join public.smyl_inventory_movement_lines l on l.tenant_id=m.tenant_id and l.movement_id=m.id where m.tenant_id=v_tenant and m.source_location_id is not null
  ) select c.loc,c.item_id,c.lot_id,coalesce(lo.lot_code,''),coalesce(lo.serial_number,''),lo.expires_on,sum(c.qty) from c left join public.smyl_inventory_lots lo on lo.tenant_id=v_tenant and lo.id=c.lot_id where (p_location_id is null or c.loc=p_location_id) group by c.loc,c.item_id,c.lot_id,lo.lot_code,lo.serial_number,lo.expires_on having sum(c.qty)>0 order by lo.expires_on nulls last;
end; $$;

revoke all on function public.smyl_post_inventory_movement(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz),public.smyl_create_purchase_order(uuid,uuid,uuid,text,date,text,jsonb),public.smyl_receive_purchase_order(uuid,uuid,uuid,jsonb),public.smyl_cancel_purchase_order(uuid,integer),public.smyl_reverse_inventory_movement(uuid,uuid,uuid,text),public.smyl_inventory_snapshot(uuid),public.smyl_inventory_lot_stock(uuid) from public,anon;
grant execute on function public.smyl_post_inventory_movement(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz),public.smyl_create_purchase_order(uuid,uuid,uuid,text,date,text,jsonb),public.smyl_receive_purchase_order(uuid,uuid,uuid,jsonb),public.smyl_cancel_purchase_order(uuid,integer),public.smyl_reverse_inventory_movement(uuid,uuid,uuid,text),public.smyl_inventory_snapshot(uuid),public.smyl_inventory_lot_stock(uuid) to authenticated;

commit;
