-- SMYL · Privacidad y derechos de los pacientes (LFPDPPP): elecciones por finalidad, solicitudes ARCO y exportación de datos.
--   * smyl_patient_privacy_events: historial INMUTABLE de lo que el paciente permite o retira por finalidad
--     (uso de IA con proveedores externos, mensajes por WhatsApp, mercadotecnia). Sin fila = «sin registrar».
--   * smyl_data_rights_requests: registro de solicitudes de acceso, rectificación, cancelación u oposición (ARCO) y de revocación, con
--     plazo de 20 días hábiles para responder (sin considerar días festivos), estado y resolución. Una solicitud cerrada no se edita.
--   * smyl_export_patient_data: copia de los datos del paciente para el derecho de acceso, solo con las secciones que el rol puede ver.
-- Las tablas no se escriben directamente: solo por funciones con permiso patients.manage. No cambia nada existente. Idempotente.
begin;

-- ── 1) Elecciones de privacidad por finalidad ───────────────────────────────────────────────
create table if not exists public.smyl_patient_privacy_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  purpose text not null check (purpose in ('ai_processing', 'whatsapp', 'marketing')),
  action text not null check (action in ('granted', 'revoked')),
  source text not null default 'staff' check (source in ('staff', 'data_request')),
  request_id uuid,
  note text not null default '' check (char_length(note) <= 500),
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id) on delete cascade
);
create index if not exists smyl_patient_privacy_events_patient_idx
  on public.smyl_patient_privacy_events (tenant_id, patient_id, purpose, seq desc);

alter table public.smyl_patient_privacy_events enable row level security;
revoke all on public.smyl_patient_privacy_events from public, anon, authenticated;

-- Un registro de privacidad no se modifica: si el paciente cambia de decisión, se agrega otro.
create or replace function public.smyl_privacy_rows_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception using errcode = '55000', message = 'Este registro de privacidad no se puede modificar.';
end;
$$;
drop trigger if exists smyl_patient_privacy_events_no_update on public.smyl_patient_privacy_events;
create trigger smyl_patient_privacy_events_no_update before update on public.smyl_patient_privacy_events
  for each row execute function public.smyl_privacy_rows_immutable();

