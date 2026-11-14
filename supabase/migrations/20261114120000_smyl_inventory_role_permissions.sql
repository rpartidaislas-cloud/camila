-- SMYL · Roles de Inventario: quién registra consumo, quién ajusta existencias y quién compra.
-- Aditiva y sin pérdida de acceso: los roles que hoy administran el inventario (`inventory.manage`) reciben
-- «Ajustar inventario» y «Comprar y recibir», así que nadie queda bloqueado al aplicarla. Después la clínica puede
-- quitárselas a un rol desde Mi clínica > Equipo > Editar rol.
--   inventory.consume   Registrar consumo: registrar el material usado en una atención sin administrar el inventario
--                       (p. ej. asistente u odontólogo). Se suma a `inventory.read`; quien administra ya puede.
--   inventory.adjust    Ajustar inventario: mermas, ajustes de existencia y correcciones de movimientos.
--   inventory.purchase  Comprar y recibir: crear, cancelar y recibir pedidos de compra.
-- Requiere la migración de finanzas profesionales (20261113123000): amplía su lista de claves y conserva su siembra.
begin;

-- 1. Claves de permiso permitidas (la lista vigente + las tres nuevas).
alter table public.smyl_role_permissions
  drop constraint if exists smyl_role_permissions_permission_key_check;
alter table public.smyl_role_permissions
  add constraint smyl_role_permissions_permission_key_check check (permission_key in (
    'clinic.read', 'clinic.manage',
    'team.read', 'team.manage', 'audit.read',
    'schedule.read', 'schedule.manage',
    'patients.read', 'patients.manage',
    'clinical.read', 'clinical.write', 'clinical.approve',
    'proposal.read', 'proposal.write', 'proposal.approve', 'proposal.followup',
    'messages.read', 'messages.respond', 'messages.manage',
    'inventory.read', 'inventory.manage', 'inventory.consume', 'inventory.adjust', 'inventory.purchase',
    'finance.read', 'finance.manage', 'finance.cash', 'finance.cash.supervise', 'finance.invoice', 'finance.refund',
    'catalog.manage', 'catalog.prices',
    'settings.manage'
  ));

-- 2. Sin pérdida de acceso: cada rol con `inventory.manage` recibe ajustar y comprar.
insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
select rp.tenant_id, rp.role_id, k.permission_key
from public.smyl_role_permissions rp
cross join (values ('inventory.adjust'), ('inventory.purchase')) as k(permission_key)
where rp.permission_key = 'inventory.manage'
on conflict do nothing;

-- 3. Clínicas nuevas: se conserva la siembra vigente (catálogo y finanzas) y se suman las dos funciones de inventario
--    a Propietario, Administrador e Inventario.
create or replace function public.smyl_seed_catalog_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.system_role and new.code in ('propietario', 'administrador') then
    insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
    values
      (new.tenant_id, new.id, 'catalog.manage'),
      (new.tenant_id, new.id, 'catalog.prices'),
      (new.tenant_id, new.id, 'finance.refund'),
      (new.tenant_id, new.id, 'finance.cash'),
      (new.tenant_id, new.id, 'finance.cash.supervise'),
      (new.tenant_id, new.id, 'finance.invoice'),
      (new.tenant_id, new.id, 'inventory.adjust'),
      (new.tenant_id, new.id, 'inventory.purchase')
    on conflict do nothing;
  elsif new.system_role and new.code = 'finanzas' then
    insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
    values
      (new.tenant_id, new.id, 'finance.refund'),
      (new.tenant_id, new.id, 'finance.cash'),
      (new.tenant_id, new.id, 'finance.cash.supervise'),
      (new.tenant_id, new.id, 'finance.invoice')
    on conflict do nothing;
  elsif new.system_role and new.code = 'inventario' then
    insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
    values
      (new.tenant_id, new.id, 'inventory.adjust'),
      (new.tenant_id, new.id, 'inventory.purchase')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.smyl_seed_catalog_permissions() from public, anon, authenticated;

-- 4. Registrar consumo sin administrar: la función de movimientos acepta `inventory.consume` solo para el consumo clínico.
--    (Copia de la definición vigente de la migración de costos; cambia únicamente la línea de permiso.)
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
  -- Registrar consumo clínico puede darse sin administrar el inventario (`inventory.consume`); lo demás exige `inventory.manage`.
  if v_tenant is null or not (
       public.smyl_has_permission(v_tenant,'inventory.manage')
    or (p_movement_type='consumption' and public.smyl_has_permission(v_tenant,'inventory.consume'))
  ) then raise exception using errcode='42501',message='No tienes permiso para registrar movimientos.'; end if;
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

revoke all on function public.smyl_post_inventory_movement(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz) from public, anon;
grant execute on function public.smyl_post_inventory_movement(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,timestamptz) to authenticated;

-- 5. Mermas, ajustes y correcciones exigen `inventory.adjust`; recibir una compra exige `inventory.purchase`.
--    Disparadores: no reescriben las funciones de inventario. Sin sesión de usuario (consola, migraciones) no bloquean.
create or replace function public.smyl_inventory_movement_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.movement_type in ('waste', 'adjustment_in', 'adjustment_out', 'reversal') then
    if not public.smyl_has_permission(new.tenant_id, 'inventory.adjust') then
      raise exception using errcode = '42501', message = 'No tienes permiso para registrar mermas, ajustes o correcciones.';
    end if;
  elsif new.movement_type = 'receipt' then
    if not public.smyl_has_permission(new.tenant_id, 'inventory.purchase') then
      raise exception using errcode = '42501', message = 'No tienes permiso para recibir compras.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_inventory_movement_guard on public.smyl_inventory_movements;
create trigger smyl_inventory_movement_guard
  before insert on public.smyl_inventory_movements
  for each row execute function public.smyl_inventory_movement_guard();

-- 6. Crear y cancelar pedidos de compra exigen `inventory.purchase`.
create or replace function public.smyl_purchase_order_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not public.smyl_has_permission(new.tenant_id, 'inventory.purchase') then
      raise exception using errcode = '42501', message = 'No tienes permiso para crear pedidos de compra.';
    end if;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled'
        and not public.smyl_has_permission(new.tenant_id, 'inventory.purchase') then
    raise exception using errcode = '42501', message = 'No tienes permiso para cancelar pedidos de compra.';
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_purchase_order_guard on public.smyl_purchase_orders;
create trigger smyl_purchase_order_guard
  before insert or update on public.smyl_purchase_orders
  for each row execute function public.smyl_purchase_order_guard();

commit;
