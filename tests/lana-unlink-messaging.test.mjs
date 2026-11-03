import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');

const edge = read('supabase/functions/lana-connection/index.ts');
const channels = read('supabase/functions/lana-channels/index.ts');
const ui = read('smyl-connections.js');
const css = read('smyl-connections.css');

function handler(action) {
  const start = edge.indexOf(`if (action === "${action}") {`);
  assert.notEqual(start, -1, `falta la acción ${action}`);
  const rest = edge.slice(start + 10);
  const next = rest.search(/\n    if \(action === "/);
  return edge.slice(start, next === -1 ? edge.length : start + 10 + next);
}

test('desvincular es sólo para el dueño y es idempotente', () => {
  const body = handler('disconnect');
  assert.match(body, /if \(!canManage\) return json\(403,/);
  assert.match(body, /if \(!lana\) return json\(200, \{ ok: true, unlinked: false/);
  assert.match(body, /await unlinkLanaConfig\(auth\.tenantId, config, lana, auth\.user\.id\)/);
});

test('desvincular no llama a LANA ni a Meta: sólo olvida el enlace en SMYL', () => {
  const body = handler('disconnect');
  assert.doesNotMatch(body, /fetch\(|lanaRequest|LANA_API_BASE|DELETE/);
  const fn = edge.slice(edge.indexOf('async function unlinkLanaConfig('), edge.indexOf('async function verifyLanaApiKey('));
  assert.doesNotMatch(fn, /fetch\(|lanaRequest|LANA_API_BASE/);
  assert.match(fn, /const \{ lana: _removed, \.\.\.remaining \}/, 'el enlace activo deja de existir en integraciones.lana');
  assert.match(fn, /lana_desvinculada: \{ \.\.\.lana, estado: "desvinculada", desvinculada_at: now, desvinculada_por: actorId \}/,
    'el enlace cifrado se aparta para poder restaurarlo, con quién y cuándo');
  assert.match(fn, /\.update\(\{ config: next \}\)\.eq\("id", tenantId\)/);
});

test('la respuesta de desvincular no expone credenciales y el estado queda pendiente', () => {
  const body = handler('disconnect');
  assert.match(body, /\.\.\.publicStatus\(null, canManage\)/);
  assert.doesNotMatch(body, /api_key|ciphertext|iv\b/);
  const status = edge.slice(edge.indexOf('function publicStatus('), edge.indexOf('async function provisionRequest('));
  assert.doesNotMatch(status, /api_key|ciphertext|api_key_iv/);
  assert.match(edge, /function readLanaConfig[\s\S]*?\(integrations as Record<string, unknown>\)\.lana;/,
    'sólo integraciones.lana cuenta como enlace activo; lana_desvinculada se ignora');
});

test('queda auditoría sin secretos y el fallo de auditoría no bloquea la desvinculación', () => {
  const fn = edge.slice(edge.indexOf('async function unlinkLanaConfig('), edge.indexOf('async function verifyLanaApiKey('));
  assert.match(fn, /from\("smyl_audit_events"\)\.insert\(/);
  assert.match(fn, /entity_type: "lana_link"/);
  assert.match(fn, /entity_id: lana\.fingerprint/);
  const audit = fn.slice(fn.indexOf('smyl_audit_events'));
  assert.doesNotMatch(audit, /api_key_ciphertext|api_key_iv/);
  assert.match(fn, /if \(audit\.error\) console\.error/);
});

test('el servidor sigue bloqueando la revocación de WhatsApp canal por canal', () => {
  assert.match(channels, /if \(selected === "whatsapp"\) return json\(409,/);
});

test('la interfaz ofrece Desvincular en la tarjeta y en la fila de WhatsApp, con confirmación', () => {
  assert.match(ui, /data-unlink-lana>Desvincular mensajería<\/button>/);
  assert.match(ui, /data-unlink-dialog/);
  assert.match(ui, /data-unlink-confirm/);
  assert.match(ui, /var canUnlink = connected && name === 'whatsapp' && owner;/);
  assert.match(ui, /canUnlink \? 'Desvincular'/);
  assert.match(ui, /dataset\.channelAction === 'unlink'[\s\S]*?openUnlinkDialog\(\)/);
  assert.match(ui, /request\('disconnect'\)/);
  assert.match(ui, /page\.querySelector\('\[data-unlink-confirm\]'\)\.addEventListener\('click', confirmUnlink\)/);
  assert.match(css, /connections-unlink-button/);
});

test('Messenger e Instagram conservan su desconexión canal por canal y WhatsApp no la usa', () => {
  assert.match(ui, /var canDisconnect = connected && name !== 'whatsapp' && owner;/);
  assert.match(ui, /channelRequest\('POST', \{ action: 'disconnect', channel: channel \}\)/);
});

test('el diálogo explica que no se borra nada y no muestra el nombre del motor', () => {
  const dialog = ui.slice(ui.indexOf('data-unlink-dialog'), ui.indexOf('data-unlink-confirm'));
  assert.match(dialog, /No se borra ninguna cuenta ni conversación/);
  assert.match(dialog, /Podrás volver a vincular cuando quieras/);
  assert.doesNotMatch(dialog, /\bLANA\b/);
  const done = ui.match(/var done = '([^']*)'/);
  assert.ok(done && !/LANA/.test(done[1]));
});

test('tras timeout se reconcilia el estado real en vez de asumir un fallo', () => {
  const fn = ui.slice(ui.indexOf('async function confirmUnlink()'), ui.indexOf('function contextStatus('));
  assert.match(fn, /error\.isTimeout[\s\S]*?reconcileConnectionStatus\(\)[\s\S]*?!reconciled\.connected && reconciled\.estado === 'pendiente'/);
});

test('las ventanas de desconexión se centran aunque el reseteo global quite margin:auto', () => {
  assert.match(css, /\.connections-disconnect-dialog\{position:fixed;inset:0;margin:auto;height:fit-content;/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.connections-disconnect-dialog\[open\]\{animation:none\}\}/);
  assert.match(read('app.html'), /\*\{box-sizing:border-box;margin:0;padding:0\}/, 'si el reseteo cambia, revisar el centrado');
});

test('web y móvil quedan sincronizados', () => {
  for (const file of ['smyl-connections.js', 'smyl-connections.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
