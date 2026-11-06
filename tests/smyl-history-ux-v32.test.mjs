import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const patient = read('smyl-patient-360.js');
const css = read('smyl-patient-360.css');
const app = read('app.html');
const mobileApp = read('mobile/www/app.html');
const sw = read('sw.js');
const readFileSync2 = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Historia clínica separa la lectura en secciones numeradas con seguridad, pendientes y estado claro', () => {
  const read2 = readFileSync2('smyl-history-read.js');
  assert.match(read2, /p360-hc-band/);
  assert.match(read2, /aria-label="Secciones de la historia clínica"/);
  assert.match(read2, /data-hc-edit/);
  assert.match(read2, /data-hc-add/);
  assert.match(patient, /window\.SmylHistoryRead\.render\(historyReadModel\(/);
  assert.match(patient, /var safetyState=safetyCount\?'alert':safetyPending\?'pending':'ok'/);
  assert.match(patient, /Alertas por confirmar/);
  assert.match(patient, /Sin alertas conocidas/);
  assert.match(patient, /No, confirmado/);
  assert.match(patient, /historyStatusReviewed/);
  for (const title of ['Seguridad clínica','Salud médica','Antecedentes dentales','Hábitos y factores de riesgo','Contacto y notas']) {
    assert.match(patient, new RegExp(`title:'${title}'`));
  }
  assert.doesNotMatch(patient, /de 8 apartados/);
  assert.match(patient, /total:6/);
});

test('El editor de cinco pasos se abre en la sección elegida y los atajos preparan la fila', () => {
  assert.match(patient, /function openHistoryEditor\(s,step,addKind\)/);
  assert.match(patient, /setHistoryStep\(form,step,true\)/);
  assert.match(patient, /function historyPrepareAdd\(form,kind\)/);
  assert.match(patient, /allergy:\['allergies',0\],medication:\['medications',1\]/);
  assert.match(patient, /refreshHistoryStatus\(block,'yes'\)/);
});

test('La edición enfoca una de cinco secciones y conserva navegación accesible', () => {
  assert.match(patient, /aria-label="Secciones de la historia clínica"/);
  for (const step of ['attention','medical','dental','habits','extra']) {
    assert.match(patient, new RegExp(`data-history-step="${step}"`));
    assert.match(patient, new RegExp(`historyEditPanel\\('${step}'`));
  }
  assert.match(patient, /Sección 1 de 5/);
  assert.match(patient, /setAttribute\('aria-current','step'\)/);
  assert.match(patient, /panel\.hidden=panelIndex!==index/);
  assert.match(patient, /data-history-prev/);
  assert.match(patient, />Continuar<\/button>/);
  assert.match(patient, />Guardar historia<\/button>/);
  assert.match(patient, /bindHistoryEditor\(form\)/);
  assert.match(patient, /heading\.focus\(\{preventScroll:true\}\)/);
  assert.match(patient, /prefers-reduced-motion: reduce/);
});

test('Los estados clínicos son explícitos y los detalles aparecen sólo al confirmar Sí', () => {
  assert.match(patient, /\['no','No'\],\['yes','Sí'\],\['unknown','No se sabe'\],\['pending','Pendiente'\]/);
  for (const status of ['alerts','allergies','conditions','medications','surgeries','dental','habits']) {
    assert.match(patient, new RegExp(`historyStatusEditor\\('${status}'`));
    assert.match(patient, new RegExp(`${status}_status`));
  }
  assert.match(patient, /data-history-status-details/);
  assert.match(patient, /details\.hidden=value!=='yes'/);
  assert.match(patient, /Este apartado conserva información/);
  assert.match(patient, /historyFormStatus\(f,name,hasData\)/);
  assert.match(patient, /validateHistoryEditor\(form\)/);
  assert.match(patient, /Agrega el detalle antes de guardar este apartado/);
});

test('La edición preserva campos y registros clínicos existentes', () => {
  for (const field of ['alerts','dental_history','habits','emergency_contact','notes']) {
    assert.match(patient, new RegExp(`(?:historyField|historyTextarea)\\([^\\n]*'${field}'`));
  }
  for (const kind of ['allergy','condition','medication','surgery']) {
    assert.match(patient, new RegExp(`historyRepeater\\('${kind}'`));
  }
  assert.match(patient, /data-history-add/);
  assert.match(patient, /data-history-remove/);
  assert.match(patient, /bindHistoryRepeaters\(form\)/);
});

test('Cada registro médico conserva detalle, estado y fecha sin perder compatibilidad', () => {
  for (const field of ['allergy_records','condition_records','medication_records','surgery_records']) assert.match(patient, new RegExp(field));
  for (const field of ['allergy_substance','allergy_reaction','allergy_severity','condition_diagnosed_at','condition_status','medication_dose','medication_frequency','medication_changed_at','surgery_date_record']) assert.match(patient, new RegExp(field));
  for (const legacy of ['allergies','conditions','conditions_since','medications','medications_changed_at','surgeries','surgery_date']) assert.match(patient, new RegExp(`${legacy}:`));
  assert.match(patient, /type=type==='month'\?'month':'date'/);
  assert.match(patient, /historyDateMax\('month'\)/);
  assert.match(patient, /historyDateMax\('date'\)/);
  assert.match(patient, /Si no recuerda la fecha, déjala vacía/);
  assert.match(css, /\.p360-history-repeater\{/);
  assert.match(css, /\.p360-history-repeat-grid\{/);
});

test('La política v3.3 gobierna jerarquía, controles, móvil y movimiento reducido', () => {
  assert.match(css, /Historia clínica v3\.3/);
  assert.match(css, /\.p360-history-editor-shell\{[^}]*grid-template-columns:220px minmax\(0,1fr\)/);
  assert.match(css, /\.p360-history-stepper button\[aria-current="step"\]/);
  assert.match(css, /Controles clínicos inspirados en un segmented control sobrio/);
  assert.match(css, /\.p360-history-status-options\{[\s\S]*?grid-template-columns:repeat\(4/);
  assert.match(css, /\.p360-history-status-options input:checked\+span/);
  assert.match(css, /\.p360-history-actions \[hidden\]\{display:none!important\}/);
  assert.match(css, /\.p360-history-panel>header h3:focus-visible/);
  assert.match(css, /\.p360-history-field input,[\s\S]*?min-height:48px/);
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.p360-history-actions button\{width:100%;min-height:44px\}/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('Web, móvil y PWA publican la misma versión de Historia clínica', () => {
  assert.equal(app, mobileApp);
  assert.equal(read('smyl-patient-360.js'), read('mobile/www/smyl-patient-360.js'));
  assert.equal(css, read('mobile/www/smyl-patient-360.css'));
  assert.match(app, /smyl-patient-360\.css\?v=15/);
  assert.match(sw, /smyl-patient-360\.css\?v=15/);
  assert.match(app, /smyl-patient-360\.js\?v=21/);
  assert.match(sw, /smyl-patient-360\.js\?v=21/);
  assert.match(sw, /history-focused-v71/);
});

test('La fixture visual usa sólo información sintética', () => {
  const fixture = read('tests/fixtures/smyl-history-v32-preview.html');
  assert.match(fixture, /Historia clínica v3\.3/);
  assert.match(fixture, /Alergia: penicilina/);
  assert.doesNotMatch(fixture, /Bordados Express|Doña|Pepe/);
});
