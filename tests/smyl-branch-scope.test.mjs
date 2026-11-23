import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Scope = require("../smyl-branch-scope.js");
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const A = "00000000-0000-0000-0000-0000000000b1";
const B = "00000000-0000-0000-0000-0000000000b2";
const C = "00000000-0000-0000-0000-0000000000b3";
const sedes = [
  { branch_id: A, name: "Matriz", is_default: true, is_primary: false, can_all: false },
  { branch_id: B, name: "Norte", is_default: false, is_primary: true, can_all: false },
  { branch_id: C, name: "Sur", is_default: false, is_primary: false, can_all: false },
];

test("pickActive: respeta lo guardado, cae en la sede principal y solo permite «todos» a quien puede", () => {
  assert.equal(Scope.pickActive(sedes, false, C), C);
  assert.equal(Scope.pickActive(sedes, false, null), B, "sin selección: la sede principal de la persona");
  assert.equal(Scope.pickActive(sedes, false, "ya-no-existe"), B);
  assert.equal(Scope.pickActive(sedes, false, "all"), B, "sin branches.all «todos» no es válido");
  assert.equal(Scope.pickActive(sedes, true, "all"), "all");
  assert.equal(Scope.pickActive([{ ...sedes[0] }], true, "all"), A, "con una sola sede no hay vista global");
  assert.equal(Scope.pickActive([{ ...sedes[0] }, { ...sedes[2] }], false, null), A, "sin principal usa la predeterminada");
  assert.equal(Scope.pickActive([], true, "all"), null);
});

test("scopeRule: filtra solo tablas con sede y solo con un consultorio concreto", () => {
  assert.deepEqual(Scope.scopeRule("smyl_appointments", A), { type: "eq", column: "branch_id", value: A });
  assert.deepEqual(Scope.scopeRule("smyl_finance_charges", A), { type: "or", value: `branch_id.eq.${A},branch_id.is.null` });
  assert.equal(Scope.scopeRule("smyl_appointments", "all"), null, "vista global no filtra");
  assert.equal(Scope.scopeRule("smyl_appointments", null), null);
  assert.equal(Scope.scopeRule("camila_pacientes", A), null, "pacientes son de toda la clínica");
  assert.equal(Scope.scopeRule("smyl_services", A), null);
  assert.equal(Scope.scopeRule("smyl_appointments", "x'); drop table--"), null, "un valor que no es UUID nunca llega a la consulta");
});

function fakeSb() {
  const log = [];
  const makeBuilder = (table) => {
    const b = { table, calls: [] };
    const chain = { eq: (c, v) => (b.calls.push(["eq", c, v]), chain), or: (v) => (b.calls.push(["or", v]), chain), order: () => chain };
    b.select = (cols) => (b.calls.push(["select", cols]), chain);
    b.insert = (row) => (b.calls.push(["insert", row]), chain);
    log.push(b);
    return b;
  };
  return { from: makeBuilder, log };
}

test("install: select() de tablas con sede sale filtrado; insert y otras tablas no se tocan", () => {
  const sb = fakeSb();
  Scope._state.installed = false;
  Scope._state.active = B;
  Scope.install(sb);
  sb.from("smyl_appointments").select("*");
  sb.from("smyl_finance_charges").select("*");
  sb.from("camila_pacientes").select("*");
  sb.from("smyl_finance_payments").insert({ amount: 1 });
  const [cita, cargo, paciente, pago] = sb.log;
  assert.deepEqual(cita.calls, [["select", "*"], ["eq", "branch_id", B]]);
  assert.deepEqual(cargo.calls, [["select", "*"], ["or", `branch_id.eq.${B},branch_id.is.null`]]);
  assert.deepEqual(paciente.calls, [["select", "*"]]);
  assert.deepEqual(pago.calls, [["insert", { amount: 1 }]], "escribir nunca se filtra");

  Scope._state.active = "all";
  sb.from("smyl_appointments").select("*");
  assert.deepEqual(sb.log[4].calls, [["select", "*"]], "vista global: sin filtro");
  Scope._state.active = null;
  Scope._state.installed = false;
});

test("install es idempotente: no envuelve dos veces", () => {
  const sb = fakeSb();
  Scope._state.installed = false; Scope._state.active = A;
  Scope.install(sb); Scope.install(sb);
  sb.from("smyl_appointments").select("*");
  assert.equal(sb.log[0].calls.filter((c) => c[0] === "eq").length, 1);
  Scope._state.installed = false; Scope._state.active = null;
});

