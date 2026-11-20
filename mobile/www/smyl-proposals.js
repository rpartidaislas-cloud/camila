/* Stage 4: professional proposal workspace; no automatic messaging or AI calls. */
(function(){
  'use strict';
  var M=SmylProposalModel,ctx=null,sequence=0,lineSequence=0;
  function n(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function b(text,fn,cls){var e=n('button',cls||'btn btn-secondary',text);e.type='button';e.addEventListener('click',fn);return e;}
  function skel(kind,opts){return window.SmylSkeleton?window.SmylSkeleton.node(kind,opts):notice((opts&&opts.label)||'Cargando…');}
  function notice(text,error){var e=n('p','clinic-notice'+(error?' clinic-error':''),text);e.setAttribute('role',error?'alert':'status');return e;}
  function field(label,id,value,type){var wrap=n('div','clinic-field'),input=n(type==='textarea'?'textarea':'input'),lbl=n('label','',label);input.id=id;lbl.htmlFor=id;if(type&&type!=='textarea')input.type=type;input.value=value==null?'':value;wrap.append(lbl,input);return wrap;}
  async function checked(query){var res=await sbTimeout(query,30000);if(res.error)throw res.error;return res.data;}
  async function capabilities(tenant){if(window.miRolEquipo==='dueño')return {read:true,write:true,approve:true,followup:true,finance:true};var auth=await window.sb.auth.getUser(),actor=auth.data&&auth.data.user&&auth.data.user.id;if(!actor)return {read:false,write:false,approve:false,followup:false};var assignments=await checked(window.sb.from('smyl_member_roles').select('role_id').eq('tenant_id',tenant).eq('user_id',actor)),ids=(assignments||[]).map(function(x){return x.role_id;});if(!ids.length)return {read:false,write:false,approve:false,followup:false};var rows=await checked(window.sb.from('smyl_role_permissions').select('permission_key').eq('tenant_id',tenant).in('role_id',ids)),perms=new Set((rows||[]).map(function(x){return x.permission_key;}));return {read:perms.has('proposal.read'),write:perms.has('proposal.write'),approve:perms.has('proposal.approve'),followup:perms.has('proposal.followup'),finance:perms.has('finance.read')};}
  function errorText(error){if(['40001','PT409'].includes(error.code))return 'El plan o la propuesta cambió, o su vigencia terminó. Conservamos tus cambios; vuelve a cargar la propuesta o actualiza su plan y revisa de nuevo.';if(['42P01','PGRST202','PGRST205'].includes(error.code))return 'Propuestas aún no está habilitado en la base de datos. Falta activar esta etapa.';return SmylClinicalModel.errorMessage(error);}
  function feedback(text,error){var host=document.getElementById('proposal-feedback');if(host)host.replaceChildren(notice(text,error));}
  function cleanup(){if(ctx)Object.values(ctx.files).forEach(function(f){if(f)URL.revokeObjectURL(f.url);});ctx=null;sequence++;}
  function leave(){if(ctx&&ctx.busy){alert('Espera a que termine la operación.');return false;}if(ctx&&ctx.dirty&&!confirm('Hay cambios sin guardar en la propuesta. ¿Quieres descartarlos?'))return false;cleanup();return true;}
  // Sucursal de la propuesta: el precio de cada concepto sale del precio de esa sede (si tiene uno propio) y queda congelado al guardar.
  function branchById(id){return ((ctx&&ctx.branches)||[]).find(function(b){return b.id===id;})||null;}
  function branchLabel(id){var b=branchById(id);return b?b.name:'';}
  // Dónde se atenderá: dirección y teléfono de la sede, para el paciente (vista previa y PDF).
  function branchDetail(id){var b=branchById(id);if(!b)return '';return [[b.address_line,b.city,b.state].filter(Boolean).join(', '),b.phone?'Tel. '+b.phone:''].filter(Boolean).join(' · ');}
  function withBranch(row){var multi=ctx&&ctx.branches&&ctx.branches.length>1;row.branch_label=multi?branchLabel(row.branch_id):'';row.branch_detail=multi?branchDetail(row.branch_id):'';return row;}
  function branchUnitCents(item,branchId){
    if(!item||!item.service_id)return undefined;
    var own=(ctx.branchPrices||[]).find(function(x){return x.service_id===item.service_id&&x.branch_id===branchId;});
    if(own)return Math.round(Number(own.price)*100);
    var snap=item.service_snapshot;
    return snap&&snap.reference_price!=null?Math.round(Number(snap.reference_price)*100):undefined;
  }
  function currentBranchId(){var select=document.getElementById('proposal-branch');return select?select.value||null:(ctx&&ctx.branchId)||null;}
  function repriceDocument(doc,branchId){doc.items.forEach(function(item){var cents=branchUnitCents(item,branchId);if(cents!==undefined)item.unit_cents=cents;});}
  function repriceLines(branchId){
    var changes=[];
    document.querySelectorAll('.proposal-item').forEach(function(row){
      if(row.dataset.priceManual==='1')return;
      var meta=JSON.parse(row.dataset.itemMeta||'{}'),cents=branchUnitCents(meta,branchId),input=row.querySelector('[data-field="price"]');
      if(cents===undefined||!input)return;
      var next=(cents/100).toFixed(2);if(input.value!==next)changes.push([input,next]);
    });
    return changes;
  }
  var listBranches=new Map();
  function rowFromForm(){
    var doc={schema:2,title:document.getElementById('proposal-title').value.trim(),introduction:document.getElementById('proposal-intro').value.trim(),terms:document.getElementById('proposal-terms').value.trim(),valid_until:document.getElementById('proposal-valid').value,items:[],photos:null};
    document.querySelectorAll('.proposal-item').forEach(function(row){var meta=JSON.parse(row.dataset.itemMeta||'{}');doc.items.push(Object.assign(meta,{label:row.querySelector('[data-field="label"]').value.trim(),area:row.querySelector('[data-field="area"]').value.trim(),quantity:Number(row.querySelector('[data-field="quantity"]').value),unit_cents:M.cents(row.querySelector('[data-field="price"]').value),currency:'MXN'}));});
    if(document.getElementById('proposal-include-photos').checked)doc.photos={before_path:ctx.files.before?ctx.files.before.path:ctx.photoPaths?.before_path||'',simulation_path:ctx.files.simulation?ctx.files.simulation.path:ctx.photoPaths?.simulation_path||'',view:document.getElementById('proposal-view').value};
    return {...ctx.row,document:doc,plan_revision:ctx.plan.revision,branch_id:currentBranchId()};
  }
  function changed(){if(!ctx)return;ctx.dirty=JSON.stringify(rowFromForm().document)!==ctx.saved||ctx.plan.revision!==ctx.row.plan_revision;document.getElementById('proposal-approval-check').checked=false;controls();}
  function acceptedCurrent(){return !!ctx&&(ctx.events||[]).some(function(event){return event.proposal_revision===ctx.row.revision&&event.event_type==='accepted';});}
  function controls(){
    if(!ctx)return;
    document.getElementById('proposal-form').disabled=ctx.busy||!ctx.access.write;
    var doc=rowFromForm().document,approved=ctx.row.status==='approved'&&!ctx.dirty&&!ctx.stale;
    document.getElementById('proposal-state').textContent=ctx.busy?'Procesando…':ctx.stale?'Plan actualizado: requiere revisión':ctx.dirty?'Cambios sin guardar':approved?'Aprobada · no enviada':ctx.row.revision?'Borrador guardado':'Borrador nuevo';
    document.getElementById('proposal-estimate').textContent=doc.items.some(function(i){return i.unit_cents===null;})?'Total por completar':M.money(M.total(doc));
    document.getElementById('proposal-save').disabled=ctx.busy||ctx.stale||!ctx.access.write;
    document.getElementById('proposal-preview').disabled=ctx.busy||!ctx.access.write;
    document.getElementById('proposal-export').disabled=ctx.busy||!approved;
    var accepted=acceptedCurrent(),charge=document.getElementById('proposal-to-charges');if(charge)charge.disabled=ctx.busy||!approved||ctx.stale||!accepted;
    var schedule=document.getElementById('proposal-to-schedule');if(schedule)schedule.disabled=ctx.busy||!approved||ctx.stale||!accepted;
    var activation=document.getElementById('proposal-activation-state');if(activation){activation.textContent=accepted?'Lista para activar':'Esperando aceptación';activation.dataset.state=accepted?'accepted':'pending';}
    var activationFold=document.querySelector('.proposal-activation');if(activationFold&&accepted&&!activationFold.dataset.autoOpened){activationFold.open=true;activationFold.dataset.autoOpened='true';}
    var activationCopy=document.getElementById('proposal-activation-copy');if(activationCopy)activationCopy.textContent=accepted?'La aceptación corresponde a esta versión. Caja y Agenda conservan sus permisos y validaciones propias.':'Registra primero la presentación y la aceptación de esta versión. Aprobar internamente no autoriza cargos ni citas.';
    var followup=document.getElementById('proposal-followup');if(followup)followup.disabled=ctx.busy||!approved||!ctx.row.revision;
    var shareBtn=document.getElementById('proposal-share');if(shareBtn)shareBtn.disabled=ctx.busy||!approved||!ctx.access.followup;
    var eventButton=document.getElementById('proposal-record-event');if(eventButton)eventButton.disabled=ctx.busy||ctx.eventsLoading||!approved||!ctx.access.followup||ctx.decisionFinal;
    ['proposal-event-type','proposal-event-channel','proposal-event-note'].forEach(function(id){var input=document.getElementById(id);if(input)input.disabled=ctx.busy||ctx.eventsLoading||!approved||!ctx.access.followup||ctx.decisionFinal;});
    document.getElementById('proposal-add').disabled=ctx.busy||!ctx.access.write||doc.items.length>=20;
    document.getElementById('proposal-photo-inputs').hidden=!document.getElementById('proposal-include-photos').checked;
    document.getElementById('proposal-approve').disabled=ctx.busy||ctx.stale||!ctx.access.approve||!document.getElementById('proposal-approval-check').checked;
  }
  function addLine(item){
    if(document.querySelectorAll('.proposal-item').length>=20)return;item=item||{label:'',area:'',quantity:1,unit_cents:null};lineSequence++;
    var row=n('article','proposal-item'),meta=M.metadata(item,lineSequence-1);row.dataset.itemMeta=JSON.stringify(meta);
    [['Concepto','label',item.label,'text'],['Zona · opcional','area',item.area,'text'],['Cantidad','quantity',item.quantity,'number'],['Precio por unidad · MXN','price',item.unit_cents===null?'':(item.unit_cents/100).toFixed(2),'text']].forEach(function(e){var f=field(e[0],'proposal-line-'+lineSequence+'-'+e[1],e[2],e[3]);f.lastChild.dataset.field=e[1];if(e[1]==='quantity'){f.lastChild.min='1';f.lastChild.max='100';f.lastChild.step='1';}else{f.lastChild.maxLength=e[1]==='price'?10:200;}if(e[1]==='price'){f.lastChild.inputMode='decimal';f.lastChild.placeholder='Por definir';}row.append(f);});
    var priceInput=row.querySelector('[data-field="price"]');if(priceInput)priceInput.addEventListener('input',function(ev){if(ev.isTrusted)row.dataset.priceManual='1';});
    if(meta.teeth.length){var target=n('p','proposal-item-target','Mapa dental · piezas '+meta.teeth.join(', ')+(meta.surfaces.length?' · superficies '+meta.surfaces.join(', '):''));row.append(target);}
    if(meta.service_snapshot){var fiscal=n('small','proposal-item-fiscal','Catálogo v'+meta.service_revision+' · SAT '+(meta.service_snapshot.sat_product_service_code||'por definir')+' · '+(meta.service_snapshot.fiscal_status==='reviewed'?'fiscal revisado':'revisión fiscal pendiente'));row.append(fiscal);}
    row.append(b('Quitar concepto',function(){row.remove();changed();},'clinic-remove'));document.getElementById('proposal-items').append(row);
  }
  async function selectPhoto(kind,file){
    var current=ctx;if(!file||!current||current.busy)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024){feedback('Usa una foto JPG, PNG o WebP de hasta 8 MB.',true);return;}
    current.busy=true;controls();var url=URL.createObjectURL(file);
    try{
      var image=new Image();image.src=url;await image.decode();
      if(image.width*image.height>60000000)throw new Error('Image too large');
      var scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);var g=canvas.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height);g.drawImage(image,0,0,canvas.width,canvas.height);
      var blob=await new Promise(function(resolve){canvas.toBlob(resolve,'image/jpeg',.92);});if(!blob)throw new Error('Image unavailable');
      if(ctx!==current)return;
      if(current.files[kind])URL.revokeObjectURL(current.files[kind].url);
      current.files[kind]={blob:blob,url:URL.createObjectURL(blob),path:current.tenant+'/'+current.row.id+'/'+crypto.randomUUID()+'-'+kind+'.jpg',uploaded:false};
      document.getElementById('proposal-photo-'+kind).src=current.files[kind].url;document.getElementById('proposal-photo-'+kind).hidden=false;
      document.getElementById('proposal-pair-check').checked=false;changed();
    }catch(_){if(ctx===current)feedback('No pudimos leer esa fotografía. Intenta con otro archivo.',true);}
    finally{URL.revokeObjectURL(url);current.busy=false;if(ctx===current)controls();}
  }
  function validForm(approve){
    var doc=rowFromForm().document,problem=M.valid(doc,approve);
    if(!problem&&approve&&ctx.branches.length>1&&!currentBranchId())return 'Elige la sucursal donde se atenderá esta propuesta.';
    var invalidPrice=Array.from(document.querySelectorAll('[data-field="price"]')).some(function(input){return input.value.trim()!==''&&M.cents(input.value)===null;});
    if(invalidPrice)return 'Revisa los precios. Escribe, por ejemplo, 1250.50, sin símbolo $ ni separadores de miles.';
    if(problem)return problem;
    if(doc.photos&&(!doc.photos.before_path||!doc.photos.simulation_path))return 'Carga tanto la foto original como su simulación, o desactiva la comparación.';
    if(doc.photos&&!document.getElementById('proposal-pair-check').checked)return 'Confirma que las dos imágenes corresponden al paciente y a la misma vista.';
    return '';
  }
  async function uploadPhotos(current,doc){
    if(!doc.photos)return;
    for(var key of ['before','simulation']){
      var file=current.files[key];if(!file||file.uploaded)continue;
      var res=await sbTimeout(sb.storage.from('smyl-proposal-photos').upload(file.path,file.blob,{contentType:'image/jpeg',upsert:false}),30000);
      // UUID path is stable for this selected file; a timeout may have completed.
      if(res.error&&String(res.error.statusCode)!=='409')throw res.error;
      await window.SmylSecureFiles.verify(sb,'smyl-proposal-photos',file.path,file.blob);
      file.uploaded=true;
    }
  }
  async function assetsFor(row,current,useLocal){
    var assets={};if(!row.document.photos)return assets;
    for(var kind of ['before','simulation']){
      if(useLocal&&current.files[kind])assets[kind]=current.files[kind].url;
      else{var path=row.document.photos[kind==='before'?'before_path':'simulation_path'];var data=await checked(sb.storage.from('smyl-proposal-photos').createSignedUrl(path,300));if(!data?.signedUrl)throw new Error('Photo unavailable');assets[kind]=data.signedUrl;}
    }
    return assets;
  }
  async function saveRpc(current,row,approve){
    var args={p_id:row.id,p_tenant_id:current.tenant,p_patient_id:row.patient_id,p_plan_revision:row.plan_revision,p_expected_revision:current.row.revision||0,p_document:row.document,p_approve:approve};
    if(current.branches.length>1||row.branch_id){
      try{return await checked(sb.rpc('smyl_save_proposal_v3',Object.assign({},args,{p_branch_id:row.branch_id||null})));}
      catch(error){
        // Si la base aún no tiene la función nueva, se guarda como antes (sin sucursal) y se avisa.
        if(!/smyl_save_proposal_v3|PGRST202|42883|schema cache/i.test(String(error&&(error.message||'')+' '+(error&&error.code||''))))throw error;
        current.branchUnsupported=true;
      }
    }
    return checked(sb.rpc('smyl_save_proposal_v2',args));
  }
  async function save(approve){
    if(!ctx||ctx.busy||ctx.stale||!ctx.access.write||(approve&&!ctx.access.approve))return;
    var problem=validForm(approve);if(problem){feedback(problem,true);document.getElementById('proposal-preview-dialog').close();return;}
    if(approve&&!document.getElementById('proposal-approval-check').checked)return;
    var current=ctx,row=rowFromForm();current.busy=true;document.getElementById('proposal-form').disabled=true;controls();
    document.getElementById('proposal-preview-dialog').close();
    try{
      await uploadPhotos(current,row.document);
      var saved=await saveRpc(current,row,approve);
      if(Array.isArray(saved))saved=saved[0];
      if(!saved||saved.id!==row.id||saved.tenant_id!==current.tenant||saved.patient_id!==row.patient_id||!saved.revision)throw new Error('Unconfirmed save');
      if(ctx!==current)return;
      current.row=saved;current.photoPaths=saved.document.photos;current.saved=JSON.stringify(saved.document);current.dirty=false;current.events=[];current.decisionFinal=false;
      feedback((approve?'Propuesta aprobada y guardada. Ya puedes preparar el PDF; no se ha enviado a nadie.':'Borrador guardado. Los cambios aún necesitan revisión.')+(current.branchUnsupported?' La sucursal no se guardó: falta actualizar la base de datos con el SQL de sucursales.':''));
      document.getElementById('proposal-versions').open=false;
      renderEvents();if(approve)loadEvents();
    }catch(error){if(ctx===current){feedback(errorText(error),true);if(['40001','PT409'].includes(error.code))current.stale=true;}}
    finally{current.busy=false;if(ctx===current){document.getElementById('proposal-form').disabled=false;controls();}}
  }
  async function preview(){
    if(!ctx||ctx.busy)return;var problem=validForm(false);if(problem){feedback(problem,true);return;}
    var current=ctx;current.busy=true;controls();document.getElementById('proposal-feedback').replaceChildren();
    try{var row=rowFromForm(),assets=await assetsFor(row,current,true);if(ctx!==current)return;
      var host=document.getElementById('proposal-preview-paper');withBranch(row);host.replaceChildren(SmylProposalPrint.render(row,assets,false));
      await Promise.all(Array.from(host.querySelectorAll('img')).map(function(img){return img.decode();}));
      document.getElementById('proposal-approval-check').checked=false;document.getElementById('proposal-preview-dialog').showModal();
    }catch(error){if(ctx===current)feedback('No se pudo preparar la vista previa. Revisa las fotografías y vuelve a intentar.',true);}
    finally{current.busy=false;if(ctx===current)controls();}
  }
  // ── Compartir con el paciente (enlace privado, propuesta.html) ─────────────────────────────────────────────
  // El doctor elige qué viaja; plan y precios siempre. Se envía una copia congelada: si edita después, no cambia lo ya enviado.
  async function shareCall(body){
    var res=await window.sb.functions.invoke('smyl-proposal-share',{body:body}),data=res&&res.data,err=res&&res.error;
    if(err&&err.context&&typeof err.context.json==='function'){try{data=await err.context.json();}catch(e){}}
    if(!data||data.error)throw new Error((data&&data.error)||'No se pudo completar la acción.');
    return data;
  }
  function shareWhen(v){return v?new Date(v).toLocaleDateString('es-MX',{day:'numeric',month:'short'}):'';}
  var shareStateLabel={active:'Activo',accepted:'Aceptado',revoked:'Cancelado',expired:'Vencido'};
  function shareDate(v){return v?new Date(v).toLocaleString('es-MX',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';}
  async function openShare(){
    if(!ctx||ctx.busy||ctx.dirty||ctx.stale||ctx.row.status!=='approved'||!ctx.access.followup)return;
    var doc=ctx.row.document||{},hasTeeth=(doc.items||[]).some(function(i){return i.teeth&&i.teeth.length;}),hasPhotos=!!(doc.photos&&doc.photos.before_path&&doc.photos.simulation_path);
    var dlg=n('dialog','proposal-share-dialog');dlg.style.cssText='border:1px solid #DCE4EC;border-radius:16px;padding:20px;width:min(520px,calc(100% - 28px));';
    var form=n('form');form.method='dialog';
    function check(id,text,on,disabled){var l=n('label','clinic-confirm'),c=n('input');c.type='checkbox';c.id=id;c.checked=!!on;c.disabled=!!disabled;l.append(c,document.createTextNode(' '+text));return l;}
    form.append(n('h2','','Compartir con el paciente'),n('p','proposal-small','Se genera un enlace privado con lo que elijas. El paciente ve una copia de hoy: si editas la propuesta después, crea otro enlace.'));
    form.append(check('share-plan','Plan y precios (siempre)',true,true));
    if(hasTeeth)form.append(check('share-odontogram','Odontograma: dónde se hará el tratamiento',false));
    if(hasPhotos)form.append(check('share-photos','Fotografías y simulación (antes/después)',false));
    form.append(check('share-history','Resumen de historial',false));
    var hist=n('textarea');hist.id='share-history-text';hist.rows=4;hist.maxLength=1200;hist.hidden=true;hist.placeholder='Escribe solo lo que quieres que el paciente vea. No se copia nada del expediente automáticamente.';hist.style.cssText='width:100%;margin:6px 0';
    form.append(hist);
    var pay=n('textarea');pay.id='share-payment';pay.rows=2;pay.maxLength=500;pay.placeholder='Formas de pago (opcional). Ej. Contado, transferencia o tarjeta; pregunta por parcialidades.';pay.style.cssText='width:100%;margin:10px 0 6px';form.append(pay);
    var days=n('select');days.id='share-days';[7,15,30].forEach(function(d){days.append(new Option('Vence en '+d+' días',String(d)));});days.value='15';days.style.cssText='width:100%;margin-bottom:10px';form.append(days);
    var status=n('div');status.id='share-status';form.append(status);
    var list=n('div','proposal-event-list');list.id='share-list';form.append(list);
    var actions=n('div','proposal-actions');actions.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:12px';
    var close=b('Cerrar',function(){dlg.close();});var make=b('Crear enlace',null,'btn btn-primary');make.type='submit';actions.append(close,make);form.append(actions);dlg.append(form);document.body.append(dlg);
    dlg.addEventListener('close',function(){dlg.remove();});
    dlg.querySelector('#share-history').onchange=function(e){hist.hidden=!e.target.checked;};
    function note(text,error){status.replaceChildren(notice(text,error));}
    async function refresh(){
      try{var res=await shareCall({action:'list',proposal_id:ctx.row.id});list.replaceChildren();
        (res.shares||[]).forEach(function(sh){var row=n('div','proposal-event-row');row.style.cssText='display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #E5E7EB;font-size:13px';
          var info=(shareStateLabel[sh.state]||sh.state)+' · '+shareDate(sh.created_at)+(sh.open_count?' · abierto '+sh.open_count+' vez(es)':' · sin abrir')+(sh.accepted_at?' · aceptó '+shareDate(sh.accepted_at):sh.interested_at?' · le interesa':'');
          row.append(n('span','',info));if(sh.state==='active'||sh.state==='accepted'){row.append(b('Cancelar',async function(){try{await shareCall({action:'revoke',proposal_id:ctx.row.id,share_id:sh.id});refresh();}catch(e){note(e.message,true);}}));}
          list.append(row);});
      }catch(e){/* la lista es informativa */}
    }
    form.onsubmit=async function(e){
      e.preventDefault();make.disabled=true;
      var sections={odontogram:!!dlg.querySelector('#share-odontogram')&&dlg.querySelector('#share-odontogram').checked,photos:!!dlg.querySelector('#share-photos')&&dlg.querySelector('#share-photos').checked,history:dlg.querySelector('#share-history').checked};
      try{
        var out=await shareCall({action:'create',proposal_id:ctx.row.id,sections:sections,history_summary:hist.value,payment_note:pay.value,expires_days:Number(days.value)});
        var box=n('div');box.append(n('p','proposal-small','Enlace listo. Vence '+shareDate(out.expires_at)+'. Cualquiera que lo tenga puede ver esta propuesta: envíalo solo al paciente.'));
        var input=n('input');input.readOnly=true;input.value=out.url;input.style.cssText='width:100%;margin:6px 0';input.onfocus=function(){input.select();};
        var row=n('div');row.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
        var copy=b('Copiar enlace',async function(){try{await navigator.clipboard.writeText(out.url);copy.textContent='Copiado';}catch(e2){}});
        var wa=n('a','btn btn-secondary','Enviar por WhatsApp');wa.target='_blank';wa.rel='noopener';wa.href='https://wa.me/?text='+encodeURIComponent('Hola, aquí está tu propuesta de tratamiento: '+out.url);
        row.append(copy,wa);box.append(input,row);status.replaceChildren(box);refresh();
      }catch(err){note(err.message,true);}
      make.disabled=false;
    };
    dlg.showModal();refresh();
  }
  async function exportPDF(){
    if(!ctx||ctx.busy||ctx.dirty||ctx.stale||ctx.row.status!=='approved')return;
    var current=ctx;current.busy=true;controls();
    try{
      var row=await checked(sb.rpc('smyl_proposal_for_export',{p_id:current.row.id,p_revision:current.row.revision}));if(Array.isArray(row))row=row[0];
      if(!row||row.id!==current.row.id||row.tenant_id!==current.tenant||row.status!=='approved'||row.revision!==current.row.revision)throw new Error('Unconfirmed export');
      await window.SmylSecurity.recordExport({export_type:'proposal_pdf',entity_type:'proposal',entity_id:row.id,record_count:1,purpose:'patient_copy'});
      var assets=await assetsFor(row,current,false);if(ctx!==current)return;
      var print=document.getElementById('proposal-print');withBranch(row);print.replaceChildren(SmylProposalPrint.render(row,assets,true));
      await Promise.all(Array.from(print.querySelectorAll('img')).map(function(img){return img.decode();}));
      document.body.classList.add('proposal-exporting');window.print();
      feedback('Se abrió la impresión. Elige “Guardar como PDF”. El archivo no se envía automáticamente.');
    }catch(error){if(ctx===current){feedback(errorText(error),true);if(['40001','PT409'].includes(error.code))current.stale=true;}}
    finally{current.busy=false;if(ctx===current)controls();}
  }
  async function refreshPlan(){
    if(!ctx||ctx.busy)return;
    if(!confirm('Se cargarán los conceptos del plan revisado actual y se borrarán los precios de este borrador. ¿Continuar?'))return;
    var current=ctx;current.busy=true;controls();
    try{var plan=await checked(sb.from('smyl_clinical_plans').select('*').eq('tenant_id',current.tenant).eq('patient_id',current.row.patient_id).single());
      if(plan.status!=='reviewed')throw new Error('Plan not reviewed');if(ctx!==current)return;
      current.plan=plan;current.stale=false;document.getElementById('proposal-items').replaceChildren();M.fromPlan(plan).items.forEach(addLine);changed();
      feedback('Plan actualizado. Completa los precios y revisa otra vez.');
    }catch(_){feedback('El plan actual todavía no está revisado. Completa su revisión en la ficha del paciente.',true);}
    finally{current.busy=false;if(ctx===current)controls();}
  }
  async function versions(){
    if(!ctx||!ctx.row.revision||!document.getElementById('proposal-versions').open)return;
    var current=ctx,host=document.getElementById('proposal-version-list');host.replaceChildren(skel('list',{rows:3,avatar:false,label:'Cargando versiones'}));
    try{var rows=await checked(sb.from('smyl_proposal_versions').select('revision,snapshot').eq('tenant_id',current.tenant).eq('proposal_id',current.row.id).order('revision',{ascending:false}).limit(25));if(ctx!==current)return;host.replaceChildren();rows.forEach(function(v){var d=n('details','clinic-version'),r=v.snapshot;d.append(n('summary','','Versión '+v.revision+' · '+(r.status==='approved'?'Aprobada en ese momento':'Borrador')),n('p','',r.document.title+' · '+M.money(r.total_cents)+' · Plan '+r.plan_revision),n('p','','Guardada: '+new Date(r.updated_at).toLocaleString('es-MX')));var list=n('ul');r.document.items.forEach(function(item){list.append(n('li','',item.label+' · '+item.quantity+' × '+(item.unit_cents===null?'Por definir':M.money(item.unit_cents))));});d.append(list);host.append(d);});host.append(n('small','','Últimas 25 versiones. Una aprobación anterior no aprueba cambios posteriores.'));}
    catch(_){if(ctx===current)host.replaceChildren(notice('No se pudo cargar el historial.',true));}
  }
  var eventLabels={presented:'Presentada al paciente',accepted:'Aceptada por el paciente',declined:'No aceptada',changes_requested:'Solicitó cambios'};
  var channelLabels={in_person:'En la clínica',email:'Correo electrónico',whatsapp:'WhatsApp',phone:'Llamada',other:'Otro medio'};
  function renderEvents(){
    var host=document.getElementById('proposal-event-list');if(!host||!ctx)return;host.replaceChildren();
    var rows=ctx.events||[],latest=rows[rows.length-1];ctx.decisionFinal=!!latest&&['accepted','declined','changes_requested'].includes(latest.event_type);
    var state=document.getElementById('proposal-decision-state');if(state){state.textContent=latest?eventLabels[latest.event_type]:'Sin presentar';state.dataset.state=latest?.event_type||'pending';}
    if(!rows.length)host.append(n('p','proposal-event-empty','Aún no hay una presentación registrada para esta versión.'));
    var tracking=document.querySelector('.proposal-tracking');if(tracking&&latest?.event_type==='presented')tracking.open=true;
    rows.slice().reverse().forEach(function(row){var item=n('article','proposal-event'),copy=n('div');copy.append(n('strong','',eventLabels[row.event_type]||row.event_type),n('small','',new Date(row.occurred_at).toLocaleString('es-MX')+' · '+(channelLabels[row.channel]||row.channel)));if(row.note)copy.append(n('p','',row.note));item.append(copy);host.append(item);});
    var type=document.getElementById('proposal-event-type');if(type){type.replaceChildren();if(ctx.decisionFinal)type.append(new Option(eventLabels[latest.event_type],latest.event_type));else{type.append(new Option('Presentada al paciente','presented'));if(latest?.event_type==='presented')type.append(new Option('Aceptada por el paciente','accepted'),new Option('No aceptada','declined'),new Option('Solicitó cambios','changes_requested'));}type.disabled=ctx.decisionFinal;}
    controls();
  }
  async function loadEvents(){
    if(!ctx||!ctx.row.revision)return;var current=ctx;current.eventsLoading=true;controls();
    try{var rows=await checked(sb.from('smyl_proposal_events').select('id,proposal_id,proposal_revision,event_type,channel,note,occurred_at,created_at').eq('tenant_id',current.tenant).eq('proposal_id',current.row.id).eq('proposal_revision',current.row.revision).order('occurred_at',{ascending:true}).order('created_at',{ascending:true}));if(ctx!==current)return;current.events=rows||[];renderEvents();}
    catch(_){if(ctx===current){var host=document.getElementById('proposal-event-list');if(host)host.replaceChildren(notice('No se pudo cargar el seguimiento.',true));}}
    finally{current.eventsLoading=false;if(ctx===current)controls();}
  }
  async function recordEvent(){
    if(!ctx||ctx.busy||!ctx.access.followup||ctx.row.status!=='approved'||ctx.dirty||ctx.stale||ctx.decisionFinal)return;
    var type=document.getElementById('proposal-event-type').value,channel=document.getElementById('proposal-event-channel').value,note=document.getElementById('proposal-event-note').value.trim();
    if(['declined','changes_requested'].includes(type)&&!note){feedback('Explica brevemente el motivo para conservar el contexto del seguimiento.',true);return;}
    var message=type==='presented'?'Registrar que esta versión fue presentada al paciente?':'Registrar “'+eventLabels[type]+'”? Esta decisión quedará en el historial de la versión.';
    if(!confirm(message))return;
    var current=ctx,eventId=crypto.randomUUID();current.busy=true;controls();
    try{var saved=await checked(sb.rpc('smyl_record_proposal_event',{p_event_id:eventId,p_proposal_id:current.row.id,p_proposal_revision:current.row.revision,p_event_type:type,p_channel:channel,p_note:note,p_occurred_at:new Date().toISOString()}));if(Array.isArray(saved))saved=saved[0];if(!saved||saved.id!==eventId||saved.proposal_id!==current.row.id||saved.proposal_revision!==current.row.revision)throw new Error('Unconfirmed proposal event');if(ctx!==current)return;current.events=(current.events||[]).concat(saved);document.getElementById('proposal-event-note').value='';renderEvents();feedback(type==='presented'?'Presentación registrada. Ahora puedes capturar la decisión informada por el paciente.':'Decisión registrada para esta versión.');}
    catch(error){if(ctx===current)feedback(errorText(error),true);}
    finally{current.busy=false;if(ctx===current)controls();}
  }
  // El estado se calcula en SmylProposalModel.stage (probado en tests/smyl-quote-stages.test.mjs).
  var quotePlans=new Map(),quoteBatches=new Map(),quoteFinanceVisible=true;
  function proposalStage(row,event){
    var sig=shareSignals.get(row.id);
    return M.stage({row:row,event:event,share:sig||null,plan:quotePlans.get(row.patient_id)||null,batch:quoteBatches.get(row.id+':'+row.revision)||null,financeVisible:quoteFinanceVisible});
  }
  // ── Cotizaciones: tablero con importes, días sin respuesta y acciones rápidas por etapa ──
  var quoteChats={};
  function quoteAge(iso){var t=new Date(iso||0).getTime();return t>0?Math.max(0,Math.floor((Date.now()-t)/86400000)):null;}
  function quoteAgeLabel(d){return d===null?'':d===0?'hoy':d===1?'ayer':'hace '+d+' días';}
  function quoteFirstName(row){return String(row.patient_name||'').trim().split(/\s+/)[0]||'';}
  function quoteTitle(row){return String(row.document&&row.document.title||'Plan de tratamiento').replace(/\s+/g,' ').trim().slice(0,80);}
  function quoteClinic(row){var t=window.tenantData||{},c=t.config||{};return String(row.clinic_name||c.consultorio||t.nombre||'tu clínica').trim();}
  function quoteTotal(row){return row.document.items.some(function(i){return i.unit_cents===null;})?null:row.total_cents;}
  // ── Seguimiento de cotizaciones presentadas: 3, 7 y 15 días sin respuesta ──
  var QUOTE_TIERS=[3,7,15],quoteFollowups=new Map();
  var shareSignals=new Map();
  function followupKey(row){return row.id+':'+row.revision;}
  // item: {event,stage}; followups: lista de {followed_at} de esa versión (cualquier orden).
  function quoteFollowupState(stageKey,event,followups){
    if(stageKey!=='awaiting'||!event)return {due:false,count:0,exhausted:false,label:''};
    var d=quoteAge(event.occurred_at),list=(followups||[]).slice().sort(function(a,b){return String(b.followed_at).localeCompare(String(a.followed_at));}),k=list.length,last=k?quoteAge(list[0].followed_at):null;
    if(d===null)return {due:false,count:k,exhausted:false,label:''};
    if(k>=QUOTE_TIERS.length)return {due:false,count:k,exhausted:true,label:'Ya se dieron '+k+' seguimientos: registra la respuesta o ciérrala.'};
    var due=d>=QUOTE_TIERS[k]&&(k===0||(last!==null&&last>=3));
    var label=due?'Seguimiento '+(k+1)+' de '+QUOTE_TIERS.length+' recomendado.':(k?'Último seguimiento '+quoteAgeLabel(last)+' ('+k+' de '+QUOTE_TIERS.length+').':'');
    return {due:due,count:k,exhausted:false,label:label};
  }
  var QUOTE_URGENT=['changes_requested','expired','stale','link_accepted','interested'];
  function quoteNeedsAttention(stageKey,fu){return !!(fu&&fu.due)||QUOTE_URGENT.includes(stageKey);}
  function renderQuoteBadge(count){
    document.querySelectorAll('.pro-app-nav [data-route="propuestas"]').forEach(function(button){
      var badge=button.querySelector('.pro-nav-count');if(!badge){badge=n('span','pro-nav-count');button.append(badge);}
      badge.textContent=count>99?'99+':String(count);badge.hidden=!count;badge.setAttribute('aria-label',count+(count===1?' cotización requiere seguimiento':' cotizaciones requieren seguimiento'));
    });
  }
  // Contador del menú: consulta ligera (sólo la vigencia del documento) cada 10 minutos con la pestaña visible.
  var quoteBadgeBusy=false;
  async function refreshQuoteBadge(){
    if(quoteBadgeBusy||document.visibilityState!=='visible'||typeof tenantId==='undefined'||!tenantId||!window.sb)return;quoteBadgeBusy=true;
    try{
      var tenant=tenantId,access=await capabilities(tenant);if(!access.read){renderQuoteBadge(0);return;}
      var rows=await checked(sb.from('smyl_proposals').select('id,patient_id,plan_revision,revision,status,valid:document->>valid_until').eq('tenant_id',tenant).eq('status','approved').order('updated_at',{ascending:false}).limit(100));
      if(!rows.length){renderQuoteBadge(0);return;}
      var ids=rows.map(function(r){return r.id;});
      var events=await checked(sb.from('smyl_proposal_events').select('proposal_id,proposal_revision,event_type,occurred_at,created_at').eq('tenant_id',tenant).in('proposal_id',ids).order('occurred_at',{ascending:false}).order('created_at',{ascending:false}));
      var follows=[];try{follows=await checked(sb.from('smyl_proposal_followups').select('proposal_id,proposal_revision,followed_at').eq('tenant_id',tenant).in('proposal_id',ids));}catch(_){follows=[];}
      var latest=new Map(),byKey=new Map();(events||[]).forEach(function(e){var k=e.proposal_id+':'+e.proposal_revision;if(!latest.has(k))latest.set(k,e);});
      (follows||[]).forEach(function(f){var k=f.proposal_id+':'+f.proposal_revision;if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(f);});
      try{var pids=Array.from(new Set(rows.map(function(r){return r.patient_id;}).filter(Boolean)));if(pids.length){(await checked(sb.from('smyl_clinical_plans').select('patient_id,revision,status').eq('tenant_id',tenant).in('patient_id',pids))||[]).forEach(function(plan){quotePlans.set(plan.patient_id,plan);});}}catch(_){}
      var count=0;rows.forEach(function(r){var k=r.id+':'+r.revision,ev=latest.get(k),stage=proposalStage({id:r.id,patient_id:r.patient_id,plan_revision:r.plan_revision,revision:r.revision,status:r.status,document:{valid_until:r.valid}},ev);if(quoteNeedsAttention(stage.key,quoteFollowupState(stage.key,ev,byKey.get(k))))count++;});
      renderQuoteBadge(count);
    }catch(_){}finally{quoteBadgeBusy=false;}
  }
  function proposalDashboard(rows,latestEvents,list,access){
    var items=rows.map(function(row){return {row:row,event:null,stage:null,fu:null};});
    function restage(){items.forEach(function(item){item.event=latestEvents.get(item.row.id+':'+item.row.revision);item.stage=proposalStage(item.row,item.event);item.fu=quoteFollowupState(item.stage.key,item.event,quoteFollowups.get(followupKey(item.row)));});updateBadge();}
    function updateBadge(){renderQuoteBadge(items.filter(function(item){return quoteNeedsAttention(item.stage.key,item.fu);}).length);}
    restage();
    var metrics=n('section','proposal-metrics');
    function sum(list2){return list2.reduce(function(s,item){var t=quoteTotal(item.row);return s+(t||0);},0);}
    function renderMetrics(){
      var decisions=items.filter(function(item){return ['accepted','converted','declined','changes_requested'].includes(item.stage.key);}),accepted=items.filter(function(item){return item.stage.key==='accepted'||item.stage.key==='converted';}).length,rate=decisions.length?Math.round(accepted*100/decisions.length):null;
      var ready=items.filter(function(item){return item.stage.key==='ready';}),awaiting=items.filter(function(item){return item.stage.key==='awaiting';}),stale=awaiting.filter(function(item){var d=quoteAge(item.event&&item.event.occurred_at);return d!==null&&d>=5;});
      metrics.replaceChildren();[
        ['Por presentar',ready.length,ready.length?M.money(sum(ready))+' · versiones aprobadas':'versiones aprobadas'],
        ['Esperando respuesta',awaiting.length,awaiting.length?M.money(sum(awaiting))+(stale.length?' · '+stale.length+' sin respuesta hace 5+ días':' · presentadas sin decisión'):'presentadas sin decisión'],
        ['Requieren acción',items.filter(function(item){return ['expired','changes_requested','draft','stale','link_accepted','interested'].includes(item.stage.key);}).length,'respuestas por enlace, cambios, planes actualizados o borradores'],
        ['Aceptación',rate===null?'—':rate+'%',decisions.length+' decisiones registradas']
      ].forEach(function(metric){var card=n('article');card.append(n('span','',metric[0]),n('strong','',String(metric[1])),n('small','',metric[2]));metrics.append(card);});
    }
    var toolbar=n('div','proposal-list-toolbar'),filters=n('div','proposal-filters'),search=n('input');search.type='search';search.placeholder='Buscar paciente o propuesta';search.setAttribute('aria-label','Buscar cotizaciones');
    var currentFilter='action';[['action','Por atender'],['followup','Dar seguimiento'],['all','Todas'],['accepted','Aceptadas'],['draft','Borradores']].forEach(function(entry){var button=b(entry[1],function(){currentFilter=entry[0];filters.querySelectorAll('button').forEach(function(item){item.setAttribute('aria-pressed',String(item===button));});render();});button.setAttribute('aria-pressed',String(entry[0]===currentFilter));filters.append(button);});toolbar.append(filters,search);
    async function record(item,type,channel,note){
      var eventId=crypto.randomUUID(),saved=await checked(sb.rpc('smyl_record_proposal_event',{p_event_id:eventId,p_proposal_id:item.row.id,p_proposal_revision:item.row.revision,p_event_type:type,p_channel:channel,p_note:note||'',p_occurred_at:new Date().toISOString()}));
      if(Array.isArray(saved))saved=saved[0];if(!saved||saved.id!==eventId||saved.proposal_id!==item.row.id)throw new Error('Unconfirmed proposal event');
      latestEvents.set(item.row.id+':'+item.row.revision,saved);restage();renderMetrics();renderBanner();render();return saved;
    }
    async function logFollowup(item,channel){
      var at=await checked(sb.rpc('smyl_log_proposal_followup',{p_proposal_id:item.row.id,p_proposal_revision:item.row.revision,p_channel:channel}));
      var key=followupKey(item.row),list=(quoteFollowups.get(key)||[]).concat({followed_at:typeof at==='string'?at:new Date().toISOString()});quoteFollowups.set(key,list);restage();renderBanner();render();
    }
    function followupDialog(item){
      var dialog=n('dialog','proposal-quick-dialog'),form=n('form');form.append(n('h3','','Registrar seguimiento · '+item.row.patient_name),n('p','','Anota que ya le diste seguimiento a esta cotización (por ejemplo, una llamada). Sirve para no repetir avisos y planear el siguiente.'));
      var chan=n('select');[['phone','Llamada'],['whatsapp','WhatsApp'],['in_person','En consulta'],['email','Correo'],['other','Otro']].forEach(function(o){chan.append(new Option(o[1],o[0]));});var cl=n('label','','Canal');cl.append(chan);form.append(cl);
      var error=n('p','proposal-quick-error');error.setAttribute('role','alert');error.hidden=true;form.append(error);
      var actions=n('div','proposal-quick-actions'),cancel=n('button','btn btn-secondary','Cancelar'),ok=n('button','btn btn-primary','Guardar');cancel.type='button';ok.type='submit';actions.append(cancel,ok);form.append(actions);dialog.append(form);
      cancel.onclick=function(){dialog.close();};dialog.addEventListener('close',function(){dialog.remove();});
      form.onsubmit=async function(ev){ev.preventDefault();ok.disabled=true;error.hidden=true;try{await logFollowup(item,chan.value);dialog.close();}catch(err){ok.disabled=false;error.textContent=errorText(err);error.hidden=false;}};
      document.body.append(dialog);if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
    }
    function decisionDialog(item,mode){
      var dialog=n('dialog','proposal-quick-dialog'),form=n('form'),title=mode==='presented'?'Marcar como presentada':'Registrar respuesta del paciente';
      form.append(n('h3','',title+' · '+item.row.patient_name),n('p','','Se guarda en el historial de esta versión. No es una firma ni un consentimiento.'));
      var kind=null;
      if(mode==='decision'){var sel=n('select');[['accepted','Aceptó'],['changes_requested','Pidió cambios'],['declined','No aceptó']].forEach(function(o){sel.append(new Option(o[1],o[0]));});sel.setAttribute('aria-label','Respuesta');kind=sel;var lab=n('label','','Respuesta');lab.append(sel);form.append(lab);}
      var chan=n('select');[['in_person','En consulta'],['whatsapp','WhatsApp'],['phone','Teléfono'],['email','Correo'],['other','Otro']].forEach(function(o){chan.append(new Option(o[1],o[0]));});var cl=n('label','','Canal');cl.append(chan);form.append(cl);
      var note=n('textarea');note.rows=3;note.maxLength=1000;note.placeholder=mode==='presented'?'Nota opcional':'Motivo o nota (obligatoria si pidió cambios o no aceptó)';var nl=n('label','','Nota');nl.append(note);form.append(nl);
      var error=n('p','proposal-quick-error');error.setAttribute('role','alert');error.hidden=true;form.append(error);
      var actions=n('div','proposal-quick-actions'),cancel=n('button','btn btn-secondary','Cancelar'),ok=n('button','btn btn-primary','Guardar');cancel.type='button';ok.type='submit';actions.append(cancel,ok);form.append(actions);dialog.append(form);
      cancel.onclick=function(){dialog.close();};dialog.addEventListener('close',function(){dialog.remove();});
      form.onsubmit=async function(ev){ev.preventDefault();var type=mode==='presented'?'presented':kind.value,text=note.value.trim();if((type==='declined'||type==='changes_requested')&&!text){error.textContent='Escribe el motivo para dejarlo en el historial.';error.hidden=false;return;}ok.disabled=true;error.hidden=true;
        try{await record(item,type,chan.value,text);dialog.close();}catch(err){ok.disabled=false;error.textContent=errorText(err);error.hidden=false;}};
      document.body.append(dialog);if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
    }
    function whatsapp(item){
      var link=quoteChats[item.row.patient_id];if(!link||link.channel!=='whatsapp'||!window.SmylInbox||typeof window.SmylInbox.sendTemplate!=='function')return;
      var follow=item.stage.key==='awaiting',names=follow?['cotizacion_seguimiento_v1','cotizacion_lista_v1']:['cotizacion_lista_v1'];
      window.SmylInbox.sendTemplate(link.conversation,{preferred:names,variables:[quoteFirstName(item.row),quoteTitle(item.row),quoteClinic(item.row)],missingText:'No hay una plantilla de cotización aprobada todavía. Solicítala en Mensajería → Plantillas; Meta suele tardar de unos minutos a 48 horas.',
        onSent:function(){if(item.stage.key==='ready'&&access.followup){record(item,'presented','whatsapp','Enviada por WhatsApp desde Cotizaciones').catch(function(){});}else if(item.stage.key==='awaiting'&&access.followup){logFollowup(item,'whatsapp').catch(function(){});}}});
    }
    // El paciente aceptó en el enlace: el equipo lo confirma y queda como evento de la versión (presentada → aceptada).
    async function confirmLinkAcceptance(item){
      if(!confirm('¿Confirmaste con '+item.row.patient_name+' que acepta esta cotización? Se registrará como aceptada por enlace. No sustituye el consentimiento informado.'))return;
      try{
        if(!item.event||item.event.event_type!=='presented')await record(item,'presented','other','Compartida con el paciente por enlace');
        await record(item,'accepted','other','Aceptó en el enlace compartido; confirmado por el equipo');
      }catch(err){alert(errorText(err));}
    }
    function actionsFor(item){
      var key=item.stage.key,box=n('div','proposal-row-actions');
      box.append(b(key==='stale'&&access.write?'Actualizar con el plan':access.write||access.followup?'Abrir':'Consultar',function(){open(item.row.id);}));
      if(access.followup&&key==='link_accepted')box.append(b('Confirmar aceptación',function(){confirmLinkAcceptance(item);}));
      if(key==='interested'&&window.SmylSchedule&&typeof window.SmylSchedule.forPatient==='function')box.append(b('Agendar cita',function(){window.SmylSchedule.forPatient(item.row.patient_id);}));
      if(access.followup&&key==='interested'&&item.event&&item.event.event_type==='presented')box.append(b('Registrar respuesta',function(){decisionDialog(item,'decision');}));
      if(access.followup&&key==='ready')box.append(b('Marcar presentada',function(){decisionDialog(item,'presented');}));
      if(access.followup&&key==='awaiting')box.append(b('Registrar respuesta',function(){decisionDialog(item,'decision');}));
      if(access.followup&&key==='awaiting')box.append(b('Registré un seguimiento',function(){followupDialog(item);}));
      var link=quoteChats[item.row.patient_id];
      if(link&&link.channel==='whatsapp'&&(key==='ready'||key==='awaiting')&&window.SmylInbox&&typeof window.SmylInbox.sendTemplate==='function')box.append(b(key==='awaiting'?'Dar seguimiento por WhatsApp':'Enviar por WhatsApp',function(){whatsapp(item);}));
      if(key==='accepted'&&window.SmylFinance&&typeof window.SmylFinance.fromProposal==='function')box.append(b('Iniciar tratamiento',function(){window.SmylFinance.fromProposal(item.row.id,{guided:true});},'btn btn-primary'));
      if(key==='converted'&&access.finance&&window.SmylFinance&&typeof window.SmylFinance.fromProposal==='function')box.append(b('Anticipo y cita',function(){window.SmylFinance.fromProposal(item.row.id,{guided:true});}));
      if(link&&window.SmylInbox&&typeof window.SmylInbox.open==='function')box.append(b('Abrir chat',function(){window.SmylInbox.open(link.conversation);}));
      return box;
    }
    function render(){var term=search.value.trim().toLocaleLowerCase('es-MX'),visible=items.filter(function(item){var matches=!term||(item.row.patient_name+' '+item.row.document.title).toLocaleLowerCase('es-MX').includes(term);if(!matches)return false;if(currentFilter==='all')return true;if(currentFilter==='action')return item.stage.action;if(currentFilter==='followup')return item.fu.due||QUOTE_URGENT.includes(item.stage.key);if(currentFilter==='accepted')return item.stage.key==='accepted'||item.stage.key==='converted';return item.stage.key==='draft';}).sort(function(a,b){return (a.stage.priority-(a.fu.due?3:0))-(b.stage.priority-(b.fu.due?3:0))||new Date(b.row.updated_at)-new Date(a.row.updated_at);});list.replaceChildren();if(!visible.length){list.append(notice(term?'No hay cotizaciones que coincidan con la búsqueda.':'No hay cotizaciones en este estado.'));return;}visible.forEach(function(item){var row=item.row,card=n('article','proposal-list-row'),text=n('div');var wait=item.stage.key==='awaiting'?quoteAge(item.event&&item.event.occurred_at):null;text.append(n('h2','',row.patient_name),n('p','',row.document.title+' · Versión '+row.revision+(row.branch_id&&listBranches.get(row.branch_id)&&listBranches.size>1?' · Sede '+listBranches.get(row.branch_id):'')),n('small','proposal-list-status',item.stage.label),n('small','proposal-list-detail',item.stage.detail+(wait!==null&&wait>=5?' Sin respuesta '+quoteAgeLabel(wait)+'.':'')+(item.fu.label?' '+item.fu.label:'')));text.children[2].dataset.state=item.stage.key;var sig=shareSignals.get(row.id);if(sig&&(sig.accepted||sig.interested||sig.opens)){var shareNote=n('small','proposal-list-detail proposal-share-note',sig.accepted?'Enlace: aceptó el plan · '+shareWhen(sig.accepted):sig.interested?'Enlace: le interesa y quiere agendar · '+shareWhen(sig.interested):'Enlace: lo abrió '+sig.opens+(sig.opens===1?' vez':' veces')+' · última '+shareWhen(sig.lastOpened));shareNote.style.cssText='font-weight:600;color:'+(sig.accepted?'#047857':sig.interested?'#B45309':'#475569');text.append(shareNote);}card.append(text,n('strong','',quoteTotal(row)===null?'Por completar':M.money(row.total_cents)),actionsFor(item));list.append(card);});}
    var banner=n('section','proposal-followup-banner');banner.hidden=true;
    function renderBanner(){
      var due=items.filter(function(item){return item.fu.due;}),other=items.filter(function(item){return QUOTE_URGENT.includes(item.stage.key);}).length;banner.replaceChildren();
      if(!due.length&&!other){banner.hidden=true;return;}
      var total=due.reduce(function(sumValue,item){return sumValue+(quoteTotal(item.row)||0);},0),text=n('div');
      text.append(n('strong','',due.length?due.length+(due.length===1?' cotización para dar seguimiento hoy':' cotizaciones para dar seguimiento hoy')+(total?' · '+M.money(total):''):other+(other===1?' cotización requiere revisión':' cotizaciones requieren revisión')),n('small','',due.length?'Presentadas sin respuesta a los 3, 7 o 15 días. Tú revisas y confirmas cada mensaje; nada se envía solo.':'Respondieron por el enlace, pidieron cambios, cambió su plan o venció la vigencia.'));
      banner.append(text,b('Ver',function(){currentFilter='followup';filters.querySelectorAll('button').forEach(function(item){item.setAttribute('aria-pressed',String(item.textContent==='Dar seguimiento'));});render();}));banner.hidden=false;
    }
    renderMetrics();renderBanner();
    search.addEventListener('input',render);return {metrics:metrics,banner:banner,toolbar:toolbar,render:render};
  }
  function editor(){
    var root=document.getElementById('p-propuestas');root.replaceChildren();
    root.append(b('← Cotizaciones',function(){if(leave())loadList();},'clinic-back'));
    var header=n('header','proposal-heading'),title=n('div');title.append(n('p','pro-eyebrow','PREPARAR PROPUESTA'),n('h1','',ctx.row.patient_name));var badge=n('span','clinic-state');badge.id='proposal-state';header.append(title,badge);root.append(header);
    var message=n('div');message.id='proposal-feedback';root.append(message);
    var layout=n('div','proposal-layout'),form=n('fieldset','proposal-editor');form.id='proposal-form';
    var doc=M.normalize(ctx.row.document);ctx.row.document=doc;
    form.append(field('Título','proposal-title',doc.title));
    if(ctx.branches.length>1){
      var branchField=n('label','proposal-branch-field');branchField.append(n('span','','Sucursal'));
      var branchSelect=document.createElement('select');branchSelect.id='proposal-branch';branchSelect.append(new Option('Selecciona la sucursal…',''));
      ctx.branches.forEach(function(branch){branchSelect.append(new Option(branch.name,branch.id));});branchSelect.value=ctx.branchId||'';
      branchSelect.onchange=function(){
        var next=branchSelect.value,changes=next?repriceLines(next):[];
        if(changes.length&&!window.confirm('¿Actualizar '+changes.length+(changes.length===1?' precio':' precios')+' al precio de '+branchLabel(next)+'? Los precios que escribiste a mano no se cambian.')){}
        else changes.forEach(function(change){change[0].value=change[1];});
        ctx.branchId=next;changed();
      };
      branchField.append(branchSelect,n('small','','Define el precio de lista de cada concepto y dónde se atenderá.'));form.append(branchField);
    }
    form.append(field('Mensaje para el paciente · opcional','proposal-intro',doc.introduction,'textarea'));
    var quotation=n('div','clinic-section-heading');quotation.append(n('h2','','Tratamiento e inversión'),n('p','','Los conceptos vienen del plan revisado. Ajusta su descripción, cantidad y precio. No se copian las notas clínicas internas.'));
    var items=n('div');items.id='proposal-items';var add=b('+ Añadir concepto',function(){addLine();changed();});add.id='proposal-add';form.append(quotation,items,add);
    var photo=n('details','clinic-secondary');photo.append(n('summary','','Comparación de sonrisa · opcional'));
    var include=n('label','clinic-confirm'),includeCheck=n('input');includeCheck.type='checkbox';includeCheck.id='proposal-include-photos';includeCheck.checked=!!doc.photos;include.append(includeCheck,document.createTextNode('Incluir foto original y simulación'));photo.append(include);
    var inputs=n('div');inputs.id='proposal-photo-inputs';
    inputs.append(notice('Carga las dos imágenes de este paciente. No se buscan casos por nombre ni se generan imágenes nuevas. Se guardarán de forma privada al guardar la propuesta.'));
    var vf=n('div','clinic-field'),vl=n('label','','Vista'),vs=n('select');vs.id='proposal-view';vl.htmlFor=vs.id;Object.entries(M.views).forEach(function(e){vs.append(new Option(e[1],e[0]));});vs.value=doc.photos?.view||'frontal';vf.append(vl,vs);inputs.append(vf);
    vs.addEventListener('change',function(){document.getElementById('proposal-pair-check').checked=false;});
    var upload=n('div','proposal-upload-pair');
    [['before','Fotografía original'],['simulation','Simulación generada']].forEach(function(entry){var wrap=n('div','clinic-field'),lbl=n('label','',entry[1]),input=n('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.id='proposal-file-'+entry[0];lbl.htmlFor=input.id;input.addEventListener('change',function(){selectPhoto(entry[0],input.files[0]);});var image=n('img');image.id='proposal-photo-'+entry[0];image.alt=entry[1];image.hidden=true;wrap.append(lbl,input,image);upload.append(wrap);});
    var confirm=n('label','clinic-confirm'),check=n('input');check.type='checkbox';check.id='proposal-pair-check';check.checked=!!doc.photos;confirm.append(check,document.createTextNode('Verifiqué que ambas imágenes son de este paciente y de la misma vista. La segunda es una simulación.'));inputs.append(upload,confirm);photo.append(inputs);form.append(photo);
    form.append(field('Válida hasta','proposal-valid',doc.valid_until,'date'),field('Qué incluye y condiciones','proposal-terms',doc.terms,'textarea'));
    var side=n('aside','proposal-summary');side.append(n('p','pro-eyebrow','TODO EN UNA PROPUESTA'),n('h2','','Lista para conversar.'));var total=n('strong');total.id='proposal-estimate';side.append(total,n('p','','MXN · Importe estimado. Aclara en las condiciones lo incluido, impuestos y forma de pago.'));
    var saveButton=b('Guardar borrador',function(){save(false);});saveButton.id='proposal-save';var previewButton=b('Vista previa y revisión',preview,'btn btn-primary');previewButton.id='proposal-preview';var exportButton=b('Guardar como PDF',exportPDF);exportButton.id='proposal-export';var shareButton=b('Compartir con el paciente',openShare);shareButton.id='proposal-share';side.append(saveButton,previewButton,exportButton,shareButton,n('p','proposal-privacy','El paciente solo verá la propuesta. Antecedentes y notas internas no se incluyen.'));
    var tracking=n('details','proposal-tracking proposal-fold'),trackingHead=n('summary','proposal-fold-head'),trackingTitle=n('div');trackingTitle.append(n('p','pro-eyebrow','SEGUIMIENTO'),n('h2','','Decisión del paciente'));var decision=n('span','proposal-decision-state','Sin presentar');decision.id='proposal-decision-state';decision.dataset.state='pending';trackingHead.append(trackingTitle,decision);var eventList=n('div','proposal-event-list');eventList.id='proposal-event-list';eventList.append(n('p','proposal-event-empty','Aprueba la propuesta para iniciar el seguimiento.'));var typeWrap=n('label','clinic-field'),typeLabel=n('span','','Resultado'),typeSelect=n('select');typeSelect.id='proposal-event-type';typeSelect.append(new Option('Presentada al paciente','presented'));typeWrap.append(typeLabel,typeSelect);var channelWrap=n('label','clinic-field'),channelLabel=n('span','','Medio'),channelSelect=n('select');channelSelect.id='proposal-event-channel';Object.entries(channelLabels).forEach(function(entry){channelSelect.append(new Option(entry[1],entry[0]));});channelWrap.append(channelLabel,channelSelect);var noteWrap=n('label','clinic-field'),noteLabel=n('span','','Nota · obligatoria si rechaza o pide cambios'),note=n('textarea');note.id='proposal-event-note';note.maxLength=1000;note.rows=3;note.placeholder='Acuerdo, duda o motivo comunicado por el paciente';noteWrap.append(noteLabel,note);var eventButton=b('Registrar seguimiento',recordEvent);eventButton.id='proposal-record-event';tracking.append(trackingHead,eventList,typeWrap,channelWrap,noteWrap,eventButton,n('p','proposal-privacy','Es un registro del equipo sobre lo comunicado por el paciente. No sustituye firma, consentimiento informado ni autorización clínica.'));side.append(tracking);
    var activation=n('details','proposal-activation proposal-fold'),activationHead=n('summary','proposal-fold-head'),activationTitle=n('div');activationTitle.append(n('p','pro-eyebrow','ACTIVACIÓN'),n('h2','','Iniciar tratamiento'));var activationState=n('span','proposal-decision-state','Esperando aceptación');activationState.id='proposal-activation-state';activationState.dataset.state='pending';activationHead.append(activationTitle,activationState);var activationCopy=n('p','proposal-activation-copy','Registra primero la presentación y la aceptación de esta versión. Aprobar internamente no autoriza cargos ni citas.');activationCopy.id='proposal-activation-copy';var activationActions=n('div','proposal-activation-actions'),chargeButton=b('Crear cargos en Caja',function(){if(window.SmylFinance)SmylFinance.fromProposal(ctx.row.id,{guided:true});}),scheduleButton=b('Agendar primera cita',function(){if(window.SmylSchedule)SmylSchedule.forPatient(ctx.row.patient_id);});chargeButton.id='proposal-to-charges';scheduleButton.id='proposal-to-schedule';activationActions.append(chargeButton,scheduleButton);activation.append(activationHead,activationCopy,activationActions,n('p','proposal-privacy','La aceptación no sustituye el consentimiento informado. Caja y Agenda vuelven a validar permisos, importes y disponibilidad.'));side.append(activation);
    if(window.SmylLana){var followup=b('Seguimiento por mensajería',function(){SmylLana.open();});followup.id='proposal-followup';side.append(followup);}
    var tools=n('details','clinic-secondary');tools.append(n('summary','','Actualizar o recargar'),b('Usar plan revisado actual',refreshPlan),b('Recargar propuesta guardada',function(){var id=ctx.row.id;if(leave())open(id);}));side.append(tools);
    layout.append(form,side);root.append(layout);doc.items.forEach(addLine);
    document.getElementById('proposal-title').maxLength=150;document.getElementById('proposal-intro').maxLength=3000;document.getElementById('proposal-terms').maxLength=3000;
    var hist=n('details','clinic-secondary');hist.id='proposal-versions';hist.append(n('summary','','Historial de propuestas'));var list=n('div');list.id='proposal-version-list';hist.append(list);hist.addEventListener('toggle',versions);root.append(hist);
    form.addEventListener('input',changed);form.addEventListener('change',changed);controls();
    if(ctx.stale)feedback('Esta propuesta pertenece a otra versión del plan. Usa el plan revisado actual antes de aprobar o exportar.',true);
    if(ctx.row.revision)loadEvents();
    if(doc.photos){var current=ctx;assetsFor(ctx.row,ctx,false).then(function(assets){if(ctx!==current)return;Object.keys(assets).forEach(function(key){var img=document.getElementById('proposal-photo-'+key);img.src=assets[key];img.hidden=false;});}).catch(function(){if(ctx===current)feedback('No se pudieron cargar las fotos guardadas. La propuesta conserva sus referencias; vuelve a intentar antes de exportar.',true);});}
  }
  async function open(id,patientId){
    if(!tenantId)return;
    if(!leave())return;
    var tenant=tenantId,token=++sequence,root=document.getElementById('p-propuestas');root.replaceChildren(skel('detail',{label:'Preparando propuesta'}));
    try{
      var access=await capabilities(tenant);if(!access.read||(!id&&!access.write)){root.replaceChildren(notice(access.read?'Tu rol puede consultar cotizaciones, pero no preparar una nueva.':'Tu rol no permite consultar cotizaciones.',true),b('Volver a Cotizaciones',loadList));return;}
      var row=id?await checked(sb.from('smyl_proposals').select('*').eq('tenant_id',tenant).eq('id',id).single()):null;
      var patient=await checked(sb.from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id',tenant).eq('id',row?row.patient_id:patientId).single());
      if(!patient)throw new Error('Patient not available');
      var plan=await checked(sb.from('smyl_clinical_plans').select('*').eq('tenant_id',tenant).eq('patient_id',patient.id).maybeSingle());
      if(token!==sequence||tenant!==tenantId)return;
      if(!plan||(!row&&plan.status!=='reviewed')){
        // Sin plan revisado no se cotiza: se explica y se lleva al expediente de ese paciente, no a la lista general.
        var who=[patient.nombre,patient.apellido].filter(Boolean).join(' ')||'este paciente',gate=n('section','proposal-plan-gate');
        gate.append(n('p','pro-eyebrow','ANTES DE COTIZAR'),n('h2','',plan?'El plan de '+who+' tiene cambios sin revisar':who+' todavía no tiene plan de tratamiento'),n('p','','La cotización toma los tratamientos, piezas y precios de la propuesta clínica revisada. Te llevamos a su expediente, en Tratamiento → Propuesta; al revisarla, pulsa «Cotizar ahora».'));
        var go=b('Ir a la propuesta de '+who,function(){openPlanForQuote(patient.id);},'btn btn-primary');go.id='proposal-gate-open';
        gate.append(go,b('Volver a Cotizaciones',loadList));root.replaceChildren(gate);return;}
      if(token!==sequence||tenant!==tenantId)return;
      if(!row){var config=tenantData?.config||{};row={id:crypto.randomUUID(),tenant_id:tenant,patient_id:patient.id,patient_name:[patient.nombre,patient.apellido].filter(Boolean).join(' '),clinic_name:config.consultorio||tenantData?.nombre||'Clínica dental',professional_name:config.doctor||'',plan_revision:plan.revision,revision:0,status:'draft',document:M.fromPlan(plan)};}else row.document=M.normalize(row.document);
      var branches=[],branchPrices=[];
      try{branches=await checked(sb.from('smyl_branches').select('id,name,is_default,address_line,city,state,phone').eq('tenant_id',tenant).eq('active',true).order('is_default',{ascending:false}).order('name'))||[];branchPrices=await checked(sb.from('smyl_service_branch_prices').select('service_id,branch_id,price').eq('tenant_id',tenant))||[];}catch(_){branchPrices=[];}
      var initialBranch=row.branch_id||(branches.length>1?((branches.find(function(b){return b.is_default;})||{}).id||''):((branches[0]&&branches[0].id)||null));
      ctx={branches:branches,branchPrices:branchPrices,branchId:initialBranch,row:row,tenant:tenant,plan:plan,access:access,files:{},photoPaths:row.document.photos,saved:JSON.stringify(row.document),dirty:!id,busy:false,events:[],eventsLoading:false,decisionFinal:false,stale:plan.status!=='reviewed'||row.plan_revision!==plan.revision};if(!id&&ctx.branchId)repriceDocument(ctx.row.document,ctx.branchId);editor();
    }catch(error){if(token===sequence)root.replaceChildren(notice(errorText(error),true),b('Volver a Presentaciones',loadList));}
  }
  async function loadList(){
    var root=document.getElementById('p-propuestas');root.replaceChildren();
    var head=n('header','proposal-heading'),copy=n('div');copy.append(n('p','pro-eyebrow','SEGUIMIENTO COMERCIAL'),n('h1','','Cotizaciones'),n('p','','Seguimiento de lo que preparaste para tus pacientes. Cada cotización nace del plan clínico revisado del paciente.'));head.append(copy);root.append(head);
    if(!tenantId){root.append(notice('Inicia sesión para consultar las propuestas de tu clínica.'));return;}
    var tenant=tenantId,token=++sequence;
    if(window.SmylLana)head.append(b('Seguimiento por mensajería',function(){SmylLana.open();},'btn btn-secondary lana-entry'));
    var launch=n('div','proposal-launch proposal-from-patient'),launchCopy=n('div');
    launchCopy.append(n('strong','','Nueva cotización'),n('p','','Elige al paciente y se abre con los tratamientos de su plan revisado. Si aún no tiene plan, te llevamos a su expediente para revisarlo.'));
    var newQuote=b('Nueva cotización',function(){if(window.SmylCareTasks&&typeof window.SmylCareTasks.open==='function')window.SmylCareTasks.open('quote');else ir('pacientes');},'btn btn-primary');newQuote.id='proposal-new';
    launch.append(launchCopy,newQuote);root.append(launch);
    var list=n('div','proposal-list');root.append(list);list.append(skel('cards',{count:4,label:'Cargando propuestas'}));
    try{
      var access=await capabilities(tenant);if(!access.read){list.replaceChildren(notice('Tu rol no permite consultar cotizaciones.',true));launch.hidden=true;return;}if(!access.write)launch.hidden=true;
      var rows=await checked(sb.from('smyl_proposals').select('id,patient_id,patient_name,clinic_name,plan_revision,revision,status,total_cents,updated_at,document,branch_id').eq('tenant_id',tenant).order('updated_at',{ascending:false}).limit(100));
      listBranches=new Map();try{(await checked(sb.from('smyl_branches').select('id,name').eq('tenant_id',tenant))||[]).forEach(function(b){listBranches.set(b.id,b.name);});}catch(_){}
      var events=rows.length?await checked(sb.from('smyl_proposal_events').select('proposal_id,proposal_revision,event_type,channel,note,occurred_at,created_at').eq('tenant_id',tenant).in('proposal_id',rows.map(function(row){return row.id;})).order('occurred_at',{ascending:false}).order('created_at',{ascending:false})):[];
      var latestEvents=new Map();(events||[]).forEach(function(event){var key=event.proposal_id+':'+event.proposal_revision;if(!latestEvents.has(key))latestEvents.set(key,event);});
      quoteFollowups=new Map();try{if(rows.length){var follows=await checked(sb.from('smyl_proposal_followups').select('proposal_id,proposal_revision,followed_at').eq('tenant_id',tenant).in('proposal_id',rows.map(function(row){return row.id;})));(follows||[]).forEach(function(f){var k=f.proposal_id+':'+f.proposal_revision;if(!quoteFollowups.has(k))quoteFollowups.set(k,[]);quoteFollowups.get(k).push(f);});}}catch(_){quoteFollowups=new Map();}
      // Plan vigente de cada paciente (para avisar si cambió después de cotizar) y lotes de cargos (cotización ya en tratamiento).
      quotePlans=new Map();quoteBatches=new Map();quoteFinanceVisible=!!access.finance;
      try{var patientIds=Array.from(new Set(rows.map(function(row){return row.patient_id;}).filter(Boolean)));if(patientIds.length)(await checked(sb.from('smyl_clinical_plans').select('patient_id,revision,status').eq('tenant_id',tenant).in('patient_id',patientIds))||[]).forEach(function(plan){quotePlans.set(plan.patient_id,plan);});}catch(_){quotePlans=new Map();}
      if(quoteFinanceVisible&&rows.length){try{(await checked(sb.from('smyl_proposal_charge_batches').select('proposal_id,proposal_revision,created_at').eq('tenant_id',tenant).in('proposal_id',rows.map(function(row){return row.id;})))||[]).forEach(function(batch){quoteBatches.set(batch.proposal_id+':'+batch.proposal_revision,batch);});}catch(_){quoteBatches=new Map();}}
      // Aviso de enlaces compartidos: qué pacientes abrieron su enlace, les interesa o aceptaron. Es informativo; si falla, la lista sigue igual.
      shareSignals=new Map();try{if(rows.length){var shares=await checked(sb.from('smyl_proposal_shares').select('proposal_id,proposal_revision,status,expires_at,open_count,last_opened_at,interested_at,accepted_at').eq('tenant_id',tenant).in('proposal_id',rows.map(function(row){return row.id;})).order('created_at',{ascending:false}));var currentRev=new Map(rows.map(function(row){return [row.id,row.revision];}));(shares||[]).forEach(function(sh){if(sh.proposal_revision!==currentRev.get(sh.proposal_id))return;var cur=shareSignals.get(sh.proposal_id)||{opens:0,interested:null,accepted:null,lastOpened:null};cur.opens+=sh.open_count||0;if(sh.interested_at&&(!cur.interested||sh.interested_at>cur.interested))cur.interested=sh.interested_at;if(sh.accepted_at&&(!cur.accepted||sh.accepted_at>cur.accepted))cur.accepted=sh.accepted_at;if(sh.last_opened_at&&(!cur.lastOpened||sh.last_opened_at>cur.lastOpened))cur.lastOpened=sh.last_opened_at;shareSignals.set(sh.proposal_id,cur);});}}catch(_){shareSignals=new Map();}
      var currentChats={};
      if(window.SmylInbox?.canAccess?.()){
        try{
          var ids=Array.from(new Set(rows.map(function(row){return row.patient_id;}).filter(Boolean)));
          if(ids.length){
            var handoffs=await checked(sb.from('camila_lana_handoffs').select('patient_id,lana_conversation_id,lana_channel,updated_at').eq('tenant_id',tenant).in('patient_id',ids).order('updated_at',{ascending:false}));
            (handoffs||[]).forEach(function(h){if(!currentChats[h.patient_id])currentChats[h.patient_id]={conversation:h.lana_conversation_id,channel:h.lana_channel};});
          }
        }catch(_){}
      }
      if(token!==sequence||tenant!==tenantId)return;list.replaceChildren();
      quoteChats=window.SmylInbox?.canAccess?.()?currentChats:{};
      var dashboard=proposalDashboard(rows,latestEvents,list,access);root.insertBefore(dashboard.metrics,launch);root.insertBefore(dashboard.banner,launch);root.insertBefore(dashboard.toolbar,list);dashboard.render();
      if(!rows.length)list.replaceChildren(notice('Todavía no hay presentaciones guardadas. Abre un paciente y completa su recorrido para preparar la primera.'));
      root.append(n('p','proposal-privacy','Indicadores calculados sobre las últimas 100 propuestas visibles. La tasa usa únicamente decisiones registradas; no interpreta silencios como rechazo ni este seguimiento como firma o consentimiento.'));
    }catch(error){if(token===sequence){list.replaceChildren(notice(errorText(error),true),b('Volver a intentar',loadList));}}
  }
  // Sin plan revisado no se cotiza: abre el expediente del paciente directo en Tratamiento → Propuesta, con una guía
  // y el botón «Cotizar ahora» que solo continúa cuando la propuesta ya está revisada.
  function openPlanForQuote(patientId){
    if(!patientId||typeof window.verPaciente!=='function'){if(typeof window.ir==='function')window.ir('pacientes');return false;}
    var tenant=window.tenantId;Promise.resolve(window.verPaciente(patientId)).catch(function(){});
    var tries=0;(function ready(){
      var flow=window.SmylClinicalWorkflow;
      var done=flow&&typeof flow.focus==='function'&&flow.focus(tenant,patientId,function(){if(window.SmylProposals)window.SmylProposals.forPatient(patientId);},{title:'Para cotizar, termina la propuesta',text:'Escribe la valoración, elige los tratamientos y pulsa «Revisar propuesta». Después usa «Cotizar ahora».',action:'Cotizar ahora'});
      if(!done&&tries++<100)setTimeout(ready,80);
      else if(!done&&window.SmylCaseWorkspace&&typeof window.SmylCaseWorkspace.open==='function')window.SmylCaseWorkspace.open('plan');
    })();
    return true;
  }
  function init(){
    document.querySelectorAll('.pro-primary-nav .pro-next').forEach(function(e){e.remove();});
    var dialog=n('dialog','proposal-preview-dialog');dialog.id='proposal-preview-dialog';dialog.setAttribute('aria-label','Vista de la propuesta para el paciente');
    var toolbar=n('header','proposal-preview-toolbar');toolbar.append(n('strong','','Vista para el paciente'),b('Cerrar',function(){if(!ctx?.busy)dialog.close();}));var paper=n('div');paper.id='proposal-preview-paper';
    var bottom=n('footer','proposal-preview-footer'),label=n('label','clinic-confirm'),check=n('input');check.type='checkbox';check.id='proposal-approval-check';label.append(check,document.createTextNode('Revisé el plan, los importes, las condiciones y las imágenes. Apruebo esta versión para presentarla al paciente.'));
    check.addEventListener('change',controls);var approve=b('Aprobar esta versión',function(){save(true);},'btn btn-primary');approve.id='proposal-approve';bottom.append(label,approve);dialog.append(toolbar,paper,bottom);document.body.append(dialog);dialog.addEventListener('cancel',function(e){if(ctx?.busy)e.preventDefault();});
    var print=n('div');print.id='proposal-print';document.body.append(print);
    addEventListener('afterprint',function(){document.body.classList.remove('proposal-exporting');print.replaceChildren();});
    addEventListener('beforeunload',function(e){if(ctx&&(ctx.dirty||ctx.busy)){e.preventDefault();e.returnValue='';}});
    // Primary navigation always returns to the section's list, including when
    // its editor is already open. Keep the same dirty/busy guard on that path.
    var previous=window.ir;window.ir=function(route){if(ctx&&!leave())return false;var result=previous(route);if(result===false)return false;if(route==='propuestas')loadList();else sequence++;return result;};
    var logout=window.cerrarSesion;window.cerrarSesion=function(){if(leave())logout();};
    function resetChatLinks(){
      quoteChats={};
      var page=document.getElementById('p-propuestas');
      if(page?.classList.contains('activa')&&page.querySelector('.proposal-list')&&!ctx)loadList();
    }
    window.addEventListener('smyl:inbox-access',resetChatLinks);
    window.addEventListener('smyl:chat-routing-changed',resetChatLinks);
    setTimeout(refreshQuoteBadge,7000);setInterval(refreshQuoteBadge,600000);
    window.SmylProposals={forPatient:function(patientId){if(window.ir('propuestas')!==false)open(null,patientId);},openSaved:function(id){if(window.ir('propuestas')!==false)open(id);},openPlan:openPlanForQuote};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
