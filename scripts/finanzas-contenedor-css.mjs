#!/usr/bin/env node
// Finanzas · diseño angosto según el espacio disponible, no según el ancho de la pantalla.
//
// La hoja smyl-finance.css pasa al diseño de celular con reglas «@media (max-width: N)». Eso mira el ancho de la PANTALLA: en una tableta
// con el menú lateral abierto la pantalla mide 820 px, pero a Finanzas le quedan unos 460 px y las filas se encimaban.
// Este script copia cada regla de la PÁGINA de Finanzas que vive en un «@media (max-width: N)» a un bloque
// «@container finance-workspace (max-width: N)» colocado justo después, para que el mismo diseño angosto se active cuando el contenedor
// de Finanzas mide N px o menos. Las reglas originales no se tocan (celulares y navegadores sin @container se ven igual que antes) y las
// ventanas (que viven fuera del contenedor) siguen dependiendo de la pantalla.
//
// Uso:  node scripts/finanzas-contenedor-css.mjs            reescribe smyl-finance.css y mobile/www/smyl-finance.css
//       node scripts/finanzas-contenedor-css.mjs --check    sale con código 1 si la hoja no está al día (lo usa la prueba)
// Al cambiar una regla de página dentro de un «@media (max-width…)», vuelve a correrlo: las copias se regeneran completas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = '/*contenedor*/';
const CONTAINER = 'finance-workspace';

// Clases que existen dentro de la página (y no solo en ventanas): salen del HTML que arman build() y el dibujo de cada pestaña.
const PAGE_FUNCTIONS = ['build', 'renderVisits', 'renderAccounts', 'renderToday', 'renderReceipts', 'renderPayments', 'renderCash', 'renderFiscal', 'fiscalStatusStrip', 'renderTruncationBanner', 'moreRows', 'notify', 'sk', 'loadingSkeleton', 'renderFinanceActions', 'renderTabs'];
export function pageClasses(js) {
  const out = new Set();
  for (const name of PAGE_FUNCTIONS) {
    const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(js); if (!m) continue;
    let d = 0, k = js.indexOf('{', m.index); const start = k;
    for (; k < js.length; k++) { if (js[k] === '{') d++; else if (js[k] === '}') { d--; if (!d) break; } }
    const src = js.slice(start, k + 1);
    for (const hit of src.matchAll(/class=\\?"([^"\\]+)/g)) hit[1].split(/\s+/).forEach((c) => c && out.add(c));
    for (const hit of src.matchAll(/el\('[a-z]+','([^']+)'/g)) hit[1].split(/\s+/).forEach((c) => c && out.add(c));
  }
  return out;
}

function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
function closeOf(text, open) { let d = 0; for (let k = open; k < text.length; k++) { if (text[k] === '{') d++; else if (text[k] === '}') { d--; if (!d) return k; } } throw new Error('Llaves sin cerrar'); }

// Quita los bloques generados en una corrida anterior.
export function strip(css) {
  let out = '', i = 0;
  for (;;) { const a = css.indexOf(MARK, i); if (a < 0) { out += css.slice(i); break; }
    const open = css.indexOf('{', a), close = closeOf(css, open); let start = a; if (css[start - 1] === '\n') start--;
    out += css.slice(i, start); i = close + 1; }
  return out;
}

export function containerize(source, js) {
  const css = strip(source), classes = pageClasses(js); let out = '', i = 0, blocks = 0, rulesCopied = 0;
  const isPage = (selector) => /#p-caja|\.finance-page/.test(selector) || [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].some((m) => classes.has(m[1]));
  const isContainerItself = (selector) => /^\s*(?:#p-caja|\.finance-page)(?:\.[\w-]+)*\s*$/.test(selector);
  for (;;) {
    const a = css.indexOf('@media', i); if (a < 0) { out += css.slice(i); break; }
    const open = css.indexOf('{', a), close = closeOf(css, open), condition = css.slice(a + 6, open).trim();
    out += css.slice(i, close + 1); i = close + 1;
    const max = /^(?:screen\s+and\s+)?\(max-width:\s*(\d+)px\)$/.exec(condition); if (!max) continue;
    const body = css.slice(open + 1, close), copies = [];
    for (const rule of body.match(/[^{}]+\{[^{}]*\}/g) || []) {
      const cut = rule.indexOf('{'), selectors = splitTop(rule.slice(0, cut).replace(/\/\*[\s\S]*?\*\//g, '')).map((s) => s.trim()).filter((s) => s && isPage(s) && !isContainerItself(s));
      if (selectors.length) { copies.push(selectors.join(',') + '{' + rule.slice(cut + 1, -1).trim() + '}'); rulesCopied++; }
    }
    if (copies.length) { out += '\n' + MARK + '@container ' + CONTAINER + ' (max-width:' + max[1] + 'px){' + copies.join('') + '}'; blocks++; }
  }
  return { css: out, blocks, rules: rulesCopied };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.join(root, 'smyl-finance.css'), js = fs.readFileSync(path.join(root, 'smyl-finance.js'), 'utf8'), before = fs.readFileSync(file, 'utf8');
  const result = containerize(before, js);
  if (process.argv.includes('--check')) {
    if (result.css !== before) { console.error('smyl-finance.css no está al día: corre «node scripts/finanzas-contenedor-css.mjs».'); process.exit(1); }
    console.log('smyl-finance.css al día: ' + result.blocks + ' bloques @container, ' + result.rules + ' reglas.'); process.exit(0);
  }
  fs.writeFileSync(file, result.css);
  const mobile = path.join(root, 'mobile', 'www', 'smyl-finance.css'); if (fs.existsSync(mobile)) fs.writeFileSync(mobile, result.css);
  console.log('smyl-finance.css: ' + result.blocks + ' bloques @container con ' + result.rules + ' reglas (' + before.length + ' → ' + result.css.length + ' bytes).');
}
