-- Cobros · Fase 3: registro de recordatorios de cobro enviados por WhatsApp y preferencia «no contactar por cobros».
--   * smyl_collection_reminders: una fila por recordatorio enviado (quién, cuándo, a qué paciente, qué plantilla). Permite
--     el tope semanal por paciente aunque lo envíen personas distintas o desde otro dispositivo.
--   * smyl_collection_prefs: el paciente (o la clínica por él) pidió no recibir cobros por WhatsApp (p. ej. respondió BAJA).
--   * Escritura sólo por funciones que derivan clínica y usuario de la sesión; lectura con permiso finance.read.
-- No guarda mensajes ni importes: sólo que se envió algo. Idempotente.

create table if not exists public.smyl_collection_reminders (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  conversation_id uuid,
  template_name text not null check (template_name ~ '^[a-z0-9_]{1,80}$'),
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz not null default now(),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade
);
create index if not exists smyl_collection_reminders_patient_idx
  on public.smyl_collection_reminders (tenant_id, patient_id, sent_at desc);

create table if not exists public.smyl_collection_prefs (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  whatsapp_blocked boolean not null default false,
  reason text check (reason is null or char_length(reason) <= 200),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, patient_id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade
);

alter table public.smyl_collection_reminders enable row level security;
alter table public.smyl_collection_prefs enable row level security;
revoke all on public.smyl_collection_reminders, public.smyl_collection_prefs from public, anon, authenticated;
grant select on public.smyl_collection_reminders, public.smyl_collection_prefs to authenticated;

drop policy if exists smyl_collection_reminders_read on public.smyl_collection_reminders;
create policy smyl_collection_reminders_read on public.smyl_collection_reminders for select to authenticated
  using (tenant_id in (select public.smyl_tenants_with_permission('finance.read')));
drop policy if exists smyl_collection_prefs_read on public.smyl_collection_prefs;
create policy smyl_collection_prefs_read on public.smyl_collection_prefs for select to authenticated
  using (tenant_id in (select public.smyl_tenants_with_permission('finance.read')));

create or replace function public.smyl_log_collection_reminder(
  p_patient_id uuid,
  p_template text,
  p_conversation_id uuid default null
)
returns timestamptz
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_at timestamptz := now();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'messages.respond') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar este envío.';
  end if;
  if p_patient_id is null or not exists (select 1 from public.camila_pacientes p where p.tenant_id = v_tenant and p.id = p_patient_id) then
    raise exception using errcode = 'P0002', message = 'El paciente no existe en tu clínica.';
  end if;
  if coalesce(p_template, '') !~ '^[a-z0-9_]{1,80}$' then
    raise exception using errcode = '22023', message = 'Plantilla no válida.';
  end if;
  -- Tope de seguridad contra bucles del cliente: 200 registros por usuario y hora.
  if (select count(*) from public.smyl_collection_reminders r where r.sent_by = auth.uid() and r.sent_at > now() - interval '1 hour') >= 200 then
    return v_at;
  end if;
  insert into public.smyl_collection_reminders (tenant_id, patient_id, conversation_id, template_name, sent_by, sent_at)
  values (v_tenant, p_patient_id, p_conversation_id, p_template, auth.uid(), v_at);
  return v_at;
end;
$function$;

create or replace function public.smyl_set_collection_pref(
  p_patient_id uuid,
  p_blocked boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'Sin clínica activa.';
  end if;
  -- Bloquear (proteger al paciente) lo puede hacer quien responde mensajes o gestiona cobros; desbloquear sólo quien gestiona cobros.
  if coalesce(p_blocked, false) then
    if not (public.smyl_has_permission(v_tenant, 'messages.respond') or public.smyl_has_permission(v_tenant, 'finance.manage')) then
      raise exception using errcode = '42501', message = 'No tienes permiso para cambiar esta preferencia.';
    end if;
  elsif not public.smyl_has_permission(v_tenant, 'finance.manage') then
    raise exception using errcode = '42501', message = 'Sólo quien gestiona cobros puede volver a permitir recordatorios.';
  end if;
  if p_patient_id is null or not exists (select 1 from public.camila_pacientes p where p.tenant_id = v_tenant and p.id = p_patient_id) then
    raise exception using errcode = 'P0002', message = 'El paciente no existe en tu clínica.';
  end if;
  insert into public.smyl_collection_prefs (tenant_id, patient_id, whatsapp_blocked, reason, updated_by, updated_at)
  values (v_tenant, p_patient_id, coalesce(p_blocked, false), left(p_reason, 200), auth.uid(), now())
  on conflict (tenant_id, patient_id) do update
    set whatsapp_blocked = excluded.whatsapp_blocked, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$function$;

revoke all on function public.smyl_log_collection_reminder(uuid, text, uuid) from public, anon;
revoke all on function public.smyl_set_collection_pref(uuid, boolean, text) from public, anon;
grant execute on function public.smyl_log_collection_reminder(uuid, text, uuid) to authenticated;
grant execute on function public.smyl_set_collection_pref(uuid, boolean, text) to authenticated;
