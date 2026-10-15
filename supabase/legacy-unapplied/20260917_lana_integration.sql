-- Integración bidireccional SMYL <-> LANA.
--
-- 1) Relaciona los casos interactivos de SMYL con una cita de LANA.
-- 2) Reserva y persiste los análisis asíncronos de fotografías recibidas por
--    WhatsApp o Instagram antes de llamar a OpenAI.

alter table if exists public.camila_casos
  add column if not exists lana_cita_id bigint,
  add column if not exists lana_origen text,
  add column if not exists lana_webhook_estado text,
  add column if not exists lana_webhook_intentos integer not null default 0,
  add column if not exists lana_webhook_ultimo_error text,
  add column if not exists lana_webhook_enviado_at timestamptz;

do $$ begin
  alter table public.camila_casos
    add constraint camila_casos_lana_origen_check
    check (lana_origen is null or lana_origen in ('lana', 'whatsapp', 'instagram'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.camila_casos
    add constraint camila_casos_lana_cita_id_check
    check (lana_cita_id is null or lana_cita_id > 0);
exception when duplicate_object then null;
end $$;

create index if not exists camila_casos_lana_cita_idx
  on public.camila_casos (tenant_id, lana_cita_id)
  where lana_cita_id is not null;

create table if not exists public.smyl_analisis_fotos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  cita_id bigint,
  paciente_nombre text not null,
  paciente_telefono text not null,
  origen text not null,
  imagen_original_url text not null,
  imagen_simulacion_url text,
  diagnostico text,
  tratamientos_sugeridos jsonb not null default '[]'::jsonb,
  zona_afectada text,
  requiere_consulta_urgente boolean,
  estado text not null default 'pendiente',
  error_procesamiento text,
  gpt_model text,
  gpt_response_id text,
  idempotency_key text,
  webhook_estado text not null default 'pendiente',
  webhook_intentos integer not null default 0,
  webhook_ultimo_error text,
  webhook_enviado_at timestamptz,
  created_at timestamptz not null default now(),
  procesado_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint smyl_analisis_fotos_cita_check check (cita_id is null or cita_id > 0),
  constraint smyl_analisis_fotos_origen_check check (origen in ('whatsapp', 'instagram')),
  constraint smyl_analisis_fotos_estado_check check (estado in ('pendiente', 'procesando', 'completado', 'error')),
  constraint smyl_analisis_fotos_webhook_check check (webhook_estado in ('pendiente', 'enviando', 'enviado', 'error')),
  constraint smyl_analisis_fotos_tratamientos_array check (jsonb_typeof(tratamientos_sugeridos) = 'array')
);

create unique index if not exists smyl_analisis_fotos_idempotencia_idx
  on public.smyl_analisis_fotos (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists smyl_analisis_fotos_tenant_fecha_idx
  on public.smyl_analisis_fotos (tenant_id, created_at desc);

create index if not exists smyl_analisis_fotos_cita_idx
  on public.smyl_analisis_fotos (tenant_id, cita_id)
  where cita_id is not null;

alter table public.smyl_analisis_fotos enable row level security;

drop policy if exists smyl_analisis_fotos_select_miembros on public.smyl_analisis_fotos;
create policy smyl_analisis_fotos_select_miembros on public.smyl_analisis_fotos
  for select to authenticated
  using (public.camila_es_miembro(tenant_id));

drop policy if exists smyl_analisis_fotos_update_miembros on public.smyl_analisis_fotos;
create policy smyl_analisis_fotos_update_miembros on public.smyl_analisis_fotos
  for update to authenticated
  using (public.camila_es_miembro(tenant_id))
  with check (public.camila_es_miembro(tenant_id));

comment on table public.smyl_analisis_fotos is
  'Análisis dentales asíncronos recibidos desde LANA por WhatsApp o Instagram.';

