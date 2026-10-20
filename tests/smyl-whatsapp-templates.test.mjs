import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const catalog = require('../smyl-template-catalog.js');
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../smyl-templates.js');
const nav = read('../smyl-navigation.js');
const inbox = read('../smyl-inbox.js');
const app = read('../app.html');
const worker = read('../sw.js');
const reminders = read('../supabase/functions/appointment-reminders/index.ts');

const sample = () => JSON.parse(JSON.stringify(catalog.TEMPLATES.find((item) => item.id === 'cita_confirmada_v1')));

test('el catálogo propone muchas plantillas y cada una cumple las reglas de Meta', () => {
  assert.ok(catalog.TEMPLATES.length >= 30);
  assert.ok(catalog.TEMPLATES.filter((item) => item.category === 'UTILITY').length >= 20);
  assert.ok(catalog.TEMPLATES.filter((item) => item.category === 'MARKETING').length >= 8);
  const names = new Set();
  for (const template of catalog.TEMPLATES) {
    assert.deepEqual(catalog.validate(template), [], template.id);
    assert.ok(!names.has(template.id), 'nombre repetido: ' + template.id);
    names.add(template.id);
    assert.ok(catalog.GROUPS.some((group) => group.id === template.group), template.id);
  }
});

test('el validador rechaza lo que Meta rechazaría', () => {
  const cases = [
    ['variable al inicio', (t) => { t.body = '{{1}}, ' + t.body.slice(t.body.indexOf(',') + 2); }, /empezar ni terminar/],
    ['variable al final', (t) => { t.body = t.body.replace(/\.$/, ' {{4}}'); t.variables.push(t.variables[0]); }, /empezar ni terminar/],
    ['variables sin numerar en orden', (t) => { t.body = t.body.replace('{{2}}', '{{3}}').replace('{{3}} quedó', '{{3}} quedó'); }, /en orden|ejemplo/],
    ['variables pegadas', (t) => { t.body = t.body.replace('{{3}} a las {{4}}', '{{3}}{{4}}'); }, /juntas/],
    ['falta un ejemplo', (t) => { t.variables.pop(); }, /ejemplo/],
    ['ejemplo con salto de línea', (t) => { t.variables[0].example = 'Ana\nLópez'; }, /no es válido/],
    ['cuerpo demasiado largo', (t) => { t.body = 'Hola {{1}}, ' + 'texto '.repeat(200) + 'fin {{2}} más {{3}} aún {{4}}.'; }, /1,024/],
    ['nombre con mayúsculas', (t) => { t.id = 'Cita_Confirmada'; }, /minúsculas/],
    ['pie con variable', (t) => { t.footer = 'Clínica {{1}}'; }, /pie/],
    ['más de tres botones', (t) => { t.buttons = ['a', 'b', 'c', 'd'].map((text) => ({ type: 'QUICK_REPLY', text })); }, /tres botones/],
    ['botón demasiado largo', (t) => { t.buttons = [{ type: 'QUICK_REPLY', text: 'x'.repeat(26) }]; }, /25 caracteres/],
    ['Utilidad con promoción', (t) => { t.body = t.body.replace('quedó confirmada', 'quedó confirmada y tienes un 10% de descuento'); }, /promocional/],
    ['Utilidad con emojis', (t) => { t.body += ' 😊'; }, /emojis/],
    ['Marketing sin baja', (t) => { t.category = 'MARKETING'; t.footer = ''; }, /darse de baja/],
    ['dato sensible', (t) => { t.body = t.body.replace('quedó confirmada', 'quedó confirmada por tu diagnóstico'); }, /sensibles/],
    ['liga en el texto', (t) => { t.body = t.body.replace('responde a este mensaje', 'entra a https://bit.ly/x'); }, /ligas/],
    ['demasiadas variables para el texto', (t) => { t.body = 'Hola {{1}}, cita {{2}} {{3}} {{4}}.'.replace('{{2}} {{3}}', '{{2}}, ok, {{3}}'); }, /demasiadas variables/]
  ];
  for (const [name, mutate, expected] of cases) {
    const template = sample(); mutate(template);
    const issues = catalog.validate(template).join(' | ');
    assert.match(issues, expected, name + ' → ' + issues);
  }
});

test('Marketing siempre ofrece darse de baja y Utilidad nunca promociona', () => {
  for (const template of catalog.TEMPLATES) {
    if (template.category === 'MARKETING') assert.match(template.footer, /BAJA/, template.id);
    else assert.equal(template.footer, '', template.id);
  }
  assert.ok(catalog.TEMPLATES.every((item) => item.category === 'UTILITY' || item.group === 'marketing'));
});

test('la plantilla del recordatorio automático coincide con la configuración por defecto de la Agenda', () => {
  const automatic = catalog.TEMPLATES.filter((item) => item.automatic);
  assert.equal(automatic.length, 1);
  assert.equal(automatic[0].id, 'recordatorio_cita_24h_v1');
  assert.deepEqual(automatic[0].variables.map((variable) => variable.source), ['patient_first_name', 'date', 'time', 'clinic']);
  const allowed = reminders.match(/const SOURCES = \[([^\]]*)\]/)[1].match(/"(\w+)"/g).map((value) => value.replaceAll('"', ''));
  for (const template of catalog.TEMPLATES) for (const variable of template.variables) assert.ok(allowed.includes(variable.source), template.id + ' · ' + variable.source);
});

test('formatForLana entrega todo lo necesario para solicitar la plantilla', () => {
  const text = catalog.formatForLana(catalog.TEMPLATES.find((item) => item.id === 'limpieza_semestral_v1'));
  assert.match(text, /^Nombre: limpieza_semestral_v1/);
  assert.match(text, /Categoría: Marketing/);
  assert.match(text, /es_MX/);
  assert.match(text, /Pie de página: Responde BAJA/);
  assert.match(text, /Botones de respuesta rápida: Sí, quiero agendar \| Ahora no/);
  assert.match(text, /\{\{1\}\} = Ana \| \{\{2\}\} = Clínica Dental Sonríe/);
});

