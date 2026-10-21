-- Búsqueda de pacientes en el servidor para Nueva cita (y futuros selectores).
--
-- Antes la Agenda descargaba a todos los pacientes y filtraba en el navegador; con más
-- de 1000 PostgREST corta la lista en silencio. Esta función busca en la base por
-- nombre, apellido, correo y teléfono, sin distinguir acentos ni mayúsculas.
--
-- SECURITY INVOKER a propósito: la política de lectura de camila_pacientes
-- (patients.read y alcance de datos del rol) sigue decidiendo qué filas ve cada persona.

create or replace function public.smyl_search_patients(
  p_tenant_id uuid,
  p_query text default '',
  p_limit integer default 8
)
returns table (id uuid, nombre text, apellido text, telefono text, email text)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with q as (
    select
      (regexp_split_to_array(
        translate(lower(btrim(coalesce(p_query, ''))), 'áéíóúüñ', 'aeiouun'),
        '\s+'))[1:6] as raw_tokens,
      least(greatest(coalesce(p_limit, 8), 1), 20) as lim,
      -- Un teléfono escrito con espacios, guiones o paréntesis se busca completo, no por trozos.
      case when btrim(coalesce(p_query, '')) ~ '^[0-9\s()+.-]+$'
                and length(regexp_replace(p_query, '\D', '', 'g')) >= 3
           then regexp_replace(p_query, '\D', '', 'g') end as phone_digits
  ), tokens as (
    select coalesce(array_agg(t) filter (where t <> ''), '{}'::text[]) as list
    from q, unnest(q.raw_tokens) as t
  )
  select p.id, p.nombre, p.apellido, p.telefono, p.email
  from public.camila_pacientes p, q, tokens
  where p_tenant_id is not null
    and p.tenant_id = p_tenant_id
    and p_tenant_id = public.smyl_current_tenant()
    and (q.phone_digits is null or regexp_replace(p.telefono, '\D', '', 'g') like '%' || q.phone_digits || '%')
    and (q.phone_digits is not null or not exists (
      select 1 from unnest(tokens.list) as t
      where not (
        translate(lower(concat_ws(' ', p.nombre, p.apellido, p.email)), 'áéíóúüñ', 'aeiouun')
          like '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or (
          length(regexp_replace(t, '\D', '', 'g')) >= 3
          and regexp_replace(p.telefono, '\D', '', 'g') like '%' || regexp_replace(t, '\D', '', 'g') || '%'
        )
      )
    ))
  order by
    case when cardinality(tokens.list) = 0 then p.updated_at end desc nulls last,
    (cardinality(tokens.list) > 0
      and translate(lower(p.nombre), 'áéíóúüñ', 'aeiouun') like replace(replace(replace(tokens.list[1], '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\') desc,
    p.nombre, p.apellido, p.id
  limit (select lim from q)
$$;

revoke all on function public.smyl_search_patients(uuid, text, integer) from public, anon;
grant execute on function public.smyl_search_patients(uuid, text, integer) to authenticated;

comment on function public.smyl_search_patients(uuid, text, integer) is
  'Busca pacientes por nombre, apellido, correo o teléfono sin distinguir acentos. SECURITY INVOKER: respeta RLS y el alcance del rol. Máximo 20 resultados.';
