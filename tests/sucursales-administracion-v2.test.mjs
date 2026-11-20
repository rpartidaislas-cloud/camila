import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const js = read('../smyl-clinic-admin.js');
const css = read('../smyl-clinic-admin.css');

test('sucursales permite buscar, consultar archivadas y reactivarlas', () => {
  assert.match(js, /branchFilter: 'active'/);
  assert.match(js, /data-ca-branch-filter="archived"/);
  assert.match(js, /id="clinic-admin-branch-search"/);
  assert.match(js, /function archivedBranchSection\(branch\)/);
  assert.match(js, /function restoreBranch\(branch\)/);
  assert.match(js, /Sucursal reactivada/);
});

test('archivar conserva historial y se bloquea si hay citas futuras', () => {
  assert.match(js, /function archiveBranch\(branch\)/);
  assert.match(js, /upcomingAppointments\(branch\.id\)/);
  assert.match(js, /Reasígnalas o cancélalas antes de archivarla/);
  assert.match(js, /update\(\{ active: false \}\)/);
  assert.doesNotMatch(js, /from\('smyl_branches'\)\.delete\(/);
});

test('el equipo de una sucursal se administra sin abandonar la pantalla', () => {
  assert.match(js, /function openBranchTeamDialog\(branch\)/);
  assert.match(js, /Vincular profesionales/);
  assert.match(js, /name="professional"/);
  assert.match(js, /smyl_professional_branches/);
  assert.match(js, /tiene citas futuras en esta sucursal/);
  assert.match(css, /\.clinic-admin-assignment-list/);
  assert.match(css, /\.clinic-admin-branch-person/);
});

test('los profesionales se desactivan y reactivan sin borrar su historial', () => {
  assert.match(js, /function toggleProfessional\(professional, active\)/);
  assert.match(js, /Desactivar como profesional/);
  assert.match(js, /Reactivar profesional/);
  assert.match(js, /update\(\{ active: active \}\)/);
  assert.doesNotMatch(js, /from\('smyl_professionals'\)\.delete\(/);
});

test('la administración responde en escritorio y móvil', () => {
  assert.match(css, /@media\(max-width:760px\)[\s\S]*?\.clinic-admin-branch-list\{display:flex/);
  assert.match(css, /@media\(max-width:520px\)[\s\S]*?\.clinic-admin-assignment/);
  assert.match(css, /min-height:44px/);
});
