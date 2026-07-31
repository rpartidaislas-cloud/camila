-- camila_tenants no existía en la base de datos real, aunque simulacion.html,
-- index.html y app.html la usan desde hace tiempo para registro de clínica,
-- branding/config y límites de plan -- registro de clínica nueva y refresco
-- de config/marca fallaban en silencio. Se recrea con el esquema exacto que
-- ese código ya espera, más stripe_customer_id/stripe_subscription_id que
-- stripe_billing.sql ya asumía que existían en esta tabla.
--
-- Aplicado directamente en Supabase (proyecto "Smyl") el 2026-07-30; este
-- archivo es para que quede en el historial del repo, igual que
-- stripe_billing.sql.
create table if not exists public.camila_tenants (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  email text,
  plan text,
  limite_diagnosticos integer,
  diagnosticos_usados integer default 0,
  activo boolean default true,
  vence_en timestamptz,
  config jsonb default '{}'::jsonb,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz default now()
);

alter table public.camila_tenants enable row level security;

-- Cada dentista solo ve/edita su propia fila (id = su propio auth.uid()).
-- No hay concepto todavía de "varios usuarios por clínica" -- eso es un
-- rediseño más grande (tabla de membresías), no algo para meter aquí de
-- paso.
create policy camila_tenants_select_own on public.camila_tenants
  for select to authenticated
  using (id = (select auth.uid()));

create policy camila_tenants_insert_own on public.camila_tenants
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy camila_tenants_update_own on public.camila_tenants
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
