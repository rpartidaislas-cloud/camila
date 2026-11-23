import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import mila from '../smyl-periodontal-mila.js';
import { providerFacts, selectedFacts } from '../supabase/functions/periodontal-summary/contract.mjs';

test('dictado con cifras, números hablados, cara y orden explícitos', () => {
  assert.deepEqual(mila.parse('Pieza dieciséis, vestibular, tres cuatro cinco.'), { tooth: '16', face: 'V', values: [3, 4, 5] });
  assert.deepEqual(mila.parse('Diente treinta y seis lingual de distal a mesial 2, 3 y 4 milímetros'), { tooth: '36', face: 'I', values: [4, 3, 2] });
  assert.deepEqual(mila.parse('16 palatina 0 10 20'), { tooth: '16', face: 'I', values: [0, 10, 20] });
});

test('el reconocimiento ambiguo, fuera de rango o incompleto no propone valores', () => {
  for (const phrase of ['vestibular 4 4 3', 'pieza 16 y 12 vestibular 2 3 4', 'pieza 16 palatina 4 5',
    'pieza 16 palatina 4 5 6 5', 'pieza 16 palatina -3 3 4', 'pieza 16 palatina 3.5 3 4',
    'pieza 16 vestibular 4 0 21', 'pieza 36 palatina 5 5 5', 'pieza 16 vestibular sangrado tres cuatro cinco',
    'pieza 16 vestibular lingual 4 5 6']) assert.deepEqual(mila.parse(phrase).values, [], phrase);
});

const saved = { id: 'ex1', date: '2026-04-12', teeth: { 16: { MB: { depth: 0, margin: -2, bleeding: false }, DB: { depth: null, margin: null, bleeding: null } } } };
const previous = { id: 'ex0', date: '2025-11-04', teeth: { 16: { MB: { depth: 3, margin: null, bleeding: true } } } };
const ctx = { current: { ...saved, teeth: { 16: { MB: { depth: 10 } } } }, confirmed: saved, previous, tooth: '16',
  findings: [{ id: 'secret-id', source: 'photo', label: 'Texto reservado', tooth: '16' },
    { id: 'other', source: 'radiograph', label: 'Otra pieza', tooth: '26' }] };

test('el resumen parte de la evaluación persistida, sin atribuir medidas a imágenes ni completar ausencias', () => {
  assert.deepEqual(mila.factsFor({ ...ctx, confirmed: null }), []);
  assert.deepEqual(mila.factsFor({ ...ctx, confirmed: { ...saved, id: 'different' } }), []);
  const facts = mila.factsFor(ctx);
  const data = providerFacts(facts.map(f => f.data));
  assert.deepEqual(data, [
    { kind: 'site', site: 'MB', depth: 0, margin: -2, bleeding: false },
    { kind: 'change', site: 'MB', depth: 0, previous_depth: 3, bleeding: false, previous_bleeding: true },
    { kind: 'photo', count: 1 }
  ]);
  assert.doesNotMatch(JSON.stringify(data), /Texto reservado|secret-id|2026|Otra pieza|ex1/);
  const indices = selectedFacts({ output: [{ content: [{ type: 'output_text', text: '{"indices":[0]}' }] }] }, data);
  assert.deepEqual(indices, [0, 1, 2]);
  const text = mila.reviewText(facts, indices, '16');
  assert.match(text, /sondaje de 3 mm a 0 mm/);
  assert.match(text, /Texto reservado/);
  assert.doesNotMatch(text, /Otra pieza|10 mm/);
});

test('el servicio rechaza campos libres, sitios duplicados, cambios huérfanos y texto generado', () => {
  const ok = { kind: 'site', site: 'B', depth: 2 };
  for (const input of [[], [ok, ok], [{ ...ok, note: 'nombre' }], [{ ...ok, depth: 21 }],
    [{ ...ok, bleeding: 'false' }], [{ kind: 'photo', count: 1 }], [ok, { kind: 'change', site: 'MB', depth: 3, previous_depth: 2 }],
    [ok, { kind: 'change', site: 'B', depth: 4, previous_depth: 2 }]]) assert.equal(providerFacts(input), null);
  const data = [ok];
  for (const raw of ['{"indices":[1]}','{"indices":[0,0]}','{"indices":["0"]}','{"diagnosis":"inventado"}']) {
    assert.equal(selectedFacts({ output_text: raw }, data), null);
  }
  assert.equal(mila.reviewText([{ data: ok, text: 'real' }], [5], '16'), '');
});

