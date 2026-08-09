-- Etapa 6: modo "prospecto" en simulacion.html -- un paciente potencial,
-- sin cuenta, entra por un link público de una clínica específica
-- (simulacion.html?clinica=<tenant_id>, compartido desde app.html) y hace
-- la simulación por su cuenta, desde su casa, como gancho de marketing.
--
-- Dos huecos de RLS que había que cerrar a propósito, ninguno abriendo la
-- puerta de más de lo necesario:
--
-- 1. Un visitante sin sesión no podía leer NADA de camila_tenants (RLS
--    exige ser miembro) -- sin esto, el link no podría mostrar ni el
--    nombre de la clínica ni sus precios reales. Se resuelve con una
--    VISTA que expone SOLO nombre+config (nunca email/plan/
--    diagnosticos_usados/stripe_*) a cualquiera -- camila_tenants en sí
--    sigue completamente protegida, esto no la toca.
--
-- 2. Un visitante sin sesión tampoco podía escribir en camila_casos (RLS
--    exige ser miembro) -- el lead de un prospecto se habría perdido en
--    silencio. Se resuelve con la Edge Function guardar-lead-prospecto
--    (service role, valida que el tenant_id sea real/activo antes de
--    insertar) -- NO se abre una política de INSERT para "anon" en
--    camila_casos, que ya tuvo un episodio real de RLS abierta
--    ("camila_casos_abierto_temporal", ver docs/HANDOFF.md) y no vale la
--    pena repetir ese riesgo por esta función.

-- Vista pública de marca/precios -- por diseño de Postgres, una vista
-- corre con los privilegios de quien la CREA (aquí, el rol que aplica la
-- migración), no de quien la consulta -- por eso puede exponer estas dos
-- columnas a "anon" sin necesitar (ni querer) una política RLS abierta en
-- camila_tenants misma. activo=true evita mostrar precios/marca de una
-- clínica dada de baja.
create or replace view public.camila_tenants_publico as
select id, nombre, config
from public.camila_tenants
where activo = true;

grant select on public.camila_tenants_publico to anon, authenticated;

-- Marca los casos creados por un prospecto desde el link público (vs. los
-- que crea el propio dentista/staff en consulta) -- para que app.html
-- pueda mostrarlos distinto en Historial/Pacientes si se quiere más
-- adelante. Aditiva, no rompe nada de lo que ya existe en la tabla.
alter table if exists public.camila_casos
  add column if not exists es_prospecto boolean not null default false;
