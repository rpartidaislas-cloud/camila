import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizarSecciones, normalizarComparticion, construirSnapshot, detalleSede, estadoEnlace, vistaPaciente, limpiarNotaInteres,
  CONSENT_TEXT, CONSENT_VERSION, HISTORIAL_MAX,
} from "../supabase/functions/_shared/smyl-proposal-share-core.mjs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const propuesta = {
  id: "p1", revision: 3, plan_revision: 2, status: "approved", patient_name: "María Pérez López", clinic_name: "Clínica Sol",
  professional_name: "Dra. Ruiz", tenant_id: "T", patient_id: "PAC-SECRETO", updated_by: "USR-SECRETO",
  document: { schema: 2, title: "Tu propuesta", items: [{ label: "Carillas", teeth: [11, 21], unit_cents: 500000, quantity: 2 }], photos: { view: "frontal", before_path: "T/a.jpg", simulation_path: "T/b.jpg" } },
};

test("secciones: todo opcional apagado por defecto; solo true explícito enciende", () => {
  assert.deepEqual(normalizarSecciones(undefined), { odontogram: false, photos: false, history: false });
  assert.deepEqual(normalizarSecciones({ odontogram: "true", photos: 1, history: true }), { odontogram: false, photos: false, history: true });
});

test("comparticion: historial exige texto, vigencia 1–30 días, textos limpios y acotados", () => {
  assert.equal(normalizarComparticion({ sections: { history: true }, history_summary: "corto" }).ok, false);
  const ok = normalizarComparticion({ sections: { history: true }, history_summary: "  Paciente sin alergias conocidas.  ", payment_note: "Contado\u0000 o tarjeta" });
  assert.equal(ok.ok, true);
  assert.equal(ok.valor.history_summary, "Paciente sin alergias conocidas.");
  assert.equal(ok.valor.expires_days, 15, "15 días por defecto");
  assert.ok(!ok.valor.payment_note.includes("\u0000"));
  for (const d of [0, 31, 1.5, "x"]) assert.equal(normalizarComparticion({ expires_days: d }).ok, false, String(d));
  const largo = normalizarComparticion({ sections: { history: true }, history_summary: "x".repeat(5000) });
  assert.equal(largo.valor.history_summary.length, HISTORIAL_MAX);
  assert.equal(normalizarComparticion({ sections: { history: false }, history_summary: "no debe viajar" }).valor.history_summary, "", "sin la casilla no viaja historial");
});

test("snapshot: copia congelada, sin ids internos, fotos solo si se piden, solo primer nombre", () => {
  const con = construirSnapshot(propuesta, { secciones: { odontogram: true, photos: true, history: false } });
  const sin = construirSnapshot(propuesta, { secciones: { odontogram: false, photos: false, history: false } });
  assert.equal(con.document.photos.before_path, "T/a.jpg");
  assert.equal(sin.document.photos, null, "sin la casilla las fotos no viajan");
  assert.equal(con.patient_name, "María");
  const texto = JSON.stringify(con);
  for (const prohibido of ["PAC-SECRETO", "USR-SECRETO", "tenant_id", "updated_by"]) assert.ok(!texto.includes(prohibido), prohibido);
  propuesta.document.title = "EDITADA DESPUÉS";
  assert.equal(con.document.title, "Tu propuesta", "editar la propuesta no cambia lo ya compartido");
  propuesta.document.title = "Tu propuesta";
});

test("sede: solo cuando se pasa; dirección y teléfono armados", () => {
  assert.equal(construirSnapshot(propuesta, { secciones: normalizarSecciones({}) }).branch_label, "");
  const s = detalleSede({ name: "Norte", address_line: "Av. 1", city: "GDL", state: "Jal", phone: "33" });
  assert.deepEqual(s, { label: "Norte", detail: "Av. 1, GDL, Jal · Tel. 33" });
  assert.equal(detalleSede(null), null);
});

