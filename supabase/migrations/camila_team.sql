-- Etapa 4 de infraestructura multi-tenant: varios usuarios por clínica
-- (dueño + staff), con permisos distintos. Hasta ahora "tenant" y "usuario
-- logueado" eran la misma fila (camila_tenants.id = auth.uid() del único
-- dueño) -- los planes en app.html ya anunciaban "3 usuarios"/"usuarios
-- ilimitados" pero el backend no tenía ningún concepto de membresía.
--
-- Modelo: camila_usuarios vincula un auth.users a un tenant_id con un rol.
-- El dueño (rol='dueño') sigue siendo la cuenta cuyo id = tenant_id, igual
-- que antes -- eso ya lo garantizan las políticas de camila_tenants sin
-- tocarlas. El staff (rol='staff') son cuentas de auth.users NUEVAS,
-- distintas del dueño, invitadas por correo (ver Edge Function
-- invite-staff) y vinculadas aquí.
--
-- Permisos: el staff puede crear/ver/editar camila_casos de su clínica,
-- pero NUNCA puede escribir en camila_tenants (precios, config, plan)
-- porque esa tabla solo lo permite si id = auth.uid(), y el staff nunca
-- tiene ese id -- no hace falta ninguna política nueva para lograr esa
-- restricción, ya viene gratis del diseño existente. Sí hace falta que el
-- staff pueda LEER camila_tenants (branding/config/límite del plan) de su
-- clínica, cosa que antes no podía porque el SELECT también exigía
-- id = auth.uid() -- se reemplaza por camila_es_miembro() abajo.

create table if not exists public.camila_usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  rol text not null default 'staff' check (rol in ('dueño', 'staff')),
  nombre text,
  email text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.camila_usuarios enable row level security;

