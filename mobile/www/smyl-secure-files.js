/* SMYL private-file gate. Upload first, then call the private verifier before
 * linking the object to any clinical or professional record. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SmylSecureFiles=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  async function sha256(file){
    var digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');
  }
  async function verify(client,bucket,path,file,knownSha){
    if(!client||!client.functions||!file||!path)throw new Error('No se pudo preparar la verificación del archivo.');
    var hash=knownSha||await sha256(file);
    var result=await client.functions.invoke('secure-clinical-file',{body:{bucket:bucket,path:path,mime_type:file.type,size_bytes:file.size,sha256:hash}});
    if(result.error)throw result.error;
    if(!result.data||result.data.ok!==true||result.data.sha256!==hash||result.data.size_bytes!==file.size||result.data.mime_type!==file.type)throw new Error('No se confirmó la seguridad del archivo.');
    return result.data;
  }
  var maintenanceStarted=false,maintenanceInvoked=false;
  function startMaintenance(client){
    if(maintenanceStarted||!client||!client.auth)return;maintenanceStarted=true;
    function run(session){if(!session||maintenanceInvoked)return;maintenanceInvoked=true;setTimeout(function(){client.functions.invoke('file-lifecycle-maintenance',{body:{}}).catch(function(){});},0);}
    client.auth.getSession().then(function(result){run(result&&result.data&&result.data.session);}).catch(function(){});
    client.auth.onAuthStateChange(function(event,session){if(event==='SIGNED_IN')run(session);});
  }
  return {sha256:sha256,verify:verify,startMaintenance:startMaintenance};
});
