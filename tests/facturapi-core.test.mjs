import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion } from "../supabase/functions/_shared/facturapi-core.mjs";

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
