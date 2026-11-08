import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('la sección se llama Cobros en la navegación, el título y la pantalla (web y móvil)', () => {
  for (const base of ['', 'mobile/www/']) {
    assert.match(read(base + 'smyl-navigation.js'), /\['Cobros', 'caja', 'cash'\]/);
    assert.match(read(base + 'smyl-professional-v3.js'), /caja:\['Cobros'/);
    assert.match(read(base + 'smyl-finance.js'), /<h1>Cobros<\/h1>/);
    assert.doesNotMatch(read(base + 'smyl-navigation.js'), /\['Finanzas'/);
  }
});

test('Cobros ofrece «Abrir chat» sólo si el paciente tiene chat vinculado, leyendo camila_lana_handoffs', () => {
  for (const base of ['', 'mobile/www/']) {
    const f = read(base + 'smyl-finance.js');
    assert.match(f, /from\('camila_lana_handoffs'\)\.select\('patient_id,lana_conversation_id,lana_channel,updated_at'\)/);
    assert.match(f, /chatLinks\[x\.p\.id\]\?'<button data-chat=/);
    assert.match(f, /window\.SmylInbox\.open\(l\.conversation\)/);
    assert.match(f, /accountSummary:accountSummary,account:function\(patientId\)/);
  }
});

test('el chat muestra la tarjeta «Cuenta del paciente» sólo con finance.read y paciente vinculado, y cobra sólo con finance.manage', () => {
  for (const base of ['', 'mobile/www/']) {
    const i = read(base + 'smyl-inbox.js');
    assert.match(i, /hasPermission\('finance\.read'\) && window\.SmylFinance && typeof window\.SmylFinance\.accountSummary === 'function'/);
    assert.match(i, /Vincula al paciente para ver su saldo y cobrar desde esta conversación\./);
    assert.match(i, /hasPermission\('finance\.manage'\) && canOperate\(conversation, 'finance\.manage'\)\) \{\s*var chargeButton/);
    assert.match(i, /loadAccountContext\(conversationId\);/);
  }
});

test('Cobros tiene la pestaña Plantillas conectada a SmylTemplates y el catálogo trae las 4 plantillas nuevas de cobro, válidas', async () => {
  for (const base of ['', 'mobile/www/']) {
    const f = read(base + 'smyl-finance.js');
    assert.match(f, /<button data-finance-tab="templates">Plantillas<\/button>/);
    assert.match(f, /<section data-finance-panel="templates" hidden>/);
    assert.match(f, /T\.summary\('pagos'\)/);
    assert.match(f, /data-tpl-request/);
    const t = read(base + 'smyl-templates.js');
    assert.match(t, /summary: summary, request: requestTemplate, show: showTemplates/);
    assert.match(t, /onChange: function \(fn\)/);
  }
  const catalog = (await import('../smyl-template-catalog.js')).default;
  const ids = catalog.TEMPLATES.map((x) => x.id);
  for (const id of ['estado_cuenta_v1', 'comprobante_pago_v1', 'plan_pagos_acordado_v1', 'saldo_vencido_aviso_v1']) {
    assert.ok(ids.includes(id), id);
    assert.deepEqual(catalog.validate(catalog.TEMPLATES.find((x) => x.id === id)), [], id);
    assert.equal(catalog.TEMPLATES.find((x) => x.id === id).group, 'pagos');
  }
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  assert.ok(!ids.some((id) => /transfer|clabe/i.test(id)), 'no se piden datos bancarios por plantilla');
});

// ── Fase 2: variables de las plantillas de cobro tomadas de la cuenta (código real del chat) ──
function cobroFns(state) {
  const src = read('smyl-inbox.js');
  const a = src.indexOf("var COBRO_PLANTILLAS");
  const b = src.indexOf('async function openCobroTemplate');
  assert.ok(a > 0 && b > a, 'no se encontró el bloque de cobros');
  return new Function('state', 'availabilityClinicName', src.slice(a, b) + ';return {cobroVariables,cobroPreferidas,COBRO_PLANTILLAS};')(state, () => 'Clínica Sonríe');
}

test('plantillas de cobro: monto, vencimiento y nombre salen de la cuenta; lo que falta queda vacío para completarlo', () => {
  const conv = { id: 'c1', contact_name: 'Ana Pérez' };
  const state = { accountContext: { c1: { data: { due: 1500, nextDue: '2026-12-25', nextBalance: 500, overdueAmount: 900, overdueCount: 1, lastPaymentAmount: 700 } } }, clinical: { c1: { patient: { name: 'Ana María Pérez' } } } };
  const { cobroVariables } = cobroFns(state);
  assert.deepEqual(cobroVariables('pago_pendiente_v1', conv), ['Ana', '$1,500.00', 'Clínica Sonríe', '25 de diciembre']);
  assert.deepEqual(cobroVariables('saldo_actualizado_v1', conv), ['Ana', 'Clínica Sonríe', '$1,500.00']);
  assert.deepEqual(cobroVariables('estado_cuenta_v1', conv), ['Ana', 'Clínica Sonríe', '$1,500.00', '25 de diciembre']);
  assert.deepEqual(cobroVariables('saldo_vencido_aviso_v1', conv), ['Ana', '$900.00', 'Clínica Sonríe', '25 de diciembre']);
  assert.deepEqual(cobroVariables('plan_pagos_proximo_v1', conv), ['Ana', '$500.00', 'Clínica Sonríe', '25 de diciembre']);
  assert.deepEqual(cobroVariables('pago_recibido_v1', conv), ['Ana', '$700.00', 'Clínica Sonríe']);
  assert.deepEqual(cobroVariables('comprobante_pago_v1', conv), ['Ana', '', '$700.00', 'Clínica Sonríe']);
});

test('plantillas de cobro: sin cuenta consultada o con otra plantilla no se llena nada', () => {
  const conv = { id: 'c1', contact_name: 'Ana' };
  const { cobroVariables } = cobroFns({ accountContext: {}, clinical: {} });
  assert.equal(cobroVariables('pago_pendiente_v1', conv), null);
  const { cobroVariables: f2 } = cobroFns({ accountContext: { c1: { data: { due: 10 } } }, clinical: {} });
  assert.equal(f2('recordatorio_cita_v1', conv), null);
  assert.equal(f2('pago_pendiente_v1', conv)[0], 'Ana');
  assert.equal(f2('pago_pendiente_v1', conv)[3], '');
});

test('plantillas de cobro: la plantilla sugerida depende del estado de la cuenta', () => {
  const { cobroPreferidas } = cobroFns({});
  assert.equal(cobroPreferidas({ overdueCount: 2, due: 10 })[0], 'saldo_vencido_aviso_v1');
  assert.equal(cobroPreferidas({ overdueCount: 0, due: 10 })[0], 'pago_pendiente_v1');
  assert.equal(cobroPreferidas({ overdueCount: 0, due: 0 })[0], 'pago_recibido_v1');
});

test('el chat ofrece «Enviar por WhatsApp» sólo en WhatsApp con permiso de responder, avisa si se repite el mismo mensaje y no abre nada si no hay plantilla aprobada', () => {
  for (const base of ['', 'mobile/www/']) {
    const i = read(base + 'smyl-inbox.js');
    assert.match(i, /conversation\.channel === 'whatsapp' && hasPermission\('messages\.respond'\) && canOperate\(conversation, 'messages\.respond'\)\) \{\s*var sendWhatsapp/);
    assert.match(i, /Ya enviaste este mismo mensaje el /);
    assert.match(i, /No hay una plantilla de cobro aprobada todavía/);
    assert.match(i, /async function openTemplateDialog\(preferred\)/);
    assert.match(i, /cobroVariables\(template\.name, selectedConversation\(\)\)/);
  }
});

test('el resumen de cuenta expone el saldo del próximo cargo y el último pago', () => {
  const f = read('smyl-finance.js');
  const m = f.match(/function summarizeAccount\(d,today\)\{[^\n]*\n/);
  const sum = new Function(m[0] + ';return summarizeAccount;')();
  const r = sum({
    charges: [{ id: 'c1', status: 'posted', total_amount: 1000, due_on: '2026-12-01' }, { id: 'c2', status: 'posted', total_amount: 300, due_on: '2026-11-20' }],
    payments: [{ id: 'p1', amount: 50, paid_at: '2026-10-01T10:00:00Z' }, { id: 'p2', amount: 120, paid_at: '2026-11-02T10:00:00Z' }],
    allocations: [], refunds: [], refundAllocations: [],
  }, '2026-11-08');
  assert.equal(r.nextBalance, 300);
  assert.equal(r.lastPaymentAmount, 120);
});
