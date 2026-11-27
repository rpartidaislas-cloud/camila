// Carta Manifiesto de Facturapi dentro de SMYL (2026-11-27). Misma solución que LANA (config.jsx): módulo oficial incrustado
// /embedded/manifiesto bajo demanda + enlace de respaldo al portal público (que Facturapi NO permite incrustar: X-Frame-Options).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const js = read('smyl-finance.js');
const css = read('smyl-finance.css');
const policy = (html) => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
const directivas = (p) => Object.fromEntries(p.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));

test('el paso del CSD ofrece firmar la Carta Manifiesto en lugar de solo pedir que se firme en otro lado', () => {
  assert.match(js, /csdAction='Firmar Carta Manifiesto';csdRun=openManifestDialog;/);
  assert.match(js, /\{label:'Ya la firmé, revisar',run:syncOrganization\}/);
  assert.match(js, /La firma el dueño del RFC con su e\.firma, directo con Facturapi\./);
  // si todavía falta el CSD se avisa que la carta viene después
  assert.match(js, /Después tendrás que firmar la Carta Manifiesto\./);
});

test('el diálogo incrusta solo el módulo oficial, bajo demanda, con sandbox sin navegación de la página', () => {
  assert.match(js, /MANIFEST_EMBED='https:\/\/www\.facturapi\.io\/embedded\/manifiesto'/);
  assert.match(js, /MANIFEST_PORTAL='https:\/\/www\.facturapi\.io\/manifiesto'/);
  // el iframe se crea al pulsar «Mostrar formulario de firma», no al abrir el diálogo
  assert.match(js, /show\.onclick=function\(\)\{\s*if\(!frame\.firstChild\)\{\s*var f=document\.createElement\('iframe'\)/);
  assert.match(js, /f\.referrerPolicy='no-referrer'/);
  const sandbox = js.match(/f\.setAttribute\('sandbox','([^']+)'\)/)[1].split(' ');
  assert.ok(sandbox.includes('allow-scripts') && sandbox.includes('allow-forms') && sandbox.includes('allow-same-origin'));
  assert.ok(!sandbox.some((x) => /top-navigation/.test(x)), 'el formulario de un tercero no puede navegar la página de SMYL');
  // el portal público no se puede incrustar: va en una ventana aparte, sin acceso a la página de origen
  assert.match(js, /href="'\+MANIFEST_PORTAL\+'" target="_blank" rel="noopener noreferrer">Abrir en otra ventana/);
  // la URL del iframe es fija: no lleva datos de la clínica
  assert.ok(!/MANIFEST_EMBED\s*\+/.test(js) && !/src=.*MANIFEST_EMBED\s*\+/.test(js));
});

test('el diálogo detecta solo la firma, revisa en Facturapi y se limpia al cerrarse', () => {
  assert.match(js, /MANIFEST_POLL_MS=25000,MANIFEST_POLL_MAX=48/);
  assert.match(js, /await facturapiCall\(\{action:'sync'\}\);await loadFacturapi\(\);\s*if\(!manifestPending\(\)\)\{stop\(\);close\(\);await reload\(/);
  assert.match(js, /function manifestPending\(\)\{return \(\(state\.facturapi&&state\.facturapi\.pending_steps\)\|\|\[\]\)\.some\(function\(x\)\{return x&&x\.type==='manifiesto';\}\);\}/);
  // solo consulta con la pestaña visible, con tope, y detiene el temporizador al cerrar
  assert.match(js, /document\.visibilityState==='visible'&&\+\+runs<=MANIFEST_POLL_MAX/);
  assert.match(js, /d\.addEventListener\('close',stop,\{once:true\}\)/);
  // la clase de ancho no debe quedarse pegada a los demás diálogos de finanzas
  assert.match(js, /function stop\(\)\{clearInterval\(timer\);timer=0;d\.classList\.remove\('finance-manifest-dialog'\);\}/);
  // exige el permiso de facturación, igual que subir el CSD
  assert.match(js, /function openManifestDialog\(\)\{\s*if\(!state\.canInvoice\)return notify\('Tu rol no permite configurar la facturación\.','error'\);/);
});

test('la CSP del panel permite SOLO ese host de Facturapi para incrustar, igual en web y en la app móvil', () => {
  for (const f of ['app.html', 'mobile/www/app.html']) {
    const d = directivas(policy(read(f)));
    assert.deepEqual(d['frame-src'], ["'self'", 'blob:', 'https://*.supabase.co', 'https://www.facturapi.io'], f);
    assert.deepEqual(d['object-src'], ["'none'"]);
    // no se abrió nada más: Facturapi solo puede mostrarse en marcos, no cargar scripts ni conexiones del panel
    for (const k of ['script-src', 'connect-src', 'img-src']) assert.ok(!d[k].some((v) => /facturapi/.test(v)), `${f}: ${k}`);
  }
  assert.equal(policy(read('app.html')), policy(read('mobile/www/app.html')));
});

test('el diálogo usa texto mínimo de 12 px, se adapta al celular y está publicado', () => {
  const block = css.slice(css.indexOf('/* Carta Manifiesto de Facturapi'));
  assert.doesNotMatch(block, /font-size:(?:[0-9]|1[01])px/);
  assert.match(block, /\.finance-dialog\.finance-manifest-dialog\{width:min\(780px,calc\(100vw - 28px\)\)\}/);
  assert.match(block, /@media\(max-width:620px\)/);
  // los estilos de botón no deben dejar a la vista lo que está oculto, y los botones siguen visibles al desplazar el formulario
  assert.match(block, /\.billing-manifest \[hidden\]\{display:none!important\}/);
  assert.match(block, /\.billing-manifest \.finance-actions\{[^}]*position:sticky;bottom:0/);
  assert.match(js, /d\.querySelector\('\.billing-manifest-list'\)\.hidden=true/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=91/);
  assert.match(read('app.html'), /smyl-finance\.css\?v=65/);
  assert.match(read('sw.js'), /carta-manifiesto-v1/);
  for (const f of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) assert.equal(read(`mobile/www/${f}`), read(f), f);
});
