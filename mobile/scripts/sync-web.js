// Copia la última versión de las apps web (raíz del repo) hacia mobile/www,
// para que el proyecto nativo nunca quede desincronizado del código fuente real.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WWW = path.resolve(__dirname, '..', 'www');

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
  console.log('sync:', path.relative(ROOT, src), '->', path.relative(path.resolve(__dirname, '..'), dest));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

copyFile(path.join(ROOT, 'simulacion.html'), path.join(WWW, 'simulacion.html'));
copyFile(path.join(ROOT, 'revision-clinica.html'), path.join(WWW, 'revision-clinica.html'));
copyDir(path.join(ROOT, 'icons'), path.join(WWW, 'icons'));

console.log('www/ actualizado desde la raíz del repo.');
