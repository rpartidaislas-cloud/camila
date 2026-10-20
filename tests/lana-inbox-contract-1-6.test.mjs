import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Contrato SMYL↔LANA 1.6 desde el lado de SMYL: el proxy lana-inbox reenvía los
// filtros avanzados, la prioridad, la sucursal, el feedback de IA y la
// configuración de etapas, siempre con validación y permisos propios.

const proxy = fs.readFileSync(new URL('../supabase/functions/lana-inbox/index.ts', import.meta.url), 'utf8');
const section = (from, to) => proxy.slice(proxy.indexOf(from), proxy.indexOf(to));

test('la lista reenvía y valida los filtros avanzados', () => {
  assert.match(proxy, /for \(const name of \["filter", "channel", "limit", "offset", "q", "assignee", "stage_id", "branch_id", "priority", "ai", "window"\]\)/);
  const validator = section('function invalidInboxFilter', 'function queryPath');
  for (const message of [
    'El responsable indicado no es válido.', 'La etapa indicada no es válida.', 'La sucursal indicada no es válida.',
    'La prioridad indicada no es válida.', 'El filtro IA/humano no es válido.', 'El filtro de ventana de 24 h no es válido.',
  ]) assert.ok(validator.includes(message), `falta validar: ${message}`);
  assert.match(proxy, /action === "list"\) \{\s*const invalid = invalidInboxFilter\(url\);\s*if \(invalid\) return json\(400/);
  // El filtro de alcance por rol sigue aplicándose a la respuesta de la lista.
  assert.match(proxy, /\["list", "sync"\]\.includes\(action\)\s*\? await filterConversationPayload/);
});

test('el feedback de IA sólo lo ve el propietario y se valida antes de reenviar', () => {
  assert.match(proxy, /if \(action === "ai_feedback"\) \{\s*if \(actor\.role !== "owner"\) return json\(403/);
  assert.match(proxy, /return `\/inbox\/feedback\$\{params\.size/);
  assert.match(proxy, /AI_FEEDBACK_RATINGS = \["helpful", "needs_improvement", "unsafe"\]/);
});

test('la configuración de etapas es sólo del propietario y traduce a las rutas de LANA', () => {
  const block = section('if (action === "stage_create"', 'const conversationId = uuid(body.conversation_id)');
  assert.match(block, /actor\.role !== "owner"\) return json\(403/);
  assert.match(block, /path = `\/inbox\/stages\/\$\{stageId\}`;\s*method = "PUT"/);
  assert.match(block, /path = "\/inbox\/stages\/order";\s*method = "PUT"/);
  assert.match(block, /path = "\/inbox\/stages\/seed-dental"/);
  assert.match(block, /ids\.length > 24/);
  // Antes de exigir conversation_id: no son acciones de una conversación.
  assert.ok(proxy.indexOf('action === "stage_create"') < proxy.indexOf('const conversationId = uuid(body.conversation_id)'));
});

test('prioridad y sucursal son acciones de conversación con permiso de gestión y alcance', () => {
  assert.match(proxy, /"pin", "unpin", "stage", "priority", "branch", "star", "unstar", "delete"\]\.includes\(action\)/);
  assert.match(proxy, /const permission = \["send", "read", "star", "unstar"\]\.includes\(action\) \? "messages\.respond" : "messages\.manage"/);
  const branch = section('if (action === "branch")', 'const targetMessageId');
  assert.match(branch, /from\("smyl_branches"\)[\s\S]*?\.eq\("tenant_id", auth\.tenantId\)/, 'la sucursal se valida contra el tenant');
  assert.match(branch, /branch\.active === false/);
  assert.match(branch, /forwarded\.branch_name = text\(branch\.name, 160\)/, 'el nombre sale de la base, no del navegador');
  assert.doesNotMatch(branch, /body\.branch_name/);
  assert.match(branch, /smyl_member_branches/, 'un rol con alcance limitado sólo usa sus sucursales');
  assert.match(section('if (action === "priority")', 'if (action === "branch")'), /INBOX_PRIORITIES\.includes\(priority\)/);
});

test('el proxy y el contrato anuncian la versión 1.6', () => {
  const contract = fs.readFileSync(new URL('../supabase/functions/_shared/lana-contract.mjs', import.meta.url), 'utf8');
  assert.match(contract, /SMYL_LANA_CONTRACT_VERSION = "1\.6"/);
  const doc = fs.readFileSync(new URL('../docs/SMYL_LANA_CHAT_CONTRACT_V1.md', import.meta.url), 'utf8');
  assert.match(doc, /\*\*Versión de protocolo:\*\* `1\.6`/);
  assert.match(doc, /X-SMYL-LANA-Contract-Version: 1\.6/);
});
