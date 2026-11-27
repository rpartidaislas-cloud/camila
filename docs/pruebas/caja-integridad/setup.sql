select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000002',false), set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',false) \gset
set role authenticated;
select smyl_open_cash_session('eeeeeeee-0000-4000-8000-0000000000a1', '7e570000-214f-4afa-8be7-7a1557bb3fca', 100);
select smyl_open_cash_session('eeeeeeee-0000-4000-8000-0000000000a2', '7e570000-5d1c-44a5-8cee-f492ed70d4ac', 100);
