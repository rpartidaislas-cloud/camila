(function(){
  const T='11111111-1111-4111-8111-111111111111';
  const now=new Date().toISOString();
  const db={
    camila_tenants:[{id:T,nombre:'Dd',email:'dd@clinica.mx',plan:'profesional',limite_diagnosticos:40,diagnosticos_usados:0,activo:true,vence_en:new Date(Date.now()+30*864e5).toISOString(),config:{},created_at:now}],
    camila_usuarios:[],
    camila_pacientes:[
      {id:'p1000000-0000-4000-8000-000000000001',tenant_id:T,nombre:'Paciente de LANA',apellido:'',email:'',telefono:'523337749962',created_at:now,notas:'',alertas_medicas:[]},
      {id:'p2000000-0000-4000-8000-000000000002',tenant_id:T,nombre:'Rich',apellido:'',email:'',telefono:'3313445614',created_at:now,notas:'',alertas_medicas:[]},
      {id:'p3000000-0000-4000-8000-000000000003',tenant_id:T,nombre:'La doña 2',apellido:'',email:'',telefono:'',created_at:now,notas:'',alertas_medicas:[]},
    ],
  };
  // Equipo de prueba (docs/pruebas/equipo-de-prueba.sql): 3 sucursales, 6 dentistas, 12 servicios.
  const TZ='America/Mexico_City';
  db.smyl_branches=[
    {id:'c',tenant_id:T,name:'Sucursal Centro',timezone:TZ,is_default:true,active:true},
    {id:'p',tenant_id:T,name:'Sucursal Plaza Sol',timezone:TZ,is_default:false,active:true},
    {id:'l',tenant_id:T,name:'Sucursal Lomas Verdes',timezone:TZ,is_default:false,active:true}];
  db.smyl_rooms=[
    {id:'c1',tenant_id:T,branch_id:'c',name:'Sillón 1',active:true},{id:'c2',tenant_id:T,branch_id:'c',name:'Sillón 2',active:true},{id:'c3',tenant_id:T,branch_id:'c',name:'Sillón 3',active:true},
    {id:'p1',tenant_id:T,branch_id:'p',name:'Sillón único',active:true},
    {id:'l1',tenant_id:T,branch_id:'l',name:'Sillón 1',active:true},{id:'l2',tenant_id:T,branch_id:'l',name:'Sillón 2',active:true}];
  const pro=(id,n,s,c)=>({id,tenant_id:T,display_name:n,specialty:s,color_token:c,active:true});
  db.smyl_professionals=[pro('d1','Dra. Valeria Montoya Cruz','Odontología general','teal'),pro('d2','Dr. Andrés Salinas Ibarra','Endodoncia','blue'),pro('d3','Dra. Mónica Reyes Tapia','Ortodoncia','violet'),
    pro('d4','Dr. Rodrigo Pineda León','Odontopediatría','amber'),pro('d5','Dra. Fernanda Lozano Vera','Estética dental','coral'),pro('d6','Dr. Iván Carrasco Mejía','Cirugía oral e implantes','navy')];
  const SCHED=[['d1','c',[1,3,5],'09:00','14:00'],['d1','p',[2,4],'10:00','16:00'],['d2','c',[2,4],'10:00','14:00'],['d2','c',[2,4],'15:00','19:00'],['d3','p',[1,3,5],'10:00','18:00'],['d3','l',[6],'09:00','14:00'],
    ['d4','l',[1,2,3,4,5],'09:00','15:00'],['d5','p',[2,4],'12:00','20:00'],['d5','p',[6],'10:00','15:00'],['d5','c',[5],'15:00','19:00'],['d6','l',[2,4],'12:00','18:00'],['d6','c',[6],'09:00','14:00']];
  db.smyl_professional_hours=[];SCHED.forEach(r=>r[2].forEach(w=>db.smyl_professional_hours.push({id:'h'+db.smyl_professional_hours.length,tenant_id:T,professional_id:r[0],branch_id:r[1],weekday:w,starts_at:r[3],ends_at:r[4],active:true})));
  db.smyl_professional_branches=[];SCHED.forEach(r=>{if(!db.smyl_professional_branches.some(x=>x.professional_id===r[0]&&x.branch_id===r[1]))db.smyl_professional_branches.push({tenant_id:T,professional_id:r[0],branch_id:r[1]});});
  db.smyl_clinic_hours=[];[1,2,3,4,5].forEach(w=>{db.smyl_clinic_hours.push({tenant_id:T,branch_id:'c',weekday:w,starts_at:'09:00',ends_at:'14:00',active:true},{tenant_id:T,branch_id:'c',weekday:w,starts_at:'15:00',ends_at:'19:00',active:true},{tenant_id:T,branch_id:'p',weekday:w,starts_at:'10:00',ends_at:'20:00',active:true},{tenant_id:T,branch_id:'l',weekday:w,starts_at:'09:00',ends_at:'18:00',active:true});});
  db.smyl_clinic_hours.push({tenant_id:T,branch_id:'c',weekday:6,starts_at:'09:00',ends_at:'14:00',active:true},{tenant_id:T,branch_id:'p',weekday:6,starts_at:'10:00',ends_at:'15:00',active:true},{tenant_id:T,branch_id:'l',weekday:6,starts_at:'09:00',ends_at:'14:00',active:true});
  const SV=[['s1','Valoración dental integral',60,['d1','d2','d4','d5','d6']],['s2','Limpieza dental',45,['d1','d4']],['s3','Aplicación de flúor',30,['d1','d4']],['s4','Resina (restauración)',60,['d1']],['s5','Extracción simple',45,['d1','d6']],
    ['s6','Endodoncia',90,['d2']],['s7','Valoración de ortodoncia',45,['d3']],['s8','Revisión de ortodoncia',30,['d3']],['s9','Consulta odontopediátrica',30,['d4']],['s10','Blanqueamiento dental',60,['d5']],['s11','Valoración de carillas',45,['d5']],['s12','Consulta de implantes',45,['d6']]];
  db.smyl_services=SV.map(x=>({id:x[0],tenant_id:T,name:x[1],duration_minutes:x[2],buffer_before_minutes:0,buffer_after_minutes:0,active:true,category:'general',fiscal_status:'reviewed',tax_treatment:'exempt',tax_rate:0}));
  db.smyl_professional_services=[];SV.forEach(x=>x[3].forEach(d=>db.smyl_professional_services.push({tenant_id:T,professional_id:d,service_id:x[0]})));
  db.camila_pacientes=[{id:'pac1',tenant_id:T,nombre:'Hernan',apellido:'Partida',email:'',telefono:'',created_at:now,notas:'',alertas_medicas:[]}];
  // Una cita de Valeria el próximo martes 12:00–13:00 en Plaza Sol (único sillón): ocupa a la dentista Y al sillón.
  const tue=new Date();tue.setHours(12,0,0,0);do{tue.setDate(tue.getDate()+1);}while(tue.getDay()!==2);
  window.__nextTuesday=tue.getFullYear()+'-'+String(tue.getMonth()+1).padStart(2,'0')+'-'+String(tue.getDate()).padStart(2,'0');
  db.smyl_appointments=[{id:'a1',tenant_id:T,patient_id:'pac1',service_id:'s1',branch_id:'p',professional_id:'d1',room_id:'p1',starts_at:tue.toISOString(),ends_at:new Date(tue.getTime()+3600e3).toISOString(),status:'confirmed',updated_at:now,extra_minutes:0}];
  db.smyl_finance_settings=[];db.smyl_finance_charges=[];db.smyl_appointment_no_charge=[];
  window.__db=db;
  window.__calls=[];
  function chain(table){
    const q={table,filters:[],single:false};
    const api=new Proxy(function(){},{
      get(_,prop){
        if(prop==='then'){return (res,rej)=>{
          let rows=(db[table]||[]).slice();
          q.filters.forEach(f=>{rows=rows.filter(r=>f[2]==='in'?f[1].includes(r[f[0]]):r[f[0]]===f[1]);});
          let out={data:q.single?(rows[0]||null):rows,error:null,count:rows.length};
          window.__calls.push(['from',table]);
          return Promise.resolve(out).then(res,rej);
        };}
        if(prop==='in'){return (c,v)=>{q.filters.push([c,v,'in']);return api;};}
        if(prop==='eq'){return (c,v)=>{q.filters.push([c,v]);return api;};}
        if(prop==='maybeSingle'||prop==='single'){return ()=>{q.single=true;return api;};}
        return ()=>api;
      }
    });
    return api;
  }
  const rpcData={
    smyl_has_permission:true, smyl_can_edit_professional_profile:true, smyl_current_tenant:T,
  };
  function client(){
    const user={id:T,email:'dd@clinica.mx',user_metadata:{},is_anonymous:false};
    const session={access_token:'fake.jwt.token',user,expires_at:Math.floor(Date.now()/1000)+3600};
    return {
      auth:{
        getSession:async()=>({data:{session},error:null}),
        getUser:async()=>({data:{user},error:null}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
        signOut:async()=>({error:null}),
      },
      from:chain,
      rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);if(name==='smyl_set_no_show_fee'){const row=db.smyl_finance_settings[0];if(row)row.no_show_fee=args.p_amount;else db.smyl_finance_settings.push({tenant_id:T,no_show_fee:args.p_amount});return {data:args.p_amount,error:null};}if(name==='smyl_appointment_billing'){const fee=Number((db.smyl_finance_settings[0]||{}).no_show_fee||0);return {data:args.p_appointment_ids.map(id=>{const a=db.smyl_appointments.find(x=>x.id===id);if(!a||!['arrived','in_progress','completed','no_show'].includes(a.status))return null;const ch=db.smyl_finance_charges.filter(c=>c.appointment_id===id&&c.status!=='voided');const svc=db.smyl_services.find(x=>x.id===a.service_id);if(ch.length){const total=ch.reduce((n,c)=>n+Number(c.total_amount),0);const paid=ch.reduce((n,c)=>n+Number(c.paid||0),0);return {appointment_id:id,billing_state:total-paid>0?'due':'paid',charged_amount:total,due_amount:Math.max(total-paid,0)};}if(db.smyl_appointment_no_charge.some(n=>n.appointment_id===id))return {appointment_id:id,billing_state:'no_charge',charged_amount:0,due_amount:0};if(a.status==='no_show')return {appointment_id:id,billing_state:fee>0?'no_show_pending':'free',charged_amount:0,due_amount:0};if(svc&&Number(svc.reference_price)===0)return {appointment_id:id,billing_state:'free',charged_amount:0,due_amount:0};return {appointment_id:id,billing_state:'pending',charged_amount:0,due_amount:0};}).filter(Boolean),error:null};}if(name==='smyl_mark_appointment_no_charge'){db.smyl_appointment_no_charge.push({tenant_id:T,appointment_id:args.p_appointment_id,reason:args.p_reason,decided_at:new Date().toISOString()});return {data:null,error:null};}if(name==='smyl_reopen_appointment_charge'){db.smyl_appointment_no_charge=db.smyl_appointment_no_charge.filter(n=>n.appointment_id!==args.p_appointment_id);return {data:null,error:null};}if(name==='smyl_post_charge'){const row={id:args.p_id,tenant_id:T,patient_id:args.p_patient_id,appointment_id:args.p_appointment_id,status:'open',total_amount:args.p_unit_price,concept:args.p_concept,created_at:new Date().toISOString()};db.smyl_finance_charges.push(row);return {data:[row],error:null};}return {data:name in rpcData?rpcData[name]:[],error:null};},
      functions:{invoke:async(name)=>{window.__calls.push(['fn',name]);return {data:{},error:null};}},
      storage:{from:()=>({createSignedUrl:async()=>({data:null,error:null}),getPublicUrl:()=>({data:{publicUrl:''}}),list:async()=>({data:[],error:null}),upload:async()=>({data:{},error:null})})},
      channel:()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe(){}};return c;},
      removeChannel(){},
    };
  }
  window.supabase={createClient:client};
})();
