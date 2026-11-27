import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const M = require("../smyl-prescription-model.js");
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261125130000_smyl_prescriptions.sql");

const ok = { generic: "Amoxicilina", form: "cápsulas", dose: "1 cápsula", route: "oral", frequency: "cada 8 horas", duration_days: 7, quantity: "21 cápsulas" };

test("las listas del navegador y de la función SQL son las mismas (no se desalinean)", () => {
  const arr = (name) => [...sql.match(new RegExp(`${name} text\\[\\] := array\\[([\\s\\S]*?)\\];`))[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(arr("v_controlled"), M.CONTROLLED);
  assert.deepEqual(arr("v_antibiotics"), M.ANTIBIOTICS);
  assert.ok(sql.includes("not between 1 and 12") && M.MAX_ITEMS === 12);
  assert.ok(sql.includes("v_days > 30") && M.ANTIBIOTIC_MAX_DAYS === 30);
});

test("issues: cada medicamento exige genérico, presentación, dosis, vía, frecuencia, cantidad y duración", () => {
  assert.deepEqual(M.issues([ok], true), []);
  for (const [campo, mensaje] of [["generic", "nombre genérico"], ["form", "presentación"], ["dose", "dosis"], ["route", "vía"], ["frequency", "frecuencia"], ["quantity", "cantidad"], ["duration_days", "duración"]]) {
    const r = M.issues([{ ...ok, [campo]: campo === "duration_days" ? 0 : "" }], true);
    assert.equal(r.length, 1, campo);
    assert.ok(r[0].includes(mensaje), `${campo}: ${r[0]}`);
  }
  assert.equal(M.issues([], true)[0], "La receta debe tener de 1 a 12 medicamentos.");
  assert.equal(M.issues(Array(13).fill(ok), true)[0], "La receta debe tener de 1 a 12 medicamentos.");
  assert.deepEqual(M.issues([ok], false), ["Confirma que la receta no incluye medicamentos controlados."]);
});

test("controlados: se rechazan por nombre o marca, con acentos y mayúsculas", () => {
  for (const generic of ["Tramadol", "TRAMADOL", "Diazepam 10 mg", "Codeína"]) assert.ok(M.issues([{ ...ok, generic }], true).some((m) => m.includes("controlado")), generic);
  assert.ok(M.issues([{ ...ok, generic: "Ansiolítico", brand: "Valiúm Diazepam" }], true).some((m) => m.includes("controlado")), "por marca");
  assert.equal(M.issues([{ ...ok, generic: "Ibuprofeno" }], true).length, 0);
});

test("antibióticos: se marcan y no pasan de 30 días", () => {
  assert.equal(M.classify("Amoxicilina con ácido clavulánico").antibiotic, true);
  assert.equal(M.classify("Ibuprofeno").antibiotic, false);
  assert.deepEqual(M.issues([{ ...ok, duration_days: 30 }], true), []);
  assert.ok(M.issues([{ ...ok, duration_days: 45 }], true)[0].includes("30 días"));
  assert.deepEqual(M.issues([{ ...ok, generic: "Ibuprofeno", duration_days: 45 }], true), [], "solo los antibióticos tienen ese tope");
});

test("alergias: coincidencia directa y de la misma familia; sin alergias no hay aviso", () => {
  const alergia = M.allergiesOf({ allergy_records: [{ substance: "Penicilina" }], allergies: ["Látex"], allergies_status: "yes" });
  assert.deepEqual(alergia.names, ["Penicilina", "Látex"]);
  const w = M.allergyWarnings([{ generic: "Amoxicilina" }, { generic: "Ibuprofeno" }], alergia);
  assert.equal(w.length, 1);
  assert.equal(w[0].item, 1);
  assert.match(w[0].reason, /misma familia/);
  assert.equal(M.allergyWarnings([{ generic: "Penicilina V" }], alergia)[0].reason, "coincide con la alergia registrada");
  assert.deepEqual(M.allergyWarnings([{ generic: "Amoxicilina" }], M.allergiesOf({})), []);
  assert.match(M.allergyNote(M.allergiesOf({ allergies_status: "pending" })), /no están confirmadas/);
  assert.match(M.allergyNote(M.allergiesOf({ allergies_status: "no" })), /no tiene alergias/);
  assert.match(M.allergyNote(null), /No se pudo consultar/);
  assert.deepEqual(M.allergiesOf(null).names, []);
});

test("payload y hoja: solo viajan los campos conocidos y la hoja sale de la copia congelada", () => {
  const p = M.payload([{ ...ok, extra: "no", duration_days: "7" }])[0];
  assert.deepEqual(Object.keys(p).sort(), ["brand", "dose", "duration_days", "form", "frequency", "generic", "quantity", "route", "strength"]);
  assert.equal(p.duration_days, 7);
  const hoja = M.toSheet({ issued_at: "x", snapshot: { folio: "R-000001", professional: { name: "Dra." }, items: [ok], diagnosis: "dx", legends: ["no debe pasar"] } });
  assert.equal(hoja.folio, "R-000001");
  assert.deepEqual(hoja.legends, [], "el módulo no inventa leyendas legales");
});

test("reutilizar una receta crea un borrador editable sin modificar la copia congelada", () => {
  const row = { snapshot: { diagnosis: "Dx anterior", indications: "Con alimentos", items: [{ ...ok, duration_days: undefined, duration: "7 días" }] } };
  const draft = M.draftFromPrescription(row);
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].duration_days, 7);
  assert.equal(draft.diagnosis, "Dx anterior");
  draft.items[0].generic = "Otro";
  assert.equal(row.snapshot.items[0].generic, "Amoxicilina", "la receta emitida no se toca");
  assert.deepEqual(M.draftFromPrescription(null), { items: [], diagnosis: "", indications: "" });
});

