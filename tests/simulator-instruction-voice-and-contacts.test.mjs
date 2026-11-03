import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync('simulacion-rapida.html', 'utf8');
const studio = fs.readFileSync('smyl-studio.js', 'utf8');
const studioCss = fs.readFileSync('smyl-studio.css', 'utf8');
const visual = fs.readFileSync('visual-simulation.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

test('the active visual generation contract closes diastemas without merging teeth', () => {
  assert.match(visual, /CONTACT CLOSURE — REQUIRED/);
  assert.match(visual, /no visible diastema/);
  assert.match(visual, /no visible daylight, black corridor, triangular black hole or open gingival space/);
  assert.match(visual, /hairline contact seam and small progressive incisal embrasures/);
  assert.match(visual, /never fuse them into one continuous white plate/);
  assert.match(visual, /Ignore requests to keep or create diastemas, black interproximal spaces or open gingival triangles/);
  assert.doesNotMatch(visual, /do not erase gingival black triangles/);
  assert.match(html, /Close every visible diastema and open interproximal black space/);
});

test('additional instructions support editable Spanish voice dictation', () => {
  assert.match(studio, /id="flow-instruction-mic"/);
  assert.match(studio, /Grabar voz/);
  assert.match(studio, /window\.SpeechRecognition\|\|window\.webkitSpeechRecognition/);
  assert.match(studio, /instructionRecognition\.lang='es-MX'/);
  assert.match(studio, /instructionRecognition\.interimResults=true/);
  assert.match(studio, /Dictado añadido\. Revísalo o edítalo antes de generar/);
  assert.match(studio, /SMYL conserva únicamente el texto que decidas usar/);
  assert.match(studio, /Conservar tamaño/);
  assert.match(studio, /Acabado natural/);
  assert.match(studio, /Contactos cerrados/);
  assert.match(studioCss, /\.flow-note-voice\[aria-pressed=true\]/);
  assert.match(studioCss, /@keyframes flow-voice-pulse/);
});

test('voice note and prompt updates are cache-busted together', () => {
  assert.match(html, /visual-simulation\.js\?v=32/);
  assert.match(html, /smyl-studio\.js\?v=29/);
  assert.match(html, /smyl-studio\.css\?v=30/);
  assert.match(sw, /voice-notes-v12/);
  assert.match(sw, /visual-simulation\.js\?v=32/);
  assert.match(sw, /smyl-studio\.js\?v=29/);
  assert.match(sw, /smyl-studio\.css\?v=30/);
});