test('el handler rechaza la falta de permiso, alcance, saldo y respuesta incorrecta sin aplicar un resumen', async () => {
  const code = await readFile(new URL('../supabase/functions/periodontal-summary/index.ts', import.meta.url), 'utf8');
  const executable = stripTypeScriptTypes(code.replace(/^import .*?;\s*$/gm, ''));
  const setup = new Function('Deno', 'fetch', 'createClient', 'requireUser', 'requirePermission', 'makeCors', 'permisoIA', 'respuestaIAnegada', 'providerFacts', 'selectedFacts', executable);
  // El candado de privacidad real (privacy.ts + privacy-core.mjs), no uno de mentira.
  const core = await import('../supabase/functions/_shared/privacy-core.mjs');
  const privacySrc = stripTypeScriptTypes((await readFile(new URL('../supabase/functions/_shared/privacy.ts', import.meta.url), 'utf8')).replace(/^import .*?;\s*$/gm, '').replace(/^export \{.*?\};\s*$/gm, '').replace(/^export /gm, ''));
  const { permisoIA, respuestaIAnegada } = new Function('decidirIA', 'MENSAJE_IA_NO_PERMITIDA', 'MENSAJE_IA_NO_VERIFICABLE', 'MENSAJE_IA_SIN_AUTORIZACION', privacySrc + '\nreturn { permisoIA, respuestaIAnegada };')(core.decidirIA, core.MENSAJE_IA_NO_PERMITIDA, core.MENSAJE_IA_NO_VERIFICABLE, core.MENSAJE_IA_SIN_AUTORIZACION);
  const facts = [{ kind: 'site', site: 'MB', depth: 5 }];
  for (const [condition, status, providerCalls, debits] of [
    ['anonymous',401,0,0], ['role',403,0,0], ['other-patient',403,0,0], ['ai-revoked',403,0,0], ['ai-missing',403,0,0], ['ai-unverifiable',503,0,0], ['no-wallet',402,0,0],
    ['bad-provider',422,1,0], ['spent-concurrently',402,1,1], ['success',200,1,1]
  ]) {
    let handler, attempts = 0, charges = 0;
    const db = {
      rpc: async (name, args) => {
        if (name === 'smyl_actor_can_access_patient_explicit') {
          assert.equal(args.p_domain, 'clinical'); assert.equal(args.p_actor, 'user');
          return { data: condition !== 'other-patient' };
        }
        if (name === 'smyl_patient_privacy_state') {
          assert.equal(args.p_purpose, 'ai_processing'); assert.equal(args.p_tenant, 'clinic');
          return condition === 'ai-unverifiable' ? { data: null, error: { message: 'down' } } : { data: condition === 'ai-revoked' ? 'revoked' : condition === 'ai-missing' ? 'unknown' : 'granted', error: null };
        }
        assert.equal(name, 'smyl_consume'); assert.equal(args.p_resource, 'ai_credits');
        assert.equal(args.p_quantity_units, 1); charges++;
        return { data: [{ accepted: condition !== 'spent-concurrently' }] };
      },
      from: name => {
        assert.equal(name, 'smyl_wallets');
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { balance_units: condition === 'no-wallet' ? 0 : 1 } }) };
        return chain;
      }
    };
    setup({ env: { get: name => name === 'SMYL_CONSUMABLES_ENFORCED' ? 'true' : 'test' }, serve: fn => { handler = fn; } },
      async (_url, args) => {
        attempts++;
        const payload = JSON.parse(args.body);
        assert.equal(payload.store, false); assert.deepEqual(JSON.parse(payload.input), facts);
        assert.doesNotMatch(args.body, /deadbeef|Private Patient/);
        return Response.json({ id:'response-test', output_text: condition === 'bad-provider' ? '{"indices":[-1]}' : '{"indices":[0]}' });
      },
      () => db, async () => condition === 'anonymous' ? {response: new Response(null,{status:401})} : {user:{id:'user'},tenantId:'clinic'},
      async (_auth, _cors, role) => { assert.equal(role, 'clinical.write'); return condition === 'role' ? new Response(null,{status:403}) : null; },
      () => ({}), permisoIA, respuestaIAnegada, providerFacts, selectedFacts);
    const response = await handler(new Request('https://example.test/periodontal-summary', { method: 'POST', body: JSON.stringify({
      patientId: 'deadbeef-0000-4000-8000-000000000001', patientName: 'Private Patient', facts
    }) }));
    assert.equal(response.status, status, condition); assert.equal(attempts, providerCalls, condition); assert.equal(charges, debits, condition);
    if (status === 200) assert.deepEqual(await response.json(), {indices:[0]});
  }
});
