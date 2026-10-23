-- SMYL · Asistente del perfil público (fase 1).
--
-- 1) smyl_public_available_slots: huecos libres reales para que el asistente
--    ofrezca horarios. Reutiliza smyl_validate_service_appointment_slot (la
--    misma regla que aplica Agenda al confirmar), así nunca ofrece algo que
--    después la clínica no podría aceptar. Solo service_role (Edge Function).
-- 2) smyl_public_assistant_conversations: transcript de cada conversación,
--    ligado a la solicitud cuando el paciente agenda. El equipo lo lee desde
--    Agenda → Por aprobar. Sin acceso anónimo; caduca a los 30 días.

begin;

create or replace function public.smyl_public_available_slots(
  p_tenant_id uuid,
  p_professional_id uuid,
  p_branch_id uuid,
  p_service_id uuid,
  p_from date default null,
  p_days integer default 7,
  p_step_minutes integer default 30,
  p_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tz text;
  v_duration integer;
  v_from date;
  v_days integer := greatest(1, least(14, coalesce(p_days, 7)));
  v_step integer := greatest(15, least(120, coalesce(p_step_minutes, 30)));
  v_limit integer := greatest(1, least(60, coalesce(p_limit, 40)));
  v_day date;
  v_window record;
  v_t time;
  v_starts timestamptz;
  v_ends timestamptz;
  v_room uuid;
  v_has_rooms boolean;
  v_ok boolean;
  v_out jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  select b.timezone into v_tz
  from public.smyl_branches b
  where b.tenant_id = p_tenant_id and b.id = p_branch_id and b.active;
  if not found then return v_out; end if;

  select s.duration_minutes into v_duration
  from public.smyl_services s
  where s.tenant_id = p_tenant_id and s.id = p_service_id and s.active;
  if not found or coalesce(v_duration, 0) <= 0 then return v_out; end if;

  v_from := coalesce(p_from, (now() at time zone v_tz)::date);
  if v_from < (now() at time zone v_tz)::date then
    v_from := (now() at time zone v_tz)::date;
  end if;

  select exists (
    select 1 from public.smyl_rooms r
    where r.tenant_id = p_tenant_id and r.branch_id = p_branch_id and r.active
  ) into v_has_rooms;

  for i in 0 .. v_days - 1 loop
    v_day := v_from + i;
    for v_window in
      select h.starts_at, h.ends_at
      from public.smyl_professional_hours h
      where h.tenant_id = p_tenant_id and h.professional_id = p_professional_id
        and h.branch_id = p_branch_id and h.active
        and h.weekday = extract(dow from v_day)::integer
      order by h.starts_at
    loop
      v_t := v_window.starts_at;
      while v_t + make_interval(mins => v_duration) <= v_window.ends_at loop
        v_starts := (v_day::timestamp + v_t) at time zone v_tz;
        v_ends := v_starts + make_interval(mins => v_duration);
        if v_starts >= now() + interval '2 hours' then
          v_ok := false;
          if v_has_rooms then
            for v_room in
              select r.id from public.smyl_rooms r
              where r.tenant_id = p_tenant_id and r.branch_id = p_branch_id and r.active
              order by r.exclusive_use, r.name
            loop
              begin
                perform public.smyl_validate_service_appointment_slot(
                  p_tenant_id, null, null, p_service_id, p_branch_id, p_professional_id,
                  v_room, v_starts, v_ends, 0);
                v_ok := true;
              exception when others then
                v_ok := false;
              end;
              exit when v_ok;
            end loop;
          else
            begin
              perform public.smyl_validate_service_appointment_slot(
                p_tenant_id, null, null, p_service_id, p_branch_id, p_professional_id,
                null, v_starts, v_ends, 0);
              v_ok := true;
            exception when others then
              v_ok := false;
            end;
          end if;
          if v_ok then
            v_out := v_out || jsonb_build_object('starts_at', v_starts, 'ends_at', v_ends);
            v_count := v_count + 1;
            if v_count >= v_limit then return v_out; end if;
          end if;
        end if;
        v_t := v_t + make_interval(mins => v_step);
      end loop;
    end loop;
  end loop;

  return v_out;
end;
$$;

revoke all on function public.smyl_public_available_slots(uuid, uuid, uuid, uuid, date, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.smyl_public_available_slots(uuid, uuid, uuid, uuid, date, integer, integer, integer)
  to service_role;

create table if not exists public.smyl_public_assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  professional_id uuid not null,
  profile_slug text not null check (char_length(profile_slug) <= 80),
  visitor_key text not null default '' check (char_length(visitor_key) <= 64),
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  message_count integer not null default 0,
  status text not null default 'open' check (status in ('open', 'requested', 'closed')),
  appointment_request_id uuid references public.smyl_appointment_requests(id) on delete set null,
  intake_id uuid references public.smyl_public_appointment_intakes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  foreign key (tenant_id, professional_id)
    references public.smyl_professionals(tenant_id, id) on delete cascade
);

create index if not exists smyl_public_assistant_conversations_request_idx
  on public.smyl_public_assistant_conversations (tenant_id, appointment_request_id)
  where appointment_request_id is not null;
create index if not exists smyl_public_assistant_conversations_visitor_idx
  on public.smyl_public_assistant_conversations (tenant_id, professional_id, visitor_key, updated_at desc);

alter table public.smyl_public_assistant_conversations enable row level security;

drop policy if exists smyl_public_assistant_conversations_read on public.smyl_public_assistant_conversations;
create policy smyl_public_assistant_conversations_read on public.smyl_public_assistant_conversations
  for select to authenticated
  using (
    public.smyl_can_edit_professional_profile(tenant_id, professional_id)
    or public.smyl_has_permission(tenant_id, 'schedule.manage')
  );

revoke all on table public.smyl_public_assistant_conversations from public, anon;
grant select on table public.smyl_public_assistant_conversations to authenticated;

drop trigger if exists smyl_public_assistant_conversations_touch on public.smyl_public_assistant_conversations;
create trigger smyl_public_assistant_conversations_touch
  before update on public.smyl_public_assistant_conversations
  for each row execute function public.smyl_touch_updated_at();

-- Agenda → Por aprobar: transcript de la conversación que originó la solicitud.
create or replace function public.smyl_assistant_conversation_for_request(p_request_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'created_at', c.created_at,
    'messages', c.messages
  )
  from public.smyl_public_assistant_conversations c
  where c.appointment_request_id = p_request_id
    and c.tenant_id = public.smyl_current_tenant()
    and public.smyl_has_permission(c.tenant_id, 'schedule.read')
  order by c.updated_at desc
  limit 1;
$$;

revoke all on function public.smyl_assistant_conversation_for_request(uuid) from public, anon;
grant execute on function public.smyl_assistant_conversation_for_request(uuid) to authenticated;

-- Limpieza por lotes (service_role, para un cron): conversaciones vencidas sin solicitud ligada
-- se borran; las ligadas a una solicitud se vacían para no retener texto libre del paciente.
create or replace function public.smyl_purge_expired_assistant_conversations(p_batch integer default 500)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer := 0;
  v_cleared integer := 0;
begin
  with doomed as (
    select id from public.smyl_public_assistant_conversations
    where expires_at <= clock_timestamp() and appointment_request_id is null
    limit greatest(1, least(5000, coalesce(p_batch, 500)))
  )
  delete from public.smyl_public_assistant_conversations c using doomed where c.id = doomed.id;
  get diagnostics v_deleted = row_count;

  with stale as (
    select id from public.smyl_public_assistant_conversations
    where expires_at <= clock_timestamp() and appointment_request_id is not null
      and messages <> '[]'::jsonb
    limit greatest(1, least(5000, coalesce(p_batch, 500)))
  )
  update public.smyl_public_assistant_conversations c
     set messages = '[]'::jsonb, status = 'closed'
    from stale where c.id = stale.id;
  get diagnostics v_cleared = row_count;

  return v_deleted + v_cleared;
end;
$$;

revoke all on function public.smyl_purge_expired_assistant_conversations(integer) from public, anon, authenticated;
grant execute on function public.smyl_purge_expired_assistant_conversations(integer) to service_role;

comment on table public.smyl_public_assistant_conversations is
  'Conversaciones del asistente del perfil público. Solo la Edge Function escribe; el equipo lee. Caducan a 30 días.';

commit;
