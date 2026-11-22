import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Rx = require("../smyl-prescription-print.js");
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

// DOM mínimo: lo justo para comprobar que todo se dibuja con textContent y nada se interpreta como HTML.
function fakeDoc() {
  const mk = (tag) => ({ tag, className: "", _text: "", children: [], attrs: {}, set textContent(v) { this._text = String(v); }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    setAttribute(k, v) { this.attrs[k] = v; }, append(...n) { n.forEach((x) => this.children.push(x)); }, set innerHTML(_) { throw new Error("innerHTML prohibido"); } });
  return { createElement: mk, createTextNode: (t) => ({ tag: "#text", textContent: String(t), children: [] }) };
}

const completo = {
  folio: "R-1", issued_at: "2026-11-22",
  professional: { name: "Dra. Ana", specialty: "Endodoncia", license_number: "123", license_institution: "UdeG" },
  clinic: { name: "Clínica", address: "Av. 1", phone: "33" }, patient: { name: "Paciente", age_label: "34 años" },
  items: [{ generic: "Amoxicilina", strength: "500 mg", form: "cápsulas", dose: "1 cápsula", route: "oral", frequency: "cada 8 horas", duration: "7 días", quantity: "21" }],
};

test("sheetIssues: lista lo que le falta a la hoja para verse completa", () => {
  assert.deepEqual(Rx.sheetIssues(completo), []);
  assert.equal(Rx.sheetIssues({}).length, 7);
  const sinInst = JSON.parse(JSON.stringify(completo)); sinInst.professional.license_institution = "";
  assert.deepEqual(Rx.sheetIssues(sinInst), ["Institución que expidió el título"]);
  const sinNombre = JSON.parse(JSON.stringify(completo)); sinNombre.items[0].generic = "";
  assert.deepEqual(Rx.sheetIssues(sinNombre), ["Medicamento 1: nombre"]);
});

test("normalize: limpia caracteres de control, acota longitudes y número de medicamentos", () => {
  const n = Rx.normalize({ professional: { name: "A\u0000B\n\nC" }, items: Array.from({ length: 30 }, () => ({ generic: "x".repeat(500) })), indications: "y".repeat(5000) });
  assert.equal(n.professional.name, "A B C");
  assert.equal(n.items.length, 12);
  assert.equal(n.items[0].generic.length, 120);
  assert.equal(n.indications.length, 900);
  assert.deepEqual(Rx.normalize(null).items, []);
});

test("render: dibuja con textContent; un nombre con HTML malicioso queda como texto", () => {
  const doc = fakeDoc();
  const hoja = Rx.render({ ...completo, professional: { ...completo.professional, name: '"><img src=x onerror=alert(1)>' } }, doc);
  const todo = hoja.textContent;
  assert.ok(todo.includes('"><img src=x onerror=alert(1)>'), "se muestra literal");
  assert.ok(todo.includes("Amoxicilina · 500 mg · cápsulas"));
  assert.ok(todo.includes("1 cápsula, vía oral, cada 8 horas, durante 7 días."));
  assert.ok(todo.includes("Cantidad: 21"));
  assert.ok(todo.includes("Firma del profesional") && todo.includes("Sello"));
  assert.ok(!/innerHTML/.test(read("smyl-prescription-print.js").replace(/\/\*[\s\S]*?\*\//, "").replace(/set innerHTML/g, "")), "el módulo no usa innerHTML");
});

test("las leyendas legales solo aparecen si se pasan: este módulo no inventa contenido normativo", () => {
  const sin = Rx.render(completo, fakeDoc()).textContent;
  const con = Rx.render({ ...completo, legends: ["Leyenda de prueba"] }, fakeDoc()).textContent;
  assert.ok(!sin.includes("Leyenda de prueba") && con.includes("Leyenda de prueba"));
  const src = read("smyl-prescription-print.js");
  assert.match(src, /NO afirma\s*\n?\s*\*?\s*cumplir ninguna norma|NO afirma/);
});

test("hoja: media carta vertical y solo la hoja se imprime", () => {
  const css = read("smyl-prescription.css");
  assert.match(css, /@page\{size:5\.5in 8\.5in/);
  assert.match(css, /body \*\{visibility:hidden\}/);
});

test("perfil del profesional: institución que expidió el título (y cédula de especialidad), con respaldo si la base aún no tiene las columnas", () => {
  const sql = read("supabase/migrations/20261122100000_smyl_professional_license_institution.sql");
  assert.match(sql, /add column if not exists license_institution text not null default ''/);
  assert.match(sql, /char_length\(license_institution\) <= 120/);
  const js = read("smyl-clinic-admin.js");
  assert.match(js, /select\('id,license_institution,specialty_license'\)/);
  assert.match(js, /state\.credentialsSupported = false; state\.institutionSupported = false; return rows;/);
  assert.match(js, /if \(state\.credentialsSupported\) \{\s+changes\.license_institution/);
  assert.match(js, /Institución que expidió el título/);
  assert.match(js, /maxlength: '120'/);
  // Se publica en el directorio: la Ley General de Salud (art. 83) pide mostrar la institución que expidió el título.
  assert.match(read("supabase/migrations/20261126160000_smyl_public_profile_compliance.sql"), /professional\.license_institution,/);
});
