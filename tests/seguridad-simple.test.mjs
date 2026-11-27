import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Seguridad en lenguaje simple: «Sí» cierra el aviso como normal, «No» lo pone en investigación y dice qué hacer, y los avisos repetidos se cierran juntos.
const root = fileURLToPath(new URL('..', import.meta.url));
const chromium = (() => { try { return createRequire(import.meta.url)('playwright').chromium; } catch { return null; } })();

async function pagina(events) {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 850 } }); const page = await ctx.newPage(); const errores = []; page.on('pageerror', (e) => errores.push(e.message));
  await ctx.route('http://localhost:8777/**', (r) => { const u = new URL(r.request().url());
    if (u.pathname === '/t.html') return r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset=utf8><body><div class="contenido"></div><script>window.TITULOS={};window.ir=function(){};window.__calls=[];window.__ev=${JSON.stringify(events)};window.confirm=function(){return true};
      var client={auth:{getSession:function(){return Promise.resolve({data:{session:null}})},onAuthStateChange:function(){}},functions:{invoke:function(n,o){var a=o.body;__calls.push(a);
        if(a.action==='update_event'){var e=__ev.find(function(x){return x.id===a.event_id});if(e)e.status=a.status;return Promise.resolve({data:{ok:true}});}
        if(a.action==='dashboard')return Promise.resolve({data:{dashboard:{metrics:{open_events:__ev.filter(function(x){return x.status!=='resolved'}).length,high_events:0},events:__ev,exports:[]}}});
        return Promise.resolve({data:{ok:true}});}}};</script><script src=smyl-security-center.js></script><script>window.addEventListener('load',function(){SmylSecurity.start(client);SmylSecurity.load(true);});</script>` });
    try { r.fulfill({ body: fs.readFileSync(root + u.pathname.slice(1)), contentType: u.pathname.endsWith('.js') ? 'text/javascript' : u.pathname.endsWith('.css') ? 'text/css' : 'text/html' }); } catch { r.fulfill({ status: 404, body: '' }); } });
  await page.goto('http://localhost:8777/t.html');
  return { page, b, errores };
}
const velocity = (id, status = 'open') => ({ id, event_type: 'access_fingerprint_velocity', severity: 'warning', status, evidence: { fingerprints_24h: 4 }, last_seen_at: new Date().toISOString(), title: '<img src=x onerror=alert(1)>' });

test('sin avisos abiertos dice «Todo en orden»', { skip: !chromium && 'sin Playwright' }, async () => {
  const { page, b, errores } = await pagina([velocity('a', 'resolved')]);
  try {
    await page.waitForSelector('.security-status');
    assert.equal(await page.textContent('.security-status strong'), 'Todo en orden');
    assert.equal(await page.locator('.security-question').count(), 0);
    assert.deepEqual(errores, []);
  } finally { await b.close(); }
});

test('«Sí» cierra el aviso como normal con una nota fija; «No» lo investiga y muestra los pasos a seguir', { skip: !chromium && 'sin Playwright' }, async () => {
  const { page, b, errores } = await pagina([velocity('a'), { id: 'x', event_type: 'export_volume', severity: 'warning', status: 'open', evidence: { exports_15m: 7 }, last_seen_at: new Date().toISOString() }]);
  try {
    await page.waitForSelector('.security-question');
    assert.match(await page.textContent('.security-status strong'), /2 cosas que revisar/);
    await page.locator('.security-question', { hasText: 'varios aparatos' }).locator('.security-yes').click();
    await page.waitForFunction(() => window.__calls.some((c) => c.action === 'update_event'));
    let call = await page.evaluate(() => window.__calls.find((c) => c.action === 'update_event'));
    assert.deepEqual([call.event_id, call.status], ['a', 'resolved']);
    assert.ok(call.note.length >= 8, 'el servidor exige una nota de al menos 8 caracteres');
    await page.waitForSelector('.security-question:has-text("documentos")');
    await page.locator('.security-question', { hasText: 'documentos' }).locator('.security-no').click();
    await page.waitForSelector('.security-help');
    call = await page.evaluate(() => window.__calls.filter((c) => c.action === 'update_event').at(-1));
    assert.deepEqual([call.event_id, call.status], ['x', 'investigating']);
    assert.match(await page.textContent('.security-help'), /Cambia tu contraseña/);
    assert.deepEqual(errores, []);
  } finally { await b.close(); }
});

test('avisos repetidos se cierran juntos y el texto del servidor nunca se interpreta como HTML', { skip: !chromium && 'sin Playwright' }, async () => {
  const { page, b, errores } = await pagina([velocity('a'), velocity('b'), velocity('c'), velocity('d'), { id: 'z', event_type: 'algo_nuevo', severity: 'warning', status: 'open', title: '<img src=x onerror=alert(1)>', summary: '<b>hola</b>', evidence: {}, last_seen_at: new Date().toISOString() }]);
  try {
    await page.waitForSelector('.security-bulk');
    assert.match(await page.textContent('.security-bulk span'), /4 avisos/);
    assert.equal(await page.locator('img').count(), 0, 'el título del servidor no se convierte en etiqueta');
    await page.click('.security-bulk .btn');
    await page.waitForFunction(() => window.__calls.filter((c) => c.action === 'update_event').length === 4);
    const ids = await page.evaluate(() => window.__calls.filter((c) => c.action === 'update_event').map((c) => c.event_id).sort());
    assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
    await page.waitForFunction(() => !document.querySelector('.security-bulk'));
    assert.deepEqual(errores, []);
  } finally { await b.close(); }
});
