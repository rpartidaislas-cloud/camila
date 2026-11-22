#!/usr/bin/env node
// El motor de «Sugerir horarios» vive en smyl-schedule-suggest.js (UMD, para el navegador). Las Edge Functions no pueden importar archivos
// de la raíz web, así que se genera una copia ESM en supabase/functions/_shared/schedule-suggest-core.mjs. Una prueba verifica que esté
// al día, de modo que las personas y el asistente de IA siempre usen EXACTAMENTE las mismas reglas.
//
//   node scripts/sync-schedule-suggest.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'smyl-schedule-suggest.js'), 'utf8').replace(/\r\n/g, '\n');
if (!source.includes('root.SmylScheduleSuggest = factory()')) throw new Error('No se reconoce la estructura de smyl-schedule-suggest.js');
const names = ['suggest', 'describe', 'keyOf', 'localParts', 'AFTERNOON_FROM'];
const output = `// ARCHIVO GENERADO por scripts/sync-schedule-suggest.mjs a partir de smyl-schedule-suggest.js: no lo edites.
const module = { exports: {} };
${source}
${names.map((name) => `export const ${name} = module.exports.${name};`).join('\n')}
export default module.exports;
`;
const target = path.join(root, 'supabase', 'functions', '_shared', 'schedule-suggest-core.mjs');
fs.writeFileSync(target, output);
console.log('Escrito ' + path.relative(root, target));
