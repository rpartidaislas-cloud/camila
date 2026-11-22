import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interpretarCalidad, MENSAJES_PACIENTE, AVISO_SIMULACION, MOTIVOS_NO_APTA } from '../supabase/functions/analizar-foto/foto-core.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const src = read('supabase/functions/analizar-foto/index.ts');
const bundle = read('docs/bundles/analizar-foto.single-file.ts');

test('analizar-foto no pide ni devuelve diagnóstico, tratamientos ni urgencia', () => {
  for (const code of [src, bundle]) {
    assert.doesNotMatch(code, /"diagnostico"|tratamientos_sugeridos|requiere_urgente|zona_afectada/);
    assert.match(code, /requiere_revision_profesional: true/);
  }
  assert.match(src, /NO evalúes la salud dental/);
});

test('sin paciente vinculado o sin autorización expresa de IA no descarga ni manda nada a la IA', () => {
  const permiso = src.indexOf('permisoIA(admin, tenant_id, patient_id)');
  const descarga = src.indexOf('await fetch(imagen_url');
  const openai = src.indexOf('api.openai.com');
  assert.ok(permiso > 0 && permiso < descarga && descarga < openai, 'el permiso se revisa antes de descargar y de llamar a OpenAI');
  assert.match(src, /patient_id \? await permisoIA\(admin, tenant_id, patient_id\) : "missing"/);
  assert.match(src, /if \(permiso !== "allowed"\)[\s\S]*?ia_usada: false[\s\S]*?return;/);
});

test('OpenAI no guarda la consulta y la simulación nunca usa URL pública', () => {
  assert.match(src, /store: false/);
  assert.doesNotMatch(src, /object\/public/);
});

test('solo se envían al paciente mensajes fijos; la IA elige de una lista cerrada', () => {
  assert.deepEqual(interpretarCalidad('{"apta":true,"motivo":"ninguno"}'), { apta: true, motivo: 'ninguno' });
  assert.deepEqual(interpretarCalidad('{"apta":false,"motivo":"borrosa"}'), { apta: false, motivo: 'borrosa' });
  assert.deepEqual(interpretarCalidad('{"apta":false,"motivo":"Tienes caries en el 11"}'), { apta: false, motivo: 'otra' });
  assert.deepEqual(interpretarCalidad('texto libre'), { apta: false, motivo: 'otra' });
  for (const m of MOTIVOS_NO_APTA) assert.ok(MENSAJES_PACIENTE[m], m);
  for (const t of Object.values(MENSAJES_PACIENTE).concat(AVISO_SIMULACION)) assert.doesNotMatch(t, /\bcaries\b|periodont|diagnosticamos|tienes una?\b/i);
  assert.match(AVISO_SIMULACION, /no es un diagnóstico/);
  assert.match(MENSAJES_PACIENTE.simulacion, /No es un diagnóstico ni garantiza resultados/);
});
