import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nav = readFileSync(new URL('../smyl-navigation.js', import.meta.url), 'utf8');
const command = readFileSync(new URL('../smyl-command-menu.js', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../smyl-service-catalog.js', import.meta.url), 'utf8');
const schedule = readFileSync(new URL('../smyl-schedule.js', import.meta.url), 'utf8');
const clinic = readFileSync(new URL('../smyl-clinic.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261013040000_smyl_professional_permissions_v1.sql', import.meta.url), 'utf8');

test('Servicios y tarifas es una función visible del negocio', () => {
  assert.match(nav, /var BUSINESS = \[/);
  assert.match(nav, /\['Servicios y tarifas', 'precios'/);
  assert.doesNotMatch(nav, /Precios de la clínica/);
  assert.match(command, /label:'Negocio'/);
  assert.match(command, /Servicios y tarifas/);
  assert.match(catalog, /GESTIÓN DEL NEGOCIO/);
  assert.match(catalog, /fuente única para Agenda, planes y cotizaciones/);
});

test('Agenda consulta el catálogo y ya no desactiva servicios', () => {
  assert.match(schedule, /Abrir Servicios y tarifas/);
  assert.match(schedule, /administran en un solo catálogo/);
  assert.doesNotMatch(schedule, /data-service-off/);
  assert.match(schedule, /if\(!h\)return/);
});

test('el frontend clínico respeta permisos profesionales', () => {
  assert.match(clinic, /clinicalCapabilities/);
  assert.match(clinic, /permissions\.has\('clinical\.write'\)/);
  assert.match(clinic, /permissions\.has\('clinical\.approve'\)/);
  assert.match(clinic, /!current\.canWrite/);
  assert.doesNotMatch(clinic, /miRolEquipo !== 'dueño'[\s\S]{0,180}La edición clínica/);
});

test('Supabase aplica lectura, escritura y aprobación por permiso', () => {
  assert.match(migration, /clinical_read_by_permission/);
  assert.match(migration, /smyl_has_permission\(tenant_id, 'clinical\.read'\)/);
  assert.match(migration, /smyl_has_permission\(p_tenant_id, 'clinical\.write'\)/);
  assert.match(migration, /p_review and not public\.smyl_has_permission\(p_tenant_id, 'clinical\.approve'\)/);
  assert.match(migration, /smyl_services_manage[\s\S]*settings\.manage/);
  assert.doesNotMatch(migration, /drop table|drop column/i);
});
