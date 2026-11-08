import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Cotizaciones tiene entrada propia en la barra lateral (web y móvil) y el nombre es único en títulos y pantalla', () => {
  for (const base of ['', 'mobile/www/']) {
    const nav = read(base + 'smyl-navigation.js');
    assert.match(nav, /\['Cobros', 'caja', 'cash'\],\s*\['Cotizaciones', 'propuestas', 'quote'\]/);
    assert.match(nav, /quote: '<path d="M14 2H6a2 2 0 0 0-2 2v16/);
    const panel = read(base + 'smyl-panel.js');
    assert.match(panel, /TITULOS\.propuestas = 'Cotizaciones'/);
    assert.doesNotMatch(panel, /'Presentaciones'/);
    assert.match(read(base + 'smyl-professional-v3.js'), /propuestas:\['Cotizaciones','Seguimiento de las cotizaciones a tus pacientes'\]/);
    const p = read(base + 'smyl-proposals.js');
    assert.match(p, /n\('h1','','Cotizaciones'\)/);
    assert.doesNotMatch(p, /n\('h1','','Presentaciones'\)/);
  }
});

// Ejecuta el código real de las etapas y de los importes/días del tablero.
function loadHelpers() {
  const src = read('smyl-proposals.js');
  const stage = src.match(/function proposalStage\(row,event\)\{[\s\S]*?\r?\n  \}\r?\n/)[0];
  const age = src.match(/function quoteAge\(iso\)\{[^\n]*\n/)[0] + src.match(/function quoteAgeLabel\(d\)\{[^\n]*\n/)[0] + src.match(/function quoteFirstName\(row\)\{[^\n]*\n/)[0] + src.match(/function quoteTitle\(row\)\{[^\n]*\n/)[0] + src.match(/function quoteTotal\(row\)\{[^\n]*\n/)[0];
  return new Function(stage + age + ';return {proposalStage,quoteAge,quoteAgeLabel,quoteFirstName,quoteTitle,quoteTotal};')();
}

test('etapas: la cotización pasa de borrador a lista, presentada y decidida según su último evento', () => {
  const h = loadHelpers();
  const base = { status: 'approved', document: { valid_until: '2999-01-01' } };
  assert.equal(h.proposalStage({ status: 'draft', document: {} }, null).key, 'draft');
  assert.equal(h.proposalStage(base, null).key, 'ready');
  assert.equal(h.proposalStage(base, { event_type: 'presented', occurred_at: new Date().toISOString() }).key, 'awaiting');
  assert.equal(h.proposalStage(base, { event_type: 'accepted', occurred_at: new Date().toISOString() }).key, 'accepted');
  assert.equal(h.proposalStage(base, { event_type: 'changes_requested', occurred_at: new Date().toISOString() }).key, 'changes_requested');
  assert.equal(h.proposalStage({ status: 'approved', document: { valid_until: '2000-01-01' } }, null).key, 'expired');
});

test('días sin respuesta, nombre, título y total por completar', () => {
  const h = loadHelpers();
  assert.equal(h.quoteAge(new Date(Date.now() - 6 * 86400000 - 1000).toISOString()), 6);
  assert.equal(h.quoteAge(null), null);
  assert.equal(h.quoteAgeLabel(0), 'hoy');
  assert.equal(h.quoteAgeLabel(1), 'ayer');
  assert.equal(h.quoteAgeLabel(6), 'hace 6 días');
  assert.equal(h.quoteFirstName({ patient_name: 'Ana María Pérez' }), 'Ana');
  assert.equal(h.quoteTitle({ document: { title: '  Plan   de\nrehabilitación ' } }), 'Plan de rehabilitación');
  assert.equal(h.quoteTitle({ document: {} }), 'Plan de tratamiento');
  assert.equal(h.quoteTotal({ total_cents: 5000, document: { items: [{ unit_cents: 100 }] } }), 5000);
  assert.equal(h.quoteTotal({ total_cents: 0, document: { items: [{ unit_cents: null }] } }), null);
});

test('acciones rápidas por etapa, con permiso de seguimiento y sin enviar nada solo (web y móvil)', () => {
  for (const base of ['', 'mobile/www/']) {
    const p = read(base + 'smyl-proposals.js');
    assert.match(p, /access\.followup&&key==='ready'\)box\.append\(b\('Marcar presentada'/);
    assert.match(p, /access\.followup&&key==='awaiting'\)box\.append\(b\('Registrar respuesta'/);
    assert.match(p, /key==='accepted'&&window\.SmylFinance&&typeof window\.SmylFinance\.fromProposal==='function'\)box\.append\(b\('Pasar a Cobros'/);
    assert.match(p, /smyl_record_proposal_event',\{p_event_id:eventId,p_proposal_id:item\.row\.id,p_proposal_revision:item\.row\.revision/);
    assert.match(p, /if\(\(type==='declined'\|\|type==='changes_requested'\)&&!text\)/);
    assert.match(p, /from\('camila_lana_handoffs'\)\.select\('patient_id,lana_conversation_id,lana_channel,updated_at'\)/);
    // el envío abre el diálogo de plantilla del chat con las variables ya puestas: lo confirma una persona
    assert.match(p, /window\.SmylInbox\.sendTemplate\(link\.conversation,\{preferred:names,variables:\[quoteFirstName\(item\.row\),quoteTitle\(item\.row\),quoteClinic\(item\.row\)\]/);
    assert.match(p, /onSent:function\(\)\{if\(item\.stage\.key==='ready'&&\(access\.followup\)\)\{record\(item,'presented','whatsapp'/);
    const i = read(base + 'smyl-inbox.js');
    assert.match(i, /sendTemplate: async function \(conversationId, options\)/);
    assert.match(i, /preset\.names\.indexOf\(template\.name\) !== -1 && Array\.isArray\(preset\.variables\)/);
    assert.match(i, /dialog\.dataset\.presetBound/);
  }
});

test('Cotizaciones: los indicadores muestran importes y las cotizaciones sin respuesta de 5 o más días', () => {
  const p = read('smyl-proposals.js');
  for (const text of ['Por presentar', 'Esperando respuesta', 'Requieren acción', 'Aceptación', 'sin respuesta hace 5+ días']) assert.ok(p.includes(text), text);
  assert.match(p, /proposalDashboard\(rows,latestEvents,list,access\)/);
});
