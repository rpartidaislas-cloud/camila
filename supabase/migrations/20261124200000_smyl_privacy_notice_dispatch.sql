-- Aviso de privacidad automático por WhatsApp a pacientes nuevos.
-- La clínica lo enciende o apaga (apagado por defecto). Un paciente «nuevo» es el que se creó hace menos de 14 días, aún no firmó el
-- aviso, no se le ha mandado antes, tiene una conversación de WhatsApp ligada y no ha negado WhatsApp. La Edge Function
-- privacy-notice-dispatch (con la sesión de quien abre el panel) crea el enlace de firma y lo manda con la plantilla aprobada
-- «aviso_privacidad_v1» por LANA. Un solo envío por paciente: se reserva antes de mandar y se libera si falla.
-- Solo agrega: dos tablas y funciones; no toca lo existente.

begin;

create table if not exists public.smyl_privacy_settings (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  auto_send_notice boolean not null default false,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.smyl_privacy_settings enable row level security;
revoke all on public.smyl_privacy_settings from public, anon, authenticated;

create table if not exists public.smyl_consent_dispatches (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  status text not null default 'sending' check (status in ('sending', 'sent')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (tenant_id, patient_id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id) on delete cascade
);
alter table public.smyl_consent_dispatches enable row level security;
revoke all on public.smyl_consent_dispatches from public, anon, authenticated;

-- Panel: estado del envío automático.
create or replace function public.smyl_get_privacy_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_on boolean;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'patients.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para ver esto.';
  end if;
  select auto_send_notice into v_on from public.smyl_privacy_settings where tenant_id = v_tenant;
  return jsonb_build_object(
    'auto_send_notice', coalesce(v_on, false),
    'sent_30d', (select count(*) from public.smyl_consent_dispatches where tenant_id = v_tenant and status = 'sent' and sent_at > now() - interval '30 days'),
    'last_sent_at', (select max(sent_at) from public.smyl_consent_dispatches where tenant_id = v_tenant and status = 'sent'));
end;
$$;

create or replace function public.smyl_set_privacy_settings(p_auto_send boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'patients.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para cambiar esto.';
  end if;
  if p_auto_send is null then raise exception using errcode = '22023', message = 'Indica si se activa o no.'; end if;
  insert into public.smyl_privacy_settings (tenant_id, auto_send_notice) values (v_tenant, p_auto_send)
  on conflict (tenant_id) do update set auto_send_notice = excluded.auto_send_notice, updated_by = auth.uid(), updated_at = now();
  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values (v_tenant, auth.uid(), 'update', 'smyl_privacy_settings', v_tenant::text, jsonb_build_object('auto_send_notice', p_auto_send));
  return public.smyl_get_privacy_settings();
end;
$$;

-- Solo la Edge Function (service_role): pacientes a quienes toca mandarles el aviso.
create or replace function public.smyl_privacy_dispatch_candidates(p_tenant uuid, p_limit integer default 5)
returns table (patient_id uuid, first_name text, conversation_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.id, nullif(btrim(p.nombre), ''), h.lana_conversation_id
    from public.camila_pacientes p
    join lateral (select x.lana_conversation_id from public.camila_lana_handoffs x
                   where x.tenant_id = p.tenant_id and x.patient_id = p.id and x.lana_channel = 'whatsapp'
                   order by x.updated_at desc limit 1) h on true
   where p.tenant_id = p_tenant
     and p.created_at > now() - interval '14 days'
     and not exists (select 1 from public.smyl_patient_consents c where c.tenant_id = p.tenant_id and c.patient_id = p.id and c.kind = 'privacy_notice')
     and not exists (select 1 from public.smyl_consent_dispatches d where d.tenant_id = p.tenant_id and d.patient_id = p.id and (d.status = 'sent' or d.created_at > now() - interval '15 minutes'))
     and public.smyl_patient_privacy_state(p.tenant_id, p.id, 'whatsapp') <> 'revoked'
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

-- Reserva el envío (true = este proceso es el que debe mandarlo). Una reserva «sending» de hace más de 15 min se considera caída.
create or replace function public.smyl_privacy_dispatch_claim(p_tenant uuid, p_patient uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_n integer;
begin
  delete from public.smyl_consent_dispatches where tenant_id = p_tenant and patient_id = p_patient and status = 'sending' and created_at < now() - interval '15 minutes';
  insert into public.smyl_consent_dispatches (tenant_id, patient_id) values (p_tenant, p_patient) on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

create or replace function public.smyl_privacy_dispatch_finish(p_tenant uuid, p_patient uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_ok then
    update public.smyl_consent_dispatches set status = 'sent', sent_at = now() where tenant_id = p_tenant and patient_id = p_patient;
    insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
    values (p_tenant, null, 'insert', 'smyl_consent_dispatches', p_patient::text, jsonb_build_object('patient_id', p_patient, 'channel', 'whatsapp'));
  else
    delete from public.smyl_consent_dispatches where tenant_id = p_tenant and patient_id = p_patient and status = 'sending';
  end if;
end;
$$;

revoke all on function public.smyl_get_privacy_settings() from public, anon;
revoke all on function public.smyl_set_privacy_settings(boolean) from public, anon;
revoke all on function public.smyl_privacy_dispatch_candidates(uuid, integer) from public, anon, authenticated;
revoke all on function public.smyl_privacy_dispatch_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.smyl_privacy_dispatch_finish(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.smyl_get_privacy_settings() to authenticated;
grant execute on function public.smyl_set_privacy_settings(boolean) to authenticated;
grant execute on function public.smyl_privacy_dispatch_candidates(uuid, integer) to service_role;
grant execute on function public.smyl_privacy_dispatch_claim(uuid, uuid) to service_role;
grant execute on function public.smyl_privacy_dispatch_finish(uuid, uuid, boolean) to service_role;

commit;
