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

test('Seguridad traduce prioridad y resolución a estados inequívocos', () => {
  assert.match(securityJs, /function severityLabel/);
  assert.match(securityJs, /Prioridad crítica/);
  assert.match(securityJs, /function statusLabel/);
  assert.match(securityJs, /En investigación/);
  assert.match(securityJs, /class="security-severity"/);
  assert.match(securityJs, /class="security-state"/);
  assert.match(securityJs, /aria-label="'\+esc\(action\+' señal: '\+e\.title\)/);
  assert.match(securityJs, /call\('update_event'/);
  assert.match(securityJs, /call\('record_export'/);
});

test('Seguridad presenta listas planas, foco visible y controles accesibles', () => {
  assert.match(securityCss, /Clinical Workspace v3\.3 · Seguridad/);
  assert.match(securityCss, /\.security-eyebrow\{font-size:12px/);
  assert.match(securityCss, /\.security-events article\{[^}]*border-radius:0;background:transparent/);
  assert.match(securityCss, /\.security-state\{[^}]*font-size:12px/);
  assert.match(securityCss, /\.security-page button,\.security-dialog button\{min-height:42px;min-width:42px/);
  assert.match(securityCss, /@media\(max-width:620px\)\{[\s\S]*?min-height:44px;min-width:44px/);
  assert.match(securityCss, /:focus-visible/);
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
