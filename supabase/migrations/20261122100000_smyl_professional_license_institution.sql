-- Receta médica (base técnica): institución que expidió el título del profesional.
-- La receta impresa lleva los datos del profesional (nombre, cédula, institución, domicilio). La cédula ya existe en el perfil;
-- aquí se agrega la institución. Es un dato PRIVADO de la clínica (no se expone en el directorio público ni en el perfil publicado).
-- Aditiva e idempotente. La tabla ya concede select/insert/update a authenticated con RLS por clínica, así que no cambia ningún permiso.
begin;

alter table public.smyl_professionals
  add column if not exists license_institution text not null default ''
  check (char_length(license_institution) <= 120);

comment on column public.smyl_professionals.license_institution is
  'Institución que expidió el título profesional (para la receta impresa). Privado: no se publica.';

commit;
