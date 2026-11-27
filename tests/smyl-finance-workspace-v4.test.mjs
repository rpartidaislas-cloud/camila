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
  assert.match(js, /creditOnly\?'<strong data-tone="ok">'\+money\(s\.creditCents\/100\)\+'<\/strong><small>a favor<\/small>'/);
  assert.match(js, /settled\?'<strong data-tone="quiet">'\+money\(0\)\+'<\/strong><small>liquidada<\/small>'/);
  // Una sola acción por fila: «Cobrar» si hay saldo y el rol puede cobrar; si no, «Ver cuenta». El nombre también abre la cuenta.
  assert.match(js, /debt&&state\.canManage\?'<button type="button" class="btn btn-secondary" data-account-pay=/);
  assert.match(js, /:'<button type="button" class="btn btn-secondary" data-account="'\+id\+'" aria-label="Ver la cuenta de '\+label\+'">Ver cuenta<\/button>'/);
  assert.match(js, /<button type="button" class="finance-line-who" data-account="'\+id\+'" title="Abrir la cuenta">/);
  assert.match(js, /class=\"finance-row-menu\"/);
  assert.match(js, /<button type=\"button\" data-chat=/);
  assert.match(js, /menu\.length\?'<details class=\"finance-row-menu\"/, 'no debe mostrarse un menú secundario vacío');
});

test('visitas y cuentas se presentan como responsabilidades distintas', () => {
  assert.match(js, /<h2>Citas atendidas sin cobrar <em>/);
  assert.match(js, />Registrar cargo<\/button>/);
  assert.match(js, /ACCOUNT_TITLES=\{open:'Cuentas con saldo',overdue:'Cuentas vencidas'/);
  assert.doesNotMatch(js, /CITAS ATENDIDAS|<span>CUENTAS<\/span>|Pendientes de registrar|Cuentas de pacientes/);
  assert.match(js, /Registra lo que se hizo o márcala sin costo\. Nada se cobra solo\./);
});

test('en celular las cuatro vistas quedan a la vista (en dos pares) y las pestañas en dos columnas', () => {
  const block = css.slice(css.indexOf('/* Finanzas v6 · paso 2'));
  assert.ok(block.length > 0);
  assert.match(css, /@media\(max-width:560px\)\{\s*#p-caja \.finance-tabcards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(block, /@media\(max-width:420px\)\{[\s\S]*?#p-caja \.finance-chips\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(block, /grid-template-areas:"who amount" "paid actions"/);
  assert.doesNotMatch(block, /\.finance-chips\{[^}]*overflow-x:auto/, 'las vistas no se esconden tras un deslizamiento');
  assert.doesNotMatch(js, /scrollIntoView\(\{block:'nearest',inline:'center'\}\)/);
  assert.match(js, /<div class="finance-chips" role="group" aria-label="Vistas de cuentas"><button type="button" data-account-filter="open" aria-pressed="true">Con saldo <em><\/em><\/button><button type="button" data-account-filter="overdue" aria-pressed="false">Vencidas/);
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 12);
  assert.equal(tiny.length, 0);
});

test('web y PWA publican los mismos archivos y versiones del workspace', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) {
    assert.equal(read('mobile/www/' + file), read(file), file);
  }
  assert.match(read('app.html'), /smyl-finance\.css\?v=60/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=83/);
  assert.match(read('sw.js'), /finance-workspace-v4/);
  assert.match(read('sw.js'), /finanzas-workspace-v5/);
});
