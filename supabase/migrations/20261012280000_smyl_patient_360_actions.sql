-- SMYL · Etapa 3: acciones atómicas de la Ficha clínica 360.
begin;

create or replace function public.smyl_save_patient_history(p_patient_id uuid,p_expected_revision integer,p_document jsonb)
returns public.smyl_patient_histories language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_patient_histories; v_revision integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.write') then raise exception using errcode='42501',message='No tienes permiso para editar antecedentes clínicos.'; end if;
  if p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>65536 then raise exception using errcode='22023',message='El documento de antecedentes no es válido.'; end if;
  if not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient_id) then raise exception using errcode='P0002',message='El paciente no existe.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_patient_id::text||':history',0));
  select * into v_row from public.smyl_patient_histories where tenant_id=v_tenant and patient_id=p_patient_id for update;
  if found then
    if v_row.revision<>p_expected_revision then raise exception using errcode='40001',message='Los antecedentes cambiaron en otra sesión. Actualiza la ficha.'; end if;
    v_revision:=v_row.revision+1;
    update public.smyl_patient_histories set document=p_document,revision=v_revision,updated_by=auth.uid(),updated_at=now() where tenant_id=v_tenant and patient_id=p_patient_id returning * into v_row;
  else
    if coalesce(p_expected_revision,0)<>0 then raise exception using errcode='40001',message='Los antecedentes cambiaron en otra sesión. Actualiza la ficha.'; end if;
    insert into public.smyl_patient_histories(patient_id,tenant_id,revision,document,updated_by) values(p_patient_id,v_tenant,1,p_document,auth.uid()) returning * into v_row;
  end if;
  insert into public.smyl_patient_history_versions(tenant_id,patient_id,revision,document,updated_by,updated_at) values(v_tenant,p_patient_id,v_row.revision,v_row.document,auth.uid(),v_row.updated_at);
  return v_row;
end; $$;

create or replace function public.smyl_create_clinical_note(p_id uuid,p_patient_id uuid,p_appointment_id uuid,p_professional_id uuid,p_note_type text,p_document jsonb)
returns public.smyl_clinical_notes language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_clinical_notes;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.write') then raise exception using errcode='42501',message='No tienes permiso para crear notas clínicas.'; end if;
  if p_id is null or p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>65536 then raise exception using errcode='22023',message='La nota clínica no es válida.'; end if;
  if exists(select 1 from public.smyl_clinical_notes where id=p_id and tenant_id=v_tenant) then select * into v_row from public.smyl_clinical_notes where id=p_id and tenant_id=v_tenant; return v_row; end if;
  if not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient_id) then raise exception using errcode='P0002',message='El paciente no existe.'; end if;
  if p_appointment_id is not null and not exists(select 1 from public.smyl_appointments where tenant_id=v_tenant and id=p_appointment_id and patient_id=p_patient_id) then raise exception using errcode='23514',message='La cita no pertenece a este paciente.'; end if;
  if p_professional_id is not null and not exists(select 1 from public.smyl_professionals where tenant_id=v_tenant and id=p_professional_id and active) then raise exception using errcode='P0002',message='El profesional no existe o está inactivo.'; end if;
  insert into public.smyl_clinical_notes(id,tenant_id,patient_id,appointment_id,professional_id,note_type,document,created_by,updated_by)
  values(p_id,v_tenant,p_patient_id,p_appointment_id,p_professional_id,p_note_type,p_document,auth.uid(),auth.uid()) returning * into v_row;
  insert into public.smyl_clinical_note_versions(tenant_id,note_id,revision,snapshot,actor_id) values(v_tenant,p_id,1,to_jsonb(v_row)-'tenant_id',auth.uid());
  return v_row;
end; $$;

