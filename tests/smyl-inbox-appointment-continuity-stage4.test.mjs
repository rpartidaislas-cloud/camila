import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), 'utf8');
const edge = read('../supabase/functions/lana-inbox/index.ts');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const mobileCss = read('../mobile/www/smyl-inbox.css');
const preview = read('./fixtures/smyl-inbox-stage7-preview.html');

test('the bridge assembles appointment continuity from SMYL-owned records', () => {
  assert.match(edge, /async function appointmentContext/);
  for (const source of ['camila_lana_handoffs', 'smyl_appointment_requests', 'smyl_services', 'smyl_branches', 'smyl_professionals', 'smyl_appointments']) assert.match(edge, new RegExp(source));
  assert.match(edge, /requirePermission\(actor, "schedule\.read"/);
  assert.doesNotMatch(edge.slice(edge.indexOf('async function appointmentContext'), edge.indexOf('async function createAppointmentRequest')), /lanaRequest/);
});

test('the Inbox explains pending, confirmed and cancelled states', () => {
  assert.match(inbox, /Cita del paciente/);
  assert.match(inbox, /Elección pendiente de confirmación/);
  assert.match(inbox, /Cita confirmada/);
  assert.match(inbox, /Cita cancelada/);
  assert.match(css, /smyl-inbox-appointment-status\.is-cancelled/);
});

test('appointment communication remains a reviewed draft', () => {
  assert.match(inbox, /Preparar confirmación/);
  assert.match(inbox, /Preparar seguimiento/);
  assert.match(inbox, /setComposerText/);
  const continuity = inbox.slice(inbox.indexOf("var appointmentCard"), inbox.indexOf("var availability ="));
  assert.doesNotMatch(continuity, /sendMessage|action:\s*'message'/);
});

test('continuity refreshes after choice and confirmation and stays in mobile parity', () => {
  assert.ok((inbox.match(/loadAppointmentContext\(state\.selectedId\)/g) || []).length >= 2);
  assert.match(inbox, /loadAppointmentContext\(id\)/);
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
  assert.match(preview, /action === 'appointment_context'/);
});
