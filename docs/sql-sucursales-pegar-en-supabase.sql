-- SMYL · Sucursales: pegar COMPLETO en el SQL Editor de Supabase (proyecto rpxshsiwoxdbuevjjpfw) y dar Run.
-- Incluye 2 migraciones idempotentes: (1) chat por sucursal, (2) precio por sucursal.

-- ===== 1/2 · 20261116100000_smyl_conversation_branches =====
-- Mensajería por sucursal: cada conversación puede pertenecer a una sucursal.
--   * La asigna una persona (manual), la IA al preguntar la sede (ai), el canal si cada sede tiene su cuenta (channel)
--     o la cita del paciente (appointment). Sin fila = «Sin asignar».
--   * Solo la lee y escribe la Edge Function lana-inbox con service_role (ahí se aplican los alcances de rol por sucursal);
--     el navegador no accede a esta tabla directamente.
-- Idempotente.
begin;

create table if not exists public.smyl_conversation_branches (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  conversation_id uuid not null,
  branch_id uuid not null,
  source text not null default 'manual' check (source in ('manual','ai','channel','appointment')),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id),
  foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id) on delete cascade
);

create index if not exists smyl_conversation_branches_branch_idx
  on public.smyl_conversation_branches(tenant_id, branch_id);

alter table public.smyl_conversation_branches enable row level security;
revoke all on public.smyl_conversation_branches from public, anon, authenticated;
grant select, insert, update, delete on public.smyl_conversation_branches to service_role;

commit;

-- ===== 2/2 · 20261116160000_smyl_service_branch_prices =====
-- Precio por sucursal: cada servicio conserva su precio base (smyl_services.reference_price) y, si una sede cobra distinto,
-- se guarda solo la excepción aquí. Sin fila = esa sucursal usa el precio base.
--   * Lectura: quien ya consulta agenda, cobros, catálogo o propuestas (el precio se usa al cobrar y cotizar).
--   * Escritura: solo con el permiso «Cambiar precios» (catalog.prices), mediante smyl_set_service_branch_price.
--   * Lo ya cobrado o cotizado no cambia: los cargos y propuestas guardan su propio precio.
-- Idempotente.
begin;

create table if not exists public.smyl_service_branch_prices (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  service_id uuid not null,
  branch_id uuid not null,
  price numeric(12,2) not null check (price >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, service_id, branch_id),
  foreign key (tenant_id, service_id) references public.smyl_services(tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id) on delete cascade
);

create index if not exists smyl_service_branch_prices_branch_idx
  on public.smyl_service_branch_prices(tenant_id, branch_id);

alter table public.smyl_service_branch_prices enable row level security;

drop policy if exists smyl_service_branch_prices_read on public.smyl_service_branch_prices;
create policy smyl_service_branch_prices_read on public.smyl_service_branch_prices
  for select to authenticated
  using (
    public.smyl_has_permission(tenant_id, 'schedule.read')
    or public.smyl_has_permission(tenant_id, 'finance.read')
    or public.smyl_has_permission(tenant_id, 'catalog.manage')
    or public.smyl_has_permission(tenant_id, 'proposal.read')
  );

revoke all on public.smyl_service_branch_prices from public, anon, authenticated;
grant select on public.smyl_service_branch_prices to authenticated;
grant select, insert, update, delete on public.smyl_service_branch_prices to service_role;

create or replace function public.smyl_set_service_branch_price(p_service_id uuid, p_branch_id uuid, p_price numeric)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'catalog.prices') then
    raise exception using errcode = '42501', message = 'No tienes permiso para cambiar precios.';
  end if;
  if not exists (select 1 from public.smyl_services where tenant_id = v_tenant and id = p_service_id)
     or not exists (select 1 from public.smyl_branches where tenant_id = v_tenant and id = p_branch_id) then
    raise exception using errcode = 'P0002', message = 'El servicio o la sucursal no existe.';
  end if;
  if p_price is null then
    delete from public.smyl_service_branch_prices where tenant_id = v_tenant and service_id = p_service_id and branch_id = p_branch_id;
    return;
  end if;
  if p_price < 0 or p_price > 9999999999.99 then
    raise exception using errcode = '22023', message = 'El precio está fuera del rango permitido.';
  end if;
  insert into public.smyl_service_branch_prices (tenant_id, service_id, branch_id, price, updated_by, updated_at)
  values (v_tenant, p_service_id, p_branch_id, round(p_price, 2), auth.uid(), now())
  on conflict (tenant_id, service_id, branch_id)
  do update set price = excluded.price, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.smyl_set_service_branch_price(uuid, uuid, numeric) from public, anon;
grant execute on function public.smyl_set_service_branch_price(uuid, uuid, numeric) to authenticated;

commit;
