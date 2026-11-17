// Humo de navegador de «Mi cuenta» (solo la persona) y «Plan y suscripción» (solo el dueño), con tests/qa/fake-supabase-agenda.js.
//   NODE_PATH=$(npm root -g) node tests/qa/mi-cuenta-smoke.cjs      (requiere Playwright y Chromium)
// Dueño: Mi cuenta ya no trae el plan ni el campo «Consultorio»; guarda sus datos en su perfil y el nombre en la cuenta;
//        «Plan y suscripción» muestra el plan.
// Equipo: Mi cuenta muestra SU correo (no el del dueño), guardar no toca la clínica, el plan no está disponible y
//         Configuración no ofrece «Plan y suscripción». Sale con código 1 si algo falla.
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

// Agrega auth.updateUser (que el doble original no trae) y, para el equipo, otro usuario con fila en camila_usuarios.
function fakeSource(staff) {
  let src = fs.readFileSync(path.join(__dirname, 'fake-supabase-agenda.js'), 'utf8');
  if (staff) {
    src = src.replace("const user={id:T,email:'dd@clinica.mx',user_metadata:{},is_anonymous:false};", "const user={id:'staff-1',email:'asistente@clinica.mx',user_metadata:{},is_anonymous:false};");
    src = src.replace('camila_usuarios:[]', "camila_usuarios:[{id:'staff-1',tenant_id:T,rol:'staff',activo:true,nombre:null,email:'asistente@clinica.mx'}]");
  }
  src = src.replace('signOut:async()=>({error:null}),', "signOut:async()=>({error:null}),updateUser:async(args)=>{window.__calls.push(['updateUser',args]);Object.assign(user.user_metadata,args.data||{});return {data:{user},error:null};},");
  return src;
}

async function escenario(browser, staff) {
  const etiqueta = staff ? 'EQUIPO' : 'DUEÑO'; let fails = 0; const errs = [];
  const check = (cond, msg) => { if (!cond) { console.log(`FALLA [${etiqueta}] · ${msg}`); fails++; } };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1500, height: 900 } }); const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.dismiss());
  const source = fakeSource(staff);
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('@supabase/supabase-js') || u.includes('/vendor/supabase-js-')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: source });
    return u.startsWith('http://127.0.0.1') ? r.continue() : r.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.evaluate(() => ir('mi-cuenta')); await page.waitForTimeout(500);

  const cuenta = await page.evaluate(() => ({
    plan: !!document.querySelector('#p-mi-cuenta #plan-card-visual, #p-mi-cuenta #mc-plan'),
    consultorio: !!document.querySelector('#mc-consultorio2'),
    nombre: document.getElementById('mc-nombre').value, email: document.getElementById('mc-email').value,
    activa: document.getElementById('p-mi-cuenta').classList.contains('activa')
  }));
  console.log(`1) [${etiqueta}] Mi cuenta:`, JSON.stringify(cuenta));
  check(cuenta.activa, 'Mi cuenta debe abrir');
  check(!cuenta.plan, 'Mi cuenta ya no debe traer la tarjeta del plan');
  check(!cuenta.consultorio, 'Mi cuenta ya no debe pedir el consultorio');
  if (staff) { check(cuenta.email === 'asistente@clinica.mx', 'el equipo debe ver SU correo, no el del dueño'); check(cuenta.nombre === '', 'el equipo no debe heredar el nombre del dueño'); }
  else { check(cuenta.email === 'dd@clinica.mx', 'el dueño ve su correo'); check(cuenta.nombre === 'Dd', 'el dueño ve el nombre de su cuenta'); }

  await page.fill('#mc-nombre', staff ? 'Asistente Prueba' : 'Dra. Prueba'); await page.fill('#mc-tel', '+52 33 0000 0000'); await page.fill('#mc-especialidad', 'Ortodoncia');
  await page.click('#mc-guardar'); await page.waitForTimeout(800);
  const guardado = await page.evaluate(() => ({
    llamadas: window.__calls.filter(c => c[0] === 'updateUser').map(c => c[1]),
    tenant: window.__db.camila_tenants[0].nombre, sidebar: document.getElementById('sb-nombre').textContent
  }));
  console.log(`2) [${etiqueta}] al guardar:`, JSON.stringify(guardado));
  check(guardado.llamadas.length === 1 && guardado.llamadas[0].data.perfil.especialidad === 'Ortodoncia' && guardado.llamadas[0].data.perfil.tel === '+52 33 0000 0000', 'debe guardar el perfil de la persona');
  if (staff) { check(guardado.tenant === 'Dd', 'el equipo NO debe cambiar el nombre de la cuenta del dueño'); check(guardado.sidebar === 'Asistente Prueba', 'la barra lateral debe mostrar su nombre'); }
  else { check(guardado.tenant === 'Dra. Prueba', 'el dueño mantiene el nombre de la cuenta'); check(guardado.sidebar === 'Dra. Prueba', 'la barra lateral muestra el nombre nuevo'); }

  await page.evaluate(() => ir('plan')); await page.waitForTimeout(500);
  const plan = await page.evaluate(() => ({ activa: document.getElementById('p-plan').classList.contains('activa'), nombre: (document.getElementById('mc-plan') || {}).textContent, aviso: !!document.getElementById('p-no-disponible') && document.getElementById('p-no-disponible').classList.contains('activa') }));
  console.log(`3) [${etiqueta}] Plan y suscripción:`, JSON.stringify(plan));
  if (staff) { check(!plan.activa && plan.aviso, 'el equipo no debe poder abrir el plan'); }
  else { check(plan.activa && plan.nombre === 'Profesional', 'el dueño ve su plan'); }

  await page.evaluate(() => ir('configuracion')); await page.waitForTimeout(1200);
  await page.click('.settings-hub-nav-item[data-section="cuenta"]'); await page.waitForTimeout(500);
  const hub = await page.evaluate(() => /Plan y suscripción/.test(document.getElementById('p-configuracion').innerText));
  console.log(`4) [${etiqueta}] Configuración ofrece «Plan y suscripción»:`, hub);
  check(hub === !staff, staff ? 'Configuración no debe ofrecer el plan al equipo' : 'Configuración debe ofrecer el plan al dueño');

  console.log(`errores de página [${etiqueta}]:`, JSON.stringify(errs)); if (errs.length) fails++;
  await ctx.close(); return fails;
}

server.listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch(); let fails = 0;
  fails += await escenario(b, false); fails += await escenario(b, true);
  await b.close(); server.close(); console.log(fails ? `\n${fails} falla(s)` : '\nTodo bien'); process.exit(fails ? 1 : 0);
});