test("app.html: carga el módulo, inicia tras resolver la clínica y define el selector; móvil y PWA sincronizados", () => {
  const html = read("app.html");
  assert.match(html, /<script defer src="smyl-branch-scope\.js\?v=4"><\/script>/);
  assert.match(html, /renderSidebar\(\);\s*\n\s*\/\/ Varios consultorios[^\n]*\n\s*if \(window\.SmylBranchScope\) window\.SmylBranchScope\.init\(\);/);
  assert.match(html, /\.sb-branch select/);
  for (const f of ["app.html", "smyl-branch-scope.js", "sw.js"]) assert.equal(read(f), read("mobile/www/" + f), `${f} móvil igual`);
  assert.match(read("sw.js"), /'\/camila\/smyl-branch-scope\.js\?v=4'/);
  assert.match(read("sw.js"), /-branch-scope-v1(?:-|')/);
});

test("el selector solo se dibuja con 2 o más consultorios y usa textContent (sin innerHTML)", () => {
  const src = read("smyl-branch-scope.js");
  assert.match(src, /state\.branches\.length > 1/);
  assert.ok(!/innerHTML/.test(src));
});

test("migración: permiso branches.all, backfill y funciones sin acceso anónimo", () => {
  const sql = read("supabase/migrations/20261118140000_smyl_branch_scope.sql");
  assert.match(sql, /'cloud\.share',\s*\n\s*'branches\.all'/);
  assert.match(sql, /code in \('propietario', 'administrador'\)/);
  assert.match(sql, /revoke all on function public\.smyl_my_branches\(\) from public, anon/);
  assert.match(sql, /grant execute on function public\.smyl_branch_access\(uuid, uuid\) to authenticated/);
  assert.ok(!/grant[^;]*smyl_(my_branches|branch_access)[^;]*to anon/.test(sql));
});

test('init() no falla con «root is not defined» (la variable debe existir dentro de la fábrica UMD)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../smyl-branch-scope.js', import.meta.url), 'utf8');
  assert.match(src, /var root = typeof globalThis/);
  // se ejecuta como en el navegador: con un window simulado y clínica activa, init() debe resolver sin lanzar
  const fakeWindow = { tenantId: '11111111-1111-4111-8111-111111111111', sb: { from() { return { select() { return { eq() { return { eq() { return Promise.resolve({ data: [], error: null }); } }; } }; } }; } }, document: { getElementById: () => null, querySelector: () => null, body: { classList: { toggle() {} } } }, location: {}, localStorage: { getItem: () => null, setItem() {} } };
  const run = new Function('window', 'globalThis', 'module', `${src}; return window.SmylBranchScope;`);
  const scope = run(fakeWindow, fakeWindow, undefined);
  assert.ok(scope, 'expone SmylBranchScope');
  await assert.doesNotReject(async () => { await scope.init(); });
});

function corre({ almacenamientoBloqueado }) {
  const guardado = new Map();
  const recargas = { n: 0 };
  const g = globalThis;
  const previo = { tenantId: g.tenantId, sb: g.sb, localStorage: g.localStorage, location: g.location };
  g.tenantId = "T1";
  g.sb = { from: () => ({}), rpc: async () => ({ data: sedes, error: null }) };
  g.localStorage = { getItem: (k) => (almacenamientoBloqueado ? null : guardado.get(k) ?? null), setItem: (k, v) => { if (almacenamientoBloqueado) throw new Error("bloqueado"); guardado.set(k, v); } };
  g.location = { reload: () => { recargas.n += 1; } };
  Scope._state.installed = false; Scope._state.active = null;
  return { recargas, restaurar: () => Object.assign(g, previo), init: () => Scope.init() };
}

test("recarga una sola vez con almacenamiento normal y NUNCA en bucle con el almacenamiento bloqueado", async () => {
  const ok = corre({ almacenamientoBloqueado: false });
  await ok.init();
  assert.equal(ok.recargas.n, 1, "primera vez con varias sedes: una recarga");
  await ok.init();
  assert.equal(ok.recargas.n, 1, "segunda vez ya hay selección guardada: no recarga");
  ok.restaurar();

  const bloqueado = corre({ almacenamientoBloqueado: true });
  await bloqueado.init(); await bloqueado.init(); await bloqueado.init();
  assert.equal(bloqueado.recargas.n, 0, "sin poder guardar la elección no se recarga (evita el bucle)");
  assert.equal(Scope.get(), B, "pero la sede activa sí queda en memoria");
  bloqueado.restaurar();
  Scope._state.installed = false; Scope._state.active = null;
});
