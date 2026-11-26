import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const suggest = require('../smyl-template-suggest.js');
const catalog = require('../smyl-template-catalog.js');

test('el mapa de plantillas por sección solo usa plantillas del catálogo, de Utilidad (nunca Marketing) y sin repetir dentro de una sección', () => {
  assert.deepEqual(Object.keys(suggest.SECTIONS), ['agenda', 'finanzas', 'cotizaciones', 'pacientes']);
  for (const [key, section] of Object.entries(suggest.SECTIONS)) {
    const ids = section.items.map(row => row[0]);
    assert.equal(new Set(ids).size, ids.length, key + ': sin repetidas');
    for (const row of section.items) {
      const template = catalog.TEMPLATES.find(item => item.id === row[0]);
      assert.ok(template, key + ': ' + row[0] + ' está en el catálogo');
      assert.equal(template.category, 'UTILITY', row[0] + ' no debe ser de Marketing');
      assert.ok(['essential', 'recommended'].includes(row[1]), row[0]);
      assert.ok(row[2] && row[2].length > 10, row[0] + ' explica para qué sirve');
    }
    assert.ok(section.items.some(row => row[1] === 'essential'), key + ' tiene esenciales');
  }
});

test('esenciales por sección: Agenda 8, Finanzas 5 (cobros y facturación), Cotizaciones 2, Pacientes 3', () => {
  assert.deepEqual(['agenda', 'finanzas', 'cotizaciones', 'pacientes'].map(key => suggest.essentialsOf(key).length), [8, 5, 2, 3]);
  const agenda = suggest.essentialsOf('agenda');
  for (const id of ['recordatorio_cita_confirmar_v1', 'cita_confirmada_v1', 'cita_reprogramada_v1', 'cita_cancelada_clinica_v1', 'cita_no_asistio_reagendar_v1', 'cita_motivo_no_reagenda_v1', 'cita_propuesta_paciente_v1', 'cita_confirmacion_profesional_v1']) assert.ok(agenda.includes(id), id);
  assert.ok(!agenda.includes('recordatorio_cita_24h_v1'), 'se recomienda la plantilla con botones, no la duplicada de 24 h');
  const finanzas = suggest.essentialsOf('finanzas');
  for (const id of ['pago_recibido_v1', 'pago_pendiente_v1', 'saldo_vencido_aviso_v1', 'factura_disponible_v1', 'datos_facturacion_pendientes_v1']) assert.ok(finanzas.includes(id), id);
});

test('plan: cuenta aprobadas, en revisión, con problemas y por solicitar; lo que falta es lo que se solicita en bloque', () => {
  const p = suggest.plan('agenda', { recordatorio_cita_confirmar_v1: 'APPROVED', cita_confirmada_v1: 'APPROVED', cita_cancelada_clinica_v1: 'PENDING', cita_reprogramada_v1: 'REJECTED' });
  assert.deepEqual([p.essential.total, p.essential.ready, p.essential.pending, p.essential.problems], [8, 2, 1, 1]);
  assert.deepEqual(p.essential.missing, ['cita_no_asistio_reagendar_v1', 'cita_motivo_no_reagenda_v1', 'cita_propuesta_paciente_v1', 'cita_confirmacion_profesional_v1'], 'una rechazada no se vuelve a pedir sola: se revisa en Plantillas');
  assert.equal(p.recommended.missing.length, 11);
  assert.equal(p.items.find(item => item.id === 'cita_reprogramada_v1').state, 'problem');
  assert.equal(suggest.plan('nada', {}), null);
  // función en lugar de objeto, y estados desconocidos cuentan como «por solicitar»
  const q = suggest.plan('cotizaciones', id => (id === 'cotizacion_lista_v1' ? 'APPROVED' : undefined));
  assert.deepEqual([q.essential.ready, q.essential.missing], [1, ['cotizacion_seguimiento_v1']]);
});

test('avance de «Puesta en marcha»: esenciales de la Agenda aprobadas / en revisión / por solicitar a partir de la lista de Meta', () => {
  const list = [
    { name: 'recordatorio_cita_confirmar_v1', status: 'APPROVED' }, { name: 'cita_confirmada_v1', status: 'APPROVED' },
    { name: 'cita_reprogramada_v1', status: 'PENDING' }, { name: 'otra_cosa_v1', status: 'APPROVED' }
  ];
  assert.deepEqual(suggest.essentialProgress('agenda', list), { total: 8, ready: 2, pending: 1, missing: 5 });
  assert.deepEqual(suggest.essentialProgress('agenda', []), { total: 8, ready: 0, pending: 0, missing: 8 });
  assert.deepEqual(suggest.sectionsOf('cita_lista_espera_v1'), ['agenda']);
  assert.deepEqual(suggest.sectionsOf('no_existe'), []);
});

