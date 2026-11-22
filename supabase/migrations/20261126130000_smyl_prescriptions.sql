-- Recetas médicas (Ley General de Salud art. 240; Reglamento de Insumos para la Salud arts. 28-30).
-- La receta guarda una FOTO de los datos al momento de emitirla, tomada en el servidor (no del navegador):
--   prescriptor: nombre, cédula profesional, institución que expidió el título, especialidad y su cédula;
--   consultorio: nombre y domicilio de la sucursal; paciente: nombre, edad y sexo; fecha;
--   cada medicamento: denominación genérica (y distintiva opcional), presentación, dosis, vía, frecuencia y duración.
-- Se emite tras confirmar identidad (últimos 10 minutos). No se edita ni se borra; se puede anular con motivo.
-- Se imprime para la firma autógrafa del médico. NO es para medicamentos controlados (grupos I a III), que
-- requieren recetario especial con código de barras de COFEPRIS.
-- Idempotente.

-- Credenciales del profesional (la columna license_institution ya existía en producción sin migración).
alter table public.smyl_professionals
  add column if not exists license_institution text not null default '',
  add column if not exists specialty_license text not null default '';

create table if not exists public.smyl_prescriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  folio bigint generated always as identity,
  branch_id uuid,
  professional_id uuid not null,
  prescriber jsonb not null,
  clinic jsonb not null,
  patient jsonb not null,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 12),
  instructions text not null default '' check (char_length(instructions) <= 3000),
  issued_at timestamptz not null default now(),
  issued_by uuid not null default auth.uid(),
  issued_auth_method text not null,
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500),
  voided_by uuid,
  foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id)
);
create index if not exists smyl_prescriptions_patient_idx on public.smyl_prescriptions (tenant_id, patient_id, issued_at desc);
alter table public.smyl_prescriptions enable row level security;
revoke all on public.smyl_prescriptions from public, anon, authenticated;

create or replace function public.smyl_prescriptions_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 and coalesce(current_setting('smyl.retention_purge', true), '') <> 'nom004-5y' then
      raise exception using errcode = '55000', message = 'Una receta emitida no se puede eliminar; anúlala.';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - array['voided_at', 'void_reason', 'voided_by']) is distinct from (to_jsonb(old) - array['voided_at', 'void_reason', 'voided_by'])
     or old.voided_at is not null then
    raise exception using errcode = '55000', message = 'Una receta emitida no se modifica.';
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_prescriptions_immutable on public.smyl_prescriptions;
create trigger smyl_prescriptions_immutable before update or delete on public.smyl_prescriptions
  for each row execute function public.smyl_prescriptions_immutable();

-- Valida y normaliza los medicamentos que manda el navegador (solo texto, con límites).
create or replace function public.smyl_normalize_prescription_items(p_items jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_route text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 12 then
    raise exception using errcode = '22023', message = 'Agrega entre 1 y 12 medicamentos.';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_route := btrim(coalesce(v_item->>'route', ''));
    if char_length(btrim(coalesce(v_item->>'generic_name', ''))) not between 2 and 160
       or char_length(btrim(coalesce(v_item->>'presentation', ''))) not between 2 and 160
       or char_length(btrim(coalesce(v_item->>'dose', ''))) not between 1 and 120
       or char_length(v_route) not between 2 and 60
       or char_length(btrim(coalesce(v_item->>'frequency', ''))) not between 2 and 120
       or char_length(btrim(coalesce(v_item->>'duration', ''))) not between 2 and 120
       or char_length(coalesce(v_item->>'brand_name', '')) > 160
       or char_length(coalesce(v_item->>'notes', '')) > 500 then
      raise exception using errcode = '22023',
        message = 'Cada medicamento necesita denominación genérica, presentación, dosis, vía, frecuencia y duración.';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'generic_name', btrim(v_item->>'generic_name'),
      'brand_name', btrim(coalesce(v_item->>'brand_name', '')),
      'presentation', btrim(v_item->>'presentation'),
      'dose', btrim(v_item->>'dose'),
      'route', v_route,
      'frequency', btrim(v_item->>'frequency'),
      'duration', btrim(v_item->>'duration'),
      'notes', btrim(coalesce(v_item->>'notes', ''))));
  end loop;
  return v_out;
end;
$$;

