-- Required before first production activation of the prepared proposal module.
-- Business conflicts are HTTP409, not retryable serialization failures (40001).
-- Preserve the previously tested functions verbatim except for those codes.
begin;
do $$
declare signature text; definition text; expected integer; actual integer;
begin
 foreach signature in array array[
  'public.smyl_save_proposal(uuid,uuid,uuid,integer,integer,jsonb,boolean)',
  'public.smyl_proposal_for_export(uuid,integer)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  expected:=case when signature like '%smyl_save_proposal%' then 2 else 1 end;
  actual:=(length(definition)-length(replace(definition,'errcode=''40001''','')))/length('errcode=''40001''');
  if actual<>expected then raise exception 'Unexpected proposal function definition; stop and reconcile';end if;
  execute replace(definition,'errcode=''40001''','errcode=''PT409''');
 end loop;
end;$$;
commit;
