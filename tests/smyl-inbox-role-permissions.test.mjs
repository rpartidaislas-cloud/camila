import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), 'utf8');
const bridge = read('../supabase/functions/lana-inbox/index.ts');
const inbox = read('../smyl-inbox.js');
const admin = read('../smyl-clinic-admin.js');

test('the SMYL bridge resolves dental roles and server-side permissions', () => {
  assert.match(bridge, /smyl_member_roles/);
  assert.match(bridge, /smyl_role_permissions/);
  assert.match(bridge, /role_code: roleCode/);
  assert.match(bridge, /permissions,/);
  assert.match(bridge, /requirePermission\(actor, "messages\.read"/);
  assert.match(bridge, /requirePermission\(actor, "messages\.respond"/);
  assert.match(bridge, /requirePermission\(actor, "messages\.manage"/);
});

test('clinical context and clinical linking require their own permissions', () => {
  assert.match(bridge, /requirePermission\(actor, "clinical\.read"/);
  assert.match(bridge, /requirePermission\(actor, "clinical\.write"/);
  assert.match(bridge, /can\(actor, "clinical\.read"\)/);
  assert.match(bridge, /clinical_access: false/);
});

test('the Inbox reflects permissions instead of only owner and staff', () => {
  assert.match(inbox, /function hasPermission\(permission\)/);
  assert.match(inbox, /canOperate\(conversation, 'messages\.respond'\)/);
  assert.match(inbox, /canOperate\(conversation, 'messages\.manage'\)/);
  assert.match(inbox, /hasPermission\('clinical\.read'\)/);
  assert.match(inbox, /state\.actor\.role_name/);
});

test('the clinic role guide names the actual permission keys', () => {
  for (const permission of ['schedule.manage', 'patients.manage', 'messages.respond', 'messages.manage', 'finance.manage']) {
    assert.match(admin, new RegExp(`'${permission.replace('.', '\\.')}'`));
  }
});
