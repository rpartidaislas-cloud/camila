-- Receta médica (impresa) — registro, folio e inmutabilidad.
--
-- IMPORTANTE: los requisitos de contenido se tomaron de FUENTES SECUNDARIAS (ver docs/RECETA_REQUISITOS.md) y NO se han
-- contrastado con el texto oficial; un abogado o asesor sanitario debe validarlos ANTES de usar la receta con pacientes reales.
-- Las listas de antibióticos y de medicamentos controlados de esta función son una red de apoyo, NO una lista legal.
--
-- Qué garantiza:
--   * Quien emite es SIEMPRE el profesional de la sesión (su perfil vinculado a su usuario, activo y con cédula): el navegador no
--     puede poner otro nombre ni otra cédula. Los datos del profesional, del consultorio y del paciente se congelan en la receta.
--   * Folio consecutivo por clínica, idempotente por llave; una receta emitida NO se edita: solo se anula, con motivo.
--   * No emite recetas con medicamentos controlados (estupefacientes/psicotrópicos requieren recetario especial).
--   * Cada medicamento exige: nombre genérico, presentación, dosis, vía, frecuencia, duración y cantidad.
--   * Antibióticos: se marcan y no pueden pasar de 30 días.
-- Aditiva e idempotente.
begin;

create table if not exists public.smyl_prescription_sequences (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  next_folio bigint not null default 1 check (next_folio > 0)
);

create table if not exists public.smyl_prescriptions (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  branch_id uuid,
  appointment_id uuid,
  professional_id uuid not null,
  idempotency_key uuid not null,
  folio bigint not null check (folio > 0),
  status text not null default 'issued' check (status in ('issued', 'voided')),
  has_antibiotic boolean not null default false,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  issued_by uuid not null references auth.users(id),
  issued_at timestamptz not null default now(),
  void_reason text not null default '' check (char_length(void_reason) <= 300),
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  unique (tenant_id, id), unique (tenant_id, folio), unique (tenant_id, idempotency_key),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete restrict,
  foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id) on delete restrict,
  check ((status = 'issued' and voided_at is null and voided_by is null)
      or (status = 'voided' and voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) >= 5))
);
create index if not exists smyl_prescriptions_patient_idx on public.smyl_prescriptions (tenant_id, patient_id, issued_at desc);

alter table public.smyl_prescription_sequences enable row level security;
alter table public.smyl_prescriptions enable row level security;
revoke all on public.smyl_prescription_sequences, public.smyl_prescriptions from public, anon, authenticated;
grant select on public.smyl_prescriptions to authenticated;
drop policy if exists smyl_prescriptions_read on public.smyl_prescriptions;
create policy smyl_prescriptions_read on public.smyl_prescriptions for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read'));

-- Una receta emitida no se edita ni se borra: solo pasa de «issued» a «voided» con motivo.
create or replace function public.smyl_prescriptions_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Una receta emitida no se puede borrar; anúlala con motivo.';
  end if;
  if old.status = 'voided' then
    raise exception using errcode = '42501', message = 'La receta ya está anulada.';
  end if;
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.patient_id is distinct from old.patient_id
     or new.professional_id is distinct from old.professional_id or new.folio is distinct from old.folio
     or new.snapshot is distinct from old.snapshot or new.has_antibiotic is distinct from old.has_antibiotic
     or new.issued_by is distinct from old.issued_by or new.issued_at is distinct from old.issued_at
     or new.idempotency_key is distinct from old.idempotency_key or new.branch_id is distinct from old.branch_id
     or new.appointment_id is distinct from old.appointment_id then
    raise exception using errcode = '42501', message = 'El contenido de una receta emitida no se puede modificar.';
  end if;
  return new;
end; $$;
drop trigger if exists smyl_prescriptions_guard_trg on public.smyl_prescriptions;
create trigger smyl_prescriptions_guard_trg before update or delete on public.smyl_prescriptions
  for each row execute function public.smyl_prescriptions_guard();
drop trigger if exists smyl_prescriptions_audit on public.smyl_prescriptions;
create trigger smyl_prescriptions_audit after insert or update or delete on public.smyl_prescriptions
  for each row execute function public.smyl_audit_row();

