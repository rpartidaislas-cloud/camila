-- SMYL · ciclo de vida de la persona: prospecto → paciente.
--
-- Quien se agenda por primera vez (desde la agenda o el chat) queda como PROSPECTO: tiene su cita pero no un perfil de
-- paciente activo. Pasa a PACIENTE la primera vez que se marca «Llegó» (o la cita avanza a en curso/completada), o cuando
-- alguien lo convierte a mano. Si nunca llega, no hay perfil que limpiar.
--
-- Diseño: la cita sigue apuntando a la misma fila de camila_pacientes (no se cambia ninguna llave foránea); solo se marca la
-- fila. La interfaz oculta a los prospectos de la lista normal de Pacientes y los muestra en el filtro «Prospectos».
-- Aditiva: toda fila existente queda como 'paciente'. Esta migración NO reclasifica datos; eso lo hace, con vista previa,
-- docs/sql-prospectos-migrar-pegar-en-supabase.sql.

alter table public.camila_pacientes
  add column if not exists ciclo_vida text not null default 'paciente',
  add column if not exists convertido_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'camila_pacientes_ciclo_vida_check') then
    alter table public.camila_pacientes
      add constraint camila_pacientes_ciclo_vida_check check (ciclo_vida in ('prospecto', 'paciente'));
  end if;
end $$;

comment on column public.camila_pacientes.ciclo_vida is 'prospecto = agendado que aún no ha llegado; paciente = ya fue atendido o se convirtió a mano.';
comment on column public.camila_pacientes.convertido_at is 'Cuándo pasó de prospecto a paciente (null si siempre fue paciente).';

create index if not exists camila_pacientes_prospecto_idx
  on public.camila_pacientes (tenant_id) where ciclo_vida = 'prospecto';

-- Invariante: una persona con una cita que ya llegó nunca puede quedar como prospecto, venga de donde venga la escritura.
create or replace function public.smyl_patient_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.ciclo_vida = 'prospecto' and exists (
    select 1 from public.smyl_appointments a
     where a.tenant_id = new.tenant_id and a.patient_id = new.id
       and a.status in ('arrived', 'in_progress', 'completed')
  ) then
    new.ciclo_vida := 'paciente';
  end if;
  if new.ciclo_vida = 'paciente' and tg_op = 'UPDATE' and old.ciclo_vida = 'prospecto' and new.convertido_at is null then
    new.convertido_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_patient_lifecycle_guard on public.camila_pacientes;
create trigger smyl_patient_lifecycle_guard
  before insert or update of ciclo_vida on public.camila_pacientes
  for each row execute function public.smyl_patient_lifecycle_guard();

-- La primera llegada convierte al prospecto en paciente. Va en un disparador de la cita para cubrir todas las rutas
-- (marcar «Llegó», entrar directo a consulta, completar, walk-in) sin depender de qué función cambió el estado.
create or replace function public.smyl_promote_prospect_on_attendance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status in ('arrived', 'in_progress', 'completed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    update public.camila_pacientes
       set ciclo_vida = 'paciente', convertido_at = clock_timestamp()
     where tenant_id = new.tenant_id and id = new.patient_id and ciclo_vida = 'prospecto';
  end if;
  return null;
end;
$$;

drop trigger if exists smyl_promote_prospect_on_attendance on public.smyl_appointments;
create trigger smyl_promote_prospect_on_attendance
  after insert or update of status on public.smyl_appointments
  for each row execute function public.smyl_promote_prospect_on_attendance();

revoke all on function public.smyl_patient_lifecycle_guard() from public, anon, authenticated;
revoke all on function public.smyl_promote_prospect_on_attendance() from public, anon, authenticated;

-- Conversión manual («Convertir en paciente»), p. ej. para quien se atiende sin pasar por la agenda.
create or replace function public.smyl_promote_prospect(p_patient_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_changed integer;
begin
  if v_tenant is null
     or not public.smyl_has_permission(v_tenant, 'patients.manage')
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
    raise exception using errcode = '42501', message = 'No tienes permiso para convertir a este paciente.';
  end if;
  update public.camila_pacientes
     set ciclo_vida = 'paciente', convertido_at = clock_timestamp()
   where tenant_id = v_tenant and id = p_patient_id and ciclo_vida = 'prospecto';
  get diagnostics v_changed = row_count;
  if v_changed = 0 and not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id) then
    raise exception using errcode = 'P0002', message = 'El paciente no existe.';
  end if;
  return v_changed > 0;
end;
$$;

revoke all on function public.smyl_promote_prospect(uuid) from public, anon;
grant execute on function public.smyl_promote_prospect(uuid) to authenticated;
