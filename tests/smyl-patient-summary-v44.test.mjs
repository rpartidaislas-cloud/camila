import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../smyl-patient-360.js');
const styles = read('../smyl-patient-360.css');
const sync = read('../mobile/scripts/sync-web.js');

test('el resumen prioriza riesgo, siguiente acción y datos clave sin duplicar la navegación', () => {
  for (const area of ['Historia clínica', 'Evoluciones', 'Tratamiento', 'Simulaciones SMYL', 'Estudios y archivos', 'Citas']) {
    assert.match(script, new RegExp(area));
  }
  for (const label of ['Alerta clínica', 'Hoy', 'SIGUIENTE PASO', 'Datos clave', 'Actividad reciente', 'Más del expediente']) {
    assert.match(script, new RegExp(label));
  }
  assert.match(script, /showSection\(s,button\.dataset\.p360Domain\)/);
  assert.doesNotMatch(script, /Todo el paciente, ordenado por área|áreas vinculadas|p360-domain-card/);
  const accessProjection = script.slice(script.indexOf('function overviewLinks('), script.indexOf('function timelineHtml('));
  assert.doesNotMatch(accessProjection, /\.insert\(|\.update\(|\.upsert\(|rpc\(/);
});

test('la cabecera prioriza identidad y elimina controles duplicados', () => {
  const buildProjection = script.slice(script.indexOf('function build('), script.indexOf('function mount('));
  assert.match(buildProjection, /p360-title p360-title-clean/);
  assert.match(buildProjection, /p360-eyebrow/);
  assert.doesNotMatch(buildProjection, /p360-title-tools|data-p360-assistant-head|p360-secure/);
  assert.match(script, /var billingTab=s\.root\.querySelector/);
  assert.match(script, /if\(billingTab\)billingTab\.hidden=!s\.canFinanceRead/);
});

test('la actividad reciente muestra tres eventos y conserva acceso a la fuente canónica', () => {
  assert.match(script, /s\.timelineExpanded\?rows:rows\.slice\(0,3\)/);
  assert.match(script, /Ver toda la actividad/);
  assert.match(script, /openTimelineItem\(s,type,id\)/);
  assert.match(script, /if\(type==='appointment'\)return showSection\(s,'appointments'\)/);
  assert.match(script, /if\(type==='clinical_note'\)return showSection\(s,'notes'\)/);
  assert.match(script, /return openStoredFile\(s,id\)/);
  assert.match(script, /return showSection\(s,'treatment'\)/);
  assert.match(script, /return showSection\(s,'billing'\)/);
  assert.match(script, /window\.ir\('inbox'\)/);
  assert.doesNotMatch(script, /data-timeline-filter|p360-timeline-filters/);
});

test('los accesos secundarios conservan permisos y estados clínicos explícitos', () => {
  assert.match(script, /s\.canFinanceRead\?\[\['billing','Datos administrativos'\]\]:\[\]/);
  assert.match(script, /conciseHistoryValue/);
  assert.match(script, /Ninguna conocida/);
  assert.match(script, /Ninguno registrado/);
  assert.match(script, /Por confirmar/);
  assert.doesNotMatch(script, /diagnóstico generado|diagnóstico automático|tratamiento recomendado por IA/i);
});

test('la política visual separa secciones, accesos y actividad sin multiplicar tarjetas', () => {
  assert.match(styles, /Resumen simple v4\.6/);
  assert.match(styles, /Expediente identity v4\.7/);
  assert.match(styles, /\.p360-title-clean\{/);
  assert.match(styles, /\.p360-title-clean~\.p360-tabs/);
  assert.match(styles, /\.p360-today-grid\{display:grid;grid-template-columns:/);
  assert.match(styles, /\.p360-more>summary/);
  assert.match(styles, /\.p360-more-grid\{display:grid;grid-template-columns:repeat\(3/);
  assert.match(styles, /\.p360-timeline-row:focus-visible/);
  assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.p360-more-grid\{grid-template-columns:1fr/);
  assert.match(styles, /\.p360-root \[hidden\]\{display:none!important\}/);
  assert.match(sync, /smyl-patient-360\.js/);
  assert.match(sync, /smyl-patient-360\.css/);
});
