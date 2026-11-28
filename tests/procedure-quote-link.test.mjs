import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('el procedimiento deja ligar la cita a su concepto cotizado con las mismas funciones de la ficha de la cita', () => {
  const js = read('smyl-procedure-safety.js'), p360 = read('smyl-patient-360.js');
  assert.match(js, /function quoteLink\(dialog, st\)/);
  assert.match(js, /smyl_appointment_quote_candidates/);
  assert.match(js, /smyl_link_appointment_quote_item/);
  assert.match(js, /smyl_unlink_appointment_quote_item/);
  assert.match(js, /if \(st\.appointmentId\) quoteLink\(dialog, st\)/);
  assert.match(js, /Si lo que haces hoy ya estaba cotizado/);
  // Nunca se liga solo: solo hay botones.
  assert.doesNotMatch(js, /quoteLink[\s\S]{0,200}smyl_link_appointment_quote_item[\s\S]{0,40}load\(\);\s*\n\s*\}\s*\n\s*function open/);
  // «Registrar procedimiento» de Consulta usa la cita de hoy del paciente.
  assert.match(p360, /function todayVisitId\(s\)/);
  assert.match(p360, /appointmentId:todayVisitId\(s\)/);
});

test('web, PWA y móvil publican la misma versión', () => {
  for (const f of ['smyl-procedure-safety.js', 'smyl-patient-360.js', 'smyl-patient-360.css', 'app.html', 'sw.js'])
    assert.equal(read(f), read('mobile/www/' + f), f);
  assert.match(read('app.html'), /smyl-procedure-safety\.js\?v=4/);
  assert.match(read('sw.js'), /procedimiento-cotizacion-v1/);
});
