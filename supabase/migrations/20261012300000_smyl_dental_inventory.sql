-- SMYL · Etapa 4: inventario y compras dental.
-- El saldo se deriva de movimientos confirmados; nunca se edita directamente.
begin;

create table public.smyl_inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 140),
  contact_name text not null default '', email text not null default '', phone text not null default '',
  tax_id text not null default '', notes text not null default '' check (char_length(notes)<=2000),
  active boolean not null default true, created_by uuid references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,id)
);
create unique index smyl_inventory_suppliers_name_idx on public.smyl_inventory_suppliers(tenant_id,lower(name)) where active;

create table public.smyl_inventory_locations (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid not null, room_id uuid, name text not null check(char_length(btrim(name)) between 2 and 100),
  location_type text not null default 'central' check(location_type in ('central','cabinet','operatory','sterilization','mobile')),
  active boolean not null default true, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,id), foreign key(tenant_id,branch_id) references public.smyl_branches(tenant_id,id),
  foreign key(tenant_id,room_id) references public.smyl_rooms(tenant_id,id)
);
create unique index smyl_inventory_locations_name_idx on public.smyl_inventory_locations(tenant_id,branch_id,lower(name)) where active;

create table public.smyl_inventory_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  sku text not null check(char_length(btrim(sku)) between 1 and 60), name text not null check(char_length(btrim(name)) between 2 and 160),
  category text not null default 'material', unit text not null default 'pieza' check(char_length(btrim(unit)) between 1 and 30),
  description text not null default '' check(char_length(description)<=2000), barcode text not null default '',
  track_lot boolean not null default true, track_expiry boolean not null default false,
  track_serial boolean not null default false, requires_patient_trace boolean not null default false,
  active boolean not null default true, created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,sku), check(not track_expiry or track_lot), check(not track_serial or track_lot), check(not requires_patient_trace or track_lot)
);

create table public.smyl_inventory_reorder_levels (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade, location_id uuid not null, item_id uuid not null,
  minimum_quantity numeric(14,3) not null default 0 check(minimum_quantity>=0), target_quantity numeric(14,3) not null default 0 check(target_quantity>=minimum_quantity),
  updated_by uuid references auth.users(id), updated_at timestamptz not null default now(), primary key(tenant_id,location_id,item_id),
  foreign key(tenant_id,location_id) references public.smyl_inventory_locations(tenant_id,id),
  foreign key(tenant_id,item_id) references public.smyl_inventory_items(tenant_id,id)
);

create table public.smyl_inventory_lots (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  item_id uuid not null, supplier_id uuid, lot_code text not null default '' check(char_length(lot_code)<=100),
  serial_number text not null default '' check(char_length(serial_number)<=140), expires_on date,
  received_at timestamptz not null default now(), created_by uuid references auth.users(id), created_at timestamptz not null default now(),
  unique(tenant_id,id), foreign key(tenant_id,item_id) references public.smyl_inventory_items(tenant_id,id),
  foreign key(tenant_id,supplier_id) references public.smyl_inventory_suppliers(tenant_id,id)
);
create unique index smyl_inventory_lots_identity_idx on public.smyl_inventory_lots(tenant_id,item_id,lower(lot_code),lower(serial_number));
create index smyl_inventory_lots_expiry_idx on public.smyl_inventory_lots(tenant_id,expires_on) where expires_on is not null;

create table public.smyl_purchase_orders (
  id uuid primary key, tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  supplier_id uuid not null, destination_location_id uuid not null, reference text not null default '' check(char_length(reference)<=100),
  status text not null default 'ordered' check(status in ('ordered','partially_received','received','cancelled')),
  expected_on date, notes text not null default '' check(char_length(notes)<=2000), revision integer not null default 1 check(revision>0),
  ordered_at timestamptz not null default now(), received_at timestamptz, created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tenant_id,id),
  foreign key(tenant_id,supplier_id) references public.smyl_inventory_suppliers(tenant_id,id),
  foreign key(tenant_id,destination_location_id) references public.smyl_inventory_locations(tenant_id,id)
);
create index smyl_purchase_orders_status_idx on public.smyl_purchase_orders(tenant_id,status,ordered_at desc);

