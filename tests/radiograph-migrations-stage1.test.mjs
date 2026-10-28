// Radiografía asistida — Etapas 0 y 1: contrato estático de las migraciones nuevas.
// Fija banderas cerradas, ACL, inmutabilidad y separación salida-del-modelo / decisión
// profesional sin depender de un servidor. La verificación en Postgres real está en
// tests/radiograph-pglite-stage1.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const flags = read('supabase/migrations/20261028100000_smyl_radiograph_ai_flags.sql');
const sources = read('supabase/migrations/20261028110000_smyl_radiograph_sources_v2.sql');
const runs = read('supabase/migrations/20261028120000_smyl_radiograph_ai_runs.sql');
const reports = read('supabase/migrations/20261028130000_smyl_radiograph_reports.sql');
const all = [flags, sources, runs, reports];
const v1 = read('supabase/migrations/20261006010000_smyl_radiograph_reviews.sql');

test('Etapa 0: las cinco banderas existen y nacen apagadas; sólo service_role las toca', () => {
  for (const key of ['radiograph.qc_v2', 'radiograph.tooth_ai_v1', 'radiograph.report_v1', 'radiograph.longitudinal_v1', 'radiograph.cbct_v1']) assert.match(flags, new RegExp(`'${key.replace('.', '\\.')}'`));
  assert.match(flags, /enabled boolean not null default false/);
  assert.match(flags, /revoke all on public\.smyl_radiograph_feature_flags, public\.smyl_radiograph_flag_tenants,\s*public\.smyl_radiograph_engines, public\.smyl_radiograph_settings from public, anon, authenticated/);
  assert.match(flags, /default 'false'|'allow_simulated', 'false'::jsonb/, 'el motor simulado está prohibido por defecto');
  assert.match(flags, /not coalesce\(t\.paused, false\)/, 'la clínica sólo pausa; el piloto lo concede la plataforma');
  assert.doesNotMatch(flags, /grant (select|insert|update|all) on public\.smyl_radiograph_(feature_flags|flag_tenants|engines)/);
  assert.doesNotMatch(flags, /create policy/);
});

test('Etapa 0: el registro de motores rechaza credenciales y sólo permite un motor activo por tipo', () => {
  assert.match(flags, /config::text !~\* '"\[\^"\]\*\(api\[_-\]\?key\|secret\|token\|authori\[sz\]ation\|password\|credential\)\[\^"\]\*"\\s\*:'/, 'el denylist mira llaves en cualquier nivel');
  assert.match(flags, /create trigger smyl_radiograph_engines_guard before insert or update/);
  assert.match(flags, /create unique index if not exists smyl_radiograph_engines_one_active_idx[\s\S]*where enabled/);
  assert.match(flags, /revoke all on function public\.smyl_radiograph_active_engine\(text\) from public, anon, authenticated/);
  assert.doesNotMatch(flags, /'engines'|e\.config/, 'las capacidades del navegador no exponen motores ni config');
});

