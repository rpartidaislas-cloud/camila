import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }
const skip = chromium ? false : 'Playwright/Chromium no disponible';
const guard = read('smyl-modal-guard.js');
const css = read('smyl-dialog-system.css');

// Los patrones reales de cierre-por-fondo que había en la app (cada ventana traía el suyo).
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>[hidden]{display:none !important}
body{margin:0;font:14px system-ui} dialog{width:360px;padding:0;border:0;border-radius:12px} dialog::backdrop{background:rgba(0,0,0,.4)}
.pane{padding:20px} .overlay-x{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
.overlay-x>div{background:#fff;padding:20px;width:300px}
</style></head><body>
<dialog id="a"><div class="pane"><input id="a-in" value="texto largo para seleccionar"><button id="a-close" onclick="document.getElementById('a').close()">Cerrar</button></div></dialog>
<dialog id="b"><div class="pane"><button data-close>Cerrar</button></div></dialog>
<dialog id="c"><div class="pane">viewer</div></dialog>
<div id="modal-legacy" class="overlay-x" role="dialog" aria-modal="true" hidden><div><button id="legacy-close">Cerrar</button></div></div>
<dialog id="smyl-command-dialog"><div class="pane">paleta</div></dialog>
<div id="nav-overlay" class="mobile-nav-overlay overlay-x" hidden><div>menú lateral</div></div>
<div id="panel-admin-mobile" role="dialog" aria-modal="true" class="overlay-x" hidden><div class="pam-backdrop" style="position:absolute;inset:0"></div><div style="position:relative;background:#fff;padding:20px">Más opciones</div></div>
<script>
 const a=document.getElementById('a'), b=document.getElementById('b'), c=document.getElementById('c');
 // Patrón 1: addEventListener + target === dialog (consultorio, calendario, comandos…)
 a.addEventListener('click', e => { if (e.target === a) a.close(); });
 // Patrón 2: onclick + target === currentTarget (finanzas, inventario, agenda, paciente 360…)
 b.onclick = e => { if (e.target === e.currentTarget) e.currentTarget.close(); };
 // Patrón 3: mousedown en el fondo
 c.addEventListener('mousedown', e => { if (e.target === c) c.close(); });
 // Patrón 4: capa propia (no <dialog>) que se quita al hacer clic en el fondo (detalle del caso, traspaso LANA…)
 const legacy=document.getElementById('modal-legacy'); legacy.onclick = e => { if (e.target === legacy) legacy.hidden = true; };
 document.getElementById('legacy-close').onclick = () => { legacy.hidden = true; };
 const nav=document.getElementById('nav-overlay'); nav.onclick = e => { if (e.target === nav) nav.hidden = true; };
 const pam=document.getElementById('panel-admin-mobile'); pam.querySelector('.pam-backdrop').onclick = () => { pam.hidden = true; }; pam.onclick = e => { if (e.target === pam) pam.hidden = true; };
 const pal=document.getElementById('smyl-command-dialog'); pal.addEventListener('click', e => { if (e.target === pal) pal.close(); });
</script></body></html>`;

async function open(page) {
  await page.setContent(PAGE);
  await page.addScriptTag({ content: guard });
  await page.addStyleTag({ content: css });
}
const isOpen = (page, id) => page.evaluate((i) => { const n = document.getElementById(i); return n.tagName === 'DIALOG' ? n.open : !n.hidden; }, id);

test('un clic en el fondo no cierra ninguna ventana, sea cual sea su propio código de cierre', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await open(page);
    for (const id of ['a', 'b', 'c', 'modal-legacy']) {
      await page.evaluate((i) => { const n = document.getElementById(i); if (n.tagName === 'DIALOG') n.showModal(); else n.hidden = false; }, id);
      await page.mouse.click(10, 10); // fuera del panel
      assert.equal(await isOpen(page, id), true, `${id} sigue abierta tras clic fuera`);
      await page.mouse.dblclick(890, 690);
      assert.equal(await isOpen(page, id), true, `${id} sigue abierta tras doble clic fuera`);
      await page.evaluate((i) => { const n = document.getElementById(i); if (n.tagName === 'DIALOG') n.close(); else n.hidden = true; }, id);
    }
  } finally { await browser.close(); }
});

test('seleccionar texto y soltar el ratón fuera ya no cierra la ventana ni pierde lo escrito', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await open(page);
    await page.evaluate(() => document.getElementById('a').showModal());
    const box = await page.locator('#a-in').boundingBox();
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 6 });
    await page.mouse.up();
    assert.equal(await isOpen(page, 'a'), true);
    assert.equal(await page.inputValue('#a-in'), 'texto largo para seleccionar');
  } finally { await browser.close(); }
});

test('los botones de la ventana, Esc y el clic dentro siguen funcionando', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await open(page);
    await page.evaluate(() => document.getElementById('a').showModal());
    await page.click('#a-in');
    assert.equal(await isOpen(page, 'a'), true, 'clic dentro no cierra');
    await page.click('#a-close');
    assert.equal(await isOpen(page, 'a'), false, 'su botón Cerrar sí cierra');
    await page.evaluate(() => document.getElementById('b').showModal());
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(page, 'b'), false, 'Esc sigue cerrando');
    await page.evaluate(() => { document.getElementById('modal-legacy').hidden = false; });
    await page.click('#legacy-close');
    assert.equal(await isOpen(page, 'modal-legacy'), false, 'la capa propia cierra con su botón');
  } finally { await browser.close(); }
});

test('el clic fuera da un latido breve que indica que no se cerró', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await open(page);
    await page.evaluate(() => document.getElementById('b').showModal());
    await page.mouse.click(10, 10);
    assert.equal(await page.evaluate(() => document.getElementById('b').classList.contains('smyl-modal-nudge')), true);
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => document.getElementById('b').classList.contains('smyl-modal-nudge')), false);
  } finally { await browser.close(); }
});

test('la paleta de búsqueda es la excepción: sigue cerrando al hacer clic fuera', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await open(page);
    await page.evaluate(() => document.getElementById('smyl-command-dialog').showModal());
    await page.mouse.click(10, 10);
    assert.equal(await isOpen(page, 'smyl-command-dialog'), false);
  } finally { await browser.close(); }
});

test('los menús laterales y la hoja «Más opciones» del celular siguen cerrándose al tocar fuera', { skip }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await open(page);
    await page.evaluate(() => { document.getElementById('nav-overlay').hidden = false; });
    await page.mouse.click(10, 10);
    assert.equal(await isOpen(page, 'nav-overlay'), false, 'menú lateral: toque fuera lo cierra');
    await page.evaluate(() => { document.getElementById('panel-admin-mobile').hidden = false; });
    await page.mouse.click(10, 10);
    assert.equal(await isOpen(page, 'panel-admin-mobile'), false, 'hoja Más opciones: toque fuera la cierra');
  } finally { await browser.close(); }
});

test('el guardián se publica en la app web, la PWA y el móvil y precarga en el service worker', () => {
  for (const file of ['smyl-modal-guard.js', 'smyl-dialog-system.css', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
  assert.match(read('app.html'), /<script defer src="smyl-modal-guard\.js\?v=1"><\/script>/);
  assert.match(read('sw.js'), /\/camila\/smyl-modal-guard\.js\?v=1/);
  assert.match(css, /\.smyl-modal-nudge/);
  assert.match(css, /prefers-reduced-motion/);
});
