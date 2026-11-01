import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../smyl-clinic-admin.js');
const styles = read('../smyl-clinic-admin.css');

test('Clinical Workspace v3.3 resume equipo, pendientes y roles sin tocar permisos', () => {
  assert.match(script, /function updateSectionCount/);
  assert.match(script, /clinic-admin-member-count/);
  assert.match(script, /clinic-admin-pending-count/);
  assert.match(script, /clinic-admin-role-count-summary/);
  assert.match(script, /members\.setAttribute\('role', 'list'\)/);
  assert.match(script, /toggle\.setAttribute\('aria-label'/);
  assert.match(script, /rpc\('smyl_set_member_role'/);
  assert.match(script, /rpc\('smyl_set_member_primary_branch'/);
});

test('el panel se encierra en su ancho real y sólo abre dos columnas con espacio seguro', () => {
  assert.match(styles, /\.clinic-admin-team-panel\{[^}]*max-width:100%[^}]*overflow:clip/);
  assert.match(styles, /\.clinic-admin-team-grid\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /@container clinic-team \(min-width:1120px\)/);
  assert.match(styles, /\.clinic-admin-team-grid\{grid-template-columns:minmax\(0,1fr\) minmax\(300px,330px\)\}/);
  assert.match(styles, /@container clinic-team \(max-width:620px\)/);
});

test('tipografía, estados y objetivos táctiles conservan una escala clínica legible', () => {
  assert.match(styles, /\.clinic-admin-team-hero \.pro-eyebrow\{font-size:12px\}/);
  assert.match(styles, /\.clinic-admin-section-count\{[^}]*font-size:12px/);
  assert.match(styles, /\.clinic-admin-member select\{[^}]*min-height:44px[^}]*font-size:13px/);
  assert.match(styles, /\.clinic-admin-member \.btn\{[^}]*min-height:44px[^}]*font-size:13px/);
  assert.match(styles, /\.clinic-admin-permission-pill span\{[^}]*min-height:42px[^}]*font-size:13px/);
  assert.match(styles, /\.clinic-admin-member select:disabled\{/);
  assert.match(styles, /summary:focus-visible/);
  assert.match(styles, /\.clinic-admin-dialog \.pro-eyebrow\{font-size:12px\}/);
  assert.match(styles, /@media\(max-width:760px\)\{[\s\S]*?\.clinic-admin-tab,[^{]*\{min-height:44px\}/);
});

test('roles y funciones se leen como una lista plana, no como tarjetas anidadas', () => {
  assert.match(styles, /\.clinic-admin-role\{border:0;border-top:1px solid var\(--ca-border\);border-radius:0;margin:0/);
  assert.match(styles, /\.clinic-admin-role:first-child\{border-top:0\}/);
  assert.match(styles, /\.clinic-admin-role summary::after/);
  assert.match(styles, /\.clinic-admin-role>\.clinic-admin-role-body\{[^}]*background:transparent/);
});
