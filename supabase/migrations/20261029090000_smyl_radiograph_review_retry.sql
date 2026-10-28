-- Reintento explícito de una revisión radiográfica v1 que quedó "sin confirmar".
-- La máquina de estados de smyl_save_radiograph_review hace terminales 'completed' y 'unconfirmed' (evita cobros y
-- resultados duplicados). Esta función es la única vía de salida y solo aplica a una revisión 'unconfirmed' (o 'requested'
-- abandonada hace más de 15 min): escribe una revisión NUEVA en estado 'ready' y conserva la anterior en
-- smyl_radiograph_review_versions. Nunca borra nada. Solo la dueña de la clínica.
begin;
create or replace function public.smyl_retry_radiograph_review(p_patient_id uuid, p_study_id uuid, p_expected_revision integer)
returns public.smyl_radiograph_reviews language plpgsql security definer set search_path='' as $$
declare t uuid:=auth.uid(); old public.smyl_radiograph_reviews; result public.smyl_radiograph_reviews; fresh jsonb;
begin
 if not public.smyl_case_owner() then raise exception 'Radiograph review access denied' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<1 then raise exception 'Invalid revision' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text||p_study_id::text,31));
 select * into old from public.smyl_radiograph_reviews where patient_id=p_patient_id and study_id=p_study_id and tenant_id=t for update;
 if not found then raise exception 'Radiograph review not available' using errcode='42501'; end if;
 if old.revision=p_expected_revision+1 and old.document->'workflow'->>'state'='ready' then return old; end if;
 if old.revision<>p_expected_revision then raise exception 'Radiograph review revision conflict' using errcode='PT409'; end if;
 if not (old.document->'workflow'->>'state'='unconfirmed'
   or (old.document->'workflow'->>'state'='requested' and old.updated_at < clock_timestamp()-interval '15 minutes')) then
  raise exception 'Only an unconfirmed review can be retried' using errcode='23514'; end if;
 fresh:=jsonb_build_object('schema',1,'study',old.document->'study','workflow',jsonb_build_object('state','ready','attempt',0),'analysis','null'::jsonb,'items','[]'::jsonb);
 update public.smyl_radiograph_reviews set revision=old.revision+1, document=fresh, updated_at=clock_timestamp(), updated_by=t
  where patient_id=p_patient_id and study_id=p_study_id returning * into result;
 insert into public.smyl_radiograph_review_versions select result.*;
 return result;
end;$$;
revoke all on function public.smyl_retry_radiograph_review(uuid,uuid,integer) from public,anon;
grant execute on function public.smyl_retry_radiograph_review(uuid,uuid,integer) to authenticated;
commit;