create or replace function public.smyl_update_clinical_note(p_id uuid,p_expected_revision integer,p_document jsonb)
returns public.smyl_clinical_notes language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_clinical_notes;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.write') then raise exception using errcode='42501',message='No tienes permiso para editar notas clínicas.'; end if;
  select * into v_row from public.smyl_clinical_notes where tenant_id=v_tenant and id=p_id for update;
  if not found then raise exception using errcode='P0002',message='La nota no existe.'; end if;
  if v_row.status<>'draft' then raise exception using errcode='23514',message='Una nota firmada no puede modificarse; agrega una adenda.'; end if;
  if v_row.revision<>p_expected_revision then raise exception using errcode='40001',message='La nota cambió en otra sesión. Actualiza la ficha.'; end if;
  if p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>65536 then raise exception using errcode='22023',message='La nota clínica no es válida.'; end if;
  update public.smyl_clinical_notes set document=p_document,revision=revision+1,updated_by=auth.uid(),updated_at=now() where tenant_id=v_tenant and id=p_id returning * into v_row;
  insert into public.smyl_clinical_note_versions(tenant_id,note_id,revision,snapshot,actor_id) values(v_tenant,p_id,v_row.revision,to_jsonb(v_row)-'tenant_id',auth.uid());
  return v_row;
end; $$;

create or replace function public.smyl_sign_clinical_note(p_id uuid,p_expected_revision integer)
returns public.smyl_clinical_notes language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_clinical_notes;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.approve') then raise exception using errcode='42501',message='No tienes permiso para firmar notas clínicas.'; end if;
  select * into v_row from public.smyl_clinical_notes where tenant_id=v_tenant and id=p_id for update;
  if not found or v_row.status<>'draft' then raise exception using errcode='23514',message='La nota no está disponible para firma.'; end if;
  if v_row.revision<>p_expected_revision then raise exception using errcode='40001',message='La nota cambió en otra sesión. Actualiza la ficha.'; end if;
  if char_length(btrim(coalesce(v_row.document->>'assessment','')))+char_length(btrim(coalesce(v_row.document->>'plan','')))<2 then raise exception using errcode='23514',message='Completa la valoración o el plan antes de firmar.'; end if;
  update public.smyl_clinical_notes set status='signed',revision=revision+1,signed_by=auth.uid(),signed_at=now(),updated_by=auth.uid(),updated_at=now() where tenant_id=v_tenant and id=p_id returning * into v_row;
  insert into public.smyl_clinical_note_versions(tenant_id,note_id,revision,snapshot,actor_id) values(v_tenant,p_id,v_row.revision,to_jsonb(v_row)-'tenant_id',auth.uid());
  return v_row;
end; $$;

create or replace function public.smyl_add_clinical_note_addendum(p_note_id uuid,p_content text,p_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.approve') then raise exception using errcode='42501',message='No tienes permiso para agregar adendas.'; end if;
  if not exists(select 1 from public.smyl_clinical_notes where tenant_id=v_tenant and id=p_note_id and status='signed') then raise exception using errcode='23514',message='Las adendas solo pueden agregarse a notas firmadas.'; end if;
  insert into public.smyl_clinical_note_addenda(tenant_id,note_id,content,reason,created_by) values(v_tenant,p_note_id,btrim(p_content),btrim(p_reason),auth.uid()) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.smyl_register_patient_file(p_id uuid,p_patient_id uuid,p_appointment_id uuid,p_category text,p_display_name text,p_storage_path text,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_notes text,p_captured_at timestamptz)
returns public.smyl_patient_files language plpgsql security definer set search_path=pg_catalog,public,storage as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_patient_files; v_prefix text;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.write') then raise exception using errcode='42501',message='No tienes permiso para registrar archivos clínicos.'; end if;
  v_prefix:=v_tenant::text||'/'||p_patient_id::text||'/'||p_id::text||'/';
  if p_storage_path not like v_prefix||'%' then raise exception using errcode='23514',message='La ruta del archivo no pertenece al paciente.'; end if;
  if not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient_id) then raise exception using errcode='P0002',message='El paciente no existe.'; end if;
  if p_appointment_id is not null and not exists(select 1 from public.smyl_appointments where tenant_id=v_tenant and id=p_appointment_id and patient_id=p_patient_id) then raise exception using errcode='23514',message='La cita no pertenece al paciente.'; end if;
  if not exists(select 1 from storage.objects where bucket_id='smyl-clinical-files' and name=p_storage_path) then raise exception using errcode='P0002',message='No se confirmó el archivo privado.'; end if;
  insert into public.smyl_patient_files(id,tenant_id,patient_id,appointment_id,category,display_name,storage_path,mime_type,size_bytes,sha256,notes,captured_at,created_by)
  values(p_id,v_tenant,p_patient_id,p_appointment_id,p_category,btrim(p_display_name),p_storage_path,p_mime_type,p_size_bytes,nullif(lower(p_sha256),''),left(coalesce(p_notes,''),1000),p_captured_at,auth.uid()) returning * into v_row;
  return v_row;
