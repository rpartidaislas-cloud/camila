import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const finance = read('../smyl-finance.css');
const reports = read('../smyl-reports.css');
const financeScript = read('../smyl-finance.js');
const reportsScript = read('../smyl-reports.js');

test('Clinical Workspace v3.3 mantiene intactos los contratos financieros y ejecutivos', () => {
  assert.match(financeScript, /rpc\('smyl_post_charge'/);
  assert.match(financeScript, /rpc\('smyl_post_payment'/);
  assert.match(financeScript, /rpc\('smyl_refund_payment'/);
  assert.match(financeScript, /smyl_cfdi_readiness_report/);
  assert.match(reportsScript, /rpc\('smyl_executive_dashboard'/);
  assert.match(reportsScript, /exportCsv/);
});

test('Finanzas usa un contenedor seguro, jerarquía legible y una acción primaria visible', () => {
  assert.match(finance, /Clinical Workspace v3\.3 · Finanzas/);
  assert.match(finance, /container:finance-workspace\/inline-size/);
  assert.match(finance, /\.finance-page\{[\s\S]*?max-width:1440px;min-width:0;overflow:clip/);
  assert.match(finance, /\.finance-head \.pro-eyebrow,[^{]+\{font-size:12px/);
  assert.match(finance, /\.finance-head h1\{font-size:clamp\(26px,2\.2vw,32px\)/);
  assert.match(finance, /\.finance-head-actions \.btn-primary\{box-shadow:/);
  assert.match(finance, /\.finance-metrics article\{min-height:112px/);
});

test('Finanzas normaliza objetivos táctiles, estados, tablas y foco', () => {
  assert.match(finance, /\.finance-page :where\(button,[^}]+\{min-height:42px;font-size:13px\}/);
  assert.match(finance, /\.finance-page :where\(button,[^}]+:focus-visible\{outline:3px solid/);
  assert.match(finance, /\.finance-empty,\.finance-restricted\{[^}]*min-height:152px/);
  assert.match(finance, /\.finance-notice\{min-height:50px/);
  assert.match(finance, /\.finance-row-head\{min-height:42px;font-size:12px/);
  assert.match(finance, /\.finance-tabs button\{flex:0 0 auto;min-height:42px/);
  assert.match(finance, /\.finance-focus-list span,[^{]+\{font-size:12px/);
  assert.match(finance, /\.finance-payment-check-head span,[^{]+\{font-size:12px/);
  assert.match(finance, /@media screen and \(max-width:720px\)[\s\S]*?min-height:44px/);
  assert.match(finance, /\.finance-tabs\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);width:100%;overflow:visible\}/);
  assert.match(finance, /grid-template-areas:"identity action" "amount amount"/);
});

test('Reportes usa una escala ejecutiva consistente y datos escaneables', () => {
  assert.match(reports, /Clinical Workspace v3\.3 · Reportes/);
  assert.match(reports, /container:reports-workspace\/inline-size/);
  assert.match(reports, /\.reports-page\{[\s\S]*?max-width:1440px;min-width:0;overflow:clip/);
  assert.match(reports, /\.reports-head \.pro-eyebrow\{font-size:12px/);
  assert.match(reports, /\.reports-metrics article\{min-height:112px/);
  assert.match(reports, /\.reports-card h2\{font-size:19px/);
  assert.match(reports, /\.reports-brief-list span,[^{]+\{font-size:12px/);
  assert.match(reports, /\.reports-row-head\{min-height:42px;font-size:12px/);
});

test('Reportes normaliza filtros, estados, foco y adaptación móvil', () => {
  assert.match(reports, /\.reports-page :where\(button,[^}]+\{min-height:42px;font-size:13px\}/);
  assert.match(reports, /\.reports-page :where\(button,[^}]+:focus-visible\{outline:3px solid/);
  assert.match(reports, /\.reports-empty,\.reports-restricted\{[^}]*min-height:152px/);
  assert.match(reports, /\.reports-notice\{min-height:50px/);
  assert.match(reports, /@media screen and \(max-width:720px\)[\s\S]*?min-height:44px/);
  assert.match(reports, /\.reports-filters \.btn-primary\{grid-column:1\/-1;grid-row:3\}/);
  assert.match(reports, /\.reports-row:not\(\.reports-row-head\)>\*:nth-child\(3\)[^{]+\{display:grid/);
  assert.match(reports, /content:"Completadas"/);
  assert.match(reports, /@media screen and \(max-width:420px\)[\s\S]*?\.reports-metrics\{grid-template-columns:1fr\}/);
});
