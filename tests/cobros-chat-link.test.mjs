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
