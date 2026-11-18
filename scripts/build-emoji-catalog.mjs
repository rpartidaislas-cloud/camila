// Release-time only. The chat loads the generated same-origin file on demand.
import { mkdir, writeFile } from 'node:fs/promises';

const emojiSource = 'https://www.unicode.org/Public/18.0.0/emoji/emoji-test.txt';
const cldr = 'https://raw.githubusercontent.com/unicode-org/cldr-json/49.0.0/';
const sources = [
  emojiSource,
  cldr + 'cldr-json/cldr-annotations-full/annotations/es/annotations.json',
  cldr + 'cldr-json/cldr-annotations-derived-full/annotationsDerived/es/annotations.json',
  cldr + 'LICENSE',
];
const [testData, basic, derived, license] = await Promise.all(sources.map(async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status + ' ' + url);
  return response.text();
}));
const spanish = {
  ...JSON.parse(basic).annotations.annotations,
  ...JSON.parse(derived).annotationsDerived.annotations,
};
const groups = {
  'Smileys & Emotion': 'Caras y emociones', 'People & Body': 'Personas y gestos',
  'Animals & Nature': 'Animales y naturaleza', 'Food & Drink': 'Comida y bebida',
  'Travel & Places': 'Viajes y lugares', Activities: 'Actividades', Objects: 'Objetos',
  Symbols: 'Símbolos', Flags: 'Banderas', Component: 'Componentes',
};
let group;
const rows = [];
for (const line of testData.split(/\r?\n/)) {
  if (line.startsWith('# group: ')) group = line.slice(9);
  const match = line.match(/; (?:fully-qualified|component)\s+# (\S+) E[\d.]+ (.+)/);
  if (!match) continue;
  const [, glyph, english] = match;
  const annotation = spanish[glyph] ?? spanish[glyph.replace(/\uFE0F/g, '')];
  if (!groups[group]) throw new Error('Unknown group: ' + group);
  if (!annotation?.tts?.[0]) throw new Error('Missing Spanish name for ' + glyph + ' (' + english + ')');
  const name = annotation.tts[0];
  const keywords = (annotation?.default ?? []).filter(word => !name.includes(word));
  rows.push(JSON.stringify([glyph, Object.keys(groups).indexOf(group), name, keywords.join(' ')]));
}
if (!rows.length || !license.includes('UNICODE LICENSE')) throw new Error('Incomplete Unicode data');
const output = new URL('../assets/emoji/', import.meta.url);
await mkdir(output, { recursive: true });
const metadata = { unicode: '18.0', cldr: '49.0.0', sources, emojiCopyright: '© 2026 Unicode®, Inc.', license: license.trim(), groups: Object.values(groups) };
const catalog = JSON.stringify(metadata).slice(0, -1) + ',"items":[\n' + rows.join(',\n') + '\n]}\n';
await writeFile(new URL('catalog-es-v1.json', output), catalog);
console.log(rows.length + ' emojis, ' + Buffer.byteLength(catalog) + ' bytes');