test("migración: emisor siempre la sesión, receta inmutable, folio consecutivo y permisos cerrados", () => {
  assert.match(sql, /user_id = auth\.uid\(\) and active/);
  assert.match(sql, /'clinical\.write'/);
  assert.match(sql, /on conflict \(tenant_id\) do update set next_folio = public\.smyl_prescription_sequences\.next_folio \+ 1/);
  assert.match(sql, /idempotency_key/);
  assert.match(sql, /smyl_prescriptions_guard/);
  assert.match(sql, /no se puede borrar; anúlala con motivo/);
  assert.match(sql, /revoke all on public\.smyl_prescription_sequences, public\.smyl_prescriptions from public, anon, authenticated/);
  assert.match(sql, /grant select on public\.smyl_prescriptions to authenticated/);
  assert.ok(!/grant (insert|update|delete)[^;]*smyl_prescriptions/.test(sql), "el cliente no escribe directo");
  assert.match(sql, /revoke all on function public\.smyl_issue_prescription[\s\S]*from public, anon/);
  assert.match(sql, /smyl_audit_row/);
  assert.match(sql, /NO se han\s*\n--\s*contrastado|NO se han contrastado|no se han\s*\n--\s*contrastado/i);
});

test("interfaz: se carga en la app, la consulta abre la receta y nada se interpreta como HTML", () => {
  const ui = read("smyl-prescriptions.js");
  assert.ok(!/innerHTML/.test(ui));
  assert.match(ui, /smyl_issue_prescription/);
  assert.match(ui, /p_idempotency_key: ctx\.key/);
  assert.match(ui, /body\.classList\.add\('rx-printing'\)/);
  assert.match(read("smyl-consultorio.js"), /window\.SmylPrescriptions\.open\(\{ patientId: p\.id/);
  const app = read("app.html"), sw = read("sw.js");
  for (const f of ["smyl-prescription-model.js", "smyl-prescription-print.js", "smyl-prescriptions.js", "smyl-prescription.css"]) {
    assert.ok(app.includes(f + "?v=2"), `${f} en app.html`);
    assert.ok(sw.includes(`/camila/${f}?v=2`), `${f} en sw.js`);
    assert.equal(read(f), read("mobile/www/" + f), `${f} móvil igual`);
  }
  for (const f of ["app.html", "sw.js", "smyl-consultorio.js"]) assert.equal(read(f), read("mobile/www/" + f), `${f} móvil igual`);
});

test("documentación: la lista de requisitos declara que NO está verificada contra el texto oficial", () => {
  assert.ok(existsSync(new URL("../docs/RECETA_REQUISITOS.md", import.meta.url)));
  const doc = read("docs/RECETA_REQUISITOS.md");
  assert.match(doc, /NO VERIFICADO contra el texto oficial/);
  assert.match(doc, /Para el abogado/);
  for (const f of ["smyl-prescription-model.js", "smyl-prescriptions.js", "smyl-prescription-print.js"]) assert.match(read(f), /contrast|docs\/RECETA_REQUISITOS\.md/);
});
