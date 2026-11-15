-- Fase 2b: lo que la persona escribe en el enlace queda «por verificar» hasta que el personal lo confirme.
-- Antes quedaba 'completo' sin revisión. Aditiva: solo amplía el conjunto de estados y cambia el estado que deja el envío.
-- Aplicar ANTES de publicar la web (el botón «Confirmar datos» escribe 'por_verificar' -> 'completo').

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'camila_pacientes_registro_estado_check') then
    alter table public.camila_pacientes drop constraint camila_pacientes_registro_estado_check;
  end if;
  alter table public.camila_pacientes
    add constraint camila_pacientes_registro_estado_check check (registro_estado in ('completo','pendiente','por_verificar'));
end $$;

create index if not exists camila_pacientes_registro_por_verificar_idx
  on public.camila_pacientes (tenant_id) where registro_estado = 'por_verificar';

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
         registro_estado = 'por_verificar',
         updated_at = now()
   where id = v_link.patient_id and tenant_id = v_link.tenant_id and registro_estado = 'pendiente';
  if not found then
    raise exception 'Enlace no disponible.' using errcode = '22023';
  end if;

  update public.smyl_patient_registration_links set used_at = now() where id = v_link.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.smyl_submit_registration(text, text, text, text, date, text, boolean) from public;
grant execute on function public.smyl_submit_registration(text, text, text, text, date, text, boolean) to anon, authenticated;
