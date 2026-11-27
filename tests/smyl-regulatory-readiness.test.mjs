import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const regulatory=read('../supabase/migrations/20261125110000_smyl_regulatory_readiness.sql');
const retention=read('../supabase/migrations/20261125111000_smyl_clinical_retention_guard.sql');
const ui=read('../smyl-compliance.js');
const model=read('../smyl-compliance-model.js');
const css=read('../smyl-compliance.css');
const docs=read('../docs/SMYL_COFEPRIS_READINESS.md');

test('el expediente regulatorio separa tenant, plataforma y datos clínicos',()=>{
  assert.match(regulatory,/certifies_compliance',false/);
  assert.match(regulatory,/'contains_phi',false/);
  assert.match(regulatory,/settings\.manage/g);
  assert.match(regulatory,/security definer\s+set search_path=pg_catalog,public/g);
  assert.match(regulatory,/revoke all on function public\.smyl_regulatory_readiness_report\(\) from public,anon/);
  assert.doesNotMatch(regulatory,/camila_pacientes|diagnos|patient_id|nombre|tel[eé]fono/i);
});

test('sólo requisitos condicionales aceptan no aplica y siempre exigen justificación',()=>{
  assert.match(regulatory,/v_allows_na:=p_requirement_id in \('sanitary_responsible','xray_license','radiation_protection','rpbi_contract','advertising_notice'\)/);
  assert.match(regulatory,/p_status='not_applicable'[\s\S]*char_length\(btrim\(coalesce\(p_notes,''\)\)\)<8/);
  assert.match(regulatory,/p_status='verified'[\s\S]*Captura el folio, referencia o ubicación/);
  assert.match(regulatory,/e\.expires_on < current_date then 'expired'/);
});

test('la conservación bloquea el borrado físico y avanza con nueva actividad clínica',()=>{
  assert.match(retention,/interval '5 years'/);
  assert.match(retention,/before delete on public\.camila_pacientes/);
  assert.match(retention,/raise exception using errcode='23514'/);
  assert.match(retention,/Archiva o seudonimiza al paciente; no borres su historial/);
  assert.match(retention,/after insert or update/);
  assert.match(retention,/greatest\(public\.smyl_clinical_retention_guards\.retain_until,excluded\.retain_until\)/);
  assert.doesNotMatch(retention,/delete from public\.smyl_/i);
});

test('la interfaz no confunde preparación con certificación',()=>{
  assert.match(ui,/Control sanitario/);
  assert.match(ui,/Guía COFEPRIS/);
  assert.match(ui,/no sustituye los documentos originales ni una asesoría sanitaria/i);
  assert.match(model,/Conviene validar la lista con un asesor sanitario antes de prometer cumplimiento/);
  assert.match(model,/Por confirmar con tu asesor/);
  assert.match(css,/cp-print-root/);
  assert.match(docs,/No es una certificación, autorización ni resolución de COFEPRIS/);
});

test('la asistencia de MILA conserva la decisión humana y no mezcla datos de pacientes',()=>{
  const edge=read('../supabase/functions/compliance-assistant/index.ts');
  assert.match(ui,/Preparar con MILA/);
  assert.match(ui,/Tú decides qué guardar/);
  assert.match(edge,/No incluyas datos de pacientes/);
  assert.match(edge,/status === 'have' && !reference/);
  assert.match(edge,/status === 'not_applicable' && notes\.length < 8/);
  assert.doesNotMatch(edge,/camila_pacientes|patient_id|diagnos/i);
});
