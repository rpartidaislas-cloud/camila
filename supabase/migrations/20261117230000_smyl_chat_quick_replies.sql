-- Respuestas reutilizables del equipo. La clínica se toma de la sesión.
create table if not exists public.smyl_chat_quick_replies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  shortcut text not null check (shortcut ~ '^[a-z0-9_-]{1,40}$'),
  text text not null check (char_length(btrim(text)) between 1 and 4000),
  version integer not null default 1,
  unique (tenant_id, shortcut)
);
alter table public.smyl_chat_quick_replies enable row level security;
revoke all on public.smyl_chat_quick_replies from public, anon, authenticated;

create or replace function public.smyl_list_quick_replies()
returns table(id uuid, shortcut text, text text, version integer)
language sql stable security definer set search_path = pg_catalog, public as $$
  select q.id, q.shortcut, q.text, q.version
  from public.smyl_chat_quick_replies q
  where q.tenant_id = public.smyl_current_tenant()
    and public.smyl_has_permission(q.tenant_id, 'messages.read')
  order by q.shortcut;
$$;

create or replace function public.smyl_save_quick_reply(p_id uuid, p_shortcut text, p_text text, p_version integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  clinic uuid := public.smyl_current_tenant();
  reply public.smyl_chat_quick_replies;
begin
  if clinic is null or not coalesce(public.smyl_has_permission(clinic, 'messages.manage'), false) then
    raise insufficient_privilege;
  end if;
  if coalesce(p_shortcut, '') !~ '^[a-z0-9_-]{1,40}$' or char_length(btrim(coalesce(p_text,''))) not between 1 and 4000 then
    raise exception using errcode = '22023', message = 'Revisa el atajo y el mensaje.';
  end if;
  if p_id is null then
    insert into public.smyl_chat_quick_replies (tenant_id, shortcut, text)
    values (clinic, p_shortcut, btrim(p_text)) returning * into reply;
  else
    update public.smyl_chat_quick_replies q
      set shortcut = p_shortcut, text = btrim(p_text), version = q.version + 1
      where q.tenant_id = clinic and q.id = p_id and q.version = p_version
      returning * into reply;
    if not found then raise exception using errcode = '40001', message = 'La respuesta cambió.'; end if;
  end if;
  return jsonb_build_object('id', reply.id, 'shortcut', reply.shortcut, 'text', reply.text, 'version', reply.version);
end;
$$;

create or replace function public.smyl_delete_quick_reply(p_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare clinic uuid := public.smyl_current_tenant();
begin
  if clinic is null or not coalesce(public.smyl_has_permission(clinic, 'messages.manage'), false) then
    raise insufficient_privilege;
  end if;
  delete from public.smyl_chat_quick_replies q where q.tenant_id = clinic and q.id = p_id and q.version = p_version;
  if not found then raise exception using errcode = '40001', message = 'La respuesta cambió.'; end if;
end;
$$;
revoke all on function public.smyl_list_quick_replies(), public.smyl_save_quick_reply(uuid,text,text,integer), public.smyl_delete_quick_reply(uuid,integer) from public, anon;
grant execute on function public.smyl_list_quick_replies(), public.smyl_save_quick_reply(uuid,text,text,integer), public.smyl_delete_quick_reply(uuid,integer) to authenticated;
