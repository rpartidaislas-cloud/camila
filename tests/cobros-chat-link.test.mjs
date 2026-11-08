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
