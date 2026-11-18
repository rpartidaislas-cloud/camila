import test from 'node:test';
import assert from 'node:assert/strict';

const { matchBranch, matchBranchInMessages, tokens } = await import('../supabase/functions/_shared/branch-match.ts');
const B = [
  { id: 'centro', name: 'Sucursal Centro' }, { id: 'norte', name: 'Norte' },
  { id: 'cn', name: 'Centro Norte' }, { id: 'sol', name: 'Plaza del Sol' },
];

test('tokens: sin acentos, sin signos', () => {
  assert.deepEqual(tokens('¡En la SUCURSAL Plaza del Sol, por favor!'), ['en', 'la', 'sucursal', 'plaza', 'del', 'sol', 'por', 'favor']);
});
test('una sucursal clara se reconoce, con o sin la palabra «sucursal»', () => {
  assert.equal(matchBranch('Quiero en el norte', B)?.id, 'norte');
  assert.equal(matchBranch('En la sucursal Centro porfa', B)?.id, 'centro');
  assert.equal(matchBranch('PLAZA DEL SOL', B)?.id, 'sol');
  assert.equal(matchBranch('plaza sol', B)?.id, 'sol');
});
test('si nombra dos sucursales distintas no asigna', () => {
  assert.equal(matchBranch('No sé si centro o norte', B), null);
});
test('la más específica gana cuando una está contenida en otra', () => {
  assert.equal(matchBranch('En Centro Norte', B)?.id, 'cn');
});
test('sin nombre de sucursal no asigna', () => {
  assert.equal(matchBranch('Hola, quiero una cita', B), null);
  assert.equal(matchBranch('', B), null);
  assert.equal(matchBranch('norte', []), null);
});
test('en el historial solo cuentan los mensajes del paciente, de más nuevo a más viejo', () => {
  const msgs = [
    { role: 'assistant', content: '¿Prefieres Centro o Norte?' },
    { role: 'user', content: 'En el norte' },
    { role: 'assistant', content: 'Perfecto, Centro queda cerca de...' },
  ];
  assert.equal(matchBranchInMessages(msgs, B)?.id, 'norte');
  assert.equal(matchBranchInMessages([{ role: 'assistant', content: 'Centro' }], B), null);
});

import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const edge = read('supabase/functions/lana-inbox/index.ts');
const con = read('smyl-connections.js');

test('la inferencia de sucursal sólo escribe en hilos visibles y vuelve a leer la ruta guardada', () => {
  assert.match(edge, /row\.last_message_role === "patient"/);
  assert.match(edge, /!eligible\.has\(id\)/);
  assert.match(edge, /smyl_chat_infer_branch/);
  assert.match(edge, /if \(inferred\) assignments = await branchAssignments/);
  assert.match(edge, /await attachThreadBranch\(actor, auth\.tenantId, remote.body\)/);
});
test('entrenamiento: «Traer mis sucursales» y la instrucción de preguntar la sede, solo con varias sucursales', () => {
  const pure = new Function(
    con.match(/var ASK_BRANCH_LINE = [^\n]*\r?\n/)[0] + con.match(/var DAY_SHORT = [^\n]*\r?\n/)[0] +
    con.match(/function hourLabel\(value\)[^\n]*\r?\n/)[0] + con.match(/function hoursSummary\(rows\) \{[\s\S]*?\r?\n  \}\r?\n/)[0] +
    con.match(/function branchesDescription\(branches, hours, team\) \{[\s\S]*?\r?\n  \}\r?\n/)[0] + con.match(/function branchesSyncState\(current, fresh\) \{[\s\S]*?\r?\n  \}\r?\n/)[0] + con.match(/function setAskBranchLine\(text, on\) \{[\s\S]*?\r?\n  \}\r?\n/)[0] +
    ';return {ASK_BRANCH_LINE, hoursSummary, branchesDescription, branchesSyncState, setAskBranchLine};')();
  const hours = [1, 2, 3, 4, 5].map((w) => ({ branch_id: 'a', weekday: w, starts_at: '09:00:00', ends_at: '18:00:00' })).concat([{ branch_id: 'a', weekday: 6, starts_at: '09:00:00', ends_at: '14:00:00' }]);
  assert.equal(pure.hoursSummary(hours), 'Lun–Vie 9:00–18:00; Sáb 9:00–14:00');
  assert.equal(pure.branchesDescription([{ id: 'a', name: 'Centro', address_line: 'Av. 1', city: 'GDL' }], hours), 'Centro · Av. 1, GDL · Horario: Lun–Vie 9:00–18:00; Sáb 9:00–14:00');
  // con el equipo: dentistas y especialidad de CADA sucursal; sin equipo, el texto no cambia
  const team = [
    { branch_id: 'a', name: 'Dra. Valeria Montoya', specialty: 'Odontología general' },
    { branch_id: 'b', name: 'Dr. Andrés Salinas', specialty: 'Endodoncia' },
  ];
  const two = [{ id: 'a', name: 'Centro' }, { id: 'b', name: 'Plaza Sol' }];
  assert.equal(pure.branchesDescription(two, [], team), 'Centro · Dentistas: Dra. Valeria Montoya (Odontología general)\nPlaza Sol · Dentistas: Dr. Andrés Salinas (Endodoncia)');
  // cuando no cabe en 2400 caracteres, primero se quitan las especialidades y luego los dentistas; direcciones y horarios se conservan
  const many = Array.from({ length: 6 }, (_, i) => ({ id: 'x' + i, name: 'Sucursal ' + i, address_line: 'Calle muy larga '.repeat(8) }));
  const crowd = many.flatMap((b) => Array.from({ length: 8 }, (_, i) => ({ branch_id: b.id, name: 'Dra. Nombre Largo Apellido ' + i, specialty: 'Especialidad extensa de ejemplo' })));
  const shrunk = pure.branchesDescription(many, [], crowd);
  assert.ok(shrunk.length <= 2400);
  assert.ok(shrunk.includes('Calle muy larga') && shrunk.includes('Sucursal 5'));
  // más de 8 dentistas: «y N más»
  const nine = Array.from({ length: 10 }, (_, i) => ({ branch_id: 'a', name: 'D' + i, specialty: '' }));
  assert.match(pure.branchesDescription([{ id: 'a', name: 'Centro' }], [], nine), /y 2 más/);
  // estado del texto frente a Mi clínica
  assert.equal(pure.branchesSyncState('', 'Centro'), 'empty');
  assert.equal(pure.branchesSyncState('Centro', 'Centro'), 'ok');
  assert.equal(pure.branchesSyncState('  Centro \n', 'Centro'), 'ok');
  assert.equal(pure.branchesSyncState('Otro', 'Centro'), 'stale');
  assert.equal(pure.branchesSyncState('lo que sea', ''), 'none');
  const on = pure.setAskBranchLine('Pide nombre', true);
  assert.ok(on.includes(pure.ASK_BRANCH_LINE) && on.startsWith('Pide nombre'));
  assert.equal(pure.setAskBranchLine(on, true).split(pure.ASK_BRANCH_LINE).length, 2); // no se duplica
  assert.equal(pure.setAskBranchLine(on, false), 'Pide nombre');
  assert.match(con, /tools\.hidden = !\(state\.clinicBranches && state\.clinicBranches\.length > 1\)/);
  assert.match(con, /smyl_professional_branches/);
  assert.match(con, /data-branch-sync/);
  assert.match(con, /function multiBranchNotes\(form\)/);
});
