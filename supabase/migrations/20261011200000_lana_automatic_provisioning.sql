-- Etapa 1 SMYL: una solicitud estable por clínica para aprovisionar LANA.
-- Solo Edge Functions con service_role acceden; la UI nunca recibe la API key.

create table if not exists public.camila_lana_provisioning (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  request_id uuid not null unique default gen_random_uuid(),
  requested_clinic_name text not null,
  requested_owner_email text,
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed')),
  lana_tenant_id uuid,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.camila_lana_provisioning enable row level security;
revoke all on public.camila_lana_provisioning from public, anon, authenticated;

comment on table public.camila_lana_provisioning is
  'Estado e idempotencia del aprovisionamiento LANA por clínica SMYL. No almacena credenciales.';
