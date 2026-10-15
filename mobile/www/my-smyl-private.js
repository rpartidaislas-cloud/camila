/* No SDK, anonymous account, persistent storage, signed image URL or analytics.
 * Access fragment is removed before network IO; credentials only live in RAM.
 */
(function(){'use strict';
 const endpoint='https://rpxshsiwoxdbuevjjpfw.supabase.co/functions/v1/my-smyl-access';
 const match=/^#access=([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(location.hash);history.replaceState(null,'',location.pathname);
 let access=match?{id:match[1],token:match[2]}:null,session='',renderer=null,urls=[],expiry=null,watch=null,sequence=0,abort=new AbortController();
 const host=document.getElementById('portal-root'),n=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
 const hex=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
 async function call(action,payload={}){if(!access)throw Error('Access expired');const response=await fetch(endpoint,{method:'POST',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({...access,session,action,payload}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25000)])});
  if(!response.ok){const error=Error('Unavailable');error.status=response.status;throw error;}return action==='image'?response.blob():response.json();}
 function clear(){++sequence;abort.abort();abort=new AbortController();renderer?.destroy();renderer=null;urls.forEach(URL.revokeObjectURL);urls=[];clearTimeout(expiry);clearInterval(watch);session='';}
 function gate(message='Introduce el código de seis dígitos que te dio tu clínica.'){clear();host.replaceChildren();const box=n('section','ms-locked portal-gate');box.append(n('div','ms-brand','mySmyl'),n('h1','','Tu propuesta, en privado.'),n('p','',access?message:'Abre el enlace completo que te entregó tu clínica. Si ya venció, solicita uno nuevo.'));host.append(box);
  if(!access)return;const form=n('form'),label=n('label','','Código de acceso'),code=n('input');code.id='portal-code';label.htmlFor=code.id;code.inputMode='numeric';code.autocomplete='one-time-code';code.pattern='[0-9]{6}';code.maxLength=6;code.minLength=6;code.required=true;code.type='password';const submit=n('button','ms-primary','Ver mi propuesta');submit.type='submit';const status=n('p');status.setAttribute('role','status');form.append(label,code,submit,status);box.append(form,n('p','mp-fine','No compartas tu enlace ni tu código. Quien tenga ambos podrá consultar esta propuesta. Las imágenes abiertas podrían guardarse en el dispositivo.'));
  form.onsubmit=async e=>{e.preventDefault();if(submit.disabled)return;submit.disabled=true;status.textContent='Verificando acceso…';session=session||hex();const token=sequence;
   try{const result=await call('unlock',{code:code.value});code.value='';if(token!==sequence)return;if(result.unlocked!==true)throw Error('Not unlocked');await open(result.expires_at,token);}
   catch{if(token===sequence){code.value='';status.textContent='No pudimos abrir la propuesta. Revisa el código y la vigencia con tu clínica. Tras varios intentos, espera 15 minutos.';submit.disabled=false;}}
  };
 }
 async function open(until,token){const result=await call('read');if(token!==sequence)return;const doc=MySmylDocument.project(result.document),known=new Set(['frontal','left','right','tresCuartos','extraoral','intraoral','intraoralLeft','intraoralRight']);
  if(!Array.isArray(result.views)||!result.views.length||result.views.length>8||new Set(result.views).size!==result.views.length||result.views.some(v=>!known.has(v))||!Number.isInteger(result.version)||!Number.isFinite(Date.parse(result.approved_at)))throw Error('Invalid proposal');
  const delay=Date.parse(until)-Date.now();if(!Number.isFinite(delay)||delay<=0||delay>16*60000)throw Error('Expired');
  const views=[];try{for(const view of result.views){const pair={view};for(const role of ['original','result']){const blob=await call('image',{view,role});if(token!==sequence)return;if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||blob.size>10485760)throw Error('Invalid image');const url=URL.createObjectURL(blob);urls.push(url);pair[role]=url;}views.push(pair);}
   if(token!==sequence)return;renderer=MySmylDocument.mount(host,{document:doc,views,patient:true,meta:result,onRequest:async payload=>{try{return await call('request',payload);}catch(error){if(error.status===403)gate('Tu acceso terminó. Introduce nuevamente el código o consulta con tu clínica.');throw error;}}});
   const close=n('button','mp-secondary portal-exit','Cerrar mi propuesta');close.onclick=()=>gate();host.prepend(close);
   expiry=setTimeout(()=>gate('Tu sesión terminó. Introduce nuevamente el código.'),Math.max(0,Date.parse(until)-Date.now()));
   watch=setInterval(async()=>{try{await call('read');}catch{if(token===sequence)gate('No pudimos verificar que tu acceso siga vigente. Vuelve a abrirlo con tu código.');}},60000);
  }catch(error){urls.forEach(URL.revokeObjectURL);urls=[];throw error;}
 }
 addEventListener('pagehide',()=>{clear();access=null;host.replaceChildren(n('p','ms-locked','Abre nuevamente el enlace de tu clínica.'));});
 gate();
})();
