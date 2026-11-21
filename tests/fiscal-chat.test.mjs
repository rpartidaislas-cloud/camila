import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as chat from '../supabase/functions/_shared/fiscal-chat.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const inbox = read('supabase/functions/lana-inbox/index.ts');
const capture = read('smyl-fiscal-capture.js');

test('el tipo del archivo del chat se decide por su firma: solo PDF, PNG o JPG', () => {
  assert.equal(chat.tipoPorFirma(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])), 'application/pdf');
  assert.equal(chat.tipoPorFirma(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'image/png');
  assert.equal(chat.tipoPorFirma(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1])), 'image/jpeg');
  assert.equal(chat.tipoPorFirma(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), null, 'un .docx/.zip se rechaza');
  assert.equal(chat.bytesABase64(new TextEncoder().encode('hola')), 'aG9sYQ==');
});

test('solo se descargan direcciones https públicas', () => {
  assert.equal(chat.urlDescargable('https://cdn.ejemplo.mx/archivo.pdf'), true);
  for (const url of ['http://cdn.ejemplo.mx/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://u:p@ejemplo.mx/a', 'https://[::1]/a', 'https://servidor.internal/a', 'nada']) {
    assert.equal(chat.urlDescargable(url), false, url);
  }
  assert.equal(chat.esArchivoFiscal({ media_type: 'image', media_url: 'https://x.mx/a' }), true);
  assert.equal(chat.esArchivoFiscal({ media_type: 'audio', media_url: 'https://x.mx/a' }), false);
  assert.equal(chat.esArchivoFiscal({ media_type: 'document', media_url: 'https://x.mx/a', deleted: true }), false);
});

test('lana-inbox valida conversación, paciente y permiso antes de leer un archivo del chat', () => {
  const fn = inbox.slice(inbox.indexOf('async function fiscalDocumentFromChat'), inbox.indexOf('const INBOX_PRIORITIES'));
  assert.match(fn, /String\(handoff\.patient_id\) !== patientId/, 'el chat debe estar vinculado a ese paciente');
  assert.match(fn, /\/inbox\/conversations\/\$\{conversationId\}\/messages\/\$\{id\}/, 'el mensaje se consulta en LANA, no se confía en el navegador');
  assert.match(fn, /urlDescargable\(message\?\.media_url\)/);
  assert.match(fn, /MAX_CHAT_FILE_BYTES/);
  assert.match(fn, /tipoPorFirma\(bytes\)/);
  assert.match(fn, /functions\/v1\/fiscal-extract/, 'reutiliza fiscal-extract: permiso, topes y créditos de IA');
  assert.doesNotMatch(fn, /\.insert\(|\.upsert\(|storage/, 'el archivo no se guarda');
  const route = inbox.slice(inbox.indexOf('if (action === "fiscal_document")'), inbox.indexOf('if (action === "rewrite_message")'));
  assert.match(route, /requirePermission\(actor, "finance\.manage"/);
  assert.ok(inbox.indexOf('if (!await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();') < inbox.indexOf('if (action === "fiscal_document")'), 'el alcance de la conversación se valida antes');
});

test('el formulario ofrece «Elegir del chat» solo con chat vinculado y aplica la lectura igual que al subir', () => {
  assert.match(capture, /data-fiscal-chat hidden>Elegir del chat</);
  assert.match(capture, /if \(!r\.error && r\.count\) chatButton\.hidden = false;/);
  assert.match(capture, /action: 'fiscal_document', conversation_id: item\.conversation_id, patient_id: patientId, message_id: item\.id/);
  assert.match(capture, /try \{ applyExtract\(await extract\(file, options\.patientId\)\); \}/);
  assert.match(capture, /try \{ applyExtract\(await extractFromChat\(options\.patientId, item\)\); \}/);
});