-- Emite una receta. Todo lo legalmente relevante se valida AQUÍ, no en el navegador.
create or replace function public.smyl_issue_prescription(
  p_id uuid, p_idempotency_key uuid, p_patient_id uuid, p_branch_id uuid, p_appointment_id uuid,
  p_diagnosis text, p_indications text, p_items jsonb, p_declare_not_controlled boolean
) returns public.smyl_prescriptions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_prescriptions;
  v_pro public.smyl_professionals;
  v_patient record;
  v_branch public.smyl_branches;
  v_clinic text;
  v_item jsonb; v_items jsonb := '[]'::jsonb; v_n integer := 0;
  v_generic text; v_norm text; v_days integer; v_antibiotic boolean := false; v_is_antibiotic boolean; v_term text; v_folio bigint;
  v_age text; v_address text;
  -- Redes de apoyo (NO son listas legales). Controlados: estupefacientes y psicotrópicos frecuentes. Antibióticos: los de uso odontológico.
  v_controlled text[] := array['morfina','codeina','fentanil','tramadol','buprenorfina','metadona','oxicodona','hidrocodona','meperidina',
    'petidina','tapentadol','nalbufina','diazepam','alprazolam','clonazepam','lorazepam','midazolam','bromazepam','clobazam','zolpidem',
    'fenobarbital','ketamina','metilfenidato','anfetamina','lisdexanfetamina'];
  v_antibiotics text[] := array['amoxicilina','ampicilina','penicilina','dicloxacilina','cefalexina','cefadroxilo','cefuroxima','cefixima',
    'ceftriaxona','azitromicina','claritromicina','eritromicina','clindamicina','doxiciclina','tetraciclina','minociclina','metronidazol',
    'ciprofloxacino','levofloxacino','moxifloxacino','trimetoprima','sulfametoxazol','nitrofurantoina','gentamicina','amikacina','vancomicina'];
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para emitir recetas.';
  end if;
  select * into v_row from public.smyl_prescriptions where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
  if found then return v_row; end if;
  if p_declare_not_controlled is not true then
    raise exception using errcode = '22023', message = 'Confirma que la receta no incluye medicamentos controlados.';
  end if;

  select * into v_pro from public.smyl_professionals where tenant_id = v_tenant and user_id = auth.uid() and active;
  if not found then
    raise exception using errcode = '23514', message = 'Tu usuario no tiene un perfil de profesional activo. Vincúlalo en Equipo antes de recetar.';
  end if;
  if btrim(coalesce(v_pro.license_number, '')) = '' then
    raise exception using errcode = '23514', message = 'Captura tu cédula profesional en tu perfil (Equipo) antes de recetar.';
  end if;

  select p.nombre, p.apellido, p.fecha_nacimiento into v_patient from public.camila_pacientes p where p.tenant_id = v_tenant and p.id = p_patient_id;
  if not found then raise exception using errcode = 'P0002', message = 'Paciente no encontrado.'; end if;

  if p_branch_id is not null then
    select * into v_branch from public.smyl_branches where tenant_id = v_tenant and id = p_branch_id and active;
  else
    select * into v_branch from public.smyl_branches where tenant_id = v_tenant and active order by is_default desc, created_at limit 1;
  end if;
  if not found then raise exception using errcode = '23514', message = 'No hay un consultorio activo para el domicilio de la receta.'; end if;
  if btrim(coalesce(v_branch.address_line, '')) = '' or btrim(coalesce(v_branch.city, '')) = '' then
    raise exception using errcode = '23514', message = 'Completa el domicilio del consultorio (calle y ciudad) en Clínica → Sucursales antes de recetar.';
  end if;
  v_address := concat_ws(', ', nullif(btrim(v_branch.address_line), ''), nullif(btrim(v_branch.city), ''), nullif(btrim(v_branch.state), ''), nullif(btrim(v_branch.postal_code), ''));
  select coalesce(nullif(btrim(nombre), ''), '') into v_clinic from public.camila_tenants where id = v_tenant;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) not between 1 and 12 then
    raise exception using errcode = '22023', message = 'La receta debe tener de 1 a 12 medicamentos.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    v_generic := btrim(coalesce(v_item->>'generic', ''));
    if char_length(v_generic) not between 2 and 120 then raise exception using errcode = '22023', message = format('Medicamento %s: escribe el nombre genérico.', v_n); end if;
    if char_length(btrim(coalesce(v_item->>'form', ''))) not between 2 and 60 then raise exception using errcode = '22023', message = format('Medicamento %s: indica la presentación (por ejemplo tabletas o cápsulas).', v_n); end if;
    if char_length(btrim(coalesce(v_item->>'dose', ''))) not between 1 and 120 then raise exception using errcode = '22023', message = format('Medicamento %s: indica la dosis.', v_n); end if;
    if char_length(btrim(coalesce(v_item->>'route', ''))) not between 2 and 60 then raise exception using errcode = '22023', message = format('Medicamento %s: indica la vía de administración.', v_n); end if;
    if char_length(btrim(coalesce(v_item->>'frequency', ''))) not between 2 and 80 then raise exception using errcode = '22023', message = format('Medicamento %s: indica la frecuencia.', v_n); end if;
    if char_length(btrim(coalesce(v_item->>'quantity', ''))) not between 1 and 60 then raise exception using errcode = '22023', message = format('Medicamento %s: indica la cantidad a surtir.', v_n); end if;
    begin v_days := (v_item->>'duration_days')::integer; exception when others then v_days := null; end;
    if v_days is null or v_days not between 1 and 365 then raise exception using errcode = '22023', message = format('Medicamento %s: indica la duración del tratamiento en días.', v_n); end if;
    v_norm := translate(lower(v_generic || ' ' || coalesce(v_item->>'brand', '')), 'áéíóúüñ', 'aeiouun');
    foreach v_term in array v_controlled loop
      if position(v_term in v_norm) > 0 then
        raise exception using errcode = '23514', message = format('Medicamento %s (%s): parece un medicamento controlado. SMYL no emite recetas con estupefacientes ni psicotrópicos; requieren el recetario especial.', v_n, v_generic);
      end if;
    end loop;
    v_is_antibiotic := false;
    foreach v_term in array v_antibiotics loop
      if position(v_term in v_norm) > 0 then v_is_antibiotic := true; end if;
    end loop;
    if v_is_antibiotic then
      v_antibiotic := true;
      if v_days > 30 then raise exception using errcode = '23514', message = format('Medicamento %s: los antibióticos no pueden recetarse por más de 30 días.', v_n); end if;
    end if;
    v_items := v_items || jsonb_build_object(
      'generic', v_generic, 'brand', left(btrim(coalesce(v_item->>'brand', '')), 120), 'strength', left(btrim(coalesce(v_item->>'strength', '')), 60),
      'form', left(btrim(v_item->>'form'), 60), 'dose', left(btrim(v_item->>'dose'), 120), 'route', left(btrim(v_item->>'route'), 60),
      'frequency', left(btrim(v_item->>'frequency'), 80), 'duration_days', v_days,
      'duration', v_days || case when v_days = 1 then ' día' else ' días' end, 'quantity', left(btrim(v_item->>'quantity'), 60),
      'antibiotic', v_is_antibiotic);
  end loop;

  insert into public.smyl_prescription_sequences (tenant_id, next_folio) values (v_tenant, 2)
    on conflict (tenant_id) do update set next_folio = public.smyl_prescription_sequences.next_folio + 1
    returning next_folio - 1 into v_folio;

  v_age := case when v_patient.fecha_nacimiento is null then ''
                when v_patient.fecha_nacimiento > current_date then ''
                when age(current_date, v_patient.fecha_nacimiento) >= interval '1 year' then date_part('year', age(current_date, v_patient.fecha_nacimiento))::integer || ' años'
                else date_part('month', age(current_date, v_patient.fecha_nacimiento))::integer || ' meses' end;

  insert into public.smyl_prescriptions (id, tenant_id, patient_id, branch_id, appointment_id, professional_id, idempotency_key, folio, has_antibiotic, snapshot, issued_by)
  values (p_id, v_tenant, p_patient_id, v_branch.id, p_appointment_id, v_pro.id, p_idempotency_key, v_folio, v_antibiotic,
    jsonb_build_object(
      'folio', 'R-' || lpad(v_folio::text, 6, '0'), 'issued_at', now(),
      'professional', jsonb_build_object('name', v_pro.display_name, 'specialty', coalesce(v_pro.specialty, ''), 'license_number', btrim(v_pro.license_number), 'license_institution', coalesce(v_pro.license_institution, '')),
      'clinic', jsonb_build_object('name', v_clinic, 'address', v_address, 'phone', coalesce(v_branch.phone, '')),
      'patient', jsonb_build_object('name', btrim(concat_ws(' ', v_patient.nombre, v_patient.apellido)), 'age_label', v_age, 'birth_date', v_patient.fecha_nacimiento),
      'diagnosis', left(btrim(coalesce(p_diagnosis, '')), 240), 'indications', left(btrim(coalesce(p_indications, '')), 900),
      'items', v_items, 'has_antibiotic', v_antibiotic),
    auth.uid())
  returning * into v_row;
  return v_row;
