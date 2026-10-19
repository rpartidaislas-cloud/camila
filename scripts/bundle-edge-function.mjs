#!/usr/bin/env node
// Junta una Edge Function y sus archivos de ../_shared en UN solo archivo para
// pegarlo en el editor del panel de Supabase (que no puede importar ../_shared).
// Con la CLI (`supabase functions deploy`) no hace falta.
//
//   node scripts/bundle-edge-function.mjs appointment-reminders
//
// Escribe docs/bundles/<función>.single-file.ts. Cada archivo compartido se
// encierra en su propio bloque, porque varios definen las mismas constantes
// (SB_URL, admin…) y chocarían al juntarlos.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Uso: node scripts/bundle-edge-function.mjs <nombre-de-la-función>');
  process.exit(1);
}

const functionsDir = path.join(root, 'supabase', 'functions');
const read = (...parts) => fs.readFileSync(path.join(functionsDir, ...parts), 'utf8');
const SHARED_IMPORT = /^import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+["'](?:\.\.\/_shared\/|\.\/)([\w.-]+)["'];?\s*$/;
// Los imports externos se deduplican aunque cambie el tipo de comillas.
const normalizeImport = (line) => line.trim().replace(/'/g, '"').replace(/;$/, '') + ';';

function stripExports(source) {
  return source
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function|const|let|interface|type|class)/gm, '');
}

function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s+\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const [from, to] = part.trim().split(/\s+as\s+/);
      if (from) names.add(to || from);
    }
  }
  return [...names];
}

const modules = new Map();
function loadShared(file) {
  if (modules.has(file)) return;
  const source = read('_shared', file);
  const imports = [];
  const body = [];
  for (const line of source.split('\n')) {
    const match = line.match(SHARED_IMPORT);
    if (match) { loadShared(match[3]); imports.push(line); } else body.push(line);
  }
  const text = body.join('\n');
  const externalImports = text.split('\n').filter((line) => /^import\s/.test(line));
  let code = stripExports(text.split('\n').filter((line) => !/^import\s/.test(line)).join('\n'));
  // Los .mjs no declaran tipos; el bundle es TypeScript estricto, así que se anotan los parámetros sueltos.
  if (file.endsWith('.mjs')) code = code.replace(/function\s+(\w+)\((\w+)\)/g, 'function $1($2: unknown)');
  const exports = exportedNames(text);
  // "admin as smylAdmin" se exporta con otro nombre: se asigna aparte.
  const aliased = [...text.matchAll(/^export\s+\{([^}]*)\}/gm)].flatMap((m) => m[1].split(',')).map((p) => p.trim().split(/\s+as\s+/)).filter((p) => p[1]);
  const returns = exports.map((exported) => {
    const alias = aliased.find((p) => p[1] === exported);
    return alias ? `${exported}: ${alias[0]}` : exported;
  });
  modules.set(file, { code, exports, returns, externalImports, imports });
}

const main = read(name, 'index.ts');
const mainLines = main.split('\n');
const used = [];
const mainBody = [];
const externalImports = new Set();
for (const line of mainLines) {
  const match = line.match(SHARED_IMPORT);
  if (match) { loadShared(match[3]); used.push({ names: (match[1] || match[2]).split(',').map((n) => n.trim()).filter(Boolean), file: match[3] }); }
  else if (/^import\s/.test(line)) externalImports.add(normalizeImport(line));
  else mainBody.push(line);
}

const parts = [];
const bundled = new Set();
function emit(file) {
  if (bundled.has(file)) return;
  const mod = modules.get(file);
  for (const dependency of mod.imports) emit(dependency.match(SHARED_IMPORT)[3]);
  bundled.add(file);
  mod.externalImports.forEach((line) => externalImports.add(normalizeImport(line)));
  const wanted = mod.imports.flatMap((line) => (line.match(SHARED_IMPORT)[1] || '').split(',').map((n) => n.trim()).filter(Boolean));
  const header = `// ── _shared/${file} ──`;
  if (mod.returns.length) {
    parts.push(`${header}\nconst { ${mod.exports.join(', ')} } = (() => {\n${mod.code}\nreturn { ${mod.returns.join(', ')} };\n})();`);
  } else parts.push(`${header}\n{\n${mod.code}\n}`);
  void wanted;
}
used.forEach(({ file }) => emit(file));

const banner = `// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/${name}/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
`;
const output = `${banner}${[...externalImports].join('\n')}\n\n${parts.join('\n\n')}\n\n// ── ${name}/index.ts ──\n${mainBody.join('\n').replace(/^\s+/, '')}`;

const outDir = path.join(root, 'docs', 'bundles');
fs.mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, `${name}.single-file.ts`);
fs.writeFileSync(target, output.endsWith('\n') ? output : `${output}\n`);
console.log(`Escrito ${path.relative(root, target)} (${output.split('\n').length} líneas)`);
