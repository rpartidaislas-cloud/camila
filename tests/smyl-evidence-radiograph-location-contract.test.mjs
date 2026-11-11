import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../smyl-evidence-center.js', import.meta.url), 'utf8');

test('la carga radiografica no pide una pieza antes de la valoracion profesional', () => {
  const detailsStart = source.indexOf('renderDetailsStep(body, category)');
  const detailsEnd = source.indexOf('async submitDraft()', detailsStart);
  assert.ok(detailsStart > -1 && detailsEnd > detailsStart, 'debe existir el paso de detalles');
  const details = source.slice(detailsStart, detailsEnd);

  assert.match(details, /category\.id\s*!==\s*['"]radiograph_2d['"]/,
    'los campos anatomicos deben estar condicionados por modalidad');
  assert.doesNotMatch(details, /fields\.append\(dateField,\s*regionField,\s*toothField,\s*titleField\)/,
    'Rayos X no debe recibir sin condicion los campos de region y pieza');
  assert.match(details, /La pieza y los hallazgos se relacionan despu[eé]s, durante la valoraci[oó]n profesional/i,
    'el flujo debe explicar donde se realiza la vinculacion');
  assert.match(details, /required:\s*!isRadiograph/,
    'la fecha no debe ser obligatoria para una radiografia historica');
  assert.match(details, /isRadiograph\s*\?\s*['"]{2}\s*:\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    'una radiografia no debe recibir silenciosamente la fecha de hoy');
  assert.match(details, /Si desconoces la fecha, d[eé]jala vac[ií]a/i,
    'el formulario debe explicar que la fecha puede quedar desconocida');
});

test('el payload radiografico no conserva ubicacion anatomica del asistente de carga', () => {
  const detailsStart = source.indexOf('renderDetailsStep(body, category)');
  const detailsEnd = source.indexOf('async submitDraft()', detailsStart);
  assert.ok(detailsStart > -1 && detailsEnd > detailsStart, 'debe existir el paso de detalles');
  const details = source.slice(detailsStart, detailsEnd);

  for (const field of ['region', 'regionPreset', 'tooth']) {
    assert.match(details, new RegExp(`this\\.draft\\.${field}\\s*=\\s*capturesRegion[\\s\\S]*?:\\s*['"]{2}`),
      `${field} debe quedar vacio para una radiografia`);
  }
});
