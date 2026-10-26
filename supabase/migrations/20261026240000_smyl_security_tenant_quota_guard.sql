-- Seguridad S1: impide que el cliente edite cuota, plan, estado, vencimiento
-- o referencias de Stripe. Service role, postgres y funciones SECURITY DEFINER
-- conservan sus operaciones internas.
begin;

create or replace function public.camila_proteger_cuota_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_limites constant jsonb := '{"esencial":15,"profesional":40,"premium":100}'::jsonb;
begin
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

commit;
