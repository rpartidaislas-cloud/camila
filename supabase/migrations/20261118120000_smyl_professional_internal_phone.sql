-- Equipo · teléfono interno del profesional.
--   * smyl_professionals.phone: teléfono de contacto interno del doctor, para el equipo de la clínica.
--     NO es el teléfono público del directorio (smyl_professional_profiles.public_phone) y no se publica en ningún lado:
--     las vistas y funciones públicas del directorio seleccionan columnas explícitas.
--   * Sólo dígitos y signos habituales (+ ( ) - . espacio), hasta 40 caracteres: así no entra texto libre ni marcado.
--   * Quién lo lee y quién lo cambia no se toca: lectura para los miembros de la clínica (smyl_professionals_read) y
--     escritura con team.manage (smyl_professionals_update), como el resto de la ficha. La bitácora ya audita la tabla.
-- No modifica filas existentes (quedan con teléfono vacío). Idempotente.

alter table public.smyl_professionals
  add column if not exists phone text not null default '';

alter table public.smyl_professionals
  drop constraint if exists smyl_professionals_phone_check;
alter table public.smyl_professionals
  add constraint smyl_professionals_phone_check
  check (phone ~ '^[0-9 +().-]{0,40}$');
