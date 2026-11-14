import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('smyl-finance.js');
const css = read('smyl-finance.css');

test('Cobros abre en saldos pendientes y separa las tareas por destino', () => {
  assert.match(js, /accountFilter:'open'/);
  for (const filter of ['overdue', 'credit', 'cash']) {
    assert.match(js, new RegExp(`data-finance-alert-filter=\\"${filter}\\"`));
  }
  assert.match(js, /Corte pendiente/);
  assert.match(js, /Saldos? a favor/);
  assert.match(js, /Cuentas? vencidas?/);
});

test('la cartera distingue deuda, crédito y liquidación con una sola acción principal', () => {
  assert.match(js, /creditOnly\?'\+'\+money\(s\.credit\)/);
  assert.match(js, /amountLabel=hasDebt\?'Por cobrar':creditOnly\?'Saldo a favor'/);
  assert.match(js, /settled\?'Sin saldo':'—'/);
  assert.match(js, /class=\"finance-account-open\" data-account=/);
  assert.match(js, /class=\"finance-row-menu\"/);
  assert.match(js, /<button type=\"button\" data-chat=/);
  assert.match(js, /menu\.length\?'<details class=\"finance-row-menu\"/, 'no debe mostrarse un menú secundario vacío');
});

test('visitas y cuentas se presentan como responsabilidades distintas', () => {
  assert.match(js, /Pendientes de registrar/);
  assert.match(js, /CITAS ATENDIDAS/);
  assert.match(js, /Cuentas de pacientes/);
  assert.match(js, /CUENTAS/);
  assert.match(js, /Ningún cobro se realiza automáticamente/);
});

test('PWA conserva pestañas y filtros en una sola fila desplazable', () => {
  const block = css.slice(css.indexOf('/* Cobros workspace v4'));
  assert.ok(block.length > 0);
  assert.match(block, /\.finance-tabs\{[\s\S]*?display:flex!important;[\s\S]*?overflow-x:auto!important/);
  assert.match(block, /\.finance-account-filters\{[\s\S]*?display:flex!important;[\s\S]*?overflow-x:auto!important/);
  assert.match(block, /grid-template-areas:\"identity amount\" \"context context\" \"action action\"/);
  assert.match(js, /selectedFilter\.scrollIntoView\(\{block:'nearest',inline:'center'\}\)/);
  assert.match(js, /filters\.prepend\(pending\)/);
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 12);
  assert.equal(tiny.length, 0);
});

test('web y PWA publican los mismos archivos y versiones del workspace', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) {
    assert.equal(read('mobile/www/' + file), read(file), file);
  }
  assert.match(read('app.html'), /smyl-finance\.css\?v=30/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=37/);
  assert.match(read('sw.js'), /finance-workspace-v4/);
});
