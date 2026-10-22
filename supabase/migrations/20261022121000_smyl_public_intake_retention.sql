-- SMYL · Retención efectiva de solicitudes públicas.
-- Prepara una depuración privada y por lotes. La ejecución periódica se activa
-- sólo después de que la clínica apruebe formalmente el plazo de retención.

begin;

drop index if exists public.smyl_public_appointment_intakes_retention_idx;

create index smyl_public_appointment_intakes_retention_idx
  on public.smyl_public_appointment_intakes(retention_expires_at, id);

-- La bitácora conserva trazabilidad operativa y constancia de consentimiento,
-- pero no replica nombre, teléfono, correo, mensaje ni paciente vinculado.
create or replace function public.smyl_audit_public_appointment_intake()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id;
    v_id := old.id;
  else
    v_tenant := new.tenant_id;
    v_id := new.id;
  end if;

  v_before := case when tg_op = 'INSERT' then null else jsonb_build_object(
    'status', old.status,
    'appointment_request_id', old.appointment_request_id,
    'privacy_consent_at', old.privacy_consent_at,
    'privacy_notice_version', old.privacy_notice_version,
    'reviewed_at', old.reviewed_at,
    'retention_expires_at', old.retention_expires_at
  ) end;

  v_after := case when tg_op = 'DELETE' then null else jsonb_build_object(
    'status', new.status,
    'appointment_request_id', new.appointment_request_id,
    'privacy_consent_at', new.privacy_consent_at,
    'privacy_notice_version', new.privacy_notice_version,
    'reviewed_at', new.reviewed_at,
    'retention_expires_at', new.retention_expires_at
  ) end;

  insert into public.smyl_audit_events(
    tenant_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    v_tenant, auth.uid(), lower(tg_op), tg_table_name, v_id::text,
    v_before, v_after
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.smyl_audit_public_appointment_intake()
  from public, anon, authenticated;

create or replace function public.smyl_purge_expired_public_appointment_intakes(
  p_limit integer default 250
)
returns table(expired_requests integer, deleted_intakes integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := coalesce(p_limit, 250);
  v_ids uuid[];
  v_expired integer := 0;
  v_deleted integer := 0;
begin
  if v_limit < 1 or v_limit > 1000 then
    raise exception using
      errcode = '22023',
      message = 'El límite debe estar entre 1 y 1000.';
  end if;

  with candidates as (
    select intake.id
    from public.smyl_public_appointment_intakes intake
    where intake.retention_expires_at <= clock_timestamp()
    order by intake.retention_expires_at, intake.id
    limit v_limit
    for update skip locked
  )
  select coalesce(array_agg(candidates.id), '{}'::uuid[])
  into v_ids
  from candidates;

  if cardinality(v_ids) = 0 then
    return query select 0, 0;
    return;
  end if;

  -- Una solicitud pendiente no debe quedar visible sin su captación asociada.
  update public.smyl_appointment_requests request
  set status = 'expired',
      decided_at = coalesce(request.decided_at, clock_timestamp())
  from public.smyl_public_appointment_intakes intake
  where intake.id = any(v_ids)
    and request.tenant_id = intake.tenant_id
    and request.id = intake.appointment_request_id
    and request.status = 'pending';

  get diagnostics v_expired = row_count;

  delete from public.smyl_public_appointment_intakes intake
  where intake.id = any(v_ids);

  get diagnostics v_deleted = row_count;

  return query select v_expired, v_deleted;
end;
$$;

revoke all on function public.smyl_purge_expired_public_appointment_intakes(integer)
  from public, anon, authenticated;
grant execute on function public.smyl_purge_expired_public_appointment_intakes(integer)
  to service_role;

comment on function public.smyl_purge_expired_public_appointment_intakes(integer) is
  'Elimina PII vencida de captaciones públicas en lotes y expira solicitudes pendientes; sólo service_role.';

comment on column public.smyl_public_appointment_intakes.retention_expires_at is
  'Fecha máxima de conservación; la depuración privada se ejecuta por lotes tras aprobar la política de retención.';

commit;
