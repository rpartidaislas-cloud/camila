import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.html');
const client = read('smyl-lana-attention.js');
const styles = read('smyl-lana-attention.css');
const edge = read('supabase/functions/lana-attention/index.ts');
const sw = read('sw.js');

test('dashboard loads the stage 6 attention workspace', () => {
  assert.match(app, /smyl-lana-attention\.css\?v=1/);
  assert.match(app, /smyl-lana-attention\.js\?v=4/);
  assert.match(app, /SmylLanaAttention\.load\(true\)/);
  assert.match(client, /ATENCIÓN OMNICANAL/);
  assert.match(client, /Conversaciones que necesitan a tu equipo/);
  assert.match(client, /Abrir conversación/);
  assert.match(client, /SmylInbox\.open\(item\.id\)/);
  assert.match(client, /Preparar expediente/);
  assert.match(styles, /lana-attention-metrics/);
  assert.match(styles, /@media\(max-width:760px\)/);
});

test('client discloses the privacy boundary and does not render chat content', () => {
  assert.match(client, /historial se mantiene protegido en la infraestructura de mensajería/);
  assert.doesNotMatch(client, /ultimo_mensaje|resumen_asesor|whatsapp_mensajes|meta_mensajes/);
});

test('SMYL edge requires a professional session and owner-only resolution', () => {
  assert.match(edge, /requireUser\(req, CORS\)/);
  assert.match(edge, /const canResolve = auth\.user\.id === auth\.tenantId/);
  assert.match(edge, /if \(!canResolve\) return json\(403/);
  assert.match(edge, /\/attention\?limit=40/);
  assert.match(edge, /camila_lana_handoffs/);
  assert.doesNotMatch(edge, /whatsapp_mensajes|meta_mensajes/);
});

test('PWA precaches stage 6 attention assets in the current inbox cache', () => {
  assert.match(sw, /smyl-v248-patient-record-simple/);
  assert.match(sw, /smyl-lana-attention\.js\?v=4/);
  assert.match(sw, /smyl-lana-attention\.css\?v=1/);
});
