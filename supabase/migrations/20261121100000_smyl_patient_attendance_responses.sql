-- SMYL · Respuestas del paciente a los avisos de cita («Confirmo mi asistencia» / «Necesito reprogramar»).
-- LANA conserva el chat; SMYL solo guarda la decisión normalizada y la cita a la que corresponde, nunca el texto.
-- Una respuesta NUNCA cancela ni mueve la cita: solo la marca para que recepción decida.
-- Aditiva e idempotente.

begin;

create table if not exists public.smyl_appointment_patient_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  appointment_id uuid not null,
  response text not null check (response in ('confirmed', 'reschedule')),
  -- Horario de la cita cuando respondió: si la cita se mueve después, la respuesta deja de valer.
  appointment_starts_at timestamptz not null,
  -- true si el paciente tenía más de una cita próxima y se tomó la más cercana.
  ambiguous boolean not null default false,
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 200),
  responded_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider_event_id),
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id) on delete cascade
);

create index if not exists smyl_appointment_patient_responses_appointment_idx
  on public.smyl_appointment_patient_responses(tenant_id, appointment_id, responded_at desc);

alter table public.smyl_appointment_patient_responses enable row level security;
drop policy if exists smyl_appointment_patient_responses_read on public.smyl_appointment_patient_responses;
create policy smyl_appointment_patient_responses_read on public.smyl_appointment_patient_responses
  for select to authenticated using (
    public.smyl_has_permission(tenant_id, 'schedule.read')
    and exists (select 1 from public.smyl_appointments a where a.tenant_id = smyl_appointment_patient_responses.tenant_id and a.id = smyl_appointment_patient_responses.appointment_id)
  );
revoke all on table public.smyl_appointment_patient_responses from anon;
revoke insert, update, delete on table public.smyl_appointment_patient_responses from authenticated;
grant select on public.smyl_appointment_patient_responses to authenticated;

-- Aplica la respuesta de un botón. Solo la Edge Function firmada (service_role) la llama.
-- Liga el chat con el paciente y toma su cita confirmada más próxima (de 2 h atrás a 4 días adelante).
create or replace function public.smyl_apply_patient_attendance_response(
  p_tenant uuid, p_conversation uuid, p_event_id text, p_response text, p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_patients uuid[];
  v_appointments record;
  v_count integer;
  v_inserted uuid;
begin
  if p_tenant is null or p_conversation is null or coalesce(p_event_id, '') = '' or p_response not in ('confirmed', 'reschedule') or p_occurred_at is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  select array_agg(distinct h.patient_id) into v_patients
    from public.camila_lana_handoffs h
   where h.tenant_id = p_tenant and h.lana_conversation_id = p_conversation and h.patient_id is not null;
  if v_patients is null then return jsonb_build_object('status', 'no_patient'); end if;
  if array_length(v_patients, 1) > 1 then return jsonb_build_object('status', 'ambiguous_patient'); end if;

  select count(*) into v_count
    from public.smyl_appointments a
   where a.tenant_id = p_tenant and a.patient_id = v_patients[1] and a.status = 'confirmed'
     and a.starts_at >= p_occurred_at - interval '2 hours' and a.starts_at < p_occurred_at + interval '4 days';
  if v_count = 0 then return jsonb_build_object('status', 'no_appointment'); end if;

  select a.id, a.starts_at into v_appointments
    from public.smyl_appointments a
   where a.tenant_id = p_tenant and a.patient_id = v_patients[1] and a.status = 'confirmed'
     and a.starts_at >= p_occurred_at - interval '2 hours' and a.starts_at < p_occurred_at + interval '4 days'
   order by a.starts_at asc limit 1;

  insert into public.smyl_appointment_patient_responses(tenant_id, appointment_id, response, appointment_starts_at, ambiguous, provider_event_id, responded_at)
  values (p_tenant, v_appointments.id, p_response, v_appointments.starts_at, v_count > 1, p_event_id, p_occurred_at)
  on conflict (tenant_id, provider_event_id) do nothing
  returning id into v_inserted;
  if v_inserted is null then return jsonb_build_object('status', 'duplicate'); end if;
  return jsonb_build_object('status', 'applied', 'response', p_response, 'appointment_id', v_appointments.id, 'ambiguous', v_count > 1);
end;
$$;
revoke all on function public.smyl_apply_patient_attendance_response(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.smyl_apply_patient_attendance_response(uuid, uuid, text, text, timestamptz) to service_role;

commit;
