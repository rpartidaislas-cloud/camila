import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const connectionsCss = read('../smyl-connections.css');
const connectionsJs = read('../smyl-connections.js');
const securityCss = read('../smyl-security-center.css');
const securityJs = read('../smyl-security-center.js');
const fixture = read('./fixtures/smyl-connections-security-v33-preview.html');
const browserQa = read('./smyl-connections-security-v33-browser.cjs');

test('Conexiones v3.3 comunica estado y progreso sin cambiar su integración', () => {
  assert.match(connectionsJs, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(connectionsJs, /role="list" aria-label="Canales de mensajería"/);
  assert.match(connectionsJs, /Estado: mensajería activa/);
  assert.match(connectionsJs, /button\.setAttribute\('aria-label', button\.textContent \+ ' ' \+ channelName\(name\)\)/);
  assert.match(connectionsJs, /request\('provision'\)/);
  assert.match(connectionsJs, /channelRequest\('POST', \{ action: 'disconnect', channel: channel \}\)/);
  assert.match(connectionsJs, /trainingRequest\('POST', 'publish'/);
});

test('Conexiones fija escala legible, objetivos táctiles y composición sin empalmes', () => {
  assert.match(connectionsCss, /Clinical Workspace v3\.3 · Conexiones/);
  assert.match(connectionsCss, /\.connections-shell \{0,1\}\.pro-eyebrow|\.connections-shell \.pro-eyebrow/);
  assert.match(connectionsCss, /font-size:12px!important/);
  assert.match(connectionsCss, /\.connections-shell button,[^{]+\{min-height:42px!important/);
  assert.match(connectionsCss, /@media\(max-width:600px\)\{[\s\S]*?min-height:44px!important/);
  assert.match(connectionsCss, /\.connections-channel-list>div\{display:grid;grid-template-columns:42px minmax\(0,1fr\) auto/);
  assert.match(connectionsCss, /\.connections-repeat-row\{[^}]*border-radius:0;background:transparent/);
  assert.match(connectionsCss, /:focus-visible\{outline:3px solid/);
});

test('Seguridad habla en lenguaje simple: cada tipo de aviso es una pregunta con botones, sin términos técnicos', () => {
  assert.match(securityJs, /function plain\(e\)/);
  for (const type of ['access_fingerprint_velocity', 'export_volume', 'rejected_file_volume', 'privilege_change_volume', 'file_maintenance_error', 'legacy_file_review']) assert.ok(securityJs.includes("case '" + type + "'"), type);
  assert.match(securityJs, /¿Fuiste tú o tu equipo trabajando normalmente\?/);
  assert.match(securityJs, /Todo en orden/);
  assert.match(securityJs, /Todos fueron normales/);
  assert.match(securityJs, /status:yes\?'resolved':'investigating'/);
  assert.match(securityJs, /call\('update_event'/);
  assert.match(securityJs, /call\('record_export'/);
  const visible = securityJs.slice(securityJs.indexOf('function build()'), securityJs.indexOf('async function load'));
  assert.doesNotMatch(visible, /fingerprint|runbook|Preserva|evidencia/i, 'nada técnico a la vista (el detalle técnico queda escondido)');
});

test('Seguridad presenta tarjetas claras, botones grandes, foco visible y se adapta al celular', () => {
  assert.match(securityCss, /SMYL · Seguridad en lenguaje simple/);
  assert.match(securityCss, /\.security-actions \.btn\{min-height:50px/);
  assert.match(securityCss, /\.security-eyebrow\{display:block;font-size:12px/);
  assert.match(securityCss, /:focus-visible\{outline:3px solid/);
  assert.match(securityCss, /@media\(max-width:620px\)\{[\s\S]*?\.security-actions \.btn\{flex:1 1 100%\}/);
  const sizes = [...securityCss.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.every((n) => n >= 12), 'tipografía mínima legible');
});

test('fixture y QA cubren 1440, 1024 y 390 sin servicios externos', () => {
  assert.match(fixture, /smyl-connections\.js/);
  assert.match(fixture, /smyl-security-center\.js/);
  assert.match(fixture, /Estado: mensajería activa/);
  assert.match(fixture, /Abierta[\s\S]*En investigación[\s\S]*Resuelta/);
  assert.match(browserQa, /desktop-1440/);
  assert.match(browserQa, /tablet-1024/);
  assert.match(browserQa, /mobile-390/);
  assert.match(browserQa, /textUnder12/);
  assert.match(browserQa, /smallTargets/);
  assert.match(browserQa, /horizontalOverflow/);
});
