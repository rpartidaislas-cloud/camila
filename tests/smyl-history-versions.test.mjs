// Historial de cambios de la Historia clínica: la vista (HTML escapado, estados vacíos y de error) y su cableado en la ficha.
// El cálculo de qué cambió está en smyl-history-model.test.mjs; la prueba del diálogo real en navegador, en smyl-history-roundtrip.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../smyl-history-read.js');
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

const entrada = (extra) => ({ revision: 3, when: '4 nov 2026, 10:34 p. m.', who: 'Dra. Ruiz', isFirst: false, changes: [{ section: 'safety', kind: 'added', text: 'Alergia agregada: Látex' }], ...extra });

test('renderVersions(): una entrada por versión con número, fecha, quién y cada cambio con su sección', () => {
  const html = R.renderVersions({ entries: [entrada(), entrada({ revision: 2, who: 'Tú', changes: [{ section: 'medical', kind: 'removed', text: 'Cirugía quitada: X' }, { section: 'dental', kind: 'changed', text: 'a → b' }, { section: 'habits', kind: 'confirmed', text: 'Hábitos: confirmado que no hay' }] })] });
  assert.equal((html.match(/class="p360-hv-item"/g) || []).length, 2);
  assert.match(html, /<strong>Versión 3<\/strong><span>4 nov 2026, 10:34 p\. m\.<\/span><span>Dra\. Ruiz<\/span>/);
  assert.match(html, /data-kind="added"><i aria-hidden="true">\+<\/i><span class="p360-hv-sec">Seguridad<\/span><span>Alergia agregada: Látex/);
  for (const [kind, mark] of [['removed', '−'], ['changed', '↻'], ['confirmed', '✓']]) assert.match(html, new RegExp(`data-kind="${kind}"><i aria-hidden="true">${mark}<`));
  assert.match(html, /data-close>Cerrar<\/button>/);
  assert.doesNotMatch(html, /p360-hv-more/);
});

test('renderVersions(): escapa nombres y textos (nada de HTML del paciente o del equipo llega al DOM)', () => {
  const html = R.renderVersions({ entries: [entrada({ who: '<img src=x onerror=alert(1)>', changes: [{ section: 'safety', kind: 'added', text: 'Alergia agregada: <script>alert(1)</script>' }] })] });
  assert.doesNotMatch(html, /<script|<img/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(R.renderVersionsMessage('<b>x</b>', 'error'), /<b>/);
});

test('renderVersions(): versiones sin cambios, primera versión, no comparables, lista vacía y tope', () => {
  assert.match(R.renderVersions({ entries: [entrada({ changes: [] })] }), /Se guardó sin cambios en los datos\./);
  assert.match(R.renderVersions({ entries: [entrada({ revision: 1, isFirst: true, changes: [] })] }), /Historia creada sin datos\./);
  assert.match(R.renderVersions({ entries: [entrada({ changes: null })] }), /no se puede comparar: la versión anterior no está disponible/);
  const vacio = R.renderVersions({ entries: [] });
  assert.match(vacio, /Aún no hay versiones registradas\./);
  assert.doesNotMatch(vacio, /<ol/);
  assert.match(R.renderVersions({ entries: [entrada()], more: true }), /Se muestran las últimas 1 versiones\. Las anteriores se conservan en el expediente\./);
});

test('renderVersionsMessage(): errores como alerta y avisos como estado', () => {
  assert.match(R.renderVersionsMessage('No tienes permiso.', 'error'), /role="alert"[^>]*>|data-tone="error" role="alert">No tienes permiso\./);
  assert.match(R.renderVersionsMessage('Algo.'), /data-tone="info" role="status">Algo\./);
});

test('el botón "Historial de cambios" lo ve también quien solo puede leer; los de edición, solo quien puede escribir', () => {
  const modelo = { updated: '4 nov', revision: 3, coverage: { done: 0, total: 6, pending: [] }, sections: [] };
  const lectura = R.render({ ...modelo, canWrite: false });
  assert.match(lectura, /data-hc-versions>Historial de cambios<\/button>/);
  assert.doesNotMatch(lectura, /data-hc-add|data-history-edit/);
  const escritura = R.render({ ...modelo, canWrite: true });
  assert.match(escritura, /data-hc-versions/);
  assert.match(escritura, /data-hc-add="allergy"/);
  assert.match(escritura, /data-history-edit/);
});

test('cableado en la ficha: consulta las últimas versiones con una fila extra, nombra a quien cambió y no rompe si falla', () => {
  const patient = read('smyl-patient-360.js'), css = read('smyl-patient-360.css');
  assert.match(patient, /from\('smyl_patient_history_versions'\)\.select\('revision,document,updated_by,updated_at'\)/);
  assert.match(patient, /\.order\('revision',\{ascending:false\}\)\.limit\(limit\+1\)/, 'pide una fila más para poder comparar la última mostrada');
  assert.match(patient, /select\('id,display_name,user_id'\)/, 'los profesionales traen user_id para nombrar a quien cambió');
  assert.match(patient, /from\('camila_usuarios'\)\.select\('id,nombre'\)/);
  assert.doesNotMatch(patient, /camila_usuarios'\)\.select\('[^']*email/, 'no se muestran correos del equipo');
  assert.match(patient, /entry\.updated_by===s\.actor\?'Tú':names\[entry\.updated_by\]\|\|'Miembro del equipo'/);
  assert.match(patient, /\[data-hc-versions\]/);
  assert.match(patient, /renderVersionsMessage\(msg\(e\),'error'\)/);
  assert.match(patient, /function waiting\(\)\{return dlg\.open&&dlg\.querySelector\('\.p360-hv-wait'\);\}/, 'una respuesta tardía no pisa otro diálogo');
  for (const cls of ['p360-hv-list', 'p360-hv-item', 'p360-hv-changes', 'p360-hv-sec', 'p360-hv-message']) assert.match(css, new RegExp(cls));
  assert.doesNotMatch(css.slice(css.indexOf('Historial de cambios (diálogo)')), /font-size:\s*(?:[0-9]|1[01])px/, 'sin microtexto fuera de la escala');
});
