-- Firma del aviso de privacidad desde el celular del propio paciente (enlace de un solo uso).
-- Mismo patrón que el registro por enlace: token aleatorio de 256 bits (en la base solo su hash SHA-256), vence a las 48 h,
-- sirve una vez y solo puede firmar por la ficha a la que está ligado. La página pública llama a estas funciones con la clave
-- publicable; no lee nada de la clínica ni de otros pacientes. Además del aviso, el paciente elige por separado IA, WhatsApp y
-- marketing, y cada decisión queda en smyl_patient_privacy_events (origen 'patient_link').
-- Solo agrega: una tabla, una columna, dos valores permitidos en checks existentes y tres funciones.

begin;

create table if not exists public.smyl_consent_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  patient_id uuid not null,
  token_hash text not null unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id) on delete cascade
);
create index if not exists smyl_consent_links_patient_idx on public.smyl_consent_links (tenant_id, patient_id, created_at desc);
alter table public.smyl_consent_links enable row level security;
revoke all on public.smyl_consent_links from public, anon, authenticated;

-- Dónde se firmó y desde qué dispositivo (evidencia). Las firmas anteriores quedan en blanco.
alter table public.smyl_patient_consents add column if not exists client_info text check (client_info is null or char_length(client_info) <= 300);

do $$ begin
  alter table public.smyl_patient_consents drop constraint if exists smyl_patient_consents_method_check;
  alter table public.smyl_patient_consents add constraint smyl_patient_consents_method_check check (method in ('on_screen', 'remote_link'));
  alter table public.smyl_patient_privacy_events drop constraint if exists smyl_patient_privacy_events_source_check;
  alter table public.smyl_patient_privacy_events add constraint smyl_patient_privacy_events_source_check check (source in ('staff', 'data_request', 'patient_link'));
end $$;

-- Personal: crea el enlace (invalida los anteriores sin usar). Devuelve el token una sola vez.
create or replace function public.smyl_create_consent_link(p_patient_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_token text;
begin
  if v_tenant is null
     or not (public.smyl_has_permission(v_tenant, 'patients.manage') or public.smyl_has_permission(v_tenant, 'clinical.write')) then
    raise exception using errcode = '42501', message = 'No tienes permiso para enviar avisos a firmar.';
  end if;
  if not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id) then
    raise exception using errcode = 'P0002', message = 'El paciente no existe.';
  end if;
  if not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
    raise exception using errcode = '42501', message = 'No tienes permiso para este paciente.';
  end if;
  update public.smyl_consent_links set expires_at = now()
   where tenant_id = v_tenant and patient_id = p_patient_id and used_at is null and expires_at > now();
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.smyl_consent_links (tenant_id, patient_id, token_hash, expires_at)
  values (v_tenant, p_patient_id, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), now() + interval '48 hours');
  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values (v_tenant, auth.uid(), 'insert', 'smyl_consent_links', p_patient_id::text, jsonb_build_object('patient_id', p_patient_id, 'expires_in_hours', 48));
  return v_token;
end;
$$;

-- Página pública: ¿el enlace sirve? Solo revela el nombre de la clínica.
create or replace function public.smyl_consent_link_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_clinic text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('available', false); end if;
  select coalesce(nullif(btrim(t.nombre), ''), 'la clínica') into v_clinic
    from public.smyl_consent_links l
    left join public.camila_tenants t on t.id = l.tenant_id
   where l.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex') and l.used_at is null and l.expires_at > now();
  if not found then return jsonb_build_object('available', false); end if;
  return jsonb_build_object('available', true, 'clinic_name', v_clinic);
end;
$$;

-- Página pública: el paciente firma y decide. Un solo uso; solo escribe en la ficha ligada al enlace.
create or replace function public.smyl_consent_link_sign(
  p_token text, p_notice_version text, p_notice_text text, p_provisional boolean,
  p_signer_name text, p_signer_relation text, p_signature_png text,
  p_ai boolean, p_whatsapp boolean, p_marketing boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_link public.smyl_consent_links%rowtype;
  v_name text := btrim(coalesce(p_signer_name, ''));
  v_hash text;
  v_info text;
  v_last text;
  v_purpose text;
  v_want boolean;
  v_id uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception using errcode = '22023', message = 'Enlace no disponible.'; end if;
  if char_length(btrim(coalesce(p_notice_version, ''))) not between 1 and 80
     or char_length(coalesce(p_notice_text, '')) not between 50 and 8000
     or char_length(v_name) not between 1 and 150
     or coalesce(p_signer_relation, '') not in ('patient', 'guardian')
     or p_provisional is null or p_ai is null or p_whatsapp is null or p_marketing is null then
    raise exception using errcode = '22023', message = 'Revisa los datos de la firma.';
  end if;
  if coalesce(p_signature_png, '') !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$'
     or char_length(p_signature_png) not between 300 and 120000 then
    raise exception using errcode = '22023', message = 'La firma no es válida. Vuelve a firmar.';
  end if;

  select * into v_link from public.smyl_consent_links
   where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex') and used_at is null and expires_at > now()
   for update;
  if not found then raise exception using errcode = '22023', message = 'Enlace no disponible.'; end if;

  begin v_info := left(coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), 300);
  exception when others then v_info := null; end;

  v_hash := encode(sha256(convert_to(p_notice_text, 'utf8')), 'hex');
  insert into public.smyl_patient_consents (tenant_id, patient_id, notice_version, notice_text, notice_sha256, provisional, signer_name, signer_relation, signature_png, method, client_info)
  values (v_link.tenant_id, v_link.patient_id, btrim(p_notice_version), p_notice_text, v_hash, p_provisional, v_name, p_signer_relation, p_signature_png, 'remote_link', nullif(v_info, ''))
  on conflict (patient_id, kind, notice_sha256) do nothing
  returning id into v_id;

  foreach v_purpose in array array['ai_processing', 'whatsapp', 'marketing'] loop
    v_want := case v_purpose when 'ai_processing' then p_ai when 'whatsapp' then p_whatsapp else p_marketing end;
    select action into v_last from public.smyl_patient_privacy_events
     where tenant_id = v_link.tenant_id and patient_id = v_link.patient_id and purpose = v_purpose order by seq desc limit 1;
    if v_last is distinct from (case when v_want then 'granted' else 'revoked' end) then
      insert into public.smyl_patient_privacy_events (tenant_id, patient_id, purpose, action, source, note)
      values (v_link.tenant_id, v_link.patient_id, v_purpose, case when v_want then 'granted' else 'revoked' end, 'patient_link', 'Elegido por el paciente al firmar el aviso.');
    end if;
  end loop;

  update public.smyl_consent_links set used_at = now() where id = v_link.id;
  insert into public.smyl_audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values (v_link.tenant_id, null, 'insert', 'smyl_patient_consents', coalesce(v_id::text, ''),
    jsonb_build_object('patient_id', v_link.patient_id, 'notice_version', btrim(p_notice_version), 'notice_sha256', v_hash, 'method', 'remote_link',
      'ai', p_ai, 'whatsapp', p_whatsapp, 'marketing', p_marketing));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.smyl_create_consent_link(uuid) from public, anon;
grant execute on function public.smyl_create_consent_link(uuid) to authenticated;
revoke all on function public.smyl_consent_link_info(text) from public;
grant execute on function public.smyl_consent_link_info(text) to anon, authenticated;
revoke all on function public.smyl_consent_link_sign(text, text, text, boolean, text, text, text, boolean, boolean, boolean) from public;
grant execute on function public.smyl_consent_link_sign(text, text, text, boolean, text, text, text, boolean, boolean, boolean) to anon, authenticated;

commit;
