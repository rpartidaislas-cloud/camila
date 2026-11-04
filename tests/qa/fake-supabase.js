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
  window.__calls=[];
  function chain(table){
    const q={table,filters:[],single:false};
    const api=new Proxy(function(){},{
      get(_,prop){
        if(prop==='then'){return (res,rej)=>{
          let rows=(db[table]||[]).slice();
          q.filters.forEach(f=>{rows=rows.filter(r=>r[f[0]]===f[1]);});
          let out={data:q.single?(rows[0]||null):rows,error:null,count:rows.length};
          window.__calls.push(['from',table]);
          return Promise.resolve(out).then(res,rej);
        };}
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
      rpc:async(name,args)=>{window.__calls.push(['rpc',name]);return {data:name in rpcData?rpcData[name]:[],error:null};},
      functions:{invoke:async(name)=>{window.__calls.push(['fn',name]);return {data:{},error:null};}},
      storage:{from:()=>({createSignedUrl:async()=>({data:null,error:null}),getPublicUrl:()=>({data:{publicUrl:''}}),list:async()=>({data:[],error:null}),upload:async()=>({data:{},error:null})})},
      channel:()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe(){}};return c;},
      removeChannel(){},
    };
  }
  window.supabase={createClient:client};
})();
