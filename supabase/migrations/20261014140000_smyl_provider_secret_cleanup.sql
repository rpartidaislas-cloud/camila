-- SMYL security hardening: los secretos de proveedores nunca pertenecen a
-- configuración legible por el navegador. Las Edge Functions los reciben sólo
-- desde Supabase Secrets.
begin;

update public.camila_tenants
set config = coalesce(config, '{}'::jsonb)
  - 'api_key'
  - 'anthropic_api_key'
  - 'openai_api_key'
  - 'gemini_api_key'
  - 'replicate_api_key'
where coalesce(config, '{}'::jsonb) ?| array[
  'api_key', 'anthropic_api_key', 'openai_api_key', 'gemini_api_key', 'replicate_api_key'
];

alter table public.camila_tenants
  drop constraint if exists camila_tenants_config_no_provider_secrets;

alter table public.camila_tenants
  add constraint camila_tenants_config_no_provider_secrets check (
    not (coalesce(config, '{}'::jsonb) ?| array[
      'api_key', 'anthropic_api_key', 'openai_api_key', 'gemini_api_key', 'replicate_api_key'
    ])
  );

commit;
