-- Etapa 1 de infraestructura multi-tenant: los Edge Functions que gastan
-- dinero real (claude/index.ts -> Gemini/Anthropic, segment-teeth ->
-- Replicate) no validaban limite_diagnosticos/diagnosticos_usados en el
-- servidor -- el tope solo existía en el cliente (simulacion.html lo
-- chequea antes de llamar), así que cualquiera que llamara al Edge
-- Function directo (curl, sin pasar por la UI) generaba simulaciones sin
-- ningún tope aunque su plan ya estuviera agotado.
--
-- Además, _shared/auth.ts acepta temporalmente llamadas SIN sesión (pedido
-- explícito del usuario, "no exigir login por lo pronto") -- eso significa
-- que ahora mismo NADIE necesita cuenta para gastar créditos de Gemini/
-- Replicate. Mientras esa puerta siga abierta, se agrega un tope duro por
-- IP/hora como colchón temporal (no reemplaza el login, solo evita que un
-- link compartido genere una factura sin límite).
--
-- Ambas funciones son SECURITY DEFINER para poder hacer el UPDATE atómico
-- con condición (Postgres SÍ permite "columna_a < columna_b" en una sola
-- sentencia SQL, algo que el filtro REST de supabase-js no puede expresar
-- porque solo compara una columna contra un valor literal). Se revoca el
-- EXECUTE de anon/authenticated a propósito: si quedaran expuestas por
-- RPC, cualquier cliente podría llamar camila_consumir_diagnostico con el
-- tenant_id de OTRA clínica (es un parámetro libre) y drenarle su cupo sin
-- haber generado nada real. Solo el service_role (usado por los Edge
-- Functions) puede invocarlas.

create table if not exists public.camila_anon_usage (
  ip text primary key,
  ventana_inicio timestamptz not null default now(),
  contador integer not null default 0
);

alter table public.camila_anon_usage enable row level security;
-- Sin políticas a propósito: solo el service_role (que se salta RLS) la toca.

create or replace function public.camila_consumir_diagnostico(p_tenant_id uuid)
returns table(permitido boolean, motivo text)
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.camila_tenants%rowtype;
begin
  select * into fila from public.camila_tenants where id = p_tenant_id for update;

  if not found then
    return query select false, 'tenant_no_encontrado';
    return;
  end if;

  if not fila.activo then
    return query select false, 'plan_inactivo';
    return;
  end if;

  if fila.vence_en is not null and fila.vence_en < now() then
    return query select false, 'plan_vencido';
    return;
  end if;

  if fila.diagnosticos_usados >= fila.limite_diagnosticos then
    return query select false, 'limite_alcanzado';
    return;
  end if;

  update public.camila_tenants
    set diagnosticos_usados = diagnosticos_usados + 1
    where id = p_tenant_id;

  return query select true, null::text;
end;
$$;

revoke execute on function public.camila_consumir_diagnostico(uuid) from public;
revoke execute on function public.camila_consumir_diagnostico(uuid) from anon;
revoke execute on function public.camila_consumir_diagnostico(uuid) from authenticated;

create or replace function public.camila_anon_rate_check(p_ip text, p_limite integer, p_ventana_seg integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  fila public.camila_anon_usage%rowtype;
begin
  select * into fila from public.camila_anon_usage where ip = p_ip for update;

  if not found then
    insert into public.camila_anon_usage (ip, ventana_inicio, contador) values (p_ip, now(), 1);
    return true;
  end if;

  if now() - fila.ventana_inicio > (p_ventana_seg || ' seconds')::interval then
    update public.camila_anon_usage set ventana_inicio = now(), contador = 1 where ip = p_ip;
    return true;
  end if;

  if fila.contador >= p_limite then
    return false;
  end if;

  update public.camila_anon_usage set contador = contador + 1 where ip = p_ip;
  return true;
end;
$$;

revoke execute on function public.camila_anon_rate_check(text, integer, integer) from public;
revoke execute on function public.camila_anon_rate_check(text, integer, integer) from anon;
revoke execute on function public.camila_anon_rate_check(text, integer, integer) from authenticated;