test('solicitud en bloque: una sola confirmación, una tras otra con pausa, se detiene en el primer error y solo pide las que faltan', () => {
  const js = read('smyl-templates.js');
  assert.match(js, /async function requestMany\(ids\)/);
  assert.match(js, /statusKey\(template\) === 'NONE'/, 'solo las que aún no se han solicitado');
  assert.match(js, /if \(!\(await confirmMany\(list\)\)\) return/);
  assert.match(js, /setTimeout\(resolve, 1500\)/, 'pausa entre solicitudes');
  assert.match(js, /catch \(error\) \{ failed = \{[^}]*\}; break; \}/, 'se detiene en el primer error');
  assert.match(js, /!state\.canRequest/, 'solo el propietario');
  assert.match(js, /requestMany: requestMany/);
  assert.match(js, /Si Meta rechaza una, el envío se detiene/);
});

test('la tarjeta: solo propietario puede solicitar, no pinta en bucle y se monta en Agenda, Finanzas, Cotizaciones y Pacientes', () => {
  const js = read('smyl-template-suggest.js');
  for (const page of ['p-agenda', 'p-caja', 'p-propuestas', 'p-pacientes']) assert.ok(js.includes("'" + page + "'"), page);
  assert.match(js, /if \(canRequest && win\.SmylTemplates && win\.SmylTemplates\.requestMany\)/, 'solo el propietario ve el botón');
  assert.match(js, /Solo el propietario puede solicitarlas: pídeselo\./);
  assert.match(js, /current\.dataset\.sig === card\.dataset\.sig/, 'no se vuelve a pintar si nada cambió');
  assert.match(js, /records\.every\(own\)/, 'ignora los cambios que provoca la propia tarjeta');
  assert.match(js, /setAttribute\('role', 'progressbar'\)/);
  assert.match(js, /'Solicitar \(' \+ missing\.length/);
  assert.match(js, /DISMISS_DAYS = 14/, 'la franja se puede cerrar por 14 días');
  assert.match(js, /if \(!missing\.length && !problems\) return null/, 'solo aparece si falta algo');
  assert.match(js, /finance-tabcards/, 'en Finanzas va debajo de las pestañas');
  assert.doesNotMatch(js, /\.insert\(|\.update\(|\.delete\(|\.rpc\(|fetch\(/, 'solo usa el módulo de plantillas, sin tocar datos');
  assert.doesNotMatch(js, /\bLANA\b|\bLana\b/, 'no muestra el nombre del motor de mensajería');
  assert.match(read('smyl-template-suggest.css'), /\(max-width: 640px\)/);
  assert.match(read('smyl-template-suggest.css'), /min-height: 44px/);
});

test('cuando falta una plantilla al mandar un mensaje, el chat ofrece solicitarla en vez de un aviso sin salida', () => {
  const inbox = read('smyl-inbox.js');
  assert.equal((inbox.match(/window\.SmylTemplateSuggest\.offerMissing\(/g) || []).length, 2);
  assert.match(inbox, /offerMissing\(preferred, missingCopy\); else window\.alert\(missingCopy\)/);
  assert.match(inbox, /offerMissing\(names, missingCopy\); else window\.alert\(missingCopy\)/);
  const js = read('smyl-template-suggest.js');
  assert.match(js, /Falta una plantilla aprobada/);
  assert.match(js, /Solicitar ahora/);
  assert.match(js, /Ya la solicitaste: Meta la está revisando/);
  assert.match(js, /Solo el propietario puede solicitarla\./);
});

test('Puesta en marcha: el paso de plantillas es «las esenciales de la Agenda» y las pide en bloque', () => {
  const setup = read('smyl-clinic-setup.js');
  assert.match(setup, /title: 'Solicita las plantillas esenciales'/);
  assert.match(setup, /suggest\.essentialProgress\('agenda', list\)/);
  assert.match(setup, /window\.SmylTemplates\.requestMany\(window\.SmylTemplateSuggest\.essentialsOf\('agenda'\)\)/);
  // sin el módulo nuevo conserva la regla anterior
  assert.match(setup, /item\.status === 'APPROVED' && item\.category === 'UTILITY'/);
});

test('web, móvil y PWA publican el módulo nuevo después del de Plantillas', () => {
  const app = read('app.html'), worker = read('sw.js');
  assert.match(app, /<link rel="stylesheet" href="smyl-template-suggest\.css\?v=2">\s*<script defer src="smyl-template-catalog\.js\?v=9"><\/script>\s*<script defer src="smyl-templates\.js\?v=9"><\/script>\s*<script defer src="smyl-template-suggest\.js\?v=3"><\/script>/);
  assert.ok(app.indexOf('smyl-template-catalog.js') < app.indexOf('smyl-template-suggest.js'), 'el catálogo carga antes');
  assert.ok(worker.includes("'/camila/smyl-template-suggest.js?v=3'") && worker.includes("'/camila/smyl-template-suggest.css?v=2'"));
  for (const f of ['smyl-template-suggest.js', 'smyl-template-suggest.css', 'smyl-templates.js', 'smyl-inbox.js', 'smyl-clinic-setup.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});
