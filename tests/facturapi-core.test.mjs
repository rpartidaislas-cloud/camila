import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion, datosLegales, validarCsd, estadoOrganizacion, rfcCoincide, puedeActivarProduccion, leerLlave, mensajeCsd, LIVE_KEY_RE, TEST_KEY_RE, CONFIRM_LIVE_TEXT } from "../supabase/functions/_shared/facturapi-core.mjs";

const master = Buffer.alloc(32, 7).toString("base64");
const T1 = "11111111-1111-4111-8111-111111111111", T2 = "22222222-2222-4222-8222-222222222222";
const KEY = "sk_test_" + "AbCdEf0123456789xyz";

test("validarLlave: acepta solo sk_test_ y explica el resto", () => {
  assert.equal(validarLlave("  " + KEY + " ").key, KEY);
  assert.match(validarLlave("sk_live_" + "a".repeat(30)).error, /producción/);
  assert.match(validarLlave("sk_user_" + "a".repeat(30)).error, /usuario/);
  assert.equal(validarLlave("sk_test_corta").ok, false);
  assert.equal(validarLlave("").ok, false);
  assert.equal(validarLlave(null).ok, false);
});

test("cifrado: ida y vuelta, aislado por clínica y sin texto en claro", async () => {
  const c = await cifrar(master, T1, KEY);
  assert.ok(!c.ciphertext.includes("sk_test"));
  assert.equal(await descifrar(master, T1, c.ciphertext, c.iv), KEY);
  await assert.rejects(descifrar(master, T2, c.ciphertext, c.iv));
  await assert.rejects(descifrar(Buffer.alloc(32, 9).toString("base64"), T1, c.ciphertext, c.iv));
  await assert.rejects(cifrar("corta", T1, KEY));
  const d = await cifrar(master, T1, KEY);
  assert.notEqual(d.iv, c.iv);
});

test("huella cumple el formato de la tabla", async () => {
  assert.match(await huella(KEY), /^[A-F0-9]{12}$/);
});

test("leerOrganizacion y vistaConexion", () => {
  assert.deepEqual(leerOrganizacion({ id: "org_123", legal: { legal_name: "Clinica SA" } }), { id: "org_123", name: "Clinica SA" });
  assert.equal(leerOrganizacion({ name: "x" }), null);
  const v = vistaConexion({ status: "connected", environment: "test", secret_ciphertext: "X", secret_iv: "Y", key_fingerprint: "ABC", organization_name: "O" });
  assert.equal(JSON.stringify(v).includes("secret"), false);
  assert.equal(vistaConexion(null).status, "disconnected");
});

test("la función exige sesión y permiso finance.manage, y no devuelve la fila cruda", () => {
  const src = readFileSync(new URL("../supabase/functions/facturapi/index.ts", import.meta.url), "utf8");
  assert.match(src, /requireUser/);
  assert.match(src, /requirePermission\(auth, CORS, "finance\.manage"\)/);
  assert.doesNotMatch(src, /connection: (row|data)\b/);
  assert.match(src, /environment: "test"/);
});

const issuer = { legal_name: "CLINICA DENTAL SMYL", fiscal_regime: "601", tax_postal_code: "64000", rfc: "XAXX010101000" };

test("datosLegales: no manda el RFC (Facturapi lo toma del CSD) y exige datos completos", () => {
  const d = datosLegales(issuer);
  assert.deepEqual(d, { name: "CLINICA DENTAL SMYL", legal_name: "CLINICA DENTAL SMYL", tax_system: "601", address: { zip: "64000" } });
  assert.equal("tax_id" in d, false);
  assert.equal(datosLegales({ ...issuer, tax_postal_code: "6400" }), null);
  assert.equal(datosLegales({ ...issuer, fiscal_regime: "" }), null);
  assert.equal(datosLegales(null), null);
});

test("validarCsd: pide .cer, .key y contraseña con tamaños razonables", () => {
  const f = (name, size = 1500) => ({ name, size });
  assert.equal(validarCsd({ cer: f("a.cer"), key: f("a.key"), password: "12345678a" }).ok, true);
  assert.equal(validarCsd({ cer: f("a.CER"), key: f("a.KEY"), password: "x" }).ok, true);
  assert.equal(validarCsd({ cer: f("a.pdf"), key: f("a.key"), password: "x" }).ok, false);
  assert.equal(validarCsd({ cer: f("a.cer"), key: f("a.txt"), password: "x" }).ok, false);
  assert.equal(validarCsd({ cer: f("a.cer", 10), key: f("a.key"), password: "x" }).ok, false);
  assert.equal(validarCsd({ cer: f("a.cer"), key: f("a.key", 70000), password: "x" }).ok, false);
  assert.equal(validarCsd({ cer: f("a.cer"), key: f("a.key"), password: "" }).ok, false);
  assert.equal(validarCsd({ cer: f("a.cer"), key: f("a.key"), password: "x".repeat(201) }).ok, false);
  assert.equal(validarCsd({}).ok, false);
});

