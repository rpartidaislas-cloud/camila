/* Owner-only radiograph-review persistence. No fallback to browser storage. */
(function(){
 'use strict';
 async function connect(client,{tenant,patient,study,current}){
  const M=SmylRadiographReviewModel;
  async function checked(p){const r=await window.sbTimeout(p,20000);if(!current())throw Error('La ficha cambió.');if(r.error){if(r.error.code==='PT409')throw {...r.error,code:'40001'};throw r.error;}return r.data;}
  async function guard(){const data=await checked(client.auth.getUser());if(data?.user?.id!==tenant||data.user.is_anonymous!==false)throw Error('Abre la ficha con la cuenta titular.');}
  await guard();const caps=await checked(client.rpc('smyl_radiograph_review_capabilities'));
  if(caps?.schema!==1||caps.enabled!==true||caps.tenant_id!==tenant||caps.review_schema!==1)throw Error('Revisión asistida de radiografías no habilitada.');
  return {
   async load(){await guard();const row=await checked(client.from('smyl_radiograph_reviews').select('*').eq('tenant_id',tenant).eq('patient_id',patient).eq('study_id',study.id).maybeSingle());if(row&&!M.validRow(row,study,tenant,patient))throw Error('Revisión guardada no válida.');return row;},
   async save(document,revision){await guard();if(!M.validate(document,study))throw Error('La revisión no se puede guardar.');const saved=await checked(client.rpc('smyl_save_radiograph_review',{p_patient_id:patient,p_study_id:study.id,p_expected_revision:revision,p_document:document}));if(!M.validRow(saved,study,tenant,patient)||saved.revision!==revision+1||!M.same(saved.document,document))throw Error('No pudimos confirmar el guardado.');return saved;}
  };
 }
 window.SmylRadiographReviewStore={connect};
})();
