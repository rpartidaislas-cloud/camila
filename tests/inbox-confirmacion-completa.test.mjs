import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const inbox = read("smyl-inbox.js"), app = read("app.html"), sw = read("sw.js");
const sql = read("supabase/migrations/20261122150000_smyl_visit_instructions.sql");

test("la migración es aditiva, idempotente, con límites y sin permisos ni funciones nuevas", () => {
  assert.match(sql, /add column if not exists arrival_notes text not null default ''/);
  assert.match(sql, /add column if not exists prep_instructions text not null default ''/);
  assert.match(sql, /char_length\(arrival_notes\) <= 300/);
  assert.match(sql, /char_length\(prep_instructions\) <= 400/);
  assert.doesNotMatch(sql, /drop |grant |create (or replace )?function|create policy/i);
  assert.equal(read("docs/sql-informacion-cita-pegar-en-supabase.sql").includes("add column if not exists arrival_notes"), true);
});

test("los campos nuevos solo se muestran y se guardan si la columna existe (publicar antes de migrar no rompe nada)", () => {
  const admin = read("smyl-clinic-admin.js"), catalog = read("smyl-service-catalog.js");
  assert.match(admin, /select\('\*'\)/);
  assert.match(admin, /hasOwnProperty\.call\(branch, 'arrival_notes'\) \? '<div class="clinic-admin-field/);
  assert.match(admin, /hasOwnProperty\.call\(branch, 'arrival_notes'\) \? \{ arrival_notes:/);
  assert.match(catalog, /function prepFieldAvailable\(existing\)/);
  assert.match(catalog, /if\(!prepFieldAvailable\(existing\)&&!row\.prep_instructions\)delete row\.prep_instructions/);
  assert.match(read("smyl-service-catalog-model.js"), /prep_instructions: String\(row\.prep_instructions \|\| ''\)\.trim\(\)/);
});

test("el chat arma el mensaje completo con la sesión de la persona y conserva el mensaje corto como respaldo", () => {
  const book = inbox.slice(inbox.indexOf("var basic = 'Listo'"), inbox.indexOf("state.availabilitySelected = [];", inbox.indexOf("var basic = 'Listo'")));
  assert.match(book, /setComposerText\(basic\)/);
  assert.match(book, /visitConfirmationText\(firstName, slot\)\.then\(/);
  assert.match(book, /\.catch\(function \(\) \{\}\)/);
  const helper = inbox.slice(inbox.indexOf("async function visitConfirmationText"), inbox.indexOf("async function loadAvailabilityRequests"));
  assert.match(helper, /window\.SmylSchedule\.visitInfo\(slot\.branch_id, slot\.service_id\)/);   // los datos los lee Agenda, no el chat
  assert.doesNotMatch(inbox, /window\.tenantId|tenant_id/);                                 // el chat no toca tablas ni el tenant
  assert.match(read("smyl-schedule.js"), /visitInfo:async function\(branchId,serviceId\)/);
  assert.doesNotMatch(helper, /request\('POST'|action: 'send'/);                                      // nunca envía: solo escribe en el compositor
});

test("el redactor se publica en web, PWA y móvil y carga antes del Inbox", () => {
  assert.ok(app.indexOf("smyl-visit-message.js") > 0 && app.indexOf("smyl-visit-message.js") < app.indexOf("smyl-inbox.js"));
  assert.match(sw, /\/camila\/smyl-visit-message\.js\?v=1/);
  for (const f of ["smyl-visit-message.js", "smyl-clinic-admin.js", "smyl-service-catalog.js", "smyl-service-catalog-model.js"]) {
    assert.ok(existsSync(new URL("../mobile/www/" + f, import.meta.url)));
    assert.equal(read("mobile/www/" + f), read(f), "mobile/www/" + f + " no coincide");
  }
});
