-- Firma de notas clínicas (NOM-004 5.10 y NOM-024): la nota la firma el profesional que la elaboró, con nombre y
-- cédula, después de confirmar su identidad, y queda la huella (SHA-256) del contenido firmado.
-- Antes bastaba el permiso clinical.approve y un "¿Confirmas?" en pantalla.
--
-- Reglas de smyl_sign_clinical_note (misma firma de función; la app no cambia de llamada):
--   * quien firma debe ser un profesional activo de la clínica con cédula registrada;
--   * si la nota tiene profesional asignado, solo él puede firmarla; si no tiene, queda asignada a quien firma;
--   * la sesión debe haber confirmado identidad en los últimos 10 minutos (contraseña o código de dos pasos):
--     se lee de los métodos de autenticación (amr) del propio token de sesión, no de algo que mande el navegador;
--   * se guarda signed_hash (SHA-256 del documento firmado), signed_name y signed_license.
-- Idempotente.

alter table public.smyl_clinical_notes
  add column if not exists signed_professional_id uuid,
  add column if not exists signed_name text,
  add column if not exists signed_license text,
  add column if not exists signed_hash text,
  add column if not exists signed_method text;

comment on column public.smyl_clinical_notes.signed_hash is 'SHA-256 (hex) del documento de la nota al momento de firmar.';

-- ¿La sesión confirmó identidad hace poco? (contraseña, código de dos pasos, enlace, OAuth) — segundos desde la última.
create or replace function public.smyl_recent_auth_method(p_window_seconds integer default 600)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a->>'method'
  from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
  where (a->>'timestamp') ~ '^[0-9]+$'
    and (a->>'timestamp')::bigint >= extract(epoch from clock_timestamp())::bigint - p_window_seconds
  order by (a->>'timestamp')::bigint desc
  limit 1;
$$;
revoke all on function public.smyl_recent_auth_method(integer) from public, anon;
grant execute on function public.smyl_recent_auth_method(integer) to authenticated;

create or replace function public.smyl_sign_clinical_note(p_id uuid, p_expected_revision integer)
returns public.smyl_clinical_notes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_clinical_notes;
  v_pro public.smyl_professionals;
  v_method text;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.approve') then
    raise exception using errcode = '42501', message = 'No tienes permiso para firmar notas clínicas.';
  end if;

  select * into v_pro from public.smyl_professionals p
   where p.tenant_id = v_tenant and p.user_id = auth.uid() and p.active
   limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'Solo un profesional registrado en la clínica puede firmar notas clínicas.';
  end if;
  if char_length(btrim(coalesce(v_pro.license_number, ''))) < 4 then
    raise exception using errcode = '23514', message = 'Registra tu cédula profesional en Equipo antes de firmar notas clínicas.';
  end if;

  v_method := public.smyl_recent_auth_method(600);
  if v_method is null then
    raise exception using errcode = '28000', message = 'Confirma tu identidad para firmar (contraseña o código de verificación).',
      hint = 'reauth_required';
  end if;

  select * into v_row from public.smyl_clinical_notes where tenant_id = v_tenant and id = p_id for update;
  if not found or v_row.status <> 'draft' then
    raise exception using errcode = '23514', message = 'La nota no está disponible para firma.';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'La nota cambió en otra sesión. Actualiza la ficha.';
  end if;
  if v_row.professional_id is not null and v_row.professional_id <> v_pro.id then
    raise exception using errcode = '42501', message = 'Solo el profesional responsable de esta nota puede firmarla.';
  end if;
  if char_length(btrim(coalesce(v_row.document->>'assessment', ''))) + char_length(btrim(coalesce(v_row.document->>'plan', ''))) < 2 then
    raise exception using errcode = '23514', message = 'Completa la valoración o el plan antes de firmar.';
  end if;

  update public.smyl_clinical_notes
     set status = 'signed', revision = revision + 1,
         professional_id = coalesce(professional_id, v_pro.id),
         signed_by = auth.uid(), signed_at = now(),
         signed_professional_id = v_pro.id,
         signed_name = v_pro.display_name,
         signed_license = btrim(v_pro.license_number),
         signed_hash = encode(sha256(convert_to(v_row.document::text, 'UTF8')), 'hex'),
         signed_method = v_method,
         updated_by = auth.uid(), updated_at = now()
   where tenant_id = v_tenant and id = p_id
  returning * into v_row;

  insert into public.smyl_clinical_note_versions(tenant_id, note_id, revision, snapshot, actor_id)
  values (v_tenant, p_id, v_row.revision, to_jsonb(v_row) - 'tenant_id', auth.uid());
  return v_row;
end;
$$;

revoke all on function public.smyl_sign_clinical_note(uuid, integer) from public, anon;
grant execute on function public.smyl_sign_clinical_note(uuid, integer) to authenticated;

-- Una nota firmada no cambia ni se borra, ni siquiera por fuera de las funciones (antes solo lo cuidaba la RPC).
create or replace function public.smyl_signed_note_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'signed' and pg_trigger_depth() = 1
       and coalesce(current_setting('smyl.retention_purge', true), '') <> 'nom004-5y' then
      raise exception using errcode = '42501', message = 'Una nota clínica firmada no se puede eliminar.';
    end if;
    return old;
  end if;
  if old.status = 'signed' and (new.document is distinct from old.document
     or new.signed_hash is distinct from old.signed_hash or new.signed_at is distinct from old.signed_at
     or new.signed_by is distinct from old.signed_by or new.patient_id is distinct from old.patient_id) then
    raise exception using errcode = '42501', message = 'Una nota clínica firmada no se modifica. Agrega una adenda.';
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_signed_note_immutable on public.smyl_clinical_notes;
create trigger smyl_signed_note_immutable
  before update or delete on public.smyl_clinical_notes
  for each row execute function public.smyl_signed_note_immutable();
