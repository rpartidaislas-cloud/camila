-- SMYL · Pacientes y citas de PRUEBA (ficticios) para ver la Agenda y los horarios con carga real.
--
-- QUÉ CREA (todo ficticio):
--   · 30 pacientes con nombre, teléfono falso (3300001xxx) y correo @ejemplo.invalid. Ninguno corresponde a una persona real.
--   · Bloqueos: vacaciones de la Dra. Valeria (en sus 2 sucursales), junta del Dr. Andrés y mantenimiento del sillón único de Plaza Sol.
--   · Citas de los 14 días anteriores y los 14 siguientes, repartidas entre los 6 dentistas de prueba y sus sucursales:
--     las pasadas quedan terminadas, con algunas «No vino» y canceladas; la de hoy en el estado que le toca por hora;
--     las futuras confirmadas (y algunas canceladas).
--   · Las citas respetan las mismas reglas que la Agenda: horario de la sucursal, horario del dentista, servicio que hace,
--     sillón libre, bloqueos y sin empalmar al mismo paciente. Donde no cabe una cita (por ejemplo el sillón único
--     de Plaza Sol), simplemente no se crea: así se ve la saturación real.
--
-- ANTES DE CORRERLO
--   Corre primero equipo-de-prueba.sql en la MISMA clínica (crea sucursales, dentistas, sillones y servicios).
--
-- CÓMO USARLO
--   1. Supabase → SQL Editor → New query → pega este archivo.
--   2. Cambia PEGA-AQUI-EL-ID-DE-LA-CLINICA por el id de la clínica de prueba (select id, nombre, email from public.camila_tenants;).
--   3. Run. Se puede correr varias veces sin duplicar nada. Los datos se calculan a partir de HOY: correrlo otro día
--      agrega las citas de los días nuevos y conserva las anteriores.
--   4. El último resultado resume lo creado. Para borrarlo todo: pacientes-y-citas-de-prueba-limpiar.sql.
--
-- SEGURIDAD
--   · Úsalo en una CLÍNICA DE PRUEBA. Se detiene si la clínica ya tiene pacientes o citas reales
--     (salvo que cambies v_permitir_clinica_real a true bajo tu responsabilidad).
--   · NO crea recordatorios: a estos pacientes nunca se les envía un mensaje.
--   · Todo lo creado tiene identificador que empieza con 7e57 («test»), propio de cada clínica; la limpieza solo toca eso.
--   · No cambia el esquema de la base.

-- ► ÚNICA LÍNEA QUE DEBES EDITAR: pega entre las comillas el id de la clínica donde vas a probar.
select set_config('smyl.clinica', 'PEGA-AQUI-EL-ID-DE-LA-CLINICA', false);

-- Identificadores reconocibles (7e57 = «test»); misma fórmula que equipo-de-prueba.sql.
create or replace function pg_temp.tid(p_clinica uuid, p_clave text) returns uuid language sql immutable as $f$
  select ('7e570000-' || substr(h, 1, 4) || '-4' || substr(h, 5, 3) || '-8' || substr(h, 8, 3) || '-' || substr(h, 11, 12))::uuid
  from (select md5(p_clinica::text || ':' || p_clave) as h) x
$f$;

-- Número «al azar» pero siempre el mismo para la misma clave (0 … p_n-1): así el script es repetible.
create or replace function pg_temp.azar(p_clave text, p_n int) returns int language sql immutable as $f$
  select (('x' || substr(md5(p_clave), 1, 7))::bit(28)::int % p_n)
$f$;

do $$
declare
  v_clinica text := current_setting('smyl.clinica');
  v_permitir_clinica_real boolean := false;

  v_dias_atras int := 14;
  v_dias_adelante int := 14;
  v_ocupacion int := 45;        -- % de huecos que se intentan llenar (más alto = agenda más llena)

  v_tenant uuid;
  v_ahora timestamptz := now();
  v_hoy date;
  v_nuevos_pacientes int := 0;
  v_citas int := 0;
  v_intentos int := 0;
  v_sin_lugar int := 0;
  v_dia date;
  v_id uuid;
  b record;
  s record;
  v_tz text;
  v_cursor timestamp;
  v_fin_bloque timestamp;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_servicio public.smyl_services%rowtype;
  v_paciente uuid;
  v_sala uuid;
  v_estado text;
  v_clave text;
  v_ok boolean;
  v_azar int;
  v_pacientes uuid[];
  v_dia_junta int;
  v_servicios uuid[];
