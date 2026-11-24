-- SMYL · Precios de proveedores y costo estimado por operación de IA / MILA (INTERNO de SMYL).
--
-- Para qué: hoy 1 «crédito de IA» = 1 operación sin importar el modelo (una simulación con imagen vale lo mismo que reescribir un
-- mensaje). Aquí se define con qué precios de proveedor se calcula el COSTO REAL y cuántos créditos debería valer cada operación.
--
-- Qué agrega (aditivo; no toca carteras, planes ni Edge Functions existentes):
--   1. smyl_provider_prices   precio por métrica de cada modelo (tokens, imágenes, audio) con vigencia. price NULL = «pendiente de capturar».
--   2. smyl_cost_settings     tipo de cambio USD→MXN, margen de seguridad y cuánto costo real vale 1 crédito.
--   3. smyl_ai_operations     las operaciones que cobran créditos o segundos (source_type) y lo que consume cada una (supuestos editables).
--   4. smyl_price_per_unit_mxn / smyl_operation_cost_mxn / vista smyl_operation_costs: costo en pesos y créditos sugeridos.
-- NADA de esto lo ve ni lo edita una clínica: solo el rol de servicio y quien administra la base (SQL Editor).
-- Los precios NO vienen cargados: se capturan desde el panel de cada proveedor (ver docs/COSTOS_Y_PRECIOS_IA.md).

begin;

create table if not exists public.smyl_provider_prices (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'facturapi', 'supabase', 'other')),
  model text not null check (char_length(model) between 1 and 120),
  metric text not null check (metric in ('input_tokens', 'cached_input_tokens', 'output_tokens', 'image', 'audio_seconds', 'request')),
  per_units numeric not null default 1 check (per_units > 0),
  price numeric(18, 8) check (price is null or price >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'MXN')),
  effective_from date not null default current_date,
  note text check (note is null or char_length(note) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, model, metric, effective_from)
);
comment on table public.smyl_provider_prices is 'Precio del proveedor por «per_units» de la métrica (ej. 1,000,000 input_tokens, 60 audio_seconds = 1 minuto). price NULL = pendiente.';

create table if not exists public.smyl_cost_settings (
  id boolean primary key default true check (id),
  fx_usd_mxn numeric(10, 4) check (fx_usd_mxn is null or fx_usd_mxn > 0),
  fx_buffer_pct numeric(5, 2) not null default 8 check (fx_buffer_pct between 0 and 100),
  credit_value_mxn numeric(10, 4) not null default 0.50 check (credit_value_mxn > 0),
  target_multiplier numeric(6, 2) not null default 3 check (target_multiplier >= 1),
  updated_at timestamptz not null default now()
);
comment on column public.smyl_cost_settings.credit_value_mxn is 'Costo real en MXN que equivale a 1 crédito de IA. Una operación vale ceil(costo / este valor) créditos.';
comment on column public.smyl_cost_settings.target_multiplier is 'Cuántas veces el costo se quiere cobrar (referencia para precios de paquetes; timbres hoy: 1.80 / 0.60 = 3).';
insert into public.smyl_cost_settings(id) values (true) on conflict (id) do nothing;

create table if not exists public.smyl_ai_operations (
  operation text primary key check (operation ~ '^[a-z0-9_]{2,60}$'),
  label text not null check (char_length(label) between 1 and 120),
  kind text not null check (kind in ('ai', 'mila')),
  components jsonb not null default '[]'::jsonb check (jsonb_typeof(components) = 'array'),
  quantities_source text not null default 'supuesto' check (quantities_source in ('supuesto', 'medido')),
  note text check (note is null or char_length(note) <= 400),
  updated_at timestamptz not null default now()
);
comment on column public.smyl_ai_operations.components is 'Lista de {provider, model, metric, quantity}: lo que consume UNA operación. Hasta medirlo (quantities_source = medido) son supuestos a reemplazar.';

