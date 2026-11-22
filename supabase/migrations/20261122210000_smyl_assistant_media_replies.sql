-- Biblioteca privada y respuestas sugeridas de SMYL Asistente.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('smyl-assistant-media','smyl-assistant-media',false,16777216,
  array['image/jpeg','image/png','audio/mpeg','audio/mp4','video/mp4'])
on conflict (id) do nothing;

create table public.smyl_media_rules (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  draft jsonb not null,
  revision integer not null default 1,
  tested_revision integer,
  active_version jsonb,
  active_revision integer
);
alter table public.smyl_media_rules enable row level security;
revoke all on public.smyl_media_rules from public, anon, authenticated;
grant select on public.smyl_media_rules to authenticated;
create policy media_rules_owner_read on public.smyl_media_rules for select to authenticated
  using (tenant_id = public.smyl_current_tenant() and tenant_id = auth.uid());
create index smyl_media_rules_by_clinic on public.smyl_media_rules(tenant_id);

create function public.smyl_can_read_assistant_asset(p_path text)
returns boolean language sql stable security definer set search_path = pg_catalog,public as $$
  select split_part(p_path,'/',1)=public.smyl_current_tenant()::text and
    (auth.uid()=public.smyl_current_tenant() or
      (public.smyl_has_permission(public.smyl_current_tenant(),'messages.respond') and exists (
        select 1 from public.smyl_media_rules r where r.tenant_id=public.smyl_current_tenant()
        and r.active_version->>'asset'=p_path)));
$$;
create policy assistant_asset_read on storage.objects for select to authenticated
using (bucket_id='smyl-assistant-media' and public.smyl_can_read_assistant_asset(name));
create policy assistant_asset_upload on storage.objects for insert to authenticated with check (
  bucket_id='smyl-assistant-media' and public.smyl_current_tenant()=auth.uid()
  and split_part(name,'/',1)=auth.uid()::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}~[a-zA-Z0-9._-]{1,120}$');

create function public.smyl_media_words(p_text text) returns text
language sql immutable strict set search_path=pg_catalog as $$
  select btrim(regexp_replace(translate(lower(p_text),'áéíóúüñ','aeiouun'),'[^a-z0-9]+',' ','g'));
$$;
create function public.smyl_media_has_phrase(p_message text,p_phrases jsonb) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
  select exists (select 1 from jsonb_array_elements_text(p_phrases) as term(value)
    where public.smyl_media_words(value) <> '' and strpos(' '||p_message||' ',' '||public.smyl_media_words(value)||' ')>0);
$$;
create function public.smyl_media_applies(p_rule jsonb,p_message text,p_channel text) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
  select p_rule->'channels' ? p_channel
    and public.smyl_media_has_phrase(msg,p_rule->'topics')
    and public.smyl_media_has_phrase(msg,p_rule->'requests')
    and not public.smyl_media_has_phrase(msg,p_rule->'exclude')
  from (select public.smyl_media_words(left(p_message,4000)) as msg) m;
$$;

create function public.smyl_edit_media_rule(p_action text,p_id uuid,p_revision integer,
  p_draft jsonb default null,p_message text default '',p_channel text default 'whatsapp')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  clinic uuid := public.smyl_current_tenant();
  r public.smyl_media_rules;
  k text;
  mime text;
  matches boolean;
