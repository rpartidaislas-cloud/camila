import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const source = read('smyl-sentry.js');

const plain = (value) => JSON.parse(JSON.stringify(value));

function load({ dsn = '', onLine = true } = {}) {
  const appended = [];
  const listeners = [];
  const window = {
    SMYL_SENTRY_DSN: dsn,
    addEventListener: (type) => listeners.push(type),
    removeEventListener() {}
  };
  const document = {
    head: { appendChild: (node) => appended.push(node) },
    createElement: () => ({})
  };
  const context = {
    window, document, Date, Object, Array, String, Error, RegExp, JSON, Promise,
    location: { hostname: 'rpartidaislas-cloud.github.io', origin: 'https://rpartidaislas-cloud.github.io', pathname: '/camila/app.html' },
    navigator: { onLine }
  };
  // El DSN real vive en el archivo; cada prueba fija el suyo para no depender de él.
  vm.runInNewContext(source.replace(/dsn: '[^']*'/, `dsn: '${dsn}'`), context);
  return { api: window.SmylSentry, appended, listeners, window };
}

test('sin DSN no descarga la librería ni escucha errores', () => {
  const { api, appended, listeners } = load();
  assert.equal(api.enabled, false);
  assert.equal(appended.length, 0);
  assert.equal(listeners.length, 0);
  assert.equal(api.capture(new Error('x')), false);
  assert.equal(api.test(), false);
});

test('con DSN carga la librería propia del repositorio, no un CDN', () => {
  const { api, appended, listeners } = load({ dsn: 'https://abc123@o1.ingest.sentry.io/2' });
  assert.equal(api.enabled, true);
  assert.equal(appended.length, 1);
  assert.match(appended[0].src, /^vendor\/sentry-browser-10\.78\.0\.min\.js\?v=1$/);
  assert.ok(listeners.includes('error') && listeners.includes('unhandledrejection'), 'guarda errores mientras carga');
});

test('scrubText quita correos, teléfonos, tokens, imágenes y fragmentos de URL', () => {
  const { api } = load();
  const scrub = api._scrubText;
  assert.equal(scrub('error de ana.lopez@clinica.mx'), 'error de [correo]');
  assert.equal(scrub('llamar al +52 55 1234 5678'), 'llamar al [teléfono]');
  assert.equal(scrub('Authorization: Bearer abcdefghijklmnop'), 'Authorization: Bearer [token]');
  assert.equal(scrub('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk'), 'jwt [token]');
  assert.equal(scrub('foto data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA'), 'foto [imagen]');
  assert.equal(scrub('abre https://x.github.io/camila/my-smyl-private.html?c=1#access_token=SECRETO ya'),
    'abre https://x.github.io/camila/my-smyl-private.html ya');
  assert.equal(scrub('volver con #access_token=SECRETO&type=magiclink'), 'volver con #access_token=[omitido]&type=magiclink');
  assert.equal(scrub('blob:https://x.github.io/1234-abcd'), '[archivo]');
});

test('los UUID y nombres de archivo de la app se conservan para poder depurar', () => {
  const { api } = load();
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(api._scrubText(`paciente ${id}`), `paciente ${id}`);
  assert.equal(api._scrubText('en smyl-radiograph-review-model-v2.js:123'), 'en smyl-radiograph-review-model-v2.js:123');
});

test('scrubEvent elimina usuario, cookies y cabeceras, y deja sólo un id opaco', () => {
  const { api } = load();
  api.setContext({ userId: 'user-uuid', tenantId: 'clinic-uuid', role: 'dueño' });
  const event = api._scrubEvent({
    message: 'falló con ana@mail.com',
    user: { id: 'u1', email: 'ana@mail.com', username: 'Ana López', ip_address: '1.2.3.4' },
    request: { url: 'https://x/camila/app.html?paciente=Ana#token=zzz', cookies: 'sb=abc', headers: { Authorization: 'Bearer abc' } },
    exception: { values: [{ type: 'TypeError', value: 'Cannot read x de ana@mail.com' }] },
    breadcrumbs: [{ category: 'navigation', data: { from: '/a?x=1#h', to: '/b#secret' } }],
    extra: { nombre: 'Ana López', email: 'ana@mail.com', nota: 'tel 55 1234 5678' }
  });
  assert.deepEqual(plain(event.user), { id: 'u1' });
  assert.deepEqual(plain(event.request), { url: 'https://x/camila/app.html' });
  assert.equal(event.message, 'falló con [correo]');
  assert.equal(event.exception.values[0].type, 'TypeError');
  assert.equal(event.exception.values[0].value, 'Cannot read x de [correo]');
  assert.deepEqual(plain(event.breadcrumbs[0].data), { from: '/a', to: '/b' });
  assert.equal(event.extra.nombre, '[omitido]');
  assert.equal(event.extra.email, '[omitido]');
  assert.equal(event.extra.nota, 'tel [teléfono]');
  assert.equal(event.tags.clinic, 'clinic-uuid');
  assert.equal(event.tags.role, 'dueño');
  assert.doesNotMatch(JSON.stringify(event), /ana@mail|Ana López|1\.2\.3\.4|Bearer|zzz/);
});

test('scrubEvent no estropea los metadatos del evento (versión, entorno, ids)', () => {
  const { api } = load();
  const event = api._scrubEvent({ release: 'smyl-web@2026-11-08', environment: 'production', event_id: 'bf1d285cfc2449b28e4d647cb8099a50', timestamp: 1794114530.37, sdk: { name: 'sentry.javascript.browser', version: '10.78.0' } });
  assert.equal(event.release, 'smyl-web@2026-11-08');
  assert.equal(event.environment, 'production');
  assert.equal(event.event_id, 'bf1d285cfc2449b28e4d647cb8099a50');
  assert.equal(event.timestamp, 1794114530.37);
  assert.equal(event.sdk.version, '10.78.0');
});

test('las migas de pan no guardan consola ni lo escrito en campos', () => {
  const { api } = load();
  assert.equal(api._scrubBreadcrumb({ category: 'console', message: 'nombre del paciente' }), null);
  assert.equal(api._scrubBreadcrumb({ category: 'ui.input', message: 'input#nombre' }), null);
  assert.deepEqual(plain(api._scrubBreadcrumb({ category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/pacientes?select=*&nombre=eq.Ana', status_code: 200 } }).data),
    { url: 'https://x.supabase.co/rest/v1/pacientes', status_code: 200 });
});

test('beforeSend descarta ruido, repeticiones y pasa un tope por página', () => {
  const { api } = load();
  const make = (value) => ({ exception: { values: [{ type: 'Error', value, stacktrace: { frames: [{ filename: 'a.js', lineno: 1 }] } }] } });
  assert.equal(api._beforeSend(make('ResizeObserver loop completed with undelivered notifications.'), {}), null);
  assert.equal(api._beforeSend({ message: 'Script error.' }, {}), null);
  assert.ok(api._beforeSend(make('falla A'), {}));
  assert.equal(api._beforeSend(make('falla A'), {}), null, 'misma falla en 60 s');
  let sent = 0;
  for (let i = 0; i < 100; i += 1) if (api._beforeSend(make(`falla ${i} distinta`), {})) sent += 1;
  assert.ok(sent <= 29, `tope por página, enviados ${sent}`);
});

test('sin conexión no se reportan errores de red', () => {
  const { api } = load({ onLine: false });
  assert.equal(api._beforeSend({ message: 'Failed to fetch' }, {}), null);
});

test('el DSN guardado en el código tiene forma de DSN de Sentry (o está vacío)', () => {
  const dsn = source.match(/dsn: '([^']*)'/)[1];
  assert.ok(dsn !== '', 'Sentry está activado en producción');
  assert.ok(dsn === '' || /^https:\/\/[0-9a-f]+@o\d+\.ingest(\.[a-z]+)?\.sentry\.io\/\d+$/.test(dsn), `DSN inesperado: ${dsn}`);
});

test('las pantallas cargan Sentry justo después de la protección de privacidad', () => {
  for (const file of ['app.html', 'index.html', 'simulacion.html', 'simulacion-rapida.html', 'editor-v2.html']) {
    assert.match(read(file), /<script src="smyl-browser-privacy\.js\?v=1"><\/script>\n<script src="smyl-sentry\.js\?v=3"><\/script>/, `${file} no carga smyl-sentry.js`);
  }
});

test('app.html pasa sólo identificadores opacos a Sentry', () => {
  const html = read('app.html');
  assert.match(html, /window\.SmylSentry\.setContext\(\{ userId: authUser\.id, tenantId: tenantId, role: miRolEquipo \}\)/);
  assert.doesNotMatch(html, /SmylSentry\.setContext\([^)]*email/);
});

test('el service worker precachea Sentry y no intercepta el envío de eventos', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\/camila\/smyl-sentry\.js\?v=3'/);
  assert.match(sw, /'\/camila\/vendor\/sentry-browser-10\.78\.0\.min\.js\?v=1'/);
  assert.match(sw, /url\.includes\('sentry\.io'\)/);
});

test('la librería vendida declara su versión y licencia', () => {
  const lib = read('vendor/sentry-browser-10.78.0.min.js');
  assert.match(lib.split('\n')[0], /@sentry\/browser 10\.78\.0 \(MIT/);
  assert.match(lib, /SmylSentryLib/);
  assert.ok(fs.existsSync(path.join(root, 'vendor/sentry-browser.LICENSE')));
});

test('web y móvil quedan sincronizados', () => {
  for (const file of ['smyl-sentry.js', 'vendor/sentry-browser-10.78.0.min.js', 'app.html', 'simulacion.html', 'simulacion-rapida.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
