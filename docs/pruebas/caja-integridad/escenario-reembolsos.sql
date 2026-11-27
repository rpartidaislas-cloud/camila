\set ON_ERROR_STOP on
\i /home/user/camila/supabase/migrations/20261127120000_smyl_finance_cash_integrity.sql
\i /home/user/camila/supabase/migrations/20261127120000_smyl_finance_cash_integrity.sql
\set ON_ERROR_STOP off
\pset tuples_only on
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000002',false), set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',false) \gset
set role authenticated;

create or replace function pg_temp.res(p_name text, p_ok boolean, p_det text default '') returns void language plpgsql as $f$
begin raise notice '%  %  %', case when p_ok then 'OK    ' else 'FALLA ' end, p_name, p_det; end $f$;

begin;
reset role;
insert into smyl_finance_charges(id,tenant_id,patient_id,branch_id,idempotency_key,concept,quantity,unit_price,total_amount,created_by)
values ('cccccccc-0000-4000-8000-0000000000c1','bbbbbbbb-0000-4000-8000-000000000002','7e570000-25ea-45c1-8f3e-9ab66770a2f9','7e570000-214f-4afa-8be7-7a1557bb3fca',gen_random_uuid(),'Tratamiento',1,1000,1000,'bbbbbbbb-0000-4000-8000-000000000002');
set role authenticated;
do $$
declare
  B1 uuid := '7e570000-214f-4afa-8be7-7a1557bb3fca'; B2 uuid := '7e570000-5d1c-44a5-8cee-f492ed70d4ac'; P uuid := '7e570000-25ea-45c1-8f3e-9ab66770a2f9';
  ch uuid := 'cccccccc-0000-4000-8000-0000000000c1'; pay1 uuid := 'dddddddd-0000-4000-8000-0000000000a1'; sA uuid := 'dddddddd-0000-4000-8000-0000000000b1'; sB uuid := 'dddddddd-0000-4000-8000-0000000000b2';
  r record; n int; txt text; v_exp numeric; ref uuid;