-- SECURITY DEFINER a propósito: si las políticas de camila_casos/
-- camila_tenants consultaran camila_usuarios directo, y camila_usuarios a
-- su vez tuviera una política que se autoconsulta, Postgres puede
-- rechazarlo como recursión. Estas dos funciones evitan el problema por
-- completo -- corren "como dueñas de la tabla" (se saltan RLS
-- internamente) y son las únicas que las políticas de otras tablas deben
-- llamar.
create or replace function public.camila_es_dueno(p_tenant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_tenant_id = auth.uid();
$$;

create or replace function public.camila_es_miembro(p_tenant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_tenant_id = auth.uid()
    or exists (
      select 1 from public.camila_usuarios
      where tenant_id = p_tenant_id and id = auth.uid() and activo
    );
$$;

revoke execute on function public.camila_es_dueno(uuid) from public;
grant execute on function public.camila_es_dueno(uuid) to authenticated;
revoke execute on function public.camila_es_miembro(uuid) from public;
grant execute on function public.camila_es_miembro(uuid) to authenticated;

-- Cualquier miembro de la clínica ve a sus compañeros; solo el dueño
-- agrega/edita/quita. El alta real de un invitado ocurre server-side (ver
-- el trigger de abajo) con SECURITY DEFINER, así que no depende de estas
-- políticas -- estas cubren el uso directo desde el cliente, p. ej.
-- desactivar a alguien desde el panel.
create policy camila_usuarios_select_miembros on public.camila_usuarios
  for select to authenticated
  using (camila_es_miembro(tenant_id));

create policy camila_usuarios_insert_dueno on public.camila_usuarios
  for insert to authenticated
  with check (camila_es_dueno(tenant_id));

create policy camila_usuarios_update_dueno on public.camila_usuarios
  for update to authenticated
  using (camila_es_dueno(tenant_id))
  with check (camila_es_dueno(tenant_id));

create policy camila_usuarios_delete_dueno on public.camila_usuarios
  for delete to authenticated
  using (camila_es_dueno(tenant_id));

-- camila_tenants: el dueño sigue siendo el único que puede escribir (no se
-- toca insert/update), pero ahora el staff también necesita LEER su
-- clínica (branding, precios, límite del plan) para que simulacion.html/
-- app.html funcionen con su sesión.
drop policy if exists camila_tenants_select_own on public.camila_tenants;
create policy camila_tenants_select_miembros on public.camila_tenants
  for select to authenticated
  using (camila_es_miembro(id));

-- camila_casos: tenant_id es texto (histórico), no uuid -- se castea, pero
-- NO directo: simulacion.html en modo sin sesión a veces manda literal
-- 'local' (ver CFG.tenantId || 'local' en guardarCaso()), y ese texto no
-- es un uuid válido. Un ::uuid directo en una política revienta la
-- consulta COMPLETA con "invalid input syntax for type uuid" en cuanto
-- toca una fila así -- no solo la descarta, tira todo el SELECT/INSERT/
-- UPDATE para cualquiera. camila_uuid_seguro() devuelve NULL en vez de
-- explotar; una fila con tenant_id inválido simplemente no hace match con
-- nadie (mismo resultado práctico que ya tenía antes de esta migración,
-- cuando la comparación de texto tampoco encontraba dueño para 'local').
create or replace function public.camila_uuid_seguro(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- El staff ahora puede crear/ver/editar los casos de su clínica igual que
-- el dueño. No se agrega política de DELETE -- hoy nadie (ni el dueño)
-- puede borrar un caso vía RLS, y cambiar eso no es parte de esta etapa.
drop policy if exists camila_casos_select_own on public.camila_casos;
create policy camila_casos_select_miembros on public.camila_casos
  for select to authenticated
  using (camila_es_miembro(camila_uuid_seguro(tenant_id)));

drop policy if exists camila_casos_insert_own on public.camila_casos;
create policy camila_casos_insert_miembros on public.camila_casos
  for insert to authenticated
  with check (camila_es_miembro(camila_uuid_seguro(tenant_id)));

drop policy if exists camila_casos_update_own on public.camila_casos;
create policy camila_casos_update_miembros on public.camila_casos
  for update to authenticated
  using (camila_es_miembro(camila_uuid_seguro(tenant_id)))
  with check (camila_es_miembro(camila_uuid_seguro(tenant_id)));

-- Provisioning: reemplaza el trigger de la etapa 2 (mismo nombre de
-- función y trigger, se actualiza en su lugar). Si el signup trae
-- tenant_id_invitado en los metadatos (lo pone la Edge Function
-- invite-staff vía admin.inviteUserByEmail), esta cuenta se une como
-- staff a esa clínica -- NO se crea una clínica nueva para ella. Si no
-- trae ese dato, es un registro normal de dueño: se crea su clínica igual
-- que antes, y además se le da su propia fila en camila_usuarios (rol
-- 'dueño') para que las consultas de "quiénes son mi equipo" lo incluyan.
create or replace function public.camila_crear_tenant_en_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  tenant_invitado uuid := nullif(meta->>'tenant_id_invitado', '')::uuid;
begin
  if tenant_invitado is not null then
    insert into public.camila_usuarios (id, tenant_id, rol, nombre, email, activo)
    values (
      new.id,
      tenant_invitado,
      'staff',
      coalesce(meta->>'nombre', new.email),
      new.email,
      true
    )
    on conflict (id) do nothing;
    return new;
  end if;

  insert into public.camila_tenants (
    id, nombre, email, plan, limite_diagnosticos,
    diagnosticos_usados, activo, vence_en, config
  )
  values (
    new.id,
    coalesce(meta->>'nombre', new.email),
    new.email,
    coalesce(meta->>'plan', 'profesional'),
    coalesce((meta->>'limite_diagnosticos')::integer, 40),
    0,
    true,
    now() + interval '1 month',
    '{}'::jsonb
  )
  on conflict (id) do nothing;

  insert into public.camila_usuarios (id, tenant_id, rol, nombre, email, activo)
  values (new.id, new.id, 'dueño', coalesce(meta->>'nombre', new.email), new.email, true)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists camila_on_auth_user_created on auth.users;
create trigger camila_on_auth_user_created
  after insert on auth.users
  for each row execute function public.camila_crear_tenant_en_signup();

-- Backfill: dueños que ya existían antes de esta migración también deben
-- aparecer en camila_usuarios (para que "mi equipo" los liste), aunque
-- camila_es_dueno/camila_es_miembro ya los reconocían sin esto (primera
-- rama de la función: p_tenant_id = auth.uid()).
insert into public.camila_usuarios (id, tenant_id, rol, nombre, email, activo)
select id, id, 'dueño', nombre, email, true
from public.camila_tenants
on conflict (id) do nothing;
