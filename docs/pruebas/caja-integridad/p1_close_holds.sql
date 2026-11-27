select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000002',false), set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',false) \gset
set role authenticated;
begin;
select 'P1 cierra caja A (sin confirmar aun)' as paso, (smyl_close_cash_session('eeeeeeee-0000-4000-8000-0000000000a1', 1, 100, '')).status;
select pg_sleep(4);
commit;
select 'P1 confirmo el cierre' as paso;
