select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000002',false), set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',false) \gset
set role authenticated;
select pg_sleep(1);
select 'P2 intenta cobrar en efectivo en la caja que P1 esta cerrando' as paso;
select smyl_post_payment('eeeeeeee-0000-4000-8000-0000000000c1', gen_random_uuid(), '7e570000-25ea-45c1-8f3e-9ab66770a2f9', '7e570000-214f-4afa-8be7-7a1557bb3fca', 'eeeeeeee-0000-4000-8000-0000000000a1', 500, 'cash', '', now(), '[]'::jsonb);