test("estado del enlace: cancelado, vencido, aceptado, activo", () => {
  const f = (o) => ({ status: "active", expires_at: new Date(Date.now() + 1e6).toISOString(), accepted_at: null, ...o });
  assert.equal(estadoEnlace(f({})), "active");
  assert.equal(estadoEnlace(f({ accepted_at: "2026-11-19" })), "accepted");
  assert.equal(estadoEnlace(f({ status: "revoked" })), "revoked");
  assert.equal(estadoEnlace(f({ expires_at: new Date(Date.now() - 1000).toISOString() })), "expired");
  assert.equal(estadoEnlace(f({ status: "revoked", accepted_at: "x" })), "revoked", "cancelar gana");
});

test("vistaPaciente: el historial solo se entrega si su casilla está marcada; no filtra hash ni ids", () => {
  const share = { id: "S-INT", tenant_id: "T-INT", token_hash: "H-INT", status: "active", expires_at: new Date(Date.now() + 1e6).toISOString(),
    snapshot: { document: {} }, sections: { history: false }, history_summary: "NO DEBE SALIR", payment_note: "Contado", interested_at: null, accepted_at: null };
  const v = vistaPaciente(share, {});
  assert.equal(v.history_summary, "");
  assert.equal(v.consent_version, CONSENT_VERSION);
  assert.equal(v.consent_text, CONSENT_TEXT);
  for (const prohibido of ["S-INT", "T-INT", "H-INT"]) assert.ok(!JSON.stringify(v).includes(prohibido), prohibido);
  assert.equal(vistaPaciente({ ...share, sections: { history: true } }, {}).history_summary, "NO DEBE SALIR");
});

test("nota de interés: acotada y sin caracteres de control", () => {
  assert.equal(limpiarNotaInteres("hola\u0007 mundo"), "hola mundo");
  assert.equal(limpiarNotaInteres("x".repeat(900)).length, 300);
  assert.equal(limpiarNotaInteres(null), "");
});

test("función: personal exige sesión y proposal.followup; público por token; fotos solo de la clínica; aceptar exige consentimiento", () => {
  const src = read("supabase/functions/smyl-proposal-share/index.ts");
  assert.match(src, /requireUser\(req, CORS\)/);
  assert.match(src, /proposal\.followup/);
  assert.match(src, /propuesta\.status !== "approved"/);
  assert.match(src, /startsWith\(tenantId \+ "\/"\)/);
  assert.match(src, /body\.consent !== true \|\| body\.consent_version !== CONSENT_VERSION/);
  assert.match(src, /\.is\("accepted_at", null\)/, "aceptar es atómico y de una sola vez");
  assert.match(read("supabase/config.toml"), /\[functions\.smyl-proposal-share\]\s*\nverify_jwt = false/);
});

