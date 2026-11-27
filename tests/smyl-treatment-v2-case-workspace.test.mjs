import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('la ruta usa la decisión económica real y no la presentación mySmyl', async () => {
  const js = await readFile(new URL('smyl-case-workspace.js', root), 'utf8');
  assert.match(js, /proposalApi\?\.summary\?\.\(ctx\.patient,treatmentId\)/);
  assert.match(js, /proposalApi\.primeSummary\(ctx\.patient,treatmentId\)/);
  assert.match(js, /smyl:treatment-changed/);
  assert.match(js, /approval:canActivate/);
  assert.match(js, /followup',canActivate\?'Disponible':'Pendiente'/);
  assert.match(js, /presentationReady&&!proposal/);
  assert.doesNotMatch(js, /approval:!!created/);
});
test('el expediente presenta importes por decisión sin duplicar el editor', async () => {
  const [js, css] = await Promise.all([
    readFile(new URL('smyl-case-workspace.js', root), 'utf8'),
    readFile(new URL('smyl-case-workspace.css', root), 'utf8')
  ]);
  assert.match(js, /DECISIÓN DEL PACIENTE/);
  assert.match(js, /acceptedCents/);
  assert.match(js, /pendingCents/);
  assert.match(js, /rejectedCents/);
  assert.match(css, /\.cw-approval-summary/);
  assert.match(css, /@media\(max-width:600px\).*\.cw-approval-facts\{grid-template-columns:1fr\}/s);
});

test('el plan expone procedimientos seguros y guarda contra el capítulo activo', async () => {
  const clinic = await readFile(new URL('smyl-clinic.js', root), 'utf8');
  assert.match(clinic, /smyl_save_clinical_plan_v3/);
  assert.match(clinic, /p_treatment_id: treatmentId/);
  assert.match(clinic, /treatmentId:/);
  assert.match(clinic, /items: Object\.freeze\(planItems\)/);
  assert.match(clinic, /smyl_save_clinical_plan_v2/); // compatibilidad durante el despliegue expandido
});
