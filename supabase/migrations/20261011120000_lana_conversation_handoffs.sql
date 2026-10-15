-- Etapa 4 SMYL + LANA: una conversación de LANA puede iniciar un expediente
-- en SMYL sin copiar el historial del chat ni crear pacientes duplicados.

-- Esta tabla ya existe en producción, pero su DDL nunca quedó versionado en
-- el repositorio. La definición idempotente permite que una instalación nueva
-- pueda aplicar esta etapa sin depender de ese drift histórico.
create table if not exists public.camila_pacientes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id),
  nombre text not null check (length(trim(nombre)) between 1 and 150),
  apellido text not null default '' check (length(apellido) <= 150),
  email text not null default '' check (length(email) <= 254),
  telefono text not null default '' check (length(telefono) <= 60),
  fecha_nacimiento date,
  genero text check (genero in ('femenino', 'masculino', 'otro')),
  notas text not null default '' check (length(notas) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

alter table public.camila_pacientes enable row level security;
drop policy if exists pacientes_read on public.camila_pacientes;
create policy pacientes_read on public.camila_pacientes for select to authenticated
  using (public.camila_es_miembro(tenant_id));
drop policy if exists pacientes_create on public.camila_pacientes;
create policy pacientes_create on public.camila_pacientes for insert to authenticated
  with check (public.camila_es_miembro(tenant_id));
drop policy if exists pacientes_edit on public.camila_pacientes;
create policy pacientes_edit on public.camila_pacientes for update to authenticated
  using (public.camila_es_miembro(tenant_id))
  with check (public.camila_es_miembro(tenant_id));

create index if not exists camila_pacientes_email_normalizado_idx
  on public.camila_pacientes (tenant_id, lower(email)) where email <> '';
create index if not exists camila_pacientes_telefono_normalizado_idx
  on public.camila_pacientes (tenant_id, right(regexp_replace(telefono, '\D', '', 'g'), 10))
  where length(regexp_replace(telefono, '\D', '', 'g')) >= 10;

create table if not exists public.camila_lana_handoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  lana_conversation_id uuid not null,
  lana_channel text not null check (lana_channel in ('whatsapp', 'messenger', 'instagram')),
  patient_id uuid not null,
  case_id uuid not null references public.camila_casos(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint camila_lana_handoffs_patient_fk
    foreign key (tenant_id, patient_id)
    references public.camila_pacientes(tenant_id, id),
  constraint camila_lana_handoffs_tenant_conversation_key
    unique (tenant_id, lana_conversation_id)
);

create index if not exists camila_lana_handoffs_patient_idx
  on public.camila_lana_handoffs (tenant_id, patient_id, created_at desc);

alter table public.camila_lana_handoffs enable row level security;
drop policy if exists camila_lana_handoffs_read on public.camila_lana_handoffs;
create policy camila_lana_handoffs_read on public.camila_lana_handoffs
  for select to authenticated
  using (public.camila_es_miembro(tenant_id));

-- La confirmación corre únicamente desde la Edge Function con service_role.
-- El advisory lock y la restricción unique hacen idempotente el doble clic.
create or replace function public.camila_confirmar_lana_handoff(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_lana_conversation_id uuid,
  p_lana_channel text,
  p_nombre text,
  p_email text default '',
  p_telefono text default '',
  p_patient_id uuid default null
)
returns table (patient_id uuid, case_id uuid, reused_patient boolean, existing_link boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.camila_lana_handoffs%rowtype;
  v_patient_id uuid;
  v_case_id uuid;
  v_name text := left(trim(coalesce(p_nombre, '')), 150);
  v_email text := left(lower(trim(coalesce(p_email, ''))), 254);
  v_phone text := left(trim(coalesce(p_telefono, '')), 60);
  v_digits text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_reused boolean := false;
begin
  if p_lana_channel not in ('whatsapp', 'messenger', 'instagram') then
    raise exception 'INVALID_LANA_CHANNEL';
  end if;
  if v_name = '' then v_name := 'Paciente de LANA'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_lana_conversation_id::text, 0));

  select * into v_link
  from public.camila_lana_handoffs h
  where h.tenant_id = p_tenant_id
    and h.lana_conversation_id = p_lana_conversation_id;
  if found then
    return query select v_link.patient_id, v_link.case_id, true, true;
    return;
  end if;

  if p_patient_id is not null then
    select p.id into v_patient_id
    from public.camila_pacientes p
    where p.tenant_id = p_tenant_id and p.id = p_patient_id;
    if v_patient_id is null then raise exception 'PATIENT_NOT_IN_TENANT'; end if;
    v_reused := true;
  else
    select p.id into v_patient_id
    from public.camila_pacientes p
    where p.tenant_id = p_tenant_id
      and (
        (v_email <> '' and lower(p.email) = v_email)
        or (length(v_digits) >= 10 and right(regexp_replace(p.telefono, '\D', '', 'g'), 10) = right(v_digits, 10))
      )
    order by p.updated_at desc
    limit 1;
    v_reused := v_patient_id is not null;
  end if;

  if v_patient_id is null then
    insert into public.camila_pacientes (tenant_id, nombre, apellido, email, telefono, notas)
    values (p_tenant_id, v_name, '', v_email, v_phone, 'Expediente iniciado desde una conversación de LANA.')
    returning id into v_patient_id;
  end if;

  insert into public.camila_casos (
    tenant_id, nombre_paciente, telefono, email, notas_doctor, es_prospecto
  ) values (
    p_tenant_id::text,
    (select trim(concat_ws(' ', nombre, apellido)) from public.camila_pacientes where id = v_patient_id),
    (select telefono from public.camila_pacientes where id = v_patient_id),
    (select email from public.camila_pacientes where id = v_patient_id),
    'Caso iniciado desde LANA. No se copió el chat ni se compartió contenido clínico automáticamente.',
    true
  ) returning id into v_case_id;

  insert into public.camila_lana_handoffs (
    tenant_id, lana_conversation_id, lana_channel, patient_id, case_id, created_by
  ) values (
    p_tenant_id, p_lana_conversation_id, p_lana_channel, v_patient_id, v_case_id, p_actor_id
  );

  return query select v_patient_id, v_case_id, v_reused, false;
end;
$$;

revoke all on function public.camila_confirmar_lana_handoff(uuid, uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.camila_confirmar_lana_handoff(uuid, uuid, uuid, text, text, text, text, uuid) to service_role;
