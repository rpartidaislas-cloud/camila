// Mantenimiento oportunista por clínica: limpia cargas abandonadas y reanaliza legado.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { FILE_RULES, inspectFile } from '../_shared/file-security.ts';
import { makeCors } from '../_shared/cors.ts';

const URL=Deno.env.get('SUPABASE_URL')||Deno.env.get('SB_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SB_SERVICE_ROLE_KEY')||'';
const admin=createClient(URL,SERVICE);

Deno.serve(async(req:Request)=>{
  const CORS=makeCors(req);
  const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
  const auth=await requireUser(req,CORS);if(auth.response)return auth.response;
  const tenant=auth.tenantId!,actor=auth.user!.id,started=new Date();
  try{
    const previous=await admin.from('smyl_file_maintenance_runs').select('last_started_at').eq('tenant_id',tenant).maybeSingle();
    if(previous.error)throw previous.error;
    if(previous.data&&Date.now()-Date.parse(previous.data.last_started_at)<12*60*60*1000)return reply(200,{ok:true,skipped:true});
    const begun=await admin.from('smyl_file_maintenance_runs').upsert({tenant_id:tenant,last_started_at:started.toISOString(),last_finished_at:null,deleted_count:0,rescanned_count:0,review_count:0,error_count:0},{onConflict:'tenant_id'});
    if(begun.error)throw begun.error;

    let deleted=0,rescanned=0,review=0,errors=0;
    const cleanup=await admin.rpc('smyl_file_cleanup_candidates',{p_tenant:tenant,p_limit:50});
    if(cleanup.error)throw cleanup.error;
    for(const item of cleanup.data||[]){
      try{
        const removed=await admin.storage.from(item.bucket_id).remove([item.object_path]);
        if(removed.error)throw removed.error;
        const confirmation=await admin.storage.from(item.bucket_id).download(item.object_path);
        if(!confirmation.error)throw new Error('El objeto continúa disponible después del borrado.');
        const logged=await admin.rpc('smyl_record_file_deletion',{p_tenant:tenant,p_bucket:item.bucket_id,p_path:item.object_path,p_reason:item.reason,p_existed:Array.isArray(removed.data)&&removed.data.length>0,p_actor:actor});
        if(logged.error)throw logged.error;deleted++;
      }catch(error){errors++;console.error('[file-lifecycle] cleanup',item.bucket_id,error instanceof Error?error.message:'error');}
    }

    // Retención del audio de MILA (mila_recordings.retention_until, 30 días): se borra el archivo del Storage y luego
    // la fila. Si el archivo ya no existe, remove() no falla y la fila se limpia igual en la siguiente pasada.
    const expiredAudio=await admin.from('mila_recordings').select('id,object_path').eq('tenant_id',tenant).lte('retention_until',new Date().toISOString()).limit(50);
    if(expiredAudio.error)throw expiredAudio.error;
    for(const recording of expiredAudio.data||[]){
      try{
        const removedAudio=await admin.storage.from('mila-audio').remove([recording.object_path]);
        if(removedAudio.error)throw removedAudio.error;
        const removedRow=await admin.from('mila_recordings').delete().eq('id',recording.id).eq('tenant_id',tenant);
        if(removedRow.error)throw removedRow.error;deleted++;
      }catch(error){errors++;console.error('[file-lifecycle] mila-audio',error instanceof Error?error.message:'error');}
    }

    const legacy=await admin.rpc('smyl_file_legacy_candidates',{p_tenant:tenant,p_limit:3});
    if(legacy.error)throw legacy.error;
    for(const item of legacy.data||[]){
      try{
        const rule=FILE_RULES[item.bucket_id];
        const downloaded=await admin.storage.from(item.bucket_id).download(item.object_path);
        if(downloaded.error||!downloaded.data)throw downloaded.error||new Error('Objeto no disponible');
        const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
        const inspected=await inspectFile(bytes);
        const reason=!rule||!inspected.mime||!rule.mime.includes(inspected.mime)?'El tipo histórico requiere revisión.':bytes.length>rule.max?'El tamaño histórico excede el límite actual.':inspected.reason;
        const saved=await admin.from('smyl_file_security').update({status:reason?'legacy_review':'clean',verified_mime_type:inspected.mime,verified_size_bytes:inspected.size,verified_sha256:inspected.sha256,rejection_reason:reason,last_checked_at:new Date().toISOString(),check_attempts:1,verified_by:actor,verified_at:reason?null:new Date().toISOString()}).eq('tenant_id',tenant).eq('bucket_id',item.bucket_id).eq('object_path',item.object_path).eq('status','legacy');
        if(saved.error)throw saved.error;rescanned++;if(reason)review++;
      }catch(error){
        errors++;review++;
        await admin.from('smyl_file_security').update({status:'legacy_review',rejection_reason:'No se pudo reanalizar el objeto histórico.',last_checked_at:new Date().toISOString(),check_attempts:1}).eq('tenant_id',tenant).eq('bucket_id',item.bucket_id).eq('object_path',item.object_path).eq('status','legacy');
        console.error('[file-lifecycle] legacy',item.bucket_id,error instanceof Error?error.message:'error');
      }
    }
    const finished=await admin.from('smyl_file_maintenance_runs').update({last_finished_at:new Date().toISOString(),deleted_count:deleted,rescanned_count:rescanned,review_count:review,error_count:errors}).eq('tenant_id',tenant);
    if(finished.error)throw finished.error;
    return reply(200,{ok:true,skipped:false,deleted,rescanned,review,errors});
  }catch(error){
    console.error('[file-lifecycle-maintenance]',error instanceof Error?error.message:'error desconocido');
    await admin.from('smyl_file_maintenance_runs').update({last_finished_at:new Date().toISOString(),error_count:1}).eq('tenant_id',tenant).eq('last_started_at',started.toISOString());
    return reply(500,{error:'No se pudo completar el mantenimiento de archivos.'});
  }
});
