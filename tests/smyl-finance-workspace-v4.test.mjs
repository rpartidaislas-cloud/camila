import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('smyl-finance.js');
const css = read('smyl-finance.css');

test('Finanzas abre en Por cobrar y separa las tareas por destino', () => {
  assert.match(js, /tab:'accounts'/);
  assert.match(js, /accountFilter:'open'/);
  assert.match(js, / vencido<\/b>'/);
  assert.match(js, /Hacer corte/);
  assert.match(js, /credit:'Saldos a favor'/);
  assert.match(js, /Saldos? a favor/);
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
  assert.match(js, /<h2>Citas atendidas sin cobrar <em>/);
  assert.match(js, />Registrar cargo<\/button>/);
  assert.match(js, /ACCOUNT_TITLES=\{open:'Cuentas con saldo',overdue:'Cuentas vencidas'/);
  assert.doesNotMatch(js, /CITAS ATENDIDAS|<span>CUENTAS<\/span>|Pendientes de registrar|Cuentas de pacientes/);
  assert.match(js, /Ningún cobro se realiza automáticamente/);
});

test('PWA conserva los filtros en una sola fila desplazable y las pestañas en dos columnas', () => {
  const block = css.slice(css.indexOf('/* Cobros workspace v4'));
  assert.ok(block.length > 0);
  assert.match(css, /@media\(max-width:560px\)\{\s*#p-caja \.finance-tabcards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(block, /\.finance-account-filters\{[\s\S]*?display:flex!important;[\s\S]*?overflow-x:auto!important/);
  assert.match(block, /grid-template-areas:\"identity amount\" \"context context\" \"action action\"/);
  assert.match(js, /selectedFilter\.scrollIntoView\(\{block:'nearest',inline:'center'\}\)/);
  assert.match(js, /<div class="finance-account-filters"><button type="button" data-account-filter="open" aria-pressed="true">Pendientes <em><\/em><\/button><button type="button" data-account-filter="overdue">Vencidas/);
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 12);
  assert.equal(tiny.length, 0);
});

test('web y PWA publican los mismos archivos y versiones del workspace', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) {
    assert.equal(read('mobile/www/' + file), read(file), file);
  }
  assert.match(read('app.html'), /smyl-finance\.css\?v=48/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=64/);
  assert.match(read('sw.js'), /finance-workspace-v4/);
  assert.match(read('sw.js'), /finanzas-workspace-v5/);
});