end; $$;

create or replace function public.smyl_archive_patient_file(p_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.write') then raise exception using errcode='42501',message='No tienes permiso para archivar archivos clínicos.'; end if;
  update public.smyl_patient_files set status='archived' where tenant_id=v_tenant and id=p_id and status='active';
  if not found then raise exception using errcode='P0002',message='El archivo no existe o ya está archivado.'; end if;
end; $$;

create or replace function public.smyl_discard_unregistered_file(p_storage_path text)
returns void language plpgsql security definer set search_path=pg_catalog,public,storage as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.write') then raise exception using errcode='42501',message='No tienes permiso para limpiar archivos clínicos.'; end if;
  if p_storage_path is null or p_storage_path not like v_tenant::text||'/%' then raise exception using errcode='23514',message='La ruta no pertenece a esta clínica.'; end if;
  if exists(select 1 from public.smyl_patient_files where tenant_id=v_tenant and storage_path=p_storage_path) then raise exception using errcode='23514',message='El archivo ya forma parte de un expediente.'; end if;
  delete from storage.objects where bucket_id='smyl-clinical-files' and name=p_storage_path;
end; $$;

create or replace function public.smyl_patient_timeline(p_patient_id uuid,p_limit integer default 100)
returns table(event_at timestamptz,event_type text,title text,status text,reference_id uuid,metadata jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.read') then raise exception using errcode='42501',message='No tienes permiso para consultar la ficha clínica.'; end if;
  if not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient_id) then raise exception using errcode='P0002',message='El paciente no existe.'; end if;
  return query
  select timeline.event_at,timeline.event_type,timeline.title,timeline.status,timeline.reference_id,timeline.metadata from (
    select a.starts_at as event_at,'appointment'::text as event_type,coalesce(s.name,'Cita dental') as title,a.status,a.id as reference_id,jsonb_build_object('professional_id',a.professional_id,'branch_id',a.branch_id) as metadata from public.smyl_appointments a left join public.smyl_services s on s.tenant_id=a.tenant_id and s.id=a.service_id where a.tenant_id=v_tenant and a.patient_id=p_patient_id
    union all select n.created_at,'clinical_note',case n.note_type when 'initial' then 'Nota inicial' when 'procedure' then 'Procedimiento' when 'emergency' then 'Urgencia' else 'Nota de evolución' end,n.status,n.id,jsonb_build_object('professional_id',n.professional_id,'signed_at',n.signed_at) from public.smyl_clinical_notes n where n.tenant_id=v_tenant and n.patient_id=p_patient_id
    union all select f.created_at,'file','Archivo · '||f.display_name,f.status,f.id,jsonb_build_object('category',f.category,'mime_type',f.mime_type) from public.smyl_patient_files f where f.tenant_id=v_tenant and f.patient_id=p_patient_id
  ) timeline order by timeline.event_at desc limit greatest(1,least(coalesce(p_limit,100),250));
end; $$;

revoke all on function public.smyl_save_patient_history(uuid,integer,jsonb),public.smyl_create_clinical_note(uuid,uuid,uuid,uuid,text,jsonb),public.smyl_update_clinical_note(uuid,integer,jsonb),public.smyl_sign_clinical_note(uuid,integer),public.smyl_add_clinical_note_addendum(uuid,text,text),public.smyl_register_patient_file(uuid,uuid,uuid,text,text,text,text,bigint,text,text,timestamptz),public.smyl_archive_patient_file(uuid),public.smyl_discard_unregistered_file(text),public.smyl_patient_timeline(uuid,integer) from public,anon;
grant execute on function public.smyl_save_patient_history(uuid,integer,jsonb),public.smyl_create_clinical_note(uuid,uuid,uuid,uuid,text,jsonb),public.smyl_update_clinical_note(uuid,integer,jsonb),public.smyl_sign_clinical_note(uuid,integer),public.smyl_add_clinical_note_addendum(uuid,text,text),public.smyl_register_patient_file(uuid,uuid,uuid,text,text,text,text,bigint,text,text,timestamptz),public.smyl_archive_patient_file(uuid),public.smyl_discard_unregistered_file(text),public.smyl_patient_timeline(uuid,integer) to authenticated;

commit;
