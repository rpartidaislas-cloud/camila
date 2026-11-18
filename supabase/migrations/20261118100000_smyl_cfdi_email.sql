-- SMYL · Envío del CFDI por correo (Facturapi): última vez y destinatario (enmascarado) en el comprobante.
-- La dirección completa NO se guarda: solo «j***@dominio.com». Solo la función `facturapi` (service_role) escribe. Idempotente.
begin;

alter table public.smyl_cfdi_drafts
  add column if not exists last_emailed_at timestamptz,
  add column if not exists last_emailed_to text,
  add column if not exists email_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_cfdi_drafts_last_emailed_to_check') then
    alter table public.smyl_cfdi_drafts add constraint smyl_cfdi_drafts_last_emailed_to_check
      check (last_emailed_to is null or char_length(last_emailed_to) <= 120);
  end if;
end;
$$;

alter table public.smyl_cfdi_stamp_events drop constraint if exists smyl_cfdi_stamp_events_action_check;
alter table public.smyl_cfdi_stamp_events add constraint smyl_cfdi_stamp_events_action_check
  check (action in ('stamp', 'reconcile', 'download', 'cancel', 'cancel_check', 'email'));

commit;
