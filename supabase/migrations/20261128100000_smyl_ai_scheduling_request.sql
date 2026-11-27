-- SMYL · Agenda con IA, paso 2: el asistente deja una SOLICITUD en «Agenda → Por aprobar» (task-id smyl-agenda-ia-solicitud).
-- El asistente de LANA ya puede sugerir horarios (paso 1, solo lectura). Ahora, con un modo nuevo y APAGADO por defecto («request»), el
-- paciente elige una de las opciones ofrecidas y se crea una solicitud pendiente. NUNCA confirma una cita: una persona la acepta o rechaza.
-- Seguridad: la opción elegida debe pertenecer a una oferta guardada en el servidor (no se puede inventar un horario), vence a los 30 min,
-- es idempotente, tiene topes por conversación y por clínica, y solo se guardan nombre y medio de contacto con consentimiento explícito.
-- Aditiva e idempotente.
begin;

-- 1) Nuevo nivel «request» (la clínica lo enciende en Configuración → Agenda → Agenda con IA).
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.smyl_ai_scheduling_settings'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%level%'
  loop
    execute format('alter table public.smyl_ai_scheduling_settings drop constraint %I', v_name);
  end loop;
  alter table public.smyl_ai_scheduling_settings
    add constraint smyl_ai_scheduling_settings_level_check check (level in ('off', 'suggest', 'request', 'book'));
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.smyl_ai_scheduling_events'::regclass and c.contype = 'c'
      and (pg_get_constraintdef(c.oid) like '%action%' or pg_get_constraintdef(c.oid) like '%status%')
  loop
    execute format('alter table public.smyl_ai_scheduling_events drop constraint %I', v_name);
  end loop;
  alter table public.smyl_ai_scheduling_events
    add constraint smyl_ai_scheduling_events_action_check check (action in ('context', 'suggest', 'request'));
  alter table public.smyl_ai_scheduling_events
    add constraint smyl_ai_scheduling_events_status_check
    check (status in ('ok', 'few', 'none', 'denied', 'invalid', 'limited', 'error', 'created', 'duplicate', 'taken', 'capped', 'expired'));
end $$;

-- 2) La clínica elige el nivel (corrige además el parámetro `p_tenant_id` que mandaba la pantalla: la función toma el tenant de la sesión).
create or replace function public.smyl_set_ai_scheduling(p_level text, p_min_lead_hours integer, p_horizon_days integer, p_service_ids uuid[])
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_ids uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  v_valid integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'settings.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para configurar la agenda con IA.';
  end if;
  -- «book» (agendar solo) sigue sin poderse activar desde aquí.
  if p_level not in ('off', 'suggest', 'request') or p_min_lead_hours not between 1 and 72 or p_horizon_days not between 1 and 60 or cardinality(v_ids) > 50 then
    raise exception using errcode = '22023', message = 'Configuración no válida.';
  end if;
  select count(*) into v_valid from public.smyl_services s where s.tenant_id = v_tenant and s.active and s.id = any (v_ids);
  if v_valid <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception using errcode = '22023', message = 'Algún servicio no existe o está inactivo.';
  end if;
  if p_level in ('suggest', 'request') and cardinality(v_ids) = 0 then
    raise exception using errcode = '22023', message = 'Elige al menos un servicio que el asistente pueda sugerir.';
  end if;
  insert into public.smyl_ai_scheduling_settings(tenant_id, level, min_lead_hours, horizon_days, updated_by)
  values (v_tenant, p_level, p_min_lead_hours, p_horizon_days, auth.uid())
  on conflict (tenant_id) do update set level = excluded.level, min_lead_hours = excluded.min_lead_hours, horizon_days = excluded.horizon_days, updated_by = auth.uid();
  delete from public.smyl_ai_scheduling_services where tenant_id = v_tenant and not (service_id = any (v_ids));
  insert into public.smyl_ai_scheduling_services(tenant_id, service_id)
  select v_tenant, x from unnest(v_ids) x on conflict do nothing;
  return jsonb_build_object('level', p_level, 'min_lead_hours', p_min_lead_hours, 'horizon_days', p_horizon_days, 'service_ids', to_jsonb(v_ids));
