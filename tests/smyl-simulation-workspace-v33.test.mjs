import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('las dos simulaciones comparten la capa Clinical Workspace v3.3', () => {
  for (const name of ['simulacion.html', 'simulacion-rapida.html']) {
    const html = read(name);
    assert.match(html, /<body class="sim-workspace-v33">/);
    assert.match(html, /href="smyl-simulation-workspace-v33\.css\?v=1"/);
  }
});

test('la capa visual declara contratos de legibilidad, control, foco y responsive', () => {
  const css = read('smyl-simulation-workspace-v33.css');
  assert.match(css, /Clinical Workspace v3\.3/);
  assert.match(css, /--sim-v33-control:\s*42px/);
  assert.match(css, /font-size:\s*12px\s*!important/);
  assert.match(css, /\[style\*="font-size\\: 9px"\]/);
  assert.match(css, /outline:\s*3px solid var\(--sim-v33-focus\)\s*!important/);
  assert.match(css, /@media \(max-width: 1024px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /--sim-v33-control:\s*44px/);
  assert.match(css, /prefers-reduced-motion/);
});

test('Studio adopta el mismo contrato sin contaminar la lógica clínica', () => {
  const studio = read('smyl-studio.css');
  const shared = read('smyl-simulation-workspace-v33.css');
  assert.match(studio, /Clinical Workspace v3\.3 · Studio presentation contract/);
  assert.match(studio, /--studio-v33-control:42px/);
  assert.match(studio, /--studio-v33-control:44px/);
  for (const forbidden of ['supabase', 'fetch(', 'openai', 'promptDental', 'generateImage', 'invoke(']) {
    assert.equal(shared.toLowerCase().includes(forbidden.toLowerCase()), false, `La capa CSS no debe incluir ${forbidden}`);
  }
});

test('el fixture cubre tarea, decisión, resultado, editor y estados', () => {
  const fixture = read('tests/fixtures/smyl-simulation-workspace-v33-preview.html');
  for (const token of ['fixture-studio', 'quick-config', 'fixture-clinical', 'res-header', 'ed-screen', 'qa-state-grid']) {
    assert.match(fixture, new RegExp(token));
  }
});
