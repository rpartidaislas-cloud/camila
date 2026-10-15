import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const bridge = read('../supabase/functions/lana-inbox/index.ts');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const preview = read('./fixtures/smyl-inbox-stage7-preview.html');

test('el puente limita la aprobación del piloto al dueño y exige idempotencia', () => {
  assert.match(bridge, /action === "pilot"/);
  assert.match(bridge, /actor\.role !== "owner"/);
  assert.match(bridge, /\/inbox\/pilot/);
  assert.match(bridge, /Idempotency-Key/);
});

test('el panel cubre las cinco pruebas operativas sin afirmar evidencia automática', () => {
  for (const label of ['Tráfico real de entrada y salida', 'Dos usuarios simultáneos', 'Mensajes fuera de orden', 'Pérdida de red y reconexión', 'Uso en dispositivo móvil']) {
    assert.match(preview, new RegExp(label));
  }
  assert.match(inbox, /no envían mensajes ni simulan evidencia/i);
  assert.match(inbox, /Confirmar prueba/);
  assert.match(inbox, /Cerrar piloto aprobado/);
});

test('la interfaz distingue preparación, activo, pausa y cierre con vista móvil', () => {
  assert.match(inbox, /Piloto activo/);
  assert.match(inbox, /Piloto pausado/);
  assert.match(inbox, /Piloto completado/);
  assert.match(inbox, /Iniciar piloto controlado/);
  assert.match(inbox, /Reanudar piloto/);
  assert.match(css, /smyl-inbox-pilot-status/);
  assert.match(css, /smyl-inbox-pilot-evidence/);
  assert.match(css, /smyl-inbox-pilot-test\{grid-template-columns:1fr\}/);
});
