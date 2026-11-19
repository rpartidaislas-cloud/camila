-- Correcciones de la revisión del 2026-11-19 (cobro en línea y propuesta compartida).
--  1. Un solo enlace de pago pendiente por paciente: cierra la carrera de dos «crear enlace» simultáneos (el paciente podría
--     pagar dos veces el mismo saldo).
--  2. Retención de las copias de propuestas compartidas: el aviso de privacidad no puede prometer menos de lo que hace el
--     sistema. Se borran las copias NO aceptadas 90 días después de vencer o cancelarse (la fotografía vive en el expediente,
--     no se duplica). Las aceptadas se conservan: pasan a ser parte del registro de atención. El plazo es PROVISIONAL, lo fija
--     el abogado. Programada una vez al día con pg_cron; no falla si pg_cron no está habilitado.
begin;

create unique index if not exists smyl_payment_links_one_pending_idx
  on public.smyl_payment_links (tenant_id, patient_id) where status = 'pending';

create or replace function public.smyl_purge_expired_proposal_shares(p_limit integer default 1000)
returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_deleted integer;
begin
  with doomed as (
    select id from public.smyl_proposal_shares
    where accepted_at is null
      and ((status = 'revoked' and updated_at < now() - interval '90 days')
        or (expires_at < now() - interval '90 days'))
    order by created_at
    limit greatest(coalesce(p_limit, 1000), 1)
  )
  delete from public.smyl_proposal_shares s using doomed d where s.id = d.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end; $$;
revoke all on function public.smyl_purge_expired_proposal_shares(integer) from public, anon, authenticated;
grant execute on function public.smyl_purge_expired_proposal_shares(integer) to service_role;

do $$
declare v_job record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron no está habilitado: la purga de propuestas compartidas NO quedó programada.';
    return;
  end if;
  for v_job in select jobid from cron.job where jobname = 'smyl-purga-propuestas-compartidas' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('smyl-purga-propuestas-compartidas', '41 3 * * *', $job$select public.smyl_purge_expired_proposal_shares(1000)$job$);
end;
$$;

commit;
