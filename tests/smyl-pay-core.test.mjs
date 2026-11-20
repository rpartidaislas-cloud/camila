import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planDeCobro, firmaValida, hmacHex, sha256Hex, aleatorioHex, vistaPublicaEnlace, conceptoDelEnlace, MONTO_MINIMO, MONTO_MAXIMO,
} from "../supabase/functions/_shared/smyl-pay-core.mjs";
import { normalizeLanaPath } from "../supabase/functions/_shared/lana-contract.mjs";

const abiertos = [
  { charge_id: "a", concept: "Limpieza", open_amount: "800.00" },
  { charge_id: "b", concept: "Resina", open_amount: 1250.5 },
  { charge_id: "c", concept: "Pagado", open_amount: 0 },
];

test("planDeCobro: suma solo saldos abiertos y respeta la selección", () => {
  const todo = planDeCobro(abiertos);
  assert.equal(todo.ok, true);
  assert.equal(todo.total, 2050.5);
  assert.deepEqual(todo.allocations.map((a) => a.charge_id), ["a", "b"]);
  const uno = planDeCobro(abiertos, { chargeIds: ["b"] });
  assert.equal(uno.total, 1250.5);
});

test("planDeCobro: rechaza sin saldo, monto bajo y monto alto", () => {
  assert.equal(planDeCobro([]).error, "no_balance");
  assert.equal(planDeCobro([{ charge_id: "x", concept: "x", open_amount: 0 }]).error, "no_balance");
  assert.equal(planDeCobro([{ charge_id: "x", concept: "x", open_amount: MONTO_MINIMO - 0.01 }]).error, "amount_too_low");
  assert.equal(planDeCobro([{ charge_id: "x", concept: "x", open_amount: MONTO_MAXIMO + 1 }]).error, "amount_too_high");
  assert.equal(planDeCobro(abiertos, { chargeIds: ["zzz"] }).error, "no_balance");
});

test("el token tiene 64 hex y su hash es SHA-256 estable", async () => {
  const t = aleatorioHex(32);
  assert.match(t, /^[a-f0-9]{64}$/);
  assert.notEqual(t, aleatorioHex(32));
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("firmaValida: acepta la firma de LANA y rechaza secreto, cuerpo, firma o hora incorrectos", async () => {
  const secreto = "s".repeat(48), cuerpo = '{"request_id":"r","status":"paid"}', ahora = 1_800_000_000;
  const firma = "sha256=" + (await hmacHex(secreto, `${ahora}.${cuerpo}`));
  assert.equal(await firmaValida(secreto, String(ahora), cuerpo, firma, { ahoraSeg: ahora + 10 }), true);
  assert.equal(await firmaValida("otro".repeat(12), String(ahora), cuerpo, firma, { ahoraSeg: ahora }), false);
  assert.equal(await firmaValida(secreto, String(ahora), cuerpo + " ", firma, { ahoraSeg: ahora }), false);
  assert.equal(await firmaValida(secreto, String(ahora), cuerpo, firma.slice(0, -1) + "0", { ahoraSeg: ahora }), false);
  assert.equal(await firmaValida(secreto, String(ahora), cuerpo, firma, { ahoraSeg: ahora + 301 }), false, "repetición tardía");
  assert.equal(await firmaValida(secreto, "x", cuerpo, firma, { ahoraSeg: ahora }), false);
  assert.equal(await firmaValida("", String(ahora), cuerpo, firma, { ahoraSeg: ahora }), false);
  assert.equal(await firmaValida(secreto, String(ahora), cuerpo, undefined, { ahoraSeg: ahora }), false);
});

test("vistaPublicaEnlace no filtra datos internos y marca vencidos", () => {
  const link = {
    id: "ID-INTERNO", tenant_id: "T", patient_id: "P", token_hash: "H", callback_secret: "SECRETO", status: "pending",
    amount: "500.00", allocations: [{ charge_id: "c1", concept: "Limpieza", amount: 500 }], expires_at: new Date(Date.now() + 1e6).toISOString(),
  };
  const v = vistaPublicaEnlace(link, { clinica: "Clínica Sol", paciente: "María Pérez López" });
  assert.equal(v.status, "pending");
  assert.equal(v.patient, "María");
  const texto = JSON.stringify(v);
  for (const prohibido of ["ID-INTERNO", "SECRETO", "token_hash", "charge_id", "patient_id", "tenant"]) assert.ok(!texto.includes(prohibido), prohibido);
  assert.equal(vistaPublicaEnlace({ ...link, expires_at: new Date(Date.now() - 1000).toISOString() }).status, "expired");
  assert.equal(vistaPublicaEnlace({ ...link, status: "paid", paid_at: "2026-11-16T10:00:00Z" }, { recibo: 3 }).receipt_folio, "000003");
});

test("conceptoDelEnlace resume varios cargos", () => {
  assert.equal(conceptoDelEnlace([{ concept: "Limpieza" }], "Sol"), "Sol · Limpieza");
  assert.equal(conceptoDelEnlace([{ concept: "a" }, { concept: "b" }], "Sol"), "Sol · 2 conceptos");
});

test("el contrato con LANA permite /payments y sigue bloqueando rutas ajenas", () => {
  assert.equal(normalizeLanaPath("/payments/requests"), "/payments/requests");
  assert.equal(normalizeLanaPath("/payments/requests/abc/cancel"), "/payments/requests/abc/cancel");
  assert.throws(() => normalizeLanaPath("/admin/secrets"));
  assert.throws(() => normalizeLanaPath("/payments/../secrets"));
});

test("pagar.html: sin innerHTML con datos, token solo en fragmento y CSP definida", () => {
  const html = readFileSync(new URL("../pagar.html", import.meta.url), "utf8");
  assert.ok(!/innerHTML\s*=/.test(html), "usa textContent/createElement, nunca innerHTML");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /name="robots" content="noindex/);
  assert.match(html, /history\.replaceState/);
  assert.match(html, /sessionStorage/);
});

test("migración: tabla solo service_role y funciones con grants cerrados", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261116130000_smyl_payment_links.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.smyl_payment_links from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.smyl_post_online_payment\(uuid, text, text, timestamptz\) to service_role/);
  assert.ok(!/grant execute[^;]*smyl_post_online_payment[^;]*to authenticated/.test(sql));
  assert.match(sql, /idempotency_key[\s\S]*v_link\.id/, "idempotencia por enlace");
});

