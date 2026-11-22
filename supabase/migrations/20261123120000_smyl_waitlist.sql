-- SMYL · Lista de espera: pacientes que quieren un horario más pronto o no encontraron uno.
-- Cuando se libera un hueco (cancelación o cambio), la Agenda propone a quién ofrecérselo; una persona decide y envía.
-- Aditiva e idempotente. No envía mensajes ni agenda sola.
begin;

create table if not exists public.smyl_waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  service_id uuid not null,
  branch_id uuid,
  professional_id uuid,
  daypart text not null default 'any' check (daypart in ('any', 'morning', 'afternoon')),
  not_before date,
  not_after date,
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'cancelled', 'expired')),
  offered_at timestamptz,
  offered_start timestamptz,
  offer_count integer not null default 0 check (offer_count >= 0),
  booked_appointment_id uuid,
  source text not null default 'manual' check (source in ('manual', 'chat')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days'),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.smyl_services(tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id) on delete cascade,
  foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id) on delete cascade,
  check (not_after is null or not_before is null or not_after >= not_before),
  check (status <> 'offered' or (offered_at is not null and offered_start is not null))
);

-- Un paciente solo puede estar una vez en espera por servicio.
create unique index if not exists smyl_waitlist_active_uidx
  on public.smyl_waitlist_entries (tenant_id, patient_id, service_id) where status in ('waiting', 'offered');
create index if not exists smyl_waitlist_tenant_status_idx
  on public.smyl_waitlist_entries (tenant_id, status, created_at);

drop trigger if exists smyl_waitlist_entries_touch on public.smyl_waitlist_entries;
create trigger smyl_waitlist_entries_touch before update on public.smyl_waitlist_entries
  for each row execute function public.smyl_touch_updated_at();
drop trigger if exists smyl_waitlist_entries_audit on public.smyl_waitlist_entries;
create trigger smyl_waitlist_entries_audit after insert or update or delete on public.smyl_waitlist_entries
  for each row execute function public.smyl_audit_row();

alter table public.smyl_waitlist_entries enable row level security;
drop policy if exists smyl_waitlist_entries_read on public.smyl_waitlist_entries;
create policy smyl_waitlist_entries_read on public.smyl_waitlist_entries
  for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
revoke all on table public.smyl_waitlist_entries from anon;
revoke insert, update, delete on table public.smyl_waitlist_entries from authenticated;
grant select on public.smyl_waitlist_entries to authenticated;

-- Agrega al paciente (o actualiza sus preferencias si ya estaba esperando ese servicio). Tenant y permiso salen de auth.uid().
create or replace function public.smyl_waitlist_add(
  p_patient_id uuid, p_service_id uuid, p_branch_id uuid default null, p_professional_id uuid default null,
  p_daypart text default 'any', p_not_before date default null, p_not_after date default null,
  p_priority text default 'normal', p_note text default '', p_source text default 'manual'
) returns public.smyl_waitlist_entries
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_waitlist_entries;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar la lista de espera.';
  end if;
  if p_daypart not in ('any', 'morning', 'afternoon') or p_priority not in ('normal', 'urgent') or p_source not in ('manual', 'chat')
     or char_length(coalesce(p_note, '')) > 300 or (p_not_before is not null and p_not_after is not null and p_not_after < p_not_before) then
    raise exception using errcode = '22023', message = 'Datos de la lista de espera no válidos.';
  end if;
  if not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id) then
    raise exception using errcode = 'P0002', message = 'El paciente no existe.';
  end if;
  if not exists (select 1 from public.smyl_services where tenant_id = v_tenant and id = p_service_id and active) then
    raise exception using errcode = 'P0002', message = 'El servicio no está disponible.';
  end if;
  -- Entradas vencidas no estorban para volver a anotar al paciente.
  update public.smyl_waitlist_entries set status = 'expired'
   where tenant_id = v_tenant and patient_id = p_patient_id and service_id = p_service_id
     and status in ('waiting', 'offered') and expires_at < now();
  insert into public.smyl_waitlist_entries(tenant_id, patient_id, service_id, branch_id, professional_id, daypart, not_before, not_after, priority, note, source, created_by)
  values (v_tenant, p_patient_id, p_service_id, p_branch_id, p_professional_id, p_daypart, p_not_before, p_not_after, p_priority, btrim(coalesce(p_note, '')), p_source, auth.uid())
  on conflict (tenant_id, patient_id, service_id) where status in ('waiting', 'offered')
  do update set branch_id = excluded.branch_id, professional_id = excluded.professional_id, daypart = excluded.daypart,
    not_before = excluded.not_before, not_after = excluded.not_after, priority = excluded.priority, note = excluded.note,
    status = 'waiting', expires_at = now() + interval '60 days'
  returning * into v_row;
  return v_row;
