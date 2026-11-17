import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { messageAccess, visibleConversationIds } = await import('../supabase/functions/_shared/messages-scope.ts');

function makeDb(tables) {
  return {
    from(name) {
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(key, value) { filters.push((row) => String(row[key]) === String(value)); return builder; },
        in(key, values) { filters.push((row) => values.map(String).includes(String(row[key]))); return builder; },
        run() { return (tables[name] || []).filter((row) => filters.every((f) => f(row))); },
        maybeSingle() { return Promise.resolve({ data: builder.run()[0] || null }); },
        then(resolve, reject) { return Promise.resolve({ data: builder.run() }).then(resolve, reject); },
      };
      return builder;
    },
  };
}

const T = 'tenant';
const base = {
  smyl_roles: [{ tenant_id: T, id: 'r-norte', active: true }, { tenant_id: T, id: 'r-clinica', active: true }, { tenant_id: T, id: 'r-sin', active: true }],
  smyl_role_permissions: [
    { tenant_id: T, role_id: 'r-norte', permission_key: 'messages.read' },
    { tenant_id: T, role_id: 'r-clinica', permission_key: 'messages.read' },
  ],
  smyl_role_scopes: [
    { tenant_id: T, role_id: 'r-norte', domain: 'messages', scope: 'branches' },
    { tenant_id: T, role_id: 'r-clinica', domain: 'messages', scope: 'clinic' },
  ],
  smyl_member_roles: [
    { tenant_id: T, user_id: 'ana', role_id: 'r-norte' }, { tenant_id: T, user_id: 'luis', role_id: 'r-clinica' }, { tenant_id: T, user_id: 'sin', role_id: 'r-sin' },
  ],
  smyl_member_branches: [{ tenant_id: T, user_id: 'ana', branch_id: 'norte' }],
  smyl_conversation_branches: [
    { tenant_id: T, conversation_id: 'c-norte', branch_id: 'norte' },
    { tenant_id: T, conversation_id: 'c-centro', branch_id: 'centro' },
  ],
  camila_lana_handoffs: [
    { tenant_id: T, lana_conversation_id: 'c-sinsede-conita', patient_id: 'p1' },
    { tenant_id: T, lana_conversation_id: 'c-centro', patient_id: 'p1' },
    { tenant_id: T, lana_conversation_id: 'c-sinsede-sincita', patient_id: 'p2' },
  ],
  smyl_appointments: [{ tenant_id: T, patient_id: 'p1', branch_id: 'norte', professional_id: 'dr1' }],
  smyl_professionals: [{ tenant_id: T, id: 'dr1', user_id: 'dr', active: true }],
  smyl_patient_care_team: [],
  camila_usuarios: [{ id: 'ana', tenant_id: T, rol: 'colaborador', activo: true }],
};
const db = makeDb(base);
const ids = ['c-norte', 'c-centro', 'c-sinsede-conita', 'c-sinsede-sincita', 'c-nueva'];

test('alcance: dueña y rol de clínica completa ven todo; sin permiso de leer no ven nada', async () => {
  const owner = await messageAccess(db, T, T);
  assert.deepEqual([owner.isOwner, owner.scope, owner.canRead], [true, 'clinic', true]);
  const luis = await messageAccess(db, T, 'luis');
  assert.deepEqual([luis.scope, luis.canRead], ['clinic', true]);
  assert.equal((await visibleConversationIds(db, T, luis, ids)).size, ids.length);
  const sin = await messageAccess(db, T, 'sin');
  assert.equal(sin.canRead, false);
  assert.equal((await visibleConversationIds(db, T, sin, ids)).size, 0);
});
test('por sucursales: solo lo asignado a su sede; la sede asignada manda sobre las citas', async () => {
  const ana = await messageAccess(db, T, 'ana');
  assert.deepEqual([ana.scope, ana.canRead], ['branches', true]);
  const seen = await visibleConversationIds(db, T, ana, ids);
  assert.ok(seen.has('c-norte'));
  assert.ok(!seen.has('c-centro'), 'asignada a otra sede, aunque el paciente tenga cita en la suya');
  assert.ok(seen.has('c-sinsede-conita'), 'sin sede, pero el paciente tiene cita en su sucursal');
  assert.ok(!seen.has('c-sinsede-sincita'));
  assert.ok(!seen.has('c-nueva'), 'prospecto sin sede: solo la clínica completa lo ve');
});
test('por sucursales sin ninguna sucursal asignada no ve nada', async () => {
  const lonely = { userId: 'x', isOwner: false, canRead: true, scope: 'branches' };
  assert.equal((await visibleConversationIds(db, T, lonely, ids)).size, 0);
});
test('solo lo propio: pacientes con citas o equipo de esa persona', async () => {
  const dr = { userId: 'dr', isOwner: false, canRead: true, scope: 'own' };
  const seen = await visibleConversationIds(db, T, dr, ids);
  assert.deepEqual([...seen].sort(), ['c-centro', 'c-sinsede-conita']);
});
test('lana-attention: usa el alcance y no filtra el total de otras sedes', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/lana-attention/index.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ messageAccess, visibleConversationIds \} from "\.\.\/_shared\/messages-scope\.ts";/);
  assert.match(src, /if \(!access\.canRead\) return json\(200, \{ ok: true, total: 0, items: \[\]/);
  assert.match(src, /if \(!id \|\| !visible\.has\(id\)\) return \[\];/);
  assert.match(src, /total: access\.scope === "clinic" \? Math\.max\(items\.length, Number\(remote\.body\.total\) \|\| 0\) : items\.length/);
});

test('sincronización: un cambio de sucursal saca la conversación de quien ya no la ve y recarga la lista de los demás', () => {
  const edge = fs.readFileSync(new URL('../supabase/functions/lana-inbox/index.ts', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../smyl-inbox.js', import.meta.url), 'utf8');
  assert.match(edge, /\.gt\("assigned_at", stamp\)/);
  assert.match(edge, /body\.branch_changed = true;/);
  assert.match(edge, /if \(!await canAccessConversation\(actor, tenantId, id\)\) removed\.push\(id\);/);
  assert.match(edge, /if \(action === "sync"\) \{ try \{ await attachBranchChanges\(/);
  assert.match(ui, /if \(data\.branch_changed && !deferVisualRefresh\) \{ state\.syncDelay = 5000; await loadList\(true\); \}/);
});
