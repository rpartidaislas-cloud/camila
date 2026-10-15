-- SMYL · Costeo histórico de inventario y edición auditada de kits.
-- No revaloriza ni modifica movimientos confirmados existentes.
begin;

create or replace function public.smyl_inventory_historical_unit_cost(
  p_tenant uuid,
  p_item uuid,
  p_lot uuid,
  p_at timestamptz
) returns numeric
language sql
security definer
stable
set search_path=pg_catalog,public
as $$
  select sum(l.quantity*l.unit_cost)/nullif(sum(l.quantity),0)
  from public.smyl_inventory_movement_lines l
  join public.smyl_inventory_movements m
    on m.tenant_id=l.tenant_id and m.id=l.movement_id
  where l.tenant_id=p_tenant
    and l.item_id=p_item
    and l.lot_id is not distinct from p_lot
    and l.unit_cost is not null
    and m.movement_type in ('receipt','adjustment_in')
    and m.occurred_at<=coalesce(p_at,now())
    and not exists (
      select 1
      from public.smyl_inventory_movements reversal
      where reversal.tenant_id=m.tenant_id and reversal.reversal_of=m.id
    );
$$;
revoke all on function public.smyl_inventory_historical_unit_cost(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;

create or replace function public.smyl_post_inventory_movement(
  p_id uuid,p_idempotency_key uuid,p_movement_type text,p_source_location_id uuid,p_destination_location_id uuid,
  p_patient_id uuid,p_appointment_id uuid,p_professional_id uuid,p_reason text,p_lines jsonb,p_occurred_at timestamptz default now()
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_existing uuid;
  v_line record;
  v_item public.smyl_inventory_items;
  v_lot public.smyl_inventory_lots;
  v_occurred_at timestamptz:=coalesce(p_occurred_at,now());
  v_unit_cost numeric(14,4);
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
  values(p_id,v_tenant,p_idempotency_key,p_movement_type,p_source_location_id,p_destination_location_id,p_patient_id,p_appointment_id,p_professional_id,btrim(p_reason),v_occurred_at,auth.uid());
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

    -- El navegador sólo puede valorar una entrada manual. Para toda salida el
    -- servidor deriva el costo de entradas confirmadas y lo congela en la línea.
    if p_movement_type='adjustment_in' then
      v_unit_cost:=v_line.unit_cost;
    else
      v_unit_cost:=public.smyl_inventory_historical_unit_cost(v_tenant,v_line.item_id,v_line.lot_id,v_occurred_at);
    end if;
    insert into public.smyl_inventory_movement_lines(tenant_id,movement_id,item_id,lot_id,quantity,unit_cost)
    values(v_tenant,p_id,v_line.item_id,v_line.lot_id,v_line.quantity,v_unit_cost);
  end loop;
  return p_id;
end; $$;

revoke all on function public.smyl_post_inventory_movement(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz) from public,anon;
grant execute on function public.smyl_post_inventory_movement(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz) to authenticated;

create or replace function public.smyl_remove_service_material(p_service_id uuid,p_item_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_before public.smyl_service_materials;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'inventory.manage') then
    raise exception using errcode='42501',message='No tienes permiso para modificar kits.';
  end if;
  delete from public.smyl_service_materials
  where tenant_id=v_tenant and service_id=p_service_id and item_id=p_item_id
  returning * into v_before;
  if not found then return false; end if;
  insert into public.smyl_audit_events(tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data)
  values(v_tenant,auth.uid(),'delete','smyl_service_materials',p_service_id::text||':'||p_item_id::text,to_jsonb(v_before),null);
  return true;
end; $$;
revoke all on function public.smyl_remove_service_material(uuid,uuid) from public,anon;
grant execute on function public.smyl_remove_service_material(uuid,uuid) to authenticated;

comment on function public.smyl_inventory_historical_unit_cost(uuid,uuid,uuid,timestamptz) is 'Costo ponderado interno por insumo/lote a partir de entradas confirmadas no compensadas.';
comment on function public.smyl_remove_service_material(uuid,uuid) is 'Retira un material del kit con tenant, permiso y auditoría resueltos en servidor.';

commit;
