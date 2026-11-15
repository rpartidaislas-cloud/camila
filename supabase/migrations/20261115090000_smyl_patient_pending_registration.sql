-- Paciente "por registrar": se agenda con solo teléfono y se completa cuando llega.
-- Aditiva: filas existentes quedan 'completo'. No cambia RLS ni grants.
alter table public.camila_pacientes
  add column if not exists registro_estado text not null default 'completo';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'camila_pacientes_registro_estado_check') then
    alter table public.camila_pacientes
      add constraint camila_pacientes_registro_estado_check check (registro_estado in ('completo','pendiente'));
  end if;
end $$;

create index if not exists camila_pacientes_registro_pendiente_idx
  on public.camila_pacientes (tenant_id) where registro_estado = 'pendiente';