create or replace function public.smyl_issue_prescription(p_patient_id uuid, p_branch_id uuid, p_items jsonb, p_instructions text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_pro public.smyl_professionals;
  v_branch public.smyl_branches;
  v_pac public.camila_pacientes;
  v_clinic_name text;
  v_method text;
  v_items jsonb;
  v_prescriber jsonb; v_clinic jsonb; v_patient jsonb;
  v_age text;
  v_row public.smyl_prescriptions;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para emitir recetas.';
  end if;
  select * into v_pac from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id;
  if not found or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  select * into v_pro from public.smyl_professionals p where p.tenant_id = v_tenant and p.user_id = auth.uid() and p.active limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'Solo un profesional registrado puede emitir recetas.';
  end if;
  if char_length(btrim(coalesce(v_pro.license_number, ''))) < 4 or char_length(btrim(coalesce(v_pro.license_institution, ''))) < 3 then
    raise exception using errcode = '23514', message = 'Para emitir recetas registra en Equipo tu cédula profesional y la institución que expidió tu título.';
  end if;
  select * into v_branch from public.smyl_branches b where b.tenant_id = v_tenant and b.id = p_branch_id and b.active;
  if not found or char_length(btrim(coalesce(v_branch.address_line, ''))) < 5 then
    raise exception using errcode = '23514', message = 'Elige una sucursal con domicilio registrado: la receta debe llevar el domicilio del consultorio.';
  end if;
  v_method := public.smyl_recent_auth_method(600);
  if v_method is null then
    raise exception using errcode = '28000', message = 'Confirma tu identidad para emitir la receta (contraseña o código de verificación).', hint = 'reauth_required';
  end if;
  v_items := public.smyl_normalize_prescription_items(p_items);
  if char_length(coalesce(p_instructions, '')) > 3000 then
    raise exception using errcode = '22023', message = 'Las indicaciones son demasiado largas.';
  end if;

  select nombre into v_clinic_name from public.camila_tenants where id = v_tenant;
  v_age := case when v_pac.fecha_nacimiento is null then ''
                else extract(year from age(current_date, v_pac.fecha_nacimiento))::int::text || ' años' end;
  v_prescriber := jsonb_build_object('name', v_pro.display_name, 'license', btrim(coalesce(v_pro.license_number, '')),
    'institution', btrim(coalesce(v_pro.license_institution, '')), 'specialty', coalesce(v_pro.specialty, ''),
    'specialty_license', btrim(coalesce(v_pro.specialty_license, '')));
  v_clinic := jsonb_build_object('name', coalesce(v_clinic_name, ''), 'branch', v_branch.name,
    'address', concat_ws(', ', nullif(btrim(v_branch.address_line), ''), nullif(btrim(coalesce(v_branch.city, '')), ''),
                         nullif(btrim(coalesce(v_branch.state, '')), ''), nullif('C.P. ' || btrim(coalesce(v_branch.postal_code, '')), 'C.P. ')),
    'phone', coalesce(v_branch.phone, ''));
  v_patient := jsonb_build_object('name', btrim(concat_ws(' ', v_pac.nombre, v_pac.apellido)), 'age', v_age, 'sex', coalesce(v_pac.genero, ''));

  insert into public.smyl_prescriptions (tenant_id, patient_id, branch_id, professional_id, prescriber, clinic, patient, items,
    instructions, issued_auth_method, document_sha256)
  values (v_tenant, p_patient_id, v_branch.id, v_pro.id, v_prescriber, v_clinic, v_patient, v_items, btrim(coalesce(p_instructions, '')),
    v_method, encode(sha256(convert_to(jsonb_build_object('prescriber', v_prescriber, 'clinic', v_clinic, 'patient', v_patient,
      'items', v_items, 'instructions', btrim(coalesce(p_instructions, '')), 'date', current_date)::text, 'UTF8')), 'hex'))
  returning * into v_row;
  return to_jsonb(v_row) - 'tenant_id' - 'issued_by';
end;
$$;

create or replace function public.smyl_list_prescriptions(p_patient_id uuid)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.read')
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  return query select to_jsonb(r) - 'tenant_id' - 'issued_by' from public.smyl_prescriptions r
                where r.tenant_id = v_tenant and r.patient_id = p_patient_id order by r.issued_at desc;
end;
$$;

create or replace function public.smyl_void_prescription(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_patient uuid;
begin
  select patient_id into v_patient from public.smyl_prescriptions where tenant_id = v_tenant and id = p_id and voided_at is null;
  if not found or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not public.smyl_can_access_patient(v_tenant, v_patient, 'clinical') then
    raise exception using errcode = '42501', message = 'No se puede anular esta receta.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'Escribe el motivo de la anulación.';
  end if;
  update public.smyl_prescriptions set voided_at = now(), void_reason = btrim(p_reason), voided_by = auth.uid()
   where tenant_id = v_tenant and id = p_id;
end;
$$;

revoke all on function public.smyl_issue_prescription(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.smyl_list_prescriptions(uuid) from public, anon;
revoke all on function public.smyl_void_prescription(uuid, text) from public, anon;
grant execute on function public.smyl_issue_prescription(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.smyl_list_prescriptions(uuid) to authenticated;
grant execute on function public.smyl_void_prescription(uuid, text) to authenticated;

-- El candado de retención también cuenta las recetas.
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
    union all select max(signed_at) from public.smyl_informed_consents where tenant_id = p_tenant and patient_id = p_patient
    union all select max(issued_at) from public.smyl_prescriptions where tenant_id = p_tenant and patient_id = p_patient
    union all select case when exists (select 1 from public.smyl_patient_consents c where c.tenant_id = p_tenant and c.patient_id = p_patient)
                          then clock_timestamp() end
  ) actos;
$$;
revoke all on function public.smyl_patient_last_clinical_activity(uuid, uuid) from public, anon, authenticated;
