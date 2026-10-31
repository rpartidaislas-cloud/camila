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
// Un `import { a,\n b,\n } from "../_shared/x.ts";` repartido en varias líneas se junta en una sola, que es lo único que
// reconoce el generador; si no, quedaban líneas sueltas y el bundle no compilaba.
const joinImports = (source) => source.replace(/^import\s+(?:type\s+)?\{[^}]*\}\s*from\s*["'][^"']+["'];?[ \t]*$/gm, (statement) => statement.replace(/\s+/g, ' ').replace(/\{\s*,/, '{').replace(/,\s*\}/, ' }'));
const readSource = (...parts) => joinImports(read(...parts));
// `./x.ts` puede ser un archivo de la propia función (junto a su index.ts) o uno de _shared.
const sharedParts = (file) => (fs.existsSync(path.join(functionsDir, name, file)) ? [name, file] : ['_shared', file]);
const SHARED_IMPORT = /^import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+["'](?:\.\.\/_shared\/|\.\/)([\w.-]+)["'];?\s*$/;
// `import type { X } from './archivo.ts'`: sólo ordena la carga; los tipos se elevan al nivel superior (ver hoistTypes).
const SHARED_TYPE_IMPORT = /^import\s+type\s+\{[^}]*\}\s+from\s+["'](?:\.\.\/_shared\/|\.\/)([\w.-]+)["'];?\s*$/;
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

// Las interfaces y tipos exportados de un módulo compartido se sacan de su bloque para que los demás módulos los vean.
const hoisted = [];
// Sólo se elevan tipos cuando algún archivo alcanzable usa `import type` de un módulo compartido; así los bundles
// existentes (sin ese patrón) salen byte a byte iguales que antes.
function usesSharedTypeImports(file, seen = new Set()) {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = file === 'index.ts' ? readSource(name, 'index.ts') : readSource(...sharedParts(file));
  const lines = source.split('\n');
  if (lines.some((line) => SHARED_TYPE_IMPORT.test(line))) return true;
  return lines.some((line) => { const m = line.match(SHARED_IMPORT); return m ? usesSharedTypeImports(m[3], seen) : false; });
}
const hoistEnabled = usesSharedTypeImports('index.ts');
function hoistTypes(code) {
  if (!hoistEnabled) return code;
  const lines = code.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^export\s+(?:interface|type)\s/.test(line)) { kept.push(line); continue; }
    const block = [line.replace(/^export\s+/, '')];
    const balance = (text) => (text.match(/[{(\[]/g) || []).length - (text.match(/[})\]]/g) || []).length;
    let depth = balance(line);
    // Un bloque termina cuando se cierran todos los paréntesis/llaves y la línea acaba en ; o }.
    while ((depth > 0 || !/[;}]\s*$/.test(block[block.length - 1])) && ++i < lines.length) { block.push(lines[i]); depth += balance(lines[i]); }
    hoisted.push(block.join('\n'));
  }
  return kept.join('\n');
}

const modules = new Map();
function loadShared(file) {
  if (modules.has(file)) return;
  const source = readSource(...sharedParts(file));
  const imports = [];
  const body = [];
  for (const line of source.split('\n')) {
    const match = line.match(SHARED_IMPORT);
    const typeMatch = line.match(SHARED_TYPE_IMPORT);
    if (typeMatch) { loadShared(typeMatch[1]); imports.push(line); }
    else if (match) { loadShared(match[3]); imports.push(line); } else body.push(line);
  }
  const text = hoistTypes(body.join('\n'));
  const externalImports = text.split('\n').filter((line) => /^import\s/.test(line));
  let code = stripExports(text.split('\n').filter((line) => !/^import\s/.test(line)).join('\n'));
  // Los .mjs no declaran tipos; el bundle es TypeScript estricto, así que se anotan los parámetros sueltos.
  if (file.endsWith('.mjs')) {
    code = code.replace(/function\s*(\w*)\s*\(([^)]*)\)/g, (match, name, params) => {
      const typed = params.split(',').map((param) => (/^\s*\w+\s*$/.test(param) ? param.trim() + ': any' : param.trim())).filter(Boolean).join(', ');
      return 'function ' + name + '(' + typed + ')';
    });
  }
  const exports = exportedNames(text);
  // "admin as smylAdmin" se exporta con otro nombre: se asigna aparte.
  const aliased = [...text.matchAll(/^export\s+\{([^}]*)\}/gm)].flatMap((m) => m[1].split(',')).map((p) => p.trim().split(/\s+as\s+/)).filter((p) => p[1]);
  const returns = exports.map((exported) => {
    const alias = aliased.find((p) => p[1] === exported);
    return alias ? `${exported}: ${alias[0]}` : exported;
  });
  modules.set(file, { code, exports, returns, externalImports, imports });
}

const main = readSource(name, 'index.ts');
if (/^import\s*\{[^}]*\sas\s[^}]*\}\s*from\s*["']\.\.?\/(?:_shared\/)?[\w.-]+["']/m.test(main)) {
  console.error('index.ts importa un archivo compartido con alias ("x as y"); el generador no lo soporta. Usa el nombre original.');
  process.exit(1);
}
const mainLines = main.split('\n');
const used = [];
const mainBody = [];
const externalImports = new Set();
for (const line of mainLines) {
  const match = line.match(SHARED_IMPORT);
  const typeMatch = line.match(SHARED_TYPE_IMPORT);
  if (typeMatch) { loadShared(typeMatch[1]); used.push({ names: [], file: typeMatch[1] }); }
  else if (match) { loadShared(match[3]); used.push({ names: (match[1] || match[2]).split(',').map((n) => n.trim()).filter(Boolean), file: match[3] }); }
  else if (/^import\s/.test(line)) externalImports.add(normalizeImport(line));
  else mainBody.push(line);
}

const parts = [];
const bundled = new Set();
function emit(file) {
  if (bundled.has(file)) return;
  const mod = modules.get(file);
  for (const dependency of mod.imports) emit((dependency.match(SHARED_TYPE_IMPORT) || dependency.match(SHARED_IMPORT)).at(dependency.match(SHARED_TYPE_IMPORT) ? 1 : 3));
  bundled.add(file);
  mod.externalImports.forEach((line) => externalImports.add(normalizeImport(line)));
  const wanted = mod.imports.flatMap((line) => ((line.match(SHARED_IMPORT) || [])[1] || '').split(',').map((n) => n.trim()).filter(Boolean));
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
const typesBlock = hoisted.length ? `// ── tipos compartidos ──\n${hoisted.join('\n\n')}\n\n` : '';
const output = `${banner}${[...externalImports].join('\n')}\n\n${typesBlock}${parts.join('\n\n')}\n\n// ── ${name}/index.ts ──\n${mainBody.join('\n').replace(/^\s+/, '')}`;

const outDir = path.join(root, 'docs', 'bundles');
fs.mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, `${name}.single-file.ts`);
fs.writeFileSync(target, output.endsWith('\n') ? output : `${output}\n`);
console.log(`Escrito ${path.relative(root, target)} (${output.split('\n').length} líneas)`);
