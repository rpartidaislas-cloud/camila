// smyl-xlsx.js arma un .xlsx real sin librerías externas. Aquí el archivo se abre como lo haría Excel:
// un ZIP válido (firmas, tamaños y CRC), XML bien formado en cada parte y celdas con su tipo correcto.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const src = read('smyl-xlsx.js');
const load = (...extra) => { const win = {}; new Function('window', ...extra.map((x) => x[0]), src)(win, ...extra.map((x) => x[1])); return win.SmylXlsx; };
const xlsx = load();

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

// Abre el ZIP por su directorio central y comprueba cada entrada contra su encabezado local.
function unzip(bytes) {
  const buf = Buffer.from(bytes), end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'falta el fin del directorio central');
  assert.equal(end + 22, buf.length, 'no debe haber nada después del fin del directorio');
  const total = buf.readUInt16LE(end + 10), size = buf.readUInt32LE(end + 12); let at = buf.readUInt32LE(end + 16);
  assert.equal(at + size, end, 'el directorio central termina donde empieza su cierre');
  const out = { names: [], files: {}, methods: {} };
  for (let i = 0; i < total; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, 'firma de entrada del directorio');
    const method = buf.readUInt16LE(at + 10), crc = buf.readUInt32LE(at + 16), packed = buf.readUInt32LE(at + 20), plain = buf.readUInt32LE(at + 24), nameLen = buf.readUInt16LE(at + 28), local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, 'firma del encabezado local de ' + name);
    assert.equal(buf.readUInt16LE(local + 8), method, 'método de ' + name);
    assert.equal(buf.readUInt32LE(local + 14), crc, 'CRC local de ' + name);
    assert.equal(buf.readUInt32LE(local + 18), packed); assert.equal(buf.readUInt32LE(local + 22), plain);
    assert.equal(buf.toString('utf8', local + 30, local + 30 + buf.readUInt16LE(local + 26)), name);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), raw = buf.subarray(start, start + packed);
    assert.ok(method === 0 || method === 8, 'solo sin comprimir o deflate: ' + name);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(data.length, plain, 'tamaño de ' + name);
    assert.equal(crc32(data), crc, 'CRC de ' + name);
    out.names.push(name); out.files[name] = data.toString('utf8'); out.methods[name] = method;
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}
// XML bien formado: cada etiqueta que abre, cierra, y en orden.
function wellFormed(xml, label) {
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>\n</, label + ': declaración XML');
  const stack = [];
  for (const m of xml.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g)) {
    if (m[1]) assert.equal(stack.pop(), m[2], label + ': cierre de ' + m[2]); else if (!m[4]) stack.push(m[2]);
  }
  assert.deepEqual(stack, [], label + ': etiquetas sin cerrar');
  assert.doesNotMatch(xml.replace(/<[^>]*>/g, ''), /[<>]|&(?!amp;|lt;|gt;|quot;)/, label + ': texto sin escapar');
}
const cells = (sheet) => Object.fromEntries([...sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/g)].map((m) => [m[1], { attrs: m[2], body: m[3] }]));
const text = (cell) => cell && (/<t xml:space="preserve">([\s\S]*?)<\/t>/.exec(cell.body) || [])[1];
const number = (cell) => cell && Number((/<v>([^<]*)<\/v>/.exec(cell.body) || [])[1]);

const SHEETS = [
  { name: 'Pagos', filter: true, columns: [{ header: 'Fecha', width: 18, type: 'datetime' }, { header: 'Recibo', width: 10 }, { header: 'Paciente', width: 30 }, { header: 'Importe', width: 14, type: 'money' }],
    rows: [[new Date(2026, 10, 22, 9, 30, 0), '000105', 'Ñandú & "Comillas" <b>', 1500.1], ['2026-11-20T18:00:00', '000104', '=1+1', -200.5], [null, '', '123456789012345678', 0]] },
  { name: 'Totales', columns: [{ header: 'Concepto', width: 30 }, { header: 'Valor', width: 20 }], rows: [['Pagos', { value: 2, type: 'number' }], [{ value: 'Total', type: 'bold' }, { value: 1299.6, type: 'moneyBold' }], ['Día', { value: new Date(2026, 10, 22, 15, 45), type: 'date' }]] }];

