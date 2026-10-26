-- Seguridad (auditoría 2026-10-26, P0-1): el trigger camila_crear_tenant_en_signup tomaba
-- `tenant_id_invitado` de raw_user_meta_data, un dato que manda el propio navegador en
-- `signUp({ options: { data } })`. Cualquiera podía darse de alta como staff de CUALQUIER clínica
-- conociendo su UUID.
--
-- Ahora el vínculo staff<->clínica solo se concede si existe una invitación vigente creada por el
-- servidor (Edge Function invite-staff, con service role) para ese correo y esa clínica. La tabla
-- camila_invitaciones no tiene políticas: anon/authenticated no pueden leerla ni escribirla.
-- Un metadato sin invitación se ignora y la cuenta se trata como un registro normal de dueño.
--
-- ORDEN DE DESPLIEGUE: aplicar esta migración y desplegar enseguida invite-staff (que crea la
-- invitación). Entre ambos pasos, una invitación enviada por la versión vieja de invite-staff
-- crearía una clínica nueva para la persona invitada en vez de unirla al equipo (no es una fuga).
begin;

create table if not exists public.camila_invitaciones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  email text not null check (email = lower(email)),
  nombre text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  consumed_at timestamptz,
  consumed_by uuid
);

create unique index if not exists camila_invitaciones_pendiente_uidx
  on public.camila_invitaciones (tenant_id, email) where consumed_at is null;
create index if not exists camila_invitaciones_email_idx
  on public.camila_invitaciones (email) where consumed_at is null;

alter table public.camila_invitaciones enable row level security;
revoke all on public.camila_invitaciones from public, anon, authenticated;

create or replace function public.camila_crear_tenant_en_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  -- Un valor que no sea UUID se ignora en vez de abortar el alta con un error de cast.
  tenant_pedido uuid := case
    when meta->>'tenant_id_invitado' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (meta->>'tenant_id_invitado')::uuid
  end;
  invitacion_id uuid;
begin
  if tenant_pedido is not null and new.email is not null then
    select i.id into invitacion_id
    from public.camila_invitaciones i
    where i.tenant_id = tenant_pedido
      and i.email = lower(new.email)
      and i.consumed_at is null
      and i.expires_at > now()
    order by i.created_at desc
    limit 1
    for update;

    if invitacion_id is not null then
      update public.camila_invitaciones
         set consumed_at = now(), consumed_by = new.id
       where id = invitacion_id;

      insert into public.camila_usuarios (id, tenant_id, rol, nombre, email, activo)
      values (
        new.id,
        tenant_pedido,
        'staff',
        coalesce(meta->>'nombre', new.email),
        new.email,
        true
      )
      on conflict (id) do nothing;
      return new;
    end if;
    -- Sin invitación vigente: el metadato se ignora y sigue el alta normal de dueño.
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

-- El trigger camila_on_auth_user_created ya apunta a esta función (por nombre): no hay que recrearlo.

commit;
