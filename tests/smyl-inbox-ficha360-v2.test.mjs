import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('la Ficha 360 v2 llega igual a web, PWA y móvil, cargada antes del chat', () => {
  for (const file of ['smyl-inbox-ficha.js', 'smyl-inbox.js', 'smyl-inbox.css', 'app.html', 'sw.js']) {
    assert.equal(read(file), read(`mobile/www/${file}`), file);
  }
  const html = read('app.html');
  assert.match(html, /smyl-inbox-ficha\.js\?v=3/);
  assert.ok(html.indexOf('smyl-inbox-ficha.js') < html.indexOf('smyl-inbox.js?v='));
  assert.match(read('sw.js'), /smyl-inbox-ficha\.js\?v=3/);
});

test('el módulo visual no consulta datos ni conoce el tenant y expone pestañas accesibles', () => {
  const src = read('smyl-inbox-ficha.js');
  assert.match(src, /window\.SmylInboxFicha\s*=/);
  assert.doesNotMatch(src, /tenant_id|window\.tenantId|window\.sb|fetch\(/);
  assert.match(src, /role', 'tablist'/);
  assert.match(src, /'tabpanel'/);
  assert.match(src, /ArrowRight/);
  for (const label of ['Enviar a revisión clínica', 'Abrir / descargar']) assert.match(src, new RegExp(label));
});

test('las pestañas respetan los permisos del rol', () => {
  const src = read('smyl-inbox.js');
  assert.match(src, /hasPermission\('schedule\.read'\)\) \{\s*var appointmentItems/);
  assert.match(src, /hasPermission\('clinical\.read'\)\) tabs\.push\(\{ id: 'clinico'/);
  assert.match(src, /if \(linkedFicha\) tabs\.push\(\{ id: 'timeline'/);
  assert.match(src, /zones\.cobros\.childNodes\.length\) tabs\.push/);
  assert.match(src, /hasPermission\('clinical\.write'\) && canOperate\(conversation, 'clinical\.write'\)/);
  // Revisión clínica reutiliza la acción existente; no se inventó una nueva.
  assert.match(src, /onReview: function \(item\) \{ linkClinicalImage\(item\); \}/);
  assert.match(src, /smyl_patient_timeline/);
});

test('el consentimiento de WhatsApp se lee en servidor y llega como booleano opcional', () => {
  const edge = read('supabase/functions/lana-inbox/index.ts');
  assert.match(edge, /updated_at,consentimiento_whatsapp[,"]/);
  assert.match(edge, /whatsapp_consent: typeof patient\.consentimiento_whatsapp === "boolean"/);
  assert.match(read('smyl-inbox.js'), /typeof patient\.whatsapp_consent === 'boolean'/);
});
