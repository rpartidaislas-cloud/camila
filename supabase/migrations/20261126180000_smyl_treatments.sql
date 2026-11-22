-- Tratamientos como capítulos del expediente.
--
-- Cada vez que el paciente vuelve por algo distinto se abre un tratamiento nuevo. Los anteriores quedan cerrados
-- y consultables; nada se borra. La historia clínica, el odontograma y los archivos son del PACIENTE y se comparten
-- entre tratamientos; el plan y todo lo que se decide sobre él son de cada TRATAMIENTO.
--
-- Diseño (aditivo, sin tocar las tablas ni las funciones del plan que ya leen cotizaciones, portal y línea de tiempo):
--   * Hay UN tratamiento activo por paciente. El plan de trabajo (smyl_clinical_plans) sigue siendo el del tratamiento activo.
--   * Al cerrar un tratamiento se congela una copia de su plan (plan_snapshot) y su revisión. Las versiones anteriores
--     siguen en smyl_clinical_versions, de modo que las cotizaciones ya emitidas conservan su plan_revision.
--   * Al abrir uno nuevo, el plan de trabajo arranca en blanco como una revisión más (con su versión); no se pierde nada.
--   * Las notas, cotizaciones y citas se asignan a un tratamiento por la fecha (opened_at..closed_at): no se modifican
--     ni se enlazan, así que las notas firmadas siguen inmutables.
--   * Cierre por abandono (NOM-013-SSA2-2015, 9.7): exige una nota con la fase en que quedó y lo que falta.
--   * No se elimina (retención NOM-004, igual que los consentimientos).
-- Solo se usa con funciones (listar, ver, abrir, actualizar, cerrar). Idempotente.

create table if not exists public.smyl_treatments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  seq integer not null check (seq >= 1),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  reason text not null default '' check (char_length(reason) <= 2000),
  status text not null default 'active' check (status in ('active', 'closed', 'abandoned', 'cancelled')),
  asa text check (asa is null or asa in ('I', 'II', 'III', 'IV')),
  caries_risk text check (caries_risk is null or caries_risk in ('low', 'medium', 'high')),
  recall_months smallint check (recall_months is null or recall_months in (3, 6, 12)),
  recall_whatsapp boolean not null default true,
  opened_at timestamptz not null default now(),
  opened_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  closure_note text check (closure_note is null or char_length(closure_note) <= 2000),
  plan_revision integer,
  plan_snapshot jsonb,
  constraint smyl_treatments_closed_consistent check (
    (status = 'active' and closed_at is null)
    or (status <> 'active' and closed_at is not null)),
  constraint smyl_treatments_abandoned_note check (
    status <> 'abandoned' or char_length(btrim(coalesce(closure_note, ''))) >= 10),
  foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id),
  unique (tenant_id, patient_id, seq)
);

-- Un solo tratamiento activo por paciente.
create unique index if not exists smyl_treatments_one_active_idx
  on public.smyl_treatments (tenant_id, patient_id) where status = 'active';
create index if not exists smyl_treatments_patient_idx
  on public.smyl_treatments (tenant_id, patient_id, seq desc);

alter table public.smyl_treatments enable row level security;
revoke all on public.smyl_treatments from public, anon, authenticated;

-- Un tratamiento cerrado no se modifica y ninguno se elimina.
create or replace function public.smyl_treatments_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 and coalesce(current_setting('smyl.retention_purge', true), '') <> 'nom004-5y' then
      raise exception using errcode = '55000', message = 'Un tratamiento no se puede eliminar.';
    end if;
    return old;
  end if;
  if old.status <> 'active' then
    raise exception using errcode = '55000', message = 'Un tratamiento cerrado no se modifica.';
  end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.patient_id <> old.patient_id
     or new.seq <> old.seq or new.opened_at <> old.opened_at then
    raise exception using errcode = '55000', message = 'Los datos de apertura de un tratamiento no se modifican.';
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_treatments_guard on public.smyl_treatments;
create trigger smyl_treatments_guard before update or delete on public.smyl_treatments
  for each row execute function public.smyl_treatments_guard();

drop trigger if exists smyl_treatments_audit on public.smyl_treatments;
create trigger smyl_treatments_audit after insert or update or delete on public.smyl_treatments
  for each row execute function public.smyl_audit_row();

-- Validación común de acceso clínico al paciente.
create or replace function public.smyl_treatment_access(p_patient_id uuid, p_write boolean)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null
     or not public.smyl_has_permission(v_tenant, case when p_write then 'clinical.write' else 'clinical.read' end) then
    raise exception using errcode = '42501', message = 'No tienes permiso para esta acción en el expediente.';
  end if;
  if not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id)
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  return v_tenant;
end;
$$;
revoke all on function public.smyl_treatment_access(uuid, boolean) from public, anon, authenticated;

