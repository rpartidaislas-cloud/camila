import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const js = read("smyl-service-catalog.js"), css = read("smyl-service-catalog-stage1.css");

test("edición en bloque: solo con permiso, una sola escritura por acción y limitada a la clínica", () => {
  assert.match(js, /t\.hidden=!state\.canManage/);
  assert.match(js, /\.update\(patch\)\.eq\('tenant_id',state\.tenant\)\.in\('id',ids\)/);
  assert.match(js, /if\(!state\.canPrices\)return;var price=await bulkAsk/);
  assert.match(js, /state\.canPrices\?'<button type="button" data-bulk-do="price"/);
});

test("edición en bloque: valida rango y no toca lo que no se pidió", () => {
  assert.match(js, /min:10,max:480,step:'5',integer:true/);
  assert.match(js, /min:0,max:9999999999\.99/);
  assert.match(js, /bulkWrite\(ids,\{reference_price:price\}\)/);
  assert.match(js, /bulkWrite\(ids,\{duration_minutes:mins\}\)/);
});

test("edición en bloque: la revisión fiscal solo aplica a servicios con claves completas y pide confirmación", () => {
  assert.match(js, /x\.sat_product_service_code&&x\.sat_unit_code&&x\.tax_object_code&&x\.tax_treatment&&x\.tax_treatment!=='pending'/);
  assert.match(js, /fiscal_reviewed_by:state\.actor,fiscal_reviewed_at:/);
  assert.match(js, /window\.confirm\('Confirmas que el emisor o su contador/);
  assert.match(js, /window\.confirm\('¿Desactivar /);
});

test("edición en bloque: estilos y copias móviles", () => {
  for (const sel of [".catalog-bulkbar", ".catalog-bulk-toggle", ".catalog-bulk-check", ".catalog-bulk-dialog"]) assert.ok(css.includes(sel), sel);
  for (const f of ["smyl-service-catalog.js", "smyl-service-catalog-stage1.css", "app.html", "sw.js"]) assert.equal(read("mobile/www/" + f), read(f), f);
});
