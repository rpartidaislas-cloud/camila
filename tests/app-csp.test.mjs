import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const policy = (html) => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
const directivas = (p) => Object.fromEntries(p.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));

test('el panel declara una CSP que limita a dónde puede conectarse y qué puede cargar', () => {
  const d = directivas(policy(read('app.html')));
  assert.deepEqual(d['default-src'], ["'self'"]);
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'self'"]);
  assert.deepEqual(d['form-action'], ["'self'"]);
  // conexiones: solo el proyecto de Supabase y el monitoreo de errores; nada de comodines ni de «https:» abierto
  assert.deepEqual(d['connect-src'], ["'self'", 'https://rpxshsiwoxdbuevjjpfw.supabase.co', 'https://o4512394436083712.ingest.us.sentry.io']);
  for (const [k, v] of Object.entries(d)) assert.ok(!v.includes('*') && !v.includes('https:') && !v.includes('http:'), `${k} no debe abrirse a cualquier origen`);
  assert.ok(!d['script-src'].includes("'unsafe-eval'"), 'sin eval');
  for (const host of d['script-src']) assert.ok(!/^https?:/.test(host), 'sin scripts de terceros');
});

test('la CSP cubre lo que el panel usa de verdad: fuentes, QR, archivos firmados y el lector de PDF', () => {
  const d = directivas(policy(read('app.html')));
  assert.ok(d['style-src'].includes('https://fonts.googleapis.com'));
  assert.ok(d['font-src'].includes('https://fonts.gstatic.com'));
  assert.ok(d['img-src'].includes('https://api.qrserver.com'));
  assert.ok(d['img-src'].includes('https://*.supabase.co') && d['media-src'].includes('https://*.supabase.co'));
  assert.ok(d['worker-src'].includes("'self'") && d['worker-src'].includes('blob:'));
  assert.ok(d['script-src'].includes("'wasm-unsafe-eval'"), 'pdf.js usa WebAssembly');
});

test('Facturapi solo puede mostrarse en marcos (firma de la Carta Manifiesto); no es origen de scripts ni de conexiones', () => {
  const d = directivas(policy(read('app.html')));
  assert.ok(d['frame-src'].includes('https://www.facturapi.io'));
  assert.ok(!d['connect-src'].some((v) => /facturapi/.test(v)) && !d['script-src'].some((v) => /facturapi/.test(v)));
});

test('si se agrega un dominio nuevo al panel hay que declararlo: los hosts https del código están cubiertos o son solo enlaces', () => {
  const p = policy(read('app.html'));
  // Hosts que el código REALMENTE carga o consulta (no enlaces de navegación como wa.me o Google Maps).
  for (const host of ['rpxshsiwoxdbuevjjpfw.supabase.co', 'fonts.googleapis.com', 'api.qrserver.com', 'o4512394436083712.ingest.us.sentry.io']) assert.ok(p.includes(host), host);
});

test('anti-clickjacking en la página y mismas reglas en la app móvil', () => {
  for (const f of ['app.html', 'mobile/www/app.html']) {
    const html = read(f);
    assert.match(html, /if\(window\.top!==window\.self\)\{document\.documentElement\.style\.display='none'/);
    // la política va antes que cualquier script
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), f);
  }
  assert.equal(policy(read('app.html')), policy(read('mobile/www/app.html')));
});
