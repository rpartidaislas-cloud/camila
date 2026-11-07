import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root));
const manifestText = read('manifest-app.json').toString('utf8');
const manifest = JSON.parse(manifestText);
const app = read('app.html').toString('utf8');

function pngDimensions(path) {
  const file = read(path);
  assert.equal(file.toString('ascii', 1, 4), 'PNG', `${path} debe ser PNG`);
  return [file.readUInt32BE(16), file.readUInt32BE(20)];
}

test('la PWA usa una identidad visual coherente con el panel instalado', () => {
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.theme_color, '#0B1B2E');
  assert.equal(manifest.background_color, '#F4F7FA');
  assert.match(app, /<meta name="theme-color" content="#0B1B2E">/);
  assert.match(app, /icons\/icon-192\.png/);
  assert.match(app, /icons\/icon-512\.png/);
});

test('cada icono declarado existe y coincide con su tamaño real', () => {
  for (const icon of manifest.icons) {
    const [declaredWidth, declaredHeight] = icon.sizes.split('x').map(Number);
    const [width, height] = pngDimensions(icon.src);
    assert.deepEqual([width, height], [declaredWidth, declaredHeight], icon.src);
  }
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose.includes('maskable')));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose.includes('maskable')));
});

test('el manifiesto web y el paquete móvil permanecen sincronizados', () => {
  assert.equal(manifestText, read('mobile/www/manifest-app.json').toString('utf8'));
});