alter table public.smyl_provider_prices enable row level security;
alter table public.smyl_cost_settings enable row level security;
alter table public.smyl_ai_operations enable row level security;
revoke all on public.smyl_provider_prices, public.smyl_cost_settings, public.smyl_ai_operations from public, anon, authenticated;
grant select, insert, update, delete on public.smyl_provider_prices, public.smyl_cost_settings, public.smyl_ai_operations to service_role;

-- Precio vigente de UNA unidad de la métrica, en MXN con tipo de cambio y margen de seguridad. NULL si falta el precio (o el tipo de cambio en USD).
create or replace function public.smyl_price_per_unit_mxn(p_provider text, p_model text, p_metric text, p_at date default current_date)
returns numeric
language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v_row public.smyl_provider_prices%rowtype;
  v_cfg public.smyl_cost_settings%rowtype;
begin
  select * into v_row from public.smyl_provider_prices
   where provider = p_provider and model = p_model and metric = p_metric and effective_from <= p_at
   order by effective_from desc limit 1;
  if not found or v_row.price is null then return null; end if;
  if v_row.currency = 'MXN' then return v_row.price / v_row.per_units; end if;
  select * into v_cfg from public.smyl_cost_settings where id;
  if v_cfg.fx_usd_mxn is null then return null; end if;
  return (v_row.price / v_row.per_units) * v_cfg.fx_usd_mxn * (1 + v_cfg.fx_buffer_pct / 100);
end;
$$;

-- Costo estimado de UNA operación según sus componentes. complete = false si falta algún precio; missing lista cuáles.
create or replace function public.smyl_operation_cost_mxn(p_operation text, p_at date default current_date)
returns table (operation text, label text, cost_mxn numeric, complete boolean, missing text[], credits_suggested integer)
language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare
  v_op public.smyl_ai_operations%rowtype;
  v_c jsonb;
  v_unit numeric;
  v_total numeric := 0;
  v_missing text[] := '{}';
  v_credit numeric;
begin
  select * into v_op from public.smyl_ai_operations o where o.operation = p_operation;
  if not found then return; end if;
  for v_c in select * from jsonb_array_elements(v_op.components) loop
    v_unit := public.smyl_price_per_unit_mxn(v_c->>'provider', v_c->>'model', v_c->>'metric', p_at);
    if v_unit is null then
      v_missing := v_missing || ((v_c->>'provider') || '/' || (v_c->>'model') || '/' || (v_c->>'metric'));
    else
      v_total := v_total + v_unit * coalesce((v_c->>'quantity')::numeric, 0);
    end if;
  end loop;
  select credit_value_mxn into v_credit from public.smyl_cost_settings where id;
  operation := v_op.operation; label := v_op.label; missing := v_missing; complete := coalesce(array_length(v_missing, 1), 0) = 0;
  cost_mxn := case when complete then round(v_total, 4) else null end;
  credits_suggested := case when complete then greatest(1, ceil(v_total / v_credit))::integer else null end;
  return next;
end;
$$;

create or replace view public.smyl_operation_costs as
  select c.* from public.smyl_ai_operations o, lateral public.smyl_operation_cost_mxn(o.operation) c order by o.kind, o.operation;
revoke all on public.smyl_operation_costs from public, anon, authenticated;
grant select on public.smyl_operation_costs to service_role;
revoke all on function public.smyl_price_per_unit_mxn(text, text, text, date), public.smyl_operation_cost_mxn(text, date) from public, anon, authenticated;
grant execute on function public.smyl_price_per_unit_mxn(text, text, text, date), public.smyl_operation_cost_mxn(text, date) to service_role;

