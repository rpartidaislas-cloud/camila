-- SMYL · Etapa 4: invariantes y aprovisionamiento futuro.
begin;

create or replace function public.smyl_inventory_default_location()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.active then
    insert into public.smyl_inventory_locations(tenant_id,branch_id,name,location_type,created_by)
    values(new.tenant_id,new.id,'Almacén principal','central',new.created_by) on conflict do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists smyl_branch_inventory_location on public.smyl_branches;
create trigger smyl_branch_inventory_location after insert on public.smyl_branches for each row execute function public.smyl_inventory_default_location();

create or replace function public.smyl_validate_inventory_location()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.room_id is not null and not exists(select 1 from public.smyl_rooms r where r.tenant_id=new.tenant_id and r.id=new.room_id and r.branch_id=new.branch_id) then
    raise exception using errcode='23514',message='El espacio no pertenece a la sucursal seleccionada.';
  end if;
  return new;
end; $$;
create trigger smyl_inventory_location_validate before insert or update on public.smyl_inventory_locations for each row execute function public.smyl_validate_inventory_location();

create or replace function public.smyl_reject_immutable_inventory()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  raise exception using errcode='55000',message='Los movimientos confirmados son inmutables; registra una compensación.';
end; $$;
create trigger smyl_inventory_movements_immutable before update or delete on public.smyl_inventory_movements for each row execute function public.smyl_reject_immutable_inventory();
create trigger smyl_inventory_movement_lines_immutable before update or delete on public.smyl_inventory_movement_lines for each row execute function public.smyl_reject_immutable_inventory();

commit;
