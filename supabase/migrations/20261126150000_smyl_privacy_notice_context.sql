-- Aviso de privacidad integral: la plantilla necesita el domicilio y el correo de contacto del responsable (la clínica).
-- Se toman de la sucursal principal (o la primera activa con domicilio) y del correo de la clínica.
-- Idempotente.

create or replace function public.smyl_clinic_privacy_contact(p_tenant uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'clinic_name', coalesce(nullif(btrim(t.nombre), ''), 'la clínica'),
    'clinic_email', coalesce(nullif(btrim(t.email), ''), ''),
    'clinic_address', coalesce((
      select concat_ws(', ', nullif(btrim(b.address_line), ''), nullif(btrim(coalesce(b.city, '')), ''),
                       nullif(btrim(coalesce(b.state, '')), ''), nullif('C.P. ' || btrim(coalesce(b.postal_code, '')), 'C.P. '))
        from public.smyl_branches b
       where b.tenant_id = p_tenant and b.active and char_length(btrim(coalesce(b.address_line, ''))) >= 5
       order by b.is_default desc, b.created_at
       limit 1), ''))
  from public.camila_tenants t where t.id = p_tenant;
$$;
revoke all on function public.smyl_clinic_privacy_contact(uuid) from public, anon, authenticated;

-- Para la firma en pantalla dentro de la app.
create or replace function public.smyl_privacy_notice_context()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when public.smyl_current_tenant() is null then null
              else public.smyl_clinic_privacy_contact(public.smyl_current_tenant()) end;
$$;
revoke all on function public.smyl_privacy_notice_context() from public, anon;
grant execute on function public.smyl_privacy_notice_context() to authenticated;

-- Para la firma desde el celular (enlace de un solo uso): ahora también devuelve domicilio y correo.
create or replace function public.smyl_consent_link_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('available', false); end if;
  select l.tenant_id into v_tenant
    from public.smyl_consent_links l
   where l.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex') and l.used_at is null and l.expires_at > now();
  if not found then return jsonb_build_object('available', false); end if;
  return jsonb_build_object('available', true) || coalesce(public.smyl_clinic_privacy_contact(v_tenant), jsonb_build_object('clinic_name', 'la clínica'));
end;
$$;

-- Registro por enlace o QR: también devuelve domicilio y correo para mostrar el aviso de privacidad de la clínica.
create or replace function public.smyl_registration_link_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid;
  v_contact jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('available', false);
  end if;
  select l.tenant_id into v_tenant
    from public.smyl_patient_registration_links l
    join public.camila_pacientes p on p.id = l.patient_id and p.tenant_id = l.tenant_id and p.registro_estado = 'pendiente'
   where l.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
     and l.used_at is null and l.expires_at > now();
  if not found then
    return jsonb_build_object('available', false);
  end if;
  v_contact := coalesce(public.smyl_clinic_privacy_contact(v_tenant), '{}'::jsonb);
  return jsonb_build_object('available', true,
    'clinic_name', coalesce(nullif(v_contact->>'clinic_name', 'la clínica'), 'tu clínica'),
    'clinic_address', coalesce(v_contact->>'clinic_address', ''),
    'clinic_email', coalesce(v_contact->>'clinic_email', ''));
end;
$$;
