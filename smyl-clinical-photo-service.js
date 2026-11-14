/* Canonical clinical-photo data layer.
 * One private patient file is indexed as one evidence study; the service never
 * uploads or copies image bytes. AI suggestions remain pending until a licensed
 * professional records a decision through the evidence RPCs. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SmylClinicalPhotoService=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SHA=/^[0-9a-f]{64}$/;
  const PHOTO_MIME=new Set(['image/jpeg','image/png','image/webp']);
  const UNAVAILABLE=new Set(['42P01','42883','PGRST202','PGRST205']);
  const TAXONOMY=Object.freeze({
    face_rest:Object.freeze({label:'Rostro frontal en reposo',family:'portrait',region:'face'}),
    face_smile:Object.freeze({label:'Frontal sonriendo',family:'portrait',region:'face'}),
    face_profile_right:Object.freeze({label:'Perfil derecho',family:'portrait',region:'face'}),
    face_profile_left:Object.freeze({label:'Perfil izquierdo',family:'portrait',region:'face'}),
    intraoral_frontal:Object.freeze({label:'Intraoral frontal',family:'intraoral',region:'full_mouth'}),
    intraoral_right:Object.freeze({label:'Lateral intraoral derecha',family:'intraoral',region:'quadrant_1'}),
    intraoral_left:Object.freeze({label:'Lateral intraoral izquierda',family:'intraoral',region:'quadrant_2'}),
    occlusal_upper:Object.freeze({label:'Oclusal superior',family:'intraoral',region:'upper_arch'}),
    occlusal_lower:Object.freeze({label:'Oclusal inferior',family:'intraoral',region:'lower_arch'}),
    localized:Object.freeze({label:'Pieza o zona localizada',family:'intraoral',region:'tooth'}),
    before_after:Object.freeze({label:'Seguimiento antes y después',family:'followup',region:'full_mouth'})
  });
  const FINDING_CATEGORIES=new Set(['quality','anatomy','caries_candidate','restoration','periodontal_support','endodontic','periapical','pathology','implant','orthodontic','trauma','prosthetic','temporomandibular','development','soft_tissue','occlusion','other']);
  const DISPOSITION_STATES=new Set(['reviewed_no_findings','not_evaluable','manual_only']);
  const DISPOSITION_REASONS=new Set(['no_visible_findings','focus_insufficient','exposure_insufficient','orientation_uncertain','region_not_visible','artifact_or_obstruction','other','professional_manual_review']);
  const CACHE_TTL_MS=15000;

  const fail=(message,code)=>Object.assign(new Error(message),code?{code}:{});
  const text=(value,max=1000)=>typeof value==='string'?value.trim().slice(0,max):'';
  const uuid=(value,label='identificador')=>{const out=String(value||'');if(!UUID.test(out))throw fail(`El ${label} no es válido.`,'invalid_id');return out;};
  const subtype=value=>{const out=String(value||'');if(!Object.hasOwn(TAXONOMY,out))throw fail('La vista fotográfica no corresponde al catálogo clínico.','invalid_subtype');return out;};
  const dispatch=(name,detail)=>{try{if(typeof root.dispatchEvent==='function'&&typeof root.CustomEvent==='function')root.dispatchEvent(new root.CustomEvent(name,{detail}));}catch(_){/* Consumers can poll after older browsers. */}};
  const unavailable=error=>UNAVAILABLE.has(String(error?.code||''));

  function normalizeRegion(value,fallback){
    if(value&&typeof value==='object'&&!Array.isArray(value))return structured(value);
    const code=text(value||fallback,120);
    if(!code)return {};
    if(code==='full_mouth')return {scope:'whole_mouth'};
    if(code==='upper_arch'||code==='lower_arch')return {scope:'arch',regionCode:code};
    if(/^quadrant_[1-4]$/.test(code))return {scope:'quadrant',regionCode:code};
    if(code==='face')return {scope:'anatomical_region',regionCode:'face'};
    if(code==='tooth')return {scope:'anatomical_region',regionCode:'localized'};
    return {scope:'anatomical_region',regionCode:code};
  }

  function structured(value){
    if(value===undefined||value===null)return {};
    const json=JSON.stringify(value);
    if(json.length>30000)throw fail('Los metadatos de evidencia son demasiado extensos.','invalid_metadata');
    return JSON.parse(json);
  }

  async function result(promise,timeout=25000){
    const wrapped=root.sbTimeout?root.sbTimeout(promise,timeout):promise;
    const response=await wrapped;
    if(response?.error)throw response.error;
    return response?.data;
  }

  function create(client,options={}){
    if(!client?.from||!client?.rpc||!client?.auth||!client?.storage)throw fail('El servicio clínico no está disponible.','not_configured');
    const cache=new Map();
    const key=(tenant,patient)=>`${tenant}:${patient}`;
    const invalidate=(tenant,patient)=>{if(tenant&&patient)cache.delete(key(tenant,patient));else cache.clear();};

    async function indexPatientFile(input,rowValue){
      const payload=input?.row?input.payload||{}:input||{},row=input?.row||rowValue;
      if(!row||row.category!=='clinical_photo'||row.status&&row.status!=='active'||!PHOTO_MIME.has(row.mime_type)||!SHA.test(String(row.sha256||'')))throw fail('El archivo original no está verificado como fotografía clínica.','invalid_original');
      const tenantId=uuid(row.tenant_id||input?.tenant,'tenant');
      const patientId=uuid(row.patient_id||payload?.patientId,'paciente');
      if(input?.patient&&uuid(input.patient,'paciente')!==patientId)throw fail('El archivo no pertenece al paciente activo.','invalid_original');
      if(input?.tenant&&uuid(input.tenant,'tenant')!==tenantId)throw fail('El archivo no pertenece a la clínica activa.','invalid_original');
      const patientFileId=uuid(row.id,'archivo');
      const view=subtype(payload?.subtype);
      const studyId=uuid(payload?.studyId||root.crypto?.randomUUID?.(),'estudio');
      const assetId=uuid(payload?.assetId||root.crypto?.randomUUID?.(),'recurso');
      const acquiredAt=payload?.date?new Date(`${payload.date}T12:00:00`).toISOString():(row.captured_at||null);
      const region=normalizeRegion(payload?.region,TAXONOMY[view].region);
      const metadata={schema:1,intake:{source:'evidence_center'},original:{sha256:row.sha256,mimeType:row.mime_type,sizeBytes:Number(row.size_bytes)||0}};
      if(payload?.metadata)metadata.context=structured(payload.metadata);
      let saved;
      try{
        saved=await result(client.rpc('smyl_evidence_register_photo_file',{
          p_study_id:studyId,p_asset_id:assetId,p_patient_file_id:patientFileId,p_patient_id:patientId,
          p_subtype:view,p_display_name:text(payload?.title||row.display_name||TAXONOMY[view].label,180)||TAXONOMY[view].label,
          p_acquired_at:acquiredAt,p_region:region,p_metadata:metadata
        }));
      }catch(error){
        if(unavailable(error))throw fail('La clasificación clínica de fotografías aún no está habilitada. El archivo permanece seguro en el expediente; vuelve a intentarlo cuando se actualice SMYL.','evidence_unavailable');
        throw error;
      }
      invalidate(tenantId,patientId);
      dispatch('smyl:clinical-photo-indexed',{tenant:tenantId,patient:patientId,studyId,patientFileId});
      return saved;
    }

    async function queryStudies(tenant,patient){
      const studies=await result(client.from('smyl_clinical_evidence_studies').select('*').eq('tenant_id',tenant).eq('patient_id',patient).eq('modality','photograph').neq('status','superseded').order('acquired_at',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false}));
      const ids=(studies||[]).map(item=>item.id);
      if(!ids.length)return {studies:[],assets:[],files:[],findings:[],decisions:[],dispositions:[]};
      const [assets,findings]=await Promise.all([
        result(client.from('smyl_clinical_evidence_assets').select('*').eq('tenant_id',tenant).in('study_id',ids).eq('asset_role','original')),
        result(client.from('smyl_clinical_evidence_findings').select('*').eq('tenant_id',tenant).in('study_id',ids).order('created_at',{ascending:true}))
      ]);
      const fileIds=[...new Set((assets||[]).map(item=>item.patient_file_id).filter(Boolean))];
      const findingIds=(findings||[]).map(item=>item.id);
      const [files,decisions,dispositions]=await Promise.all([
        fileIds.length?result(client.from('smyl_patient_files').select('id,tenant_id,patient_id,category,display_name,storage_path,mime_type,size_bytes,sha256,status,captured_at,created_at').eq('tenant_id',tenant).eq('patient_id',patient).in('id',fileIds)):[],
        findingIds.length?result(client.from('smyl_clinical_evidence_decisions').select('*').eq('tenant_id',tenant).in('finding_id',findingIds).order('revision',{ascending:true})):[],
        result(client.from('smyl_clinical_photo_study_reviews').select('*').eq('tenant_id',tenant).eq('patient_id',patient).in('study_id',ids).order('revision',{ascending:true}))
      ]);
      return {studies:studies||[],assets:assets||[],files:files||[],findings:findings||[],decisions:decisions||[],dispositions:dispositions||[]};
    }

    function compose(raw){
      const assetsByStudy=new Map(raw.assets.map(item=>[item.study_id,item]));
      const filesById=new Map(raw.files.map(item=>[item.id,item]));
      const decisionsByFinding=new Map();
      raw.decisions.forEach(item=>{const previous=decisionsByFinding.get(item.finding_id);if(!previous||item.revision>previous.revision)decisionsByFinding.set(item.finding_id,item);});
      const findingsByStudy=new Map();
      raw.findings.forEach(item=>{const latestDecision=decisionsByFinding.get(item.id)||null,next={...item,decision:latestDecision,latestDecision,revision:latestDecision?.revision||0};if(!findingsByStudy.has(item.study_id))findingsByStudy.set(item.study_id,[]);findingsByStudy.get(item.study_id).push(next);});
      const dispositionsByStudy=new Map();
      (raw.dispositions||[]).forEach(item=>{const previous=dispositionsByStudy.get(item.study_id);if(!previous||Number(item.revision)>Number(previous.revision))dispositionsByStudy.set(item.study_id,item);});
      return raw.studies.map(study=>{
        const view=Object.hasOwn(TAXONOMY,study.subtype)?study.subtype:'localized';
        const asset=assetsByStudy.get(study.id)||null,candidate=asset?.patient_file_id?filesById.get(asset.patient_file_id)||null:null;
        const file=candidate&&candidate.tenant_id===study.tenant_id&&candidate.patient_id===study.patient_id?candidate:null;
        const findings=findingsByStudy.get(study.id)||[];
        const pending=findings.filter(item=>!item.decision).length;
        const confirmed=findings.filter(item=>['confirmed','corrected'].includes(item.decision?.state)).length;
        const rejected=findings.filter(item=>item.decision?.state==='rejected').length;
        const quality=study.quality?.status||'pending',qualityDetail=study.quality||{status:'pending',flags:[],notes:''};
        const analyzed=quality!=='pending'||study.metadata?.analysis?.completed===true||findings.some(item=>item.origin==='ai');
        const disposition=dispositionsByStudy.get(study.id)||null;
        const reviewState=disposition?.state||(quality==='unusable'?'not_evaluable':pending?'pending_review':analyzed?(findings.length?'reviewed':'no_suggestions'):'not_analyzed');
        const original=file?{...file,patientFileId:file.id,hash:file.sha256,path:file.storage_path}:null;
        return {...study,subtype:view,label:TAXONOMY[view].label,viewLabel:TAXONOMY[view].label,family:TAXONOMY[view].family,quality,qualityDetail,asset,original,findings,pending,confirmed,rejected,disposition,reviewState};
      });
    }

    async function list(tenantValue,patientValue,{fresh=false,force=false}={}){
      const tenant=uuid(tenantValue,'tenant'),patient=uuid(patientValue,'paciente'),cacheKey=key(tenant,patient);
      const cached=cache.get(cacheKey);
      if(!fresh&&!force&&cached&&Date.now()-cached.at<CACHE_TTL_MS)return cached.value;
      let output;
      try{output={available:true,reason:'',studies:compose(await queryStudies(tenant,patient))};}
      catch(error){
        if(!unavailable(error))throw error;
        output={available:false,reason:'La valoración fotográfica profesional todavía no está habilitada en esta clínica.',studies:[]};
      }
      cache.set(cacheKey,{at:Date.now(),value:output});
      return output;
    }

    async function findingSource(tenantValue,patientValue,findingValue,{force=false}={}){
      const tenant=uuid(tenantValue,'tenant'),patient=uuid(patientValue,'paciente'),findingId=uuid(findingValue,'hallazgo');
      const response=await list(tenant,patient,{fresh:force,force});
      if(!response?.available)return null;
      for(const study of response.studies||[]){
        const finding=(study.findings||[]).find(item=>item.id===findingId);
        if(!finding)continue;
        const decision=finding.latestDecision||finding.decision||null,correction=decision?.state==='corrected'&&decision.correction&&typeof decision.correction==='object'?decision.correction:{};
        const anatomy=correction.anatomy&&typeof correction.anatomy==='object'?correction.anatomy:(finding.anatomy&&typeof finding.anatomy==='object'?finding.anatomy:{});
        return Object.freeze({
          findingId,
          label:text(correction.label||finding.label||'Observación clínica',160)||'Observación clínica',
          description:text(correction.description||finding.description||'',2000),
          state:String(decision?.state||finding.initial_state||'pending'),
          anatomy:structured(anatomy),
          tooth:String(anatomy.fdi||'').slice(0,2),
          studyId:String(study.id||''),
          studyLabel:text(study.display_name||study.label||study.viewLabel||'Fotografía clínica',180)||'Fotografía clínica',
          modality:String(study.modality||'photograph'),
          subtype:String(study.subtype||''),
          acquiredAt:String(study.acquired_at||study.created_at||''),
          patientFileId:String(study.original?.id||study.original?.patientFileId||study.asset?.patient_file_id||'')
        });
      }
      return null;
    }

    function configuredUrl(){
      const edge=options.edgeUrl||root.EDGE_URL,base=options.supabaseUrl||root.SUPA_URL;
      if(!edge||!base)throw fail('La conexión de análisis no está configurada.','not_configured');
      const url=new URL(edge),origin=new URL(base);
      if(url.origin!==origin.origin||url.protocol!=='https:'||url.pathname!=='/functions/v1/claude'||url.search||url.hash||url.username||url.password)throw fail('La conexión de análisis no es válida.','invalid_endpoint');
      return url.href;
    }

    async function analyze(studyValues,{consent=false,signal}={}){
      const studyIds=[...new Set((Array.isArray(studyValues)?studyValues:[]).map(value=>uuid(value,'estudio')))];
      if(consent!==true)throw fail('Confirma la autorización antes de enviar fotografías al análisis.','consent_required');
      if(studyIds.length<1||studyIds.length>4)throw fail('Selecciona entre una y cuatro fotografías clínicas.','invalid_selection');
      const auth=await result(client.auth.getSession()),session=auth?.session;
      if(!session?.access_token||session.user?.is_anonymous!==false)throw fail('Tu sesión clínica venció. Vuelve a iniciar sesión.','session_required');
      const body={action:'analyze_clinical_photos_v1',requestId:root.crypto?.randomUUID?.()||String(Date.now()),studyIds,consent:true};
      const response=await fetch(configuredUrl(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`,apikey:options.publicKey||root.SUPA_KEY||''},body:JSON.stringify(body),signal,cache:'no-store',credentials:'omit',redirect:'error'});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){
        const messages={401:'Tu sesión venció. Vuelve a entrar antes de analizar.',403:'Tu rol no permite analizar evidencia clínica.',413:'Las fotografías son demasiado pesadas para analizarlas juntas.',429:'Se alcanzó el límite temporal de análisis de la clínica.'};
        throw fail(payload?.error||messages[response.status]||'No se completó el análisis. No se reintentó automáticamente.',payload?.code||'analysis_failed');
      }
      if(payload?.schema!==1||payload.persisted!==true||!Array.isArray(payload.studies))throw fail('El servidor no confirmó el guardado del análisis. No se marcará como completado.','invalid_analysis_response');
      invalidate();
      dispatch('smyl:clinical-photo-analysis',{studyIds,requestId:payload.requestId||'',studies:payload.studies});
      return payload;
    }

    async function decide({findingId,expectedRevision=0,state,correction={},note=''}){
      const id=uuid(findingId,'hallazgo');
      if(!['confirmed','corrected','rejected'].includes(state))throw fail('La decisión profesional no es válida.','invalid_decision');
      if(!Number.isInteger(expectedRevision)||expectedRevision<0)throw fail('La versión del hallazgo no es válida.','invalid_revision');
      const clean=state==='corrected'?structured(correction):{};
      if(state==='corrected'&&!Object.keys(clean).length)throw fail('Completa la corrección profesional.','invalid_correction');
      const saved=await result(client.rpc('smyl_evidence_decide_finding',{p_finding_id:id,p_expected_revision:expectedRevision,p_state:state,p_correction:clean,p_note:text(note,1000)}));
      invalidate();
      dispatch('smyl:clinical-photo-decision',{findingId:id,state,revision:saved?.revision||expectedRevision+1});
      return saved;
    }

    async function createManual({studyId,category='other',label,description='',anatomy={scope:'whole_mouth'},payload={}}){
      const id=uuid(studyId,'estudio');
      if(!FINDING_CATEGORIES.has(category))throw fail('La categoría clínica no es válida.','invalid_category');
      const title=text(label,160);if(!title)throw fail('Describe la observación profesional.','invalid_label');
      const saved=await result(client.rpc('smyl_evidence_create_finding',{
        p_id:uuid(root.crypto?.randomUUID?.(),'hallazgo'),p_study_id:id,p_origin:'professional',p_category:category,p_evidence_level:'image_observation',
        p_label:title,p_description:text(description,2000),p_anatomy:structured(anatomy),p_confidence:null,p_initial_state:'confirmed',p_model:null,p_payload:structured(payload)
      }));
      invalidate();
      dispatch('smyl:clinical-photo-manual-finding',{studyId:id,findingId:saved?.id||''});
      return saved;
    }

    async function setDisposition({studyId,expectedRevision=0,state,reason,note=''}){
      const id=uuid(studyId,'estudio');
      if(!DISPOSITION_STATES.has(state)||!DISPOSITION_REASONS.has(reason))throw fail('La resolución profesional de la fotografía no es válida.','invalid_disposition');
      if(!Number.isInteger(expectedRevision)||expectedRevision<0)throw fail('La versión de la valoración no es válida.','invalid_revision');
      const cleanNote=text(note,1000);
      if((state==='reviewed_no_findings'&&reason!=='no_visible_findings')||(state==='manual_only'&&reason!=='professional_manual_review')||(state==='not_evaluable'&&!['focus_insufficient','exposure_insufficient','orientation_uncertain','region_not_visible','artifact_or_obstruction','other'].includes(reason))||(reason==='other'&&cleanNote.length<2))throw fail('Completa el motivo de la resolución profesional.','invalid_disposition');
      const saved=await result(client.rpc('smyl_evidence_set_photo_disposition',{
        p_study_id:id,p_expected_revision:expectedRevision,p_state:state,p_reason:reason,p_note:cleanNote
      }));
      invalidate();
      dispatch('smyl:clinical-photo-disposition',{studyId:id,state,reason,revision:saved?.revision||expectedRevision+1});
      return saved;
    }

    async function loadOriginal(study){
      const file=study?.original;
      if(!file||file.status!=='active'||file.category!=='clinical_photo'||!PHOTO_MIME.has(file.mime_type)||!SHA.test(String(file.sha256||''))||!file.storage_path||!study?.tenant_id||!study?.patient_id||file.tenant_id!==study.tenant_id||file.patient_id!==study.patient_id)throw fail('El original privado no está disponible o no está verificado.','invalid_original');
      const downloaded=await client.storage.from('smyl-clinical-files').download(file.storage_path);
      if(downloaded?.error)throw downloaded.error;
      const blob=downloaded?.data;
      if(!(blob instanceof Blob)||blob.type!==file.mime_type||blob.size!==Number(file.size_bytes))throw fail('El archivo descargado no coincide con el original registrado.','original_mismatch');
      const digest=await root.crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
      const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(hash!==file.sha256)throw fail('El archivo descargado no superó la verificación de integridad.','original_mismatch');
      if(study?.id)Promise.resolve(client.rpc('smyl_evidence_log_open',{p_study_id:study.id})).catch(()=>{});
      const url=typeof URL?.createObjectURL==='function'?URL.createObjectURL(blob):'';
      return {blob,url,sha256:file.sha256,revoke:()=>{if(url)URL.revokeObjectURL(url);}};
    }

    return Object.freeze({indexPatientFile,list,findingSource,analyze,decide,createManual,setDisposition,loadOriginal,invalidate});
  }

  let singleton=null,singletonClient=null;
  function current(){
    const client=root.sb;
    if(!client)throw fail('El expediente clínico todavía no terminó de cargar.','not_configured');
    if(singletonClient!==client){singleton=create(client);singletonClient=client;}
    return singleton;
  }
  const delegate=name=>(...args)=>current()[name](...args);

  return Object.freeze({
    taxonomy:TAXONOMY,views:Object.freeze(Object.keys(TAXONOMY)),label:view=>TAXONOMY[subtype(view)].label,
    family:view=>TAXONOMY[subtype(view)].family,isSubtype:value=>Object.hasOwn(TAXONOMY,String(value||'')),normalizeRegion,
    create,indexPatientFile:delegate('indexPatientFile'),list:delegate('list'),findingSource:delegate('findingSource'),analyze:delegate('analyze'),decide:delegate('decide'),
    createManual:delegate('createManual'),setDisposition:delegate('setDisposition'),loadOriginal:delegate('loadOriginal'),invalidate:delegate('invalidate')
  });
});
