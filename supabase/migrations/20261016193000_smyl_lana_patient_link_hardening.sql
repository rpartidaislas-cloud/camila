-- SMYL: cierre de concurrencia y persistencia del origen del vínculo LANA.
begin;

alter table public.camila_lana_handoffs
  add column if not exists link_kind text not null default 'manual';

update public.camila_lana_handoffs h
set link_kind = 'created_contact'
from public.camila_pacientes p
where h.patient_id = p.id
  and h.tenant_id = p.tenant_id
  and h.case_id is null
  and p.notas like 'Contacto provisional creado desde una conversación.%';

alter table public.camila_lana_handoffs
  drop constraint if exists camila_lana_handoffs_link_kind_check;
alter table public.camila_lana_handoffs
  add constraint camila_lana_handoffs_link_kind_check
  check (link_kind in ('manual', 'matched', 'created_contact', 'confirmed'));

create or replace function public.smyl_classify_lana_handoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.case_id is null and new.case_id is not null then
    new.link_kind := 'confirmed';
  elsif new.case_id is null and exists (
    select 1
    from public.camila_pacientes p
    where p.tenant_id = new.tenant_id
      and p.id = new.patient_id
      and p.notas like 'Contacto provisional creado desde una conversación.%'
  ) then
    new.link_kind := 'created_contact';
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_classify_lana_handoff_trigger on public.camila_lana_handoffs;
create trigger smyl_classify_lana_handoff_trigger
before insert or update of patient_id, case_id on public.camila_lana_handoffs
for each row execute function public.smyl_classify_lana_handoff();

revoke all on function public.smyl_classify_lana_handoff() from public, anon, authenticated;

-- Confirmar manualmente y adjuntar contenido clínico comparten exactamente el
-- mismo lock de conversación que el vínculo automático. Así sólo uno de los
-- flujos puede crear el primer caso clínico.
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
  v_reused boolean := false;
begin
  if p_lana_channel not in ('whatsapp', 'messenger', 'instagram') then
    raise exception 'INVALID_LANA_CHANNEL';
  end if;
  if not public.smyl_actor_has_permission_explicit(p_actor_id, p_tenant_id, 'patients.manage') then
    raise exception 'PATIENT_LINK_ACCESS_DENIED' using errcode = '42501';
  end if;
  if v_name = '' then v_name := 'Paciente de redes sociales'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'smyl-lana-conversation:' || p_tenant_id::text || ':' || p_lana_conversation_id::text, 0
  ));

  select * into v_link
  from public.camila_lana_handoffs h
  where h.tenant_id = p_tenant_id
    and h.lana_conversation_id = p_lana_conversation_id
  for update;

  if found then
    if v_link.case_id is null then
      insert into public.camila_casos (
        tenant_id, nombre_paciente, telefono, email, notas_doctor, es_prospecto
      )
      select
        p_tenant_id::text,
        trim(concat_ws(' ', p.nombre, p.apellido)),
        p.telefono,
        p.email,
        'Caso iniciado por una acción explícita desde el chat. El historial de mensajes no se copió.',
        true
      from public.camila_pacientes p
      where p.tenant_id = p_tenant_id and p.id = v_link.patient_id
      returning id into v_case_id;

      update public.camila_lana_handoffs
      set case_id = v_case_id, link_kind = 'confirmed', updated_at = now()
      where id = v_link.id;
      v_link.case_id := v_case_id;
    end if;
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
    insert into public.camila_pacientes (tenant_id, nombre, apellido, email, telefono, notas)
    values (
      p_tenant_id, v_name, '', v_email, v_phone,
      'Paciente creado después de una confirmación explícita desde el chat.'
    )
    returning id into v_patient_id;
  end if;

  insert into public.camila_casos (
    tenant_id, nombre_paciente, telefono, email, notas_doctor, es_prospecto
  )
  select
    p_tenant_id::text,
    trim(concat_ws(' ', p.nombre, p.apellido)),
    p.telefono,
    p.email,
    'Caso iniciado por una acción explícita desde el chat. El historial de mensajes no se copió.',
    true
  from public.camila_pacientes p
  where p.tenant_id = p_tenant_id and p.id = v_patient_id
  returning id into v_case_id;

  insert into public.camila_lana_handoffs (
    tenant_id, lana_conversation_id, lana_channel, patient_id, case_id, created_by, link_kind
  ) values (
    p_tenant_id, p_lana_conversation_id, p_lana_channel,
    v_patient_id, v_case_id, p_actor_id, 'confirmed'
  );

  return query select v_patient_id, v_case_id, v_reused, false;
end;
$$;

revoke all on function public.camila_confirmar_lana_handoff(uuid, uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.camila_confirmar_lana_handoff(uuid, uuid, uuid, text, text, text, text, uuid)
  to service_role;

create or replace function public.camila_vincular_lana_imagen(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_lana_conversation_id uuid,
  p_lana_message_id bigint,
  p_lana_channel text,
  p_label text default 'Fotografía recibida por chat'
)
returns public.camila_lana_clinical_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handoff public.camila_lana_handoffs%rowtype;
  v_link public.camila_lana_clinical_links%rowtype;
begin
  if p_lana_message_id is null or p_lana_message_id <= 0
     or p_lana_channel not in ('whatsapp', 'messenger', 'instagram') then
    raise exception 'INVALID_LANA_CLINICAL_LINK';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'smyl-lana-conversation:' || p_tenant_id::text || ':' || p_lana_conversation_id::text, 0
  ));

  select * into v_handoff
  from public.camila_lana_handoffs h
  where h.tenant_id = p_tenant_id
    and h.lana_conversation_id = p_lana_conversation_id
  for update;
  if not found then raise exception 'LANA_HANDOFF_REQUIRED'; end if;
  if v_handoff.lana_channel <> p_lana_channel then raise exception 'LANA_CHANNEL_MISMATCH'; end if;

  if v_handoff.case_id is null then
    insert into public.camila_casos (
      tenant_id, nombre_paciente, telefono, email, notas_doctor, es_prospecto
    )
    select
      p_tenant_id::text,
      trim(concat_ws(' ', p.nombre, p.apellido)),
      p.telefono,
      p.email,
      'Caso iniciado al incorporar contenido clínico desde el chat. El historial de mensajes no se copió.',
      true
    from public.camila_pacientes p
    where p.tenant_id = p_tenant_id and p.id = v_handoff.patient_id
    returning id into v_handoff.case_id;

    update public.camila_lana_handoffs
    set case_id = v_handoff.case_id, link_kind = 'confirmed', updated_at = now()
    where id = v_handoff.id;
  end if;

  insert into public.camila_lana_clinical_links(
    tenant_id, handoff_id, lana_conversation_id, lana_message_id,
    lana_channel, patient_id, case_id, media_type, label, created_by
  ) values (
    p_tenant_id, v_handoff.id, p_lana_conversation_id, p_lana_message_id,
    p_lana_channel, v_handoff.patient_id, v_handoff.case_id, 'image',
    left(coalesce(nullif(trim(p_label), ''), 'Fotografía recibida por chat'), 180), p_actor_id
  )
  on conflict (tenant_id, lana_conversation_id, lana_message_id)
  do update set updated_at = camila_lana_clinical_links.updated_at
  returning * into v_link;
  return v_link;
end;
$$;

revoke all on function public.camila_vincular_lana_imagen(uuid, uuid, uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.camila_vincular_lana_imagen(uuid, uuid, uuid, bigint, text, text)
  to service_role;

commit;
