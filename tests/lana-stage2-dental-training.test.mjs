import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const connections = read('../smyl-connections.js');
const styles = read('../smyl-connections.css');
const edge = read('../supabase/functions/lana-training/index.ts');
const contract = read('../supabase/functions/_shared/lana-contract.mjs');

test('SMYL presents dental training as a draft-to-publish workflow', () => {
  assert.match(connections, /CAPACITAR IA · ETAPA 2/);
  assert.match(connections, /Guardar borrador/);
  assert.match(connections, /Validar/);
  assert.match(connections, /Publicar capacitación/);
  assert.match(connections, /Historial de versiones publicadas/);
  assert.match(connections, /Restaurar como borrador/);
  assert.match(styles, /connections-training-state/);
  assert.match(styles, /connections-version-row/);
});

test('the editor captures structured dental knowledge and keeps clinical limits fixed', () => {
  assert.match(connections, /Identidad y voz/);
  assert.match(connections, /Servicios confirmados/);
  assert.match(connections, /Preguntas frecuentes/);
  assert.match(connections, /Política de citas/);
  assert.match(connections, /Política de precios/);
  assert.match(connections, /Límites clínicos fijos · no se pueden editar/);
  assert.match(connections, /No diagnosticar, prescribir ni recomendar dosis/);
});

test('the private lab can compare the saved draft with the active publication', () => {
  assert.match(connections, /Versión a probar/);
  assert.match(connections, /value="draft">Borrador actual/);
  assert.match(connections, /value="published">Versión publicada/);
  assert.match(connections, /trainingRequest\('POST', 'preview'/);
  assert.match(connections, /mode: mode/);
  assert.doesNotMatch(connections, /localStorage|sessionStorage/);
});

test('restoring a version replaces confirmed local edits and reloads the server draft', () => {
  assert.match(connections, /var restored = await trainingRequest\('POST', 'restore'/);
  assert.match(connections, /state\.dirty = false;\s*state\.draftRevision = Number\(restored\.draft_revision\)/);
  assert.match(connections, /await loadTraining\(true\)/);
});

test('owner-only edge resolves the tenant from the session and forwards idempotency', () => {
  assert.match(edge, /requireUser\(req, CORS\)/);
  assert.match(edge, /auth\.tenantId/);
  assert.match(edge, /Solo el dueño de la clínica puede modificar, publicar o probar/);
  assert.match(edge, /Idempotency-Key/);
  assert.match(edge, /X-SMYL-Actor-Id/);
  assert.match(edge, /action === "preview" \? 30000 : 12000/);
  assert.match(contract, /"training"/);
});
