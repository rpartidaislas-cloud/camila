/* Explicit, one-shot planning support. Text only; never saves or approves a plan. */
(function(){
 'use strict';
 const changed=()=>new Error('La ficha o la evidencia cambió. Vuelve a preparar el borrador.');
 async function suggest({client,tenant,input,current,endpoint,publicKey,signal}){
  const M=window.SmylTreatmentPlanModel;
  if(!M?.validateInput(input)||typeof current!=='function'||!current())throw changed();
  const url=new URL(endpoint),base=new URL(window.SUPA_URL);
  if(url.origin!==base.origin||url.protocol!=='https:'||url.pathname!=='/functions/v1/claude'||url.search||url.hash||url.username||url.password)throw changed();
  const controller=new AbortController();let timedOut=false;
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},90000);
  const check=()=>{if(controller.signal.aborted)throw new DOMException('Cancelado','AbortError');if(!current())throw changed();};
  try{
   const user=await client.auth.getUser();check();
   if(user.error||user.data?.user?.id!==tenant||user.data.user.is_anonymous!==false)throw changed();
   const session=await client.auth.getSession(),s=session.data?.session;check();
   if(session.error||s?.user?.id!==tenant||s.user.is_anonymous!==false||!s.access_token)throw changed();
   const body=JSON.stringify({action:'suggest_treatment_plan_v1',requestId:crypto.randomUUID(),context:input});
   if(body.length>90000)throw new Error('La información clínica es demasiado extensa para preparar el borrador.');
   const response=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token,apikey:publicKey},body,signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'});check();
   if(!response.ok){
    const messages={400:'La información confirmada cambió o no cumple el formato esperado.',401:'Tu sesión venció. Vuelve a entrar antes de generar el borrador.',403:'Esta función está disponible únicamente para la cuenta profesional autorizada.',402:'El servicio no está disponible para el plan actual.',429:'El servicio está ocupado. Espera antes de intentarlo de nuevo.'};
    throw new Error(messages[response.status]||'No se recibió un borrador seguro. No se guardó ningún cambio.');
   }
   const raw=await response.text();check();if(raw.length>100000)throw new Error('La respuesta fue demasiado extensa. No se aplicó ningún cambio.');
   const result=JSON.parse(raw);
   if(result.stop_reason!=='end_turn'||!Array.isArray(result.content)||result.content.length!==1||result.content[0].type!=='text')throw new Error('El borrador quedó incompleto. No se aplicó ningún cambio.');
   const draft=M.parse(JSON.parse(result.content[0].text),input);check();
   const after=await client.auth.getSession();if(after.error||after.data?.session?.user?.id!==tenant||after.data.session.user.is_anonymous!==false)throw changed();
   return {draft,model:'claude-sonnet-4-6',at:new Date().toISOString(),requestId:typeof result.id==='string'&&/^msg_[a-zA-Z0-9_-]{1,100}$/.test(result.id)?result.id:''};
  }catch(e){
   if(timedOut)throw new Error('La espera terminó. La solicitud pudo haberse procesado, pero no se aplicó ningún cambio ni se reintentó automáticamente.');
   if(e.name==='SyntaxError')throw new Error('No pudimos interpretar un borrador seguro. No se aplicó ningún cambio.');
   throw e;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 window.SmylTreatmentPlanClient={suggest};
})();
