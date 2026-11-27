import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('migración: requires_quote nullable (según categoría) y RPC «Por cotizar» solo lectura', () => {
  const sql = read('supabase/migrations/20261201300000_smyl_service_requires_quote.sql');
  assert.match(sql, /add column if not exists requires_quote boolean;/);
  assert.doesNotMatch(sql, /requires_quote boolean not null/);
  assert.doesNotMatch(sql, /update public\.smyl_services/i);
  assert.match(sql, /coalesce\(s\.requires_quote, s\.category in \('surgery', 'prosthodontic', 'aesthetic', 'orthodontic', 'implantology', 'endodontic'\)\)/);
  assert.match(sql, /smyl_has_permission\(v_tenant, 'proposal\.read'\)/);
  assert.match(sql, /grant execute on function public\.smyl_patients_needing_quote\(integer\) to authenticated/);
  assert.doesNotMatch(sql, /grant execute[^;]*to anon/);
});

test('catálogo y cotizaciones usan la marca sin romper si la columna no existe', () => {
  const catalog = read('smyl-service-catalog.js'), proposals = read('smyl-proposals.js');
  assert.match(catalog, /function rqOk\(\)\{return state\.services\.some\(function\(x\)\{return 'requires_quote' in x;\}\);\}/);
  assert.match(catalog, /if\(rqOk\(\)&&state\.canManage\)row\.requires_quote=/);
  assert.match(proposals, /smyl_patients_needing_quote/);
  assert.match(proposals, /toQuoteSection/);
});

test('web, PWA y móvil publican la misma versión', () => {
  for (const f of ['smyl-service-catalog.js', 'smyl-proposals.js', 'smyl-proposals.css', 'app.html', 'sw.js'])
    assert.equal(read(f), read('mobile/www/' + f), f);
  assert.match(read('app.html'), /smyl-proposals\.js\?v=32/);
  assert.match(read('sw.js'), /requiere-presupuesto-v1/);
});