test("migración: tabla solo service_role con RLS; el consentimiento queda ligado a su versión", () => {
  const sql = read("supabase/migrations/20261119160000_smyl_proposal_shares.sql");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.smyl_proposal_shares from public, anon, authenticated/);
  assert.match(sql, /token_hash text not null check \(token_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(sql, /check \(\(accepted_at is null\) = \(consent_version is null\)\)/);
});

test("propuesta.html: sin innerHTML con datos, CSP, noindex, token en fragmento y mismo renderizador que el PDF", () => {
  const html = read("propuesta.html");
  assert.ok(!/innerHTML\s*=/.test(html));
  assert.match(html, /Content-Security-Policy/);
  assert.ok(!/frame-ancestors/.test(html), "frame-ancestors en <meta> lo ignora el navegador: no se aparenta protección");
  assert.match(html, /window\.top !== window\.self/, "anti-clickjacking por script");
  assert.match(html, /AbortController/, "con tiempo límite");
  assert.match(html, /name="robots" content="noindex/);
  assert.match(html, /history\.replaceState/);
  assert.match(html, /SmylProposalPrint\.render\(v\.row, v\.assets, true, \{ hideMap: !\(v\.sections && v\.sections\.odontogram\) \}\)/);
  assert.match(read("smyl-proposal-print.js"), /function render\(row,assets,approved,opts\)/);
  assert.match(read("smyl-proposal-print.js"), /!\(opts&&opts\.hideMap\)/);
});

test("interfaz del doctor: botón «Compartir con el paciente» solo con propuesta aprobada y permiso; móvil sincronizado", () => {
  const js = read("smyl-proposals.js");
  assert.match(js, /shareButton=b\('Compartir con el paciente',openShare\)/);
  assert.match(js, /shareBtn\.disabled=ctx\.busy\|\|ctx\.historical\|\|!approved\|\|!ctx\.access\.followup/);
  for (const f of ["smyl-proposals.js", "smyl-proposal-print.js", "app.html", "sw.js"]) assert.equal(read(f), read("mobile/www/" + f), `${f} móvil igual`);
  assert.match(read("app.html"), /smyl-proposals\.js\?v=29/);
});

test("aviso en la lista: el equipo solo lee columnas seguras del enlace; la función ya no escribe en el seguimiento del equipo", () => {
  const sql = read("supabase/migrations/20261120100000_smyl_proposal_shares_staff_read.sql");
  assert.match(sql, /grant select \(id, tenant_id, proposal_id/);
  for (const prohibida of ["snapshot", "token_hash", "history_summary", "payment_note", "consent_text_hash", "interest_note"]) {
    assert.ok(!new RegExp("grant select \\([^)]*" + prohibida).test(sql), `${prohibida} no se concede al equipo`);
  }
  assert.match(sql, /smyl_tenants_with_permission\('proposal\.read'\)/);
  const fn = read("supabase/functions/smyl-proposal-share/index.ts");
  assert.ok(!/smyl_proposal_followups/.test(fn), "no marca seguimiento del equipo cuando responde el paciente");
  const js = read("smyl-proposals.js");
  assert.match(js, /from\('smyl_proposal_shares'\)\.select\('proposal_id,proposal_revision,status,expires_at,open_count,last_opened_at,interested_at,accepted_at'\)/);
  assert.match(js, /catch\(_\)\{shareSignals=new Map\(\);\}/, "si falla, la lista sigue igual");
  assert.match(js, /Enlace: aceptó el plan/);
  assert.equal(js, read("mobile/www/smyl-proposals.js"));
});

test("revisión 2026-11-19: consentimiento v2 más específico; sin casilla de odontograma no viajan piezas ni superficies", () => {
  assert.equal(CONSENT_VERSION, "v2");
  for (const frag of ["datos de salud", "aviso de privacidad", "derechos ARCO", "revocar", "no autoriza publicar", "clínica que me lo envió"]) assert.ok(CONSENT_TEXT.includes(frag), frag);
  const sin = construirSnapshot(propuesta, { secciones: { odontogram: false, photos: false, history: false } });
  assert.deepEqual(sin.document.items[0].teeth, []);
  assert.deepEqual(sin.document.items[0].surfaces, []);
  const con = construirSnapshot(propuesta, { secciones: { odontogram: true, photos: false, history: false } });
  assert.deepEqual(con.document.items[0].teeth, [11, 21]);
  assert.deepEqual(propuesta.document.items[0].teeth, [11, 21], "la propuesta original no se modifica");
});

test("revisión: purga de copias vencidas con plazo y aviso de privacidad coherente; solo aceptadas se conservan", () => {
  const sql = read("supabase/migrations/20261120120000_smyl_review_fixes.sql");
  assert.match(sql, /smyl_payment_links_one_pending_idx[\s\S]*where status = 'pending'/);
  assert.match(sql, /accepted_at is null/, "no borra lo aceptado");
  assert.match(sql, /interval '90 days'/);
  assert.match(sql, /grant execute on function public\.smyl_purge_expired_proposal_shares\(integer\) to service_role/);
  assert.ok(!/grant execute[^;]*smyl_purge_expired_proposal_shares[^;]*to (anon|authenticated)/.test(sql));
  for (const f of ["privacidad.html", "mobile/www/privacidad.html"]) {
    const html = read(f);
    assert.match(html, /Copias de propuestas compartidas por enlace<\/td><td>Las no aceptadas se eliminan 90 días/);
    assert.match(html, /huella de tu dispositivo/);
  }
  assert.equal(read("privacidad.html"), read("mobile/www/privacidad.html"));
});

test("revisión: el aviso por fila solo cuenta la revisión vigente de la propuesta", () => {
  const js = read("smyl-proposals.js");
  assert.match(js, /proposal_revision,status,expires_at,open_count/);
  assert.match(js, /sh\.proposal_revision!==currentRev\.get\(sh\.proposal_id\)\)return/);
});