test('el archivo es un ZIP válido: firmas, tamaños y CRC de cada parte', async () => {
  const zip = unzip(await xlsx.build(SHEETS));
  assert.deepEqual(zip.names, ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
  assert.equal(zip.names[0], '[Content_Types].xml', 'los tipos de contenido van primero');
});

test('cada parte es XML bien formado y el libro declara sus hojas, relaciones y tipos', async () => {
  const zip = unzip(await xlsx.build(SHEETS));
  for (const name of zip.names) wellFormed(zip.files[name], name);
  assert.match(zip.files['xl/workbook.xml'], /<sheets><sheet name="Pagos" sheetId="1" r:id="rId1"\/><sheet name="Totales" sheetId="2" r:id="rId2"\/><\/sheets>/);
  const rels = zip.files['xl/_rels/workbook.xml.rels'];
  assert.match(rels, /Id="rId1"[^>]*Target="worksheets\/sheet1\.xml"/); assert.match(rels, /Id="rId2"[^>]*Target="worksheets\/sheet2\.xml"/); assert.match(rels, /Id="rId3"[^>]*Target="styles\.xml"/);
  const types = zip.files['[Content_Types].xml'];
  for (const part of ['/xl/workbook.xml', '/xl/worksheets/sheet1.xml', '/xl/worksheets/sheet2.xml', '/xl/styles.xml']) assert.ok(types.includes('PartName="' + part + '"'), part);
  assert.match(zip.files['_rels/.rels'], /Target="xl\/workbook\.xml"/);
});

test('los textos van como texto, el dinero como número y las fechas como días de Excel', async () => {
  const sheet = cells(unzip(await xlsx.build(SHEETS)).files['xl/worksheets/sheet1.xml']);
  // Fecha y hora local → días desde el 30 de diciembre de 1899, con el formato dd/mm/aaaa hh:mm.
  assert.match(sheet.A2.attrs, /s="3"/);
  assert.ok(Math.abs(number(sheet.A2) - (Date.UTC(2026, 10, 22, 9, 30, 0) - Date.UTC(1899, 11, 30)) / 86400000) < 1e-9);
  const local = new Date('2026-11-20T18:00:00');
  assert.ok(Math.abs(number(sheet.A3) - (Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes()) - Date.UTC(1899, 11, 30)) / 86400000) < 1e-9, 'una fecha en texto ISO también se convierte');
  // El folio conserva sus ceros, una referencia larga no se vuelve notación científica y «=1+1» no se convierte en fórmula.
  assert.match(sheet.B2.attrs, /t="inlineStr"/); assert.equal(text(sheet.B2), '000105');
  assert.match(sheet.C3.attrs, /t="inlineStr"/); assert.equal(text(sheet.C3), '=1+1');
  assert.equal(text(sheet.C4), '123456789012345678');
  // El dinero es un número con dos decimales, también en negativo y en cero.
  assert.match(sheet.D2.attrs, /s="2"/); assert.doesNotMatch(sheet.D2.attrs, /t=/);
  assert.equal(number(sheet.D2), 1500.1); assert.equal(number(sheet.D3), -200.5); assert.equal(number(sheet.D4), 0);
  // Las celdas vacías no se escriben.
  assert.equal(sheet.A4, undefined); assert.equal(sheet.B4, undefined);
});

test('una celda puede traer su propio tipo: número, negritas, dinero en negritas o solo fecha', async () => {
  const sheet = cells(unzip(await xlsx.build(SHEETS)).files['xl/worksheets/sheet2.xml']);
  assert.equal(number(sheet.B2), 2); assert.doesNotMatch(sheet.B2.attrs, /s=/);
  assert.match(sheet.A3.attrs, /s="5"/); assert.equal(text(sheet.A3), 'Total');
  assert.match(sheet.B3.attrs, /s="6"/); assert.equal(number(sheet.B3), 1299.6);
  assert.match(sheet.B4.attrs, /s="4"/);
  assert.equal(number(sheet.B4), (Date.UTC(2026, 10, 22) - Date.UTC(1899, 11, 30)) / 86400000, 'una fecha sin hora es un día entero');
});

test('lo que rompería un XML se escapa o se quita, y los textos enormes se recortan', async () => {
  const odd = 'a\u0001b\u000Bc😀d\uD800e&<>"';
  const zip = unzip(await xlsx.build([{ name: 'a/b:c*[d]?' + 'x'.repeat(40), columns: [{ header: 'T<&>' }], rows: [[odd], ['y'.repeat(40000)], ['  espacios  ']] }]));
  for (const name of zip.names) wellFormed(zip.files[name], name);
  const sheet = cells(zip.files['xl/worksheets/sheet1.xml']);
  assert.equal(text(sheet.A1), 'T&lt;&amp;&gt;');
  assert.equal(text(sheet.A2), 'abc😀de&amp;&lt;&gt;&quot;', 'se van los caracteres de control y los sustitutos sueltos; el emoji se queda');
  assert.equal(text(sheet.A3).length, 32767, 'Excel no acepta más de 32 767 caracteres por celda');
  assert.equal(text(sheet.A4), '  espacios  ', 'los espacios se conservan');
  const sheetName = /<sheet name="([^"]*)"/.exec(zip.files['xl/workbook.xml'])[1];
  assert.equal(sheetName.length, 31); assert.doesNotMatch(sheetName, /[\\\/?*\[\]:]/);
});

