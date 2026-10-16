import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const policy = readFileSync(new URL('../docs/POLITICA_IMAGEN_SMYL.md', import.meta.url), 'utf8');

test('la política visual v2 separa los tres contextos de SMYL', () => {
  assert.match(policy, /\*\*Versión:\*\* 2\.0/);
  assert.match(policy, /SMYL Operativo/);
  assert.match(policy, /SMYL Studio/);
  assert.match(policy, /SMYL Paciente/);
  assert.match(policy, /El azul es la única acción primaria de SMYL Operativo/);
  assert.match(policy, /El violeta identifica IA y Studio/);
});

test('la política fija una escala tipográfica y geometría medibles', () => {
  assert.match(policy, /Título de ventana \| 18 \/ 24 px \| 600/);
  assert.match(policy, /Campo, botón y selector \| 8 px/);
  assert.match(policy, /Ventana \| 12 px/);
  assert.match(policy, /Nunca usar texto funcional por debajo de 10 px/);
  assert.match(policy, /No usar pesos inventados como 620, 650, 680 o 750/);
});

test('las ventanas se dimensionan por tarea y no por espacio disponible', () => {
  assert.match(policy, /\| `XS` \| 400 px/);
  assert.match(policy, /\| `S` \| 520 px/);
  assert.match(policy, /\| `M` \| 680 px/);
  assert.match(policy, /\| `L` \| 840 px/);
  assert.match(policy, /\| `Workspace` \| 960 px/);
  assert.match(policy, /Una ventana vacía nunca reserva la altura de resultados/);
  assert.match(policy, /Sólo una acción primaria por contexto/);
});

test('Agenda es la referencia de migración y distingue paciente de tenant', () => {
  assert.match(policy, /La Agenda dentro del chat será el primer Workspace aprobado/);
  assert.match(policy, /El paciente nunca se sustituye por tenant, clínica o sucursal/);
  assert.match(policy, /Agenda sin horarios o configuración: M/);
  assert.match(policy, /Agenda semanal real: Workspace/);
  assert.match(policy, /Hasta aprobar la Agenda no se propagan ajustes locales/);
});

test('la aceptación incluye accesibilidad, responsive y privacidad', () => {
  assert.match(policy, /Estándar mínimo: WCAG 2\.2 AA/);
  assert.match(policy, /contraste mínimo 4\.5:1/i);
  assert.match(policy, /refluyen a 320 px/);
  assert.match(policy, /Zoom de navegador a 200%/);
  assert.match(policy, /La interfaz no promete una operación no confirmada por el servidor/);
});