end;
$$;

-- Registra que se le ofreció un horario concreto (pasa a «offered»). Se puede volver a ofrecer otro.
create or replace function public.smyl_waitlist_offer(p_id uuid, p_offered_start timestamptz)
returns public.smyl_waitlist_entries
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_waitlist_entries;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar la lista de espera.';
  end if;
  if p_offered_start is null then raise exception using errcode = '22023', message = 'Falta el horario ofrecido.'; end if;
  update public.smyl_waitlist_entries
     set status = 'offered', offered_at = now(), offered_start = p_offered_start, offer_count = offer_count + 1
   where tenant_id = v_tenant and id = p_id and status in ('waiting', 'offered')
  returning * into v_row;
  if not found then raise exception using errcode = 'P0002', message = 'Esa persona ya no está en espera.'; end if;
  return v_row;
end;
$$;

-- «waiting» (no aceptó el horario y sigue esperando), «booked» (se agendó a mano) o «cancelled» (se quita de la lista).
create or replace function public.smyl_waitlist_set_status(p_id uuid, p_status text)
returns public.smyl_waitlist_entries
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_waitlist_entries;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar la lista de espera.';
  end if;
  if p_status not in ('waiting', 'booked', 'cancelled') then raise exception using errcode = '22023', message = 'Estado no válido.'; end if;
  update public.smyl_waitlist_entries
     set status = p_status,
         offered_at = case when p_status = 'waiting' then null else offered_at end,
         offered_start = case when p_status = 'waiting' then null else offered_start end
   where tenant_id = v_tenant and id = p_id and status in ('waiting', 'offered')
  returning * into v_row;
  if not found then raise exception using errcode = 'P0002', message = 'Esa persona ya no está en espera.'; end if;
  return v_row;
end;
$$;

-- Si el paciente consigue cita para ese servicio por cualquier vía (chat, Agenda o, más adelante, la IA), deja de esperar.
create or replace function public.smyl_waitlist_mark_booked() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status <> 'cancelled' then
    update public.smyl_waitlist_entries
       set status = 'booked', booked_appointment_id = new.id
     where tenant_id = new.tenant_id and patient_id = new.patient_id and service_id = new.service_id
       and status in ('waiting', 'offered');
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_appointments_waitlist_booked on public.smyl_appointments;
create trigger smyl_appointments_waitlist_booked after insert on public.smyl_appointments
  for each row execute function public.smyl_waitlist_mark_booked();

revoke all on function public.smyl_waitlist_add(uuid, uuid, uuid, uuid, text, date, date, text, text, text) from public, anon;
revoke all on function public.smyl_waitlist_offer(uuid, timestamptz) from public, anon;
revoke all on function public.smyl_waitlist_set_status(uuid, text) from public, anon;
revoke all on function public.smyl_waitlist_mark_booked() from public, anon, authenticated;
grant execute on function public.smyl_waitlist_add(uuid, uuid, uuid, uuid, text, date, date, text, text, text) to authenticated;
grant execute on function public.smyl_waitlist_offer(uuid, timestamptz) to authenticated;
grant execute on function public.smyl_waitlist_set_status(uuid, text) to authenticated;

comment on table public.smyl_waitlist_entries is 'Pacientes en lista de espera por servicio. Las escrituras pasan por RPC; el navegador solo lee con schedule.read.';
commit;
