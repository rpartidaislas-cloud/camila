/* SMYL radiografía asistida — informe clínico asistido y firma (plan Etapa 5).
   El borrador se construye SÓLO con decisiones confirmadas o corregidas; la IA puede ordenar y
   redactar, nunca añadir piezas, diagnósticos, prioridades ni estudios (guarda determinista que
   compara el texto con los datos estructurados y rechaza cualquier adición). Secciones separadas:
   descripción radiográfica, limitaciones técnicas, correlación clínica por realizar, datos
   faltantes y estudios complementarios considerados por el profesional. Firma con usuario,
   profesional, fecha, versión y hash (servidor); después sólo adendas. Exportación con autoría,
   limitaciones y trazabilidad del original y del motor. Detrás de la bandera radiograph.report_v1. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./smyl-radiograph-contracts.js'):root.SmylRadiographContracts);if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylRadiographReport=api;})(typeof self!=='undefined'?self:this,function(C){
 'use strict';
 const SECTION_LABELS={description:'Descripción radiográfica',technicalLimitations:'Limitaciones técnicas',clinicalCorrelation:'Correlación clínica por realizar',missingInformation:'Preguntas y datos faltantes',complementaryStudies:'Estudios complementarios considerados por el profesional'};
 const PRIORITY_LABELS={routine:'Rutina',soon:'Pronto',urgent:'Urgente'};
 const FLAG_LABELS={motion_blur:'movimiento / desenfoque',anterior_blur:'desenfoque anterior',anatomical_cropping:'recorte anatómico',underexposure:'subexposición',overexposure:'sobreexposición',low_contrast:'bajo contraste',overlap:'superposición',compression_artifacts:'artefactos de compresión',orientation_suspect:'orientación sospechosa',foreign_object:'objeto extraño',unknown_study_class:'tipo de estudio incierto'};
 const STUDY_LABELS={panoramic:'panorámica',periapical:'periapical',bitewing:'aleta de mordida',intraoral_series:'serie intraoral',unknown:'tipo por confirmar'};
 const FDI_MENTION=/(?:pieza|diente|fdi|molar|premolar|canino|incisivo)\s*(?:n[°º.]?\s*)?#?\s*(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])\b/gi;
 const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const clean=v=>typeof v==='string'?v:'';
 const emptySections=()=>({description:'',technicalLimitations:'',clinicalCorrelation:'',missingInformation:'',complementaryStudies:''});
 // --- hallazgos admitidos: únicamente decisiones confirmadas/corregidas ------------------------
 function allowedFindings({entries=[],findings=[]}){
  const out=[];
  for(const e of entries){if(!['confirmed','corrected'].includes(e.state)||!e.fdi||e.evaluable===false)continue;
   out.push({candidateId:e.candidateId,tooth:e.fdi,kind:'tooth',text:'Pieza '+e.fdi+' localizada y verificada por el profesional'+(e.renumbered?' (renumerada; el modelo proponía '+e.fdiModel+')':'')+'.'+(e.note?' '+e.note:'')});}
  for(const f of findings){if(!['confirmed','corrected'].includes(f.state))continue;const missing=f.payload?.category==='apparently_missing';
   out.push({candidateId:f.candidateId,tooth:f.fdi||null,kind:'finding',text:(f.label||f.payload?.label||'Señal verificada')+(missing?' — aparentemente no visible en la radiografía; no implica ausencia, confirmar clínicamente.':'.')+(f.note?' '+f.note:'')});}
  return out;
 }
 function technicalLimitations(qc){
  if(!qc)return '';const parts=['Estudio '+(STUDY_LABELS[qc.studyClass?.value]||qc.studyClass?.value||'')+' según control de calidad; calidad '+({usable:'utilizable',limited:'limitada',unusable:'no utilizable'})[qc.quality?.status]+'.'];
  (qc.quality?.flags||[]).forEach(f=>parts.push((FLAG_LABELS[f.code]||f.code)+' ('+({low:'leve',moderate:'moderada',high:'alta'})[f.severity]+')'+(f.explanation?': '+f.explanation:'')));
  (qc.blockedAnalyses||[]).forEach(b=>parts.push('Análisis no aplicado: '+b.code+' — '+b.reason));
  return parts.join(' ');
 }
 // Borrador: conserva texto y prioridades previas del profesional para los mismos candidatos.
 function buildDraft({entries,findings,qc,previous}){
  const allowed=allowedFindings({entries,findings}),prev=new Map((previous?.findings||[]).map(f=>[f.candidateId,f]));
  const doc={schema:1,sections:Object.assign(emptySections(),previous?.sections||{}),findings:allowed.map(a=>{const p=prev.get(a.candidateId);return {candidateId:a.candidateId,tooth:a.tooth,text:p?p.text:a.text,priority:p?p.priority:'routine'};})};
  if(!previous?.sections?.technicalLimitations)doc.sections.technicalLimitations=technicalLimitations(qc);
  const removed=[...prev.keys()].filter(id=>!allowed.some(a=>a.candidateId===id));
  return {doc,removed,allowed};
 }
 // Diferencias entre datos estructurados y texto: piezas no sustentadas y afirmaciones de certeza.
 function diff(doc,{strict=false}={}){
  const warnings=[],teeth=new Set((doc.findings||[]).map(f=>f.tooth).filter(Boolean)),texts=Object.entries(doc.sections||{}).map(([k,v])=>[SECTION_LABELS[k]||k,clean(v)]).concat((doc.findings||[]).map((f,i)=>['Hallazgo '+(i+1),clean(f.text)]));
  for(const [where,text] of texts){
   for(const m of text.matchAll(FDI_MENTION)){if(!teeth.has(m[1]))warnings.push({code:'extra_tooth',where,tooth:m[1],text:where+' menciona la pieza '+m[1]+', que no está entre los hallazgos confirmados.'});}
   if(strict&&C.hasForbiddenClaim(text))warnings.push({code:'claim',where,text:where+' contiene una afirmación de certeza o diagnóstico que el modelo no puede hacer.'});
  }
  if(!clean(doc.sections?.description).trim())warnings.push({code:'empty_description',where:SECTION_LABELS.description,text:'La descripción radiográfica está vacía; la firma la exige.'});
  return {warnings,blocking:warnings.filter(w=>w.code!=='empty_description'&&(strict||w.code==='claim')).length>0};
 }
 // --- redacción asistida: orden y redacción, nunca contenido nuevo -----------------------------
 const ASSIST_SYSTEM=`Eres un apoyo de redacción para un informe radiográfico dental que un odontólogo ya decidió. NO eres un sistema de diagnóstico. Recibes un JSON con hallazgos confirmados (candidateId, tooth, text, priority) y secciones escritas por el profesional. Tu única tarea: ordenar los hallazgos de forma clínica y redactar con claridad y prudencia las secciones "description", "technicalLimitations", "clinicalCorrelation" y "missingInformation" usando EXCLUSIVAMENTE la información recibida. Prohibido: añadir piezas, hallazgos, diagnósticos, pronósticos, urgencias, mediciones, tratamientos, estudios o certezas; cambiar prioridades; mencionar piezas que no estén en los hallazgos; usar palabras como diagnóstico, confirmado, certeza, definitivo. La sección "complementaryStudies" no se redacta (la decide el profesional). Responde en español con un único objeto JSON sin markdown: {"findingsOrder":[candidateIds en el orden propuesto, todos y sólo los recibidos],"sections":{"description":"...","technicalLimitations":"...","clinicalCorrelation":"...","missingInformation":"..."}}. Máximo 1500 caracteres por sección.`;
 function parseAssist(raw,doc){
  let value=raw;if(typeof raw==='string'){try{value=JSON.parse(raw);}catch(_){throw Error('La redacción asistida no devolvió un JSON válido.');}}
  if(!isObj(value)||!Array.isArray(value.findingsOrder)||!isObj(value.sections))throw Error('La redacción asistida no cumple el contrato.');
  const ids=doc.findings.map(f=>f.candidateId),order=value.findingsOrder;
  if(order.length!==ids.length||new Set(order).size!==ids.length||!order.every(id=>ids.includes(id)))throw Error('La redacción asistida intentó añadir o quitar hallazgos; se descartó.');
  const sections=Object.assign({},doc.sections);
  for(const key of ['description','technicalLimitations','clinicalCorrelation','missingInformation']){const v=value.sections[key];if(v===undefined)continue;if(typeof v!=='string'||v.length>1500)throw Error('La sección "'+SECTION_LABELS[key]+'" devuelta no es válida.');sections[key]=v;}
  if(Object.keys(value.sections).some(k=>!['description','technicalLimitations','clinicalCorrelation','missingInformation'].includes(k)))throw Error('La redacción asistida devolvió secciones no permitidas.');
  const candidate={schema:1,sections,findings:order.map(id=>doc.findings.find(f=>f.candidateId===id))};
  const check=diff(candidate,{strict:true});
  if(check.blocking)throw Error('Se descartó la redacción asistida: '+check.warnings.filter(w=>w.code!=='empty_description').map(w=>w.text).join(' '));
  return candidate;
 }
 async function assist({client,tenant,doc,endpoint,publicKey,current,signal}){
  if(typeof current!=='function'||!current())throw Error('La ficha cambió.');
  if(!doc.findings.length)throw Error('No hay hallazgos confirmados que redactar.');
  const url=new URL(endpoint),base=new URL(root_url());
  if(url.origin!==base.origin||url.protocol!=='https:'||url.pathname!=='/functions/v1/claude'||url.search||url.hash)throw Error('Punto de acceso no permitido.');
  const session=await client.auth.getSession(),s=session.data?.session;if(session.error||!s?.access_token||s.user?.is_anonymous!==false)throw Error('Tu sesión venció. Vuelve a entrar.');
  const payload={findings:doc.findings,sections:{description:doc.sections.description,technicalLimitations:doc.sections.technicalLimitations,clinicalCorrelation:doc.sections.clinicalCorrelation,missingInformation:doc.sections.missingInformation},allowedTeeth:[...new Set(doc.findings.map(f=>f.tooth).filter(Boolean))]};
  const body=JSON.stringify({model:'claude-sonnet-4-6',max_tokens:3000,system:ASSIST_SYSTEM,messages:[{role:'user',content:[{type:'text',text:'Datos estructurados del informe (sólo ordenar y redactar, sin añadir nada):\n'+JSON.stringify(payload)}]}]});
  const response=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token,apikey:publicKey},body,signal,cache:'no-store',credentials:'omit',redirect:'error'});
  if(!current())throw Error('La ficha cambió.');
  if(!response.ok)throw Error(({401:'Tu sesión venció. Vuelve a entrar.',403:'Tu cuenta no tiene permiso para esta redacción.',402:'El plan no permite esta redacción ahora.',429:'El servicio está ocupado. Espera antes de intentar de nuevo.'})[response.status]||'El servicio no devolvió la redacción. No se reintentó automáticamente.');
  const raw=await response.text();if(raw.length>60000)throw Error('Respuesta demasiado extensa; se descartó.');const result=JSON.parse(raw);
  if(result.stop_reason!=='end_turn'||!Array.isArray(result.content)||result.content.length!==1||result.content[0].type!=='text')throw Error('La redacción quedó incompleta; se descartó.');
  return parseAssist(result.content[0].text,doc);
 }
 const root_url=()=>typeof window!=='undefined'&&window.SUPA_URL?window.SUPA_URL:'https://invalid.local';
 // --- interfaz ---------------------------------------------------------------------------------
 const n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const button=(text,fn,cls='rr-secondary')=>{const e=n('button',cls,text);e.type='button';e.onclick=fn;return e;};
 let active=null,seq=0;
 const errText=e=>{const code=e?.code||'';if(code==='PT409')return 'El informe cambió en otra sesión. Se recargó; revisa y vuelve a intentar.';if(code==='42501')return e.message||'Tu rol no tiene permiso para esta acción.';if(code==='23514')return e.message||'La acción no es válida en este estado.';if(typeof navigator!=='undefined'&&(!navigator.onLine||e instanceof TypeError))return 'Sin conexión. El borrador sigue en esta pantalla; vuelve a intentarlo cuando recuperes la red.';return e?.message||'No se pudo completar la acción.';};
 function confirmDialog(title,message,okLabel){return new Promise(resolve=>{const d=n('dialog','rr-confirm-dialog'),id='rp-confirm-'+(++seq),h=n('h2','',title),a=n('div','rr-confirm-actions');h.id=id;d.setAttribute('aria-labelledby',id);a.append(button('Cancelar',()=>{d.close();resolve(false);}),button(okLabel,()=>{d.close();resolve(true);},'rr-primary'));d.append(h,n('p','',message),a);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();a.lastChild.focus();});}
 function close(run=active,force=false){if(!run||run.closed)return false;if(!force&&(run.busy||run.dirty)){confirmDialog(run.busy?'Acción en proceso':'Borrador sin guardar','Si sales ahora se perderán los cambios no guardados del informe. Lo ya guardado o firmado se conserva.','Salir sin guardar').then(ok=>{if(ok)close(run,true);});return false;}run.closed=true;run.dialog.close();run.dialog.remove();if(active===run)active=null;run.focus?.focus?.({preventScroll:true});return true;}
 function connect(client,{current}){
  const checked=async p=>{const r=await window.sbTimeout(p,20000);if(!current())throw Error('La ficha cambió.');if(r.error)throw r.error;return r.data;};
  return {
   report:sourceId=>checked(client.from('smyl_radiograph_reports').select('*').eq('source_id',sourceId).maybeSingle()),
   addenda:reportId=>checked(client.from('smyl_radiograph_report_addenda').select('*').eq('report_id',reportId)),
   save:(reportId,sourceId,revision,doc)=>checked(client.rpc('smyl_radiograph_save_report_draft',{p_report_id:reportId,p_source_id:sourceId,p_expected_revision:revision,p_document:doc})),
   sign:(reportId,revision)=>checked(client.rpc('smyl_radiograph_sign_report',{p_report_id:reportId,p_expected_revision:revision})),
   addendum:(reportId,content,reason)=>checked(client.rpc('smyl_radiograph_add_report_addendum',{p_report_id:reportId,p_content:content,p_reason:reason})),
   export:reportId=>checked(client.rpc('smyl_radiograph_export_report',{p_report_id:reportId}))
  };
 }
 const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
 function printable(exported,study){
  const r=exported.report,d=r.document,when=r.signed_at?new Date(r.signed_at).toLocaleString('es-MX'):'';
  const secs=Object.entries(SECTION_LABELS).map(([k,l])=>'<h2>'+esc(l)+'</h2><p>'+esc(d.sections[k]||'—')+'</p>').join('');
  const finds=d.findings.length?'<ol>'+d.findings.map(f=>'<li><strong>'+(f.tooth?'Pieza '+esc(f.tooth):'Región general')+'</strong> · '+esc(PRIORITY_LABELS[f.priority]||f.priority)+' — '+esc(f.text)+'</li>').join('')+'</ol>':'<p>Sin hallazgos confirmados.</p>';
  const runs=(exported.runs||[]).map(x=>'<li>'+esc(x.kind)+' · '+esc(x.engine?.provider||'')+' / '+esc(x.engine?.name||'')+' '+esc(x.engine?.version||'')+' · contrato '+esc(x.contractVersion)+' · '+esc(x.status)+'</li>').join('');
  const addenda=(exported.addenda||[]).map(a=>'<li>'+esc(new Date(a.created_at).toLocaleString('es-MX'))+' — <em>'+esc(a.reason)+'</em>: '+esc(a.content)+'</li>').join('');
  return '<article class="rp-print-doc"><header><p class="rp-print-kicker">SMYL · Informe radiográfico (revisión asistida)</p><h1>'+esc(study?.label||'Radiografía')+'</h1><p>Fuente: '+esc(exported.source?.studyTypeCurrent||'')+' · SHA-256 '+esc((exported.source?.sha256||'').slice(0,16))+'… · '+esc(exported.source?.mimeType||'')+'</p></header>'
   +'<h2>Hallazgos confirmados por el profesional</h2>'+finds+secs
   +'<h2>Firma</h2><p>Firmado por usuario '+esc(r.signed_by||'')+' · profesional '+esc(r.signed_professional_id||'')+' · '+esc(when)+' · versión '+esc(r.revision)+' · hash '+esc(r.signed_hash||'')+'</p>'
   +'<h2>Trazabilidad del motor</h2><ul>'+(runs||'<li>Sin ejecuciones.</li>')+'</ul>'
   +(addenda?'<h2>Adendas</h2><ul>'+addenda+'</ul>':'')
   +'<p class="rp-print-notice">'+esc(exported.notice||'')+'</p></article>';
 }
 async function open({source,study,entries,findings,qc,tenant,patient,current,client,caps}){
  if(active){close();if(active)return;}
  client=client||window.sb;
  if(!source||typeof current!=='function'||!current()||!C){return;}
  const dialog=n('dialog','rr-dialog rv2-dialog rp-dialog'),bar=n('header','rr-bar'),host=n('div','rr-host rp-host'),run={dialog,host,source,study,tenant,patient,current,client,caps,api:connect(client,{current:()=>!run.closed&&current()}),row:null,addenda:[],doc:null,dirty:false,busy:false,closed:false,focus:document.activeElement,removedNotice:[]};
  active=run;
  const valid=()=>!run.closed&&current();
  const titleId='rp-title-'+(++seq),t=n('strong','','Informe radiográfico');t.id=titleId;dialog.setAttribute('aria-labelledby',titleId);
  bar.append(n('div','rr-identity',null),button('Volver a la revisión',()=>close(run)));bar.firstChild.append(n('span','rr-kicker','SMYL · RADIOGRAFÍA · INFORME'),t,n('span','rr-study-meta',study?.label||'Radiografía'));
  dialog.append(bar,host);document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>{e.preventDefault();close(run);});dialog.addEventListener('close',()=>close(run,true));
  const status=(text,kind='')=>{let e=host.querySelector('.rr-feedback');if(!e){e=n('p','rr-feedback');e.setAttribute('role','status');e.setAttribute('aria-live','polite');host.prepend(e);}e.className='rr-feedback '+kind;e.textContent=text;};
  async function reload(){run.row=await run.api.report(source.id);run.addenda=run.row?await run.api.addenda(run.row.id):[];const built=buildDraft({entries,findings,qc,previous:run.row?.document||null});run.doc=run.row?.status==='signed'?structuredClone(run.row.document):built.doc;run.removedNotice=run.row&&run.row.status!=='signed'?built.removed:[];run.dirty=false;}
  async function act(label,fn){if(run.busy||!valid())return;run.busy=true;render();let text,kind;try{await fn();text=label+': listo.';kind='rr-ok';}catch(e){if(e?.code==='PT409'){try{await reload();}catch(_){}}text=errText(e);kind='rr-error';}finally{run.busy=false;render();status(text,kind);}}
  const signed=()=>run.row?.status==='signed';
  function findingsPanel(){
   const panel=n('section','rp-findings'),head=n('header','rr-panel-head');head.append(n('span','rr-section-label','HALLAZGOS CONFIRMADOS'),n('h2','','Base del informe'),n('p','',signed()?'Hallazgos congelados por la firma.':'Sólo decisiones confirmadas o corregidas. Lo pendiente o descartado no aparece.'));panel.append(head);
   if(run.removedNotice.length){const w=n('p','rr-note rv2-conflict');w.setAttribute('role','status');w.textContent='⚠ '+run.removedNotice.length+' hallazgo(s) del borrador ya no están confirmados y se retiraron del informe.';panel.append(w);}
   const list=n('ol','rp-finding-list');
   run.doc.findings.forEach((f,i)=>{const li=n('li','rp-finding'),head=n('div','rp-finding-head');head.append(n('span','rr-number',String(i+1)),n('strong','',f.tooth?'Pieza FDI '+f.tooth:'Región general'));
    const pr=n('select');Object.entries(PRIORITY_LABELS).forEach(([v,l])=>pr.add(new Option(l,v)));pr.value=f.priority;pr.disabled=signed();pr.setAttribute('aria-label','Prioridad del hallazgo '+(i+1));pr.onchange=()=>{f.priority=pr.value;run.dirty=true;refreshDiff();};
    const text=n('textarea');text.rows=2;text.maxLength=600;text.value=f.text;text.readOnly=signed();text.setAttribute('aria-label','Texto del hallazgo '+(i+1));text.oninput=()=>{f.text=text.value;run.dirty=true;refreshDiff();};
    head.append(pr);li.append(head,text);if(!signed()){li.append(button('Quitar del informe',()=>{run.doc.findings.splice(i,1);run.dirty=true;render();},'rr-tertiary'));}list.append(li);});
   if(!run.doc.findings.length)list.append(n('li','rr-panel-empty','No hay hallazgos confirmados. Vuelve a la revisión por pieza y confirma lo que comprobaste.'));
   panel.append(list);
   if(!signed()){const restore=button('Restaurar hallazgos confirmados',()=>{run.doc=buildDraft({entries,findings,qc,previous:{sections:run.doc.sections,findings:run.doc.findings}}).doc;run.dirty=true;render();},'rr-tool');panel.append(restore);}
   return panel;
  }
  function diffPanel(){
   const box=n('section','rp-diff');box.setAttribute('aria-live','polite');const d=diff(run.doc);box.append(n('span','rr-section-label','DIFERENCIAS ENTRE DATOS Y TEXTO'));
   if(!d.warnings.length)box.append(n('p','rp-diff-ok','✓ El texto sólo menciona piezas con hallazgo confirmado y la descripción está completa.'));
   else{const ul=n('ul');d.warnings.forEach(w=>ul.append(n('li','rp-diff-'+w.code,(w.code==='claim'?'✕ ':'⚠ ')+w.text)));box.append(ul);}
   return box;
  }
  function refreshDiff(){const old=host.querySelector('.rp-diff');if(old)old.replaceWith(diffPanel());}
  function sectionsPanel(){
   const panel=n('section','rp-sections'),head=n('header','rr-panel-head');head.append(n('span','rr-section-label','TEXTO DEL INFORME'),n('h2','',signed()?'Informe firmado':'Redacción profesional'),n('p','',signed()?'Inmutable. Cualquier cambio va en una adenda.':'Puedes redactar tú o pedir apoyo para ordenar y redactar; la IA no añade contenido.'));panel.append(head);
   Object.entries(SECTION_LABELS).forEach(([key,label])=>{const field=n('label','rr-field',label),ta=n('textarea');ta.rows=key==='description'?5:3;ta.maxLength=4000;ta.value=run.doc.sections[key]||'';ta.readOnly=signed();ta.dataset.rpSection=key;ta.oninput=()=>{run.doc.sections[key]=ta.value;run.dirty=true;refreshDiff();};field.append(ta);panel.append(field);});
   return panel;
  }
  function signaturePanel(){
   const box=n('section','rp-signature');if(!signed())return box;const r=run.row;box.append(n('span','rr-section-label','FIRMA'),n('p','','Firmado el '+new Date(r.signed_at).toLocaleString('es-MX')+' · versión '+r.revision+' · usuario '+r.signed_by+(r.signed_professional_id?' · profesional '+r.signed_professional_id:'')),n('code','rp-hash','SHA-256 '+r.signed_hash));
   const list=n('ul','rp-addenda');run.addenda.slice().sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).forEach(a=>list.append(n('li','',new Date(a.created_at).toLocaleString('es-MX')+' — '+a.reason+': '+a.content)));box.append(n('h3','','Adendas ('+run.addenda.length+')'),list);
   if(run.caps?.clinicalApprove){const form=n('div','rp-addendum-form'),content=n('textarea'),reason=n('input');content.rows=3;content.maxLength=8000;content.placeholder='Contenido de la adenda';content.setAttribute('aria-label','Contenido de la adenda');reason.maxLength=500;reason.placeholder='Motivo';reason.setAttribute('aria-label','Motivo de la adenda');
    form.append(content,reason,button('Agregar adenda',()=>{if(content.value.trim().length<2||reason.value.trim().length<2){status('Escribe contenido y motivo de la adenda.','rr-error');return;}act('Adenda registrada',async()=>{await run.api.addendum(r.id,content.value,reason.value);await reload();});},'rr-primary'));box.append(form);}
   return box;
  }
  function actionsBar(){
   const bar=n('footer','rr-save rp-actions'),d=diff(run.doc);bar.dataset.dirty=String(run.dirty);bar.append(n('div','',null));bar.firstChild.append(n('strong','rr-save-title',signed()?'Informe firmado · sólo adendas':run.dirty?'Borrador sin guardar':run.row?'Borrador guardado · revisión '+run.row.revision:'Borrador nuevo'),n('span','rr-save-meta',run.doc.findings.length+' hallazgo(s) · '+d.warnings.length+' aviso(s)'));
   const acts=n('div','rp-action-buttons');
   if(!signed()){
    const save=button('Guardar borrador',()=>act('Borrador guardado',async()=>{const id=run.row?.id||crypto.randomUUID();await run.api.save(id,source.id,run.row?.revision||0,run.doc);await reload();}),'rr-secondary');save.disabled=run.busy;acts.append(save);
    const assistBtn=button('Ordenar y redactar con apoyo de IA',()=>{if(!run.doc.findings.length){status('No hay hallazgos confirmados que redactar.','rr-error');return;}act('Redacción asistida aplicada',async()=>{const next=await assist({client,tenant,doc:run.doc,endpoint:window.EDGE_URL,publicKey:window.SUPA_KEY,current:valid});run.doc=Object.assign(next,{sections:Object.assign(next.sections,{complementaryStudies:run.doc.sections.complementaryStudies})});run.dirty=true;});},'rr-tool');assistBtn.disabled=run.busy||!window.EDGE_URL;assistBtn.title='Sólo ordena y redacta lo confirmado; cualquier adición se descarta automáticamente.';acts.append(assistBtn);
    const sign=button('Firmar informe',async()=>{if(!run.caps?.clinicalApprove){status('Tu rol no puede firmar informes.','rr-error');return;}const check=diff(run.doc);if(check.warnings.some(w=>w.code==='empty_description')){status('Completa la descripción radiográfica antes de firmar.','rr-error');return;}if(check.warnings.some(w=>w.code==='extra_tooth')&&!await confirmDialog('El texto menciona piezas sin hallazgo','Hay piezas mencionadas en el texto que no tienen hallazgo confirmado. ¿Firmar de todos modos bajo tu responsabilidad?','Firmar de todos modos'))return;if(!await confirmDialog('Firmar informe','La firma es inmutable: queda con tu usuario, profesional, fecha, versión y hash. Después sólo podrás agregar adendas.','Firmar'))return;act('Informe firmado',async()=>{const id=run.row?.id||crypto.randomUUID();let row=run.row;if(run.dirty||!row){row=await run.api.save(id,source.id,row?.revision||0,run.doc);}await run.api.sign(row.id,row.revision);await reload();});},'rr-primary');sign.disabled=run.busy||!run.caps?.clinicalApprove;if(!run.caps?.clinicalApprove)sign.title='Requiere permiso de aprobación clínica.';acts.append(sign);
   }else{
    acts.append(button('Exportar (JSON)',()=>act('Exportación registrada',async()=>{const data=await run.api.export(run.row.id);const blob=new Blob([JSON.stringify(data,null,1)],{type:'application/json'}),url=URL.createObjectURL(blob),a=n('a');a.href=url;a.download='informe-radiografico-'+run.row.id.slice(0,8)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}),'rr-secondary'));
    acts.append(button('Vista para imprimir',()=>act('Vista generada',async()=>{const data=await run.api.export(run.row.id);const d=n('dialog','rp-print'),wrap=n('div','rp-print-wrap');wrap.innerHTML=printable(data,study);const actions=n('div','rr-confirm-actions');actions.append(button('Cerrar',()=>d.close()),button('Imprimir',()=>window.print(),'rr-primary'));d.append(wrap,actions);document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();}),'rr-primary'));
   }
   bar.append(acts);return bar;
  }
  function render(){
   if(!valid())return close(run,true);const fb=host.querySelector('.rr-feedback');host.replaceChildren();if(fb)host.prepend(fb);
   if(!run.doc){host.append(n('p','rr-feedback','Cargando informe…'));return;}
   const top=n('section','rr-review rp-review'),head=n('header','rr-review-head'),title=n('div');
   title.append(n('p','rr-step',signed()?'Informe firmado':'4 de 4 · Informe'),n('h1','','Informe radiográfico asistido'),n('p','rr-lead','Documento profesional construido sólo con tus decisiones. La IA puede ordenar y redactar; no añade hallazgos, diagnósticos ni estudios.'));head.append(title);top.append(head);
   const ws=n('div','rp-workspace');ws.append(findingsPanel(),sectionsPanel());top.append(ws,diffPanel(),signaturePanel(),actionsBar(),n('p','rr-note rr-safety-note','Revisión asistida: no es un diagnóstico automático. La firma registra usuario, profesional, fecha, versión y hash; después sólo adendas.'));host.append(top);
   if(run.busy)host.querySelectorAll('button,select,textarea,input').forEach(b=>{if(!b.closest('.rr-bar'))b.disabled=true;});
  }
  render();
  try{await reload();if(!valid())return;render();status(signed()?'Informe firmado el '+new Date(run.row.signed_at).toLocaleDateString('es-MX')+'. Sólo admite adendas.':run.row?'Borrador guardado · revisión '+run.row.revision+'.':'Borrador construido sólo con tus decisiones confirmadas.','rr-ok');}catch(e){if(valid()){status(errText(e),'rr-error');}}
 }
 const api={SECTION_LABELS,PRIORITY_LABELS,allowedFindings,technicalLimitations,buildDraft,diff,parseAssist,assist,ASSIST_SYSTEM,printable};
 if(typeof document!=='undefined'){api.open=open;api.close=()=>close(active,true);addEventListener('pagehide',()=>close(active,true));}
 return Object.freeze(api);
});