end; $$;

-- Anula una receta emitida (no la borra): solo quien la emitió o quien administra la clínica, con motivo.
create or replace function public.smyl_void_prescription(p_id uuid, p_reason text)
returns public.smyl_prescriptions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_prescriptions;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para anular recetas.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception using errcode = '22023', message = 'Escribe el motivo de la anulación (mínimo 5 caracteres).'; end if;
  select * into v_row from public.smyl_prescriptions where tenant_id = v_tenant and id = p_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Receta no encontrada.'; end if;
  if v_row.status = 'voided' then return v_row; end if;
  if v_row.issued_by is distinct from auth.uid() and not public.smyl_has_permission(v_tenant, 'settings.manage') then
    raise exception using errcode = '42501', message = 'Solo quien emitió la receta o quien administra la clínica puede anularla.';
  end if;
  update public.smyl_prescriptions set status = 'voided', void_reason = left(btrim(p_reason), 300), voided_by = auth.uid(), voided_at = now()
   where id = p_id returning * into v_row;
  return v_row;
end; $$;

revoke all on function public.smyl_issue_prescription(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, boolean) from public, anon;
revoke all on function public.smyl_void_prescription(uuid, text) from public, anon;
grant execute on function public.smyl_issue_prescription(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, boolean) to authenticated;
grant execute on function public.smyl_void_prescription(uuid, text) to authenticated;

commit;
