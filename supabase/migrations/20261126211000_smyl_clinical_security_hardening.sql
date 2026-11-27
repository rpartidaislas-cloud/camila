-- SMYL · cierre de seguridad clínica v1.
--
-- 1. La revocación de un consentimiento firmado exige autenticación reciente
--    también en el servidor y conserva el método usado.
-- 2. Las recetas sólo son legibles, emitibles o anulables cuando la persona
--    tiene acceso clínico efectivo al paciente, no sólo al tenant.
--
-- No cambia las firmas públicas de los RPC usados por web y PWA.
begin;

alter table public.smyl_informed_consents
  add column if not exists revoked_auth_method text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_revoked_auth_method_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_revoked_auth_method_check
      check (revoked_auth_method is null or char_length(btrim(revoked_auth_method)) between 2 and 80);
  end if;
end;
$$;

create or replace function public.smyl_informed_consents_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 and coalesce(current_setting('smyl.retention_purge', true), '') <> 'nom004-5y' then
      raise exception using errcode = '55000', message = 'Un consentimiento informado no se puede eliminar.';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - array['revoked_at', 'revoked_reason', 'revoked_by', 'revoked_auth_method'])
       is distinct from
     (to_jsonb(old) - array['revoked_at', 'revoked_reason', 'revoked_by', 'revoked_auth_method'])
     or old.revoked_at is not null then
    raise exception using errcode = '55000', message = 'Un consentimiento informado firmado no se modifica.';
  end if;
  return new;
end;
$$;

create or replace function public.smyl_revoke_informed_consent(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_patient uuid;
  v_method text;
begin
  select patient_id into v_patient
    from public.smyl_informed_consents
   where tenant_id = v_tenant and id = p_id and revoked_at is null
   for update;
  if not found or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not public.smyl_can_access_patient(v_tenant, v_patient, 'clinical') then
    raise exception using errcode = '42501', message = 'No se puede revocar este consentimiento.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'Escribe el motivo de la revocación.';
  end if;
  v_method := public.smyl_recent_auth_method(600);
  if v_method is null then
    raise exception using errcode = '28000',
      message = 'Confirma tu identidad para revocar el consentimiento.',
      hint = 'reauth_required';
  end if;
  update public.smyl_informed_consents
     set revoked_at = clock_timestamp(),
         revoked_reason = btrim(p_reason),
         revoked_by = auth.uid(),
         revoked_auth_method = v_method
   where tenant_id = v_tenant and id = p_id and revoked_at is null;
end;
$$;

-- El RLS también aplica el alcance clínico del profesional sobre el paciente.
drop policy if exists smyl_prescriptions_read on public.smyl_prescriptions;
create policy smyl_prescriptions_read on public.smyl_prescriptions
for select to authenticated
using (
  public.smyl_has_permission(tenant_id, 'clinical.read')
  and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical')
);

-- Conserva el motor validado de emisión detrás de un RPC público con alcance
-- por paciente. El núcleo queda sin permisos directos para authenticated.
alter function public.smyl_issue_prescription(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, boolean)
  rename to smyl_issue_prescription_core_20261125;
revoke all on function public.smyl_issue_prescription_core_20261125(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, boolean)
  from public, anon, authenticated;

create or replace function public.smyl_issue_prescription(
  p_id uuid, p_idempotency_key uuid, p_patient_id uuid, p_branch_id uuid, p_appointment_id uuid,
  p_diagnosis text, p_indications text, p_items jsonb, p_declare_not_controlled boolean
) returns public.smyl_prescriptions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_existing public.smyl_prescriptions;
  v_result public.smyl_prescriptions;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not exists (
       select 1 from public.camila_pacientes
        where tenant_id = v_tenant and id = p_patient_id
     )
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;

  select * into v_existing
    from public.smyl_prescriptions
   where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.patient_id is distinct from p_patient_id then
      raise exception using errcode = '22023', message = 'La llave de reintento pertenece a otra receta.';
    end if;
    return v_existing;
  end if;

  select * into v_result
    from public.smyl_issue_prescription_core_20261125(
      p_id, p_idempotency_key, p_patient_id, p_branch_id, p_appointment_id,
      p_diagnosis, p_indications, p_items, p_declare_not_controlled
    );
  return v_result;
end;
$$;

alter function public.smyl_void_prescription(uuid, text)
  rename to smyl_void_prescription_core_20261125;
revoke all on function public.smyl_void_prescription_core_20261125(uuid, text)
  from public, anon, authenticated;

create or replace function public.smyl_void_prescription(p_id uuid, p_reason text)
returns public.smyl_prescriptions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_target public.smyl_prescriptions;
  v_result public.smyl_prescriptions;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para anular recetas.';
  end if;
  select * into v_target
    from public.smyl_prescriptions
   where tenant_id = v_tenant and id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Receta no encontrada.';
  end if;
  if not public.smyl_can_access_patient(v_tenant, v_target.patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  select * into v_result from public.smyl_void_prescription_core_20261125(p_id, p_reason);
  return v_result;
end;
$$;

revoke all on function public.smyl_revoke_informed_consent(uuid, text) from public, anon;
revoke all on function public.smyl_issue_prescription(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, boolean) from public, anon;
revoke all on function public.smyl_void_prescription(uuid, text) from public, anon;
grant execute on function public.smyl_revoke_informed_consent(uuid, text) to authenticated;
grant execute on function public.smyl_issue_prescription(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, boolean) to authenticated;
grant execute on function public.smyl_void_prescription(uuid, text) to authenticated;

commit;
