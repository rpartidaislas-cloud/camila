import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../simulacion.html', import.meta.url), 'utf8');
const scripts = Array.from(
  html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi),
  (match) => match[1],
).filter((script) => script.trim());

assert.ok(scripts.length > 0, 'No se encontraron scripts inline');
scripts.forEach((script) => Function(script));
console.log(`inline scripts valid: ${scripts.length}`);
