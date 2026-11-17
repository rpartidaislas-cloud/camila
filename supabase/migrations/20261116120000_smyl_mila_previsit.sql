-- MILA · Entrevista previa a la cita (el paciente la responde desde su celular) y seguimiento.
--
-- Reutiliza smyl_mila_interviews: una fila «previsit» es una entrevista que la clínica envía al paciente
-- (WhatsApp o enlace). El paciente elige — o la clínica fija — si platica con MILA por voz o llena un
-- formulario. El resultado sigue siendo un BORRADOR: el dentista lo revisa y guarda en la historia.
-- Solo la Edge Function `mila-interview` (service role) lee y escribe.

alter table public.smyl_mila_interviews
  add column if not exists kind text not null default 'clinic',
  add column if not exists previsit_mode text,
  add column if not exists appointment_id uuid,
  add column if not exists appointment_label text,
  add column if not exists sent_via text,
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_attempts integer not null default 0,
  add column if not exists submitted_at timestamptz;

alter table public.smyl_mila_interviews drop constraint if exists smyl_mila_interviews_kind_check;
alter table public.smyl_mila_interviews add constraint smyl_mila_interviews_kind_check
  check (kind in ('clinic', 'previsit'));
alter table public.smyl_mila_interviews drop constraint if exists smyl_mila_interviews_previsit_mode_check;
alter table public.smyl_mila_interviews add constraint smyl_mila_interviews_previsit_mode_check
  check (previsit_mode is null or previsit_mode in ('voice', 'form', 'choice'));
alter table public.smyl_mila_interviews drop constraint if exists smyl_mila_interviews_sent_via_check;
alter table public.smyl_mila_interviews add constraint smyl_mila_interviews_sent_via_check
  check (sent_via is null or sent_via in ('whatsapp', 'link'));
alter table public.smyl_mila_interviews drop constraint if exists smyl_mila_interviews_identity_attempts_check;
alter table public.smyl_mila_interviews add constraint smyl_mila_interviews_identity_attempts_check
  check (identity_attempts between 0 and 20);
alter table public.smyl_mila_interviews drop constraint if exists smyl_mila_interviews_appointment_label_check;
alter table public.smyl_mila_interviews add constraint smyl_mila_interviews_appointment_label_check
  check (appointment_label is null or char_length(appointment_label) <= 120);

create index if not exists smyl_mila_interviews_patient_kind_idx
  on public.smyl_mila_interviews (tenant_id, patient_id, kind, created_at desc);

comment on column public.smyl_mila_interviews.kind is
  'clinic = entrevista en consultorio (QR); previsit = enviada al paciente antes de la cita.';
