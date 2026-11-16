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
