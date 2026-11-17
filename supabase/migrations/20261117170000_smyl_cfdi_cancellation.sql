-- SMYL · Cancelación de CFDI en Facturapi SANDBOX: estado de la solicitud en el plan y en el comprobante.
-- Solo la función `facturapi` (service_role) escribe estos datos. Idempotente.
begin;

alter table public.smyl_cfdi_cancellation_plans
  add column if not exists provider_message text not null default '',
  add column if not exists submitted_at timestamptz,
  add column if not exists resolved_at timestamptz;

alter table public.smyl_cfdi_drafts
  add column if not exists cancellation_status text,
  add column if not exists cancelled_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_cfdi_plans_provider_message_check') then
    alter table public.smyl_cfdi_cancellation_plans add constraint smyl_cfdi_plans_provider_message_check
      check (char_length(provider_message) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'smyl_cfdi_drafts_cancellation_status_check') then
    alter table public.smyl_cfdi_drafts add constraint smyl_cfdi_drafts_cancellation_status_check
      check (cancellation_status is null or cancellation_status in ('pending', 'accepted', 'rejected'));
  end if;
end;
$$;

-- La bitácora ahora también registra la cancelación y su verificación.
alter table public.smyl_cfdi_stamp_events drop constraint if exists smyl_cfdi_stamp_events_action_check;
alter table public.smyl_cfdi_stamp_events add constraint smyl_cfdi_stamp_events_action_check
  check (action in ('stamp', 'reconcile', 'download', 'cancel', 'cancel_check'));

commit;
