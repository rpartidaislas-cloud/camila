-- Allow an owner to start a new analysis only when the previous workflow
-- produced no confirmed provider result. Photos and manual notes stay exact;
-- the prior document remains in the immutable version history.
begin;

create or replace function public.smyl_check_workflow_transition(old_doc jsonb, new_doc jsonb)
returns void language plpgsql set search_path='' as $$
declare s jsonb; prior jsonb; changed integer:=0; idx integer:=0; i jsonb;
begin
 if old_doc is null then
  if new_doc->'analysis'<>'null'::jsonb or jsonb_array_length(new_doc->'items')<>0
  or exists(select 1 from jsonb_array_elements(new_doc->'workflow'->'stages') v where v->>'state'<>'ready')
  then raise exception 'Start with a saved empty workflow' using errcode='22023'; end if;
  return;
 end if;
 if old_doc->'schema'<>'3'::jsonb or new_doc->'schema'<>'3'::jsonb
 then raise exception 'Keep workflow schema' using errcode='22023'; end if;

 -- Explicit restart: no completed evidence may be discarded or rewritten.
 if old_doc->'analysis'='null'::jsonb and new_doc->'analysis'='null'::jsonb
 and old_doc->'photos'=new_doc->'photos' and old_doc->'items'=new_doc->'items'
 and old_doc->'workflow'->'at' is distinct from new_doc->'workflow'->'at'
 and exists(select 1 from jsonb_array_elements(old_doc->'workflow'->'stages') v where v->>'state'='unconfirmed')
 and not exists(select 1 from jsonb_array_elements(old_doc->'workflow'->'stages') v where v->>'state' in ('requested','completed'))
 and not exists(select 1 from jsonb_array_elements(new_doc->'workflow'->'stages') v where v->>'state'<>'ready')
 and jsonb_array_length(old_doc->'workflow'->'stages')=jsonb_array_length(new_doc->'workflow'->'stages') then
  for s in select value from jsonb_array_elements(new_doc->'workflow'->'stages') loop
   prior:=old_doc->'workflow'->'stages'->idx;idx:=idx+1;
   if prior->'key' is distinct from s->'key' or prior->'views' is distinct from s->'views'
   then raise exception 'Keep stage identity' using errcode='22023'; end if;
  end loop;
  return;
 end if;

 if old_doc->'workflow'->'at' is distinct from new_doc->'workflow'->'at'
 then raise exception 'Keep workflow identity' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(new_doc->'workflow'->'stages') loop
  prior:=old_doc->'workflow'->'stages'->idx;idx:=idx+1;
  if prior->'key' is distinct from s->'key' or prior->'views' is distinct from s->'views'
  then raise exception 'Keep stage identity' using errcode='22023'; end if;
  if prior is distinct from s then
   changed:=changed+1;
   if not ((prior->>'state'='ready' and s->>'state'='requested') or (prior->>'state'='requested' and s->>'state' in ('completed','unconfirmed')))
   then raise exception 'Workflow stage cannot be repeated or rewritten' using errcode='22023'; end if;
   if prior->>'state'='requested' and prior->'attempt' is distinct from s->'attempt'
   then raise exception 'Keep request attempt identity' using errcode='22023'; end if;
  end if;
 end loop;
 if changed>1 or idx<>jsonb_array_length(old_doc->'workflow'->'stages')
 then raise exception 'Save one stage transition at a time' using errcode='22023'; end if;
 for i in select value from jsonb_array_elements(new_doc->'items') loop
  if i->>'sourceId'<>'' and not exists(select 1 from jsonb_array_elements(old_doc->'items') v where v->>'id'=i->>'id') and i->>'state'<>'pending'
  then raise exception 'New suggestions require professional review' using errcode='22023'; end if;
 end loop;
end;$$;

create or replace function public.smyl_photo_review_capabilities()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema',1,'enabled',public.smyl_case_owner(),'tenant_id',auth.uid(),'review_schema',3,'multi_evidence',true,'specialist_workflow',2,'restart_unconfirmed',1);
$$;
revoke all on function public.smyl_check_workflow_transition(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.smyl_photo_review_capabilities() from public,anon;
grant execute on function public.smyl_photo_review_capabilities() to authenticated;
commit;
