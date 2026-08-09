-- Hasta ahora la fila de camila_tenants se creaba SOLO desde el cliente
-- (INSERT hecho por el navegador justo después de signUp(), en
-- simulacion.html y app.html). Si ese paso fallaba -- red, tab cerrado, o
-- el caso ya documentado de "confirmación de correo activada" (signUp() no
-- da sesión, así que RLS rechaza el insert hasta el siguiente login) -- el
-- usuario quedaba con cuenta en Supabase Auth pero SIN fila en
-- camila_tenants: sin plan, sin límite, en un estado que el resto del
-- código no maneja bien. app.html tenía un parche para recrear la fila
-- faltante en continuarConUsuario() usando user_metadata, pero
-- simulacion.html no -- un dentista que se registra ahí y nunca visita
-- app.html se quedaba atorado indefinidamente.
--
-- Este trigger reemplaza ese paso frágil por el patrón estándar de
-- Supabase: la fila se crea en el servidor, atómicamente, en el mismo
-- INSERT a auth.users -- ya no depende de que el navegador complete un
-- segundo paso. Los defaults (plan 'profesional', límite 40) igualan los
-- que ya usaba el parche de app.html.
--
-- El INSERT client-side existente en simulacion.html/app.html se deja tal
-- cual -- con este trigger la fila ya va a existir, así que ese insert
-- simplemente no encuentra nada que hacer (choca con la primary key y no
-- pasa nada porque abajo se usa ON CONFLICT DO NOTHING del lado del
-- trigger, y el insert del cliente seguirá fallando por PK duplicada de
-- forma inofensiva -- no se tocó ese código para no arriesgar romper el
-- flujo de UI mientras Codex trabaja en el mismo archivo).
create or replace function public.camila_crear_tenant_en_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
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
  return new;
end;
$$;

drop trigger if exists camila_on_auth_user_created on auth.users;
create trigger camila_on_auth_user_created
  after insert on auth.users
  for each row execute function public.camila_crear_tenant_en_signup();
