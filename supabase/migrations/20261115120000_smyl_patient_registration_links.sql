-- Fase 2 de «paciente por registrar»: la persona completa sus propios datos desde un enlace.
-- El enlace lleva un token aleatorio de 256 bits; en la base solo se guarda su hash SHA-256.
-- Los datos que escribe la persona solo pueden ir a SU ficha pendiente: no lee nada de la clínica ni de otros pacientes.
-- Sin Edge Function: la página pública llama a estas dos funciones RPC con la clave publicable.

create table if not exists public.smyl_patient_registration_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  patient_id uuid not null,
  token_hash text not null unique,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint smyl_patient_registration_links_patient_fk
    foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id) on delete cascade
);
create index if not exists smyl_patient_registration_links_patient_idx
  on public.smyl_patient_registration_links (patient_id);

alter table public.smyl_patient_registration_links enable row level security;
revoke all on public.smyl_patient_registration_links from public, anon, authenticated;

-- Personal de la clínica: crea (o renueva) el enlace de una ficha pendiente. Devuelve el token una sola vez.
create or replace function public.smyl_create_registration_link(p_patient_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid;
  v_token text;
begin
  select tenant_id into v_tenant from public.camila_pacientes where id = p_patient_id;
  if v_tenant is null
     or v_tenant is distinct from public.smyl_current_tenant()
     or not public.smyl_has_permission(v_tenant, 'patients.manage')
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
    raise exception 'No tienes permiso para esta acción.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.camila_pacientes where id = p_patient_id and registro_estado = 'pendiente') then
    raise exception 'Este paciente ya tiene su registro completo.' using errcode = '22023';
  end if;

  update public.smyl_patient_registration_links
     set expires_at = now()
   where patient_id = p_patient_id and used_at is null and expires_at > now();

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.smyl_patient_registration_links (tenant_id, patient_id, token_hash, expires_at)
  values (v_tenant, p_patient_id, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), now() + interval '7 days');
  return v_token;
end;
$$;

-- Página pública: ¿el enlace sirve? Solo revela el nombre de la clínica y si está disponible.
create or replace function public.smyl_registration_link_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_clinic text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('available', false);
  end if;
  select coalesce(nullif(btrim(t.nombre), ''), 'tu clínica') into v_clinic
    from public.smyl_patient_registration_links l
    join public.camila_pacientes p on p.id = l.patient_id and p.tenant_id = l.tenant_id and p.registro_estado = 'pendiente'
    left join public.camila_tenants t on t.id = l.tenant_id
   where l.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
     and l.used_at is null and l.expires_at > now();
  if not found then
    return jsonb_build_object('available', false);
  end if;
  return jsonb_build_object('available', true, 'clinic_name', v_clinic);
end;
$$;

-- Página pública: la persona envía sus datos. Un solo uso; solo actualiza la ficha ligada al enlace.
create or replace function public.smyl_submit_registration(
  p_token text,
  p_nombre text,
  p_apellido text,
  p_email text,
  p_fecha_nacimiento date,
  p_genero text,
  p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_link public.smyl_patient_registration_links%rowtype;
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_apellido text := btrim(coalesce(p_apellido, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_genero text := nullif(btrim(coalesce(p_genero, '')), '');
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace no disponible.' using errcode = '22023';
  end if;
  if coalesce(p_consent, false) is not true then
    raise exception 'Debes aceptar el aviso de privacidad para continuar.' using errcode = '22023';
  end if;
  if length(v_nombre) not between 1 and 150 or length(v_apellido) > 150 then
    raise exception 'Revisa tu nombre.' using errcode = '22023';
  end if;
  if v_nombre like 'Por registrar%' then
    raise exception 'Escribe tu nombre real.' using errcode = '22023';
  end if;
  if v_email <> '' and (length(v_email) > 254 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    raise exception 'Revisa tu correo.' using errcode = '22023';
  end if;
  if v_genero is not null and v_genero not in ('femenino', 'masculino', 'otro') then
    raise exception 'Revisa los datos enviados.' using errcode = '22023';
  end if;
  if p_fecha_nacimiento is not null and (p_fecha_nacimiento > current_date or p_fecha_nacimiento < date '1900-01-01') then
    raise exception 'Revisa tu fecha de nacimiento.' using errcode = '22023';
  end if;

  select * into v_link
    from public.smyl_patient_registration_links
   where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
     and used_at is null and expires_at > now()
   for update;
  if not found then
    raise exception 'Enlace no disponible.' using errcode = '22023';
  end if;

  update public.camila_pacientes
     set nombre = v_nombre,
         apellido = v_apellido,
         email = v_email,
         fecha_nacimiento = p_fecha_nacimiento,
         genero = v_genero,
         registro_estado = 'completo',
         updated_at = now()
   where id = v_link.patient_id and tenant_id = v_link.tenant_id and registro_estado = 'pendiente';
  if not found then
    raise exception 'Enlace no disponible.' using errcode = '22023';
  end if;

  update public.smyl_patient_registration_links set used_at = now() where id = v_link.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.smyl_create_registration_link(uuid) from public, anon;
grant execute on function public.smyl_create_registration_link(uuid) to authenticated;
revoke all on function public.smyl_registration_link_info(text) from public;
grant execute on function public.smyl_registration_link_info(text) to anon, authenticated;
revoke all on function public.smyl_submit_registration(text, text, text, text, date, text, boolean) from public;
grant execute on function public.smyl_submit_registration(text, text, text, text, date, text, boolean) to anon, authenticated;
