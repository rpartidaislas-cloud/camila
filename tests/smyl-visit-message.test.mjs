import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const V = require("../smyl-visit-message.js");

const branch = { name: "Clínica Centro", address_line: "Av. Juárez 120", city: "Zapopan", state: "Jalisco", postal_code: "45050", phone: "33 1234 5678", arrival_notes: "Estacionamiento en el sótano; sube al piso 2.", timezone: "America/Mexico_City" };
const slot = { starts_at: "2026-11-24T16:00:00.000Z", ends_at: "2026-11-24T17:00:00.000Z", professional_name: "Dra. Fernanda Ruiz", branch_name: "Clínica Centro", timezone: "America/Mexico_City" };
const service = { name: "Valoración dental", prep_instructions: "Llega 10 minutos antes y trae tus estudios previos si los tienes." };

test("el mensaje completo trae cuándo, con quién, dónde, mapa, cómo llegar, qué hacer antes y calendario", () => {
  const out = V.build({ firstName: "Ana", slot, service, branch, clinic: "Clínica Sonrisa" });
  assert.match(out.text, /^Ana, tu cita quedó confirmada\./);
  assert.match(out.text, /Cuándo: Martes 24 de noviembre, 10:00 a\. ?m\./);   // 16:00 UTC = 10:00 en México
  assert.match(out.text, /Servicio: Valoración dental/);
  assert.match(out.text, /Con: Dra\. Fernanda Ruiz/);
  assert.match(out.text, /Dónde: Clínica Centro · Av\. Juárez 120, Zapopan, Jalisco, 45050/);
  assert.match(out.text, /Mapa: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Av\.%20Ju%C3%A1rez%20120/);
  assert.match(out.text, /Cómo llegar: Estacionamiento en el sótano/);
  assert.match(out.text, /Antes de tu cita: Llega 10 minutos antes/);
  assert.match(out.text, /Agrégala a tu calendario: https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.match(out.text, /llámanos al 33 1234 5678\./);
});

test("el enlace de calendario lleva fechas en UTC, título y lugar, y nada del paciente", () => {
  const link = V.build({ firstName: "Ana", slot, service, branch, clinic: "Clínica Sonrisa" }).links.calendar;
  const url = new URL(link);
  assert.equal(url.searchParams.get("dates"), "20261124T160000Z/20261124T170000Z");
  assert.equal(url.searchParams.get("text"), "Valoración dental · Clínica Sonrisa");
  assert.match(url.searchParams.get("location"), /Av\. Juárez 120/);
  assert.equal(/Ana|paciente|@|tel/i.test(link), false);
});

test("sin datos opcionales se omiten esas líneas en vez de mostrar vacíos", () => {
  const out = V.build({ slot: { starts_at: slot.starts_at, professional_name: "Dr. Beto", branch_name: "Plaza" }, service: { name: "Limpieza" }, branch: { name: "Plaza" } });
  assert.match(out.text, /^Tu cita quedó confirmada\./);
  assert.doesNotMatch(out.text, /Mapa:|Cómo llegar:|Antes de tu cita:|llámanos al/);
  assert.match(out.text, /Si necesitas cambiarla, respóndenos por aquí\./);
  assert.equal(out.links.maps, "");
  assert.match(out.text, /Agrégala a tu calendario:/);   // el calendario solo necesita la fecha
});

test("la hora se muestra en la zona de la sucursal y una zona inválida no rompe", () => {
  assert.match(V.whenText("2026-11-24T16:00:00.000Z", "America/Tijuana"), /8:00 a\. ?m\./);
  assert.doesNotThrow(() => V.whenText("2026-11-24T16:00:00.000Z", "Zona/Inventada"));
  assert.equal(V.whenText("no-es-fecha"), "");
});

test("limpia saltos de línea y caracteres de control de los textos escritos por la clínica", () => {
  const out = V.build({ slot, service: { name: "Limpieza\u0000\nprofunda", prep_instructions: "Cepíllate\n\n\nantes" }, branch: { ...branch, arrival_notes: "Piso\t2\r\nlocal 4" } });
  assert.match(out.text, /Servicio: Limpieza profunda/);
  assert.match(out.text, /Antes de tu cita: Cepíllate antes/);
  assert.match(out.text, /Cómo llegar: Piso 2 local 4/);
  assert.equal(out.text.includes("\u0000"), false);
});

test("datos vacíos o ausentes devuelven un texto válido", () => {
  assert.doesNotThrow(() => V.build());
  assert.doesNotThrow(() => V.build({}));
  assert.equal(V.calendarLink({ starts_at: "nada" }), "");
});
