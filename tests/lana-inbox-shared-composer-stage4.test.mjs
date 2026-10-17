import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const css = read('../smyl-inbox.css');
const mobileCss = read('../mobile/www/smyl-inbox.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('conversation drafts are session-scoped ciphertext, never plain clinical text', () => {
  assert.match(inbox, /smyl:inbox:encrypted-drafts:v1/);
  assert.match(inbox, /AES-GCM/);
  assert.match(inbox, /ciphertext: base64Bytes/);
  assert.match(inbox, /expires_at: Date\.now\(\) \+ 7 \* 86400000/);
  assert.doesNotMatch(inbox, /localStorage/);
  assert.doesNotMatch(inbox, /sessionStorage\.setItem\([^,]+,\s*(content|payload)/);
});

test('emoji inserts into the reviewed composer without sending', () => {
  assert.match(inbox, /Agregar emoji/);
  assert.match(inbox, /input\.selectionStart/);
  assert.match(inbox, /scheduleDraftSave\(input\.value\)/);
  assert.doesNotMatch(inbox, /openEmojiDialog[\s\S]{0,1000}submitMessage/);
});

test('voice notes require WhatsApp, a compatible recording format and explicit send', () => {
  assert.match(inbox, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(inbox, /audio\/ogg;codecs=opus/);
  assert.match(inbox, /conversation\.channel !== 'whatsapp'/);
  assert.match(inbox, /chooseAttachment\(file\)/);
  assert.match(inbox, /aria-pressed/);
  assert.doesNotMatch(inbox, /recorder\.onstop[\s\S]{0,900}sendAttachment/);
});

test('stage 4 ships synchronized web, mobile and PWA assets', () => {
  assert.match(app, /smyl-inbox\.js\?v=26/);
  assert.match(app, /smyl-inbox\.css\?v=21/);
  assert.match(worker, /smyl-v252-visual-policy-v2/);
  assert.equal(inbox, mobileInbox);
  assert.equal(css, mobileCss);
});
