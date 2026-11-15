-- SMYL · Inventario: pegar completo en el SQL Editor de Supabase (proyecto rpxshsiwoxdbuevjjpfw) y dar Run.
-- Incluye 2 migraciones idempotentes: (1) costos/presentación del insumo, (2) último movimiento (alerta «sin movimiento»).

-- ===== 1/2 · 20261114140000_smyl_inventory_item_costs =====
-- Inventario · costo y presentación en el insumo, existencia inicial y reporte de consumo por profesional.
--   * smyl_inventory_items: reference_cost (costo por unidad, IVA INCLUIDO: en servicios dentales exentos el IVA de los insumos
--     no es acreditable, así que el costo real es el que se pagó), package_label/package_quantity (p. ej. «caja» de 50 piezas)
--     y preferred_supplier_id. Los datos nuevos son opcionales: ningún insumo existente cambia.
--   * smyl_inventory_historical_unit_cost: si un insumo/lote aún no tiene entradas con costo, usa su reference_cost. Las salidas
--     siguen congelando el costo en la línea (no se revalúa nada ya confirmado).
--   * smyl_register_initial_stock: alta de existencia inicial (crea el lote si hace falta y registra un ajuste de entrada con costo).
--   * smyl_inventory_consumption_report: consumo clínico por profesional, tratamiento e insumo en un periodo (sin el tope de los
--     últimos 100 movimientos de la pantalla).
-- Idempotente.

alter table public.smyl_inventory_items
  add column if not exists reference_cost numeric(14,4),
  add column if not exists package_label text not null default '',
  add column if not exists package_quantity numeric(14,3),
  add column if not exists preferred_supplier_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_inventory_items_reference_cost_check') then
    alter table public.smyl_inventory_items add constraint smyl_inventory_items_reference_cost_check
      check (reference_cost is null or reference_cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'smyl_inventory_items_package_check') then
    alter table public.smyl_inventory_items add constraint smyl_inventory_items_package_check
      check (
        (package_quantity is null and package_label = '')
        or (package_quantity is not null and package_quantity > 0 and char_length(btrim(package_label)) between 1 and 30)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'smyl_inventory_items_preferred_supplier_fk') then
    alter table public.smyl_inventory_items add constraint smyl_inventory_items_preferred_supplier_fk
      foreign key (tenant_id, preferred_supplier_id) references public.smyl_inventory_suppliers (tenant_id, id);
  end if;
end;
$$;

-- Costo histórico: promedio ponderado de las entradas con costo hasta ese momento; sin entradas, el costo de referencia del insumo.
create or replace function public.smyl_inventory_historical_unit_cost(
  p_tenant uuid,
  p_item uuid,
  p_lot uuid,
  p_at timestamptz
) returns numeric
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select sum(l.quantity * l.unit_cost) / nullif(sum(l.quantity), 0)
      from public.smyl_inventory_movement_lines l
      join public.smyl_inventory_movements m
        on m.tenant_id = l.tenant_id and m.id = l.movement_id
      where l.tenant_id = p_tenant
        and l.item_id = p_item
        and l.lot_id is not distinct from p_lot
        and l.unit_cost is not null
        and m.movement_type in ('receipt', 'adjustment_in')
        and m.occurred_at <= coalesce(p_at, now())
        and not exists (
          select 1 from public.smyl_inventory_movements reversal
          where reversal.tenant_id = m.tenant_id and reversal.reversal_of = m.id
        )
    ),
    (select i.reference_cost from public.smyl_inventory_items i where i.tenant_id = p_tenant and i.id = p_item)
  );
$$;
revoke all on function public.smyl_inventory_historical_unit_cost(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.smyl_register_initial_stock(
  p_item_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_lot_code text default '',
  p_expires_on date default null,
  p_unit_cost numeric default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_item public.smyl_inventory_items;
  v_lot_id uuid;
  v_code text;
  v_movement uuid := gen_random_uuid();
  v_existing uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'inventory.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar existencia inicial.';
  end if;
  select id into v_existing from public.smyl_inventory_movements where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'La cantidad inicial debe ser mayor a cero.';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception using errcode = '22023', message = 'El costo no puede ser negativo.';
  end if;
  select * into v_item from public.smyl_inventory_items where tenant_id = v_tenant and id = p_item_id and active;
  if not found then
    raise exception using errcode = 'P0002', message = 'El insumo no existe o está inactivo.';
  end if;
  if v_item.track_serial then
    raise exception using errcode = '23514', message = 'Los insumos con número de serie se dan de alta con una compra o una recepción.';
  end if;
  if v_item.track_lot then
    v_code := coalesce(nullif(btrim(p_lot_code), ''), 'INICIAL');
    if v_item.track_expiry and p_expires_on is null then
      raise exception using errcode = '23514', message = 'Captura la fecha de caducidad de este insumo.';
    end if;
    select id into v_lot_id from public.smyl_inventory_lots
      where tenant_id = v_tenant and item_id = v_item.id and lower(lot_code) = lower(v_code) and serial_number = '';
    if v_lot_id is null then
      insert into public.smyl_inventory_lots (tenant_id, item_id, lot_code, serial_number, expires_on, created_by)
      values (v_tenant, v_item.id, v_code, '', p_expires_on, auth.uid()) returning id into v_lot_id;
    end if;
  end if;
  return public.smyl_post_inventory_movement(
    v_movement, p_idempotency_key, 'adjustment_in', null, p_location_id, null, null, null, 'Existencia inicial',
    jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'lot_id', v_lot_id, 'quantity', p_quantity,
      'unit_cost', coalesce(p_unit_cost, v_item.reference_cost))),
    now()
  );
