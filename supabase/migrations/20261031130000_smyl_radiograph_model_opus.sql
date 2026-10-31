-- La revisión de radiografías guarda con qué modelo se hizo el análisis. Hasta ahora solo aceptaba Sonnet 4.6;
-- el análisis pasa a Claude Opus 5.5, así que se aceptan los dos (las revisiones anteriores siguen siendo válidas).
-- Es la misma validación de 20261006010000_smyl_radiograph_reviews.sql con una sola condición cambiada.
--
-- Se aplica con el SQL Editor de Supabase. Es idempotente (create or replace).

create or replace function public.smyl_validate_radiograph_review(p_document jsonb,p_study jsonb)
returns void language plpgsql set search_path='' as $$
declare w jsonb; a jsonb; r jsonb; o jsonb; i jsonb; id_list text[]:=array[]::text[]; source_list text[]:=array[]::text[]; report_ids text[]:=array[]::text[];
begin
 if p_document is null or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>120000
 or p_document-array['schema','study','workflow','analysis','items']<>'{}'::jsonb
 or not(p_document ?& array['schema','study','workflow','analysis','items']) or p_document->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_document->'study') is distinct from 'object' or (p_document->'study')-array['id','type','sha256']<>'{}'::jsonb
 or p_document->'study'->>'id' is distinct from p_study->>'id' or p_document->'study'->>'type' is distinct from p_study->>'type'
 or p_document->'study'->>'sha256' is distinct from p_study->'asset'->>'sha256'
 or jsonb_typeof(p_document->'items') is distinct from 'array' or jsonb_array_length(p_document->'items')>12
 then raise exception 'Invalid radiograph review' using errcode='22023'; end if;
 w:=p_document->'workflow';
 if jsonb_typeof(w) is distinct from 'object' or w-array['state','attempt']<>'{}'::jsonb or not(w ?& array['state','attempt'])
 or coalesce(w->>'state','') not in ('ready','requested','completed','unconfirmed')
 or jsonb_typeof(w->'attempt') is distinct from 'number' or coalesce(w->>'attempt','') !~ '^[01]$'
 then raise exception 'Invalid radiograph workflow' using errcode='22023'; end if;
 if (w->>'state'='ready' and ((w->>'attempt')::integer<>0 or p_document->'analysis'<>'null'::jsonb or jsonb_array_length(p_document->'items')<>0))
 or (w->>'state' in ('requested','unconfirmed') and ((w->>'attempt')::integer<>1 or p_document->'analysis'<>'null'::jsonb or jsonb_array_length(p_document->'items')<>0))
 then raise exception 'Invalid radiograph workflow state' using errcode='22023'; end if;
 a:=p_document->'analysis';
 if w->>'state'='completed' then
  if (w->>'attempt')::integer<>1 or jsonb_typeof(a) is distinct from 'object' or a-array['model','at','requestId','report']<>'{}'::jsonb
  or not(a ?& array['model','at','requestId','report']) or a->>'model' not in ('claude-sonnet-4-6','claude-opus-5-5')
  or jsonb_typeof(a->'at') is distinct from 'string' or coalesce(a->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
  or jsonb_typeof(a->'requestId') is distinct from 'string' or (a->>'requestId'<>'' and a->>'requestId' !~ '^msg_[a-zA-Z0-9_-]{1,100}$')
  then raise exception 'Invalid radiograph analysis' using errcode='22023'; end if;
  perform (a->>'at')::timestamptz; r:=a->'report';
  if jsonb_typeof(r) is distinct from 'object' or r-array['schema','quality','qualityNote','observations','limitations']<>'{}'::jsonb
  or not(r ?& array['schema','quality','qualityNote','observations','limitations']) or r->'schema' is distinct from '1'::jsonb
  or coalesce(r->>'quality','') not in ('usable','limited','unusable') or jsonb_typeof(r->'qualityNote') is distinct from 'string' or length(trim(r->>'qualityNote')) not between 1 and 400
  or jsonb_typeof(r->'observations') is distinct from 'array' or jsonb_array_length(r->'observations')>12
  or jsonb_typeof(r->'limitations') is distinct from 'array' or jsonb_array_length(r->'limitations')>8
  then raise exception 'Invalid radiograph report' using errcode='22023'; end if;
  if r->>'quality'='unusable' and jsonb_array_length(r->'observations')<>0 then raise exception 'Unusable image cannot have observations' using errcode='22023'; end if;
  for o in select value from jsonb_array_elements(r->'observations') loop
   if jsonb_typeof(o) is distinct from 'object' or o-array['id','category','tooth','observation','evidence']<>'{}'::jsonb
   or not(o ?& array['id','category','tooth','observation','evidence']) or coalesce(o->>'id','') !~ '^r([1-9]|1[0-2])$' or o->>'id'=any(report_ids)
   or coalesce(o->>'category','') not in ('density','contour','restoration','support','development','other')
   or not(o->'tooth'='null'::jsonb or (jsonb_typeof(o->'tooth')='string' and o->>'tooth' ~ '^[1-4][1-8]$'))
   or jsonb_typeof(o->'observation') is distinct from 'string' or length(trim(o->>'observation')) not between 1 and 500
   or jsonb_typeof(o->'evidence') is distinct from 'string' or length(trim(o->>'evidence')) not between 1 and 300
   then raise exception 'Invalid radiograph observation' using errcode='22023'; end if;
   report_ids:=array_append(report_ids,o->>'id');
  end loop;
  for o in select value from jsonb_array_elements(r->'limitations') loop
   if jsonb_typeof(o) is distinct from 'string' or length(trim(o#>>'{}')) not between 1 and 300 then raise exception 'Invalid radiograph limitation' using errcode='22023'; end if;
  end loop;
 elsif a<>'null'::jsonb then raise exception 'Unexpected radiograph analysis' using errcode='22023';
 end if;
 for i in select value from jsonb_array_elements(p_document->'items') loop
  if jsonb_typeof(i) is distinct from 'object' or i-array['id','sourceId','tooth','text','x','y','state']<>'{}'::jsonb
  or not(i ?& array['id','sourceId','tooth','text','x','y','state'])
  or coalesce(i->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or i->>'id'=any(id_list)
  or coalesce(i->>'sourceId','') !~ '^r([1-9]|1[0-2])$' or i->>'sourceId'=any(source_list) or not(i->>'sourceId'=any(report_ids))
  or jsonb_typeof(i->'tooth') is distinct from 'string' or (i->>'tooth'<>'' and i->>'tooth' !~ '^[1-4][1-8]$')
  or jsonb_typeof(i->'text') is distinct from 'string' or length(i->>'text')>600 or coalesce(i->>'state','') not in ('pending','confirmed','rejected')
  or not((i->'x'='null'::jsonb and i->'y'='null'::jsonb) or (jsonb_typeof(i->'x')='number' and jsonb_typeof(i->'y')='number' and (i->>'x')::numeric between 0 and 1 and (i->>'y')::numeric between 0 and 1))
  or (i->>'state'='confirmed' and (trim(i->>'text')='' or i->'x'='null'::jsonb))
  then raise exception 'Invalid reviewed radiograph item' using errcode='22023'; end if;
  id_list:=array_append(id_list,i->>'id');source_list:=array_append(source_list,i->>'sourceId');
 end loop;
 if cardinality(source_list)<>cardinality(report_ids) then raise exception 'Missing radiograph suggestion' using errcode='22023'; end if;
end;$$;

revoke all on function public.smyl_validate_radiograph_review(jsonb,jsonb) from public,anon,authenticated;
