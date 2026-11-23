-- SMYL · Información para el paciente en la confirmación de cita.
-- Aditiva e idempotente. Dos textos cortos que la clínica escribe y el mensaje de confirmación del chat reutiliza:
--   · smyl_branches.arrival_notes: cómo llegar o estacionarse.
--   · smyl_services.prep_instructions: qué hacer antes de la cita.
-- Sin políticas nuevas: ya los cubren las de lectura/escritura de cada tabla.
begin;

alter table public.smyl_branches
  add column if not exists arrival_notes text not null default '';
alter table public.smyl_services
  add column if not exists prep_instructions text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_branches_arrival_notes_length') then
    alter table public.smyl_branches add constraint smyl_branches_arrival_notes_length check (char_length(arrival_notes) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'smyl_services_prep_instructions_length') then
    alter table public.smyl_services add constraint smyl_services_prep_instructions_length check (char_length(prep_instructions) <= 400);
  end if;
end;
$$;

comment on column public.smyl_branches.arrival_notes is 'Texto breve para el paciente: cómo llegar o dónde estacionarse. Se incluye en el mensaje de confirmación.';
comment on column public.smyl_services.prep_instructions is 'Texto breve para el paciente: qué hacer antes de la cita. Se incluye en el mensaje de confirmación.';
commit;
