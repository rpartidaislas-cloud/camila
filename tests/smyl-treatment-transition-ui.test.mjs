import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const M = require('../smyl-treatments.js');

test('la continuidad conserva sólo ids existentes seleccionados y no duplica', () => {
  const items = [{ id: 'plan-a' }, { id: 'plan-b' }, { id: '' }, null];
  assert.deepEqual(M.carryItemIds(items, { 'plan-b': true, 'plan-a': true, fantasma: true }), ['plan-a', 'plan-b']);
  assert.deepEqual(M.carryItemIds(items, { 'plan-a': false }), []);
  assert.deepEqual(M.carryItemIds(null, null), []);
});

test('cerrar y abrir usa un solo RPC atómico con revisión e idempotencia', () => {
  const ui = read('smyl-treatments.js');
  assert.match(ui, /rpc\('smyl_transition_treatment_v1'/);
  for (const arg of [
    'p_current_id', 'p_expected_treatment_revision', 'p_expected_plan_revision', 'p_outcome', 'p_note',
    'p_new_id', 'p_new_title', 'p_new_reason', 'p_carry_item_ids', 'p_idempotency_key'
  ]) assert.match(ui, new RegExp(arg + ':'));
  const submit = ui.slice(ui.indexOf('async function submitNew'), ui.indexOf('function closePanel'));
  assert.doesNotMatch(submit, /smyl_close_treatment/);
  assert.match(submit, /smyl:treatment-changed/);
  assert.match(submit, /Guarda o descarta los cambios del plan/);
});

test('la continuidad es explícita, accesible y se adapta al móvil', () => {
  const ui = read('smyl-treatments.js');
  const css = read('smyl-case-workspace.css');
  assert.match(ui, /Nada se traslada automáticamente/);
  assert.match(ui, /Marca únicamente lo que seguirá/);
  assert.match(ui, /type = 'checkbox'/);
  assert.match(ui, /aria-labelledby/);
  assert.match(css, /\.cw-ch-carry-list/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /@media\(max-width:600px\).*\.cw-ch-carry-list\{grid-template-columns:minmax\(0,1fr\)/s);
});
