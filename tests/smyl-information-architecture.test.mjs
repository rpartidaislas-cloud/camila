import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nav = readFileSync(new URL('../smyl-navigation.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../smyl-navigation.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('la navegación principal prioriza el trabajo diario del dentista', () => {
  assert.match(nav, /\['Inicio', 'dashboard'/);
  assert.match(nav, /\['Pacientes', 'pacientes'/);
  assert.match(nav, /\['Agenda', 'agenda'/);
  assert.match(nav, /\['Mensajes', 'inbox'/);
  assert.match(nav, /detailsGroup\('Negocio', BUSINESS/);
  assert.match(nav, /detailsGroup\('Configuración', SETTINGS/);
});

test('las herramientas de baja frecuencia ya no compiten en el primer nivel', () => {
  assert.match(nav, /\['Canales y asistente', 'conexiones'/);
  assert.match(nav, /\['Preparación operativa', 'lanzamiento'/);
  assert.match(nav, /\['Servicios y tarifas', 'precios'/);
  assert.match(nav, /\['Tratamientos', 'propuestas'/);
  assert.match(nav, /var SETTINGS = \[/);
});

test('Canales e IA se divide en canales, asistente y laboratorio', () => {
  assert.match(nav, /\['channels','Canales'\]/);
  assert.match(nav, /\['assistant','SMYL Asistente'\]/);
  assert.match(nav, /\['lab','Laboratorio'\]/);
  assert.match(nav, /preview\.dataset\.connectionPane|labPane\.dataset\.connectionPane = 'lab'/);
  assert.match(css, /\.connections-tabs/);
});

test('web y PWA cargan la arquitectura centralizada', () => {
  assert.match(app, /smyl-navigation\.js\?v=5/);
  assert.match(app, /smyl-navigation\.css\?v=1/);
  assert.match(sw, /smyl-v248-assistant-booking-request/);
  assert.match(sw, /smyl-navigation\.js\?v=5/);
});
