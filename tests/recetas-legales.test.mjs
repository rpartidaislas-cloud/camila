import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const RX = require('../smyl-prescriptions.js');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('cada medicamento exige genérico, presentación, dosis, vía, frecuencia y duración', () => {
  const ok = { generic_name: 'Ibuprofeno', presentation: 'Tabletas 400 mg', dose: '1', route: 'Oral', frequency: 'Cada 8 h', duration: '3 días' };
  assert.equal(RX.validateItem(ok), '');
  for (const k of Object.keys(ok)) assert.notEqual(RX.validateItem({ ...ok, [k]: '' }), '', k);
});

test('la receta impresa lleva los datos legales y espacio para la firma autógrafa', () => {
  const html = RX.printable({ folio: 3, issued_at: '2026-11-22T10:00:00Z', document_sha256: 'a'.repeat(64),
    prescriber: { name: 'Dra. Ana', license: '123456', institution: 'UNAM', specialty: 'Endodoncia', specialty_license: '987' },
    clinic: { name: 'Clínica', branch: 'Centro', address: 'Av. Juárez 100, Guadalajara' }, patient: { name: 'Juan <b>', age: '36 años', sex: 'M' },
    items: [{ generic_name: 'Amoxicilina', presentation: 'Cápsulas 500 mg', dose: '1 cápsula', route: 'Oral', frequency: 'Cada 8 horas', duration: '7 días' }] });
  for (const part of ['Cédula profesional 123456', 'UNAM', 'Cédula de especialidad 987', 'Av. Juárez 100', 'Edad:', 'Fecha:', 'Amoxicilina', 'vía oral', 'Cada 8 horas', '7 días', 'Firma del médico']) assert.ok(html.includes(part), part);
  assert.ok(html.includes('Juan &lt;b&gt;'), 'escapa');
});

test('el servidor toma los datos del médico, consultorio y paciente, y la receta no se edita ni se borra', () => {
  const sql = read('supabase/migrations/20261126130000_smyl_prescriptions.sql');
  assert.match(sql, /license_institution, ''\)\)\) < 3/);
  assert.match(sql, /la receta debe llevar el domicilio del consultorio/);
  assert.match(sql, /v_method := public\.smyl_recent_auth_method\(600\)/);
  assert.match(sql, /Una receta emitida no se modifica/);
  assert.match(sql, /Una receta emitida no se puede eliminar; anúlala/);
  assert.match(sql, /NO es para medicamentos controlados/);
  assert.match(read('smyl-clinic-admin.js'), /field\('license_institution', 'Institución que expidió el título'/);
});
