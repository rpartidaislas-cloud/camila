import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../smyl-inbox.css', import.meta.url), 'utf8');

test('Clinical Workspace v3.3 fija legibilidad y objetivos de interacción del Inbox', () => {
  assert.match(css, /Clinical Workspace v3\.3 · Inbox/);
  assert.match(css, /--smyl-inbox-control-target:\s*42px/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*--smyl-inbox-control-target:\s*44px/);
  assert.match(css, /#p-inbox\s+:is\([\s\S]*min-height:\s*var\(--smyl-inbox-control-target\)/);
  assert.match(css, /\.smyl-inbox-notify::after\s*\{[\s\S]*font-size:\s*12px/);
});

test('los filtros estrechos conservan etiquetas y contadores sin empalmes', () => {
  assert.match(css, /\.smyl-inbox-filters\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.smyl-inbox-filters button span\s*\{[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.smyl-inbox-filters button b\s*\{[\s\S]*font-size:\s*12px/);
});

test('estados vacíos, selección semántica y foco visible tienen jerarquía explícita', () => {
  assert.match(css, /\.smyl-inbox-thread-empty p\s*\{[\s\S]*font-size:\s*14px/);
  assert.match(css, /\.smyl-inbox-filters button\[aria-selected="true"\]/);
  assert.match(css, /:focus-visible\s*\{[\s\S]*outline-width:\s*3px/);
});