end;
$function$;

revoke all on function public.smyl_register_initial_stock(uuid, uuid, numeric, text, date, numeric, uuid) from public, anon;
grant execute on function public.smyl_register_initial_stock(uuid, uuid, numeric, text, date, numeric, uuid) to authenticated;

create or replace function public.smyl_inventory_consumption_report(p_from date, p_to date)
returns table (
  professional_id uuid, professional_name text,
  service_id uuid, service_name text,
  item_id uuid, item_name text, unit text,
  movements bigint, quantity numeric, cost numeric, uncosted_quantity numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'inventory.read') then
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar el consumo de inventario.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception using errcode = '22023', message = 'Elige un periodo de hasta 400 días.';
  end if;
  return query
  select pr.id, coalesce(pr.display_name, 'Sin profesional')::text,
         s.id, coalesce(s.name, 'Sin tratamiento')::text,
         i.id, i.name::text, i.unit::text,
         count(distinct m.id), sum(l.quantity)::numeric,
         sum(l.quantity * l.unit_cost) filter (where l.unit_cost is not null)::numeric,
         coalesce(sum(l.quantity) filter (where l.unit_cost is null), 0)::numeric
  from public.smyl_inventory_movements m
  join public.smyl_inventory_movement_lines l on l.tenant_id = m.tenant_id and l.movement_id = m.id
  join public.smyl_inventory_items i on i.tenant_id = l.tenant_id and i.id = l.item_id
  left join public.smyl_professionals pr on pr.tenant_id = m.tenant_id and pr.id = m.professional_id
  left join public.smyl_appointments a on a.tenant_id = m.tenant_id and a.id = m.appointment_id
  left join public.smyl_services s on s.tenant_id = a.tenant_id and s.id = a.service_id
  where m.tenant_id = v_tenant
    and m.movement_type = 'consumption'
    and m.occurred_at >= p_from::timestamptz
    and m.occurred_at < (p_to + 1)::timestamptz
    and not exists (select 1 from public.smyl_inventory_movements r where r.tenant_id = m.tenant_id and r.reversal_of = m.id)
  group by pr.id, pr.display_name, s.id, s.name, i.id, i.name, i.unit;
end;
$function$;

revoke all on function public.smyl_inventory_consumption_report(date, date) from public, anon;
grant execute on function public.smyl_inventory_consumption_report(date, date) to authenticated;

-- Registros de consumo por profesional/tratamiento (cada movimiento pertenece a un solo par): permite mostrar cuántas veces
-- registró consumo cada profesional sin duplicar el conteo por insumo.
create or replace function public.smyl_inventory_consumption_totals(p_from date, p_to date)
returns table (professional_id uuid, service_id uuid, movements bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'inventory.read') then
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar el consumo de inventario.';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception using errcode = '22023', message = 'Elige un periodo de hasta 400 días.';
  end if;
  return query
  select m.professional_id, a.service_id, count(*)::bigint
  from public.smyl_inventory_movements m
  left join public.smyl_appointments a on a.tenant_id = m.tenant_id and a.id = m.appointment_id
  where m.tenant_id = v_tenant
    and m.movement_type = 'consumption'
    and m.occurred_at >= p_from::timestamptz
    and m.occurred_at < (p_to + 1)::timestamptz
    and not exists (select 1 from public.smyl_inventory_movements r where r.tenant_id = m.tenant_id and r.reversal_of = m.id)
  group by m.professional_id, a.service_id;
end;
$function$;

revoke all on function public.smyl_inventory_consumption_totals(date, date) from public, anon;
grant execute on function public.smyl_inventory_consumption_totals(date, date) to authenticated;

-- ===== 2/2 · 20261114150000_smyl_inventory_last_movements =====
-- Inventario: fecha del último movimiento por insumo y ubicación (alerta «sin movimiento»).
-- Solo lectura; no toca tablas ni funciones existentes.
begin;

create or replace function public.smyl_inventory_last_movements(p_location_id uuid default null)
returns table(location_id uuid, item_id uuid, last_moved_at timestamptz)
language plpgsql security definer stable set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'inventory.read') then
    raise exception using errcode='42501', message='No tienes permiso para consultar inventario.';
  end if;
  return query
  with c as (
    select m.destination_location_id loc, l.item_id, m.occurred_at at
      from public.smyl_inventory_movements m join public.smyl_inventory_movement_lines l on l.tenant_id=m.tenant_id and l.movement_id=m.id
     where m.tenant_id=v_tenant and m.destination_location_id is not null
    union all
    select m.source_location_id, l.item_id, m.occurred_at
      from public.smyl_inventory_movements m join public.smyl_inventory_movement_lines l on l.tenant_id=m.tenant_id and l.movement_id=m.id
     where m.tenant_id=v_tenant and m.source_location_id is not null
  )
  select c.loc, c.item_id, max(c.at) from c where (p_location_id is null or c.loc=p_location_id) group by c.loc, c.item_id;
end; $$;

revoke all on function public.smyl_inventory_last_movements(uuid) from public,anon;
grant execute on function public.smyl_inventory_last_movements(uuid) to authenticated;

commit;
