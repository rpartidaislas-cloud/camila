// Radiografía asistida — Etapa 5: informe clínico asistido y firma (modelo de navegador + cableado).
// La firma, inmutabilidad, adendas y exportación del servidor están cubiertas en PGlite
// (tests/radiograph-pglite-stage1.test.mjs); la pantalla, en tests/smyl-radiograph-report-browser.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const R = require('../smyl-radiograph-report.js');
const cid = n => `c${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;
const entries = [
  { candidateId: cid(1), state: 'confirmed', fdi: '16', fdiModel: '16', renumbered: false, evaluable: true, note: '' },
  { candidateId: cid(2), state: 'corrected', fdi: '24', fdiModel: '14', renumbered: true, evaluable: true, note: 'Renumerada por superposición.' },
  { candidateId: cid(3), state: 'pending', fdi: '13', fdiModel: '13', renumbered: false, evaluable: true, note: '' },
  { candidateId: cid(4), state: 'rejected', fdi: '46', fdiModel: '46', renumbered: false, evaluable: true, note: '' },
  { candidateId: cid(5), state: 'confirmed', fdi: '45', fdiModel: '45', renumbered: false, evaluable: false, note: '' },
];
const findings = [
  { candidateId: cid(90), state: 'confirmed', fdi: '12', payload: { category: 'apparently_missing', label: 'Pieza aparentemente no visible' }, label: '', note: '' },
  { candidateId: cid(91), state: 'rejected', fdi: '16', payload: { category: 'restoration', label: 'Restauración radiopaca aparente' }, label: '', note: '' },
  { candidateId: cid(92), state: 'pending', fdi: '16', payload: { category: 'restoration', label: 'Restauración radiopaca aparente' }, label: '', note: '' },
];
const qc = { studyClass: { value: 'panoramic' }, quality: { status: 'limited', flags: [{ code: 'anterior_blur', severity: 'moderate', explanation: 'Desenfoque anterior leve.' }] }, blockedAnalyses: [{ code: 'finding_candidates', reason: 'Desenfoque.' }] };

test('el borrador nace sólo con decisiones confirmadas/corregidas; pendientes, descartadas y no evaluables quedan fuera', () => {
  const { doc, removed } = R.buildDraft({ entries, findings, qc, previous: null });
  assert.deepEqual(doc.findings.map(f => [f.candidateId, f.tooth, f.priority]), [[cid(1), '16', 'routine'], [cid(2), '24', 'routine'], [cid(90), '12', 'routine']]);
  assert.match(doc.findings[1].text, /renumerada por el profesional/);
  assert.match(doc.findings[2].text, /no implica ausencia, confirmar clínicamente/);
  assert.match(doc.sections.technicalLimitations, /panorámica.*limitada.*desenfoque anterior \(moderada\).*Análisis no aplicado: finding_candidates/);
  assert.equal(doc.sections.description, '');
  assert.deepEqual(removed, []);
  assert.doesNotMatch(JSON.stringify(doc), /ausente|diagn/i);
});

test('al reconstruir se conservan texto y prioridad del profesional y se retiran hallazgos que dejaron de estar confirmados', () => {
  const previous = { sections: { description: 'Texto previo.', technicalLimitations: 'Mis limitaciones.', clinicalCorrelation: '', missingInformation: '', complementaryStudies: 'CBCT considerado.' },
    findings: [{ candidateId: cid(1), tooth: '16', text: 'Mi redacción de 16.', priority: 'soon' }, { candidateId: cid(4), tooth: '46', text: 'Antes confirmada.', priority: 'urgent' }] };
  const { doc, removed } = R.buildDraft({ entries, findings, qc, previous });
  assert.deepEqual(doc.findings.find(f => f.candidateId === cid(1)), { candidateId: cid(1), tooth: '16', text: 'Mi redacción de 16.', priority: 'soon' });
  assert.deepEqual(removed, [cid(4)]);
  assert.equal(doc.sections.technicalLimitations, 'Mis limitaciones.');
  assert.equal(doc.sections.complementaryStudies, 'CBCT considerado.');
});

test('diff: piezas no sustentadas, afirmaciones de certeza (sólo estricto) y descripción vacía', () => {
  const { doc } = R.buildDraft({ entries, findings, qc });
  doc.sections.description = 'Se observa la pieza 16 y la pieza 25 con cambio; diagnóstico confirmado.';
  const soft = R.diff(doc);
  assert.deepEqual(soft.warnings.map(w => w.code), ['extra_tooth']);
  assert.equal(soft.warnings[0].tooth, '25');
  assert.equal(soft.blocking, false, 'el texto del profesional sólo recibe avisos');
  const strict = R.diff(doc, { strict: true });
  assert.deepEqual(strict.warnings.map(w => w.code), ['extra_tooth', 'claim']);
  assert.equal(strict.blocking, true, 'el texto del modelo se bloquea');
  doc.sections.description = '';
  assert.deepEqual(R.diff(doc).warnings.map(w => w.code), ['empty_description']);
  assert.equal(R.diff(doc).blocking, false);
});

test('parseAssist: la IA sólo puede ordenar y redactar; cualquier adición, omisión o certeza se descarta', () => {
  const { doc } = R.buildDraft({ entries, findings, qc });
  const ids = doc.findings.map(f => f.candidateId);
  const ok = R.parseAssist(JSON.stringify({ findingsOrder: ids.slice().reverse(), sections: { description: 'Hallazgos en pieza 16, pieza 24 y pieza 12 por correlacionar.', clinicalCorrelation: 'Explorar clínicamente.' } }), doc);
  assert.deepEqual(ok.findings.map(f => f.candidateId), ids.slice().reverse());
  assert.equal(ok.sections.description, 'Hallazgos en pieza 16, pieza 24 y pieza 12 por correlacionar.');
  assert.equal(ok.sections.technicalLimitations, doc.sections.technicalLimitations, 'secciones no devueltas se conservan');
  assert.equal(ok.sections.complementaryStudies, '', 'estudios complementarios nunca los redacta la IA');
  assert.throws(() => R.parseAssist(JSON.stringify({ findingsOrder: ids.slice(0, 2), sections: {} }), doc), /añadir o quitar hallazgos/);
  assert.throws(() => R.parseAssist(JSON.stringify({ findingsOrder: [...ids, 'extra'], sections: {} }), doc), /añadir o quitar hallazgos/);
  assert.throws(() => R.parseAssist(JSON.stringify({ findingsOrder: ids, sections: { description: 'Lesión en pieza 25.' } }), doc), /menciona la pieza 25/);
  assert.throws(() => R.parseAssist(JSON.stringify({ findingsOrder: ids, sections: { description: 'Caries confirmada en pieza 16.' } }), doc), /afirmación de certeza/);
  assert.throws(() => R.parseAssist(JSON.stringify({ findingsOrder: ids, sections: { complementaryStudies: 'Pedir CBCT.' } }), doc), /no permitidas/);
  assert.throws(() => R.parseAssist(JSON.stringify({ findingsOrder: ids, sections: { description: 'x'.repeat(1501) } }), doc), /no es válida/);
  assert.throws(() => R.parseAssist('no json', doc), /JSON válido/);
  assert.match(R.ASSIST_SYSTEM, /Prohibido: añadir piezas, hallazgos, diagnósticos/);
});

test('la vista imprimible muestra autoría, versión, hash, limitaciones, trazabilidad del motor, adendas y aviso', () => {
  const html = R.printable({ report: { document: { sections: { description: 'Desc', technicalLimitations: 'Lim <b>', clinicalCorrelation: '', missingInformation: '', complementaryStudies: '' }, findings: [{ tooth: '16', priority: 'soon', text: 'T' }] }, signed_by: 'u1', signed_professional_id: 'p1', signed_at: '2026-10-28T10:00:00Z', revision: 3, signed_hash: 'a'.repeat(64) },
    source: { studyTypeCurrent: 'panoramic', sha256: 'b'.repeat(64), mimeType: 'image/png' }, runs: [{ kind: 'qc', engine: { provider: 'simulated', name: 'smyl-sim-xray', version: '0.1.0' }, contractVersion: 1, status: 'completed' }], addenda: [{ created_at: '2026-10-28T11:00:00Z', reason: 'Motivo', content: 'Contenido' }], notice: 'No constituye diagnóstico automático.' }, { label: 'Panorámica' });
  for (const s of ['usuario u1', 'profesional p1', 'versión 3', 'a'.repeat(64), 'Lim &lt;b&gt;', 'smyl-sim-xray 0.1.0', 'Motivo', 'No constituye diagnóstico automático.', 'Pieza 16', 'Pronto']) assert.ok(html.includes(s), s);
  assert.doesNotMatch(html, /<b>/, 'el contenido se escapa');
});

test('cableado: botón en la mesa v2 detrás de report_v1, proxy claude existente, web/PWA/móvil sincronizados', () => {
  const mesa = read('smyl-radiograph-review-v2.js'), ui = read('smyl-radiograph-report.js'), app = read('app.html'), sw = read('sw.js');
  assert.match(mesa, /run\.api\.caps\.flags\['radiograph\.report_v1'\]===true&&typeof window\.SmylRadiographReport\?\.open==='function'/);
  assert.match(ui, /url\.pathname!=='\/functions\/v1\/claude'/);
  assert.match(ui, /model:'claude-sonnet-4-6',max_tokens:3000,system:ASSIST_SYSTEM/);
  assert.doesNotMatch(ui, /type:'image'|base64/, 'la redacción asistida sólo envía datos estructurados, nunca la imagen');
  assert.match(ui, /client\.rpc\('smyl_radiograph_sign_report'/);
  assert.match(ui, /client\.rpc\('smyl_radiograph_add_report_addendum'/);
  assert.match(ui, /client\.rpc\('smyl_radiograph_export_report'/);
  for (const tag of ['smyl-radiograph-report.css?v=1', 'smyl-radiograph-report.js?v=2', 'smyl-radiograph-review-v2.js?v=5']) { assert.ok(app.includes(tag), tag); assert.ok(sw.includes('/camila/' + tag), tag); }
  assert.match(sw, /radiograph-report-v48/);
  for (const file of ['app.html', 'sw.js', 'smyl-radiograph-review-v2.js', 'smyl-radiograph-report.js', 'smyl-radiograph-report.css']) assert.equal(read('mobile/www/' + file), read(file), 'mobile/www desincronizado: ' + file);
  assert.match(read('mobile/scripts/sync-web.js'), /'smyl-radiograph-report\.js', 'smyl-radiograph-report\.css'/);
});

test('guarda de piezas: plurales, listas, cifras sueltas y ancho completo; unidades y fechas no cuentan', () => {
  const m = t => R.mentionedTeeth(t).sort();
  assert.deepEqual(m('Piezas 36, 46 y 47 con cambio'), ['36', '46', '47']);
  assert.deepEqual(m('dientes 11-12'), ['11', '12']);
  assert.deepEqual(m('radiopacidad en 36 y también en 26'), ['26', '36']);
  assert.deepEqual(m('ｐieza ３６'), ['36'], 'NFKC');
  for (const text of ['12 meses', 'control 10/12', 'el 18% del área', '2.36 mm', 'fecha 12-11-2025', '36 mm']) assert.deepEqual(m(text), [], text);
});

test('la guarda estricta sólo juzga lo que la IA cambió; el texto del profesional no se rechaza por sus propias palabras', () => {
  const { doc } = R.buildDraft({ entries, findings, qc });
  doc.sections.clinicalCorrelation = 'Diagnóstico previo del profesional: ya confirmado en consulta.';
  const ids = doc.findings.map(f => f.candidateId);
  const ok = R.parseAssist(JSON.stringify({ findingsOrder: ids, sections: { description: 'Pieza 16 y pieza 24 localizadas.' } }), doc);
  assert.equal(ok.sections.clinicalCorrelation, doc.sections.clinicalCorrelation, 'sección no tocada por la IA se conserva');
  assert.throws(() => R.parseAssist(JSON.stringify({ findingsOrder: ids, sections: { clinicalCorrelation: 'Diagnóstico previo del profesional: ya confirmado en consulta. Certeza total.' } }), doc), /afirmación|certeza|descart/i);
});

test('esc escapa comillas simples y acentos graves; la redacción asistida pide confirmación, se puede cancelar y vence (estático)', () => {
  assert.equal(R.esc(`<a href="x" onclick='y'>\``), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&#96;');
  const src = fs.readFileSync(new URL('../smyl-radiograph-report.js', import.meta.url), 'utf8');
  assert.match(src, /confirmDialog\('Enviar texto a la redacción asistida'/);
  assert.match(src, /setTimeout\(\(\)=>controller\.abort\(\),60000\)/);
  assert.match(src, /Cancelar redacción/);
  assert.match(src, /addendumDraft/, 'la adenda escrita no se pierde si falla');
  assert.match(src, /box\.setAttribute\('aria-live','polite'\)/);
  assert.match(src, /catch\(e\)\{try\{await reload\(\);\}catch\(_\)\{\}throw e;\}/, 'recarga si la firma falla tras guardar');
});