-- Listar los tratamientos de un paciente (sin el plan congelado; se pide aparte).
create or replace function public.smyl_list_treatments(p_patient_id uuid)
returns table (
  id uuid, seq integer, title text, reason text, status text, asa text, caries_risk text, recall_months smallint,
  recall_whatsapp boolean, opened_at timestamptz, closed_at timestamptz, closure_note text, plan_revision integer,
  has_snapshot boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_treatment_access(p_patient_id, false);
begin
  return query
  select t.id, t.seq, t.title, t.reason, t.status, t.asa, t.caries_risk, t.recall_months, t.recall_whatsapp,
         t.opened_at, t.closed_at, t.closure_note, t.plan_revision, t.plan_snapshot is not null
  from public.smyl_treatments t
  where t.tenant_id = v_tenant and t.patient_id = p_patient_id
  order by t.seq desc;
end;
$$;

-- Ver un tratamiento con su plan congelado (para consultar uno cerrado).
create or replace function public.smyl_get_treatment(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.smyl_treatments; v_tenant uuid;
begin
  select * into v_row from public.smyl_treatments where id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'El tratamiento no existe.';
  end if;
  v_tenant := public.smyl_treatment_access(v_row.patient_id, false);
  if v_row.tenant_id <> v_tenant then
    raise exception using errcode = '42501', message = 'No tienes acceso a este tratamiento.';
  end if;
  return to_jsonb(v_row);
end;
$$;

-- Abrir un tratamiento nuevo. El anterior debe estar cerrado. El plan de trabajo arranca en blanco (una revisión más).
create or replace function public.smyl_open_treatment(p_patient_id uuid, p_title text, p_reason text default '')
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_treatment_access(p_patient_id, true);
  v_title text := btrim(coalesce(p_title, ''));
  v_reason text := left(btrim(coalesce(p_reason, '')), 2000);
  v_seq integer; v_id uuid; v_plan public.smyl_clinical_plans; v_stamp timestamptz := clock_timestamp();
begin
  if char_length(v_title) not between 3 and 120 then
    raise exception using errcode = '22023', message = 'Escribe un nombre para el tratamiento (de 3 a 120 caracteres).';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('treatment:' || p_patient_id::text, 0));
  if exists (select 1 from public.smyl_treatments where tenant_id = v_tenant and patient_id = p_patient_id and status = 'active') then
    raise exception using errcode = '23505', message = 'Cierra el tratamiento en curso antes de abrir otro.';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq from public.smyl_treatments where tenant_id = v_tenant and patient_id = p_patient_id;
  insert into public.smyl_treatments (tenant_id, patient_id, seq, title, reason, opened_by)
  values (v_tenant, p_patient_id, v_seq, v_title, v_reason, auth.uid())
  returning id into v_id;

  -- El plan de trabajo pasa a ser el del tratamiento nuevo: en blanco, con su versión. Lo anterior sigue en las versiones.
  select * into v_plan from public.smyl_clinical_plans where patient_id = p_patient_id for update;
  if found then
    update public.smyl_clinical_plans
       set document = jsonb_build_object('schema', 2, 'reason', v_reason, 'background', '', 'assessment', '', 'treatments', '[]'::jsonb),
           revision = v_plan.revision + 1, status = 'draft', updated_by = auth.uid(), updated_at = v_stamp,
           reviewed_by = null, reviewed_at = null
     where patient_id = p_patient_id
     returning * into v_plan;
    insert into public.smyl_clinical_versions (patient_id, tenant_id, document, revision, status, updated_by, updated_at, reviewed_by, reviewed_at)
    values (v_plan.patient_id, v_plan.tenant_id, v_plan.document, v_plan.revision, v_plan.status, v_plan.updated_by, v_plan.updated_at,
            v_plan.reviewed_by, v_plan.reviewed_at);
  end if;
  return v_id;
end;
$$;

-- Actualizar los datos del tratamiento activo (riesgos, próxima revisión). Los parámetros nulos no cambian nada.
create or replace function public.smyl_update_treatment(
  p_id uuid, p_asa text default null, p_caries_risk text default null, p_recall_months integer default null,
  p_recall_whatsapp boolean default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.smyl_treatments;
begin
  select * into v_row from public.smyl_treatments where id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'El tratamiento no existe.';
  end if;
  if public.smyl_treatment_access(v_row.patient_id, true) <> v_row.tenant_id then
    raise exception using errcode = '42501', message = 'No tienes acceso a este tratamiento.';
  end if;
  if v_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'Un tratamiento cerrado no se modifica.';
  end if;
  if p_asa is not null and p_asa not in ('I', 'II', 'III', 'IV')
     or p_caries_risk is not null and p_caries_risk not in ('low', 'medium', 'high')
     or p_recall_months is not null and p_recall_months not in (3, 6, 12)
     or p_reason is not null and char_length(p_reason) > 2000 then
    raise exception using errcode = '22023', message = 'Alguno de los datos del tratamiento no es válido.';
  end if;
  update public.smyl_treatments
     set asa = coalesce(p_asa, asa),
         caries_risk = coalesce(p_caries_risk, caries_risk),
         recall_months = coalesce(p_recall_months::smallint, recall_months),
         recall_whatsapp = coalesce(p_recall_whatsapp, recall_whatsapp),
         reason = coalesce(left(btrim(p_reason), 2000), reason)
   where id = p_id;
end;
$$;

-- Cerrar el tratamiento activo y congelar su plan. Resultado: closed (terminado), abandoned (el paciente no regresó;
-- exige la nota de la hoja de egreso) o cancelled (se canceló).
create or replace function public.smyl_close_treatment(p_id uuid, p_outcome text default 'closed', p_note text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_row public.smyl_treatments; v_plan public.smyl_clinical_plans; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_row from public.smyl_treatments where id = p_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'El tratamiento no existe.';
  end if;
  if public.smyl_treatment_access(v_row.patient_id, true) <> v_row.tenant_id then
    raise exception using errcode = '42501', message = 'No tienes acceso a este tratamiento.';
  end if;
  if v_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'Este tratamiento ya está cerrado.';
  end if;
  if coalesce(p_outcome, '') not in ('closed', 'abandoned', 'cancelled') then
    raise exception using errcode = '22023', message = 'El resultado del cierre no es válido.';
  end if;
  if p_outcome = 'abandoned' and char_length(coalesce(v_note, '')) < 10 then
    raise exception using errcode = '22023',
      message = 'Para cerrar por abandono escribe en qué fase quedó el tratamiento y lo que falta (hoja de egreso).';
  end if;
  if char_length(coalesce(v_note, '')) > 2000 then
    raise exception using errcode = '22023', message = 'La nota de cierre es demasiado larga.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('treatment:' || v_row.patient_id::text, 0));
  select * into v_plan from public.smyl_clinical_plans where patient_id = v_row.patient_id;
  update public.smyl_treatments
     set status = p_outcome, closed_at = clock_timestamp(), closed_by = auth.uid(), closure_note = v_note,
         plan_revision = v_plan.revision, plan_snapshot = v_plan.document
   where id = p_id;
end;
$$;

-- Cada paciente con plan ya existente recibe su «Tratamiento inicial», activo, con el plan tal como está.
insert into public.smyl_treatments (tenant_id, patient_id, seq, title, reason, status, opened_at, opened_by)
select p.tenant_id, p.patient_id, 1, 'Tratamiento inicial', left(coalesce(p.document->>'reason', ''), 2000), 'active',
       coalesce((select min(v.updated_at) from public.smyl_clinical_versions v where v.patient_id = p.patient_id), p.updated_at, now()),
       p.updated_by
  from public.smyl_clinical_plans p
 where exists (select 1 from public.camila_pacientes c where c.tenant_id = p.tenant_id and c.id = p.patient_id)
   and not exists (select 1 from public.smyl_treatments t where t.tenant_id = p.tenant_id and t.patient_id = p.patient_id);

-- Si se guarda por primera vez un plan sin tratamiento activo, se crea el «Tratamiento inicial».
create or replace function public.smyl_plan_ensure_treatment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from public.smyl_treatments where tenant_id = new.tenant_id and patient_id = new.patient_id and status = 'active') then
    insert into public.smyl_treatments (tenant_id, patient_id, seq, title, reason, opened_by)
    select new.tenant_id, new.patient_id, coalesce(max(t.seq), 0) + 1, 'Tratamiento', left(coalesce(new.document->>'reason', ''), 2000), new.updated_by
      from public.smyl_treatments t where t.tenant_id = new.tenant_id and t.patient_id = new.patient_id;
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_plan_ensure_treatment on public.smyl_clinical_plans;
create trigger smyl_plan_ensure_treatment after insert on public.smyl_clinical_plans
  for each row execute function public.smyl_plan_ensure_treatment();

revoke all on function public.smyl_list_treatments(uuid) from public, anon;
revoke all on function public.smyl_get_treatment(uuid) from public, anon;
revoke all on function public.smyl_open_treatment(uuid, text, text) from public, anon;
revoke all on function public.smyl_update_treatment(uuid, text, text, integer, boolean, text) from public, anon;
revoke all on function public.smyl_close_treatment(uuid, text, text) from public, anon;
revoke all on function public.smyl_treatments_guard() from public, anon, authenticated;
revoke all on function public.smyl_plan_ensure_treatment() from public, anon, authenticated;
grant execute on function public.smyl_list_treatments(uuid) to authenticated;
grant execute on function public.smyl_get_treatment(uuid) to authenticated;
grant execute on function public.smyl_open_treatment(uuid, text, text) to authenticated;
grant execute on function public.smyl_update_treatment(uuid, text, text, integer, boolean, text) to authenticated;
grant execute on function public.smyl_close_treatment(uuid, text, text) to authenticated;
