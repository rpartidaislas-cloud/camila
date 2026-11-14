-- SMYL · Archivos clínicos: el acceso al objeto respeta el alcance del paciente.
-- La ruta privada conserva el contrato tenant/patient/file/name y no concede acceso
-- únicamente por pertenecer a la misma clínica.
begin;

create or replace function public.smyl_clinical_file_path_allowed(p_name text,p_permission text)
returns boolean
language plpgsql
security definer
stable
set search_path=pg_catalog,public
as $$
declare
  v_parts text[];
  v_tenant uuid;
  v_patient uuid;
begin
  v_parts:=string_to_array(p_name,'/');
  if array_length(v_parts,1)<4
    or v_parts[1]!~'^[0-9a-f-]{36}$'
    or v_parts[2]!~'^[0-9a-f-]{36}$'
    or v_parts[3]!~'^[0-9a-f-]{36}$' then
    return false;
  end if;

  v_tenant:=v_parts[1]::uuid;
  v_patient:=v_parts[2]::uuid;

  return v_tenant=public.smyl_current_tenant()
    and public.smyl_has_permission(v_tenant,p_permission)
    and exists(
      select 1
      from public.camila_pacientes patient
      where patient.tenant_id=v_tenant
        and patient.id=v_patient
    )
    and public.smyl_can_access_patient(v_tenant,v_patient,'clinical');
exception when others then
  return false;
end;
$$;

revoke all on function public.smyl_clinical_file_path_allowed(text,text) from public,anon;
grant execute on function public.smyl_clinical_file_path_allowed(text,text) to authenticated;

commit;
