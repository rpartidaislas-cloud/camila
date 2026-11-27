-- Firma presencial de consentimientos informados: QR del paciente o dispositivo de la clínica.
--
-- El QR no firma el consentimiento por sí solo. Congela el documento exacto y únicamente
-- deposita la aceptación y la rúbrica del paciente. El profesional autenticado verifica
-- presencialmente al firmante, revisa la captura y cierra el documento en una transacción.
-- Los tokens son bearer de 256 bits, se guardan sólo como SHA-256, duran cinco minutos y
-- se purgan después de una breve gracia para completar el cierre profesional.

begin;

-- Esta migración es autosuficiente. Producción puede recibir el flujo de
-- consentimientos antes que la firma de notas clínicas, por lo que instalamos
-- aquí el mismo validador estricto de PNG que comparten ambos módulos.
create or replace function public.smyl_valid_signature_png(p_signature text)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog, public
as $$
declare
  v_bytes bytea;
  v_width bigint;
  v_height bigint;
begin
  if p_signature !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$'
     or char_length(p_signature) not between 300 and 120000 then
    return false;
  end if;

  v_bytes := decode(split_part(p_signature, ',', 2), 'base64');
  if octet_length(v_bytes) not between 200 and 90000
     or substring(v_bytes from 1 for 8) <> decode('89504e470d0a1a0a', 'hex')
     or substring(v_bytes from 13 for 4) <> convert_to('IHDR', 'UTF8') then
    return false;
  end if;

  v_width := get_byte(v_bytes, 16)::bigint * 16777216
    + get_byte(v_bytes, 17)::bigint * 65536
    + get_byte(v_bytes, 18)::bigint * 256
    + get_byte(v_bytes, 19)::bigint;
  v_height := get_byte(v_bytes, 20)::bigint * 16777216
    + get_byte(v_bytes, 21)::bigint * 65536
    + get_byte(v_bytes, 22)::bigint * 256
    + get_byte(v_bytes, 23)::bigint;

  return v_width = 600 and v_height = 200;
exception when others then
  return false;
end;
$$;

revoke all on function public.smyl_valid_signature_png(text)
  from public, anon, authenticated;

