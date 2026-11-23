// Humo de navegador de la Ficha del paciente: encabezado sin contacto repetido, barra con solo Agendar cita y Nueva evolución,
// «Contexto del paciente» en el Resumen (saldo, próxima cita, última visita y recorrido de citas) y «Agregar» en Datos del paciente.
// Usa tests/qa/fake-supabase-agenda.js con un doble de consultas más completo.
//   NODE_PATH=$(npm root -g) node tests/qa/ficha-contexto-smoke.cjs      (requiere Playwright y Chromium)
// Sale con código 1 si algo falla. Con SMYL_SHOTS=/carpeta toma capturas.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/app.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

const CHAIN = `function chain(table){
    const q={table,filters:[],single:false,op:'select',payload:null,cols:''};
    const api=new Proxy(function(){},{
      get(_,prop){
        if(prop==='then'){return (res,rej)=>{
          db[table]=db[table]||[];
          const match=r=>q.filters.every(f=>f[2]==='in'?f[1].includes(r[f[0]]):r[f[0]]===f[1]);
          let out;
          if(q.op==='insert'){const arr=[].concat(q.payload).map(r=>Object.assign({id:'n'+Math.random().toString(36).slice(2,8)},r));db[table].push(...arr);window.__calls.push(['insert',table,q.payload]);out={data:q.single?arr[0]:arr,error:null};}
          else if(q.op==='upsert'){const keys=String(q.conflict||'id').split(',');const arr=[].concat(q.payload);arr.forEach(r=>{const hit=db[table].find(x=>keys.every(k=>x[k]===r[k]));if(hit)Object.assign(hit,r);else db[table].push(Object.assign({id:'n'+Math.random().toString(36).slice(2,8)},r));});window.__calls.push(['upsert',table,q.payload]);out={data:arr,error:null};}
          else if(q.op==='update'){const hit=db[table].filter(match);hit.forEach(r=>Object.assign(r,q.payload));window.__calls.push(['update',table,q.payload]);out={data:q.single?(hit[0]||null):hit,error:null};}
          else if(q.op==='delete'){const keep=[],gone=[];db[table].forEach(r=>(match(r)?gone:keep).push(r));db[table]=keep;window.__calls.push(['delete',table]);out={data:gone,error:null};}
          else{const rows=db[table].filter(match);out={data:q.single?(rows[0]||null):rows,error:null,count:rows.length};window.__calls.push(['from',table]);
            if(window.__noPhone&&table==='smyl_professionals'&&/phone/.test(q.cols))out={data:null,error:{message:'column smyl_professionals.phone does not exist',code:'42703'}};
            if(window.__failTables&&window.__failTables[table])out={data:null,error:window.__failTables[table]};
            if(table==='smyl_schedule_rules'&&window.__noRules)out={data:null,error:{message:'relation does not exist',code:'42P01'}};}
          return Promise.resolve(out).then(res,rej);
        };}
        if(prop==='in'){return (c,v)=>{q.filters.push([c,v,'in']);return api;};}
        if(prop==='eq'){return (c,v)=>{q.filters.push([c,v]);return api;};}
        if(prop==='select'){return (c)=>{if(q.op==='select')q.cols=String(c||'');return api;};}
        if(prop==='insert'){return (p)=>{q.op='insert';q.payload=p;return api;};}
        if(prop==='upsert'){return (p,o)=>{q.op='upsert';q.payload=p;q.conflict=o&&o.onConflict;return api;};}
        if(prop==='update'){return (p)=>{q.op='update';q.payload=p;return api;};}
        if(prop==='delete'){return ()=>{q.op='delete';return api;};}
        if(prop==='maybeSingle'||prop==='single'){return ()=>{q.single=true;return api;};}
        return ()=>api;
      }
    });
    return api;
  }
  const rpcData`;

