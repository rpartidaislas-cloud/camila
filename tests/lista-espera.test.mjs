import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261123120000_smyl_waitlist.sql");
const mod = read("smyl-waitlist.js"), sched = read("smyl-schedule.js"), inbox = read("smyl-inbox.js"), app = read("app.html"), sw = read("sw.js");

test("migración: una entrada activa por paciente y servicio, lectura con schedule.read y escritura solo por RPC", () => {
  assert.match(sql, /create unique index if not exists smyl_waitlist_active_uidx[\s\S]*where status in \('waiting', 'offered'\)/);
  assert.match(sql, /create policy smyl_waitlist_entries_read[\s\S]*smyl_has_permission\(tenant_id, 'schedule\.read'\)/);
  assert.match(sql, /revoke insert, update, delete on table public\.smyl_waitlist_entries from authenticated/);
  for (const fn of ["smyl_waitlist_add", "smyl_waitlist_offer", "smyl_waitlist_set_status"]) {
    const body = sql.slice(sql.indexOf("function public." + fn));
    assert.match(body.slice(0, 900), /smyl_has_permission\(v_tenant, 'schedule\.manage'\)/, fn + " exige schedule.manage");
    assert.match(sql, new RegExp("grant execute on function public\\." + fn));
  }
  assert.match(sql, /create trigger smyl_appointments_waitlist_booked after insert on public\.smyl_appointments/);
  assert.doesNotMatch(sql, /drop table|drop column|delete from public\.(?!smyl_waitlist)/i);
  assert.ok(read("docs/sql-lista-de-espera-pegar-en-supabase.sql").includes("smyl_waitlist_active_uidx"));
});

test("la lista de espera nunca envía mensajes ni agenda: solo deja el texto en el chat para que una persona lo envíe", () => {
  assert.match(mod, /window\.SmylInbox\.compose\(conv, text, \{/);
  assert.doesNotMatch(mod, /sendTemplate|action: 'send'|smyl_create_appointment|smyl_inbox_confirm_appointment_request/);
  const compose = inbox.slice(inbox.indexOf("compose: async function"), inbox.indexOf("sendTemplate: async function"));
  assert.match(compose, /setComposerText\(text\); return true;/);
  assert.doesNotMatch(compose, /request\('POST'|action: 'send'|sendTemplate\(/);
});

test("solo quien administra la agenda recibe avisos y ve acciones", () => {
  assert.match(mod, /!opts\.canManage/);
  assert.match(mod, /canManage \? '<div class="wl-actions">/);
  assert.match(sched, /if\(!window\.SmylWaitlist\|\|!state\.canManage\|\|!a\)return/);
});

test("Agenda: pestaña, panel y aviso al cancelar o mover una cita", () => {
  assert.match(sched, /data-schedule-tab="waitlist">Lista de espera <span id="schedule-waitlist-count">/);
  assert.match(sched, /data-schedule-panel="waitlist" hidden/);
  assert.match(sched, /if\(state\.tab==='waitlist'&&window\.SmylWaitlist\)window\.SmylWaitlist\.render\(/);
  assert.match(sched, /if\(status==='cancelled'\)\{offerNotice\('cancelled',a\.id\);freeUp\(a\);\}/);
  assert.equal((sched.match(/offerNotice\('rescheduled',a\.id,\{starts_at:a\.starts_at\}\);freeUp\(a\);/g) || []).length, 2);
  assert.match(sched, /if\(movedFrom\)\{offerNotice\('rescheduled',a\.id,movedFrom\);freeUp\(a\);\}/);
});

test("chat: «Poner en lista de espera» pasa la conversación y el chat no toca tablas ni el tenant", () => {
  assert.match(inbox, /data-availability-waitlist/);
  assert.match(inbox, /SmylWaitlist\.openAdd\(\{ conversationId: state\.selectedId[\s\S]*source: 'chat'/);
  assert.doesNotMatch(inbox, /window\.tenantId|tenant_id/);
});

test("se publica en web, PWA y móvil con el motor antes del módulo", () => {
  assert.ok(app.indexOf("smyl-waitlist-core.js") > 0 && app.indexOf("smyl-waitlist-core.js") < app.indexOf("smyl-waitlist.js") && app.indexOf("smyl-waitlist.js") < app.indexOf("smyl-schedule.js"));
  assert.match(app, /smyl-waitlist\.css\?v=1/);
  for (const [f, v] of [["smyl-waitlist-core.js", 2], ["smyl-waitlist.js", 2], ["smyl-waitlist.css", 1]]) assert.match(sw, new RegExp("/camila/" + f.replace(".", "\\.") + "\\?v=" + v));
  for (const f of ["smyl-waitlist-core.js", "smyl-waitlist.js", "smyl-waitlist.css", "smyl-schedule.js", "smyl-inbox.js", "app.html", "sw.js"]) {
    assert.ok(existsSync(new URL("../mobile/www/" + f, import.meta.url)), "falta mobile/www/" + f);
    assert.equal(read("mobile/www/" + f), read(f), "mobile/www/" + f + " no coincide");
  }
});

test("con la ventana de WhatsApp cerrada se usa la plantilla aprobada y la oferta se registra solo al enviarla", () => {
  const compose = inbox.slice(inbox.indexOf("compose: async function"), inbox.indexOf("sendTemplate: async function"));
  assert.match(compose, /options\.template && conversation && conversation\.channel === 'whatsapp' && windowNow && !windowNow\.freeform_allowed/);
  assert.match(compose, /state\.templates\.some\(function \(item\) \{ return names\.indexOf\(item\.name\) !== -1; \}\)/);   // sin plantilla aprobada: avisa y no abre nada
  assert.match(compose, /openTemplateDialog\(names, \{ variables: options\.template\.variables \|\| \[\], onSent: options\.onSent \|\| null \}\)/);
  assert.match(compose, /return 'template';/);
  assert.match(mod, /template: \{ names: \[Core\.OFFER_TEMPLATE\], variables: Core\.templateVariables\(/);
  assert.match(mod, /onSent: register/);
  assert.match(mod, /if \(result === 'template'\) toast\(/);
  assert.match(mod, /else if \(result\) \{ await register\(\);/);        // texto libre: se registra al dejarlo escrito; plantilla: solo con onSent
  assert.match(mod, /Solicítala en Mensajería → Plantillas/);
});