test('encabezado en negritas y fijo, filtro, anchos y estilos que Excel espera', async () => {
  const zip = unzip(await xlsx.build(SHEETS)), one = zip.files['xl/worksheets/sheet1.xml'], two = zip.files['xl/worksheets/sheet2.xml'], styles = zip.files['xl/styles.xml'];
  for (const ref of ['A1', 'B1', 'C1', 'D1']) assert.match(cells(one)[ref].attrs, /s="1"/);
  assert.match(one, /<sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.doesNotMatch(two, /tabSelected/);
  assert.match(one, /<cols><col min="1" max="1" width="18" customWidth="1"\/><col min="2" max="2" width="10" customWidth="1"\/>/);
  assert.match(one, /<\/sheetData><autoFilter ref="A1:D4"\/><\/worksheet>$/);
  assert.doesNotMatch(two, /autoFilter/, 'el filtro solo va en la hoja que lo pide');
  // El orden de las piezas del XML importa para Excel: vistas, formato, columnas, datos y filtro.
  assert.ok(one.indexOf('<sheetViews>') < one.indexOf('<sheetFormatPr') && one.indexOf('<sheetFormatPr') < one.indexOf('<cols>') && one.indexOf('<cols>') < one.indexOf('<sheetData>'));
  assert.match(styles, /<numFmts count="2"><numFmt numFmtId="164" formatCode="dd\/mm\/yyyy\\ hh:mm"\/><numFmt numFmtId="165" formatCode="dd\/mm\/yyyy"\/><\/numFmts>/);
  assert.equal((styles.match(/<xf /g) || []).length, 8, 'un estilo base y siete de celda');
  assert.equal((styles.match(/applyAlignment="1"><alignment horizontal="left"\/><\/xf>/g) || []).length, 2, 'las fechas van alineadas a la izquierda, como texto, para no pegarse a la columna siguiente');
  assert.match(styles, /<fills count="3"><fill><patternFill patternType="none"\/><\/fill><fill><patternFill patternType="gray125"\/><\/fill>/, 'los dos rellenos obligatorios van primero');
  assert.ok(styles.indexOf('<numFmts') < styles.indexOf('<fonts') && styles.indexOf('<fonts') < styles.indexOf('<fills') && styles.indexOf('<fills') < styles.indexOf('<borders') && styles.indexOf('<borders') < styles.indexOf('<cellStyleXfs') && styles.indexOf('<cellStyleXfs') < styles.indexOf('<cellXfs') && styles.indexOf('<cellXfs') < styles.indexOf('<cellStyles'));
});

test('se comprime cuando el navegador puede y, si no, el archivo sigue siendo válido', async () => {
  const packed = unzip(await xlsx.build(SHEETS));
  assert.equal(packed.methods['xl/worksheets/sheet1.xml'], 8, 'con CompressionStream las hojas van comprimidas');
  const plain = unzip(await load(['CompressionStream', undefined]).build(SHEETS));
  assert.ok(Object.values(plain.methods).every((m) => m === 0), 'sin CompressionStream todo va sin comprimir');
  assert.deepEqual(plain.files, packed.files, 'el contenido es el mismo con y sin compresión');
  const broken = unzip(await load(['CompressionStream', function () { throw new Error('no disponible'); }]).build(SHEETS));
  assert.deepEqual(broken.files, packed.files, 'si la compresión falla, tampoco se pierde nada');
});

test('un libro vacío o sin datos también abre', async () => {
  const none = unzip(await xlsx.build([]));
  assert.match(none.files['xl/workbook.xml'], /<sheet name="Hoja 1"/);
  for (const name of none.names) wellFormed(none.files[name], name);
  const empty = unzip(await xlsx.build([{ name: 'Pagos', filter: true, columns: [{ header: 'Fecha' }], rows: [] }])).files['xl/worksheets/sheet1.xml'];
  assert.doesNotMatch(empty, /autoFilter/, 'sin filas no hay nada que filtrar');
  assert.match(empty, /<sheetData><row r="1">/);
});

test('download entrega el archivo con su nombre y limpia lo que usó', async () => {
  const anchors = [], body = { append: (a) => { a.attached = true; } };
  const doc = { createElement: (tag) => { const a = { tag, clicked: 0, click() { this.clicked += 1; }, remove() { this.attached = false; } }; anchors.push(a); return a; }, body };
  const size = await load(['document', doc]).download('pagos-2026-11-22.xlsx', SHEETS);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].tag, 'a'); assert.equal(anchors[0].download, 'pagos-2026-11-22.xlsx'); assert.equal(anchors[0].clicked, 1); assert.equal(anchors[0].attached, false);
  assert.match(anchors[0].href, /^blob:/);
  assert.ok(size > 1000, 'devuelve el tamaño del archivo');
  URL.revokeObjectURL(anchors[0].href);
});

test('la app carga el módulo antes que Finanzas, lo guarda para usarse sin conexión y web y móvil coinciden', () => {
  const app = read('app.html'), sw = read('sw.js');
  assert.match(app, /<script defer src="smyl-xlsx\.js\?v=1"><\/script>\n<script defer src="smyl-finance\.js\?v=\d+"><\/script>/);
  assert.match(sw, /'\/camila\/smyl-xlsx\.js\?v=1',/);
  assert.equal(read('mobile/www/smyl-xlsx.js'), src);
  assert.match(src, /window\.SmylXlsx=Object\.freeze\(\{build:build,download:download\}\)/);
  // Sin dependencias externas: nada se descarga de otro sitio para armar el archivo.
  assert.doesNotMatch(src, /https?:\/\/(?!schemas\.openxmlformats\.org)/);
  assert.doesNotMatch(src, /\bimport\b|\brequire\(/);
});
