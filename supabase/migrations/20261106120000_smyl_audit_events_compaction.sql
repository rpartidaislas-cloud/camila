-- Auditoría del panel admin (2026-11-06): smyl_audit_events guarda el registro completo ANTES/DESPUÉS de cada cambio
-- (~2 KB por evento; tablas con documentos jsonb de hasta 64 KB lo guardan dos veces) y no tenía retención: con 200 clínicas
-- se proyectan 30-50 GB. Esta migración NO borra eventos: «compacta» los que superan 24 meses, vaciando before_data/after_data
-- (lo pesado) y conservando quién, cuándo, qué tabla, qué registro y qué acción — la huella de auditoría sigue completa.
-- La ventana (24 meses por omisión) es una decisión de política: ajústala en el job de pg_cron o llamando la función con
-- otro intervalo. El expediente clínico mismo no se toca (su conservación la rige la NOM-004, no esta tabla).
-- Idempotente. Si pg_cron no está habilitado avisa y no programa nada.

create index if not exists smyl_audit_events_compactable_idx
  on public.smyl_audit_events (created_at)
  where before_data is not null or after_data is not null;

create or replace function public.smyl_compact_audit_events(
  p_older_than interval default interval '24 months',
  p_batch integer default 5000
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_rows integer;
begin
  if p_older_than < interval '6 months' then
    raise exception using errcode = '22023', message = 'La ventana mínima de conservación del detalle de auditoría es de 6 meses.';
  end if;
  if p_batch is null or p_batch < 1 or p_batch > 50000 then
    raise exception using errcode = '22023', message = 'Tamaño de lote inválido.';
  end if;
  update public.smyl_audit_events e
     set before_data = null, after_data = null
   where e.id in (
     select x.id from public.smyl_audit_events x
      where x.created_at < now() - p_older_than
        and (x.before_data is not null or x.after_data is not null)
      order by x.created_at
      limit p_batch
   );
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

revoke all on function public.smyl_compact_audit_events(interval, integer) from public, anon, authenticated;
grant execute on function public.smyl_compact_audit_events(interval, integer) to service_role;

do $$
declare v_job record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron no está habilitado: la compactación de auditoría NO quedó programada. Activa la extensión y vuelve a aplicar esta migración.';
    return;
  end if;
  for v_job in select jobid from cron.job where jobname = 'smyl-compactar-auditoria' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('smyl-compactar-auditoria', '41 3 * * *', $job$select public.smyl_compact_audit_events(interval '24 months', 5000)$job$);
end;
$$;