end;
$$;
revoke all on function public.smyl_set_ai_scheduling(text, integer, integer, uuid[]) from public, anon;
grant execute on function public.smyl_set_ai_scheduling(text, integer, integer, uuid[]) to authenticated;

-- 3) Datos mínimos del solicitante, SOLO si el paciente los autoriza en el chat. No crean paciente ni expediente.
alter table public.smyl_appointment_requests
  add column if not exists requester_name text check (requester_name is null or char_length(requester_name) between 2 and 80),
  add column if not exists requester_contact text check (requester_contact is null or char_length(requester_contact) between 7 and 120),
  add column if not exists chat_consent_at timestamptz,
  add column if not exists chat_privacy_notice_version text check (chat_privacy_notice_version is null or chat_privacy_notice_version ~ '^chat-appointment-v[0-9]+$'),
  add column if not exists requester_expires_at timestamptz;

-- 4) Crea la solicitud desde una oferta guardada. Solo service_role (la llama la función lana-scheduling, ya autenticada por firma).
create or replace function public.smyl_ai_scheduling_create_request(
  p_tenant_id uuid, p_lana_tenant_id uuid, p_conversation_id uuid, p_offer_key uuid, p_option_index integer,
  p_name text, p_contact text, p_consent boolean, p_notice_version text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_offer public.smyl_assistant_slot_offers%rowtype;
  v_slot jsonb;
  v_request_id uuid;
  v_key uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_contact text := btrim(coalesce(p_contact, ''));
  v_req public.smyl_appointment_requests%rowtype;
  v_digits text;
begin
  if p_tenant_id is null or p_lana_tenant_id is null or p_conversation_id is null or p_option_index is null then
    raise exception using errcode = '22023', message = 'SMYL_INVALID_REQUEST';
  end if;
  if p_consent is not true then
    raise exception using errcode = '22023', message = 'SMYL_CONSENT_REQUIRED';
  end if;
  if p_notice_version is null or p_notice_version !~ '^chat-appointment-v[0-9]+$' then
    raise exception using errcode = '22023', message = 'SMYL_INVALID_REQUEST';
  end if;
  v_digits := regexp_replace(v_contact, '[^0-9]', '', 'g');
  if char_length(v_name) not between 2 and 80 or char_length(v_contact) not between 7 and 120
     or not ((char_length(v_digits) between 10 and 15 and v_contact ~ '^[+0-9 ().-]+$') or v_contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception using errcode = '22023', message = 'SMYL_INVALID_CONTACT';
  end if;
  if p_option_index not between 1 and 3 then
    raise exception using errcode = '22023', message = 'SMYL_INVALID_REQUEST';
  end if;

  -- Sin clave explícita se usa la oferta MÁS RECIENTE de esa conversación (el modelo de LANA no conoce la clave: solo elige el número).
  if p_offer_key is null then
    select * into v_offer from public.smyl_assistant_slot_offers
     where tenant_id = p_tenant_id and lana_tenant_id = p_lana_tenant_id and lana_conversation_id = p_conversation_id
     order by created_at desc limit 1 for update;
  else
    select * into v_offer from public.smyl_assistant_slot_offers
     where tenant_id = p_tenant_id and offer_key = p_offer_key for update;
  end if;
  if not found or v_offer.lana_tenant_id <> p_lana_tenant_id or v_offer.lana_conversation_id <> p_conversation_id then
    raise exception using errcode = 'SM001', message = 'SMYL_OFFER_NOT_FOUND';
  end if;
  v_slot := v_offer.slots -> (p_option_index - 1);
  if v_slot is null or jsonb_typeof(v_slot) <> 'object' then
    raise exception using errcode = 'SM001', message = 'SMYL_OFFER_NOT_FOUND';
  end if;

  -- Idempotencia: la misma opción de la misma oferta devuelve la solicitud ya creada.
  if v_offer.request_id is not null then
    if v_offer.selected_index = p_option_index then
      select * into v_req from public.smyl_appointment_requests where tenant_id = p_tenant_id and id = v_offer.request_id;
      return jsonb_build_object('request_id', v_offer.request_id, 'duplicate', true, 'starts_at', v_req.requested_start, 'ends_at', v_req.requested_end, 'status', v_req.status, 'slot', v_slot);
    end if;
    raise exception using errcode = 'SM002', message = 'SMYL_OFFER_ALREADY_USED';
  end if;
  if v_offer.expires_at <= clock_timestamp() then
    raise exception using errcode = 'SM003', message = 'SMYL_OFFER_EXPIRED';
  end if;

  -- Topes anti-spam: pendientes por conversación y solicitudes del asistente por clínica en la última hora.
  if (select count(*) from public.smyl_appointment_requests
       where tenant_id = p_tenant_id and source = 'assistant' and lana_conversation_id = p_conversation_id and status = 'pending') >= 2
     or (select count(*) from public.smyl_appointment_requests
          where tenant_id = p_tenant_id and source = 'assistant' and created_at > clock_timestamp() - interval '1 hour') >= 30 then
    raise exception using errcode = 'SM004', message = 'SMYL_CAPPED';
  end if;

  v_key := md5(v_offer.offer_key::text || ':' || p_option_index::text)::uuid;
  -- Revalida el horario con la misma lógica de la Agenda (23P01 si ya no está libre) y lo aparta 10 minutos.
  v_request_id := public.smyl_assistant_create_appointment_request(
    p_tenant_id, p_conversation_id, (v_slot ->> 'service_id')::uuid, (v_slot ->> 'branch_id')::uuid,
    (v_slot ->> 'professional_id')::uuid, (v_slot ->> 'starts_at')::timestamptz, v_key);

  update public.smyl_appointment_requests
     set requester_name = v_name, requester_contact = v_contact, chat_consent_at = clock_timestamp(),
         chat_privacy_notice_version = p_notice_version, requester_expires_at = clock_timestamp() + interval '90 days',
         patient_message = 'Solicitud hecha por el paciente en el chat con IA. Pendiente de confirmación humana.',
         updated_at = clock_timestamp()
   where tenant_id = p_tenant_id and id = v_request_id;
  update public.smyl_assistant_slot_offers
     set selected_index = p_option_index, request_id = v_request_id, updated_at = clock_timestamp()
   where id = v_offer.id;

  select * into v_req from public.smyl_appointment_requests where tenant_id = p_tenant_id and id = v_request_id;
  return jsonb_build_object('request_id', v_request_id, 'duplicate', false, 'starts_at', v_req.requested_start, 'ends_at', v_req.requested_end,
    'hold_expires_at', v_req.slot_hold_expires_at, 'status', v_req.status, 'slot', v_slot);
end;
$$;
revoke all on function public.smyl_ai_scheduling_create_request(uuid, uuid, uuid, uuid, integer, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.smyl_ai_scheduling_create_request(uuid, uuid, uuid, uuid, integer, text, text, boolean, text) to service_role;

-- 5) Depuración de los datos de contacto vencidos (90 días): conserva la solicitud y borra nombre y contacto. Se programa aparte (pg_cron o tarea).
create or replace function public.smyl_ai_scheduling_purge_requester_data()
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_count integer;
begin
  update public.smyl_appointment_requests
     set requester_name = null, requester_contact = null, requester_expires_at = null, updated_at = clock_timestamp()
   where requester_expires_at is not null and requester_expires_at <= clock_timestamp() and (requester_name is not null or requester_contact is not null);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.smyl_ai_scheduling_purge_requester_data() from public, anon, authenticated;
grant execute on function public.smyl_ai_scheduling_purge_requester_data() to service_role;

comment on column public.smyl_appointment_requests.requester_name is 'Nombre dado por el paciente en el chat con IA, solo con su consentimiento (chat_consent_at). No crea paciente.';
comment on column public.smyl_appointment_requests.requester_contact is 'Teléfono o correo dado por el paciente en el chat con IA, solo con su consentimiento. Se depura a los 90 días.';
commit;
