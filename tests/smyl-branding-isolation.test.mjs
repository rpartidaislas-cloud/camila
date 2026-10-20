import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dentro de SMYL no debe aparecer el nombre del motor de mensajería (LANA) ni
// el de ningún otro tenant en texto visible para el usuario. Los identificadores
// técnicos (lana-inbox, SmylLana, formatForLana, lana-entry) sí se permiten:
// aquí sólo se inspeccionan literales de cadena con texto de interfaz y nodos
// de texto HTML.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = /\bLANA\b|\bLana\b|Bordados Express/;
const UI_HTML = ['app.html', 'index.html', 'revision-clinica.html', 'simulacion.html'];

function uiScripts(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /^smyl-.*\.js$/.test(name))
    .map((name) => path.join(dir, name));
}

// Literal de una sola línea: '…', "…" o `…`. Un literal con espacios es copy;
// uno sin espacios es casi siempre un identificador, ruta o clase.
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\\n]|\\.)*)`/g;

function offendingLiterals(source) {
  const hits = [];
  for (const match of source.matchAll(LITERAL)) {
    const text = match[1] ?? match[2] ?? match[3] ?? '';
    if (!FORBIDDEN.test(text)) continue;
    if (!/\s/.test(text) && text !== 'LANA') continue;
    hits.push(text.trim().slice(0, 120));
  }
  return hits;
}

function offendingHtmlText(source) {
  const hits = [];
  const withoutScripts = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  for (const match of withoutScripts.matchAll(/>([^<>]*)</g)) {
    const text = match[1];
    if (FORBIDDEN.test(text)) hits.push(text.trim().slice(0, 120));
  }
  return hits;
}

function report(file, hits) {
  return hits.length ? `${path.relative(root, file)}:\n  - ${hits.join('\n  - ')}` : '';
}

test('los módulos smyl-*.js no muestran el nombre del motor ni de otros tenants', () => {
  const problems = [];
  for (const dir of [root, path.join(root, 'mobile', 'www')]) {
    for (const file of uiScripts(dir)) {
      const text = report(file, offendingLiterals(fs.readFileSync(file, 'utf8')));
      if (text) problems.push(text);
    }
  }
  assert.equal(problems.length, 0, `Texto de interfaz con branding ajeno:\n${problems.join('\n')}`);
});

test('las páginas HTML de SMYL no muestran el nombre del motor ni de otros tenants', () => {
  const problems = [];
  for (const dir of [root, path.join(root, 'mobile', 'www')]) {
    for (const name of UI_HTML) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      const hits = [...offendingHtmlText(source), ...offendingLiterals(source)];
      const text = report(file, hits);
      if (text) problems.push(text);
    }
  }
  assert.equal(problems.length, 0, `Texto de interfaz con branding ajeno:\n${problems.join('\n')}`);
});
