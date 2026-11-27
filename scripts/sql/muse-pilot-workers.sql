-- Run ONLY in SMYL after deploying muse-alerts and configuring the shared HMAC secret.
-- Uses the existing project Vault service_role_key. No credentials in source.
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='service_role_key' and length(decrypted_secret)>20) then
    raise exception 'Configure the worker credential in Vault first';
  end if;
end $$;
select cron.unschedule(jobid) from cron.job where jobname='smyl-muse-alerts-1min';
select cron.schedule('smyl-muse-alerts-1min','* * * * *',$job$
  select net.http_post(
    url:='https://rpxshsiwoxdbuevjjpfw.supabase.co/functions/v1/muse-alerts',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
      (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1)),
    body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
-- Pause: select cron.unschedule('smyl-muse-alerts-1min');
