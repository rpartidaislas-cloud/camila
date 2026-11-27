-- SMYL · Agenda con IA, paso 3: nivel «agendar» (book). El asistente puede CONFIRMAR la cita cuando el paciente acepta un horario que el propio
-- servidor ofreció, pero solo bajo candados. Apagado por defecto; la clínica lo enciende en Agenda → Horarios y servicios → Agenda con IA.
--
-- Candados (todos del lado del servidor):
--   1. Nivel «book» encendido por la clínica y solo para los servicios que ella habilitó.
--   2. El horario debe venir de una oferta guardada por el servidor (no se inventa), con consentimiento del paciente y la misma
--      revalidación del horario que usa la Agenda (choques, horario de sucursal y dentista, sillón, bloqueos, anticipación mínima).
--   3. La conversación debe estar VINCULADA a un paciente (camila_lana_handoffs.patient_id). Si no lo está, NO se agenda: queda la solicitud
--      pendiente en «Por aprobar» (igual que el nivel «solicitud»). La IA nunca crea pacientes ni expedientes.
--   4. Tope por día (book_daily_cap, 10 por omisión, 1–50). Al llegar al tope, las siguientes quedan como solicitud pendiente.
--   5. Reversible: la cita queda marcada «Agendada por la IA en el chat…» (notas) y con evento en la bitácora; el equipo la cancela o la
--      reprograma como cualquier otra.
-- Aditiva e idempotente. Publicar la migración antes que las funciones no rompe nada (el nivel solo se puede elegir con esta migración).
begin;

-- 1) Bitácora de eventos: acción «book» y estados nuevos.
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.smyl_ai_scheduling_events'::regclass and c.contype = 'c'
      and (pg_get_constraintdef(c.oid) like '%action%' or pg_get_constraintdef(c.oid) like '%status%')
  loop
    execute format('alter table public.smyl_ai_scheduling_events drop constraint %I', v_name);
  end loop;
  alter table public.smyl_ai_scheduling_events
    add constraint smyl_ai_scheduling_events_action_check check (action in ('context', 'suggest', 'request', 'book'));
  alter table public.smyl_ai_scheduling_events
    add constraint smyl_ai_scheduling_events_status_check
    check (status in ('ok', 'few', 'none', 'denied', 'invalid', 'limited', 'error', 'created', 'duplicate', 'taken', 'capped', 'expired', 'booked', 'pending_review'));
end $$;

-- 2) Tope de citas que la IA puede confirmar por día.
alter table public.smyl_ai_scheduling_settings
  add column if not exists book_daily_cap integer not null default 10 check (book_daily_cap between 1 and 50);

