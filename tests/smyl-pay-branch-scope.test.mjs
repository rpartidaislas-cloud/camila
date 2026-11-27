// Enlaces de pago: alcance por sucursal (el cliente administrativo no lo aplica, se decide en la función).
// Se simula a una persona con alcance por sucursales (solo Guadalupe) y a otra con alcance de clínica.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { autorizarCargos, autorizarEnlace, enlacesVisibles } from '../supabase/functions/_shared/smyl-pay-core.mjs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const GUADALUPE = 'b-guadalupe', ANDARES = 'b-andares';
// Persona restringida a Guadalupe: ve pacientes/cargos solo de esa sucursal (igual que smyl_can_access_finance_patient en alcance «branches»).
const soloGuadalupe = {
  paciente: async (branchId) => branchId === GUADALUPE,
  sucursal: async (branchId) => branchId === GUADALUPE,
};
const clinicaCompleta = { paciente: async () => true, sucursal: async () => true };
const nadie = { paciente: async () => false, sucursal: async () => false };

const cargosAndares = [{ charge_id: 'c1', concept: 'Ortodoncia', open_amount: 900, branch_id: ANDARES }];
const cargosGuadalupe = [{ charge_id: 'c2', concept: 'Limpieza', open_amount: 500, branch_id: GUADALUPE }];
const cargosMixtos = [...cargosGuadalupe, ...cargosAndares];

test('crear: una persona de Guadalupe NO puede cobrar cargos de Andares', async () => {
  const out = await autorizarCargos({ abiertos: cargosAndares, permisos: soloGuadalupe });
  assert.equal(out.ok, false);
  assert.deepEqual(out.denegadas, [ANDARES]);
});

test('crear: sí puede cobrar los de su sucursal y alcance de clínica cobra todo', async () => {
  assert.equal((await autorizarCargos({ abiertos: cargosGuadalupe, permisos: soloGuadalupe })).ok, true);
  assert.equal((await autorizarCargos({ abiertos: cargosMixtos, permisos: clinicaCompleta })).ok, true);
});

test('crear: si en la selección hay un cargo de otra sucursal se rechaza todo, pero elegir solo los suyos sí pasa', async () => {
  assert.equal((await autorizarCargos({ abiertos: cargosMixtos, permisos: soloGuadalupe })).ok, false);
  const soloLosSuyos = await autorizarCargos({ abiertos: cargosMixtos, chargeIds: ['c2'], permisos: soloGuadalupe });
  assert.equal(soloLosSuyos.ok, true, 'los cargos de Andares no seleccionados no cuentan');
  const soloAjeno = await autorizarCargos({ abiertos: cargosMixtos, chargeIds: ['c1'], permisos: soloGuadalupe });
  assert.equal(soloAjeno.ok, false);
});

test('crear: un cargo sin sucursal se evalúa contra el alcance del paciente (null)', async () => {
  const sinSucursal = [{ charge_id: 'c3', concept: 'Consulta', open_amount: 300, branch_id: null }];
  let recibido;
  const permisos = { paciente: async (b) => { recibido = b; return false; }, sucursal: async () => false };
  assert.equal((await autorizarCargos({ abiertos: sinSucursal, permisos })).ok, false);
  assert.equal(recibido, null);
  assert.equal((await autorizarCargos({ abiertos: [], permisos: clinicaCompleta })).ok, true, 'sin cargos no hay nada que denegar aquí (lo rechaza planDeCobro)');
});

test('cancelar: un enlace de Andares no lo cancela una persona de Guadalupe; alguien sin acceso al paciente tampoco', async () => {
  assert.equal(await autorizarEnlace({ link: { branch_id: ANDARES }, permisos: soloGuadalupe }), false);
  assert.equal(await autorizarEnlace({ link: { branch_id: GUADALUPE }, permisos: soloGuadalupe }), true);
  assert.equal(await autorizarEnlace({ link: { branch_id: GUADALUPE }, permisos: nadie }), false);
  assert.equal(await autorizarEnlace({ link: { branch_id: ANDARES }, permisos: clinicaCompleta }), true);
});

test('listar: solo se devuelven los enlaces de sucursales visibles y se revisa una vez por sucursal', async () => {
  let consultas = 0;
  const contando = { paciente: async (b) => { consultas += 1; return b === GUADALUPE; }, sucursal: async (b) => b === GUADALUPE };
  const links = [{ id: 1, branch_id: GUADALUPE }, { id: 2, branch_id: ANDARES }, { id: 3, branch_id: GUADALUPE }, { id: 4, branch_id: ANDARES }];
  const visibles = await enlacesVisibles({ links, permisos: contando });
  assert.deepEqual(visibles.map((l) => l.id), [1, 3]);
  assert.equal(consultas, 2, 'una consulta por sucursal distinta, no por enlace');
  assert.deepEqual(await enlacesVisibles({ links, permisos: nadie }), []);
  assert.equal((await enlacesVisibles({ links, permisos: clinicaCompleta })).length, 4);
});

test('la función aplica el alcance en las TRES acciones antes de usar el cliente administrativo', () => {
  const src = read('supabase/functions/smyl-pay/index.ts');
  const personal = src.slice(src.indexOf('async function accionesPersonal'));
  assert.match(personal, /smyl_can_access_finance_patient/);
  assert.match(personal, /smyl_can_access_finance_branch/);
  assert.match(personal, /enlacesVisibles\(\{ links: todos \|\| \[\], permisos \}\)/, 'list');
  assert.match(personal, /autorizarEnlace\(\{ link, permisos \}\)/, 'cancel');
  assert.match(personal, /autorizarCargos\(\{ abiertos: abiertos \|\| \[\], chargeIds, permisos \}\)/, 'create');
  assert.match(personal, /permisos\.sucursal\(branchId\)/, 'la sucursal final del enlace también se valida');
  assert.match(personal, /branch_scope_denied/);
  // El orden importa: la autorización va antes de armar el plan y de escribir.
  assert.ok(personal.indexOf('autorizarCargos') < personal.indexOf('planDeCobro(abiertos'), 'create autoriza antes de planear');
  assert.ok(personal.indexOf('autorizarEnlace') < personal.indexOf('await conciliar(link)'), 'cancel autoriza antes de conciliar');
});

test('la sucursal del enlace sale de los cargos que sí se cobran', () => {
  const src = read('supabase/functions/smyl-pay/index.ts');
  assert.match(src, /plan\.allocations\.some\(\(a: Json\) => a\.charge_id === c\.charge_id\)/);
});

test('el paquete empaquetado para el panel de Supabase incluye la autorización', () => {
  const bundlePath = 'docs/bundles/smyl-pay.single-file.ts';
  if (!fs.existsSync(new URL('../' + bundlePath, import.meta.url))) return;
  const bundle = read(bundlePath);
  assert.match(bundle, /autorizarCargos/);
  assert.match(bundle, /enlacesVisibles/);
});
