import test from 'node:test';
import assert from 'node:assert/strict';
import { API_BASE, normalizeFacturapiPath, organizationSummary, publicConnectionStatus, validateTestSecret } from '../supabase/functions/_shared/facturapi-core.mjs';

test('Facturapi queda fijado al API oficial y sólo acepta llaves sandbox',()=>{
  assert.equal(API_BASE,'https://www.facturapi.io/v2');
  assert.equal(validateTestSecret(['sk','live','abcdefghijklmnopqrstuvwxyz'].join('_')).ok,false);
  assert.equal(validateTestSecret(['sk','test','abcdefghijklmnopqrstuvwxyz'].join('_')).ok,true);
});

test('las rutas no pueden escapar al host de Facturapi',()=>{
  assert.equal(normalizeFacturapiPath('/organizations/me'),'/organizations/me');
  assert.throws(()=>normalizeFacturapiPath('//evil.example'));
  assert.throws(()=>normalizeFacturapiPath('https://evil.example'));
});

test('el estado público nunca devuelve material cifrado',()=>{
  const status=publicConnectionStatus({status:'connected',organization_id:'org_1',organization_name:'Clínica',key_fingerprint:'ABCDEF123456',secret_ciphertext:'secret',secret_iv:'iv'},true);
  assert.equal(status.connected,true);
  assert.equal(status.environment,'test');
  assert.equal('secret_ciphertext' in status,false);
  assert.equal('secret_iv' in status,false);
});

test('la organización remota se reduce a identificadores operativos',()=>{
  assert.deepEqual(organizationSummary({id:'org_1',name:'Clínica Uno',legal:{rfc:'SECRET'}}),{id:'org_1',name:'Clínica Uno'});
});