const EXTRA = `
  db.smyl_branches=[{id:'b1',tenant_id:T,name:'Centro',is_default:true,active:true},{id:'b2',tenant_id:T,name:'Lomas Verdes',is_default:false,active:true}];
  db.smyl_professionals=[{id:'pr1',tenant_id:T,display_name:'Dra. Ana Torres',specialty:'General',color_token:'teal',active:true}];
  db.smyl_appointments.find(a=>a.id==='a6').branch_id='b2';
  db.camila_usuarios=[{id:T,tenant_id:T,rol:'dueño',nombre:'Dd',email:'dd@clinica.mx',activo:true,created_at:now},{id:'u3',tenant_id:T,rol:'staff',nombre:'Recepción',email:'r@clinica.mx',activo:true,created_at:now}];
  db.smyl_roles=[{id:'r-rec',tenant_id:T,code:'recepcion',name:'Recepción',active:true}];
  db.smyl_role_permissions=[{tenant_id:T,role_id:'r-rec',permission_key:'clinical.read'}];
  db.smyl_member_roles=[{tenant_id:T,user_id:'u3',role_id:'r-rec'}];
  window.__rpcs={smyl_patient_timeline:()=>Promise.resolve({data:[],error:null})};
  `;

function fakeSource(who) {
  let src = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8');
  src = src.replace(/function chain\(table\)\{[\s\S]*?\n  \}\n  const rpcData/, CHAIN);
  src = src.replace('window.__db=db;', EXTRA + 'window.__db=db;');
  src = src.replace('rpc:async(name,args)=>{', 'rpc:async(name,args)=>{if(window.__rpcs&&window.__rpcs[name])return window.__rpcs[name](args);');
  if (who === 'lectura') src = src.replace("const user={id:T,email:'dd@clinica.mx',user_metadata:{},is_anonymous:false};", "const user={id:'u3',email:'r@clinica.mx',user_metadata:{},is_anonymous:false};");
  if (!src.includes('window.__rpcs[name]')) throw new Error('No se pudo ampliar el doble de Supabase.');
  return src;
}

const P2 = 'p2000000-0000-4000-8000-000000000002', P3 = 'p3000000-0000-4000-8000-000000000003';
async function open(browser, who, size, patient) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: size || { width: 1500, height: 950 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
  const source = fakeSource(who);
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source });
    return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.evaluate(id => verPaciente(id), patient); await page.waitForTimeout(3500);
  return { ctx, page, errs };
}
const ctxCards = page => page.$$eval('.p360-context-card', cards => cards.map(c => ({ kind: c.dataset.context, text: c.innerText.replace(/\s+/g, ' ').trim(), button: (c.querySelector('button') || {}).textContent || '' })));

