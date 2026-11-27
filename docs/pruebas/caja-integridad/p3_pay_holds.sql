select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000002',false), set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',false) \gset
set role authenticated;
begin;
select 'P3 cobra 400 en efectivo en la caja B (sin confirmar aun)' as paso, (smyl_post_payment('eeeeeeee-0000-4000-8000-0000000000c2', gen_random_uuid(), '7e570000-25ea-45c1-8f3e-9ab66770a2f9', '7e570000-5d1c-44a5-8cee-f492ed70d4ac', 'eeeeeeee-0000-4000-8000-0000000000a2', 400, 'cash', '', now(), '[]'::jsonb)).amount;
select pg_sleep(4);
commit;
select 'P3 confirmo el cobro' as paso;
