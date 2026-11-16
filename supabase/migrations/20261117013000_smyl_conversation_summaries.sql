-- Resumen de conversación del chat (Ficha 360) guardado en el servidor.
-- Lo genera SMYL Copilot (LANA) y lo guarda lana-inbox para que el equipo lo vea sin volver a pedirlo.
--
-- Acceso: SOLO a través de la edge function lana-inbox (service_role), que antes valida
-- messages.read / messages.respond y canAccessConversation. La tabla no tiene políticas ni permisos
-- para anon/authenticated: el navegador nunca la lee ni la escribe directamente.
--
-- includes_clinical separa el resumen generado con contexto clínico (score, simulación, cotización)
-- del que no lo tiene: quien no tiene clinical.read solo recibe el de includes_clinical = false.
-- Se guarda solo el último resumen de cada alcance (sin historial).

begin;

create table if not exists public.smyl_conversation_summaries (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  lana_conversation_id uuid not null,
  includes_clinical boolean not null default false,
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 16384),
  basis_at timestamptz,
  generated_by uuid references auth.users(id) on delete set null,
  generated_by_name text not null default '' check (char_length(generated_by_name) <= 120),
  generated_at timestamptz not null default now(),
  primary key (tenant_id, lana_conversation_id, includes_clinical)
);

comment on table public.smyl_conversation_summaries is 'Último resumen de SMYL Copilot por conversación del chat y alcance (con o sin contexto clínico). Solo lo lee y escribe lana-inbox.';
comment on column public.smyl_conversation_summaries.summary is 'summary, next_step, open_questions[], unconfirmed_facts[], requires_human tal como los devuelve Copilot (saneados).';
comment on column public.smyl_conversation_summaries.basis_at is 'last_message_at de la conversación cuando se generó; si cambió, el resumen quedó viejo.';

alter table public.smyl_conversation_summaries enable row level security;
revoke all on table public.smyl_conversation_summaries from public, anon, authenticated;
grant select, insert, update, delete on table public.smyl_conversation_summaries to service_role;

commit;
