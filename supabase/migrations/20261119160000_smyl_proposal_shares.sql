-- Compartir una propuesta aprobada con el paciente mediante un enlace privado (propuesta.html).
-- El doctor elige qué viaja (odontograma, fotografías/simulación, resumen de historial); el plan y los precios siempre. Lo
-- compartido es una COPIA CONGELADA (snapshot): editar la propuesta después no cambia lo ya enviado. El enlace lleva un token
-- aleatorio de 256 bits (aquí solo su SHA-256), vence y se puede cancelar. Solo service_role (Edge Function smyl-proposal-share).
begin;

create table if not exists public.smyl_proposal_shares (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  proposal_id uuid not null references public.smyl_proposals(id) on delete cascade,
  proposal_revision integer not null check (proposal_revision > 0),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  sections jsonb not null check (jsonb_typeof(sections) = 'object'),
  history_summary text not null default '' check (char_length(history_summary) <= 1200),
  payment_note text not null default '' check (char_length(payment_note) <= 500),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  open_count integer not null default 0,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  interested_at timestamptz,
  interest_note text not null default '' check (char_length(interest_note) <= 300),
  accepted_at timestamptz,
  consent_version text,
  consent_text_hash text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smyl_proposal_shares_token_uk unique (token_hash),
  check ((accepted_at is null) = (consent_version is null))
);
create index if not exists smyl_proposal_shares_proposal_idx on public.smyl_proposal_shares (tenant_id, proposal_id, created_at desc);

alter table public.smyl_proposal_shares enable row level security;
revoke all on public.smyl_proposal_shares from public, anon, authenticated;
grant all on public.smyl_proposal_shares to service_role;
comment on table public.smyl_proposal_shares is 'Propuestas compartidas con el paciente por enlace privado. snapshot = copia congelada. Solo service_role.';

commit;
