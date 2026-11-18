-- SMYL · Datos fiscales del paciente: domicilio fiscal y estatus en el padrón (opcionales).
-- El CFDI 4.0 solo exige el código postal; estos datos se guardan como información administrativa y se llenan
-- al leer la Constancia de Situación Fiscal (fiscal-extract) o a mano. Solo añade columnas con valor vacío por
-- omisión: no cambia datos existentes, permisos ni RLS (la tabla conserva sus políticas). Idempotente.
begin;
alter table public.smyl_patient_fiscal_profiles
  add column if not exists street text not null default '',
  add column if not exists exterior_number text not null default '',
  add column if not exists interior_number text not null default '',
  add column if not exists neighborhood text not null default '',
  add column if not exists locality text not null default '',
  add column if not exists municipality text not null default '',
  add column if not exists state text not null default '',
  add column if not exists sat_status text not null default '';

alter table public.smyl_patient_fiscal_profiles drop constraint if exists smyl_patient_fiscal_address_lengths;
alter table public.smyl_patient_fiscal_profiles add constraint smyl_patient_fiscal_address_lengths check (
  char_length(street) <= 120 and char_length(exterior_number) <= 20 and char_length(interior_number) <= 20 and
  char_length(neighborhood) <= 120 and char_length(locality) <= 120 and char_length(municipality) <= 120 and
  char_length(state) <= 120 and char_length(sat_status) <= 40
);
commit;
