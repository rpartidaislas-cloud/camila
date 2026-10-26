-- Seguridad (auditoría 2026-10-26, S1): el dueño de una clínica podía editar su propia cuota y plan.
--   * La política camila_tenants_update_own permite UPDATE de cualquier columna de su fila, así que un
--     PATCH a /rest/v1/camila_tenants con limite_diagnosticos=999999, activo=true o vence_en=2099
--     saltaba el tope de gasto de IA y el cobro.
--   * La política camila_tenants_insert_own y el trigger de alta aceptaban plan/limite/vencimiento que
--     manda el navegador.
--
-- Corrección:
--   1) Trigger BEFORE INSERT OR UPDATE sobre camila_tenants que, SOLO para quien llega con el rol de
--      cliente de la API (authenticated/anon), protege las columnas de facturación:
--        UPDATE: plan, limite_diagnosticos, diagnosticos_usados, activo, vence_en, stripe_* e id/created_at
--                se conservan; `nombre`, `email` y `config` siguen editables (es lo único que escribe la app).
--        INSERT: el plan debe ser uno canónico (esencial/profesional/premium; cualquier otro -> profesional),
--                el límite sale del plan (15/40/100), usados=0, activo=true, vencimiento <= 1 mes y sin stripe_*.
--      No afecta a service_role (stripe-webhook, funciones), ni a postgres, ni a las funciones
--      SECURITY DEFINER (consumo de cuota en camila_limits.sql, trigger de alta).
--   2) El trigger de alta camila_crear_tenant_en_signup deja de confiar en `plan` y `limite_diagnosticos`
--      del metadato del signup: el plan se valida y el límite sale del plan.
--
-- Decisión de producto que NO cambia aquí: al registrarse se puede elegir cualquier plan (incluido premium)
-- con un mes de prueba, igual que antes. Si no se desea, restringir el plan de entrada a 'profesional'.
begin;

create or replace function public.camila_proteger_cuota_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_limites constant jsonb := '{"esencial":15,"profesional":40,"premium":100}'::jsonb;
begin
  -- Solo se restringe a las peticiones de cliente (PostgREST ejecuta como authenticated/anon).
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.plan is null or not (v_limites ? new.plan) then
      new.plan := 'profesional';
    end if;
    new.limite_diagnosticos := (v_limites ->> new.plan)::integer;
    new.diagnosticos_usados := 0;
    new.activo := true;
    if new.vence_en is null or new.vence_en > now() + interval '32 days' then
      new.vence_en := now() + interval '1 month';
    end if;
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
  else
    new.id := old.id;
    new.plan := old.plan;
    new.limite_diagnosticos := old.limite_diagnosticos;
    new.diagnosticos_usados := old.diagnosticos_usados;
    new.activo := old.activo;
    new.vence_en := old.vence_en;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists camila_proteger_cuota_tenant on public.camila_tenants;
create trigger camila_proteger_cuota_tenant
  before insert or update on public.camila_tenants
  for each row execute function public.camila_proteger_cuota_tenant();

-- Trigger de alta: mismo cuerpo que 20261026210000 (invitación de staff verificada por el servidor)
-- pero con plan y límite saneados.
create or replace function public.camila_crear_tenant_en_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_limites constant jsonb := '{"esencial":15,"profesional":40,"premium":100}'::jsonb;
  -- Un valor que no sea UUID se ignora en vez de abortar el alta con un error de cast.
  tenant_pedido uuid := case
    when meta->>'tenant_id_invitado' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (meta->>'tenant_id_invitado')::uuid
  end;
  v_plan text := case when v_limites ? coalesce(meta->>'plan', '') then meta->>'plan' else 'profesional' end;
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
    v_plan,
    (v_limites ->> v_plan)::integer,
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

commit;
