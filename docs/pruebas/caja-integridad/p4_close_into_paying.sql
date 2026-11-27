select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000002',false), set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',false) \gset
set role authenticated;
select pg_sleep(1);
select 'P4 intenta cerrar la caja B mientras P3 cobra' as paso;
select (smyl_close_cash_session('eeeeeeee-0000-4000-8000-0000000000a2', 1, 500, '')).expected_cash as efectivo_esperado_en_el_corte;
