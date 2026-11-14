import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../smyl-inventory.js', import.meta.url), 'utf8');
const pick = (re) => { const m = src.match(re); assert.ok(m, 'no se encontró ' + re); return m[0]; };
const h = new Function([
  pick(/var IMPORT_COLUMNS=[^\n]*\n/), pick(/var IMPORT_CATEGORIES=[^\n]*\n/), pick(/function parseCsv\(text\)\{[^\n]*\n/), pick(/function importHeader\(v\)\{[^\n]*\n/),
  pick(/function importNum\(v\)\{[^\n]*\n/), pick(/function validateImport\([^\n]*\n/), pick(/var CODE128=[^\n]*\n/), pick(/function code128Widths\(text\)\{[^\n]*\n/), pick(/function barcodeSvg\([^\n]*\n/),
].join('\n') + ';return {parseCsv,importNum,validateImport,CODE128,code128Widths,barcodeSvg};')();

test('csv: comillas, punto y coma, BOM y saltos de línea', () => {
  const m = h.parseCsv('﻿sku;nombre\r\nA1;"Resina, A2"\r\n\r\nB2;"Dice ""hola"""\r\n');
  assert.deepEqual(m, [['sku', 'nombre'], ['A1', 'Resina, A2'], ['B2', 'Dice "hola"']]);
});
test('números: formatos mexicano y europeo', () => {
  assert.equal(h.importNum('$1,250.50'), 1250.5);
  assert.equal(h.importNum('12,5'), 12.5);
  assert.equal(h.importNum('1.250,50'), 1250.5);
  assert.equal(h.importNum(''), null);
  assert.ok(Number.isNaN(h.importNum('abc')));
});
test('importación: valida obligatorios, duplicados, existentes y presentación', () => {
  const m = h.parseCsv('SKU,Nombre,Categoría,Costo unitario,Presentación,Unidades por presentación\nA1,Guantes,material,10,caja,100\nA1,Otro,material,,,\nB2,Gasas,rara,,,\nc3,Existe,material,,,\nD4,Mal,material,5,caja,\nE5,Neg,material,-3,,');
  const r = h.validateImport(m, ['C3']);
  assert.deepEqual(r.rows.map((x) => x.errors.length > 0), [false, true, true, true, true, true]);
  assert.match(r.rows[1].errors[0], /repetido/);
  assert.match(r.rows[3].errors.join(), /ya existe/);
  assert.equal(r.rows[0].data.packQty, 100);
  assert.deepEqual(h.validateImport([['sku', 'precio']], []).missing, ['nombre']);
});
test('code128: tabla coherente (11 módulos por símbolo, 13 el de paro) y checksum', () => {
  h.CODE128.forEach((p, i) => assert.equal([...p].reduce((a, n) => a + Number(n), 0), i === 106 ? 13 : 11, 'símbolo ' + i));
  assert.equal(new Set(h.CODE128).size, 107);
  const w = h.code128Widths('PJJ123C');
  assert.equal(w.length, (1 + 7 + 1) * 6 + 7);
  assert.equal(h.code128Widths('ñ'), null);
  assert.equal(h.code128Widths(''), null);
  assert.match(h.barcodeSvg('A1'), /^<svg[^>]*><rect/);
});