-- Registrar que el paciente permite o retira una finalidad. Repetir el mismo estado no agrega filas.
create or replace function public.smyl_set_patient_privacy_choice(
  p_patient_id uuid, p_purpose text, p_action text, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_last record;
  v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'patients.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar decisiones de privacidad.';
  end if;
  if not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id) then
    raise exception using errcode = 'P0002', message = 'El paciente no existe.';
  end if;
  if not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
    raise exception using errcode = '42501', message = 'No tienes permiso para este paciente.';
  end if;
  if coalesce(p_purpose, '') not in ('ai_processing', 'whatsapp', 'marketing')
     or coalesce(p_action, '') not in ('granted', 'revoked')
     or char_length(coalesce(p_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'La decisión de privacidad no es válida.';
  end if;

  select id, action into v_last from public.smyl_patient_privacy_events
   where tenant_id = v_tenant and patient_id = p_patient_id and purpose = p_purpose order by seq desc limit 1;
  if found and v_last.action = p_action then return v_last.id; end if;

  insert into public.smyl_patient_privacy_events (tenant_id, patient_id, purpose, action, note)
  values (v_tenant, p_patient_id, p_purpose, p_action, btrim(coalesce(p_note, '')))
  returning id into v_id;

  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values (v_tenant, auth.uid(), 'insert', 'smyl_patient_privacy_events', v_id::text,
    jsonb_build_object('patient_id', p_patient_id, 'purpose', p_purpose, 'action', p_action));
  return v_id;
end;
$$;

-- Estado actual por finalidad: granted | revoked | unknown (sin registrar).
create or replace function public.smyl_patient_privacy_status(p_patient_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_result jsonb;
begin
  if v_tenant is null
     or not (public.smyl_has_permission(v_tenant, 'patients.read') or public.smyl_has_permission(v_tenant, 'patients.manage')) then
    raise exception using errcode = '42501', message = 'No tienes permiso para ver esto.';
  end if;
  if not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
    raise exception using errcode = '42501', message = 'No tienes permiso para este paciente.';
  end if;
  select jsonb_object_agg(p.purpose, jsonb_build_object(
           'state', coalesce(e.action, 'unknown'), 'at', e.created_at, 'source', e.source, 'note', coalesce(e.note, '')))
    into v_result
    from (values ('ai_processing'), ('whatsapp'), ('marketing')) as p(purpose)
    left join lateral (
      select action, created_at, source, note from public.smyl_patient_privacy_events
       where tenant_id = v_tenant and patient_id = p_patient_id and purpose = p.purpose
       order by seq desc limit 1) e on true;
  return v_result;
end;
$$;

-- Para las Edge Functions (service_role): ¿el paciente permite la finalidad? granted | revoked | unknown.
create or replace function public.smyl_patient_privacy_state(p_tenant uuid, p_patient uuid, p_purpose text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((select e.action from public.smyl_patient_privacy_events e
                    where e.tenant_id = p_tenant and e.patient_id = p_patient and e.purpose = p_purpose
                    order by e.seq desc limit 1), 'unknown');
$$;

-- ── 2) Solicitudes de derechos ARCO ─────────────────────────────────────────────────────────
-- Suma días hábiles (lunes a viernes). No conoce días festivos: el plazo legal puede ser un poco mayor.
create or replace function public.smyl_add_business_days(p_from date, p_days integer)
returns date
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_date date := p_from;
  v_count integer := 0;
begin
  if p_from is null or p_days is null or p_days < 0 or p_days > 120 then
    raise exception using errcode = '22023', message = 'Plazo no válido.';
  end if;
  while v_count < p_days loop
    v_date := v_date + 1;
    if extract(isodow from v_date) < 6 then v_count := v_count + 1; end if;
  end loop;
  return v_date;
end;
$$;

create table if not exists public.smyl_data_rights_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid,
  right_type text not null check (right_type in ('access', 'rectification', 'cancellation', 'opposition', 'revocation')),
  channel text not null default 'in_person' check (channel in ('in_person', 'email', 'whatsapp', 'phone', 'other')),
  requester_name text not null check (char_length(btrim(requester_name)) between 2 and 150),
  requester_contact text not null default '' check (char_length(requester_contact) <= 200),
  identity_verified boolean not null default false,
  details text not null default '' check (char_length(details) <= 2000),
  received_on date not null default current_date,
  due_on date not null,
  status text not null default 'received' check (status in ('received', 'in_review', 'completed', 'rejected')),
  resolution text not null default '' check (char_length(resolution) <= 2000),
  resolved_at timestamptz,
  resolved_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_on >= received_on),
  check ((status in ('completed', 'rejected') and resolved_at is not null and char_length(btrim(resolution)) >= 10)
         or status in ('received', 'in_review'))
);
create index if not exists smyl_data_rights_requests_status_idx on public.smyl_data_rights_requests (tenant_id, status, due_on);
create index if not exists smyl_data_rights_requests_patient_idx on public.smyl_data_rights_requests (tenant_id, patient_id) where patient_id is not null;

alter table public.smyl_data_rights_requests enable row level security;
drop policy if exists smyl_data_rights_requests_read on public.smyl_data_rights_requests;
create policy smyl_data_rights_requests_read on public.smyl_data_rights_requests
  for select to authenticated using (public.smyl_has_permission(tenant_id, 'patients.manage'));
revoke all on public.smyl_data_rights_requests from public, anon, authenticated;
grant select on public.smyl_data_rights_requests to authenticated;

-- Una solicitud cerrada es evidencia: no se edita.
create or replace function public.smyl_data_request_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.status in ('completed', 'rejected') then
    raise exception using errcode = '55000', message = 'Una solicitud cerrada no se puede modificar.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists smyl_data_rights_requests_guard on public.smyl_data_rights_requests;
create trigger smyl_data_rights_requests_guard before update on public.smyl_data_rights_requests
  for each row execute function public.smyl_data_request_guard();

create or replace function public.smyl_open_data_request(
  p_patient_id uuid, p_right text, p_channel text, p_requester_name text,
  p_requester_contact text default '', p_details text default '', p_received_on date default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_received date := coalesce(p_received_on, current_date);
  v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'patients.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar solicitudes de derechos.';
  end if;
  if p_patient_id is not null then
    if not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id) then
      raise exception using errcode = 'P0002', message = 'El paciente no existe.';
    end if;
    if not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
      raise exception using errcode = '42501', message = 'No tienes permiso para este paciente.';
    end if;
  end if;
  if coalesce(p_right, '') not in ('access', 'rectification', 'cancellation', 'opposition', 'revocation')
     or coalesce(p_channel, 'in_person') not in ('in_person', 'email', 'whatsapp', 'phone', 'other')
     or char_length(btrim(coalesce(p_requester_name, ''))) not between 2 and 150
     or char_length(coalesce(p_requester_contact, '')) > 200
     or char_length(coalesce(p_details, '')) > 2000 then
    raise exception using errcode = '22023', message = 'Los datos de la solicitud no son válidos.';
  end if;
  if v_received > current_date or v_received < current_date - 90 then
    raise exception using errcode = '22023', message = 'La fecha de recepción debe ser de los últimos 90 días y no futura.';
  end if;

  insert into public.smyl_data_rights_requests (tenant_id, patient_id, right_type, channel, requester_name, requester_contact, details, received_on, due_on)
  values (v_tenant, p_patient_id, p_right, coalesce(p_channel, 'in_person'), btrim(p_requester_name), btrim(coalesce(p_requester_contact, '')),
          btrim(coalesce(p_details, '')), v_received, public.smyl_add_business_days(v_received, 20))
  returning id into v_id;

  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values (v_tenant, auth.uid(), 'insert', 'smyl_data_rights_requests', v_id::text,
    jsonb_build_object('patient_id', p_patient_id, 'right_type', p_right, 'channel', coalesce(p_channel, 'in_person')));
  return v_id;
end;
$$;

-- Avanzar una solicitud: received → in_review → completed | rejected. Al completar una oposición o revocación se pueden retirar
-- finalidades en el mismo paso (queda en el historial de privacidad con el origen «data_request»).
create or replace function public.smyl_update_data_request(
  p_id uuid, p_status text, p_resolution text default '', p_identity_verified boolean default null,
  p_revoke_purposes text[] default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_data_rights_requests;
  v_purpose text;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'patients.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para atender solicitudes de derechos.';
  end if;
  select * into v_row from public.smyl_data_rights_requests where id = p_id and tenant_id = v_tenant for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'No se encontró la solicitud.';
  end if;
  if v_row.status in ('completed', 'rejected') then
    raise exception using errcode = '55000', message = 'Una solicitud cerrada no se puede modificar.';
  end if;
  if coalesce(p_status, '') not in ('in_review', 'completed', 'rejected') then
    raise exception using errcode = '22023', message = 'El estado no es válido.';
  end if;
  if p_status in ('completed', 'rejected') and char_length(btrim(coalesce(p_resolution, ''))) < 10 then
    raise exception using errcode = '22023', message = 'Escribe la resolución (al menos 10 caracteres).';
  end if;
  if char_length(coalesce(p_resolution, '')) > 2000 then
    raise exception using errcode = '22023', message = 'La resolución es demasiado larga.';
  end if;

  if p_status = 'completed' and p_revoke_purposes is not null and cardinality(p_revoke_purposes) > 0 then
    if v_row.right_type not in ('opposition', 'revocation') or v_row.patient_id is null then
      raise exception using errcode = '22023', message = 'Solo una oposición o revocación con paciente puede retirar finalidades.';
    end if;
    foreach v_purpose in array p_revoke_purposes loop
      if v_purpose not in ('ai_processing', 'whatsapp', 'marketing') then
        raise exception using errcode = '22023', message = 'La finalidad no es válida.';
      end if;
      if coalesce((select e.action from public.smyl_patient_privacy_events e
                    where e.tenant_id = v_tenant and e.patient_id = v_row.patient_id and e.purpose = v_purpose
                    order by e.seq desc limit 1), 'unknown') <> 'revoked' then
        insert into public.smyl_patient_privacy_events (tenant_id, patient_id, purpose, action, source, request_id, note)
        values (v_tenant, v_row.patient_id, v_purpose, 'revoked', 'data_request', v_row.id, 'Solicitud de derechos');
      end if;
    end loop;
  end if;

  update public.smyl_data_rights_requests
     set status = p_status,
         resolution = case when p_status in ('completed', 'rejected') then btrim(p_resolution) else resolution end,
         identity_verified = coalesce(p_identity_verified, identity_verified),
         resolved_at = case when p_status in ('completed', 'rejected') then now() else null end,
         resolved_by = case when p_status in ('completed', 'rejected') then auth.uid() else null end
   where id = p_id;

  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values (v_tenant, auth.uid(), 'update', 'smyl_data_rights_requests', p_id::text,
    jsonb_build_object('status', p_status, 'right_type', v_row.right_type));
end;
$$;

-- ── 3) Derecho de acceso: copia de los datos del paciente ────────────────────────────────────
-- Solo incluye las secciones que el rol puede ver. La historia clínica, las fotos y los documentos NO van en este archivo: se
-- entregan desde el expediente clínico con la revisión del dentista responsable (se indica en `excluded`).
create or replace function public.smyl_export_patient_data(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_out jsonb;
  v_sections text[] := array['ficha'];
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'patients.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para exportar datos de pacientes.';
  end if;
  if not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id) then
    raise exception using errcode = 'P0002', message = 'El paciente no existe.';
  end if;
  if not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
    raise exception using errcode = '42501', message = 'No tienes permiso para este paciente.';
  end if;

  v_out := jsonb_build_object(
    'generated_at', now(),
    'patient', (select to_jsonb(p) - 'tenant_id' from public.camila_pacientes p where p.tenant_id = v_tenant and p.id = p_patient_id));

  if public.smyl_has_permission(v_tenant, 'schedule.read') then
    v_sections := array_append(v_sections, 'citas');
    v_out := v_out || jsonb_build_object('appointments', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status,
                                          'service', s.name, 'professional', pr.display_name) order by a.starts_at desc)
        from public.smyl_appointments a
        left join public.smyl_services s on s.tenant_id = a.tenant_id and s.id = a.service_id
        left join public.smyl_professionals pr on pr.tenant_id = a.tenant_id and pr.id = a.professional_id
       where a.tenant_id = v_tenant and a.patient_id = p_patient_id), '[]'::jsonb));
  end if;

  if public.smyl_has_permission(v_tenant, 'finance.read') then
    v_sections := array_append(v_sections, 'cobros');
    v_out := v_out || jsonb_build_object(
      'charges', coalesce((select jsonb_agg(jsonb_build_object('concept', c.concept, 'quantity', c.quantity, 'total_amount', c.total_amount,
                                                                'status', c.status, 'created_at', c.created_at) order by c.created_at desc)
                             from public.smyl_finance_charges c where c.tenant_id = v_tenant and c.patient_id = p_patient_id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(jsonb_build_object('amount', y.amount, 'method', y.method, 'paid_at', y.paid_at) order by y.paid_at desc)
                              from public.smyl_finance_payments y where y.tenant_id = v_tenant and y.patient_id = p_patient_id), '[]'::jsonb),
      'fiscal_profile', (select jsonb_build_object('legal_name', f.legal_name, 'rfc', f.rfc, 'fiscal_regime', f.fiscal_regime,
                                                   'tax_postal_code', f.tax_postal_code, 'cfdi_use', f.cfdi_use, 'email', f.email)
                           from public.smyl_patient_fiscal_profiles f where f.tenant_id = v_tenant and f.patient_id = p_patient_id));
  end if;

  v_sections := array_append(v_sections, 'privacidad');
  v_out := v_out || jsonb_build_object(
    'privacy_notices', coalesce((select jsonb_agg(jsonb_build_object('signed_at', k.signed_at, 'notice_version', k.notice_version,
                                                                     'provisional', k.provisional, 'signer_name', k.signer_name,
                                                                     'signer_relation', k.signer_relation) order by k.signed_at desc)
                                   from public.smyl_patient_consents k where k.tenant_id = v_tenant and k.patient_id = p_patient_id), '[]'::jsonb),
    'privacy_choices', coalesce((select jsonb_agg(jsonb_build_object('purpose', e.purpose, 'action', e.action, 'source', e.source, 'at', e.created_at) order by e.seq)
                                   from public.smyl_patient_privacy_events e where e.tenant_id = v_tenant and e.patient_id = p_patient_id), '[]'::jsonb),
    'data_requests', coalesce((select jsonb_agg(jsonb_build_object('right_type', r.right_type, 'received_on', r.received_on, 'due_on', r.due_on,
                                                                   'status', r.status, 'resolution', r.resolution) order by r.received_on)
                                 from public.smyl_data_rights_requests r where r.tenant_id = v_tenant and r.patient_id = p_patient_id), '[]'::jsonb));

  v_out := v_out || jsonb_build_object(
    'included', to_jsonb(v_sections),
    'excluded', jsonb_build_array('Historia clínica y notas', 'Fotografías, radiografías y documentos'),
    'excluded_note', 'Estos datos se entregan desde el expediente clínico, con la revisión del dentista responsable.');

  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values (v_tenant, auth.uid(), 'insert', 'smyl_privacy_export', p_patient_id::text, jsonb_build_object('sections', to_jsonb(v_sections)));
  return v_out;
