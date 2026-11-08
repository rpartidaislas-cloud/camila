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
  const now2=Date.now(),iso=(h)=>new Date(now2-h*3600e3).toISOString();
  db.smyl_services=[{id:'s1',tenant_id:T,name:'Limpieza dental',reference_price:800,active:true,fiscal_status:'reviewed',tax_treatment:'exempt',tax_rate:0},{id:'s2',tenant_id:T,name:'Revisión',reference_price:0,active:true,fiscal_status:'reviewed',tax_treatment:'exempt',tax_rate:0}];
  db.smyl_branches=[{id:'b1',tenant_id:T,name:'Principal',is_default:true,active:true}];
  const P1='p1000000-0000-4000-8000-000000000001',P2='p2000000-0000-4000-8000-000000000002',P3='p3000000-0000-4000-8000-000000000003';
  db.smyl_appointments=[
    {id:'a1',tenant_id:T,patient_id:P1,service_id:'s1',branch_id:'b1',starts_at:iso(2),status:'arrived'},
    {id:'a2',tenant_id:T,patient_id:P2,service_id:'s1',branch_id:'b1',starts_at:iso(3),status:'in_progress'},
    {id:'a3',tenant_id:T,patient_id:P3,service_id:'s1',branch_id:'b1',starts_at:iso(5),status:'completed'},
    {id:'a4',tenant_id:T,patient_id:P1,service_id:'s2',branch_id:'b1',starts_at:iso(1),status:'arrived'},
    {id:'a5',tenant_id:T,patient_id:P2,service_id:'s1',branch_id:'b1',starts_at:iso(24),status:'completed'},
    {id:'a6',tenant_id:T,patient_id:P3,service_id:'s1',branch_id:'b1',starts_at:iso(-24),status:'confirmed'}];
  db.smyl_finance_charges=[{id:'c1',tenant_id:T,patient_id:P2,appointment_id:'a5',status:'open',total_amount:800,created_at:iso(20),concept:'Limpieza',due_on:null}];
  db.smyl_appointment_no_charge=[];
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
      rpc:async(name,args)=>{window.__calls.push(['rpc',name,args]);if(name==='smyl_mark_appointment_no_charge'){db.smyl_appointment_no_charge.push({tenant_id:T,appointment_id:args.p_appointment_id,reason:args.p_reason,decided_at:new Date().toISOString()});return {data:null,error:null};}if(name==='smyl_reopen_appointment_charge'){db.smyl_appointment_no_charge=db.smyl_appointment_no_charge.filter(n=>n.appointment_id!==args.p_appointment_id);return {data:null,error:null};}if(name==='smyl_post_charge'){const row={id:args.p_id,tenant_id:T,patient_id:args.p_patient_id,appointment_id:args.p_appointment_id,status:'open',total_amount:args.p_unit_price,concept:args.p_concept,created_at:new Date().toISOString()};db.smyl_finance_charges.push(row);return {data:[row],error:null};}return {data:name in rpcData?rpcData[name]:[],error:null};},
      functions:{invoke:async(name)=>{window.__calls.push(['fn',name]);return {data:{},error:null};}},
      storage:{from:()=>({createSignedUrl:async()=>({data:null,error:null}),getPublicUrl:()=>({data:{publicUrl:''}}),list:async()=>({data:[],error:null}),upload:async()=>({data:{},error:null})})},
      channel:()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe(){}};return c;},
      removeChannel(){},
    };
  }
  window.supabase={createClient:client};
})();
