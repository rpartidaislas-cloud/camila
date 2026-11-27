// Humo de navegador de «Equipo»: lista única con búsqueda y filtros, ficha de cada persona, asignación a sedes,
// teléfono interno, margen de traslado, solo consulta para quien no administra y errores de red legibles.
// Usa tests/qa/fake-supabase-agenda.js ampliado aquí con tablas de la clínica.
//   NODE_PATH=$(npm root -g) node tests/qa/equipo-ficha-smoke.cjs      (requiere Playwright y Chromium)
// Sale con código 1 si algo falla.
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
  const iso2=(d)=>new Date(Date.now()+d*864e5).toISOString();
  db.smyl_branches=[{id:'b1',tenant_id:T,name:'Centro',is_default:true,active:true},{id:'b2',tenant_id:T,name:'Lomas Verdes',is_default:false,active:true},{id:'b3',tenant_id:T,name:'Plaza Sol',is_default:false,active:true}];
  db.smyl_clinic_hours=[1,2,3,4,5].flatMap(d=>['b1','b2','b3'].map(b=>({id:'ch'+d+b,tenant_id:T,branch_id:b,weekday:d,starts_at:'08:00:00',ends_at:'20:00:00',active:true})));
  db.camila_usuarios=[{id:T,tenant_id:T,rol:'dueño',nombre:'Dd',email:'dd@clinica.mx',activo:true,created_at:now},
    {id:'u2',tenant_id:T,rol:'staff',nombre:'Dr. Hernan Partida',email:'circulo@clinica.mx',activo:true,created_at:now},
    {id:'u3',tenant_id:T,rol:'staff',nombre:'Recepción Ana',email:'recepcion@clinica.mx',activo:true,created_at:now}];
  db.smyl_roles=[{id:'r-prop',tenant_id:T,code:'propietario',name:'Propietario',description:'',system_role:true,active:true},{id:'r-odo',tenant_id:T,code:'odontologo',name:'Odontólogo',description:'',system_role:true,active:true},{id:'r-rec',tenant_id:T,code:'recepcion',name:'Recepción',description:'',system_role:true,active:true}];
  db.smyl_role_permissions=[{tenant_id:T,role_id:'r-rec',permission_key:'schedule.read'},{tenant_id:T,role_id:'r-odo',permission_key:'schedule.read'}];
  db.smyl_role_scopes=[];
  db.smyl_member_roles=[{tenant_id:T,user_id:T,role_id:'r-prop'},{tenant_id:T,user_id:'u2',role_id:'r-odo'},{tenant_id:T,user_id:'u3',role_id:'r-rec'}];
  db.smyl_member_branches=[{tenant_id:T,user_id:'u2',branch_id:'b1',is_primary:true},{tenant_id:T,user_id:'u3',branch_id:'b1',is_primary:true}];
  db.smyl_professionals=[
    {id:'pr1',tenant_id:T,user_id:'u2',display_name:'Dr. Hernan Partida',specialty:'Odontología general',license_number:'1234567',phone:'',color_token:'teal',active:true},
    {id:'pr2',tenant_id:T,user_id:null,display_name:'Dr. Andrés Salinas Ibarra',specialty:'Endodoncia',license_number:'PRUEBA-002',phone:'',color_token:'blue',active:true},
    {id:'pr3',tenant_id:T,user_id:null,display_name:'Dr. Iván Carrasco Mejía',specialty:'Cirugía oral e implantes',license_number:'PRUEBA-006',phone:'',color_token:'violet',active:true}];
  db.smyl_professional_branches=[{tenant_id:T,professional_id:'pr1',branch_id:'b1'},{tenant_id:T,professional_id:'pr2',branch_id:'b1'},{tenant_id:T,professional_id:'pr3',branch_id:'b1'},{tenant_id:T,professional_id:'pr3',branch_id:'b2'}];
  db.smyl_professional_hours=[
    {tenant_id:T,professional_id:'pr1',branch_id:'b1',weekday:2,starts_at:'09:00:00',ends_at:'14:00:00',active:true},
    {id:'h-pr3-b1-1',tenant_id:T,professional_id:'pr3',branch_id:'b1',weekday:1,starts_at:'09:00:00',ends_at:'13:00:00',active:true},
    {id:'h-pr3-b2-1',tenant_id:T,professional_id:'pr3',branch_id:'b2',weekday:1,starts_at:'13:30:00',ends_at:'17:00:00',active:true}];
  db.smyl_professional_profiles=[{tenant_id:T,professional_id:'pr1',status:'published'}];
  db.smyl_staff_invitations=[{id:'inv1',tenant_id:T,email:'nueva@clinica.mx',display_name:'Dra. Nueva',member_kind:'professional',specialty:'Ortodoncia',license_number:'',branch_id:'b2',status:'pending',expires_at:iso2(6),invited_at:now}];
  db.smyl_schedule_rules=[];
  const chatMembers=db.camila_usuarios.map(u=>({user_id:u.id,name:u.nombre,active:u.activo,chat_mode:u.id===T?'coordinator':u.id==='u3'?'agent':'none',assigned_count:u.id==='u3'?2:0}));
  window.__rpcs={
    smyl_chat_team_settings:()=>{window.__calls.push(['rpc','smyl_chat_team_settings']);return {data:chatMembers.map(m=>({...m})),error:null};},
    smyl_set_chat_access:(a)=>{
      window.__calls.push(['rpc','smyl_set_chat_access',a]);
      const m=chatMembers.find(x=>x.user_id===a.p_user_id);
      if(window.__chatConflict){window.__chatConflict=false;m.chat_mode='coordinator';return {error:{code:'40001',message:'changed'}};}
      if(!m||m.chat_mode!==a.p_expected_mode)return {error:{code:'40001',message:'changed'}};
      const moved=a.p_mode==='none'?m.assigned_count:0;
      if(moved&&a.p_disposition==='transfer')chatMembers.find(x=>x.user_id===a.p_replacement_id).assigned_count+=moved;
      m.chat_mode=a.p_mode;m.assigned_count-=moved;
      return {data:{user_id:m.user_id,chat_mode:m.chat_mode,moved},error:null};
    },
    smyl_professional_travel_conflicts:()=>Promise.resolve({data:[{professional_id:'pr3',weekday:1,branch_a:'b1',starts_a:'09:00:00',ends_a:'13:00:00',branch_b:'b2',starts_b:'13:30:00',ends_b:'17:00:00',gap_minutes:30,required_minutes:(db.smyl_schedule_rules[0]||{}).professional_travel_margin_minutes||45}],error:null}),
    smyl_set_professional_travel_margin:(a)=>{db.smyl_schedule_rules=[{tenant_id:T,professional_travel_margin_minutes:a.p_minutes}];window.__calls.push(['rpc','smyl_set_professional_travel_margin',a]);return Promise.resolve({data:a.p_minutes,error:null});},
    smyl_set_member_role:(a)=>{window.__calls.push(['rpc','smyl_set_member_role',a]);return Promise.resolve({data:true,error:null});},
    smyl_set_member_primary_branch:(a)=>{window.__calls.push(['rpc','smyl_set_member_primary_branch',a]);return Promise.resolve({data:true,error:null});}
  };
  `;

function fakeSource(who) {
  let src = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8').replace(/\r\n/g,'\n');
  src = src.replace(/function chain\(table\)\{[\s\S]*?\n  \}\n  const rpcData/, CHAIN);
  src = src.replace('window.__db=db;', EXTRA + 'window.__db=db;');
  src = src.replace('rpc:async(name,args)=>{', 'rpc:async(name,args)=>{if(window.__rpcs&&window.__rpcs[name])return window.__rpcs[name](args);');
  if (who === 'consulta') src = src.replace("const user={id:T,email:'dd@clinica.mx',user_metadata:{},is_anonymous:false};", "const user={id:'u3',email:'recepcion@clinica.mx',user_metadata:{},is_anonymous:false};");
  if (!src.includes('window.__rpcs[name]')) throw new Error('No se pudo ampliar el doble de Supabase.');
  return src;
}

async function open(browser, who, size, init) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: size || (process.env.VIEW ? { width: +process.env.VIEW.split('x')[0], height: +process.env.VIEW.split('x')[1] } : { width: 1500, height: 950 }) }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.accept());
  const source = fakeSource(who);
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source });
    return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort();
  });
  if (init) await page.addInitScript(init);
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  return { ctx, page, errs };
}

async function team(page) {
  await page.evaluate(() => ir('clinica')); await page.waitForTimeout(1500);
  await page.click('.clinic-admin-tab[data-ca-tab="equipo"]'); await page.waitForTimeout(500);
}
const rows = page => page.$$eval('[data-ca-team-panel="people"] .clinic-admin-person-row', e => e.map(r => ({ name: r.querySelector('strong').textContent, status: r.dataset.status, text: r.innerText })));

server.listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({executablePath:process.env.SMYL_CHROMIUM}); let fails = 0;
  const check = (cond, msg) => { if (!cond) { console.log('FALLA · ' + msg); fails++; } };

  // ── Administrador ──
  {
    const { ctx, page, errs } = await open(b, 'admin');
    await page.evaluate(() => ir('clinica')); await page.waitForTimeout(1500);
    const sedes = await page.evaluate(() => ({
      filtros: Array.from(document.querySelectorAll('[data-ca-branch-filter]')).map(x => x.innerText.replace(/\s+/g, ' ').trim()),
      sucursales: Array.from(document.querySelectorAll('.clinic-admin-branch')).map(x => x.innerText.replace(/\s+/g, ' ').trim()),
      buscador: !!document.getElementById('clinic-admin-branch-search'),
      nueva: document.getElementById('clinic-admin-add-branch')?.innerText,
      equipo: !!document.querySelector('[data-ca-manage-team]'),
      etapas: document.querySelectorAll('.clinic-admin-steps li').length,
      menuPrincipal: !!document.querySelector('.clinic-admin-branch-head [data-ca-archive-blocked]'),
      menuOtraSede: !!document.querySelector('.clinic-admin-branch-row:has([data-branch-id="b2"]) [data-ca-deactivate-branch]')
    }));
    console.log('0) sucursales:', JSON.stringify(sedes));
    check(sedes.buscador && /Nueva/.test(sedes.nueva || ''), 'Sucursales debe ofrecer búsqueda y alta clara');
    check(sedes.filtros.length === 2 && /Activas 3/.test(sedes.filtros[0]) && /Archivadas 0/.test(sedes.filtros[1]), 'debe separar sucursales activas y archivadas');
    check(sedes.sucursales.length === 3 && sedes.equipo, 'debe listar las sedes y permitir administrar su equipo');
    check(sedes.etapas === 4, 'el proceso debe quedar en cuatro etapas claras');
    check(sedes.menuPrincipal && sedes.menuOtraSede, 'Archivar debe permanecer visible y explicar por qué la principal está protegida');
    await page.click('.clinic-admin-branch-row:has([data-branch-id="b3"]) .clinic-admin-branch-menu summary');
    await page.click('.clinic-admin-branch-row:has([data-branch-id="b3"]) [data-ca-deactivate-branch]');
    await page.waitForTimeout(1100);
    const archivada = await page.evaluate(() => ({ activa: window.__db.smyl_branches.find(b => b.id === 'b3').active, filtro: document.querySelector('[data-ca-branch-filter="archived"]').innerText.replace(/\s+/g, ' ').trim() }));
    check(archivada.activa === false && /Archivadas 1/.test(archivada.filtro), 'archivar debe retirar la sede de operación sin borrarla');
    await page.click('[data-ca-branch-filter="archived"]'); await page.waitForTimeout(250);
    await page.click('.clinic-admin-archived [data-ca-restore-branch]'); await page.waitForTimeout(1100);
    check(await page.evaluate(() => window.__db.smyl_branches.find(b => b.id === 'b3').active === true), 'la sucursal archivada debe poder reactivarse');
    await page.click('.clinic-admin-branch[data-branch-id="b1"]'); await page.waitForTimeout(200);
    await page.click('[data-ca-manage-team]'); await page.waitForTimeout(250);
    const asignacion = await page.evaluate(() => ({
      abierta: document.getElementById('clinic-admin-dialog').open,
      titulo: document.querySelector('#clinic-admin-branch-team-form h2')?.innerText,
      profesionales: document.querySelectorAll('.clinic-admin-assignment').length,
      buscador: !!document.querySelector('[data-ca-team-search]')
    }));
    console.log('0b) equipo por sucursal:', JSON.stringify(asignacion));
    check(asignacion.abierta && /Centro/.test(asignacion.titulo || '') && asignacion.profesionales === 3 && asignacion.buscador, 'la sede debe administrar y buscar profesionales sin salir del módulo');
    await page.click('#clinic-admin-dialog [data-ca-close]');
    await team(page);
    let r = await rows(page);
    console.log('1) lista:', r.map(x => `${x.name} [${x.status}]`).join(' | '));
    check(r.length === 6, 'debe listar 6 personas (3 con acceso, 2 perfiles sin acceso, 1 invitación): ' + r.length);
    const ui = await page.evaluate(() => ({
      volver: !!Array.from(document.querySelectorAll('.clinic-admin-team-panel button')).find(x => /← Sucursales/.test(x.textContent)),
      preparacion: document.getElementById('clinic-admin-readiness').hidden, cifras: document.getElementById('clinic-admin-metrics').hidden,
      filtros: Array.from(document.querySelectorAll('.clinic-admin-filter')).map(x => x.textContent)
    }));
    console.log('2) interfaz:', JSON.stringify(ui));
    check(!ui.volver, 'ya no debe existir «← Sucursales» en Equipo');
    check(ui.preparacion && ui.cifras, 'el resumen de preparación no debe verse en Equipo');
    check(ui.filtros.length === 4, 'deben ser 4 filtros simples');

    await page.fill('#clinic-admin-people-search', 'ivan'); await page.waitForTimeout(200);
    r = await rows(page); check(r.length === 1 && /Iván/.test(r[0].name), 'la búsqueda sin acentos debe encontrar a Iván: ' + JSON.stringify(r.map(x => x.name)));
    await page.fill('#clinic-admin-people-search', 'zzz'); await page.waitForTimeout(200);
    check(await page.$('.clinic-admin-empty') !== null, 'sin resultados debe decirlo');
    await page.fill('#clinic-admin-people-search', ''); await page.waitForTimeout(200);
    await page.click('.clinic-admin-filter[data-filter="pending"]'); await page.waitForTimeout(200);
    r = await rows(page); check(r.length === 3, 'Pendientes debe mostrar 3 (2 sin acceso + 1 invitación): ' + r.length);
    await page.click('.clinic-admin-filter[data-filter="all"]'); await page.waitForTimeout(200);
    const faltas = await page.evaluate(() => [...document.querySelectorAll('[data-ca-team-panel="people"] .clinic-admin-person-row')].map(r => r.innerText.replace(/\s+/g, ' ')).filter(t => /Falta /.test(t)).map(t => t.slice(0, 40)));
    console.log('2b) doctores a los que les falta algo:', JSON.stringify(faltas));
    check(faltas.length === 1 && /Salinas/.test(faltas[0]), 'a quien no tiene horario se le avisa en la lista: ' + JSON.stringify(faltas));

    // Ficha de Iván (dos sedes con choque)
    await page.fill('#clinic-admin-people-search', 'Iván'); await page.waitForTimeout(200);
    await page.click('.clinic-admin-person-row'); await page.waitForTimeout(400);
    let ficha = await page.evaluate(() => { const d = document.getElementById('clinic-admin-person'); return { abierta: d.open, texto: d.innerText }; });
    console.log('3) ficha de Iván abierta:', ficha.abierta); if (!/Lun 09:00–13:00/.test(ficha.texto)) console.log(JSON.stringify(ficha.texto));
    check(ficha.abierta, 'la ficha debe abrir al tocar a la persona');
    check(/Centro/.test(ficha.texto) && /Lomas Verdes/.test(ficha.texto), 'la ficha debe mostrar sus dos sedes');
    check(/Lun 09:00–13:00/.test(ficha.texto) && /Lun 13:30–17:00/.test(ficha.texto), 'la ficha debe mostrar el horario por sede');
    check(/solo hay 30 min/.test(ficha.texto) && /Se necesitan 45 min/.test(ficha.texto), 'debe avisar del choque entre sedes');
    check(/Teléfono interno/.test(ficha.texto) && /Sin registrar/.test(ficha.texto), 'debe mostrar el teléfono interno vacío');
    check(/Zona delicada/.test(ficha.texto) && /Desactivar como profesional/.test(ficha.texto), 'el administrador ve la zona delicada y distingue la disponibilidad profesional');
    check(/Listo para recibir citas/.test(ficha.texto) && /Sede asignada/.test(ficha.texto), 'Iván tiene sede y horario: debe verse como listo');

    // Editar datos y teléfono
    await page.click('.clinic-admin-sheet-edit'); await page.waitForTimeout(200);
    await page.fill('.clinic-admin-sheet-form input[name="phone"]', '33 1234 5678'); await page.fill('.clinic-admin-sheet-form input[name="specialty"]', 'Cirugía oral');
    await page.click('.clinic-admin-sheet-form button[type="submit"]'); await page.waitForTimeout(1200);
    const guardado = await page.evaluate(() => ({ db: window.__db.smyl_professionals.find(p => p.id === 'pr3'), tel: (document.querySelector('#clinic-admin-person a[href^="tel:"]') || {}).getAttribute && document.querySelector('#clinic-admin-person a[href^="tel:"]').getAttribute('href'), abierta: document.getElementById('clinic-admin-person').open }));
    console.log('4) tras guardar:', JSON.stringify({ phone: guardado.db.phone, specialty: guardado.db.specialty, tel: guardado.tel, abierta: guardado.abierta }));
    check(guardado.db.phone === '33 1234 5678' && guardado.db.specialty === 'Cirugía oral', 'debe guardar teléfono y especialidad');
    check(guardado.tel === 'tel:3312345678', 'el teléfono debe ser un enlace para llamar');
    check(guardado.abierta, 'la ficha debe seguir abierta con los datos nuevos');

    // WhatsApp del profesional y horario semanal desde la ficha
    check(/WhatsApp \(avisos de citas\)/.test(ficha.texto), 'la ficha debe mostrar el WhatsApp para avisos');
    await page.click('.clinic-admin-sheet-edit'); await page.waitForTimeout(200);
    await page.fill('.clinic-admin-sheet-form input[name="contact_phone"]', '33 9876 5432'); await page.check('.clinic-admin-sheet-form input[name="contact_phone_public"]');
    await page.click('.clinic-admin-sheet-form button[type="submit"]'); await page.waitForTimeout(900);
    const wa = await page.evaluate(() => { const r = window.__db.smyl_professionals.find(p => p.id === 'pr3'); return { n: r.contact_phone, p: r.contact_phone_public, t: document.getElementById('clinic-admin-person').innerText }; });
    console.log('4b) WhatsApp:', JSON.stringify({ n: wa.n, p: wa.p }));
    check(wa.n === '33 9876 5432' && wa.p === true, 'debe guardar el WhatsApp y que sea visible para pacientes');
    check(/visible para pacientes/.test(wa.t), 'la ficha debe decir que es visible para pacientes');
    const editBtns = await page.$$('.clinic-admin-sheet-branch .clinic-admin-link'); check(editBtns.length === 2, 'cada sede asignada debe ofrecer «Editar horario»: ' + editBtns.length);
    await editBtns[0].click(); await page.waitForTimeout(250);
    // Modo simple: días en un toque + un solo horario. Quien tiene un solo bloque por día lo abre así.
    const ed = await page.evaluate(() => ({ simple: !!document.querySelector('.clinic-admin-hours-simple'), chips: document.querySelectorAll('.clinic-admin-day-chip').length, on: [...document.querySelectorAll('.clinic-admin-day-chip.is-on')].map(c => c.getAttribute('aria-label')), de: document.querySelectorAll('.clinic-admin-hours-simple input[type=time]')[0].value, a: document.querySelectorAll('.clinic-admin-hours-simple input[type=time]')[1].value, atajos: [...document.querySelectorAll('.clinic-admin-chip-action')].map(c => c.textContent), hint: document.querySelector('.clinic-admin-hours-editor .clinic-admin-hint').innerText, total: document.querySelector('.clinic-admin-hours-total').innerText }));
    check(ed.simple && ed.chips === 7 && ed.on.join() === 'Lunes' && ed.de === '09:00' && ed.a === '13:00', 'el editor abre en modo simple con 7 días y el horario actual: ' + JSON.stringify(ed));
    check(ed.atajos.join() === 'Igual que la sucursal,Lunes a viernes,Lunes a sábado', 'debe ofrecer tres atajos: ' + ed.atajos);
    check(/Horario de la sucursal: Lun–Vie 08:00–20:00/.test(ed.hint) && /Atiende 1 día · 4 h por semana/.test(ed.total), 'recuerda la sucursal y resume las horas: ' + ed.total);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    if (process.env.SHOT_ONLY) process.exit(0);
    await page.click('.clinic-admin-chip-action:has-text("Lunes a viernes")'); await page.waitForTimeout(250);
    const lv = await page.evaluate(() => ({ on: document.querySelectorAll('.clinic-admin-day-chip.is-on').length, total: document.querySelector('.clinic-admin-hours-total').innerText, warn: !!document.querySelector('.clinic-admin-hours-warn') }));
    check(lv.on === 5 && /Atiende 5 días · 20 h por semana/.test(lv.total) && !lv.warn, '«Lunes a viernes» enciende 5 días sin avisos: ' + JSON.stringify(lv));
    await page.click('.clinic-admin-chip-action:has-text("Lunes a sábado")'); await page.waitForTimeout(250);
    const sab = await page.evaluate(() => ({ warn: (document.querySelector('.clinic-admin-hours-warn') || {}).innerText || '' }));
    check(/Sábado: la sucursal no abre ese día/.test(sab.warn), 'avisa antes de guardar que la sucursal no abre el sábado: ' + sab.warn);
    await page.click('.clinic-admin-day-chip[aria-label="Sábado"]'); await page.waitForTimeout(250);
    await page.fill('.clinic-admin-hours-simple input[type=time] >> nth=0', '07:00'); await page.dispatchEvent('.clinic-admin-hours-simple input[type=time] >> nth=0', 'change'); await page.waitForTimeout(250);
    const early = await page.evaluate(() => ({ warn: (document.querySelector('.clinic-admin-hours-warn') || {}).innerText || '' }));
    check(/la sucursal atiende de 08:00 a 20:00/.test(early.warn), 'avisa si empieza antes de que abra la sucursal: ' + early.warn);
    await page.click('.clinic-admin-hours-editor .btn-primary'); await page.waitForTimeout(300);
    const bad = await page.evaluate(() => ({ msg: (document.getElementById('clinic-admin-feedback') || {}).innerText || '', saved: window.__db.smyl_professional_hours.filter(h => h.professional_id === 'pr3' && h.branch_id === 'b1' && h.active).length }));
    check(/la sucursal atiende de 08:00 a 20:00/.test(bad.msg) && bad.saved === 1, 'un horario fuera de la sucursal no se guarda y se explica: ' + JSON.stringify(bad));
    await page.fill('.clinic-admin-hours-simple input[type=time] >> nth=0', '09:00'); await page.dispatchEvent('.clinic-admin-hours-simple input[type=time] >> nth=0', 'change'); await page.waitForTimeout(250);
    await page.click('.clinic-admin-hours-editor .btn-primary'); await page.waitForTimeout(1000);
    const okh = await page.evaluate(() => ({ dias: window.__db.smyl_professional_hours.filter(h => h.professional_id === 'pr3' && h.branch_id === 'b1' && h.active).map(h => h.weekday).sort().join(), b2: window.__db.smyl_professional_hours.filter(h => h.professional_id === 'pr3' && h.branch_id === 'b2' && h.active).length, texto: document.getElementById('clinic-admin-person').innerText, editor: !!document.querySelector('.clinic-admin-hours-editor') }));
    console.log('4c) horario guardado:', JSON.stringify({ dias: okh.dias, b2: okh.b2, editor: okh.editor }));
    check(okh.dias === '1,2,3,4,5' && okh.b2 === 1 && !okh.editor, 'guarda lunes a viernes en Centro sin tocar la otra sede: ' + okh.dias);
    check(/Lun–Vie 09:00–13:00/.test(okh.texto), 'la ficha resume el horario nuevo en un rango de días: ' + okh.texto.slice(okh.texto.indexOf('Lun')));
    // «Ajustar día por día» sigue disponible para horarios con comida u horas distintas.
    await (await page.$$('.clinic-admin-sheet-branch .clinic-admin-link'))[0].click(); await page.waitForTimeout(250);
    await page.click('.clinic-admin-hours-simple .clinic-admin-link'); await page.waitForTimeout(250);
    const det = await page.evaluate(() => ({ dias: document.querySelectorAll('.clinic-admin-hours-day').length, volver: [...document.querySelectorAll('.clinic-admin-hours-tools .clinic-admin-link')].map(c => c.textContent), total: document.querySelector('.clinic-admin-hours-total').innerText }));
    check(det.dias === 7 && det.volver.includes('Volver a lo simple') && /Total: 20 h por semana/.test(det.total), 'el modo día por día muestra 7 días, vuelve a lo simple y suma las horas: ' + JSON.stringify(det));
    await page.click('.clinic-admin-hours-editor .btn-secondary'); await page.waitForTimeout(250);
    // Desde la Agenda: una fila por profesional y sede con su semana resumida; «Editar horario» abre la misma ficha.
    await page.evaluate(() => { const d = document.getElementById('clinic-admin-person'); if (d && d.open) d.close(); ir('agenda'); });
    await page.waitForTimeout(1800);
    await page.evaluate(() => document.querySelector('[data-schedule-tab="settings"]').click()); await page.waitForTimeout(800);
    const ag = await page.evaluate(() => ({ filas: [...document.querySelectorAll('#schedule-hours-list .schedule-hour')].map(a => a.innerText.replace(/\s+/g, ' ').trim()), botones: document.querySelectorAll('[data-hour-edit]').length, viejo: !!document.getElementById('schedule-add-hours') }));
    console.log('4d) agenda:', JSON.stringify(ag));
    check(!ag.viejo && ag.botones > 0 && ag.filas.some(f => /Lun–Vie 09:00–13:00/.test(f)), 'la Agenda lista el horario por profesional y sede, sin el botón viejo «Agregar»: ' + JSON.stringify(ag.filas.slice(0, 3)));
    await page.evaluate(() => { const rows = [...document.querySelectorAll('#schedule-hours-list .schedule-hour')]; const r = rows.find(a => /Carrasco/.test(a.innerText) && /Centro/.test(a.innerText)); r.querySelector('[data-hour-edit]').click(); });
    await page.waitForTimeout(1500);
    const viaAgenda = await page.evaluate(() => ({ abierta: !!(document.getElementById('clinic-admin-person') || {}).open && document.getElementById('clinic-admin-person').getClientRects().length > 0, simple: !!document.querySelector('#clinic-admin-person .clinic-admin-hours-simple'), nombre: (document.querySelector('#clinic-admin-person h2, #clinic-admin-person [data-person-name]') || {}).innerText || '' }));
    check(viaAgenda.abierta && viaAgenda.simple, '«Editar horario» en la Agenda abre la ficha directo en el editor simple: ' + JSON.stringify(viaAgenda));
    await page.click('#clinic-admin-person .clinic-admin-hours-editor .btn-secondary'); await page.waitForTimeout(250); // sigue abierta la ficha de Iván para las pruebas siguientes

    // Asignar y quitar sede
    await page.selectOption('.clinic-admin-sheet-add select', 'b3'); await page.click('.clinic-admin-sheet-add button'); await page.waitForTimeout(1200);
    let asignada = await page.evaluate(() => window.__db.smyl_professional_branches.filter(x => x.professional_id === 'pr3').map(x => x.branch_id).sort());
    check(JSON.stringify(asignada) === '["b1","b2","b3"]', 'debe asignar Plaza Sol: ' + JSON.stringify(asignada));
    await page.click('.clinic-admin-sheet-branch .clinic-admin-link-danger[aria-label*="Plaza Sol"]'); await page.waitForTimeout(1200);
    asignada = await page.evaluate(() => window.__db.smyl_professional_branches.filter(x => x.professional_id === 'pr3').map(x => x.branch_id).sort());
    check(JSON.stringify(asignada) === '["b1","b2"]', 'debe quitar Plaza Sol: ' + JSON.stringify(asignada));
    await page.click('.clinic-admin-sheet-close'); await page.waitForTimeout(300);
    check(!(await page.evaluate(() => document.getElementById('clinic-admin-person').open)), 'la ficha debe cerrarse');

    // Traslado
    await page.click('[data-ca-team-view="professionals"]'); await page.waitForTimeout(250);
    const viaje = await page.evaluate(() => ({ visible: !document.getElementById('clinic-admin-travel-card').hidden, valor: document.getElementById('clinic-admin-travel-minutes').value, texto: document.getElementById('clinic-admin-travel').innerText }));
    console.log('5) traslado:', JSON.stringify({ visible: viaje.visible, valor: viaje.valor }));
    check(viaje.visible && viaje.valor === '45', 'el margen por omisión debe ser 45');
    check(/horario por corregir/.test(viaje.texto), 'debe avisar de los horarios por corregir');
    await page.fill('#clinic-admin-travel-minutes', '30'); await page.click('#clinic-admin-travel .btn'); await page.waitForTimeout(1200);
    const margen = await page.evaluate(() => window.__db.smyl_schedule_rules[0] && window.__db.smyl_schedule_rules[0].professional_travel_margin_minutes);
    check(margen === 30, 'debe guardar el margen de 30 min: ' + margen);
    await page.fill('#clinic-admin-travel-minutes', '999'); await page.click('#clinic-admin-travel .btn'); await page.waitForTimeout(300);
    check(/entre 0 y 240/.test(await page.evaluate(() => document.getElementById('clinic-admin-feedback').innerText)), 'debe rechazar márgenes fuera de rango');

    // Error de red legible con reintento
    await page.evaluate(() => { window.__failTables = { smyl_branches: { message: 'TypeError: Failed to fetch (rpxshsiwoxdbuevjjpfw.supabase.co)' } }; SmylClinicAdmin.reload(); });
    await page.waitForTimeout(800);
    const aviso = await page.evaluate(() => { const n = document.querySelector('#clinic-admin-feedback .clinic-admin-notice'); return n ? { texto: n.innerText, reintentar: !!Array.from(n.querySelectorAll('button')).find(x => x.textContent === 'Reintentar') } : null; });
    console.log('6) error de red:', JSON.stringify(aviso));
    check(aviso && !/TypeError|supabase\.co/.test(aviso.texto) && /internet/.test(aviso.texto), 'el error debe estar en lenguaje normal');
    check(aviso && aviso.reintentar, 'el error debe ofrecer Reintentar');
    await page.evaluate(() => { window.__failTables = null; }); await page.click('#clinic-admin-feedback button:has-text("Reintentar")'); await page.waitForTimeout(1500);
    await page.click('[data-ca-team-view="people"]'); await page.waitForTimeout(250);
    await page.fill('#clinic-admin-people-search', ''); await page.waitForTimeout(200);
    r = await rows(page); check(r.length === 6, 'tras reintentar debe volver a cargar la lista: ' + r.length);
    const profile=page.locator('select[name="chat_profile"]'), dest=page.locator('select[name="chat_destination"]');
    const openMember=id=>page.locator('[data-ca-team-panel="people"] .clinic-admin-person-row[data-person="u:'+id+'"]').click();
    await openMember('u2');
    await profile.selectOption('agent');
    await page.getByRole('button',{name:'Guardar perfil de chat'}).click();
    await page.getByText('Perfil guardado.',{exact:true}).waitFor();
    await page.click('.clinic-admin-sheet-close');
    await openMember('u3');
    await profile.selectOption('none');
    check(await page.getByRole('button',{name:'Guardar perfil de chat'}).isDisabled(), 'retirar acceso con chats requiere elegir destino');
    await dest.selectOption('u2');
    await page.getByRole('button',{name:'Transferir chats y quitar acceso'}).click();
    await page.getByText('Perfil guardado. 2 conversaciones pasaron a Dr. Hernan Partida.').waitFor();
    const transfer=await page.evaluate(()=>window.__calls.filter(c=>c[1]==='smyl_set_chat_access').at(-1)[2]);
    check(transfer.p_user_id==='u3' && transfer.p_expected_mode==='agent' && transfer.p_replacement_id==='u2' && transfer.p_mode==='none', 'la confirmación debe transferir y quitar acceso en una operación');
    await page.click('.clinic-admin-sheet-close');
    await openMember('u2');
    await profile.selectOption('none');await dest.selectOption('queue');
    await page.getByRole('button',{name:'Devolver chats y quitar acceso'}).click();
    await page.getByText('Perfil guardado. 2 conversaciones pasaron a Sin asignar.').waitFor();
    await page.evaluate(()=>{window.__chatConflict=true;});
    await profile.selectOption('agent');await page.getByRole('button',{name:'Guardar perfil de chat'}).click();
    await page.getByText('La asignación cambió.',{exact:false}).waitFor();
    check(await profile.inputValue()==='coordinator','un conflicto debe recargar el perfil real');
    await page.click('.clinic-admin-sheet-close');
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs)); if (errs.length) console.log(errs);
    await ctx.close();
  }

  // ── Encabezado coherente dentro de Configuración ──
  {
    const { ctx, page, errs } = await open(b, 'admin');
    await page.evaluate(() => ir('configuracion')); await page.waitForTimeout(800);
    await page.evaluate(() => SmylSettingsHub.openItem('clinica', 'Sucursales y espacios')); await page.waitForTimeout(1500);
    const antes = await page.evaluate(() => (document.querySelector('.settings-hub-detail-copy h1') || {}).textContent);
    const enlace = await page.$('[data-ca-go-team], [data-ca-tab-target="equipo"]');
    if (enlace) {
      await enlace.evaluate(node => node.click()); await page.waitForTimeout(1200);
      const despues = await page.evaluate(() => ({ h1: (document.querySelector('.settings-hub-detail-copy h1') || {}).textContent, equipo: !document.querySelector('[data-ca-panel="equipo"]').hidden }));
      console.log('7) encabezado dentro de Configuración:', antes, '→', JSON.stringify(despues));
      check(despues.equipo && despues.h1 === 'Integrantes', 'el encabezado debe cambiar a «Integrantes» al pasar a Equipo: ' + JSON.stringify(despues));
    } else console.log('7) sin enlace a Equipo en este estado (se omite)');
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs));
    await ctx.close();
  }

  // ── Base sin el teléfono ni la regla de traslado todavía ──
  {
    const { ctx, page, errs } = await open(b, 'admin', null, () => { window.__noPhone = true; window.__noRules = true; });
    await team(page);
    await page.click('[data-ca-team-panel="people"] .clinic-admin-person-row[data-person="p:pr2"]'); await page.waitForTimeout(400);
    const t = await page.evaluate(() => ({ ficha: document.getElementById('clinic-admin-person').innerText, tarjeta: document.getElementById('clinic-admin-travel-card').hidden }));
    console.log('8) base sin actualizar: sin teléfono =', !/Teléfono interno/.test(t.ficha), '· tarjeta de traslado oculta =', t.tarjeta);
    check(/Endodoncia/.test(t.ficha), 'la ficha debe abrir aunque falte la columna del teléfono');
    check(!/Teléfono interno/.test(t.ficha), 'sin la columna no debe mostrarse el teléfono');
    check(t.tarjeta, 'sin la tabla de reglas no debe mostrarse el traslado');
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs));
    await ctx.close();
  }

  // ── Solo consulta ──
  {
    const { ctx, page, errs } = await open(b, 'consulta');
    await team(page);
    await page.click('[data-ca-team-panel="people"] .clinic-admin-person-row[data-person="p:pr3"]'); await page.waitForTimeout(400);
    const c = await page.evaluate(() => ({
      texto: document.getElementById('clinic-admin-person').innerText,
      editar: !!document.querySelector('.clinic-admin-sheet-edit'), quitar: !!document.querySelector('.clinic-admin-link-danger'), asignar: !!document.querySelector('.clinic-admin-sheet-add'),
      zona: !!document.querySelector('.is-danger'),
      invitar: !document.getElementById('clinic-admin-add-member').hidden, agregar: !document.getElementById('clinic-admin-add-professional').hidden
    }));
    console.log('9) solo consulta:', JSON.stringify({ editar: c.editar, quitar: c.quitar, asignar: c.asignar, zona: c.zona, invitar: c.invitar, agregar: c.agregar }));
    check(/Iván/.test(c.texto) && /Cirugía oral/.test(c.texto) && /Lomas Verdes/.test(c.texto), 'la consulta sí ve los datos y las sedes');
    check(!c.editar && !c.quitar && !c.asignar && !c.zona, 'quien no administra no debe ver editar, quitar, asignar ni la zona delicada');
    check(!c.invitar && !c.agregar, 'quien no administra no debe ver invitar ni agregar doctor');
    await page.click('.clinic-admin-sheet-close'); await page.waitForTimeout(200);
    await page.locator('[data-ca-team-panel="people"] .clinic-admin-person-row[data-person="u:u2"]').click();
    check(await page.locator('select[name="chat_profile"]').count()===0,'la consulta no expone perfiles de chat de otras personas');
    check(await page.evaluate(()=>!window.__calls.some(c=>c[1]==='smyl_chat_team_settings')),'la consulta no solicita el directorio privado');
    await page.click('.clinic-admin-sheet-close');
    const margenBloqueado = await page.evaluate(() => ({ deshabilitado: document.getElementById('clinic-admin-travel-minutes').disabled, boton: !!document.querySelector('#clinic-admin-travel .btn') }));
    check(margenBloqueado.deshabilitado && !margenBloqueado.boton, 'quien no administra no puede cambiar el margen');
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs));
    await ctx.close();
  }

  // ── Celular ──
  {
    const { ctx, page, errs } = await open(b, 'admin', { width: 390, height: 844 });
    await page.evaluate(() => ir('clinica')); await page.waitForTimeout(1500);
    const operacionMovil = await page.evaluate(() => ({
      sinScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
      ancho: Math.round(document.querySelector('.clinic-admin-layout').getBoundingClientRect().width),
      vista: window.innerWidth,
      filtros: document.querySelectorAll('[data-ca-branch-filter]').length
    }));
    check(operacionMovil.sinScroll && operacionMovil.ancho <= operacionMovil.vista && operacionMovil.filtros === 2, 'Sucursales debe adaptarse al celular sin desbordarse');
    await page.click('.clinic-admin-tab[data-ca-tab="equipo"]'); await page.waitForTimeout(500);
    const sinScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await page.click('[data-ca-team-panel="people"] .clinic-admin-person-row[data-person="p:pr3"]'); await page.waitForTimeout(500);
    const caja = await page.evaluate(() => { const r = document.getElementById('clinic-admin-person').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth }; });
    console.log('10) celular:', JSON.stringify({ sinScroll, ...caja }));
    check(sinScroll, 'no debe haber desplazamiento horizontal en el celular');
    check(caja.w === caja.vw, 'la ficha debe ocupar todo el ancho en el celular');
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs));
    await ctx.close();
  }

  // ── «Agregar profesional»: el WhatsApp es el mismo dato que «WhatsApp del profesional» de su ficha ──
  {
    const { ctx, page, errs } = await open(b, 'admin');
    await team(page);
    await page.click('[data-ca-team-view="professionals"]'); await page.waitForTimeout(250);
    await page.click('#clinic-admin-add-professional'); await page.waitForTimeout(300);
    const inicial = await page.evaluate(() => ({ titulo: document.querySelector('#clinic-admin-create-professional h2').textContent, campo: !document.getElementById('ca-prof-whatsapp').hidden }));
    console.log('11) alta:', JSON.stringify(inicial));
    check(inicial.titulo === 'Invitar profesional', 'el diálogo debe llamarse «Invitar profesional»');
    check(inicial.campo, 'el WhatsApp del profesional se pide desde el alta');
    // Correo nuevo: el WhatsApp viaja en la invitación (invite-staff lo guarda y se copia al aceptar).
    let enviado = null;
    await page.route('**/functions/v1/invite-staff', r => { enviado = JSON.parse(r.request().postData() || '{}'); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    await page.evaluate(() => { window.sb.auth.getSession = async () => ({ data: { session: { access_token: 't' } } }); });
    await page.fill('#ca-prof-email', 'nueva@clinica.mx'); await page.dispatchEvent('#ca-prof-email', 'input');
    await page.fill('#ca-prof-name', 'Dra. Nueva Prueba'); await page.selectOption('#ca-prof-branch', 'b1');
    await page.fill('#ca-prof-contact', '33 4444 1111'); await page.check('#ca-prof-whatsapp input[name="contact_phone_public"]');
    await page.click('#clinic-admin-create-professional [data-ca-submit]'); await page.waitForTimeout(1200);
    console.log('11a) invitación:', JSON.stringify(enviado && { n: enviado.contact_phone, p: enviado.contact_phone_public }));
    check(enviado && enviado.contact_phone === '33 4444 1111' && enviado.contact_phone_public === true, 'la invitación debe enviar el WhatsApp del profesional');
    await page.click('#clinic-admin-add-professional'); await page.waitForTimeout(300);
    await page.fill('#ca-prof-email', 'circulo@clinica.mx'); await page.dispatchEvent('#ca-prof-email', 'input'); await page.waitForTimeout(150);
    check(await page.isVisible('#ca-prof-contact'), 'con cuenta existente debe pedir el WhatsApp del profesional');
    await page.fill('#ca-prof-contact', '33 5555 0000'); await page.check('#ca-prof-whatsapp input[name="contact_phone_public"]');
    if (process.env.SMYL_SHOTS) await page.screenshot({ path: path.join(process.env.SMYL_SHOTS, 'equipo-alta-escritorio.png') });
    await page.click('#clinic-admin-create-professional [data-ca-submit]'); await page.waitForTimeout(1200);
    const pr1 = await page.evaluate(() => window.__db.smyl_professionals.find(p => p.id === 'pr1'));
    console.log('11b) alta guardada:', JSON.stringify({ n: pr1.contact_phone, p: pr1.contact_phone_public }));
    check(pr1.contact_phone === '33 5555 0000' && pr1.contact_phone_public === true, 'el alta debe guardar el WhatsApp en smyl_professionals.contact_phone');
    check(errs.length === 0, 'errores de página: ' + JSON.stringify(errs));
    await ctx.close();
  }

  // Capturas opcionales para la revisión visual: SMYL_SHOTS=/carpeta node tests/qa/equipo-ficha-smoke.cjs
  if (process.env.SMYL_SHOTS) {
    for (const [name, size] of [['escritorio', { width: 1440, height: 900 }], ['tablet', { width: 820, height: 1100 }], ['celular', { width: 390, height: 844 }]]) {
      const { ctx, page } = await open(b, 'admin', size);
      await page.evaluate(() => ir('clinica')); await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(process.env.SMYL_SHOTS, `sucursales-${name}.png`), fullPage: true });
      await team(page);
      await page.screenshot({ path: path.join(process.env.SMYL_SHOTS, `equipo-lista-${name}.png`) });
      await page.click('[data-ca-team-panel="people"] .clinic-admin-person-row[data-person="p:pr3"]'); await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(process.env.SMYL_SHOTS, `equipo-ficha-${name}.png`) });
      await ctx.close();
    }
  }
  await b.close(); server.close(); console.log(fails ? `\n${fails} falla(s)` : '\nTodo bien'); process.exit(fails ? 1 : 0);
});
