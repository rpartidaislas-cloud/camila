-- «Continuar sin completar el diagnóstico»: constancia de que el profesional decidió seguir con el plan y el presupuesto
-- aunque el diagnóstico (contexto, archivos, hallazgos) no estuviera cerrado. El diagnóstico guía; no bloquea.
--  * smyl_diagnosis_waivers  · una constancia por paciente y revisión del plan (quién, cuándo y qué faltaba). Inmutable.
--  * smyl_waive_diagnosis    · la registra (clinical.write + acceso al paciente). Idempotente por revisión.
-- Aditiva e idempotente. No toca tablas existentes.

create table if not exists public.smyl_diagnosis_waivers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  plan_revision integer not null check (plan_revision >= 0),
  pending_note text not null default '' check (char_length(pending_note) <= 500),
  recorded_by uuid not null default auth.uid(),
  recorded_at timestamptz not null default now(),
  unique (tenant_id, patient_id, plan_revision)
);
create index if not exists smyl_diagnosis_waivers_patient_idx on public.smyl_diagnosis_waivers (tenant_id, patient_id, recorded_at desc);
alter table public.smyl_diagnosis_waivers enable row level security;
revoke all on public.smyl_diagnosis_waivers from public, anon, authenticated;

create or replace function public.smyl_diagnosis_waivers_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1 or coalesce(current_setting('smyl.retention_purge', true), '') = 'nom004-5y') then return old; end if;
  raise exception using errcode = '55000', message = 'Una constancia de diagnóstico no se modifica ni se elimina.';
end;
$$;
drop trigger if exists smyl_diagnosis_waivers_guard on public.smyl_diagnosis_waivers;
create trigger smyl_diagnosis_waivers_guard before update or delete on public.smyl_diagnosis_waivers
  for each row execute function public.smyl_diagnosis_waivers_guard();
drop trigger if exists smyl_diagnosis_waivers_audit on public.smyl_diagnosis_waivers;
create trigger smyl_diagnosis_waivers_audit after insert on public.smyl_diagnosis_waivers
  for each row execute function public.smyl_audit_row();

create or replace function public.smyl_waive_diagnosis(p_patient_id uuid, p_plan_revision integer, p_pending_note text default '')
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar esta decisión clínica.';
  end if;
  if not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id) then
    raise exception using errcode = '22023', message = 'El paciente no existe.';
  end if;
  insert into public.smyl_diagnosis_waivers (tenant_id, patient_id, plan_revision, pending_note)
  values (v_tenant, p_patient_id, greatest(coalesce(p_plan_revision, 0), 0), left(btrim(coalesce(p_pending_note, '')), 500))
  on conflict (tenant_id, patient_id, plan_revision) do nothing;
end;
$function$;

revoke all on function public.smyl_waive_diagnosis(uuid, integer, text) from public, anon;
grant execute on function public.smyl_waive_diagnosis(uuid, integer, text) to authenticated;