test('Etapa 1: las fuentes son inmutables, sin URLs, con hash y consentimiento', () => {
  assert.match(sources, /storage_path !~ '\^\[a-z\]\+:\/\/'/);
  assert.match(sources, /sha256 text not null check \(sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(sources, /consent \?& array\['version','acceptedAt'\]/);
  assert.match(sources, /create trigger smyl_radiograph_sources_immutable before update or delete/);
  assert.match(sources, /v_study->'asset'->>'path', v_study->'asset'->>'sha256'/, 'la ruta se copia del expediente, nunca del cliente');
  assert.doesNotMatch(sources, /signed_url|createSignedUrl|https?:\/\//i);
});

test('Etapa 1: cada RPC del navegador pasa por la guardia tenant + permiso + alcance', () => {
  const rpcs = [
    [sources, 'smyl_radiograph_register_source', "'clinical.write'"],
    [sources, 'smyl_radiograph_correct_study_type', "'clinical.write'"],
    [sources, 'smyl_radiograph_log_access', "'clinical.read'"],
    [runs, 'smyl_radiograph_request_ai_run', "'clinical.write'"],
    [runs, 'smyl_radiograph_decide_candidate', "'clinical.write'"],
    [reports, 'smyl_radiograph_save_report_draft', "'clinical.write'"],
    [reports, 'smyl_radiograph_sign_report', "'clinical.approve'"],
    [reports, 'smyl_radiograph_add_report_addendum', "'clinical.approve'"],
    [reports, 'smyl_radiograph_export_report', "'clinical.read'"]
  ];
  for (const [sql, name, permission] of rpcs) {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    const body = sql.slice(start, sql.indexOf('$$;', start));
    assert.ok(start > -1, name);
    assert.match(body, /language plpgsql security definer set search_path = pg_catalog, public/, name);
    assert.ok(body.includes(`public.smyl_radiograph_guard(`) && body.includes(permission), `${name} exige ${permission}`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated`), name);
  }
  assert.match(sources, /smyl_has_permission\(v_tenant, p_permission\)[\s\S]*smyl_can_access_patient\(v_tenant, p_patient, 'clinical'\)/);
});

test('Etapa 1: el cierre del motor es sólo de servidor y la salida original es inmutable', () => {
  assert.match(runs, /revoke all on function public\.smyl_radiograph_complete_ai_run\(uuid, text, jsonb, text, jsonb\) from public, anon, authenticated/);
  assert.match(runs, /grant execute on function public\.smyl_radiograph_complete_ai_run\(uuid, text, jsonb, text, jsonb\) to service_role;/, 'sólo service_role (no authenticated)');
  assert.doesNotMatch(runs, /grant execute on function public\.smyl_radiograph_(complete|claim)_ai_run[^;]*to (authenticated|anon|public)/);
  assert.match(runs, /create or replace function public\.smyl_radiograph_claim_ai_run/);
  assert.match(runs, /if old\.status <> 'requested' then raise exception using errcode = '42501', message = 'La salida original del motor es inmutable\.'/);
  assert.match(runs, /create trigger smyl_radiograph_candidates_immutable before update or delete/);
  assert.match(runs, /perform public\.smyl_radiograph_validate_output\(v_row\.kind, p_output\)/);
  assert.match(runs, /if p_output->'model' <> v_row\.engine then/);
});

test('Etapa 1: idempotencia por hash de fuente + motor + contrato; sin reintento automático tras timeout incierto', () => {
  assert.match(runs, /sha256\(convert_to\(v_source\.sha256 \|\| '\|' \|\| v_engine\.provider \|\| '\|' \|\| v_engine\.name \|\| '\|' \|\| v_engine\.version \|\| '\|' \|\| v_engine\.contract_version::text, 'UTF8'\)\)/);
  assert.match(runs, /where status in \('requested','completed'\)/);
  assert.match(runs, /if not p_acknowledge_unconfirmed and exists/);
  assert.match(runs, /if v_qc is null or v_qc->'quality'->>'status' = 'unusable' or not \(v_qc->'applicableAnalyses' \? p_kind\)/);
});

test('Etapa 1: la decisión profesional vive aparte del candidato y conserva versiones', () => {
  assert.match(runs, /state text not null default 'pending' check \(state in \('pending','confirmed','corrected','rejected'\)\)/);
  assert.match(runs, /check \(state = 'corrected' or payload = '\{\}'::jsonb\)/);
  assert.match(runs, /insert into public\.smyl_radiograph_decision_versions/);
  assert.match(runs, /errcode = 'PT409'/);
  assert.match(runs, /create trigger smyl_radiograph_decision_versions_immutable/);
});

test('Etapa 1: validadores SQL con enumeraciones cerradas y prohibición de afirmaciones diagnósticas', () => {
  assert.match(runs, /'motion_blur','anterior_blur','anatomical_cropping','underexposure','overexposure','low_contrast','overlap','compression_artifacts','orientation_suspect','foreign_object','unknown_study_class'/);
  assert.match(runs, /'restoration','crown','implant','endodontic','apparently_missing','density','contour','support','development','other'/);
  assert.match(runs, /c->>'evidenceLevel' is distinct from 'model_candidate'/);
  assert.match(runs, /jsonb_array_length\(c->'regions'\) not between 1 and 4/, 'un candidato sin geometría se rechaza');
  assert.ok(runs.includes('(diagnos|confirmad|confirmed|confirm[ao]'), 'filtro de afirmaciones normalizado (NFKD) en SQL');
  assert.match(runs, /normalize\(coalesce\(p, ''\), NFKD\)/);
  assert.match(runs, /return abs\(area\) \/ 2 >= 0\.000001/, 'polígonos degenerados rechazados');
});

test('Etapa 1: informe firmado sólo con hallazgos confirmados/corregidos, hash y adendas', () => {
  assert.match(reports, /where d\.candidate_id is null or d\.state not in \('confirmed','corrected'\)/);
  assert.match(reports, /jsonb_array_elements\(v_old\.document->'findings'\) f\) for update/, 'las decisiones se bloquean al firmar');
  assert.match(reports, /signed_decisions = v_decisions/);
  assert.match(reports, /Sólo un profesional registrado en la clínica puede firmar/);
  assert.match(runs, /forma parte de un informe firmado; registra una adenda/);
  assert.match(flags, /revoke all on function public\.smyl_radiograph_flag_enabled\(text, uuid\) from public, anon, authenticated/);
  for (const sql of all) assert.match(sql, /revoke truncate on [\s\S]*? from service_role/);
  assert.match(reports, /signed_hash = public\.smyl_radiograph_report_hash\(v_old\.document\)/);
  assert.match(reports, /if old\.status = 'signed' then raise exception using errcode = '42501', message = 'Un informe firmado sólo admite adendas\.'/);
  assert.match(reports, /if v_report\.status <> 'signed' then raise exception using errcode = '23514', message = 'Las adendas sólo se agregan a informes firmados\.'/);
  assert.match(reports, /if v_report\.status <> 'signed' then raise exception using errcode = '23514', message = 'Sólo se exportan informes firmados\.'/);
  assert.match(reports, /'notice', 'Revisión asistida/);
});

test('Etapas 0-1: todo es idempotente, aditivo y no toca el flujo v1 ni segment-teeth', () => {
  for (const sql of all) {
    assert.match(sql, /^begin;/m); assert.match(sql, /^commit;/m);
    assert.doesNotMatch(sql, /drop table|alter table public\.smyl_radiograph_reviews|smyl_save_radiograph_review|segment-teeth|segment_teeth/);
    assert.doesNotMatch(sql, /\bhttp|net\.http|pg_net|extensions\.http/i, 'SQL nunca llama a un proveedor');
    for (const m of sql.matchAll(/create table (?!if not exists)/g)) assert.fail('create table sin if not exists: ' + m.input.slice(m.index, m.index + 60));
    for (const m of sql.matchAll(/create policy (\w+)/g)) assert.match(sql, new RegExp(`drop policy if exists ${m[1]} on`));
    for (const m of sql.matchAll(/create trigger (\w+)/g)) assert.match(sql, new RegExp(`drop trigger if exists ${m[1]} on`));
  }
  assert.match(v1, /create table public\.smyl_radiograph_reviews/, 'la migración v1 aplicada no se edita');
  assert.equal(fs.existsSync(new URL('../supabase/functions/radiograph-qc/index.ts', import.meta.url)), true, 'la Edge Function de QC (Etapa 2) existe aparte de segment-teeth');
});

test('los contratos v2 se publican en web, PWA y copia móvil (Etapa 4)', () => {
  const sw = read('sw.js');
  assert.match(sw, /smyl-radiograph-contracts\.js\?v=2/);
  assert.equal(read('mobile/www/smyl-radiograph-contracts.js'), read('smyl-radiograph-contracts.js'));
});
