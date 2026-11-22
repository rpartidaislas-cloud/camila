import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('el perfil público muestra cédula con institución, cédula de especialidad y aviso de publicidad', () => {
  const html = read('dentista.html');
  assert.match(html, /'Cédula profesional: ' \+ esc\(p\.license_number\) \+ \(p\.license_institution/);
  assert.match(html, /Cédula de especialidad: /);
  assert.match(html, /Aviso de publicidad COFEPRIS: /);
  assert.match(read('smyl-professional-directory.js'), /name="advertising_notice"/);
  assert.match(read('smyl-professional-directory.js'), /smyl_set_profile_advertising_notice/);
});

test('la base rechaza garantías, «sin dolor», superlativos y «100 %» en el perfil, y el directorio es de solo lectura', () => {
  const sql = read('supabase/migrations/20261126160000_smyl_public_profile_compliance.sql');
  assert.match(sql, /garantiza\|garantía de resultado\|sin dolor/);
  assert.match(sql, /new\.headline is not distinct from old\.headline and new\.bio is not distinct from old\.bio/, 'solo textos nuevos o editados');
  assert.match(sql, /professional\.license_institution,\s+professional\.specialty_license,\s+profile\.advertising_notice/);
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger on public\.smyl_professional_directory from anon, authenticated/);
});

test('existe el documento de clasificación COFEPRIS para revisión legal', () => {
  const doc = read('docs/COFEPRIS_CLASIFICACION_IA.md');
  for (const part of ['dispositivo médico', 'Revisión de radiografías', 'analizar-foto', 'Publicidad de servicios de salud', 'Preguntas abiertas']) assert.ok(doc.includes(part), part);
});