-- El texto de aceptación se versiona en servidor. Así una copia de frontend no
-- puede cambiar silenciosamente lo que significa `patient-consent-v1`.
create or replace function public.smyl_informed_consent_acceptance_text(p_version text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, public
as $$
  select case p_version
    when 'patient-consent-v1' then
      'Leí o recibí la lectura de este documento, pude hacer preguntas y autorizo libremente el procedimiento descrito.'
    when 'legacy-consent-v0' then
      'Registro histórico anterior a la captura versionada de aceptación.'
  end;
$$;

-- La tabla existente ya es inmutable. Suspendemos el trigger dentro de esta
-- misma transacción para completar exclusivamente el backfill de metadatos;
-- al final se reinstala una versión más estricta antes del commit.
drop trigger if exists smyl_informed_consents_immutable
  on public.smyl_informed_consents;

alter table public.smyl_informed_consents
  add column if not exists revoked_auth_method text,
  add column if not exists signature_sha256 text,
  add column if not exists signature_capture_method text,
  add column if not exists identity_verified_by uuid,
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_verification_method text,
  add column if not exists capture_link_id uuid,
  add column if not exists capture_reference text,
  add column if not exists capture_token_sha256 text,
  add column if not exists patient_accepted_at timestamptz,
  add column if not exists signature_captured_at timestamptz,
  add column if not exists capture_client_info text,
  add column if not exists acceptance_version text,
  add column if not exists acceptance_text text,
  add column if not exists evidence_sha256 text,
  add column if not exists idempotency_key uuid;

update public.smyl_informed_consents
   set signature_sha256 = coalesce(signature_sha256,
         encode(sha256(convert_to(signature_png, 'UTF8')), 'hex')),
       signature_capture_method = coalesce(signature_capture_method, 'clinic_device'),
       identity_verified_by = coalesce(identity_verified_by, captured_by),
       identity_verified_at = coalesce(identity_verified_at, signed_at),
       identity_verification_method = coalesce(identity_verification_method, 'legacy_in_person'),
       capture_reference = coalesce(capture_reference,
         upper(left(replace(id::text, '-', ''), 8))),
       patient_accepted_at = coalesce(patient_accepted_at, signed_at),
       signature_captured_at = coalesce(signature_captured_at, signed_at),
       acceptance_version = coalesce(acceptance_version, 'legacy-consent-v0'),
       acceptance_text = coalesce(acceptance_text,
         public.smyl_informed_consent_acceptance_text(
           coalesce(acceptance_version, 'legacy-consent-v0')
         )),
       idempotency_key = coalesce(idempotency_key, id),
       evidence_sha256 = coalesce(evidence_sha256,
         encode(sha256(convert_to(jsonb_build_object(
           'schema', 'smyl-consent-evidence-v1',
           'consent_id', id,
           'tenant_id', tenant_id,
           'patient_id', patient_id,
           'template_key', template_key,
           'procedure_title', procedure_title,
           'document_sha256', document_sha256,
           'signer_name', signer_name,
           'signer_relation', signer_relation,
           'signature_sha256', encode(sha256(convert_to(signature_png, 'UTF8')), 'hex'),
           'professional_id', professional_id,
           'professional_name', professional_name,
           'professional_license', professional_license,
           'professional_auth_method', professional_auth_method,
           'signed_at', signed_at,
           'capture_method', 'clinic_device',
           'capture_reference', upper(left(replace(id::text, '-', ''), 8)),
           'identity_verified_by', captured_by,
           'identity_verified_at', signed_at,
           'identity_verification_method', 'legacy_in_person',
           'patient_accepted_at', signed_at,
           'signature_captured_at', signed_at,
           'acceptance_version', 'legacy-consent-v0',
           'acceptance_text', public.smyl_informed_consent_acceptance_text('legacy-consent-v0')
         )::text, 'UTF8')), 'hex'));

alter table public.smyl_informed_consents
  alter column signature_sha256 set not null,
  alter column signature_capture_method set not null,
  alter column identity_verified_by set not null,
  alter column identity_verified_at set not null,
  alter column identity_verification_method set not null,
  alter column capture_reference set not null,
  alter column patient_accepted_at set not null,
  alter column signature_captured_at set not null,
  alter column acceptance_version set not null,
  alter column acceptance_text set not null,
  alter column evidence_sha256 set not null,
  alter column idempotency_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_revoked_auth_method_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_revoked_auth_method_check
      check (revoked_auth_method is null
        or char_length(btrim(revoked_auth_method)) between 2 and 80);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_signature_sha256_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_signature_sha256_check
      check (signature_sha256 ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_capture_method_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_capture_method_check
      check (signature_capture_method in ('clinic_device', 'clinic_qr'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_identity_method_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_identity_method_check
      check (identity_verification_method in ('in_person', 'legacy_in_person'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_capture_reference_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_capture_reference_check
      check (capture_reference ~ '^[A-F0-9]{8}$');
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_capture_token_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_capture_token_check
      check (capture_token_sha256 is null or capture_token_sha256 ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_capture_client_info_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_capture_client_info_check
      check (capture_client_info is null or char_length(capture_client_info) <= 300);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_acceptance_version_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_acceptance_version_check
      check (
        acceptance_version in ('legacy-consent-v0', 'patient-consent-v1')
        and acceptance_text = public.smyl_informed_consent_acceptance_text(acceptance_version)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_evidence_sha256_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_evidence_sha256_check
      check (evidence_sha256 ~ '^[a-f0-9]{64}$');
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_capture_chain_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_capture_chain_check
      check (
        (signature_capture_method = 'clinic_qr'
          and capture_link_id is not null and capture_token_sha256 is not null)
        or
        (signature_capture_method = 'clinic_device'
          and capture_link_id is null and capture_token_sha256 is null)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.smyl_informed_consents'::regclass
       and conname = 'smyl_informed_consents_signature_png_strict_check'
  ) then
    alter table public.smyl_informed_consents
      add constraint smyl_informed_consents_signature_png_strict_check
      check (
        identity_verification_method = 'legacy_in_person'
        or public.smyl_valid_signature_png(signature_png)
      ) not valid;
  end if;
end;
$$;

create unique index if not exists smyl_informed_consents_idempotency_idx
  on public.smyl_informed_consents (tenant_id, idempotency_key);

alter table public.smyl_informed_consents enable row level security;
revoke all on public.smyl_informed_consents from public, anon, authenticated;

create table if not exists public.smyl_informed_consent_signature_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  professional_id uuid not null,
  template_key text not null check (template_key ~ '^[a-z0-9_]{1,40}$'),
  procedure_title text not null check (char_length(btrim(procedure_title)) between 3 and 160),
  document_text text not null check (char_length(document_text) between 200 and 20000),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  signer_name text not null check (char_length(btrim(signer_name)) between 2 and 150),
  signer_relation text not null check (signer_relation in ('patient', 'guardian')),
  reference text not null check (reference ~ '^[A-F0-9]{8}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  acceptance_version text not null default 'patient-consent-v1'
    check (acceptance_version = 'patient-consent-v1'),
  acceptance_text text not null
    default public.smyl_informed_consent_acceptance_text('patient-consent-v1')
    check (acceptance_text = public.smyl_informed_consent_acceptance_text(acceptance_version)),
  accepted_at timestamptz,
  signature_png text check (signature_png is null or public.smyl_valid_signature_png(signature_png)),
  signature_sha256 text check (signature_sha256 is null or signature_sha256 ~ '^[a-f0-9]{64}$'),
  capture_token_sha256 text check (capture_token_sha256 is null or capture_token_sha256 ~ '^[a-f0-9]{64}$'),
  client_info text check (client_info is null or char_length(client_info) <= 300),
  submitted_at timestamptz,
  used_at timestamptz,
  cancelled_at timestamptz,
  unique (tenant_id, reference),
  foreign key (tenant_id, patient_id)
    references public.camila_pacientes(tenant_id, id),
  foreign key (tenant_id, professional_id)
    references public.smyl_professionals(tenant_id, id),
  check (
    (signature_png is null and signature_sha256 is null
      and capture_token_sha256 is null and accepted_at is null and submitted_at is null)
    or
    (signature_png is not null and signature_sha256 is not null
      and capture_token_sha256 is not null and accepted_at is not null and submitted_at is not null)
  ),
  check (used_at is null or submitted_at is not null),
  check (cancelled_at is null or used_at is null)
);

comment on table public.smyl_informed_consent_signature_links is
  'Sesiones efímeras de firma presencial del paciente; la captura no crea el consentimiento definitivo.';

create index if not exists smyl_informed_consent_signature_links_patient_idx
  on public.smyl_informed_consent_signature_links (tenant_id, patient_id, created_at desc);

alter table public.smyl_informed_consent_signature_links enable row level security;
revoke all on table public.smyl_informed_consent_signature_links from public, anon, authenticated;

create or replace function public.smyl_create_informed_consent_signature_link(
  p_patient_id uuid,
  p_template_key text,
  p_procedure_title text,
  p_document_text text,
  p_signer_name text,
  p_signer_relation text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_pro public.smyl_professionals;
  v_plaintext_token text;
  v_token_hash text;
  v_document_hash text;
  v_expires_at timestamptz := clock_timestamp() + interval '5 minutes';
  v_link public.smyl_informed_consent_signature_links;
  v_reference text;
begin
  if v_tenant is null or auth.uid() is null
     or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para recabar consentimientos.';
  end if;
  if not exists (
      select 1 from public.camila_pacientes
       where tenant_id = v_tenant and id = p_patient_id
    ) or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  select * into v_pro
    from public.smyl_professionals p
   where p.tenant_id = v_tenant and p.user_id = auth.uid() and p.active
   limit 1;
  if not found or char_length(btrim(coalesce(v_pro.license_number, ''))) < 4 then
    raise exception using errcode = '42501', message = 'Solo un profesional activo con cédula puede recabar el consentimiento.';
  end if;
  if public.smyl_recent_auth_method(600) is null then
    raise exception using errcode = '28000', message = 'Confirma tu identidad antes de generar el código.', hint = 'reauth_required';
  end if;
  if coalesce(p_template_key, '') !~ '^[a-z0-9_]{1,40}$'
     or char_length(btrim(coalesce(p_procedure_title, ''))) not between 3 and 160
     or char_length(coalesce(p_document_text, '')) not between 200 and 20000
     or char_length(btrim(coalesce(p_signer_name, ''))) not between 2 and 150
     or coalesce(p_signer_relation, '') not in ('patient', 'guardian') then
    raise exception using errcode = '22023', message = 'Revisa los datos del consentimiento.';
  end if;

  v_document_hash := encode(sha256(convert_to(p_document_text, 'UTF8')), 'hex');

  -- Un solo enlace activo por paciente/profesional, incluso con doble clic o
  -- pestañas concurrentes. El candado no contiene datos clínicos reversibles.
  perform pg_advisory_xact_lock(hashtextextended(
    v_tenant::text || ':' || p_patient_id::text || ':' || v_pro.id::text || ':consent-link',
    0
  ));

  v_plaintext_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(sha256(convert_to(v_plaintext_token, 'UTF8')), 'hex');

  -- Recupera una captura reciente que aún no se incorporó al expediente. El reto
  -- original queda conservado en capture_token_sha256 aunque el token de acceso rote.
  select * into v_link
    from public.smyl_informed_consent_signature_links l
   where l.tenant_id = v_tenant and l.patient_id = p_patient_id
     and l.professional_id = v_pro.id and l.created_by = auth.uid()
     and l.document_sha256 = v_document_hash
     and l.template_key = p_template_key
     and l.procedure_title = btrim(p_procedure_title)
     and l.signer_name = btrim(p_signer_name)
     and l.signer_relation = p_signer_relation
     and l.submitted_at is not null and l.submitted_at <= l.expires_at
     and l.submitted_at > clock_timestamp() - interval '10 minutes'
     and l.used_at is null and l.cancelled_at is null
   order by l.submitted_at desc
   limit 1
   for update;
  if found then
    update public.smyl_informed_consent_signature_links
       set token_hash = v_token_hash, expires_at = v_expires_at
     where id = v_link.id
    returning * into v_link;
    insert into public.smyl_audit_events (
      tenant_id, actor_id, action, entity_type, entity_id, after_data
    ) values (
      v_tenant, auth.uid(), 'update', 'smyl_informed_consent_signature_links', v_link.id::text,
      jsonb_build_object(
        'patient_id', p_patient_id,
        'document_sha256', v_document_hash,
        'reference', v_link.reference,
        'signature_ready', true,
        'access_rotated_at', clock_timestamp(),
        'expires_at', v_expires_at
      )
    );
    return jsonb_build_object(
      'token', v_plaintext_token,
      'expires_at', v_expires_at,
      'reference', v_link.reference,
      'signature_ready', true,
      'recovered', true
    );
  end if;

  with cancelled as (
    update public.smyl_informed_consent_signature_links
       set cancelled_at = clock_timestamp()
     where tenant_id = v_tenant and patient_id = p_patient_id
       and professional_id = v_pro.id and created_by = auth.uid()
       and used_at is null and cancelled_at is null
    returning id, patient_id, document_sha256, reference, submitted_at, cancelled_at
  )
  insert into public.smyl_audit_events (
    tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data
  )
  select v_tenant, auth.uid(), 'update', 'smyl_informed_consent_signature_links', c.id::text,
         jsonb_build_object(
           'patient_id', c.patient_id,
           'document_sha256', c.document_sha256,
           'reference', c.reference,
           'signature_received', c.submitted_at is not null
         ),
         jsonb_build_object('cancelled_at', c.cancelled_at, 'reason', 'replaced')
    from cancelled c;

  loop
    v_reference := upper(left(encode(gen_random_bytes(8), 'hex'), 8));
    exit when not exists (
      select 1 from public.smyl_informed_consent_signature_links
       where tenant_id = v_tenant and reference = v_reference
    );
  end loop;

  insert into public.smyl_informed_consent_signature_links (
    tenant_id, patient_id, professional_id, template_key, procedure_title,
    document_text, document_sha256, signer_name, signer_relation, reference,
    token_hash, created_by, expires_at
  ) values (
    v_tenant, p_patient_id, v_pro.id, p_template_key, btrim(p_procedure_title),
    p_document_text, v_document_hash, btrim(p_signer_name), p_signer_relation,
    v_reference, v_token_hash, auth.uid(), v_expires_at
  ) returning * into v_link;

  insert into public.smyl_audit_events (
    tenant_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_tenant, auth.uid(), 'insert', 'smyl_informed_consent_signature_links', v_link.id::text,
    jsonb_build_object(
      'patient_id', p_patient_id,
      'professional_id', v_pro.id,
      'document_sha256', v_document_hash,
      'reference', v_reference,
      'expires_in_seconds', 300
    )
  );

  return jsonb_build_object(
    'token', v_plaintext_token,
    'expires_at', v_expires_at,
    'reference', v_reference,
    'signature_ready', false,
    'recovered', false
  );
end;
$$;

create or replace function public.smyl_informed_consent_signature_link_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('available', false);
  end if;

  select jsonb_build_object(
      'available', true,
      'clinic_name', coalesce(nullif(btrim(t.nombre), ''), 'la clínica'),
      'procedure_title', l.procedure_title,
      'document_text', l.document_text,
      'document_sha256', l.document_sha256,
      'signer_name', l.signer_name,
      'signer_relation', l.signer_relation,
      'reference', l.reference,
      'acceptance_version', l.acceptance_version,
      'acceptance_text', l.acceptance_text,
      'expires_at', l.expires_at
    ) into v_result
    from public.smyl_informed_consent_signature_links l
    join public.camila_tenants t on t.id = l.tenant_id
   where l.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and l.submitted_at is null and l.used_at is null and l.cancelled_at is null
     and l.expires_at > clock_timestamp();

  return coalesce(v_result, jsonb_build_object('available', false));
end;
$$;

create or replace function public.smyl_submit_informed_consent_signature(
  p_token text,
  p_signature_png text,
  p_accepted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_link public.smyl_informed_consent_signature_links;
  v_now timestamptz := clock_timestamp();
  v_client_info text;
  v_signature_hash text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Enlace no disponible.';
  end if;

  select * into v_link
    from public.smyl_informed_consent_signature_links
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and submitted_at is null and used_at is null and cancelled_at is null
   for update;
  if not found or v_link.expires_at <= v_now then
    raise exception using errcode = '22023', message = 'El enlace venció o ya fue utilizado.';
  end if;
  if p_accepted is distinct from true then
    raise exception using errcode = '22023', message = 'Confirma que leíste y aceptas el documento.';
  end if;
  if not public.smyl_valid_signature_png(coalesce(p_signature_png, '')) then
    raise exception using errcode = '22023', message = 'La firma no es válida. Vuelve a firmar.';
  end if;

  begin
    v_client_info := left(coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), 300);
  exception when others then
    v_client_info := null;
  end;
  v_signature_hash := encode(sha256(convert_to(p_signature_png, 'UTF8')), 'hex');

  update public.smyl_informed_consent_signature_links
     set signature_png = p_signature_png,
         signature_sha256 = v_signature_hash,
         capture_token_sha256 = v_link.token_hash,
         client_info = nullif(v_client_info, ''),
         accepted_at = v_now,
         submitted_at = v_now
   where id = v_link.id;

  insert into public.smyl_audit_events (
    tenant_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_link.tenant_id, null, 'update', 'smyl_informed_consent_signature_links', v_link.id::text,
    jsonb_build_object(
      'patient_id', v_link.patient_id,
      'document_sha256', v_link.document_sha256,
      'signature_sha256', v_signature_hash,
      'reference', v_link.reference,
      'accepted_at', v_now
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reference', v_link.reference,
    'submitted_at', v_now,
    'message', 'Firma recibida. Vuelve a la computadora de la clínica.'
  );
end;
$$;

create or replace function public.smyl_informed_consent_signature_link_status(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_link public.smyl_informed_consent_signature_links;
begin
  if v_tenant is null or auth.uid() is null
     or p_token is null or p_token !~ '^[0-9a-f]{64}$'
     or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    return jsonb_build_object('available', false);
  end if;

  select l.* into v_link
    from public.smyl_informed_consent_signature_links l
    join public.smyl_professionals p
      on p.tenant_id = l.tenant_id and p.id = l.professional_id
     and p.user_id = auth.uid() and p.active
   where l.tenant_id = v_tenant and l.created_by = auth.uid()
     and l.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and l.used_at is null and l.cancelled_at is null
     and public.smyl_can_access_patient(v_tenant, l.patient_id, 'clinical')
     and (
       l.expires_at > clock_timestamp()
       or (l.submitted_at is not null and l.submitted_at <= l.expires_at
         and l.submitted_at > clock_timestamp() - interval '10 minutes')
     );
  if not found then
    return jsonb_build_object('available', false);
  end if;

  return jsonb_build_object(
    'available', true,
    'signature_ready', v_link.submitted_at is not null,
    'signature_png', case when v_link.submitted_at is not null then v_link.signature_png else null end,
    'signature_sha256', v_link.signature_sha256,
    'accepted_at', v_link.accepted_at,
    'submitted_at', v_link.submitted_at,
    'expires_at', v_link.expires_at,
    'reference', v_link.reference,
    'patient_id', v_link.patient_id,
    'document_sha256', v_link.document_sha256
  );
end;
$$;

create or replace function public.smyl_cancel_informed_consent_signature_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_link public.smyl_informed_consent_signature_links;
begin
  if v_tenant is null or auth.uid() is null
     or p_token is null or p_token !~ '^[0-9a-f]{64}$'
     or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    return jsonb_build_object('cancelled', false);
  end if;

  select l.* into v_link
    from public.smyl_informed_consent_signature_links l
    join public.smyl_professionals p
      on p.tenant_id = l.tenant_id and p.id = l.professional_id
     and p.user_id = auth.uid() and p.active
   where l.tenant_id = v_tenant and l.created_by = auth.uid()
     and l.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and l.used_at is null and l.cancelled_at is null
     and public.smyl_can_access_patient(v_tenant, l.patient_id, 'clinical')
   for update;
  if not found then
    return jsonb_build_object('cancelled', false);
  end if;

  insert into public.smyl_audit_events (
    tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    v_tenant, auth.uid(), 'update', 'smyl_informed_consent_signature_links', v_link.id::text,
    jsonb_build_object('reference', v_link.reference, 'signature_received', v_link.submitted_at is not null),
    jsonb_build_object('cancelled_at', clock_timestamp())
  );

  delete from public.smyl_informed_consent_signature_links where id = v_link.id;
  return jsonb_build_object('cancelled', true);
end;
$$;

-- Cierre único para QR y firma en el dispositivo de la clínica.
create or replace function public.smyl_finalize_informed_consent_signature(
  p_patient_id uuid,
  p_template_key text,
  p_procedure_title text,
  p_document_text text,
  p_signer_name text,
  p_signer_relation text,
  p_signature_png text,
  p_link_token text,
  p_idempotency_key uuid,
  p_identity_verified boolean,
  p_patient_accepted boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_pro public.smyl_professionals;
  v_link public.smyl_informed_consent_signature_links;
  v_existing public.smyl_informed_consents;
  v_id uuid := gen_random_uuid();
  v_document_hash text;
  v_signature text;
  v_signature_hash text;
  v_capture_method text;
  v_reference text;
  v_capture_link_id uuid;
  v_capture_token_hash text;
  v_capture_client_info text;
  v_accepted_at timestamptz;
  v_captured_at timestamptz;
  v_acceptance_version text := 'patient-consent-v1';
  v_acceptance_text text := public.smyl_informed_consent_acceptance_text('patient-consent-v1');
  v_signed_at timestamptz := clock_timestamp();
  v_auth_method text;
  v_evidence_hash text;
begin
  if v_tenant is null or auth.uid() is null
     or not public.smyl_has_permission(v_tenant, 'clinical.write') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar consentimientos informados.';
  end if;
  if p_identity_verified is distinct from true then
    raise exception using errcode = '22023', message = 'Confirma que verificaste presencialmente al firmante.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Falta la llave de seguridad del registro.';
  end if;
  if not exists (
      select 1 from public.camila_pacientes
       where tenant_id = v_tenant and id = p_patient_id
    ) or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  select * into v_pro
    from public.smyl_professionals p
   where p.tenant_id = v_tenant and p.user_id = auth.uid() and p.active
   limit 1;
  if not found or char_length(btrim(coalesce(v_pro.license_number, ''))) < 4 then
    raise exception using errcode = '42501', message = 'Solo un profesional activo con cédula puede cerrar el consentimiento.';
  end if;
  v_auth_method := public.smyl_recent_auth_method(600);
  if v_auth_method is null then
    raise exception using errcode = '28000', message = 'Confirma tu identidad para guardar el consentimiento.', hint = 'reauth_required';
  end if;
  if coalesce(p_template_key, '') !~ '^[a-z0-9_]{1,40}$'
     or char_length(btrim(coalesce(p_procedure_title, ''))) not between 3 and 160
     or char_length(coalesce(p_document_text, '')) not between 200 and 20000
     or char_length(btrim(coalesce(p_signer_name, ''))) not between 2 and 150
     or coalesce(p_signer_relation, '') not in ('patient', 'guardian') then
    raise exception using errcode = '22023', message = 'Faltan datos del consentimiento.';
  end if;
  if (p_signature_png is null) = (p_link_token is null) then
    raise exception using errcode = '22023', message = 'Elige una sola forma de firma.';
  end if;

  v_document_hash := encode(sha256(convert_to(p_document_text, 'UTF8')), 'hex');

  -- Serializa reintentos concurrentes con la misma llave antes de consumir una
  -- captura QR. Bajo READ COMMITTED, quien espere aquí vuelve a ver el registro
  -- ya confirmado y obtiene el mismo UUID en lugar de un falso "ya utilizado".
  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant::text || ':' || p_idempotency_key::text, 0)
  );

  select * into v_existing
    from public.smyl_informed_consents
   where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.patient_id is distinct from p_patient_id
       or v_existing.template_key is distinct from p_template_key
       or v_existing.procedure_title is distinct from btrim(p_procedure_title)
       or v_existing.document_sha256 is distinct from v_document_hash
       or v_existing.signer_name is distinct from btrim(p_signer_name)
       or v_existing.signer_relation is distinct from p_signer_relation
       or v_existing.signature_capture_method is distinct from
         (case when p_link_token is null then 'clinic_device' else 'clinic_qr' end) then
      raise exception using errcode = '22023', message = 'La llave de reintento pertenece a otro consentimiento.';
    end if;
    return v_existing.id;
  end if;

  if p_link_token is not null then
    if p_link_token !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'El código de firma no es válido.';
    end if;
    select * into v_link
      from public.smyl_informed_consent_signature_links l
     where l.tenant_id = v_tenant and l.patient_id = p_patient_id
       and l.professional_id = v_pro.id and l.created_by = auth.uid()
       and l.token_hash = encode(sha256(convert_to(p_link_token, 'UTF8')), 'hex')
       and l.submitted_at is not null and l.submitted_at <= l.expires_at
       and l.submitted_at > clock_timestamp() - interval '10 minutes'
       and l.accepted_at is not null and l.used_at is null and l.cancelled_at is null
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'La firma recibida venció o ya fue utilizada.';
    end if;
    if v_link.document_sha256 is distinct from v_document_hash
       or v_link.document_text is distinct from p_document_text
       or v_link.template_key is distinct from p_template_key
       or v_link.procedure_title is distinct from btrim(p_procedure_title)
       or v_link.signer_name is distinct from btrim(p_signer_name)
       or v_link.signer_relation is distinct from p_signer_relation then
      raise exception using errcode = '40001', message = 'El documento cambió después de generar el código. Solicita una firma nueva.';
    end if;
    v_signature := v_link.signature_png;
    v_signature_hash := v_link.signature_sha256;
    v_capture_method := 'clinic_qr';
    v_reference := v_link.reference;
    v_capture_link_id := v_link.id;
    v_capture_token_hash := v_link.capture_token_sha256;
    v_capture_client_info := v_link.client_info;
    v_accepted_at := v_link.accepted_at;
    v_captured_at := v_link.submitted_at;
    v_acceptance_version := v_link.acceptance_version;
    v_acceptance_text := v_link.acceptance_text;
  else
    if p_patient_accepted is distinct from true then
      raise exception using errcode = '22023', message = 'El paciente debe aceptar el documento antes de firmar.';
    end if;
    if not public.smyl_valid_signature_png(coalesce(p_signature_png, '')) then
      raise exception using errcode = '22023', message = 'La firma del paciente no es válida. Vuelve a firmar.';
    end if;
    v_signature := p_signature_png;
    v_signature_hash := encode(sha256(convert_to(p_signature_png, 'UTF8')), 'hex');
    v_capture_method := 'clinic_device';
    v_reference := upper(left(encode(gen_random_bytes(8), 'hex'), 8));
    v_capture_link_id := null;
    v_capture_token_hash := null;
    v_capture_client_info := null;
    v_accepted_at := v_signed_at;
    v_captured_at := v_signed_at;
  end if;

  v_evidence_hash := encode(sha256(convert_to(jsonb_build_object(
    'schema', 'smyl-consent-evidence-v1',
    'consent_id', v_id,
    'tenant_id', v_tenant,
    'patient_id', p_patient_id,
    'template_key', p_template_key,
    'procedure_title', btrim(p_procedure_title),
    'document_sha256', v_document_hash,
    'signer_name', btrim(p_signer_name),
    'signer_relation', p_signer_relation,
    'signature_sha256', v_signature_hash,
    'professional_id', v_pro.id,
    'professional_name', v_pro.display_name,
    'professional_license', btrim(v_pro.license_number),
    'professional_auth_method', v_auth_method,
    'signed_at', v_signed_at,
    'capture_method', v_capture_method,
    'capture_link_id', v_capture_link_id,
    'capture_reference', v_reference,
    'capture_token_sha256', v_capture_token_hash,
    'capture_client_info', v_capture_client_info,
    'identity_verified_by', auth.uid(),
    'identity_verified_at', v_signed_at,
    'identity_verification_method', 'in_person',
    'patient_accepted_at', v_accepted_at,
    'signature_captured_at', v_captured_at,
    'acceptance_version', v_acceptance_version,
    'acceptance_text', v_acceptance_text
  )::text, 'UTF8')), 'hex');

  insert into public.smyl_informed_consents (
    id, tenant_id, patient_id, template_key, procedure_title, document_text,
    document_sha256, signer_name, signer_relation, signature_png,
    signature_sha256, professional_id, professional_name, professional_license,
    professional_auth_method, signed_at, captured_by,
    signature_capture_method, identity_verified_by, identity_verified_at,
    identity_verification_method, capture_link_id, capture_reference,
    capture_token_sha256, capture_client_info, patient_accepted_at, signature_captured_at,
    acceptance_version, acceptance_text, evidence_sha256, idempotency_key
  ) values (
    v_id, v_tenant, p_patient_id, p_template_key, btrim(p_procedure_title), p_document_text,
    v_document_hash, btrim(p_signer_name), p_signer_relation, v_signature,
    v_signature_hash, v_pro.id, v_pro.display_name, btrim(v_pro.license_number),
    v_auth_method, v_signed_at, auth.uid(),
    v_capture_method, auth.uid(), v_signed_at,
    'in_person', v_capture_link_id, v_reference,
    v_capture_token_hash, v_capture_client_info, v_accepted_at, v_captured_at,
    v_acceptance_version, v_acceptance_text, v_evidence_hash, p_idempotency_key
  );

  if v_capture_link_id is not null then
    update public.smyl_informed_consent_signature_links
       set used_at = v_signed_at
     where id = v_capture_link_id;
  end if;

  insert into public.smyl_audit_events (
    tenant_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_tenant, auth.uid(), 'insert', 'smyl_informed_consents', v_id::text,
    jsonb_build_object(
      'patient_id', p_patient_id,
      'professional_id', v_pro.id,
      'document_sha256', v_document_hash,
      'signature_sha256', v_signature_hash,
      'evidence_sha256', v_evidence_hash,
      'capture_method', v_capture_method,
      'capture_reference', v_reference,
      'identity_verification_method', 'in_person',
      'acceptance_version', v_acceptance_version,
      'patient_accepted_at', v_accepted_at,
      'signed_at', v_signed_at
    )
  );

  return v_id;
exception
  when unique_violation then
    select * into v_existing
      from public.smyl_informed_consents
     where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
    if found and v_existing.patient_id = p_patient_id
       and v_existing.template_key = p_template_key
       and v_existing.procedure_title = btrim(p_procedure_title)
       and v_existing.document_sha256 = v_document_hash
       and v_existing.signer_name = btrim(p_signer_name)
       and v_existing.signer_relation = p_signer_relation
       and v_existing.signature_capture_method =
         (case when p_link_token is null then 'clinic_device' else 'clinic_qr' end) then
      return v_existing.id;
    end if;
    raise;
end;
$$;

-- Compatibilidad segura para clientes anteriores: sigue siendo sólo la ruta local,
-- pero usa el mismo validador estricto y la misma evidencia permanente.
create or replace function public.smyl_record_informed_consent(
  p_patient_id uuid, p_template_key text, p_procedure_title text, p_document_text text,
  p_signer_name text, p_signer_relation text, p_signature_png text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  return public.smyl_finalize_informed_consent_signature(
    p_patient_id,
    p_template_key,
    p_procedure_title,
    p_document_text,
    p_signer_name,
    p_signer_relation,
    p_signature_png,
    null,
    gen_random_uuid(),
    true,
    true
  );
end;
$$;

-- Consulta completa con auditoría. No expone tenant ni el identificador interno del capturista.
create or replace function public.smyl_get_informed_consent(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_informed_consents;
begin
  select * into v_row
    from public.smyl_informed_consents
   where tenant_id = v_tenant and id = p_id;
  if not found or not public.smyl_has_permission(v_tenant, 'clinical.read')
     or not public.smyl_can_access_patient(v_tenant, v_row.patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso a este consentimiento.';
  end if;

  insert into public.smyl_audit_events (
    tenant_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_tenant, auth.uid(), 'insert', 'smyl_informed_consent_view', p_id::text,
    jsonb_build_object('patient_id', v_row.patient_id, 'viewed_at', clock_timestamp())
  );
  return to_jsonb(v_row)
    - 'tenant_id'
    - 'captured_by'
    - 'identity_verified_by'
    - 'capture_token_sha256'
    - 'capture_client_info'
    - 'capture_link_id'
    - 'idempotency_key';
end;
$$;

-- Revocación autenticada y auditada; el documento original permanece inmutable.
create or replace function public.smyl_revoke_informed_consent(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_informed_consents;
  v_method text;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_row
    from public.smyl_informed_consents
   where tenant_id = v_tenant and id = p_id and revoked_at is null
   for update;
  if not found or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not public.smyl_can_access_patient(v_tenant, v_row.patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No se puede revocar este consentimiento.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'Escribe el motivo de la revocación.';
  end if;
  v_method := public.smyl_recent_auth_method(600);
  if v_method is null then
    raise exception using errcode = '28000', message = 'Confirma tu identidad para revocar el consentimiento.', hint = 'reauth_required';
  end if;

  update public.smyl_informed_consents
     set revoked_at = v_now,
         revoked_reason = btrim(p_reason),
         revoked_by = auth.uid(),
         revoked_auth_method = v_method
   where tenant_id = v_tenant and id = p_id;

  insert into public.smyl_audit_events (
    tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    v_tenant, auth.uid(), 'update', 'smyl_informed_consents', p_id::text,
    jsonb_build_object('revoked_at', null),
    jsonb_build_object('revoked_at', v_now, 'reason', btrim(p_reason), 'auth_method', v_method)
  );
end;
$$;

-- Revocación y retención son las únicas excepciones de actualización/borrado.
-- La bandera es obligatoria también cuando el borrado llegue por cascada.
create or replace function public.smyl_informed_consents_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('smyl.retention_purge', true), '') <> 'nom004-5y' then
      raise exception using errcode = '55000', message = 'Un consentimiento informado no se puede eliminar.';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - array['revoked_at', 'revoked_reason', 'revoked_by', 'revoked_auth_method'])
       is distinct from
     (to_jsonb(old) - array['revoked_at', 'revoked_reason', 'revoked_by', 'revoked_auth_method'])
     or old.revoked_at is not null
     or new.revoked_at is null
     or char_length(btrim(coalesce(new.revoked_reason, ''))) not between 3 and 500
     or new.revoked_by is null
     or char_length(btrim(coalesce(new.revoked_auth_method, ''))) not between 2 and 80 then
    raise exception using errcode = '55000', message = 'Un consentimiento informado firmado no se modifica.';
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_informed_consents_immutable
  on public.smyl_informed_consents;
create trigger smyl_informed_consents_immutable
  before update or delete on public.smyl_informed_consents
  for each row execute function public.smyl_informed_consents_immutable();

create or replace function public.smyl_purge_expired_informed_consent_signature_links(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  with doomed as (
    select id
      from public.smyl_informed_consent_signature_links
     where cancelled_at is not null
        or used_at is not null
        or (
          expires_at <= clock_timestamp()
          and (submitted_at is null or submitted_at < clock_timestamp() - interval '10 minutes')
        )
     order by expires_at
     limit greatest(1, least(coalesce(p_limit, 1000), 10000))
     for update skip locked
  ), removed as (
    delete from public.smyl_informed_consent_signature_links l
     using doomed d
     where l.id = d.id
    returning l.id
  )
  select count(*) into v_count from removed;
  return v_count;
end;
$$;

revoke all on function public.smyl_informed_consent_acceptance_text(text)
  from public, anon, authenticated;

revoke all on function public.smyl_create_informed_consent_signature_link(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.smyl_create_informed_consent_signature_link(uuid, text, text, text, text, text) to authenticated;

revoke all on function public.smyl_informed_consent_signature_link_info(text) from public;
grant execute on function public.smyl_informed_consent_signature_link_info(text) to anon, authenticated;

revoke all on function public.smyl_submit_informed_consent_signature(text, text, boolean) from public;
grant execute on function public.smyl_submit_informed_consent_signature(text, text, boolean) to anon, authenticated;

revoke all on function public.smyl_informed_consent_signature_link_status(text) from public, anon;
grant execute on function public.smyl_informed_consent_signature_link_status(text) to authenticated;

revoke all on function public.smyl_cancel_informed_consent_signature_link(text) from public, anon;
grant execute on function public.smyl_cancel_informed_consent_signature_link(text) to authenticated;

revoke all on function public.smyl_finalize_informed_consent_signature(uuid, text, text, text, text, text, text, text, uuid, boolean, boolean) from public, anon;
grant execute on function public.smyl_finalize_informed_consent_signature(uuid, text, text, text, text, text, text, text, uuid, boolean, boolean) to authenticated;

revoke all on function public.smyl_record_informed_consent(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.smyl_record_informed_consent(uuid, text, text, text, text, text, text) to authenticated;

revoke all on function public.smyl_get_informed_consent(uuid) from public, anon;
grant execute on function public.smyl_get_informed_consent(uuid) to authenticated;

revoke all on function public.smyl_revoke_informed_consent(uuid, text) from public, anon;
grant execute on function public.smyl_revoke_informed_consent(uuid, text) to authenticated;

revoke all on function public.smyl_purge_expired_informed_consent_signature_links(integer) from public, anon, authenticated;
grant execute on function public.smyl_purge_expired_informed_consent_signature_links(integer) to service_role;

do $$
declare
  v_job record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron no está habilitado: la purga de enlaces de consentimiento no quedó programada.';
    return;
  end if;
  for v_job in
    select jobid from cron.job where jobname = 'smyl-purga-enlaces-consentimiento'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule(
    'smyl-purga-enlaces-consentimiento',
    '*/10 * * * *',
    $job$select public.smyl_purge_expired_informed_consent_signature_links(2000)$job$
  );
end;
$$;

commit;