create table public.smyl_purchase_order_lines (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  purchase_order_id uuid not null, item_id uuid not null, ordered_quantity numeric(14,3) not null check(ordered_quantity>0),
  received_quantity numeric(14,3) not null default 0 check(received_quantity>=0 and received_quantity<=ordered_quantity),
  unit_cost numeric(14,4) check(unit_cost is null or unit_cost>=0), created_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,purchase_order_id,item_id),
  foreign key(tenant_id,purchase_order_id) references public.smyl_purchase_orders(tenant_id,id) on delete cascade,
  foreign key(tenant_id,item_id) references public.smyl_inventory_items(tenant_id,id)
);

create table public.smyl_inventory_movements (
  id uuid primary key, tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  idempotency_key uuid not null, movement_type text not null check(movement_type in ('receipt','transfer','consumption','waste','adjustment_in','adjustment_out','reversal')),
  source_location_id uuid, destination_location_id uuid, patient_id uuid, appointment_id uuid, professional_id uuid,
  purchase_order_id uuid, reversal_of uuid, reason text not null check(char_length(btrim(reason)) between 2 and 500),
  occurred_at timestamptz not null default now(), confirmed_at timestamptz not null default now(), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,idempotency_key),
  foreign key(tenant_id,source_location_id) references public.smyl_inventory_locations(tenant_id,id),
  foreign key(tenant_id,destination_location_id) references public.smyl_inventory_locations(tenant_id,id),
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id),
  foreign key(tenant_id,appointment_id) references public.smyl_appointments(tenant_id,id),
  foreign key(tenant_id,professional_id) references public.smyl_professionals(tenant_id,id),
  foreign key(tenant_id,purchase_order_id) references public.smyl_purchase_orders(tenant_id,id),
  foreign key(tenant_id,reversal_of) references public.smyl_inventory_movements(tenant_id,id),
  check(source_location_id is not null or destination_location_id is not null),
  check(source_location_id is null or destination_location_id is null or source_location_id<>destination_location_id)
);
create index smyl_inventory_movements_date_idx on public.smyl_inventory_movements(tenant_id,occurred_at desc);

create table public.smyl_inventory_movement_lines (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  movement_id uuid not null, item_id uuid not null, lot_id uuid, quantity numeric(14,3) not null check(quantity>0),
  unit_cost numeric(14,4) check(unit_cost is null or unit_cost>=0), created_at timestamptz not null default now(),
  unique(tenant_id,id), foreign key(tenant_id,movement_id) references public.smyl_inventory_movements(tenant_id,id),
  foreign key(tenant_id,item_id) references public.smyl_inventory_items(tenant_id,id),
  foreign key(tenant_id,lot_id) references public.smyl_inventory_lots(tenant_id,id)
);
create index smyl_inventory_movement_lines_lookup_idx on public.smyl_inventory_movement_lines(tenant_id,item_id,lot_id);
create unique index smyl_inventory_movement_lines_unique_idx on public.smyl_inventory_movement_lines(tenant_id,movement_id,item_id,coalesce(lot_id,'00000000-0000-0000-0000-000000000000'::uuid));

create table public.smyl_service_materials (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade, service_id uuid not null, item_id uuid not null,
  expected_quantity numeric(14,3) not null check(expected_quantity>0), updated_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  primary key(tenant_id,service_id,item_id), foreign key(tenant_id,service_id) references public.smyl_services(tenant_id,id),
  foreign key(tenant_id,item_id) references public.smyl_inventory_items(tenant_id,id)
);

-- Una ubicación central por sucursal existente; no inventa saldos.
insert into public.smyl_inventory_locations(tenant_id,branch_id,name,location_type)
select b.tenant_id,b.id,'Almacén principal','central' from public.smyl_branches b where b.active
on conflict do nothing;