test('la pantalla consulta el estado en Meta por la función whatsapp-templates y permite copiar las plantillas', () => {
  assert.match(page, /FUNCTION_NAME = 'whatsapp-templates'/);
  assert.match(page, /invoke\(\{ action: 'list' \}\)/);
  assert.doesNotMatch(page, /lana-inbox|SUPA_KEY|fetch\(/);
  assert.match(page, /En revisión de Meta/);
  assert.match(page, /Copiar para LANA/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /window\.TITULOS\.plantillas = 'Plantillas de WhatsApp'/);
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
  assert.doesNotMatch(page, /action: *'schedule'|type: *'template'/);
});

test('Mensajería es una sección propia del menú con Mensajes y Plantillas de WhatsApp', () => {
  assert.match(nav, /var MESSAGING = \[\s*\['Mensajes', 'inbox', 'messages'\],\s*\['Plantillas de WhatsApp', 'plantillas', 'templates'\]\s*\]/);
  assert.match(nav, /nav\.append\(sectionLabel\('Mensajería'\)\)/);
  assert.match(nav, /mobileGroup\('Mensajería', MESSAGING\)/);
  const primary = nav.slice(nav.indexOf('var PRIMARY = ['), nav.indexOf('var ALERTS'));
  assert.doesNotMatch(primary, /'inbox'/);
});

test('Mensajes muestra cuántas conversaciones sin leer hay, sin abrir ninguna', () => {
  const badge = inbox.slice(inbox.indexOf('function renderNavBadge'), inbox.indexOf('function dayLabel'));
  assert.match(badge, /\.pro-app-nav \[data-route="inbox"\]/);
  assert.match(badge, /filter: 'unread', limit: 1/);
  assert.doesNotMatch(badge, /openConversation|action: 'read'/);
  assert.match(inbox, /setInterval\(refreshUnreadBadge, 90000\)/);
});

test('web, móvil y PWA publican las plantillas', () => {
  assert.match(app, /<link rel="stylesheet" href="smyl-templates\.css\?v=3">/);
  assert.match(app, /<script defer src="smyl-template-catalog\.js\?v=1"><\/script>\s*<script defer src="smyl-templates\.js\?v=2"><\/script>/);
  for (const file of ['smyl-templates.css?v=3', 'smyl-template-catalog.js?v=1', 'smyl-templates.js?v=2']) assert.ok(worker.includes("'/camila/" + file + "'"), file);
  for (const file of ['smyl-templates.js', 'smyl-templates.css', 'smyl-template-catalog.js', 'smyl-navigation.js', 'smyl-inbox.js', 'app.html', 'sw.js']) assert.equal(read('../mobile/www/' + file), read('../' + file), file);
});

test('el propietario solicita una plantilla del catálogo con confirmación y sin texto libre', () => {
  assert.match(page, /invoke\(\{ action: 'request', template_id: template\.id \}\)/);
  assert.match(page, /Solicitar a Meta/);
  assert.match(page, /button\.disabled = blocked/);
  assert.match(page, /Solo el propietario de la clínica puede solicitar plantillas/);
  assert.match(page, /ok\.onclick = function \(\) \{ dialog\.close\(\); submitRequest\(template\); \}/);
  assert.match(page, /Es de Marketing: solo envíala a pacientes que aceptaron/);
  assert.doesNotMatch(page, /action: 'request', (body|text)/);
  // Una a la vez, sin envío masivo.
  assert.match(page, /if \(state\.requesting\) return;/);
  assert.doesNotMatch(page, /forEach\([^)]*submitRequest/);
});

test('rechazos de Meta se explican en español y se avisa si Meta reclasificó la categoría', () => {
  for (const code of ['INVALID_FORMAT', 'ABUSIVE_CONTENT', 'SCAM', 'TAG_CONTENT_MISMATCH']) assert.match(page, new RegExp(code + ':'));
  assert.match(page, /Meta la clasificó como/);
});

test('la copia del catálogo para las Edge Functions está al día y la función usa solo ese catálogo', async () => {
  const { execFileSync } = await import('node:child_process');
  const target = new URL('../supabase/functions/_shared/whatsapp-template-catalog.mjs', import.meta.url);
  const before = fs.readFileSync(target, 'utf8');
  execFileSync(process.execPath, [new URL('../scripts/sync-template-catalog.mjs', import.meta.url).pathname], { stdio: 'pipe' });
  assert.equal(fs.readFileSync(target, 'utf8'), before, 'Regenera con: node scripts/sync-template-catalog.mjs');
  const shared = await import(target.href);
  assert.deepEqual(shared.TEMPLATES.map((item) => item.id), catalog.TEMPLATES.map((item) => item.id));
  for (const item of shared.TEMPLATES) assert.deepEqual(shared.validate(item), []);
  const bundlePath = new URL('../docs/bundles/whatsapp-templates.single-file.ts', import.meta.url);
  const bundle = fs.readFileSync(bundlePath, 'utf8');
  execFileSync(process.execPath, [new URL('../scripts/bundle-edge-function.mjs', import.meta.url).pathname, 'whatsapp-templates'], { stdio: 'pipe' });
  assert.equal(fs.readFileSync(bundlePath, 'utf8'), bundle, 'Regenera con: node scripts/bundle-edge-function.mjs whatsapp-templates');
  assert.doesNotMatch(bundle, /from "\.\.?\//);
  assert.match(fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8'), /\[functions\.whatsapp-templates\]\nverify_jwt = true/);
});
