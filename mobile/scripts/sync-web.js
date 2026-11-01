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
copyFile(path.join(ROOT, 'simulacion-rapida.html'), path.join(WWW, 'simulacion-rapida.html'));
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
copyFile(path.join(ROOT, 'smyl-studio.js'), path.join(WWW, 'smyl-studio.js'));
copyFile(path.join(ROOT, 'smyl-studio.css'), path.join(WWW, 'smyl-studio.css'));
copyFile(path.join(ROOT, 'smyl-simulation-workspace-v33.css'), path.join(WWW, 'smyl-simulation-workspace-v33.css'));
copyFile(path.join(ROOT, 'smyl-clinical-review-v33.js'), path.join(WWW, 'smyl-clinical-review-v33.js'));
copyFile(path.join(ROOT, 'smyl-clinical-review-v33.css'), path.join(WWW, 'smyl-clinical-review-v33.css'));
copyFile(path.join(ROOT, 'smyl-radiograph-review.js'), path.join(WWW, 'smyl-radiograph-review.js'));
copyFile(path.join(ROOT, 'smyl-radiograph-review.css'), path.join(WWW, 'smyl-radiograph-review.css'));
copyFile(path.join(ROOT, 'smyl-radiograph-workbench.css'), path.join(WWW, 'smyl-radiograph-workbench.css'));
copyFile(path.join(ROOT, 'smyl-professional-v3.js'), path.join(WWW, 'smyl-professional-v3.js'));
copyFile(path.join(ROOT, 'smyl-professional-v3.css'), path.join(WWW, 'smyl-professional-v3.css'));
copyFile(path.join(ROOT, 'smyl-clinic.js'), path.join(WWW, 'smyl-clinic.js'));
copyFile(path.join(ROOT, 'smyl-clinic.css'), path.join(WWW, 'smyl-clinic.css'));
copyFile(path.join(ROOT, 'smyl-clinic-admin.js'), path.join(WWW, 'smyl-clinic-admin.js'));
copyFile(path.join(ROOT, 'smyl-clinic-admin.css'), path.join(WWW, 'smyl-clinic-admin.css'));
copyFile(path.join(ROOT, 'smyl-patient-360.js'), path.join(WWW, 'smyl-patient-360.js'));
copyFile(path.join(ROOT, 'smyl-patient-360.css'), path.join(WWW, 'smyl-patient-360.css'));
copyFile(path.join(ROOT, 'smyl-proposal-model.js'), path.join(WWW, 'smyl-proposal-model.js'));
copyFile(path.join(ROOT, 'smyl-proposal-print.js'), path.join(WWW, 'smyl-proposal-print.js'));
copyFile(path.join(ROOT, 'smyl-proposals.js'), path.join(WWW, 'smyl-proposals.js'));
copyFile(path.join(ROOT, 'smyl-proposals.css'), path.join(WWW, 'smyl-proposals.css'));
copyFile(path.join(ROOT, 'smyl-treatment-quote-stage3.js'), path.join(WWW, 'smyl-treatment-quote-stage3.js'));
copyFile(path.join(ROOT, 'smyl-treatment-quote-stage3.css'), path.join(WWW, 'smyl-treatment-quote-stage3.css'));
copyFile(path.join(ROOT, 'smyl-schedule.js'), path.join(WWW, 'smyl-schedule.js'));
copyFile(path.join(ROOT, 'smyl-schedule.css'), path.join(WWW, 'smyl-schedule.css'));
copyFile(path.join(ROOT, 'smyl-inbox.js'), path.join(WWW, 'smyl-inbox.js'));
copyFile(path.join(ROOT, 'smyl-inbox.css'), path.join(WWW, 'smyl-inbox.css'));
copyFile(path.join(ROOT, 'smyl-daily-home.js'), path.join(WWW, 'smyl-daily-home.js'));
copyFile(path.join(ROOT, 'smyl-daily-home.css'), path.join(WWW, 'smyl-daily-home.css'));
copyFile(path.join(ROOT, 'smyl-clinic-setup.js'), path.join(WWW, 'smyl-clinic-setup.js'));
copyFile(path.join(ROOT, 'smyl-clinic-setup.css'), path.join(WWW, 'smyl-clinic-setup.css'));
copyFile(path.join(ROOT, 'smyl-inventory.js'), path.join(WWW, 'smyl-inventory.js'));
copyFile(path.join(ROOT, 'smyl-inventory.css'), path.join(WWW, 'smyl-inventory.css'));
copyFile(path.join(ROOT, 'smyl-consumption.js'), path.join(WWW, 'smyl-consumption.js'));
copyFile(path.join(ROOT, 'smyl-consumption.css'), path.join(WWW, 'smyl-consumption.css'));
copyFile(path.join(ROOT, 'smyl-finance.js'), path.join(WWW, 'smyl-finance.js'));
copyFile(path.join(ROOT, 'smyl-finance.css'), path.join(WWW, 'smyl-finance.css'));
copyFile(path.join(ROOT, 'smyl-reports.js'), path.join(WWW, 'smyl-reports.js'));
copyFile(path.join(ROOT, 'smyl-reports.css'), path.join(WWW, 'smyl-reports.css'));
copyFile(path.join(ROOT, 'smyl-connections.js'), path.join(WWW, 'smyl-connections.js'));
copyFile(path.join(ROOT, 'smyl-connections.css'), path.join(WWW, 'smyl-connections.css'));
copyFile(path.join(ROOT, 'smyl-security-center.js'), path.join(WWW, 'smyl-security-center.js'));
copyFile(path.join(ROOT, 'smyl-security-center.css'), path.join(WWW, 'smyl-security-center.css'));
copyFile(path.join(ROOT, 'smyl-google-calendar.js'), path.join(WWW, 'smyl-google-calendar.js'));
copyFile(path.join(ROOT, 'smyl-google-calendar.css'), path.join(WWW, 'smyl-google-calendar.css'));
copyFile(path.join(ROOT, 'smyl-template-catalog.js'), path.join(WWW, 'smyl-template-catalog.js'));
copyFile(path.join(ROOT, 'smyl-templates.js'), path.join(WWW, 'smyl-templates.js'));
copyFile(path.join(ROOT, 'smyl-templates.css'), path.join(WWW, 'smyl-templates.css'));
for (const file of ['smyl-dental-record.js', 'smyl-dental-record.css', 'smyl-radiograph-review.js', 'smyl-radiograph-review.css', 'smyl-radiograph-workbench.css',
  'smyl-radiograph-review-model.js', 'smyl-radiograph-review-store.js', 'smyl-radiograph-analysis-client.js',
  'smyl-radiograph-contracts.js', 'smyl-radiograph-review-model-v2.js', 'smyl-radiograph-review-v2.js', 'smyl-radiograph-review-v2.css', 'smyl-radiograph-report.js', 'smyl-radiograph-report.css', 'smyl-radiograph-longitudinal.js', 'smyl-radiograph-longitudinal.css', 'smyl-radiograph-validation.js', 'smyl-radiograph-validation.css']) {
  copyFile(path.join(ROOT, file), path.join(WWW, file));
}
copyDir(path.join(ROOT, 'icons'), path.join(WWW, 'icons'));

console.log('www/ actualizado desde la raíz del repo.');
