import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Página pública de pago (pagar.html): al recibir el pago el paciente ve su comprobante y puede compartirlo, descargarlo como
// imagen, imprimirlo o guardarlo como PDF. Todo se genera en el navegador: no se manda nada a ningún servidor.
const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(root + 'pagar.html', 'utf8');
const T = 'ab'.repeat(32);
const PAID = { status: 'paid', clinic: 'Círculo Médico Dental', patient: 'María Fernanda López', amount: 1250.5, paid_at: '2026-11-27T06:05:00Z', method: 'card', receipt_folio: '000010',
  lines: [{ concept: 'Aplicación de flúor', amount: 12 }, { concept: 'Limpieza dental profunda', amount: 1238.5 }] };

test('el comprobante ofrece compartir, descargar imagen, imprimir/PDF, correo, copiar y WhatsApp sin tocar el CSP', () => {
  for (const label of ['Compartir comprobante', 'Descargar imagen', 'Imprimir o guardar PDF', 'Enviar por correo', 'Copiar resumen', 'Enviar por WhatsApp', 'Total pagado', '¡Pago recibido!']) assert.ok(html.includes(label), label);
  assert.match(html, /navigator\.canShare && navigator\.canShare\(\{ files: \[file\] \}\)/);
  assert.match(html, /@media print\{[\s\S]*?\.paid-actions[\s\S]*?\}/);
  assert.match(html, /transfer: 'Transferencia SPEI'/);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.doesNotMatch(csp, /blob:/, 'no hizo falta abrir blob: en el CSP');
  assert.match(csp, /default-src 'self'/);
});

test('el texto que se comparte no incluye el enlace ni el token de pago', () => {
  const start = html.indexOf('function receiptText'), end = html.indexOf('function wrapLines');
  const body = html.slice(start, end);
  assert.doesNotMatch(body, /token|location|href/);
});

const browser = (() => { try { return createRequire(import.meta.url)('playwright').chromium; } catch { return null; } })();
async function paginaPagada({ compartir }) {
  const b = await browser.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }); const page = await ctx.newPage();
  const errores = []; page.on('pageerror', (e) => errores.push(e.message));
  await ctx.route('http://localhost:8777/**', (r) => { const u = new URL(r.request().url()); try { r.fulfill({ body: fs.readFileSync(root + u.pathname.slice(1)), contentType: u.pathname.endsWith('.js') ? 'text/javascript' : u.pathname.endsWith('.css') ? 'text/css' : u.pathname.endsWith('.png') ? 'image/png' : 'text/html' }); } catch { r.fulfill({ status: 404, body: '' }); } });
  await ctx.route('https://resources.openpay.mx/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await ctx.route('**/functions/v1/smyl-pay', (r) => r.fulfill({ json: PAID }));
  await ctx.route('**/functions/v1/pago-publico', (r) => r.fulfill({ json: { openpay: null } }));
  if (compartir) await page.addInitScript(() => { window.__shared = []; navigator.share = async (d) => { window.__shared.push({ text: d.text, files: (d.files || []).map((f) => f.name + ':' + f.type) }); }; navigator.canShare = () => true; });
  await page.goto('http://localhost:8777/pagar.html?pago=retorno&id=x#t=' + T);
  await page.waitForSelector('.paid-ticket');
  return { page, b, errores };
}

test('navegador: el comprobante muestra monto, recibo, forma de pago y descarga una imagen PNG', { skip: !browser && 'sin Playwright' }, async () => {
  const { page, b, errores } = await paginaPagada({ compartir: false });
  try {
    assert.equal(await page.textContent('.paid-hero h1'), '¡Pago recibido!');
    assert.match(await page.textContent('.paid-amount'), /\$1,250\.50/);
    const filas = await page.$$eval('.paid-facts div', (d) => d.map((x) => x.textContent));
    assert.ok(filas.some((f) => /Recibo#000010/.test(f)) && filas.some((f) => /Forma de pagoTarjeta/.test(f)));
    assert.equal(await page.isVisible('text=Enviar por WhatsApp'), true, 'sin hoja de compartir hay un botón directo de WhatsApp');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Descargar imagen')]);
    assert.equal(dl.suggestedFilename(), 'comprobante-circulo-medico-dental-000010.png');
    const bytes = fs.readFileSync(await dl.path());
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'es un PNG de verdad');
    assert.ok(bytes.length > 20000, 'trae contenido, no un lienzo en blanco');
    assert.deepEqual(errores, []);
  } finally { await b.close(); }
});

test('navegador: «Compartir comprobante» manda el texto y la imagen por la hoja de compartir del teléfono', { skip: !browser && 'sin Playwright' }, async () => {
  const { page, b, errores } = await paginaPagada({ compartir: true });
  try {
    await page.click('text=Compartir comprobante');
    await page.waitForFunction(() => window.__shared.length === 1);
    const s = await page.evaluate(() => window.__shared[0]);
    assert.match(s.text, /Total pagado: \$1,250\.50 MXN/);
    assert.match(s.text, /Recibo: #000010/);
    assert.deepEqual(s.files, ['comprobante-circulo-medico-dental-000010.png:image/png']);
    assert.doesNotMatch(s.text, new RegExp(T));
    assert.deepEqual(errores, []);
  } finally { await b.close(); }
});
