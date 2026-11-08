import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const workerSource = read('smyl-freeze-watchdog-worker.js');
const pageSource = read('smyl-freeze-watchdog.js');

const ENDPOINT = 'https://o1.ingest.us.sentry.io/api/2/envelope/?sentry_key=abc123&sentry_version=7';

// Worker con reloj y red falsos: se avanza el tiempo a mano.
function loadWorker() {
  let clock = 1_000_000;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const fetched = [];
  const timers = [];
  const self = {};
  const context = {
    self, Date: FakeDate, Math, JSON, Number, String, Boolean, isFinite, RegExp,
    setInterval: (fn) => timers.push(fn),
    fetch: (url, options) => { fetched.push({ url, options, events: options.body.split('\n').slice(2).map((l) => JSON.parse(l)) }); return Promise.resolve(); }
  };
  vm.runInNewContext(workerSource, context);
  const send = (data) => self.onmessage({ data });
  const advance = (ms) => { for (let spent = 0; spent < ms; spent += 1000) { clock += 1000; timers.forEach((fn) => fn()); } };
  const snap = { route: 'p-paciente-detalle', lastAction: 'div.pat-row', lastActionAgoS: 1.2, mutationsPerSecond: 5000, mutationTarget: 'div#p-paciente-detalle', online: true };
  send({ type: 'init', endpoint: ENDPOINT, dsn: 'https://abc123@o1.ingest.us.sentry.io/2', release: 'smyl-web@x', environment: 'production', platform: 'web', page: 'app.html', userId: 'u1', clinic: 'c1', role: 'dueño' });
  const jump = (ms) => { clock += ms; };
  return { send, advance, jump, fetched, snap };
}

test('si los latidos siguen llegando no avisa', () => {
  const { send, advance, fetched, snap } = loadWorker();
  for (let i = 0; i < 20; i += 1) { advance(1000); send({ type: 'ping', snapshot: snap }); }
  assert.equal(fetched.length, 0);
});

test('sin latidos durante 6 s avisa una sola vez, con lo que pasaba en la pantalla', () => {
  const { send, advance, fetched, snap } = loadWorker();
  send({ type: 'ping', snapshot: snap });
  advance(5000);
  assert.equal(fetched.length, 0, 'todavía no llega al umbral');
  advance(3000);
  advance(20000);
  assert.equal(fetched.length, 1, 'un solo aviso por congelamiento');
  const [event] = fetched[0].events;
  assert.equal(fetched[0].url, ENDPOINT);
  assert.equal(event.tags.outcome, 'ongoing');
  assert.equal(event.tags.route, 'p-paciente-detalle');
  assert.equal(event.extra.domMutationsPerSecond, 5000);
  assert.equal(event.extra.domMutationTarget, 'div#p-paciente-detalle');
  assert.deepEqual(event.fingerprint, ['smyl-freeze', 'app.html', 'p-paciente-detalle']);
  assert.equal(event.user.id, 'u1');
  assert.equal(event.tags.clinic, 'c1');
});

test('los mensajes de estado durante el bucle no cuentan como latido', () => {
  const { send, advance, fetched, snap } = loadWorker();
  send({ type: 'ping', snapshot: snap });
  for (let i = 0; i < 8; i += 1) { advance(1000); send({ type: 'state', snapshot: snap }); }
  assert.equal(fetched.length, 1);
});

test('al recuperarse manda un segundo aviso agrupado con el mismo problema', () => {
  const { send, advance, fetched, snap } = loadWorker();
  send({ type: 'ping', snapshot: snap });
  advance(9000);
  send({ type: 'ping', snapshot: snap });
  assert.equal(fetched.length, 2);
  const [first, second] = fetched.map((f) => f.events[0]);
  assert.equal(second.tags.outcome, 'recovered');
  assert.ok(second.extra.secondsWithoutResponse >= 9);
  assert.deepEqual(second.fingerprint, first.fingerprint);
});

test('con la pestaña oculta no avisa y al volver empieza de cero', () => {
  const { send, advance, fetched, snap } = loadWorker();
  send({ type: 'ping', snapshot: snap });
  send({ type: 'visibility', visible: false });
  advance(30000);
  assert.equal(fetched.length, 0);
  send({ type: 'visibility', visible: true });
  advance(3000);
  assert.equal(fetched.length, 0);
});

test('si el equipo se durmió (el propio Worker se atrasó) no es un congelamiento', () => {
  const { send, advance, jump, fetched, snap } = loadWorker();
  send({ type: 'ping', snapshot: snap });
  advance(2000);
  jump(60000);       // el equipo estuvo suspendido: ningún temporizador corrió
  advance(1000);     // el primer tick tras despertar ve el salto
  advance(3000);
  assert.equal(fetched.length, 0);
});

test('máximo 3 avisos por carga de página y 30 s entre ellos', () => {
  const { send, advance, fetched, snap } = loadWorker();
  for (let round = 0; round < 6; round += 1) {
    send({ type: 'ping', snapshot: snap });
    advance(40000);
    send({ type: 'ping', snapshot: snap });
  }
  const ongoing = fetched.filter((f) => f.events[0].tags.outcome === 'ongoing').length;
  assert.equal(ongoing, 3);
});

test('el Worker sólo acepta un endpoint de ingestión de Sentry y filtra lo que recibe', () => {
  const { send, advance, fetched, snap } = loadWorker();
  send({ type: 'init', endpoint: 'https://evil.example.com/collect', dsn: 'x' });
  send({ type: 'ping', snapshot: snap });
  advance(10000);
  assert.equal(fetched.length, 0, 'endpoint no válido: no envía nada');

  const ok = loadWorker();
  ok.send({ type: 'ping', snapshot: { ...ok.snap, lastAction: 'button "Ana López" <script>', route: 'pantalla con espacios y <b>html</b>' } });
  ok.advance(9000);
  const event = ok.fetched[0].events[0];
  assert.doesNotMatch(JSON.stringify(event), /Ana|López|<|"Ana/);
  assert.equal(event.extra.lastAction, '[omitido]');
  assert.equal(event.tags.route, '[omitido]');
  assert.equal(event.release, 'smyl-web@x');
  assert.equal(event.tags.role, 'dueño');
});

test('la página sólo manda selectores y contadores, nunca texto', () => {
  assert.doesNotMatch(pageSource, /textContent|innerText|innerHTML|\.value\b|location\.(search|hash|href)/);
  assert.match(pageSource, /type: 'ping'|post\('ping'/);
  assert.match(pageSource, /new Worker\('smyl-freeze-watchdog-worker\.js\?v=1'\)/);
});

test('smyl-sentry.js carga el vigilante sólo con DSN y lo expone con config()', () => {
  const sentry = read('smyl-sentry.js');
  assert.match(sentry, /watchdog: 'smyl-freeze-watchdog\.js\?v=1'/);
  assert.match(sentry, /if \(!dsn\) return;[\s\S]*loadFreezeWatchdog\(\)/);
  assert.match(sentry, /config: function \(\)/);
});

test('sw.js precachea el vigilante y web y móvil quedan sincronizados', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\/camila\/smyl-freeze-watchdog\.js\?v=1'/);
  assert.match(sw, /'\/camila\/smyl-freeze-watchdog-worker\.js\?v=1'/);
  for (const file of ['smyl-sentry.js', 'smyl-freeze-watchdog.js', 'smyl-freeze-watchdog-worker.js', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
