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
