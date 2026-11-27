-- «Requiere presupuesto»: marca por servicio y aviso «Por cotizar» cuando el plan revisado de un paciente lo lleva.
--  * smyl_services.requires_quote  · null = según la categoría (cirugía, prótesis, estética/carillas, ortodoncia, implantología y endodoncia
--    lo requieren); true/false = decisión explícita de la clínica. No se reescribe ninguna fila existente (sin backfill ni cambio de revisión).
--  * smyl_patients_needing_quote   · pacientes con plan REVISADO que incluye algún servicio que requiere presupuesto y todavía no tienen
--    ninguna cotización de ese tratamiento. Solo lectura; no crea ni envía nada. Para quien puede leer propuestas y acceder al paciente.
-- Aditiva e idempotente. No cambia la copia congelada del servicio (service_snapshot), así que no afecta cotizaciones ni planes existentes.

alter table public.smyl_services add column if not exists requires_quote boolean;
comment on column public.smyl_services.requires_quote is 'null = por defecto según la categoría; true/false = decisión de la clínica. Solo avisa «Por cotizar»; no bloquea cobros.';

create or replace function public.smyl_patients_needing_quote(p_limit integer default 50)
returns table (patient_id uuid, patient_name text, plan_revision integer, reviewed_at timestamptz, concepts text[])
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'proposal.read') then return; end if;
  return query
  select pl.patient_id,
         trim(coalesce(pa.nombre, '') || ' ' || coalesce(pa.apellido, '')),
         pl.revision,
         pl.reviewed_at,
         req.names
    from public.smyl_clinical_plans pl
    join public.camila_pacientes pa on pa.tenant_id = pl.tenant_id and pa.id = pl.patient_id
    cross join lateral (
      select array_agg(distinct t.value->>'name') as names
        from jsonb_array_elements(case when jsonb_typeof(pl.document->'treatments') = 'array' then pl.document->'treatments' else '[]'::jsonb end) t(value)
        join public.smyl_services s on s.tenant_id = pl.tenant_id and s.id::text = t.value->>'service_id'
       where coalesce(s.requires_quote, s.category in ('surgery', 'prosthodontic', 'aesthetic', 'orthodontic', 'implantology', 'endodontic'))
         and coalesce(t.value->>'name', '') <> ''
    ) req
   where pl.tenant_id = v_tenant
     and pl.status = 'reviewed'
     and req.names is not null
     and public.smyl_can_access_patient(v_tenant, pl.patient_id, 'clinical')
     and not exists (
       select 1 from public.smyl_proposals p
        where p.tenant_id = pl.tenant_id and p.patient_id = pl.patient_id
          -- Mismo tratamiento (capítulo): se compara por jsonb para funcionar también donde treatment_id aún no existe.
          and (to_jsonb(p)->>'treatment_id') is not distinct from (to_jsonb(pl)->>'treatment_id'))
   order by pl.reviewed_at desc nulls last
   limit v_limit;
end;
$function$;

revoke all on function public.smyl_patients_needing_quote(integer) from public, anon;
grant execute on function public.smyl_patients_needing_quote(integer) to authenticated;
