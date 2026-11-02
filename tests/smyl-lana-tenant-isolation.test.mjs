// SMYL usa el motor de chat de LANA pero con su contexto aparte: sólo se vincula a tenants de LANA de producto "smyl",
// nunca a una cuenta comercial, y un tenant de LANA no se comparte entre dos clínicas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decideLanaLink, readLanaContract, SMYL_PRODUCT } from '../supabase/functions/_shared/lana-contract.mjs';
const connection = fs.readFileSync(new URL('../supabase/functions/lana-connection/index.ts', import.meta.url), 'utf8');
const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('readLanaContract: lee producto y tenant, ignora basura', () => {
  assert.deepEqual(readLanaContract({ contract: { product: ' SMYL ', tenant_id: T.toUpperCase() } }), { product: 'smyl', lanaTenantId: T });
  assert.deepEqual(readLanaContract({ contract: { product: 7, tenant_id: 'no-uuid' } }), { product: null, lanaTenantId: null });
  assert.deepEqual(readLanaContract(null), { product: null, lanaTenantId: null });
  assert.deepEqual(readLanaContract({ ok: true }), { product: null, lanaTenantId: null });
});

test('decideLanaLink: el código manual exige confirmación; una cuenta comercial siempre se rechaza', () => {
  assert.equal(SMYL_PRODUCT, 'smyl');
  assert.deepEqual(decideLanaLink({ product: 'smyl' }, { strict: true }), { ok: true, verified: true, code: '', message: '' });
  assert.equal(decideLanaLink({ product: 'lana' }, { strict: true }).code, 'wrong_product');
  assert.equal(decideLanaLink({ product: 'lana' }, { strict: false }).code, 'wrong_product', 'tampoco al verificar un enlace existente');
  assert.equal(decideLanaLink({ product: null }, { strict: true }).code, 'product_unconfirmed', 'sin confirmación, el manual falla cerrado');
  assert.deepEqual(decideLanaLink({ product: null }, { strict: false }), { ok: true, verified: false, code: '', message: '' }, 'alta automática/verificación: se acepta pero queda sin verificar');
  assert.match(decideLanaLink({ product: 'lana' }, { strict: true }).message, /cuenta comercial/);
});

test('lana-connection: conectar es estricto, el alta y la verificación usan la decisión, y un tenant LANA no se comparte', () => {
  assert.match(connection, /await assertLinkable\(identity, auth\.tenantId, true\)/, 'conectar manual: strict');
  assert.match(connection, /assertLinkable\(\{ product: identity\.product[\s\S]*?, auth\.tenantId, false\)/, 'alta automática: no strict');
  assert.match(connection, /decideLanaLink\(identity, \{ strict: false \}\)/, 'verificar: no strict');
  assert.match(connection, /config->integraciones->lana->>lana_tenant_id/, 'unicidad del tenant LANA entre clínicas');
  assert.match(connection, /\.neq\("id", tenantId\)/);
  assert.match(connection, /verification\?\.failure === "wrong_product"/, 'un tenant no-SMYL deja el enlace en "requiere atención"');
  assert.match(connection, /product_verified/);
  assert.doesNotMatch(connection, /await verifyLanaApiKey\(apiKey\);\s*const encrypted/, 'ya no se acepta cualquier llave sin comprobar su producto');
});