begin
  if clinic is null or auth.uid() is distinct from clinic then raise insufficient_privilege; end if;
  if p_action='save' then
    if p_draft is null or jsonb_typeof(p_draft)<>'object' or pg_column_size(p_draft)>20000
      or length(trim(coalesce(p_draft->>'title',''))) not between 1 and 80
      or length(trim(coalesce(p_draft->>'text',''))) not between 1 and 1000 then
      raise exception 'Escribe un título y una respuesta.'; end if;
    foreach k in array array['topics','requests','exclude','channels'] loop
      if coalesce(jsonb_typeof(p_draft->k),'')<>'array' then raise exception 'Revisa las condiciones.'; end if;
      if jsonb_array_length(p_draft->k)>30 or (k<>'exclude' and jsonb_array_length(p_draft->k)=0)
        or exists(select 1 from jsonb_array_elements(p_draft->k) as x(v)
          where jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}')) not between 1 and 80 or public.smyl_media_words(v#>>'{}')='') then
        raise exception 'Revisa las palabras y los canales de la regla.'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements_text(p_draft->'channels') as x(v)
      where v not in ('whatsapp','instagram','messenger')) then raise exception 'Canal desconocido.'; end if;
    if coalesce(p_draft->>'asset','')<>'' then
      select o.metadata->>'mimetype' into mime from storage.objects o where o.bucket_id='smyl-assistant-media'
        and o.name=p_draft->>'asset' and split_part(o.name,'/',1)=clinic::text;
      if mime is null then raise exception 'Selecciona un archivo de esta clínica.'; end if;
      if mime not in ('image/jpeg','image/png','video/mp4','audio/mpeg','audio/mp4') then
        raise exception 'El formato del archivo no es compatible.'; end if;
    end if;
    p_draft := jsonb_build_object('title',trim(p_draft->>'title'),'text',trim(p_draft->>'text'),
      'asset',coalesce(p_draft->>'asset',''),'topics',p_draft->'topics','requests',p_draft->'requests',
      'exclude',p_draft->'exclude','channels',p_draft->'channels');
    if p_revision=0 then
      insert into public.smyl_media_rules(id,tenant_id,draft) values(p_id,clinic,p_draft) returning * into r;
    else
      update public.smyl_media_rules set draft=p_draft,revision=revision+1,tested_revision=null
        where id=p_id and tenant_id=clinic and revision=p_revision returning * into r;
    end if;
  else
    select * into r from public.smyl_media_rules where id=p_id and tenant_id=clinic and revision=p_revision for update;
    if found then
      if p_action='test' then
        if coalesce(r.draft->>'asset','')='' then raise exception 'Elige un archivo para probar.'; end if;
        matches:=public.smyl_media_applies(r.draft,p_message,p_channel);
        if matches then update public.smyl_media_rules set tested_revision=revision where id=r.id returning * into r; end if;
        return jsonb_build_object('rule',to_jsonb(r),'matched',matches);
      elsif p_action='activate' then
        if r.tested_revision is distinct from r.revision then raise exception 'Prueba esta versión con una pregunta que coincida.'; end if;
        update public.smyl_media_rules set active_version=draft,active_revision=revision where id=r.id returning * into r;
      elsif p_action='pause' then
        update public.smyl_media_rules set active_version=null,active_revision=null where id=r.id returning * into r;
      else raise exception 'Acción desconocida.'; end if;
    end if;
  end if;
  if r.id is null then raise exception using errcode='40001',message='La regla cambió. Vuelve a abrirla.'; end if;
  return jsonb_build_object('rule',to_jsonb(r));
end;
$$;
create function public.smyl_suggest_media_reply(p_message text,p_channel text)
returns table(id uuid,title text,reply_text text,asset text)
language sql stable security definer set search_path=pg_catalog,public as $$
  select r.id,r.active_version->>'title',r.active_version->>'text',r.active_version->>'asset'
    from public.smyl_media_rules r where r.tenant_id=public.smyl_current_tenant()
    and public.smyl_has_permission(r.tenant_id,'messages.respond') and r.active_version is not null
    and public.smyl_media_applies(r.active_version,p_message,p_channel) order by r.active_version->>'title',r.id;
$$;
revoke all on function public.smyl_edit_media_rule(text,uuid,integer,jsonb,text,text),public.smyl_suggest_media_reply(text,text),public.smyl_can_read_assistant_asset(text) from public,anon;
grant execute on function public.smyl_edit_media_rule(text,uuid,integer,jsonb,text,text),public.smyl_suggest_media_reply(text,text),public.smyl_can_read_assistant_asset(text) to authenticated;