-- Modelos que el código usa hoy (tomados de las Edge Functions). Precios EN BLANCO: se capturan desde el panel de cada proveedor.
insert into public.smyl_provider_prices(provider, model, metric, per_units, currency, note) values
  ('openai', 'gpt-image-2-2026-04-21', 'image', 1, 'USD', 'Simulación de sonrisa (analizar-foto) y segmentación. Precio por imagen generada (depende de tamaño/calidad).'),
  ('openai', 'gpt-4o', 'input_tokens', 1000000, 'USD', 'Análisis de la foto (analizar-foto).'),
  ('openai', 'gpt-4o', 'output_tokens', 1000000, 'USD', null),
  ('openai', 'gpt-5-mini', 'input_tokens', 1000000, 'USD', 'Resumen periodontal, notas y reescritura de mensajes.'),
  ('openai', 'gpt-5-mini', 'output_tokens', 1000000, 'USD', null),
  ('openai', 'gpt-transcribe', 'audio_seconds', 60, 'USD', 'Transcripción de MILA. Precio por minuto de audio.'),
  ('openai', 'gpt-realtime-2.1', 'audio_seconds', 60, 'USD', 'MILA en tiempo real / entrevista. Precio por minuto de audio (entrada).'),
  ('anthropic', 'claude-sonnet-4-6', 'input_tokens', 1000000, 'USD', 'Extracción fiscal (constancia / CSF).'),
  ('anthropic', 'claude-sonnet-4-6', 'output_tokens', 1000000, 'USD', null),
  ('anthropic', 'claude-opus-4-5', 'input_tokens', 1000000, 'USD', 'Lectura de radiografías.'),
  ('anthropic', 'claude-opus-4-5', 'output_tokens', 1000000, 'USD', null)
on conflict (provider, model, metric, effective_from) do nothing;

-- Operaciones que hoy cobran un crédito o segundos de MILA. Las cantidades son SUPUESTOS INICIALES: se reemplazan por promedios medidos.
insert into public.smyl_ai_operations(operation, label, kind, components, quantities_source, note) values
  ('analizar_foto', 'Simulación de sonrisa con foto', 'ai',
    '[{"provider":"openai","model":"gpt-image-2-2026-04-21","metric":"image","quantity":1},{"provider":"openai","model":"gpt-4o","metric":"input_tokens","quantity":2500},{"provider":"openai","model":"gpt-4o","metric":"output_tokens","quantity":600}]'::jsonb,
    'supuesto', 'Hoy cobra 1 crédito (analizar-foto).'),
  ('fiscal_extract', 'Lectura de constancia fiscal', 'ai',
    '[{"provider":"anthropic","model":"claude-sonnet-4-6","metric":"input_tokens","quantity":3000},{"provider":"anthropic","model":"claude-sonnet-4-6","metric":"output_tokens","quantity":500}]'::jsonb,
    'supuesto', 'Hoy cobra 1 crédito (fiscal-extract y facturapi).'),
  ('periodontal_summary', 'Resumen periodontal', 'ai',
    '[{"provider":"openai","model":"gpt-5-mini","metric":"input_tokens","quantity":1500},{"provider":"openai","model":"gpt-5-mini","metric":"output_tokens","quantity":400}]'::jsonb,
    'supuesto', 'Hoy cobra 1 crédito (periodontal-summary).'),
  ('message_rewrite', 'Reescritura de mensaje con IA', 'ai',
    '[{"provider":"openai","model":"gpt-5-mini","metric":"input_tokens","quantity":600},{"provider":"openai","model":"gpt-5-mini","metric":"output_tokens","quantity":200}]'::jsonb,
    'supuesto', 'Hoy cobra 1 crédito (lana-inbox).'),
  ('radiograph_analysis', 'Lectura de radiografía con IA', 'ai',
    '[{"provider":"anthropic","model":"claude-opus-4-5","metric":"input_tokens","quantity":6000},{"provider":"anthropic","model":"claude-opus-4-5","metric":"output_tokens","quantity":1500}]'::jsonb,
    'supuesto', 'Se mide aparte (smyl_ai_usage_summary).'),
  ('mila_minute', 'Un minuto de MILA (transcripción + nota)', 'mila',
    '[{"provider":"openai","model":"gpt-transcribe","metric":"audio_seconds","quantity":60},{"provider":"openai","model":"gpt-5-mini","metric":"input_tokens","quantity":900},{"provider":"openai","model":"gpt-5-mini","metric":"output_tokens","quantity":300}]'::jsonb,
    'supuesto', 'MILA se mide en segundos de audio; esto es el costo de 60 segundos.')
on conflict (operation) do nothing;

commit;
