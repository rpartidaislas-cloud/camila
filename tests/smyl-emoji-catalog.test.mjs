import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = JSON.parse(readFileSync(new URL('../assets/emoji/catalog-es-v1.json', import.meta.url), 'utf8'));
const byGlyph = new Map(catalog.items.map(item => [item[0], item]));

test('el selector incluye el repertorio completo y único de Unicode Emoji 18', () => {
  assert.equal(catalog.unicode, '18.0');
  assert.equal(catalog.items.length, 3972);
  assert.equal(byGlyph.size, catalog.items.length);
  assert.equal(catalog.groups.length, 10);
  assert.match(catalog.license, /UNICODE LICENSE V3/);
  assert.ok(catalog.items.every(([, group, name]) => catalog.groups[group] && name.trim()));
});

test('mantiene secuencias compuestas, tonos de piel, banderas y términos de búsqueda en español', () => {
  for (const glyph of ['👩🏽‍⚕️', '🧑🏾‍🤝‍🧑🏻', '👨‍👨‍👦‍👦', '1️⃣', '🇲🇽', '👍🏿', '🫫']) assert.ok(byGlyph.has(glyph), glyph);
  assert.match(byGlyph.get('🇲🇽')[2], /México/);
  assert.match(byGlyph.get('👩🏽‍⚕️')[3], /doctora/);
  assert.match(byGlyph.get('🦷')[2], /diente/);
  assert.match(byGlyph.get('🦷')[3], /muela/);
});