do $$ declare t text;
begin
  foreach t in array array['smyl_inventory_suppliers','smyl_inventory_locations','smyl_inventory_items','smyl_inventory_reorder_levels','smyl_inventory_lots','smyl_purchase_orders','smyl_purchase_order_lines','smyl_inventory_movements','smyl_inventory_movement_lines','smyl_service_materials'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I on public.%I for select to authenticated using (public.smyl_has_permission(tenant_id,''inventory.read''))',t||'_read',t);
  end loop;
end $$;

create policy smyl_inventory_suppliers_manage on public.smyl_inventory_suppliers for all to authenticated using(public.smyl_has_permission(tenant_id,'inventory.manage')) with check(public.smyl_has_permission(tenant_id,'inventory.manage'));
create policy smyl_inventory_locations_manage on public.smyl_inventory_locations for all to authenticated using(public.smyl_has_permission(tenant_id,'inventory.manage')) with check(public.smyl_has_permission(tenant_id,'inventory.manage'));
create policy smyl_inventory_items_manage on public.smyl_inventory_items for all to authenticated using(public.smyl_has_permission(tenant_id,'inventory.manage')) with check(public.smyl_has_permission(tenant_id,'inventory.manage'));
create policy smyl_inventory_reorder_levels_manage on public.smyl_inventory_reorder_levels for all to authenticated using(public.smyl_has_permission(tenant_id,'inventory.manage')) with check(public.smyl_has_permission(tenant_id,'inventory.manage'));
create policy smyl_service_materials_manage on public.smyl_service_materials for all to authenticated using(public.smyl_has_permission(tenant_id,'inventory.manage')) with check(public.smyl_has_permission(tenant_id,'inventory.manage'));

revoke all on table public.smyl_inventory_suppliers,public.smyl_inventory_locations,public.smyl_inventory_items,public.smyl_inventory_reorder_levels,public.smyl_inventory_lots,public.smyl_purchase_orders,public.smyl_purchase_order_lines,public.smyl_inventory_movements,public.smyl_inventory_movement_lines,public.smyl_service_materials from anon,authenticated;
grant select on table public.smyl_inventory_suppliers,public.smyl_inventory_locations,public.smyl_inventory_items,public.smyl_inventory_reorder_levels,public.smyl_inventory_lots,public.smyl_purchase_orders,public.smyl_purchase_order_lines,public.smyl_inventory_movements,public.smyl_inventory_movement_lines,public.smyl_service_materials to authenticated;
grant insert,update on table public.smyl_inventory_suppliers,public.smyl_inventory_locations,public.smyl_inventory_items,public.smyl_inventory_reorder_levels,public.smyl_service_materials to authenticated;

create trigger smyl_inventory_suppliers_touch before update on public.smyl_inventory_suppliers for each row execute function public.smyl_touch_updated_at();
create trigger smyl_inventory_locations_touch before update on public.smyl_inventory_locations for each row execute function public.smyl_touch_updated_at();
create trigger smyl_inventory_items_touch before update on public.smyl_inventory_items for each row execute function public.smyl_touch_updated_at();
create trigger smyl_purchase_orders_touch before update on public.smyl_purchase_orders for each row execute function public.smyl_touch_updated_at();
create trigger smyl_inventory_suppliers_audit after insert or update or delete on public.smyl_inventory_suppliers for each row execute function public.smyl_audit_row();
create trigger smyl_inventory_locations_audit after insert or update or delete on public.smyl_inventory_locations for each row execute function public.smyl_audit_row();
create trigger smyl_inventory_items_audit after insert or update or delete on public.smyl_inventory_items for each row execute function public.smyl_audit_row();
create trigger smyl_purchase_orders_audit after insert or update or delete on public.smyl_purchase_orders for each row execute function public.smyl_audit_row();
create trigger smyl_inventory_movements_audit after insert or update or delete on public.smyl_inventory_movements for each row execute function public.smyl_audit_row();

commit;