test("smyl-pay: verify_jwt=false declarado y la función exige sesión + finance.manage en las acciones de personal", () => {
  const toml = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(toml, /\[functions\.smyl-pay\]\s*\nverify_jwt = false/);
  const src = readFileSync(new URL("../supabase/functions/smyl-pay/index.ts", import.meta.url), "utf8");
  assert.match(src, /requireUser\(req, CORS\)/);
  assert.match(src, /smyl_has_permission/);
  assert.match(src, /finance\.manage/);
  assert.match(src, /firmaValida\(link\.callback_secret/);
  assert.match(src, /conciliar\(link\)/);
});

test("revisión 2026-11-19: cancelar solo cuenta si LANA lo confirma; una carrera de «crear» devuelve 409; el callback no revela qué existe", () => {
  const src = readFileSync(new URL("../supabase/functions/smyl-pay/index.ts", import.meta.url), "utf8");
  assert.match(src, /async function cancelarEnLana/);
  assert.match(src, /response\.ok \|\| response\.status === 404/);
  assert.ok(!/\.catch\(\(\) => null\)/.test(src), "ya no se ignora el fallo del cancelado en LANA");
  assert.match(src, /previous_link_not_cancelled/);
  assert.match(src, /errLink\?\.code === "23505"[\s\S]*link_in_progress/);
  assert.match(src, /if \(!link\) return json\(\{\}, 401/);
  assert.match(readFileSync(new URL("../pagar.html", import.meta.url), "utf8"), /window\.top !== window\.self/);
  assert.match(readFileSync(new URL("../pagar.html", import.meta.url), "utf8"), /\/\^https:\\\/\\\//);
});

// El botón «Enlace de pago» se activa por clínica (config.pago_en_linea) y no para todas.
import {readFileSync as _rf} from 'node:fs';
test('Enlace de pago visible solo en clínicas con cobro en línea activado',()=>{
  const fin=_rf(new URL('../smyl-finance.js',import.meta.url),'utf8');
  assert.match(fin,/function onlinePayEnabled\(\)\{if\(window\.SMYL_ONLINE_PAY===true\)return true;var t=window\.tenantData,c=t&&t\.config;return !!\(c&&typeof c==='object'&&c\.pago_en_linea===true\);\}/);
  assert.match(fin,/onlinePayEnabled\(\)\?'<button type="button" id="account-link">Enlace de pago<\/button>'/);
  assert.doesNotMatch(fin,/window\.SMYL_ONLINE_PAY===true\?'<button/);
});