begin
  if v_clinica !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Falta el id de la clínica: reemplaza PEGA-AQUI-EL-ID-DE-LA-CLINICA por el id real (select id, nombre from public.camila_tenants).';
  end if;
  v_tenant := v_clinica::uuid;
  -- El SQL Editor corre sin sesión de usuario y la base protege las citas por rol (smyl_guard_scoped_write). Este bloque
  -- se identifica como servicio solo durante esta ejecución (set_config local) para poder crear los datos de prueba.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if not exists (select 1 from public.camila_tenants where id = v_tenant) then
    raise exception 'No existe una clínica con el id %.', v_tenant;
  end if;
  if not exists (select 1 from public.smyl_professionals where tenant_id = v_tenant and id::text like '7e570000-%' and active) then
    raise exception 'Esta clínica no tiene los dentistas de prueba. Corre primero equipo-de-prueba.sql con el mismo id.';
  end if;
  if not v_permitir_clinica_real and (
    exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id::text not like '7e570000-%')
    or exists (select 1 from public.smyl_appointments where tenant_id = v_tenant and id::text not like '7e570000-%')
  ) then
    raise exception 'Esta clínica ya tiene pacientes o citas reales. Usa una clínica de prueba (recomendado) o cambia v_permitir_clinica_real a true bajo tu responsabilidad.';
  end if;

  v_hoy := (v_ahora at time zone coalesce((select timezone from public.smyl_branches where tenant_id = v_tenant and id::text like '7e570000-%' order by id limit 1), 'America/Mexico_City'))::date;

  -- ── Pacientes ficticios ────────────────────────────────────────────────────
  create temporary table pg_temp.paciente_prueba (n int, nombre text, apellido text, genero text) on commit drop;
  insert into pg_temp.paciente_prueba values
    (1, 'Lucía', 'Hernández Ejemplo', 'femenino'), (2, 'Mateo', 'Ramírez Prueba', 'masculino'), (3, 'Camila', 'Ortega Ficticia', 'femenino'),
    (4, 'Santiago', 'Núñez Ejemplo', 'masculino'), (5, 'Valentina', 'Cervantes Prueba', 'femenino'), (6, 'Diego', 'Aguilar Ficticio', 'masculino'),
    (7, 'Regina', 'Salazar Ejemplo', 'femenino'), (8, 'Emiliano', 'Fuentes Prueba', 'masculino'), (9, 'Ximena', 'Domínguez Ficticia', 'femenino'),
    (10, 'Sebastián', 'Maldonado Ejemplo', 'masculino'), (11, 'Renata', 'Campos Prueba', 'femenino'), (12, 'Leonardo', 'Vargas Ficticio', 'masculino'),
    (13, 'Paula', 'Guerrero Ejemplo', 'femenino'), (14, 'Joaquín', 'Peña Prueba', 'masculino'), (15, 'Isabella', 'Rojas Ficticia', 'femenino'),
    (16, 'Tomás', 'Ibarra Ejemplo', 'masculino'), (17, 'Mariana', 'Esquivel Prueba', 'femenino'), (18, 'Gael', 'Montes Ficticio', 'masculino'),
    (19, 'Daniela', 'Robles Ejemplo', 'femenino'), (20, 'Andrea', 'Cisneros Prueba', 'otro'), (21, 'Fernando', 'Luna Ficticio', 'masculino'),
    (22, 'Sofía', 'Barrera Ejemplo', 'femenino'), (23, 'Bruno', 'Ochoa Prueba', 'masculino'), (24, 'Natalia', 'Quintero Ficticia', 'femenino'),
    (25, 'Alan', 'Velasco Ejemplo', 'masculino'), (26, 'Jimena', 'Treviño Prueba', 'femenino'), (27, 'Iker', 'Carrillo Ficticio', 'masculino'),
    (28, 'Abril', 'Mendoza Ejemplo', 'femenino'), (29, 'Rodrigo', 'Soto Prueba', 'masculino'), (30, 'Alejandra', 'Pineda Ficticia', 'femenino');

  with nuevos as (
    insert into public.camila_pacientes (id, tenant_id, nombre, apellido, email, telefono, fecha_nacimiento, genero, notas)
    select pg_temp.tid(v_tenant, 'pac' || p.n), v_tenant, p.nombre, p.apellido,
           'prueba.' || p.n || '@ejemplo.invalid',
           '3300001' || lpad(p.n::text, 3, '0'),
           date '1960-01-01' + (pg_temp.azar('nac' || p.n, 21000)),     -- entre 1960 y 2017
           p.genero,
           'PACIENTE FICTICIO DE PRUEBA. No corresponde a una persona real.'
    from pg_temp.paciente_prueba p
    on conflict (id) do nothing
    returning 1
  ) select count(*) into v_nuevos_pacientes from nuevos;

  select array_agg(pg_temp.tid(v_tenant, 'pac' || n) order by n) into v_pacientes from pg_temp.paciente_prueba;

  -- ── Bloqueos (se crean ANTES de las citas para que estas los respeten) ────────────────────
  -- La junta del Dr. Andrés cae en su primer martes o jueves (los días que atiende en Centro) a partir de 5 días.
  select min(i) into v_dia_junta from generate_series(5, 12) i where extract(dow from v_hoy + i)::int in (2, 4);
  -- Vacaciones de la Dra. Valeria en sus dos sucursales; junta del Dr. Andrés; mantenimiento del sillón único de Plaza Sol.
  insert into public.smyl_schedule_blocks (id, tenant_id, branch_id, professional_id, room_id, starts_at, ends_at, reason, block_type, created_by)
  select pg_temp.tid(v_tenant, x.clave), v_tenant, pg_temp.tid(v_tenant, x.sucursal),
         case when x.sillon is null then pg_temp.tid(v_tenant, x.dentista) end,
         case when x.sillon is not null then pg_temp.tid(v_tenant, x.sillon) end,
         ((v_hoy + x.dia_ini) + x.hora_ini) at time zone coalesce(br.timezone, 'America/Mexico_City'),
         ((v_hoy + x.dia_fin) + x.hora_fin) at time zone coalesce(br.timezone, 'America/Mexico_City'),
         x.motivo, x.tipo, v_tenant
  from (values
    ('blq-vac-centro', 'b001', 'd001', null::text, 10, time '00:00', 12, time '23:59', 'Vacaciones (prueba)', 'personal'),
    ('blq-vac-plaza',  'b002', 'd001', null::text, 10, time '00:00', 12, time '23:59', 'Vacaciones (prueba)', 'personal'),
    ('blq-junta',      'b001', 'd002', null::text,  v_dia_junta, time '14:00',  v_dia_junta, time '15:30', 'Junta de equipo (prueba)', 'meeting'),
    ('blq-mantto',     'b002', null::text, 'a201',  4, time '10:00',  4, time '12:00', 'Mantenimiento del sillón (prueba)', 'maintenance')
  ) as x(clave, sucursal, dentista, sillon, dia_ini, hora_ini, dia_fin, hora_fin, motivo, tipo)
  join public.smyl_branches br on br.tenant_id = v_tenant and br.id = pg_temp.tid(v_tenant, x.sucursal)
  on conflict (id) do nothing;

  -- ── Citas ─────────────────────────────────────────────────────────────────────────────
  -- Se recorre el horario de cada dentista (por sucursal y día de la semana) y se va llenando de principio a fin.
  for b in
    select h.professional_id, h.branch_id, h.weekday, h.starts_at, h.ends_at, coalesce(br.timezone, 'America/Mexico_City') as tz
    from public.smyl_professional_hours h
    join public.smyl_branches br on br.tenant_id = h.tenant_id and br.id = h.branch_id
    where h.tenant_id = v_tenant and h.active and h.professional_id::text like '7e570000-%' and h.branch_id::text like '7e570000-%'
    order by h.professional_id, h.branch_id, h.weekday, h.starts_at
  loop
    select array_agg(ps.service_id order by ps.service_id) into v_servicios
    from public.smyl_professional_services ps
    join public.smyl_services sv on sv.tenant_id = ps.tenant_id and sv.id = ps.service_id and sv.active
    where ps.tenant_id = v_tenant and ps.professional_id = b.professional_id;
    continue when v_servicios is null;

    for v_dia in select d::date from generate_series(v_hoy - v_dias_atras, v_hoy + v_dias_adelante, interval '1 day') d loop
      continue when extract(dow from v_dia)::int <> b.weekday;
      v_cursor := v_dia + b.starts_at;
      v_fin_bloque := v_dia + b.ends_at;
      v_tz := b.tz;

      while v_cursor < v_fin_bloque loop
        v_clave := b.professional_id::text || b.branch_id::text || v_cursor::text;
        select * into v_servicio from public.smyl_services
          where tenant_id = v_tenant and id = v_servicios[1 + pg_temp.azar('srv' || v_clave, array_length(v_servicios, 1))];
        v_inicio := v_cursor at time zone v_tz;
        v_fin := v_inicio + make_interval(mins => v_servicio.duration_minutes);
        exit when (v_cursor + make_interval(mins => v_servicio.duration_minutes)) > v_fin_bloque;

        if pg_temp.azar('ocu' || v_clave, 100) < v_ocupacion then
          v_intentos := v_intentos + 1;
          v_id := pg_temp.tid(v_tenant, 'cita' || v_clave);
          if not exists (select 1 from public.smyl_appointments where tenant_id = v_tenant and id = v_id) then
            -- Paciente: el que toca por azar, y si ya tiene otra cita a esa hora, el siguiente de la lista.
            v_paciente := null;
            for i in 0..4 loop
              v_paciente := v_pacientes[1 + (pg_temp.azar('pac' || v_clave, array_length(v_pacientes, 1)) + i) % array_length(v_pacientes, 1)];
              exit when not exists (
                select 1 from public.smyl_appointments a
                where a.tenant_id = v_tenant and a.patient_id = v_paciente and a.status in ('confirmed', 'arrived', 'in_progress', 'completed')
                  and a.starts_at < v_fin and a.ends_at > v_inicio);
              v_paciente := null;
            end loop;

            -- Sillón: el primero libre de la sucursal. La base decide si la cita cabe; si no, se omite.
            v_ok := false; v_sala := null;
            if v_paciente is not null then
              for s in select id from public.smyl_rooms where tenant_id = v_tenant and branch_id = b.branch_id and active order by name, id loop
                -- La base no cuenta como ocupado lo ya «terminado»; aquí sí, para no empalmar en corridas posteriores.
                continue when exists (
                  select 1 from public.smyl_appointments a
                  where a.tenant_id = v_tenant and a.status = 'completed' and (a.room_id = s.id or a.professional_id = b.professional_id)
                    and a.starts_at < v_fin and a.ends_at > v_inicio);
                begin
                  perform public.smyl_validate_service_appointment_slot(v_tenant, v_id, null, v_servicio.id, b.branch_id, b.professional_id, s.id, v_inicio, v_fin);
                  v_sala := s.id; v_ok := true; exit;
                exception when others then
                  null;
                end;
              end loop;
            end if;

            if v_ok then
              v_azar := pg_temp.azar('est' || v_clave, 100);
              if v_fin < v_ahora then
                -- «Terminada» se marca al final: la base no cuenta como ocupado un sillón con cita terminada y,
                -- mientras se arma la agenda, así se evitan empalmes entre dentistas.
                v_estado := case when v_azar < 78 then 'confirmed' when v_azar < 88 then 'no_show' else 'cancelled' end;
              elsif v_inicio <= v_ahora then
                v_estado := 'in_progress';
              elsif v_dia = v_hoy and v_inicio <= v_ahora + interval '2 hours' then
                v_estado := 'arrived';
              else
                v_estado := case when v_azar < 92 then 'confirmed' else 'cancelled' end;
              end if;

              insert into public.smyl_appointments (id, tenant_id, branch_id, patient_id, professional_id, service_id, room_id, starts_at, ends_at,
                                                    status, source, notes, cancellation_reason, created_by, updated_by)
              values (v_id, v_tenant, b.branch_id, v_paciente, b.professional_id, v_servicio.id, v_sala, v_inicio, v_fin,
                      v_estado, 'manual', 'Cita ficticia de prueba.',
                      case when v_estado = 'cancelled' then 'El paciente avisó que no puede asistir (prueba).' else '' end,
                      v_tenant, v_tenant);
              insert into public.smyl_appointment_events (tenant_id, appointment_id, event_type, to_status, actor_id, event_data)
              values (v_tenant, v_id, 'created', 'confirmed', v_tenant, jsonb_build_object('source', 'prueba'));
              v_citas := v_citas + 1;
            else
              v_sin_lugar := v_sin_lugar + 1;
            end if;
          end if;
          v_cursor := v_cursor + make_interval(mins => v_servicio.duration_minutes + v_servicio.buffer_after_minutes + 15 * pg_temp.azar('hue' || v_clave, 3));
        else
          v_cursor := v_cursor + interval '30 minutes';
        end if;
      end loop;
    end loop;
  end loop;

  -- Las citas de prueba que ya pasaron y siguen «confirmadas» (incluso de corridas anteriores) quedan terminadas.
  update public.smyl_appointments
     set status = 'completed'
   where tenant_id = v_tenant and id::text like '7e570000-%' and status = 'confirmed' and ends_at < v_ahora;

  raise notice 'Listo: % pacientes nuevos, % citas nuevas (% huecos intentados, % sin lugar por sillón, bloqueo o empalme).',
    v_nuevos_pacientes, v_citas, v_intentos, v_sin_lugar;
end;
$$;

-- Resultado: lo que hay ahora de prueba en esta clínica, por sucursal y estado.
select b.name as sucursal,
       count(*) filter (where a.status = 'completed') as terminadas,
       count(*) filter (where a.status = 'no_show') as no_vino,
       count(*) filter (where a.status = 'cancelled') as canceladas,
       count(*) filter (where a.status in ('arrived', 'in_progress')) as en_curso_hoy,
       count(*) filter (where a.status = 'confirmed') as por_venir,
       count(*) as total
from public.smyl_appointments a
join public.smyl_branches b on b.tenant_id = a.tenant_id and b.id = a.branch_id
where a.tenant_id = current_setting('smyl.clinica')::uuid and a.id::text like '7e570000-%'
group by b.name
order by b.name;