server.listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch(); let fails = 0;
  const check = (cond, msg) => { if (!cond) { console.log('FALLA · ' + msg); fails++; } };

  // ── Paciente con cita próxima, visita terminada e inasistencia (dueño) ──
  {
    const { ctx, page, errs } = await open(b, 'dueno', null, P3);
    const head = await page.evaluate(() => ({
      contacto: !!document.querySelector('.p360-contact-line'), textoContacto: /Agregar teléfono o correo/.test(document.querySelector('.p360-root').innerText),
      banderas: !!document.querySelector('[data-p360-flags]'), datos: !!document.querySelector('[data-p360-open-datos]'),
      barra: Array.from(document.querySelectorAll('.pro-patient-workbar button')).map(x => x.textContent)
    }));
    console.log('1) encabezado y barra:', JSON.stringify(head));
    check(!head.contacto && !head.textoContacto, 'el encabezado no debe repetir el contacto ni ofrecer «Agregar teléfono o correo»');
    check(head.banderas && head.datos, 'el encabezado conserva las banderas y «Datos del paciente»');
    check(JSON.stringify(head.barra) === JSON.stringify(['Agendar cita', 'Nueva evolución']), 'la barra solo debe tener Agendar cita y Nueva evolución: ' + JSON.stringify(head.barra));

    const cards = await ctxCards(page);
    console.log('2) contexto:', JSON.stringify(cards));
    check(cards.length === 3 && cards.map(c => c.kind).join() === 'balance,next,last', 'debe haber tres tarjetas: saldo, próxima cita y última visita');
    const next = cards.find(c => c.kind === 'next'), last = cards.find(c => c.kind === 'last'), bal = cards.find(c => c.kind === 'balance');
    check(next && /Confirmada/.test(next.text) && /Limpieza dental/.test(next.text) && /Dra\. Ana Torres/.test(next.text) && /Lomas Verdes/.test(next.text), 'la próxima cita debe mostrar estado, servicio, profesional y sede: ' + (next && next.text));
    check(last && /1 visita terminada/.test(last.text) && /1 inasistencia/.test(last.text), 'la última visita debe contar visitas e inasistencias: ' + (last && last.text));
    check(bal && !/Consultando/.test(bal.text) && /Sin cargos|Al corriente|por cobrar|a favor/.test(bal.text), 'el saldo debe cargar: ' + (bal && bal.text));

    const visitas = await page.evaluate(() => Array.from(document.querySelectorAll('.p360-visits-card')).map(c => ({ titulo: c.querySelector('h3').innerText.replace(/\s+/g, ' '), filas: Array.from(c.querySelectorAll('li')).map(li => li.innerText.replace(/\s+/g, ' ')) })));
    console.log('3) citas y visitas:', JSON.stringify(visitas));
    check(visitas.length === 2 && /Próximas 1/.test(visitas[0].titulo) && visitas[0].filas.length === 1, 'Próximas debe tener 1 cita');
    check(/Anteriores 2/.test(visitas[1].titulo) && visitas[1].filas.some(f => /No vino/.test(f)) && visitas[1].filas.some(f => /Terminada/.test(f)), 'Anteriores debe incluir la terminada y la inasistencia');

    // Agendar desde la tarjeta cuando no hay próxima: se prueba más abajo con otro paciente. Aquí: Datos del paciente ofrece «Agregar».
    await page.click('[data-p360-open-datos]'); await page.waitForTimeout(600);
    const agregar = await page.$$eval('.p360-datos-list .p360-inline-link', xs => xs.map(x => x.textContent));
    console.log('4) Datos del paciente, «Agregar»:', JSON.stringify(agregar));
    check(agregar.length === 2, 'sin teléfono ni correo, Datos del paciente debe ofrecer «Agregar» en ambas filas');
    await page.click('.p360-datos-list .p360-inline-link'); await page.waitForTimeout(300);
    const edicion = await page.evaluate(() => ({ titulo: (document.getElementById('modal-pac-title') || {}).textContent, abierto: !!document.querySelector('#modal-paciente.open, #modal-paciente.activo, #modal-paciente.show, #modal-paciente[open]') }));
    check(edicion.titulo === 'Editar paciente', '«Agregar» debe abrir el formulario «Editar paciente»: ' + JSON.stringify(edicion));
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs));
    if (process.env.SMYL_SHOTS) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(process.env.SMYL_SHOTS, 'ficha-resumen-escritorio.png'), fullPage: true }); }
    await ctx.close();
  }

  // ── Paciente sin cita próxima ──
  {
    const { ctx, page, errs } = await open(b, 'dueno', null, P2);
    const cards = await ctxCards(page);
    const next = cards.find(c => c.kind === 'next');
    console.log('5) sin cita próxima:', JSON.stringify(next));
    check(next && /Sin cita próxima/.test(next.text) && next.button === 'Agendar cita', 'sin cita próxima debe ofrecer «Agendar cita»');
    const tel = await page.evaluate(async () => { document.querySelector('[data-p360-open-datos]').click(); await new Promise(r => setTimeout(r, 500)); return Array.from(document.querySelectorAll('.p360-datos-list .p360-inline-link')).length; });
    check(tel === 1, 'con teléfono y sin correo debe ofrecer «Agregar» solo en el correo: ' + tel);
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs));
    await ctx.close();
  }

  // ── Quien no ve Cobros no ve el saldo ──
  {
    const { ctx, page, errs } = await open(b, 'lectura', null, P3);
    const cards = await ctxCards(page);
    console.log('6) sin permiso de Cobros:', cards.map(c => c.kind).join());
    check(cards.map(c => c.kind).join() === 'next,last', 'sin finance.read no debe haber tarjeta de saldo');
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs));
    await ctx.close();
  }

  // ── Celular ──
  {
    const { ctx, page, errs } = await open(b, 'dueno', { width: 390, height: 844 }, P3);
    const m = await page.evaluate(() => ({ sinScroll: document.documentElement.scrollWidth <= window.innerWidth + 1, tarjetas: document.querySelectorAll('.p360-context-card').length }));
    console.log('7) celular:', JSON.stringify(m));
    check(m.sinScroll, 'no debe haber desplazamiento horizontal en el celular');
    check(m.tarjetas === 3, 'las tres tarjetas deben verse en el celular');
    if (process.env.SMYL_SHOTS) await page.screenshot({ path: path.join(process.env.SMYL_SHOTS, 'ficha-resumen-celular.png'), fullPage: true });
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs));
    await ctx.close();
  }

  await b.close(); server.close(); console.log(fails ? `\n${fails} falla(s)` : '\nTodo bien'); process.exit(fails ? 1 : 0);
});