end;
$$;

revoke all on function public.smyl_privacy_rows_immutable() from public, anon, authenticated;
revoke all on function public.smyl_data_request_guard() from public, anon, authenticated;
revoke all on function public.smyl_add_business_days(date, integer) from public, anon;
revoke all on function public.smyl_set_patient_privacy_choice(uuid, text, text, text) from public, anon;
revoke all on function public.smyl_patient_privacy_status(uuid) from public, anon;
revoke all on function public.smyl_patient_privacy_state(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.smyl_open_data_request(uuid, text, text, text, text, text, date) from public, anon;
revoke all on function public.smyl_update_data_request(uuid, text, text, boolean, text[]) from public, anon;
revoke all on function public.smyl_export_patient_data(uuid) from public, anon;
grant execute on function public.smyl_add_business_days(date, integer) to authenticated;
grant execute on function public.smyl_set_patient_privacy_choice(uuid, text, text, text) to authenticated;
grant execute on function public.smyl_patient_privacy_status(uuid) to authenticated;
grant execute on function public.smyl_patient_privacy_state(uuid, uuid, text) to service_role;
grant execute on function public.smyl_open_data_request(uuid, text, text, text, text, text, date) to authenticated;
grant execute on function public.smyl_update_data_request(uuid, text, text, boolean, text[]) to authenticated;
grant execute on function public.smyl_export_patient_data(uuid) to authenticated;

commit;
