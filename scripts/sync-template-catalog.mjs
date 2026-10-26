#!/usr/bin/env node
// El catálogo de plantillas vive en smyl-template-catalog.js (UMD, para el navegador). Las Edge
// Functions no pueden importar archivos de la raíz web, así que se genera una copia ESM en
// supabase/functions/_shared/whatsapp-template-catalog.mjs. Una prueba verifica que esté al día.
//
//   node scripts/sync-template-catalog.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Normaliza saltos para que la generación sea idéntica en Windows y CI.
const source = fs.readFileSync(path.join(root, 'smyl-template-catalog.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf("function () {\n  'use strict';");
const end = source.lastIndexOf('return { LANGUAGE');
if (start < 0 || end < 0) throw new Error('No se reconoce la estructura de smyl-template-catalog.js');
const body = source.slice(start, source.indexOf('\n', end) + 1);
const names = ['LANGUAGE', 'GROUPS', 'TEMPLATES', 'RULES', 'OPT_OUT_FOOTER', 'validate', 'fill', 'formatForLana'];
const output = `// ARCHIVO GENERADO por scripts/sync-template-catalog.mjs a partir de smyl-template-catalog.js: no lo edites.
const catalog = (${body}})();

${names.map((name) => `export const ${name} = catalog.${name};`).join('\n')}
`;
const target = path.join(root, 'supabase', 'functions', '_shared', 'whatsapp-template-catalog.mjs');
fs.writeFileSync(target, output);
console.log('Escrito ' + path.relative(root, target));
