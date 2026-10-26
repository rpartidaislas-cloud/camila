-- Seguridad (auditoría 2026-10-26, P0-3): la vista pública camila_tenants_publico exponía a `anon`
-- TODO `config` de cada clínica, incluido `config.integraciones.lana` (clave de LANA cifrada).
-- Los únicos consumidores (simulacion.html y simulacion-rapida.html, modo prospecto) leen
-- `config.sim` (marca) y `config.precios` (precios). La vista ahora entrega solo esas dos llaves.
--
-- Mismas columnas y tipos que antes (id, nombre, config jsonb), así que `create or replace` es
-- compatible y no rompe a los clientes. Residual conocido: la vista sigue permitiendo listar
-- id+nombre de las clínicas activas; ya no sirve para tomar un UUID y colarse como staff porque
-- el alta de staff exige una invitación del servidor (migración 20261026210000).
begin;

create or replace view public.camila_tenants_publico as
select
  id,
  nombre,
  jsonb_strip_nulls(jsonb_build_object(
    'sim', config -> 'sim',
    'precios', config -> 'precios'
  )) as config
from public.camila_tenants
where activo = true;

grant select on public.camila_tenants_publico to anon, authenticated;

commit;
