-- SMYL · Equipo de PRUEBA: 3 sucursales ficticias y 6 dentistas ficticios.
--
-- QUÉ CREA (todo ficticio, solo para probar Agenda, Mensajes y el asistente):
--   · 3 sucursales con sus horarios, sillones (Centro 3, Plaza Sol 1, Lomas Verdes 2) y teléfono falso.
--   · 6 dentistas SIN cuenta de acceso (no pueden iniciar sesión), con licencia «PRUEBA-00x».
--   · Los días y horas en que atiende cada uno, en qué sucursal, y qué servicios hace.
--   · Los servicios dentales que falten (si ya existe uno con el mismo nombre, se reutiliza).
--
-- CÓMO USARLO
--   1. Supabase → SQL Editor → New query.
--   2. Pega el id de la clínica donde vas a probar en la línea «select set_config('smyl.clinica', '…')» (entre las
--      comillas, en lugar de PEGA-AQUI-EL-ID-DE-LA-CLINICA). Para ver el id:  select id, nombre, email from public.camila_tenants;
--   3. Run. Se puede correr varias veces sin duplicar nada.
--   4. Al terminar, el último resultado muestra el horario semanal de cada dentista.
--   Para borrarlo todo: equipo-de-prueba-limpiar.sql
--
-- SEGURIDAD
--   · Úsalo en una CLÍNICA DE PRUEBA. Si lo corres en tu clínica real, el asistente de WhatsApp/Instagram
--     podría ofrecerle a pacientes reales horarios con dentistas que no existen. Por eso el script se
--     detiene si la clínica ya tiene profesionales o citas reales, salvo que cambies v_permitir_clinica_real.
--   · Todo lo creado tiene un identificador que empieza con 7e57 («test»), propio de cada clínica; la limpieza solo toca eso.
--   · No escribe pacientes ni citas, y no cambia el esquema de la base.

-- ► ÚNICA LÍNEA QUE DEBES EDITAR: pega entre las comillas el id de la clínica donde vas a probar.
select set_config('smyl.clinica', 'PEGA-AQUI-EL-ID-DE-LA-CLINICA', false);

-- Identificadores reconocibles (empiezan con 7e57 = «test») y distintos para cada clínica.
create or replace function pg_temp.tid(p_clinica uuid, p_clave text) returns uuid language sql immutable as $f$
  select ('7e570000-' || substr(h, 1, 4) || '-4' || substr(h, 5, 3) || '-8' || substr(h, 8, 3) || '-' || substr(h, 11, 12))::uuid
  from (select md5(p_clinica::text || ':' || p_clave) as h) x
$f$;

do $$
declare
  v_clinica text := current_setting('smyl.clinica');
  v_permitir_clinica_real boolean := false;

  v_tenant uuid;
  v_hay_default boolean;
  r record;
  v_service uuid;
  v_prof uuid;
