-- MILA · Entrevista previa automática y su seguimiento en la agenda.
--
-- smyl_mila_previsit_settings: por clínica, si la entrevista previa sale sola, cuántas horas antes de la
--   cita, en qué modo (voz, formulario o que el paciente elija) y a quién (sin historia / historia de más
--   de un año / todos).
-- smyl_mila_previsit_dispatches: una fila por cita a la que ya se le envió (o se intentó enviar) la
--   entrevista previa. Evita reenvíos aunque la entrevista se descarte o venza, y alimenta las marcas de
--   la agenda («Enviada», «Respondida», «No se pudo enviar»).
-- Solo la Edge Function `mila-interview` (service role) lee y escribe; RLS activo sin políticas.

create table if not exists public.smyl_mila_previsit_settings (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  enabled boolean not null default false,
  hours_before integer not null default 48 check (hours_before between 12 and 168),
  mode text not null default 'choice' check (mode in ('voice', 'form', 'choice')),
  audience text not null default 'stale' check (audience in ('no_history', 'stale', 'all')),
  last_dispatch_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.smyl_mila_previsit_dispatches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  appointment_id uuid not null,
  patient_id uuid not null,
  interview_id uuid,
  origin text not null default 'manual' check (origin in ('manual', 'auto')),
  status text not null default 'sent' check (status in ('sent', 'link', 'failed', 'skipped', 'reviewed')),
  reason text check (reason is null or char_length(reason) <= 60),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, appointment_id)
);

create index if not exists smyl_mila_previsit_dispatches_patient_idx
  on public.smyl_mila_previsit_dispatches (tenant_id, patient_id, created_at desc);

alter table public.smyl_mila_previsit_settings enable row level security;
alter table public.smyl_mila_previsit_dispatches enable row level security;
revoke all on public.smyl_mila_previsit_settings from public, anon, authenticated;
revoke all on public.smyl_mila_previsit_dispatches from public, anon, authenticated;

comment on table public.smyl_mila_previsit_settings is
  'Envío automático de la entrevista previa de MILA por clínica. Solo service role (Edge Function mila-interview).';
comment on table public.smyl_mila_previsit_dispatches is
  'Entrevistas previas enviadas por cita (manual o automática). Solo service role.';
