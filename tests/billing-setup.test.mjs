import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const js = read("smyl-finance.js"), hub = read("smyl-settings-hub.js"), css = read("smyl-finance.css");

test("la configuración fiscal vive en Configuración → Cobros → Facturación como cuatro pasos", () => {
  assert.match(hub, /title: 'Facturación'[^}]*element: '#billing-setup'[^}]*ensure: 'billing'/);
  assert.match(hub, /openItem: function \(section, title\)/);
  for (const id of ["issuer", "facturapi", "services", "policy", "production"]) assert.ok(js.includes(`{id:'${id}'`), id);
  assert.match(js, /ensureBilling:ensureBilling/);
});

test("Cobros → Facturación solo conserva una franja de estado que lleva a Configuración", () => {
  assert.match(js, /function fiscalStatusStrip\(\)/);
  assert.match(js, /\+fiscalStatusStrip\(\)\+draftsHtml\+receivers/);
  assert.doesNotMatch(js, /id="finance-issuer"|id="finance-pac"|id="finance-facturapi"/);
});

test("el formulario del emisor valida en el navegador y no pide certificados ni contraseñas", () => {
  assert.match(js, /\^\[A-ZÑ&\]\{3,4\}\[0-9\]\{6\}\[A-Z0-9\]\{3\}\$/);
  assert.match(js, /Régimen fiscal<select name="regime"/);
  assert.match(js, /smyl_save_issuer_fiscal_profile/);
  assert.doesNotMatch(js.slice(js.indexOf("function openIssuerFiscal"), js.indexOf("function openFacturapiConnect")), /type="file"|type="password"/);
});

test("conectar Facturapi: la llave es de contraseña, no se guarda en el navegador y se marca el PAC", () => {
  const block = js.slice(js.indexOf("function openFacturapiConnect"));
  assert.match(block, /type="password"/);
  assert.doesNotMatch(block, /localStorage|sessionStorage/);
  assert.match(js, /setPac\(\{provider:'Facturapi',auth:true,sandbox:true\}\)/);
});

test("los diálogos y avisos funcionan aunque la página Cobros esté oculta", () => {
  assert.match(js, /if\(d\.parentNode!==document\.body\)document\.body\.append\(d\)/);
  assert.match(js, /id='billing-feedback'|fb\.id='billing-feedback'/);
  assert.match(css, /\.finance-dialog \.finance-actions \.btn-secondary/);
});

test("CSD y producción: el CSD no se guarda en el navegador y producción exige confirmación escrita", () => {
  const csd = js.slice(js.indexOf("function openCsdDialog"), js.indexOf("function openLiveDialog"));
  assert.match(csd, /type="password" autocomplete="new-password"/);
  assert.match(csd, /new FormData\(\)/);
  assert.match(csd, /f\.elements\.password\.value=''/);
  assert.doesNotMatch(csd, /localStorage|sessionStorage|console\./);
  const live = js.slice(js.indexOf("function openLiveDialog"), js.indexOf("async function facturapiRun"));
  assert.match(live, /FACTURAR EN PRODUCCION/);
  assert.match(live, /type="submit" disabled/);
  assert.match(live, /las facturas serán reales/i);
});