-- 3) La clínica elige el nivel (ahora también «book») y, opcionalmente, el tope diario.
drop function if exists public.smyl_set_ai_scheduling(text, integer, integer, uuid[]);
create or replace function public.smyl_set_ai_scheduling(p_level text, p_min_lead_hours integer, p_horizon_days integer, p_service_ids uuid[], p_book_cap integer default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_ids uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
  v_valid integer;
  v_cap integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'settings.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para configurar la agenda con IA.';
  end if;
  if p_level not in ('off', 'suggest', 'request', 'book') or p_min_lead_hours not between 1 and 72 or p_horizon_days not between 1 and 60 or cardinality(v_ids) > 50
     or (p_book_cap is not null and p_book_cap not between 1 and 50) then
    raise exception using errcode = '22023', message = 'Configuración no válida.';
  end if;
  select count(*) into v_valid from public.smyl_services s where s.tenant_id = v_tenant and s.active and s.id = any (v_ids);
  if v_valid <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception using errcode = '22023', message = 'Algún servicio no existe o está inactivo.';
  end if;
  if p_level in ('suggest', 'request', 'book') and cardinality(v_ids) = 0 then
    raise exception using errcode = '22023', message = 'Elige al menos un servicio que el asistente pueda ofrecer.';
  end if;
  insert into public.smyl_ai_scheduling_settings(tenant_id, level, min_lead_hours, horizon_days, book_daily_cap, updated_by)
  values (v_tenant, p_level, p_min_lead_hours, p_horizon_days, coalesce(p_book_cap, 10), auth.uid())
  on conflict (tenant_id) do update set level = excluded.level, min_lead_hours = excluded.min_lead_hours, horizon_days = excluded.horizon_days,
    book_daily_cap = coalesce(p_book_cap, public.smyl_ai_scheduling_settings.book_daily_cap), updated_by = auth.uid();
  delete from public.smyl_ai_scheduling_services where tenant_id = v_tenant and not (service_id = any (v_ids));
  insert into public.smyl_ai_scheduling_services(tenant_id, service_id)
  select v_tenant, x from unnest(v_ids) x on conflict do nothing;
  select book_daily_cap into v_cap from public.smyl_ai_scheduling_settings where tenant_id = v_tenant;
  return jsonb_build_object('level', p_level, 'min_lead_hours', p_min_lead_hours, 'horizon_days', p_horizon_days, 'service_ids', to_jsonb(v_ids), 'book_daily_cap', v_cap);
end;
$$;
revoke all on function public.smyl_set_ai_scheduling(text, integer, integer, uuid[], integer) from public, anon;
grant execute on function public.smyl_set_ai_scheduling(text, integer, integer, uuid[], integer) to authenticated;

-- 4) Confirma la cita a partir de una oferta guardada. Solo service_role (la llama lana-scheduling, ya autenticada por firma).
--    Reutiliza smyl_ai_scheduling_create_request (consentimiento, oferta vigente, idempotencia, topes, revalidación del horario) y, si pasan
--    los candados, convierte esa solicitud en cita confirmada. Todo ocurre en una sola transacción: si algo falla, no queda nada a medias.
create or replace function public.smyl_ai_scheduling_book(
  p_tenant_id uuid, p_lana_tenant_id uuid, p_conversation_id uuid, p_offer_key uuid, p_option_index integer,
  p_name text, p_contact text, p_consent boolean, p_notice_version text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_level text;
  v_cap integer;
  v_made jsonb;
  v_request_id uuid;
  v_req public.smyl_appointment_requests%rowtype;
  v_appointment_id uuid := gen_random_uuid();
  v_today integer;
  v_note constant text := 'Agendada por la IA en el chat. Revisa los datos con el paciente.';
begin
  select level, book_daily_cap into v_level, v_cap from public.smyl_ai_scheduling_settings where tenant_id = p_tenant_id;
  if v_level is distinct from 'book' then
    raise exception using errcode = '22023', message = 'SMYL_BOOK_DISABLED';
  end if;

  -- Consentimiento, oferta del servidor, vigencia, idempotencia, topes y horario libre: lo valida la función de solicitud.
  v_made := public.smyl_ai_scheduling_create_request(p_tenant_id, p_lana_tenant_id, p_conversation_id, p_offer_key, p_option_index, p_name, p_contact, p_consent, p_notice_version);
  v_request_id := (v_made ->> 'request_id')::uuid;
  select * into v_req from public.smyl_appointment_requests where tenant_id = p_tenant_id and id = v_request_id for update;

  -- Reintento de una cita ya confirmada: devuelve la misma.
  if v_req.status = 'accepted' and v_req.appointment_id is not null then
    return jsonb_build_object('status', 'booked', 'duplicate', true, 'request_id', v_request_id, 'appointment_id', v_req.appointment_id,
      'starts_at', v_req.requested_start, 'ends_at', v_req.requested_end, 'slot', v_made -> 'slot');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('status', 'pending_review', 'reason', 'request_closed', 'request_id', v_request_id, 'starts_at', v_req.requested_start, 'ends_at', v_req.requested_end, 'slot', v_made -> 'slot');
  end if;

  -- Candado 3: la conversación debe estar vinculada a un paciente. Si no, queda como solicitud para que una persona la revise.
  if v_req.patient_id is null then
    return jsonb_build_object('status', 'pending_review', 'reason', 'needs_patient', 'request_id', v_request_id, 'starts_at', v_req.requested_start, 'ends_at', v_req.requested_end,
      'hold_expires_at', v_req.slot_hold_expires_at, 'slot', v_made -> 'slot');
  end if;

  -- Candado 4: tope diario (24 h corridas) de citas confirmadas por la IA.
  select count(*) into v_today from public.smyl_appointments a
   where a.tenant_id = p_tenant_id and a.source = 'assistant_request' and a.notes like 'Agendada por la IA%' and a.created_at > clock_timestamp() - interval '24 hours';
  if v_today >= coalesce(v_cap, 10) then
    return jsonb_build_object('status', 'pending_review', 'reason', 'daily_cap', 'request_id', v_request_id, 'starts_at', v_req.requested_start, 'ends_at', v_req.requested_end,
      'hold_expires_at', v_req.slot_hold_expires_at, 'slot', v_made -> 'slot');
  end if;

  -- Revalida el horario con la misma lógica de la Agenda (23P01 si ya no está libre; revierte toda la operación).
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_req.preferred_professional_id::text || ':' || v_req.requested_start::date::text, 0));
  if v_req.preferred_room_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || v_req.preferred_room_id::text || ':' || v_req.requested_start::date::text, 0));
  end if;
  perform public.smyl_validate_service_appointment_slot(p_tenant_id, v_appointment_id, null, v_req.service_id, v_req.preferred_branch_id,
    v_req.preferred_professional_id, v_req.preferred_room_id, v_req.requested_start, v_req.requested_end, 0);

  -- La cuenta propietaria (id del tenant = su usuario) figura como autora; la marca «Agendada por la IA» deja claro el origen.
  insert into public.smyl_appointments(id, tenant_id, branch_id, patient_id, professional_id, service_id, room_id, starts_at, ends_at, status, source, notes, extra_minutes, extra_reason, created_by, updated_by)
  values (v_appointment_id, p_tenant_id, v_req.preferred_branch_id, v_req.patient_id, v_req.preferred_professional_id, v_req.service_id, v_req.preferred_room_id,
    v_req.requested_start, v_req.requested_end, 'confirmed', 'assistant_request', v_note, 0, '', p_tenant_id, p_tenant_id);
  insert into public.smyl_appointment_events(tenant_id, appointment_id, event_type, to_status, actor_id, event_data)
  values (p_tenant_id, v_appointment_id, 'created', 'confirmed', null,
    jsonb_build_object('source', 'assistant_ai', 'request_id', v_request_id, 'conversation_id', p_conversation_id));
  update public.smyl_appointment_requests
     set status = 'accepted', appointment_id = v_appointment_id, decided_by = null, decided_at = clock_timestamp(), updated_at = clock_timestamp()
   where tenant_id = p_tenant_id and id = v_request_id;

  return jsonb_build_object('status', 'booked', 'duplicate', false, 'request_id', v_request_id, 'appointment_id', v_appointment_id,
    'starts_at', v_req.requested_start, 'ends_at', v_req.requested_end, 'slot', v_made -> 'slot');
end;
$$;
revoke all on function public.smyl_ai_scheduling_book(uuid, uuid, uuid, uuid, integer, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.smyl_ai_scheduling_book(uuid, uuid, uuid, uuid, integer, text, text, boolean, text) to service_role;

commit;
