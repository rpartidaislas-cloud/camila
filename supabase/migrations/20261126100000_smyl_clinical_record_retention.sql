-- NOM-004-SSA3-2012 (5.4): el expediente clínico se conserva al menos 5 años desde el último acto médico.
-- Hasta ahora, borrar un paciente arrastraba en cascada ~31 tablas clínicas (notas, historia, radiografías,
-- evidencias, consentimientos…), y borrar una clínica (o la cuenta de Auth de su dueño) arrastraba todo.
-- Este candado impide esos borrados. La única salida es una depuración explícita, hecha a propósito por
-- un administrador de la base, de expedientes sin actividad clínica en los últimos 5 años:
--
--   begin;
--   set local smyl.retention_purge = 'nom004-5y';
--   delete from public.camila_pacientes where tenant_id = '<clínica>' and id = '<paciente>';
--   commit;
--
-- Las clínicas que cancelan su suscripción solo quedan inactivas (stripe-webhook): sus datos se conservan.
-- Idempotente.

-- Fecha del último acto clínico registrado de un paciente (null si no tiene expediente clínico).
create or replace function public.smyl_patient_last_clinical_activity(p_tenant uuid, p_patient uuid)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select max(t) from (
    select max(greatest(created_at, updated_at)) t from public.smyl_clinical_notes where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_patient_histories where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_dental_records where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_clinical_plans where tenant_id = p_tenant and patient_id = p_patient
    union all select max(greatest(created_at, updated_at)) from public.smyl_patient_files where tenant_id = p_tenant and patient_id = p_patient
    union all select max(created_at) from public.smyl_radiograph_sources where tenant_id = p_tenant and patient_id = p_patient
    union all select max(greatest(created_at, updated_at)) from public.smyl_clinical_evidence_studies where tenant_id = p_tenant and patient_id = p_patient
    union all select max(greatest(created_at, updated_at)) from public.mila_clinical_notes where tenant_id = p_tenant and paciente_id = p_patient
    union all select case when exists (select 1 from public.smyl_patient_consents c where c.tenant_id = p_tenant and c.patient_id = p_patient)
                          then clock_timestamp() end
  ) actos;
$$;
revoke all on function public.smyl_patient_last_clinical_activity(uuid, uuid) from public, anon, authenticated;

create or replace function public.smyl_guard_patient_retention()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  ultimo timestamptz := public.smyl_patient_last_clinical_activity(old.tenant_id, old.id);
begin
  if ultimo is null then
    return old; -- sin expediente clínico (por ejemplo, un prospecto o una alta duplicada): se puede borrar
  end if;
  if coalesce(current_setting('smyl.retention_purge', true), '') = 'nom004-5y'
     and ultimo < clock_timestamp() - interval '5 years' then
    return old;
  end if;
  raise exception using errcode = '23503',
    message = 'Este paciente tiene expediente clínico y debe conservarse al menos 5 años desde su último acto (NOM-004). No se puede eliminar.';
end;
$$;

drop trigger if exists smyl_patient_retention_guard on public.camila_pacientes;
create trigger smyl_patient_retention_guard
  before delete on public.camila_pacientes
  for each row execute function public.smyl_guard_patient_retention();

create or replace function public.smyl_guard_tenant_retention()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (select 1 from public.camila_pacientes p where p.tenant_id = old.id)
     and coalesce(current_setting('smyl.retention_purge', true), '') <> 'nom004-5y' then
    raise exception using errcode = '23503',
      message = 'La clínica tiene expedientes de pacientes que deben conservarse (NOM-004). Desactívala en lugar de eliminarla.';
  end if;
  return old;
end;
$$;

drop trigger if exists smyl_tenant_retention_guard on public.camila_tenants;
create trigger smyl_tenant_retention_guard
  before delete on public.camila_tenants
  for each row execute function public.smyl_guard_tenant_retention();
