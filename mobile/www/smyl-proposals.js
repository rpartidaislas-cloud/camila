/* Stage 4: professional proposal workspace; no automatic messaging or AI calls. */
(function(){
  'use strict';
  var M=SmylProposalModel,ctx=null,sequence=0,lineSequence=0;
  function n(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function b(text,fn,cls){var e=n('button',cls||'btn btn-secondary',text);e.type='button';e.addEventListener('click',fn);return e;}
  function notice(text,error){var e=n('p','clinic-notice'+(error?' clinic-error':''),text);e.setAttribute('role',error?'alert':'status');return e;}
  function field(label,id,value,type){var wrap=n('div','clinic-field'),input=n(type==='textarea'?'textarea':'input'),lbl=n('label','',label);input.id=id;lbl.htmlFor=id;if(type&&type!=='textarea')input.type=type;input.value=value==null?'':value;wrap.append(lbl,input);return wrap;}
  async function checked(query){var res=await sbTimeout(query,30000);if(res.error)throw res.error;return res.data;}
  function errorText(error){if(['40001','PT409'].includes(error.code))return 'El plan o la propuesta cambió, o su vigencia terminó. Conservamos tus cambios; vuelve a cargar la propuesta o actualiza su plan y revisa de nuevo.';if(['42P01','PGRST202','PGRST205'].includes(error.code))return 'Propuestas aún no está habilitado en la base de datos. Falta activar esta etapa.';return SmylClinicalModel.errorMessage(error);}
  function feedback(text,error){var host=document.getElementById('proposal-feedback');if(host)host.replaceChildren(notice(text,error));}
  function cleanup(){if(ctx)Object.values(ctx.files).forEach(function(f){if(f)URL.revokeObjectURL(f.url);});ctx=null;sequence++;}
  function leave(){if(ctx&&ctx.busy){alert('Espera a que termine la operación.');return false;}if(ctx&&ctx.dirty&&!confirm('Hay cambios sin guardar en la propuesta. ¿Quieres descartarlos?'))return false;cleanup();return true;}
  function rowFromForm(){
    var doc={schema:1,title:document.getElementById('proposal-title').value.trim(),introduction:document.getElementById('proposal-intro').value.trim(),terms:document.getElementById('proposal-terms').value.trim(),valid_until:document.getElementById('proposal-valid').value,items:[],photos:null};
    document.querySelectorAll('.proposal-item').forEach(function(row){doc.items.push({label:row.querySelector('[data-field="label"]').value.trim(),area:row.querySelector('[data-field="area"]').value.trim(),quantity:Number(row.querySelector('[data-field="quantity"]').value),unit_cents:M.cents(row.querySelector('[data-field="price"]').value)});});
    if(document.getElementById('proposal-include-photos').checked)doc.photos={before_path:ctx.files.before?ctx.files.before.path:ctx.photoPaths?.before_path||'',simulation_path:ctx.files.simulation?ctx.files.simulation.path:ctx.photoPaths?.simulation_path||'',view:document.getElementById('proposal-view').value};
    return {...ctx.row,document:doc,plan_revision:ctx.plan.revision};
  }
  function changed(){if(!ctx)return;ctx.dirty=JSON.stringify(rowFromForm().document)!==ctx.saved||ctx.plan.revision!==ctx.row.plan_revision;document.getElementById('proposal-approval-check').checked=false;controls();}
  function controls(){
    if(!ctx)return;
    document.getElementById('proposal-form').disabled=ctx.busy;
    var doc=rowFromForm().document,approved=ctx.row.status==='approved'&&!ctx.dirty&&!ctx.stale;
    document.getElementById('proposal-state').textContent=ctx.busy?'Procesando…':ctx.stale?'Plan actualizado: requiere revisión':ctx.dirty?'Cambios sin guardar':approved?'Aprobada · no enviada':ctx.row.revision?'Borrador guardado':'Borrador nuevo';
    document.getElementById('proposal-estimate').textContent=doc.items.some(function(i){return i.unit_cents===null;})?'Total por completar':M.money(M.total(doc));
    document.getElementById('proposal-save').disabled=ctx.busy||ctx.stale;
    document.getElementById('proposal-preview').disabled=ctx.busy;
    document.getElementById('proposal-export').disabled=ctx.busy||!approved;
    var followup=document.getElementById('proposal-followup');if(followup)followup.disabled=ctx.busy||!approved||!ctx.row.revision;
    document.getElementById('proposal-add').disabled=ctx.busy||doc.items.length>=20;
    document.getElementById('proposal-photo-inputs').hidden=!document.getElementById('proposal-include-photos').checked;
    document.getElementById('proposal-approve').disabled=ctx.busy||ctx.stale||!document.getElementById('proposal-approval-check').checked;
  }
  function addLine(item){
    if(document.querySelectorAll('.proposal-item').length>=20)return;item=item||{label:'',area:'',quantity:1,unit_cents:null};lineSequence++;
    var row=n('article','proposal-item');
    [['Concepto','label',item.label,'text'],['Zona · opcional','area',item.area,'text'],['Cantidad','quantity',item.quantity,'number'],['Precio por unidad · MXN','price',item.unit_cents===null?'':(item.unit_cents/100).toFixed(2),'text']].forEach(function(e){var f=field(e[0],'proposal-line-'+lineSequence+'-'+e[1],e[2],e[3]);f.lastChild.dataset.field=e[1];if(e[1]==='quantity'){f.lastChild.min='1';f.lastChild.max='100';f.lastChild.step='1';}else{f.lastChild.maxLength=e[1]==='price'?10:200;}if(e[1]==='price'){f.lastChild.inputMode='decimal';f.lastChild.placeholder='Por definir';}row.append(f);});
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
  async function save(approve){
    if(!ctx||ctx.busy||ctx.stale)return;
    var problem=validForm(approve);if(problem){feedback(problem,true);document.getElementById('proposal-preview-dialog').close();return;}
    if(approve&&!document.getElementById('proposal-approval-check').checked)return;
    var current=ctx,row=rowFromForm();current.busy=true;document.getElementById('proposal-form').disabled=true;controls();
    document.getElementById('proposal-preview-dialog').close();
    try{
      await uploadPhotos(current,row.document);
      var saved=await checked(sb.rpc('smyl_save_proposal',{p_id:row.id,p_tenant_id:current.tenant,p_patient_id:row.patient_id,p_plan_revision:row.plan_revision,p_expected_revision:current.row.revision||0,p_document:row.document,p_approve:approve}));
      if(Array.isArray(saved))saved=saved[0];
      if(!saved||saved.id!==row.id||saved.tenant_id!==current.tenant||saved.patient_id!==row.patient_id||!saved.revision)throw new Error('Unconfirmed save');
      if(ctx!==current)return;
      current.row=saved;current.photoPaths=saved.document.photos;current.saved=JSON.stringify(saved.document);current.dirty=false;
      feedback(approve?'Propuesta aprobada y guardada. Ya puedes preparar el PDF; no se ha enviado a nadie.':'Borrador guardado. Los cambios aún necesitan revisión.');
      document.getElementById('proposal-versions').open=false;
    }catch(error){if(ctx===current){feedback(errorText(error),true);if(['40001','PT409'].includes(error.code))current.stale=true;}}
    finally{current.busy=false;if(ctx===current){document.getElementById('proposal-form').disabled=false;controls();}}
  }
  async function preview(){
    if(!ctx||ctx.busy)return;var problem=validForm(false);if(problem){feedback(problem,true);return;}
    var current=ctx;current.busy=true;controls();document.getElementById('proposal-feedback').replaceChildren();
    try{var row=rowFromForm(),assets=await assetsFor(row,current,true);if(ctx!==current)return;
      var host=document.getElementById('proposal-preview-paper');host.replaceChildren(SmylProposalPrint.render(row,assets,false));
      await Promise.all(Array.from(host.querySelectorAll('img')).map(function(img){return img.decode();}));
      document.getElementById('proposal-approval-check').checked=false;document.getElementById('proposal-preview-dialog').showModal();
    }catch(error){if(ctx===current)feedback('No se pudo preparar la vista previa. Revisa las fotografías y vuelve a intentar.',true);}
    finally{current.busy=false;if(ctx===current)controls();}
  }
  async function exportPDF(){
    if(!ctx||ctx.busy||ctx.dirty||ctx.stale||ctx.row.status!=='approved')return;
    var current=ctx;current.busy=true;controls();
    try{
      var row=await checked(sb.rpc('smyl_proposal_for_export',{p_id:current.row.id,p_revision:current.row.revision}));if(Array.isArray(row))row=row[0];
      if(!row||row.id!==current.row.id||row.tenant_id!==current.tenant||row.status!=='approved'||row.revision!==current.row.revision)throw new Error('Unconfirmed export');
      var assets=await assetsFor(row,current,false);if(ctx!==current)return;
      var print=document.getElementById('proposal-print');print.replaceChildren(SmylProposalPrint.render(row,assets,true));
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
    var current=ctx,host=document.getElementById('proposal-version-list');host.replaceChildren(notice('Cargando versiones…'));
    try{var rows=await checked(sb.from('smyl_proposal_versions').select('revision,snapshot').eq('tenant_id',current.tenant).eq('proposal_id',current.row.id).order('revision',{ascending:false}).limit(25));if(ctx!==current)return;host.replaceChildren();rows.forEach(function(v){var d=n('details','clinic-version'),r=v.snapshot;d.append(n('summary','','Versión '+v.revision+' · '+(r.status==='approved'?'Aprobada en ese momento':'Borrador')),n('p','',r.document.title+' · '+M.money(r.total_cents)+' · Plan '+r.plan_revision),n('p','','Guardada: '+new Date(r.updated_at).toLocaleString('es-MX')));var list=n('ul');r.document.items.forEach(function(item){list.append(n('li','',item.label+' · '+item.quantity+' × '+(item.unit_cents===null?'Por definir':M.money(item.unit_cents))));});d.append(list);host.append(d);});host.append(n('small','','Últimas 25 versiones. Una aprobación anterior no aprueba cambios posteriores.'));}
    catch(_){if(ctx===current)host.replaceChildren(notice('No se pudo cargar el historial.',true));}
  }
  function editor(){
    var root=document.getElementById('p-propuestas');root.replaceChildren();
    root.append(b('← Presentaciones',function(){if(leave())loadList();},'clinic-back'));
    var header=n('header','proposal-heading'),title=n('div');title.append(n('p','pro-eyebrow','PREPARAR PROPUESTA'),n('h1','',ctx.row.patient_name));var badge=n('span','clinic-state');badge.id='proposal-state';header.append(title,badge);root.append(header);
    var message=n('div');message.id='proposal-feedback';root.append(message);
    var layout=n('div','proposal-layout'),form=n('fieldset','proposal-editor');form.id='proposal-form';
    var doc=ctx.row.document;
    form.append(field('Título','proposal-title',doc.title),field('Mensaje para el paciente · opcional','proposal-intro',doc.introduction,'textarea'));
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
    var saveButton=b('Guardar borrador',function(){save(false);});saveButton.id='proposal-save';var previewButton=b('Vista previa y revisión',preview,'btn btn-primary');previewButton.id='proposal-preview';var exportButton=b('Guardar como PDF',exportPDF);exportButton.id='proposal-export';side.append(saveButton,previewButton,exportButton,n('p','proposal-privacy','El paciente solo verá la propuesta. Antecedentes y notas internas no se incluyen. No hay envío automático ni conexión activa con LANA en este espacio.'));
    if(window.SmylLana){var followup=b('Seguimiento con LANA',function(){SmylLana.open();});followup.id='proposal-followup';side.append(followup);}
    var tools=n('details','clinic-secondary');tools.append(n('summary','','Actualizar o recargar'),b('Usar plan revisado actual',refreshPlan),b('Recargar propuesta guardada',function(){var id=ctx.row.id;if(leave())open(id);}));side.append(tools);
    layout.append(form,side);root.append(layout);doc.items.forEach(addLine);
    document.getElementById('proposal-title').maxLength=150;document.getElementById('proposal-intro').maxLength=3000;document.getElementById('proposal-terms').maxLength=3000;
    var hist=n('details','clinic-secondary');hist.id='proposal-versions';hist.append(n('summary','','Historial de propuestas'));var list=n('div');list.id='proposal-version-list';hist.append(list);hist.addEventListener('toggle',versions);root.append(hist);
    form.addEventListener('input',changed);form.addEventListener('change',changed);controls();
    if(ctx.stale)feedback('Esta propuesta pertenece a otra versión del plan. Usa el plan revisado actual antes de aprobar o exportar.',true);
    if(doc.photos){var current=ctx;assetsFor(ctx.row,ctx,false).then(function(assets){if(ctx!==current)return;Object.keys(assets).forEach(function(key){var img=document.getElementById('proposal-photo-'+key);img.src=assets[key];img.hidden=false;});}).catch(function(){if(ctx===current)feedback('No se pudieron cargar las fotos guardadas. La propuesta conserva sus referencias; vuelve a intentar antes de exportar.',true);});}
  }
  async function open(id,patientId){
    if(!tenantId||miRolEquipo!=='dueño')return;
    if(!leave())return;
    var tenant=tenantId,token=++sequence,root=document.getElementById('p-propuestas');root.replaceChildren(notice('Preparando propuesta…'));
    try{
      var row=id?await checked(sb.from('smyl_proposals').select('*').eq('tenant_id',tenant).eq('id',id).single()):null;
      var patient=await checked(sb.from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id',tenant).eq('id',row?row.patient_id:patientId).single());
      if(!patient)throw new Error('Patient not available');
      var plan=await checked(sb.from('smyl_clinical_plans').select('*').eq('tenant_id',tenant).eq('patient_id',patient.id).maybeSingle());
      if(token!==sequence||tenant!==tenantId)return;
      if(!plan||(!row&&plan.status!=='reviewed')){root.replaceChildren(notice('Primero guarda y revisa el plan en la ficha del paciente.'),b('Ir a Pacientes',function(){ir('pacientes');}));return;}
      if(token!==sequence||tenant!==tenantId)return;
      if(!row){var config=tenantData?.config||{};row={id:crypto.randomUUID(),tenant_id:tenant,patient_id:patient.id,patient_name:[patient.nombre,patient.apellido].filter(Boolean).join(' '),clinic_name:config.consultorio||tenantData?.nombre||'Clínica dental',professional_name:config.doctor||'',plan_revision:plan.revision,revision:0,status:'draft',document:M.fromPlan(plan)};}
      ctx={row:row,tenant:tenant,plan:plan,files:{},photoPaths:row.document.photos,saved:JSON.stringify(row.document),dirty:!id,busy:false,stale:plan.status!=='reviewed'||row.plan_revision!==plan.revision};editor();
    }catch(error){if(token===sequence)root.replaceChildren(notice(errorText(error),true),b('Volver a Presentaciones',loadList));}
  }
  async function loadList(){
    var root=document.getElementById('p-propuestas');root.replaceChildren();
    var head=n('header','proposal-heading'),copy=n('div');copy.append(n('p','pro-eyebrow','HISTORIAL Y ACCESOS'),n('h1','','Presentaciones'),n('p','','Consulta lo que preparaste para tus pacientes. Para crear una nueva, continúa el recorrido desde su expediente.'));head.append(copy);root.append(head);
    if(!tenantId){root.append(notice('Inicia sesión para consultar las propuestas de tu clínica.'));return;}
    if(miRolEquipo!=='dueño'){root.append(notice('La preparación y aprobación de propuestas está habilitada para el titular de la clínica.'));return;}
    var tenant=tenantId,token=++sequence;
    if(window.SmylLana)head.append(b('Seguimiento con LANA',function(){SmylLana.open();},'btn btn-secondary lana-entry'));
    var launch=n('div','proposal-launch proposal-from-patient'),launchCopy=n('div');
    launchCopy.append(n('strong','','¿Quieres preparar una nueva?'),n('p','','Abre la ficha del paciente y continúa hasta el paso Compartir. Así conservarás todo el caso en un solo recorrido.'));
    launch.append(launchCopy,b('Abrir pacientes',function(){ir('pacientes');},'btn btn-primary'));root.append(launch);
    var list=n('div','proposal-list');root.append(list);list.append(notice('Cargando propuestas…'));
    try{
      var rows=await checked(sb.from('smyl_proposals').select('id,patient_name,plan_revision,revision,status,total_cents,updated_at,document').eq('tenant_id',tenant).order('updated_at',{ascending:false}).limit(100));
      if(token!==sequence||tenant!==tenantId)return;list.replaceChildren();
      if(!rows.length)list.append(notice('Todavía no hay presentaciones guardadas. Abre un paciente y completa su recorrido para preparar la primera.'));
      rows.forEach(function(row){var card=n('article','proposal-list-row'),text=n('div');text.append(n('h2','',row.patient_name),n('p','',row.document.title+' · Versión '+row.revision),n('small','',row.status==='approved'?'Aprobada al guardar · vigencia y plan se verifican al exportar':'Borrador'));card.append(text,n('strong','',row.document.items.some(function(i){return i.unit_cents===null;})?'Por completar':M.money(row.total_cents)),b('Abrir',function(){open(row.id);}));list.append(card);});
      list.append(n('p','proposal-privacy','Se muestran las últimas 100 propuestas. No se han habilitado envíos automáticos desde este espacio.'));
    }catch(error){if(token===sequence){list.replaceChildren(notice(errorText(error),true),b('Volver a intentar',loadList));}}
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
    window.SmylProposals={forPatient:function(patientId){if(window.ir('propuestas')!==false)open(null,patientId);},openSaved:function(id){if(window.ir('propuestas')!==false)open(id);}};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
