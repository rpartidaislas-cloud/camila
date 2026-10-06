/* Owner-only persistence through a dedicated RPC; no AI, browser storage or silent fallback. */
(function(){
 'use strict';
 async function connect(client,row,current){
  const M=SmylPhotoReviewModel;
  async function checked(p){const r=await window.sbTimeout(p,20000);if(!current())throw new Error('La ficha cambió.');if(r.error){
   // Keep the UI conflict contract, without asking PostgREST to retry a business conflict.
   if(r.error.code==='PT409')throw {...r.error,code:'40001',serverCode:'PT409'};
   throw r.error;
  }return r.data;}
  async function guard(){const data=await checked(client.auth.getUser());if(data?.user?.id!==row.tenant_id||data.user.is_anonymous!==false)throw new Error('Abre la ficha con la cuenta titular.');}
  await guard();const caps=await checked(client.rpc('smyl_photo_review_capabilities'));
  if(caps?.schema!==1||caps.enabled!==true||caps.tenant_id!==row.tenant_id)throw new Error('Guardado de revisiones no habilitado.');
  return {
   multiEvidence:caps.review_schema===2&&caps.multi_evidence===true,
   async load(){await guard();const saved=await checked(client.from('smyl_photo_reviews').select('*').eq('tenant_id',row.tenant_id).eq('patient_id',row.patient_id).eq('case_id',row.id).maybeSingle());if(saved&&!M.validRow(saved,row))throw new Error('Revisión guardada no válida. No se reemplazó.');return saved;},
   async save(document,revision){await guard();if(!M.validate(document,row)||(document.schema===2&&!(caps.review_schema===2&&caps.multi_evidence===true)))throw new Error('La revisión no se puede guardar.');
    const saved=await checked(client.rpc('smyl_save_photo_review',{p_case_id:row.id,p_expected_revision:revision,p_document:document}));
    if(!M.validRow(saved,row)||saved.revision!==revision+1||!M.same(saved.document,document))throw new Error('No pudimos confirmar el guardado.');return saved;
   }
  };
 }
 window.SmylPhotoReviewStore={connect};
})();
