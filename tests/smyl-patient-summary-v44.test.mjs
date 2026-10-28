import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../smyl-patient-360.js');
const styles = read('../smyl-patient-360.css');
const sync = read('../mobile/scripts/sync-web.js');

test('la portada 360 ordena las fuentes existentes sin crear otro expediente', () => {
  for (const area of ['Historia clínica', 'Evoluciones', 'Tratamiento', 'Estudios y archivos', 'Atención y citas']) {
    assert.match(script, new RegExp(area));
  }
  assert.match(script, /Todo el paciente, ordenado por área/);
  assert.match(script, /Cada bloque abre el área correspondiente; la información clínica no se duplica/);
  assert.match(script, /showSection\(s,button\.dataset\.p360Domain\)/);
  assert.match(script, /SmylCaseWorkspace\.context/);
  assert.match(script, /SmylDentalProgress\.status/);
  assert.match(script, /SmylClinicalWorkflow\.status/);
  const careProjection = script.slice(script.indexOf('function careCards('), script.indexOf('function careCardsHtml('));
  assert.doesNotMatch(careProjection, /\.insert\(|\.update\(|\.upsert\(|rpc\(/);
});

test('la actividad longitudinal usa el timeline autorizado y abre su fuente canónica', () => {
  for (const filter of ["['all','Todo']", "['clinical','Clínica']", "['appointments','Citas']", "['files','Archivos']", "['proposals','Cotizaciones']", "['finance','Administrativo']", "['messages','Conversaciones']"]) {
    assert.match(script, new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(script, /timelineRows\(s\)/);
  assert.match(script, /s\.timeline\.filter/);
  assert.match(script, /openTimelineItem\(s,type,id\)/);
  assert.match(script, /if\(type==='appointment'\)return showSection\(s,'appointments'\)/);
  assert.match(script, /if\(type==='clinical_note'\)return showSection\(s,'notes'\)/);
  assert.match(script, /return openStoredFile\(s,id\)/);
  assert.match(script, /return showSection\(s,'treatment'\)/);
  assert.match(script, /return showSection\(s,'billing'\)/);
  assert.match(script, /window\.ir\('inbox'\)/);
  assert.match(script, /if\(!filters\.some[\s\S]*s\.timelineFilter='all'/);
  assert.match(script, /s\.timelineExpanded\?rows:rows\.slice\(0,6\)/);
});

test('las áreas sensibles conservan permisos y estados profesionales', () => {
  assert.match(script, /if\(s\.canFinanceRead\)cards\.push/);
  assert.match(script, /fiscalComplete\(s\.fiscal\)/);
  assert.match(script, /ctx\.plan&&ctx\.plan\.saved\?'Borrador guardado':ctx\.plan&&ctx\.plan\.ready\?'Evaluación disponible'/);
  assert.match(script, /Por confirmar/);
  assert.match(script, /Borrador guardado/);
  assert.doesNotMatch(script, /diagnóstico generado|diagnóstico automático|tratamiento recomendado por IA/i);
});

test('la política visual presenta una superficie conectada accesible y responsiva', () => {
  assert.match(styles, /\.p360-record-map\{/);
  assert.match(styles, /\.p360-domain-grid\{display:grid;grid-template-columns:repeat\(3/);
  assert.match(styles, /\.p360-domain-card:focus-visible/);
  assert.match(styles, /\.p360-timeline-row:focus-visible/);
  assert.match(styles, /@media\(max-width:600px\)[\s\S]*?\.p360-domain-grid\{grid-template-columns:1fr\}/);
  assert.match(styles, /\.p360-root :is\([^)]+\.p360-timeline-filters button[^)]+\)\{min-height:44px\}/);
  assert.match(sync, /smyl-patient-360\.js/);
  assert.match(sync, /smyl-patient-360\.css/);
});
