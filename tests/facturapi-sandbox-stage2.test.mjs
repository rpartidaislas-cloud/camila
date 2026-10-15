import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const migration=read('../supabase/migrations/20261014020000_smyl_facturapi_sandbox.sql');
const edge=read('../supabase/functions/facturapi-connection/index.ts');
const shared=read('../supabase/functions/_shared/facturapi.ts');
const finance=read('../smyl-finance.js');

test('la credencial queda aislada por clínica y sin SELECT desde el navegador',()=>{
  assert.match(migration,/create table public\.smyl_facturapi_connections/);
  assert.match(migration,/tenant_id uuid primary key/);
  assert.match(migration,/environment='test'/);
  assert.match(migration,/revoke all on table public\.smyl_facturapi_connections from public,anon,authenticated/);
  assert.doesNotMatch(migration,/grant select on table public\.smyl_facturapi_connections/);
});

test('el servidor cifra la llave con enlace criptográfico al tenant',()=>{
  assert.match(shared,/SMYL_FACTURAPI_ENCRYPTION_KEY/);
  assert.match(shared,/AES-GCM/);
  assert.match(shared,/additionalData: tenantBinding\(tenantId\)/);
  assert.match(edge,/auth\.user\.id === auth\.tenantId/);
  assert.match(edge,/validateTestSecret/);
});

test('la interfaz sólo ofrece sandbox y no timbrado real',()=>{
  assert.match(finance,/Facturapi sandbox/);
  assert.match(finance,/sk_test_/);
  assert.match(finance,/facturapi-connection/);
  assert.match(finance,/Esta etapa no timbra/);
});
