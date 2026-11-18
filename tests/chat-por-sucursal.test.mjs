import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const edge = read('supabase/functions/lana-inbox/index.ts');
const sql = read('supabase/migrations/20261116100000_smyl_conversation_branches.sql');
const ui = read('smyl-inbox.js');

test('migración: tabla por conversación con fuente, solo accesible por service_role', () => {
  assert.match(sql, /primary key \(tenant_id, conversation_id\)/);
  assert.match(sql, /source in \('manual','ai','channel','appointment'\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.smyl_conversation_branches from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on public\.smyl_conversation_branches to service_role/);
});
test('lana-inbox: la sucursal asignada manda para el alcance por sucursales y se adjunta a cada conversación', () => {
  assert.match(edge, /if \(\(actor\.scopes\.messages \|\| "own"\) === "branches"\) \{\s*\n\s*const assigned = \(await branchAssignments\(tenantId, \[conversationId\]\)\)\.get\(conversationId\);/);
  assert.match(edge, /if \(assigned\) return \(await memberBranchIds\(actor, tenantId\)\)\.includes\(assigned\.branch_id\);/);
  assert.match(edge, /conversation\.branch = assigned \?/);
  assert.match(edge, /action === "branches"/);
});
test('lana-inbox: asignar requiere permiso de gestión y solo la clínica completa puede devolver a «Sin asignar»', () => {
  assert.match(edge, /if \(action === "set_branch"\) \{\s*\n\s*const denied = requirePermission\(actor, "messages\.manage"/);
  assert.match(edge, /Solo quien ve toda la clínica puede devolver una conversación a «Sin asignar»/);
  assert.match(edge, /onConflict: "tenant_id,conversation_id"/);
  assert.match(edge, /La sucursal no existe o está inactiva/);
});
test('bandeja: un solo botón de sucursal con conteos, sin ruido y con asignación de un clic', () => {
  assert.match(ui, /function multiBranch\(\) \{ return state\.branches\.length > 1; \}/);
  assert.match(ui, /if \(state\.branchFilter === 'none' && item\.branch\) return false;/);
  // un botón compacto junto a los filtros; el menú lista cada sucursal con su número
  assert.match(ui, /data-inbox-branch-chip/);
  assert.match(ui, /function toggleBranchMenu\(/);
  assert.match(ui, /role', 'menuitemradio'|menuitemradio/);
  assert.match(ui, /label: 'Sin sucursal', count: counts\.none/);
  // No confundir la sede del hilo con el operador que lo atiende.
  assert.match(ui, /Atiende el chat<\/small>/);
  const branchMenu = ui.slice(ui.indexOf('function threadBranchMenuItems'), ui.indexOf('function renderThreadBranchChip'));
  assert.doesNotMatch(branchMenu, /Sin asignar/);
  assert.doesNotMatch(ui, /smyl-inbox-branch-unassigned/);
  assert.match(ui, /Sin responsable/);
  // fila: la sucursal sin asignar es solo un punto accesible
  assert.match(ui, /smyl-inbox-branch is-none/);
  assert.match(ui, /aria-label', 'Sin sucursal'|aria-label="Sin sucursal"/);
  // cabecera: botón de sucursal que asigna con un clic
  assert.match(ui, /data-thread-branch-chip/);
  assert.match(ui, /function threadBranchMenuItems\(/);
  assert.match(ui, /action: 'set_branch'/);
  assert.match(ui, /if \(seesWholeClinic\(\)\) choices\.push\(\['', 'Sin sucursal/);
  // sin almacenamiento del navegador
  assert.doesNotMatch(ui, /localStorage/);
});
