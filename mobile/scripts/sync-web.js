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
copyFile(path.join(ROOT, 'app.html'), path.join(WWW, 'app.html'));
copyFile(path.join(ROOT, 'sw.js'), path.join(WWW, 'sw.js'));
copyFile(path.join(ROOT, 'mila.html'), path.join(WWW, 'mila.html'));
copyFile(path.join(ROOT, 'consumos.html'), path.join(WWW, 'consumos.html'));
copyFile(path.join(ROOT, 'dentista.html'), path.join(WWW, 'dentista.html'));
copyFile(path.join(ROOT, 'smyl-professional-directory.js'), path.join(WWW, 'smyl-professional-directory.js'));
copyFile(path.join(ROOT, 'smyl-professional-directory.css'), path.join(WWW, 'smyl-professional-directory.css'));
copyFile(path.join(ROOT, 'smyl-ui-template-v3.css'), path.join(WWW, 'smyl-ui-template-v3.css'));
copyFile(path.join(ROOT, 'smyl-navigation.js'), path.join(WWW, 'smyl-navigation.js'));
copyFile(path.join(ROOT, 'smyl-navigation.css'), path.join(WWW, 'smyl-navigation.css'));
copyFile(path.join(ROOT, 'smyl-command-menu.js'), path.join(WWW, 'smyl-command-menu.js'));
copyFile(path.join(ROOT, 'smyl-command-menu.css'), path.join(WWW, 'smyl-command-menu.css'));
copyFile(path.join(ROOT, 'smyl-professional-v3.js'), path.join(WWW, 'smyl-professional-v3.js'));
copyFile(path.join(ROOT, 'smyl-professional-v3.css'), path.join(WWW, 'smyl-professional-v3.css'));
copyFile(path.join(ROOT, 'smyl-clinic.js'), path.join(WWW, 'smyl-clinic.js'));
copyFile(path.join(ROOT, 'smyl-clinic.css'), path.join(WWW, 'smyl-clinic.css'));
copyFile(path.join(ROOT, 'smyl-clinic-admin.js'), path.join(WWW, 'smyl-clinic-admin.js'));
copyFile(path.join(ROOT, 'smyl-clinic-admin.css'), path.join(WWW, 'smyl-clinic-admin.css'));
copyFile(path.join(ROOT, 'smyl-schedule.js'), path.join(WWW, 'smyl-schedule.js'));
copyFile(path.join(ROOT, 'smyl-schedule.css'), path.join(WWW, 'smyl-schedule.css'));
copyFile(path.join(ROOT, 'smyl-inbox.js'), path.join(WWW, 'smyl-inbox.js'));
copyFile(path.join(ROOT, 'smyl-inbox.css'), path.join(WWW, 'smyl-inbox.css'));
copyFile(path.join(ROOT, 'smyl-google-calendar.js'), path.join(WWW, 'smyl-google-calendar.js'));
copyFile(path.join(ROOT, 'smyl-google-calendar.css'), path.join(WWW, 'smyl-google-calendar.css'));
copyFile(path.join(ROOT, 'smyl-template-catalog.js'), path.join(WWW, 'smyl-template-catalog.js'));
copyFile(path.join(ROOT, 'smyl-templates.js'), path.join(WWW, 'smyl-templates.js'));
copyFile(path.join(ROOT, 'smyl-templates.css'), path.join(WWW, 'smyl-templates.css'));
copyDir(path.join(ROOT, 'icons'), path.join(WWW, 'icons'));

console.log('www/ actualizado desde la raíz del repo.');
