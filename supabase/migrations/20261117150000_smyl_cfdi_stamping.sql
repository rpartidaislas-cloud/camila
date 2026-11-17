-- SMYL · Timbrado en Facturapi SANDBOX: datos de la factura emitida y bitácora de cada intento.
-- Solo la función `facturapi` (service_role) escribe estos datos; el navegador los lee con la política de borradores.
-- Idempotente. No cambia borradores existentes.
begin;

alter table public.smyl_cfdi_drafts
  add column if not exists provider_invoice_id text,
  add column if not exists invoice_series text,
  add column if not exists invoice_folio integer,
  add column if not exists payment_form text,
  add column if not exists stamp_attempts integer not null default 0,
  add column if not exists stamp_requested_at timestamptz,
  add column if not exists stamped_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_cfdi_drafts_payment_form_check') then
    alter table public.smyl_cfdi_drafts add constraint smyl_cfdi_drafts_payment_form_check
      check (payment_form is null or payment_form ~ '^\d{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'smyl_cfdi_drafts_issued_check') then
    alter table public.smyl_cfdi_drafts add constraint smyl_cfdi_drafts_issued_check
      check (status <> 'issued' or (external_uuid is not null and provider_invoice_id is not null and stamped_at is not null)) not valid;
  end if;
end;
$$;

create table if not exists public.smyl_cfdi_stamp_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  draft_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('stamp', 'reconcile', 'download')),
  status text not null check (status in ('success', 'failed', 'pending')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, draft_id) references public.smyl_cfdi_drafts (tenant_id, id) on delete restrict
);
create index if not exists smyl_cfdi_stamp_events_draft_idx on public.smyl_cfdi_stamp_events (tenant_id, draft_id, created_at desc);

alter table public.smyl_cfdi_stamp_events enable row level security;
drop policy if exists smyl_cfdi_stamp_events_read on public.smyl_cfdi_stamp_events;
create policy smyl_cfdi_stamp_events_read on public.smyl_cfdi_stamp_events
  for select to authenticated using (public.smyl_has_permission(tenant_id, 'finance.read'));
revoke all on table public.smyl_cfdi_stamp_events from public, anon, authenticated;
grant select on table public.smyl_cfdi_stamp_events to authenticated;
grant select, insert on table public.smyl_cfdi_stamp_events to service_role;

commit;