begin
  -- Cargo de 1000 y caja A (lunes) con un cobro en efectivo de 1000.
  perform smyl_open_cash_session(sA, B1, 200);
  perform smyl_post_payment(pay1, gen_random_uuid(), P, B1, sA, 1000, 'cash', '', now(), jsonb_build_array(jsonb_build_object('charge_id', ch, 'amount', 1000)));
  -- Se cierra la caja A (efectivo contado = fondo 200 + 1000).
  perform smyl_close_cash_session(sA, 1, 1200, '');
  select expected_cash into v_exp from smyl_cash_sessions where id = sA;
  perform pg_temp.res('1 La caja A cierra con efectivo esperado 1200', v_exp = 1200, v_exp::text);

  -- Caja B (viernes) abierta en la otra sucursal.
  perform smyl_open_cash_session(sB, B2, 500);

  -- 2. Reembolso en efectivo sin elegir caja: se rechaza.
  begin perform smyl_refund_payment(gen_random_uuid(), gen_random_uuid(), pay1, 300, 'Error de cobro'); perform pg_temp.res('2 Reembolso en efectivo sin caja se rechaza', false, 'se permitió'); exception when others then perform pg_temp.res('2 Reembolso en efectivo sin caja se rechaza', true, sqlerrm); end;
  -- 3. Elegir la caja A (cerrada): se rechaza.
  begin perform smyl_refund_payment(gen_random_uuid(), gen_random_uuid(), pay1, 300, 'Error de cobro', 'cash', sA); perform pg_temp.res('3 Reembolso desde una caja CERRADA se rechaza', false, 'se permitió'); exception when others then perform pg_temp.res('3 Reembolso desde una caja CERRADA se rechaza', true, sqlerrm); end;
  -- 4. Elegir la caja B (abierta): sale de B.
  ref := gen_random_uuid();
  perform smyl_refund_payment(ref, gen_random_uuid(), pay1, 300, 'Error de cobro', 'cash', sB);
  select * into r from smyl_finance_refunds where id = ref;
  perform pg_temp.res('4 El reembolso guarda método, caja y sucursal de SALIDA', r.refund_method = 'cash' and r.refund_cash_session_id = sB and r.refund_branch_id = B2, r.refund_method||'/'||(r.refund_cash_session_id = sB)::text||'/'||(r.refund_branch_id = B2)::text);
  perform pg_temp.res('5 La caja B (la que entregó el dinero) espera 500 − 300 = 200', smyl_cash_session_expected(sB) = 200, smyl_cash_session_expected(sB)::text);
  select expected_cash into v_exp from smyl_cash_sessions where id = sA;
  perform pg_temp.res('6 La caja A cerrada NO cambia (sigue en 1200 congelada)', v_exp = 1200, v_exp::text);
  perform pg_temp.res('7 Y su recálculo en vivo tampoco la altera', smyl_cash_session_expected(sA) = 1200, smyl_cash_session_expected(sA)::text);

  -- 8. Reembolso con tarjeta de un pago en efectivo: no toca ninguna caja, pero exige referencia.
  begin perform smyl_refund_payment(gen_random_uuid(), gen_random_uuid(), pay1, 100, 'Devolución a tarjeta', 'card', null, ''); perform pg_temp.res('8 Devolución por tarjeta sin referencia se rechaza', false, 'se permitió'); exception when others then perform pg_temp.res('8 Devolución por tarjeta sin referencia se rechaza', true, sqlerrm); end;
  perform smyl_refund_payment(gen_random_uuid(), gen_random_uuid(), pay1, 100, 'Devolución a tarjeta', 'transfer', null, 'SPEI 998877');
  perform pg_temp.res('9 Una devolución por transferencia no resta efectivo de ninguna caja', smyl_cash_session_expected(sB) = 200, smyl_cash_session_expected(sB)::text);

  -- 10. Cobro en efectivo y ajuste sobre la caja cerrada: se rechazan.
  begin perform smyl_post_cash_adjustment(gen_random_uuid(), gen_random_uuid(), sA, 'in', 50, 'Fondo extra'); perform pg_temp.res('10 Ajuste en una caja cerrada se rechaza', false, 'se permitió'); exception when others then perform pg_temp.res('10 Ajuste en una caja cerrada se rechaza', true, sqlerrm); end;
end $$;
reset role;
insert into smyl_finance_refunds(id, tenant_id, payment_id, idempotency_key, amount, reason, created_by) values (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-0000000000a1', gen_random_uuid(), 50, 'Histórico', 'bbbbbbbb-0000-4000-8000-000000000002');
set role authenticated;
do $$
declare pay1 uuid := 'dddddddd-0000-4000-8000-0000000000a1'; sA uuid := 'dddddddd-0000-4000-8000-0000000000b1'; sB uuid := 'dddddddd-0000-4000-8000-0000000000b2'; n int; ref uuid;
begin
  perform pg_temp.res('11 Reembolso histórico (sin método) sigue restando de la caja del PAGO ORIGINAL', smyl_cash_session_expected(sA) = 1150, smyl_cash_session_expected(sA)::text);
  -- 12. Idempotencia: repetir el mismo reembolso no duplica.
  ref := gen_random_uuid();
  declare k uuid := gen_random_uuid(); begin
    perform smyl_refund_payment(ref, k, pay1, 10, 'Repetido', 'cash', sB);
    perform smyl_refund_payment(gen_random_uuid(), k, pay1, 10, 'Repetido', 'cash', sB);
    select count(*) into n from smyl_finance_refunds where idempotency_key = k;
    perform pg_temp.res('12 El mismo intento de reembolso no se duplica', n = 1, n::text);
  end;
  -- 13. No se puede reembolsar más que el pago.
  begin perform smyl_refund_payment(gen_random_uuid(), gen_random_uuid(), pay1, 5000, 'Demasiado', 'cash', sB); perform pg_temp.res('13 Reembolso mayor al pago se rechaza', false, 'se permitió'); exception when others then perform pg_temp.res('13 Reembolso mayor al pago se rechaza', true, sqlerrm); end;
end $$;
rollback;
