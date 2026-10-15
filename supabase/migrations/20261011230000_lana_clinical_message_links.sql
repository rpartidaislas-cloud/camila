-- Etapa 4: referencias clínicas confirmadas desde el Inbox de LANA.
-- No copia el chat ni la URL del adjunto; conserva únicamente la relación
-- auditable con el expediente y el caso canónicos de SMYL.

create table if not exists public.camila_lana_clinical_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  handoff_id uuid not null references public.camila_lana_handoffs(id) on delete cascade,
  lana_conversation_id uuid not null,
  lana_message_id bigint not null check (lana_message_id > 0),
  lana_channel text not null check (lana_channel in ('whatsapp', 'messenger', 'instagram')),
  patient_id uuid not null,
  case_id uuid not null references public.camila_casos(id),
  media_type text not null check (media_type = 'image'),
  status text not null default 'pending_review' check (status in ('pending_review', 'reviewed', 'dismissed')),
  label text not null default 'Fotografía recibida por chat' check (length(label) between 1 and 180),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint camila_lana_clinical_links_patient_fk
    foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id),
  constraint camila_lana_clinical_links_message_key
    unique (tenant_id, lana_conversation_id, lana_message_id)
);

create index if not exists camila_lana_clinical_links_case_idx
  on public.camila_lana_clinical_links(tenant_id, case_id, created_at desc);
alter table public.camila_lana_clinical_links enable row level security;
drop policy if exists camila_lana_clinical_links_read on public.camila_lana_clinical_links;
create policy camila_lana_clinical_links_read on public.camila_lana_clinical_links
  for select to authenticated using (public.camila_es_miembro(tenant_id));
revoke insert, update, delete on public.camila_lana_clinical_links from anon, authenticated;

create or replace function public.camila_vincular_lana_imagen(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_lana_conversation_id uuid,
  p_lana_message_id bigint,
  p_lana_channel text,
  p_label text default 'Fotografía recibida por chat'
)
returns public.camila_lana_clinical_links
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_handoff public.camila_lana_handoffs%rowtype;
  v_link public.camila_lana_clinical_links%rowtype;
begin
  if p_lana_message_id is null or p_lana_message_id <= 0
     or p_lana_channel not in ('whatsapp', 'messenger', 'instagram') then
    raise exception 'INVALID_LANA_CLINICAL_LINK';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_lana_conversation_id::text || ':' || p_lana_message_id::text, 0
  ));
  select * into v_handoff from public.camila_lana_handoffs h
  where h.tenant_id = p_tenant_id and h.lana_conversation_id = p_lana_conversation_id;
  if not found then raise exception 'LANA_HANDOFF_REQUIRED'; end if;
  if v_handoff.lana_channel <> p_lana_channel then raise exception 'LANA_CHANNEL_MISMATCH'; end if;

  insert into public.camila_lana_clinical_links(
    tenant_id, handoff_id, lana_conversation_id, lana_message_id,
    lana_channel, patient_id, case_id, media_type, label, created_by
  ) values (
    p_tenant_id, v_handoff.id, p_lana_conversation_id, p_lana_message_id,
    p_lana_channel, v_handoff.patient_id, v_handoff.case_id, 'image',
    left(coalesce(nullif(trim(p_label), ''), 'Fotografía recibida por chat'), 180), p_actor_id
  )
  on conflict (tenant_id, lana_conversation_id, lana_message_id)
  do update set updated_at = camila_lana_clinical_links.updated_at
  returning * into v_link;
  return v_link;
end;
$function$;

revoke all on function public.camila_vincular_lana_imagen(uuid, uuid, uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.camila_vincular_lana_imagen(uuid, uuid, uuid, bigint, text, text)
  to service_role;