begin
  if v_clinica !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Falta el id de la clínica: reemplaza PEGA-AQUI-EL-ID-DE-LA-CLINICA por el id real (select id, nombre from public.camila_tenants).';
  end if;
  v_tenant := v_clinica::uuid;
  if not exists (select 1 from public.camila_tenants where id = v_tenant) then
    raise exception 'No existe una clínica con el id %.', v_tenant;
  end if;

  if not v_permitir_clinica_real and (
    exists (select 1 from public.smyl_professionals where tenant_id = v_tenant and id::text not like '7e570000-%')
    or exists (select 1 from public.smyl_appointments where tenant_id = v_tenant)
  ) then
    raise exception 'Esta clínica ya tiene profesionales o citas reales. Usa una clínica de prueba (recomendado) o cambia v_permitir_clinica_real a true bajo tu responsabilidad.';
  end if;

  -- ── Sucursales ───────────────────────────────────────────────────────────────────────────────────
  select exists (select 1 from public.smyl_branches where tenant_id = v_tenant and is_default and active) into v_hay_default;

  insert into public.smyl_branches (id, tenant_id, name, address_line, city, state, postal_code, phone, is_default)
  values
    (pg_temp.tid(v_tenant, 'b001'), v_tenant, 'Sucursal Centro',       'Av. Ficticia 100, Col. Centro',      'Guadalajara', 'Jalisco', '44100', '3300000001', not v_hay_default),
    (pg_temp.tid(v_tenant, 'b002'), v_tenant, 'Sucursal Plaza Sol',    'Plaza Sol Local 25, Av. Inventada 450', 'Zapopan',  'Jalisco', '45050', '3300000002', false),
    (pg_temp.tid(v_tenant, 'b003'), v_tenant, 'Sucursal Lomas Verdes', 'Calle Imaginaria 78, Lomas Verdes',  'Zapopan',     'Jalisco', '45130', '3300000003', false)
  on conflict (id) do update set active = true;

  -- Horario de la sucursal (0 = domingo … 6 = sábado). Centro cierra de 14:00 a 15:00.
  insert into public.smyl_clinic_hours (tenant_id, branch_id, weekday, starts_at, ends_at)
  select v_tenant, b.id, d.weekday, h.starts_at::time, h.ends_at::time
  from (values
    (pg_temp.tid(v_tenant, 'b001'), 'lv', '09:00', '14:00'),
    (pg_temp.tid(v_tenant, 'b001'), 'lv', '15:00', '19:00'),
    (pg_temp.tid(v_tenant, 'b001'), 'sa', '09:00', '14:00'),
    (pg_temp.tid(v_tenant, 'b002'), 'lv', '10:00', '20:00'),
    (pg_temp.tid(v_tenant, 'b002'), 'sa', '10:00', '15:00'),
    (pg_temp.tid(v_tenant, 'b003'), 'lv', '09:00', '18:00'),
    (pg_temp.tid(v_tenant, 'b003'), 'sa', '09:00', '14:00')
  ) as h(branch_id, dias, starts_at, ends_at)
  join public.smyl_branches b on b.tenant_id = v_tenant and b.id = h.branch_id
  join lateral (select unnest(case h.dias when 'lv' then array[1,2,3,4,5] else array[6] end) as weekday) d on true
  -- La base rechaza horarios traslapados antes de que «on conflict» pueda omitirlos: se insertan solo los que faltan.
  where not exists (
    select 1 from public.smyl_clinic_hours x
    where x.tenant_id = v_tenant and x.branch_id = b.id and x.weekday = d.weekday
      and x.starts_at = h.starts_at::time and x.ends_at = h.ends_at::time
  );

  -- Sillones: limitan cuántas citas pueden ocurrir al mismo tiempo en la sucursal.
  insert into public.smyl_rooms (id, tenant_id, branch_id, name, room_type)
  values
    (pg_temp.tid(v_tenant, 'a101'), v_tenant, pg_temp.tid(v_tenant, 'b001'), 'Sillón 1', 'sillon'),
    (pg_temp.tid(v_tenant, 'a102'), v_tenant, pg_temp.tid(v_tenant, 'b001'), 'Sillón 2', 'sillon'),
    (pg_temp.tid(v_tenant, 'a103'), v_tenant, pg_temp.tid(v_tenant, 'b001'), 'Sillón 3', 'sillon'),
    (pg_temp.tid(v_tenant, 'a201'), v_tenant, pg_temp.tid(v_tenant, 'b002'), 'Sillón único', 'sillon'),  -- adrede: 1 solo sillón
    (pg_temp.tid(v_tenant, 'a301'), v_tenant, pg_temp.tid(v_tenant, 'b003'), 'Sillón 1', 'sillon'),
    (pg_temp.tid(v_tenant, 'a302'), v_tenant, pg_temp.tid(v_tenant, 'b003'), 'Sillón 2', 'sillon')
  on conflict (id) do update set active = true;

  -- ── Dentistas ────────────────────────────────────────────────────────────────────────────────────
  insert into public.smyl_professionals (id, tenant_id, display_name, specialty, license_number, color_token)
  values
    (pg_temp.tid(v_tenant, 'd001'), v_tenant, 'Dra. Valeria Montoya Cruz',   'Odontología general',          'PRUEBA-001', 'teal'),
    (pg_temp.tid(v_tenant, 'd002'), v_tenant, 'Dr. Andrés Salinas Ibarra',   'Endodoncia',                   'PRUEBA-002', 'blue'),
    (pg_temp.tid(v_tenant, 'd003'), v_tenant, 'Dra. Mónica Reyes Tapia',     'Ortodoncia',                   'PRUEBA-003', 'violet'),
    (pg_temp.tid(v_tenant, 'd004'), v_tenant, 'Dr. Rodrigo Pineda León',     'Odontopediatría',              'PRUEBA-004', 'amber'),
    (pg_temp.tid(v_tenant, 'd005'), v_tenant, 'Dra. Fernanda Lozano Vera',   'Estética dental',              'PRUEBA-005', 'coral'),
    (pg_temp.tid(v_tenant, 'd006'), v_tenant, 'Dr. Iván Carrasco Mejía',     'Cirugía oral e implantes',     'PRUEBA-006', 'navy')
  on conflict (id) do update set active = true;

  -- Horario de cada dentista por sucursal. Cada bloque debe caber dentro del horario de la sucursal.
  -- Los días: l=lunes m=martes x=miércoles j=jueves v=viernes s=sábado.
  create temporary table pg_temp.horario_prueba (prof text, branch text, dias text, desde time, hasta time) on commit drop;
  insert into pg_temp.horario_prueba values
    ('d001', 'b001', 'lxv', '09:00', '14:00'),   -- Valeria: Centro lun/mié/vie por la mañana…
    ('d001', 'b002', 'mj',  '10:00', '16:00'),   -- …y Plaza Sol mar/jue.
    ('d002', 'b001', 'mj',  '10:00', '14:00'),   -- Andrés: solo Centro, mar/jue en dos bloques.
    ('d002', 'b001', 'mj',  '15:00', '19:00'),
    ('d003', 'b002', 'lxv', '10:00', '18:00'),   -- Mónica: Plaza Sol lun/mié/vie…
    ('d003', 'b003', 's',   '09:00', '14:00'),   -- …y Lomas Verdes los sábados.
    ('d004', 'b003', 'lmxjv','09:00', '15:00'),  -- Rodrigo: Lomas Verdes de lunes a viernes.
    ('d005', 'b002', 'mj',  '12:00', '20:00'),   -- Fernanda: Plaza Sol mar/jue en la tarde y sábado…
    ('d005', 'b002', 's',   '10:00', '15:00'),
    ('d005', 'b001', 'v',   '15:00', '19:00'),   -- …y Centro los viernes por la tarde.
    ('d006', 'b003', 'mj',  '12:00', '18:00'),   -- Iván: Lomas Verdes mar/jue en la tarde…
    ('d006', 'b001', 's',   '09:00', '14:00');   -- …y Centro los sábados.

  insert into public.smyl_professional_branches (tenant_id, professional_id, branch_id)
  select distinct v_tenant, pg_temp.tid(v_tenant, h.prof), pg_temp.tid(v_tenant, h.branch)
  from pg_temp.horario_prueba h
  on conflict do nothing;

  insert into public.smyl_professional_hours (tenant_id, professional_id, branch_id, weekday, starts_at, ends_at)
  select v_tenant, pg_temp.tid(v_tenant, h.prof), pg_temp.tid(v_tenant, h.branch),
         case dia when 'l' then 1 when 'm' then 2 when 'x' then 3 when 'j' then 4 when 'v' then 5 else 6 end, h.desde, h.hasta
  from pg_temp.horario_prueba h
  cross join lateral regexp_split_to_table(h.dias, '') as dia
  where not exists (
    select 1 from public.smyl_professional_hours x
    where x.tenant_id = v_tenant and x.professional_id = pg_temp.tid(v_tenant, h.prof)
      and x.branch_id = pg_temp.tid(v_tenant, h.branch)
      and x.weekday = case dia when 'l' then 1 when 'm' then 2 when 'x' then 3 when 'j' then 4 when 'v' then 5 else 6 end
      and x.starts_at = h.desde and x.ends_at = h.hasta
  );

  -- ── Servicios y quién los hace ───────────────────────────────────────────────────────────────────
  create temporary table pg_temp.servicio_prueba (nombre text, categoria text, minutos int, antes int, despues int, precio numeric, color text, quienes text) on commit drop;
  insert into pg_temp.servicio_prueba values
    ('Valoración dental integral', 'valoracion',  60, 0, 0,   500, 'teal',   'd001,d002,d004,d005,d006'),
    ('Limpieza dental',            'preventiva',  45, 0, 5,   700, 'green',  'd001,d004'),
    ('Aplicación de flúor',        'preventiva',  30, 0, 0,   400, 'green',  'd001,d004'),
    ('Resina (restauración)',      'restaurativa',60, 0, 5,  1200, 'blue',   'd001'),
    ('Endodoncia',                 'endodoncia',  90, 0, 15, 4500, 'navy',   'd002'),
    ('Valoración de ortodoncia',   'ortodoncia',  45, 0, 0,   600, 'violet', 'd003'),
    ('Revisión de ortodoncia',     'ortodoncia',  30, 0, 0,   600, 'violet', 'd003'),
    ('Consulta odontopediátrica',  'odontopediatria', 30, 0, 0, 500, 'amber','d004'),
    ('Extracción simple',          'cirugia',     45, 0, 15, 1200, 'coral',  'd001,d006'),
    ('Consulta de implantes',      'cirugia',     45, 0, 0,   800, 'navy',   'd006'),
    ('Blanqueamiento dental',      'estetica',    60, 0, 0,  3500, 'amber',  'd005'),
    ('Valoración de carillas',     'estetica',    45, 0, 0,   500, 'coral',  'd005');

  for r in select * from pg_temp.servicio_prueba loop
    select id into v_service from public.smyl_services where tenant_id = v_tenant and active and lower(name) = lower(r.nombre) limit 1;
    if v_service is null then
      insert into public.smyl_services (tenant_id, name, category, duration_minutes, buffer_before_minutes, buffer_after_minutes, reference_price, color_token)
      values (v_tenant, r.nombre, r.categoria, r.minutos, r.antes, r.despues, r.precio, r.color)
      returning id into v_service;
    end if;
    insert into public.smyl_professional_services (tenant_id, professional_id, service_id)
    select v_tenant, pg_temp.tid(v_tenant, p), v_service
    from unnest(string_to_array(r.quienes, ',')) as p
    on conflict do nothing;
  end loop;

  raise notice 'Listo: 3 sucursales, 6 dentistas de prueba y sus horarios.';
end;
$$;

-- Resultado: horario semanal de cada dentista (un renglón por sucursal y bloque de horas).
select p.display_name as dentista, p.specialty as especialidad, b.name as sucursal,
       string_agg((array['dom','lun','mar','mié','jue','vie','sáb'])[h.weekday + 1], ' ' order by case when h.weekday = 0 then 7 else h.weekday end) as dias,
       to_char(h.starts_at, 'HH24:MI') || '–' || to_char(h.ends_at, 'HH24:MI') as horas
from public.smyl_professional_hours h
join public.smyl_professionals p on p.tenant_id = h.tenant_id and p.id = h.professional_id
join public.smyl_branches b on b.tenant_id = h.tenant_id and b.id = h.branch_id
where p.id::text like '7e570000-%' and p.tenant_id = current_setting('smyl.clinica')::uuid
group by p.license_number, p.display_name, p.specialty, b.name, h.starts_at, h.ends_at
order by p.license_number, b.name, h.starts_at;
