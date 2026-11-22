-- Credenciales del profesional para recetas, notas firmadas y perfil público: cédula de especialidad.
-- (La institución que expidió el título llegó en 20261122100000_smyl_professional_license_institution.sql.
--  Las recetas viven en 20261125130000_smyl_prescriptions.sql.)
-- Idempotente.
alter table public.smyl_professionals
  add column if not exists specialty_license text not null default '';
do $$ begin
  alter table public.smyl_professionals drop constraint if exists smyl_professionals_specialty_license_check;
  alter table public.smyl_professionals add constraint smyl_professionals_specialty_license_check check (char_length(specialty_license) <= 30);
end $$;