test("estadoOrganizacion: pasos pendientes, vigencia del CSD y listo para producción", () => {
  const nueva = estadoOrganizacion({ is_production_ready: false, pending_steps: [{ type: "certificate", description: "Sube tu CSD" }, { type: "manifiesto", description: "Firma Carta Manifiesto" }], certificate: { has_certificate: false } });
  assert.equal(nueva.production_ready, false);
  assert.deepEqual(nueva.pending_steps.map((x) => x.type), ["certificate", "manifiesto"]);
  const lista = estadoOrganizacion({ is_production_ready: true, pending_steps: [], certificate: { has_certificate: true, expires_at: "2030-11-17T20:00:00Z", serial_number: "123" }, legal: { tax_id: "xaxx010101000", legal_name: "X" } });
  assert.equal(lista.production_ready, true);
  assert.equal(lista.csd_valid_until, "2030-11-17T20:00:00Z");
  assert.equal(lista.tax_id, "XAXX010101000");
  // Si Facturapi dice listo pero aún hay pasos, no se considera listo.
  assert.equal(estadoOrganizacion({ is_production_ready: true, pending_steps: [{ type: "manifiesto" }] }).production_ready, false);
  assert.equal(estadoOrganizacion(null).production_ready, false);
});

test("rfcCoincide: el certificado debe ser del RFC de la clínica", () => {
  assert.equal(rfcCoincide("xaxx010101000", "XAXX010101000"), true);
  assert.equal(rfcCoincide("XIA190128J61", "XAXX010101000"), false);
  assert.equal(rfcCoincide("", "XAXX010101000"), false);
  assert.equal(rfcCoincide("basura", "basura"), false);
});

test("compuerta de producción: cada condición bloquea por separado", () => {
  const ok = { mode: "platform", status: "connected", productionReady: true, issuerReviewed: true, policyReviewed: true, confirmText: CONFIRM_LIVE_TEXT };
  assert.equal(puedeActivarProduccion(ok).ok, true);
  assert.equal(puedeActivarProduccion({ ...ok, confirmText: " facturar en produccion " }).ok, true);
  for (const [k, v] of [["mode", "own_key"], ["status", "error"], ["productionReady", false], ["issuerReviewed", false], ["policyReviewed", false], ["confirmText", ""], ["confirmText", "si"]]) {
    const r = puedeActivarProduccion({ ...ok, [k]: v });
    assert.equal(r.ok, false, k + "=" + v);
    assert.ok(r.error.length > 10);
  }
  assert.equal(puedeActivarProduccion().ok, false);
});

test("leerLlave: acepta texto, lista de textos u objetos, y rechaza el ambiente equivocado", () => {
  const live = "sk_live_" + "Z".repeat(30), test = "sk_test_" + "Z".repeat(30);
  assert.equal(leerLlave(live, LIVE_KEY_RE), live);
  assert.equal(leerLlave([live], LIVE_KEY_RE), live);
  assert.equal(leerLlave([{ id: "1", secret_key: live }], LIVE_KEY_RE), live);
  assert.equal(leerLlave({ data: [{ key: live }] }, LIVE_KEY_RE), live);
  assert.equal(leerLlave([], LIVE_KEY_RE), null);
  assert.equal(leerLlave(test, LIVE_KEY_RE), null);   // una llave de pruebas nunca pasa por producción
  assert.equal(leerLlave(live, TEST_KEY_RE), null);
  assert.equal(leerLlave(null, LIVE_KEY_RE), null);
});

test("mensajeCsd: mensajes claros y sin eco de datos", () => {
  assert.match(mensajeCsd("certificate_files_invalid"), /CSD/);
  assert.match(mensajeCsd("otra_cosa"), /Revisa/);
});

test("vistaConexion de plataforma no incluye llaves ni texto cifrado", () => {
  const v = vistaConexion({ status: "connected", environment: "live", mode: "platform", organization_id: "o", pending_steps: [], production_ready: true,
    secret_ciphertext: "A", secret_iv: "B", live_secret_ciphertext: "C", live_secret_iv: "D", live_key_fingerprint: "ABCDEF123456", csd_valid_until: "2030-01-01T00:00:00Z" });
  const txt = JSON.stringify(v);
  assert.equal(/ciphertext|_iv|secret/i.test(txt), false);
  assert.equal(v.live_key_fingerprint, "ABCDEF123456");
  assert.equal(v.mode, "platform");
});

test("la función: producción exige finance.invoice, compuerta y no usa upsert ni registra la contraseña", () => {
  const src = readFileSync(new URL("../supabase/functions/facturapi/index.ts", import.meta.url), "utf8");
  assert.match(src, /enable_live[\s\S]*requirePermission\(auth, CORS, "finance\.invoice"\)/);
  assert.match(src, /puedeActivarProduccion\(/);
  assert.match(src, /rfcCoincide\(st\.tax_id, iss\.rfc\)/);
  assert.doesNotMatch(src, /\.upsert\(/);
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*password/i);
  assert.match(src, /MAX_CSD_FAILS_PER_HOUR/);
  assert.match(src, /FACTURAPI_USER_KEY/);
});

test("la migración permite producción solo con cuenta de plataforma, llave live y confirmación registrada", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261117200000_smyl_facturapi_platform.sql", import.meta.url), "utf8");
  assert.match(sql, /check\(environment in \('test','live'\)\)/);
  assert.match(sql, /mode='platform' and production_ready and live_secret_ciphertext is not null/);
  assert.match(sql, /live_enabled_by is not null/);
  assert.doesNotMatch(sql, /grant [^;]*smyl_facturapi_connections/i);
});
