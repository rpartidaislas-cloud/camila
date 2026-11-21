// Real patient-file and clinical evidence modules with an offline authenticated data boundary.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname,'..');
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', patient='11111111-1111-4111-8111-111111111111';
const actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const resources=['smyl-history-model.js','smyl-patient-360.js','smyl-clinical-photo-service.js','smyl-guided-photos.js','smyl-case-workspace.js'];
const subtype=['intraoral_frontal','intraoral_right','intraoral_left','occlusal_upper','occlusal_lower'];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/YOeYgAAAABJRU5ErkJggg==','base64');

function install({tenant,patient,actor}) {
  window.tenantId=tenant;window.pacienteActual={id:patient,nombre:'Paciente de prueba'};window.miUsuario={id:actor};window.miRolEquipo='staff';
  window.SmylSecureFiles={verify:async(client,bucket,name,file,sha)=>{if(!sha||!file.size||bucket!=='smyl-clinical-files')throw Error('Verificación inválida');}};
  window.sb={
    auth:{getUser:async()=>({data:{user:{id:actor}}}),onAuthStateChange:()=>{}},
    storage:{from:bucket=>({upload:(name,file,options)=>window.fakeUpload({name,type:file.type,bucket,options})})},
    rpc:(name,args)=>window.fakeRpc({name,args}),
    from:table=>{
      const filters={},query={
        select:()=>query,order:()=>query,limit:()=>query,neq:()=>query,
        eq:(k,v)=>{filters[k]=v;return query;},in:(k,v)=>{filters[k]=v;return query;},
        maybeSingle:()=>window.fakeRead({table,filters,one:true}),
        then:(resolve,reject)=>window.fakeRead({table,filters,one:false}).then(resolve,reject)
      };return query;
    }
  };
}
async function scenario(browser,width){
  const context=await browser.newContext({viewport:{width,height:width===320?640:850},hasTouch:width<800,reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[];
  page.on('pageerror',err=>errors.push(err.message));
  const rows=[],studies=[],assets=[],uploads=[],indexed=[];
  let role='write',failIndex=false,failRead=false;
  await page.exposeFunction('fakeRead',({table,filters,one})=>{
    if(failRead && table==='smyl_patient_files')return {error:{message:'offline'}};
    const data={
      smyl_role_permissions:(role==='none'?[]:role==='read'?['clinical.read']:['clinical.read','clinical.write']).map(key=>({permission_key:key,role_id:'dentista'})),
      smyl_member_roles:[{user_id:actor,role_id:'dentista'}], smyl_patient_files:rows,smyl_clinical_evidence_studies:studies,smyl_clinical_evidence_assets:assets
    }[table] || [];
    const available=data.filter(row=>Object.entries(filters).every(([k,v])=>row[k]===undefined||(Array.isArray(v)?v.includes(row[k]):row[k]===v)));
    return {data:one?available[0]||null:available};
  });
  await page.exposeFunction('fakeUpload',({name,bucket,options})=>{
    assert.equal(bucket,'smyl-clinical-files');assert.ok(name.startsWith(tenant+'/'+patient+'/'));assert.equal(options.upsert,false);
    assert.ok(!uploads.includes(name));uploads.push(name);return {data:{path:name}};
  });
  await page.exposeFunction('fakeRpc',({name,args})=>{
    if(name==='smyl_patient_timeline')return {data:[]};
    assert.equal(args.p_patient_id,patient);
    if(name==='smyl_register_patient_file'){
      const row={id:args.p_id,patient_id:patient,tenant_id:tenant,category:args.p_category,notes:args.p_notes,sha256:args.p_sha256,status:'active',
        captured_at:args.p_captured_at,created_at:new Date().toISOString(),mime_type:args.p_mime_type,size_bytes:args.p_size_bytes,display_name:args.p_display_name,storage_path:args.p_storage_path};
      assert.equal(row.category,'clinical_photo');rows.push(row);return {data:row};
    }
    assert.equal(name,'smyl_evidence_register_photo_file');
    if(failIndex){failIndex=false;return {error:{message:'offline'}};}
    const study={id:args.p_study_id,tenant_id:tenant,patient_id:patient,subtype:args.p_subtype,metadata:args.p_metadata,modality:'photograph',status:'active'};
    studies.push(study);assets.push({study_id:study.id,patient_file_id:args.p_patient_file_id,tenant_id:tenant,patient_id:patient,asset_role:'original'});indexed.push(study.subtype);return {data:study};
  });
  await page.addInitScript(install,{tenant,patient,actor});
  const html='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font:15px system-ui}[hidden]{display:none!important}</style><link rel="stylesheet" href="/smyl-case-workspace.css">'+resources.map(name=>'<script defer src="/'+name+'"></script>').join('')+'<main id="p-paciente-detalle" class="activa"><div class="clinic-layout"></div></main></html>';
  await page.route('https://smyl.test/**',async route=>{
    const file=new URL(route.request().url()).pathname.slice(1);
    if(!file)return route.fulfill({contentType:'text/html',body:html});
    if(!resources.includes(file)&&file!=='smyl-case-workspace.css')return route.abort();
    return route.fulfill({contentType:file.endsWith('js')?'text/javascript':'text/css',body:await fs.readFile(path.join(root,file))});
  });
  const launch=()=>page.evaluate(()=>window.SmylCaseWorkspace.openChairside('guided-photos',tenantId,pacienteActual.id));
  const dialog=page.getByRole('dialog',{name:'Fotografías guiadas'});
  try{
    await page.goto('https://smyl.test/');
    await launch();await dialog.getByText('0 de 5 vistas guardadas').waitFor();
    assert.equal(await dialog.locator('input[capture]').getAttribute('capture'),'environment');
    assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
    const save=dialog.locator('.gphoto-actions .gphoto-primary');
    for(let i=0;i<5;i++){
      assert.equal(await save.isDisabled(),true);
      await dialog.getByLabel('Elegir archivo').setInputFiles({name:'vista-'+i+'.png',mimeType:'image/png',buffer:png});
      await dialog.locator('.gphoto-preview').waitFor();
      if(i===0){
        const output=path.join(root,'output','chairside-photos');
        await fs.mkdir(output,{recursive:true});
        await dialog.screenshot({path:path.join(output,width+'.png')});
      }
      assert.equal(uploads.length,i,'La vista previa no debe subir la fotografía');
      if(i===1)failIndex=true;
      await save.click();
      if(i===1){
        await dialog.getByText('El original está guardado.',{exact:false}).waitFor();
        await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
        await page.reload();await launch();
        await dialog.getByRole('button',{name:'Confirmar clasificación',exact:true}).click();
      }
      await dialog.getByText((i+1)+' de 5 vistas guardadas').waitFor();
      assert.equal(uploads.length,i+1);assert.equal(rows.length,i+1);assert.deepEqual(indexed,subtype.slice(0,i+1));
    }
    await dialog.getByRole('heading',{name:'Serie completa'}).waitFor();
    await dialog.getByRole('button',{name:'Terminar'}).click();
    await page.reload();await launch();await dialog.getByRole('heading',{name:'Serie completa'}).waitFor();
    await dialog.getByRole('button',{name:'Iniciar otra serie'}).click();await dialog.getByText('0 de 5 vistas guardadas').waitFor();
    await page.evaluate(()=>{window.pacienteActual={id:'22222222-2222-4222-8222-222222222222',nombre:'Segundo paciente'};});
    await dialog.waitFor({state:'detached'});assert.equal(uploads.length,5);
    for(const mode of ['read','none','error']){
      role=mode==='error'?'write':mode;failRead=mode==='error';await page.reload();
      const result=await launch().then(()=>'',error=>error.message);
      assert.match(result,mode==='error'?/cargar el expediente/:/Tu rol/);assert.equal(await dialog.count(),0);
    }
    assert.deepEqual(errors,[]);console.log(width+' px · cinco vistas, reanudación, permisos, identidad y fallo de carga.');
  }finally{await context.close();}
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined)});
  try{for(const width of [1366,768,390,320])await scenario(browser,width);}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
