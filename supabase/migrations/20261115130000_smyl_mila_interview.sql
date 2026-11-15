-- MILA · Entrevista de historia clínica y dictado de exploración desde el celular (QR).
--
-- Flujo: la computadora del dentista crea una sesión ligada a un paciente y muestra un QR con un
-- token de un solo uso. El celular lo escanea, queda vinculado (secreto de dispositivo), registra
-- el consentimiento del paciente y sube segmentos de audio. La Edge Function `mila-interview`
-- transcribe, interpreta con IA y guarda SÓLO EL BORRADOR temporal aquí hasta que el dentista lo
-- revisa en la computadora. El audio nunca se guarda. Al aplicar o descartar, la transcripción y el
-- resultado se borran; las sesiones vencidas se purgan.
--
-- Solo la Edge Function (service role) lee y escribe. Ningún usuario tiene acceso directo.

create table if not exists public.smyl_mila_interviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  created_by uuid not null,
  pair_token_hash text not null check (char_length(pair_token_hash) = 64),
  device_hash text check (device_hash is null or char_length(device_hash) = 64),
  status text not null default 'waiting'
    check (status in ('waiting', 'paired', 'closed')),
  consent_at timestamptz,
  transcript_history text not null default '' check (char_length(transcript_history) <= 60000),
  transcript_exam text not null default '' check (char_length(transcript_exam) <= 60000),
  result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 262144),
  segments integer not null default 0 check (segments >= 0 and segments <= 400),
  audio_seconds integer not null default 0 check (audio_seconds >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  busy_until timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists smyl_mila_interviews_tenant_patient_idx
  on public.smyl_mila_interviews (tenant_id, patient_id, created_at desc);
create index if not exists smyl_mila_interviews_expires_idx
  on public.smyl_mila_interviews (expires_at);

alter table public.smyl_mila_interviews enable row level security;
revoke all on public.smyl_mila_interviews from public, anon, authenticated;
-- Sin políticas: solo la Edge Function con service role.

comment on table public.smyl_mila_interviews is
  'Borrador temporal de la entrevista MILA (QR + celular). Sin audio. Se vacía al aplicar/descartar y se purga al vencer.';

-- Tokens reales por segmento en el registro de consumo de IA.
alter table public.smyl_ai_usage_log drop constraint if exists smyl_ai_usage_log_feature_check;
alter table public.smyl_ai_usage_log add constraint smyl_ai_usage_log_feature_check
  check (feature in ('radiograph_analysis', 'radiograph_toothmap', 'clinical_photo_analysis',
                     'mila_history_interview', 'mila_exam_dictation'));

-- Resumen de la entrevista MILA para la pantalla de Consumo (solo quien administra la clínica).
create or replace function public.smyl_mila_interview_usage_summary(p_days integer default 30)
returns table (
  sessions bigint,
  segments bigint,
  audio_minutes numeric,
  input_tokens bigint,
  output_tokens bigint,
  avg_tokens_per_session numeric,
  total_cost_usd numeric,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinic.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para ver el consumo de IA.';
  end if;

  return query
  with l as (
    select split_part(coalesce(u.request_id, u.id::text), ':', 1) as session_key, u.*
    from public.smyl_ai_usage_log u
    where u.tenant_id = v_tenant
      and u.feature in ('mila_history_interview', 'mila_exam_dictation')
      and u.created_at >= now() - make_interval(days => v_days)
  ), s as (
    select session_key, sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) as tokens
    from l group by session_key
  )
  select (select count(*) from s)::bigint,
         count(*)::bigint,
         round(coalesce(sum(l.duration_ms), 0) / 60000.0, 1),
         coalesce(sum(l.input_tokens), 0)::bigint,
         coalesce(sum(l.output_tokens), 0)::bigint,
         (select round(avg(s.tokens), 0) from s),
         round(coalesce(sum(l.estimated_cost_usd), 0), 4),
         max(l.created_at)
  from l;
end;
$$;

revoke all on function public.smyl_mila_interview_usage_summary(integer) from public, anon;
grant execute on function public.smyl_mila_interview_usage_summary(integer) to authenticated;
