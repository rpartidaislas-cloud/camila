import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const mobile = read('../mobile/www/app.html');
const styles = read('../smyl-ui-template-v3.css');
const worker = read('../sw.js');

test('el pie identifica a LANA como proveedor de tecnología de Meta', () => {
  assert.match(app, /Mensajería con LANA · Proveedor de tecnología de Meta/);
  assert.match(app, /class="app-meta-provider-mark"/);
  assert.match(app, /href="https:\/\/www\.get-lana\.com"/);
  assert.match(app, /rel="noopener noreferrer"/);
  assert.doesNotMatch(app, /SMYL[^<]{0,40}(?:certificado|verificado) por Meta/i);
});

test('la atribución es discreta, accesible y se distribuye en la PWA', () => {
  assert.match(styles, /\.app-meta-provider:focus-visible/);
  assert.match(styles, /\.app-meta-provider-mark/);
  assert.match(styles, /fill:\s*#0866ff/);
  assert.match(worker, /smyl-ui-template-v3\.css\?v=9/);
  assert.match(worker, /lana-meta-attribution-v1/);
  assert.equal(app, mobile);
  assert.equal(styles, read('../mobile/www/smyl-ui-template-v3.css'));
});
