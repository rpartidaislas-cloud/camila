-- Seguridad/LFPDPPP (auditoría 2026-10-26, S9): las purgas de retención existían como funciones SQL pero
-- NINGÚN proceso las ejecutaba, así que los datos vencidos se quedaban indefinidamente:
--   * smyl_purge_expired_public_appointment_intakes: captaciones públicas de citas (retención de 90 días).
--   * smyl_purge_expired_assistant_conversations: conversaciones del asistente público del perfil.
-- Esta migración las programa una vez al día con pg_cron. Es idempotente (reprograma sin duplicar) y NO falla si
-- pg_cron no está habilitado: avisa y no hace nada (actívalo en Database > Extensions y vuelve a aplicarla).
--
-- El audio de MILA (mila_recordings.retention_until, 30 días) necesita borrar archivos del Storage, que SQL no
-- puede hacer: lo purga la función file-lifecycle-maintenance, que se ejecuta de forma oportunista por clínica.
begin;

do $$
declare
  v_job record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron no está habilitado: las purgas de retención NO quedaron programadas. Activa la extensión y vuelve a aplicar esta migración.';
    return;
  end if;

  for v_job in
    select jobid from cron.job
    where jobname in ('smyl-purga-intakes-publicos', 'smyl-purga-asistente-publico')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'smyl-purga-intakes-publicos',
    '17 3 * * *',
    $job$select public.smyl_purge_expired_public_appointment_intakes(1000)$job$
  );
  perform cron.schedule(
    'smyl-purga-asistente-publico',
    '23 3 * * *',
    $job$select public.smyl_purge_expired_assistant_conversations(2000)$job$
  );
end;
$$;

commit;
