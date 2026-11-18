import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// Módulos que muestran skeleton mientras cargan contenido. Si agregas una pantalla con estado de carga, usa SmylSkeleton y súmala aquí.
const MODULES = [
  'my-smyl-portal.js', 'my-smyl-studio.js', 'my-smyl.js', 'smyl-case-workspace.js', 'smyl-clinic-admin.js', 'smyl-clinic.js', 'smyl-cloud.js',
  'smyl-connections.js', 'smyl-consultorio.js', 'smyl-daily-home.js', 'smyl-dental-record.js', 'smyl-finance.js', 'smyl-google-calendar.js',
  'smyl-inbox-calendar.js', 'smyl-inbox-ficha.js', 'smyl-inbox.js', 'smyl-inventory.js', 'smyl-lana-handoff.js', 'smyl-patient-360.js',
  'smyl-patient-cases.js', 'smyl-photo-analysis.js', 'smyl-professional-directory.js', 'smyl-professional-v3.js', 'smyl-proposals.js',
  'smyl-radiograph-report.js', 'smyl-radiograph-review.js', 'smyl-radiograph-validation.js', 'smyl-reminders.js', 'smyl-result-viewer.js',
  'smyl-schedule-board.js', 'smyl-schedule-message.js', 'smyl-schedule.js', 'smyl-security-center.js', 'smyl-service-catalog.js',
  'smyl-task-center.js', 'smyl-templates.js',
];
const PAGES = ['compartido.html', 'consumos.html', 'dentista.html', 'editor.html', 'pagar.html', 'registro-paciente.html', 'revision-clinica.html', 'revisionclinica.html'];

test('cada módulo con carga de contenido usa SmylSkeleton y conserva un respaldo si no está disponible', () => {
  assert.equal(MODULES.length, 36);
  for (const file of MODULES) {
    const src = read(file);
    assert.match(src, /(window|win)\.SmylSkeleton/, `${file} debe usar SmylSkeleton con comprobación de existencia`);
    // respaldo: siempre condicionado a que exista (nunca llamar sin comprobar)
    assert.doesNotMatch(src, /(^|[^.\w?&(!])SmylSkeleton\.(html|node)\(/m, `${file} llama a SmylSkeleton sin comprobar que exista`);
  }
});

test('las páginas sueltas con carga cargan el sistema de skeletons por ruta relativa', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /<link rel="stylesheet" href="smyl-skeleton\.css\?v=1">/, page);
    assert.match(html, /<script defer src="smyl-skeleton\.js\?v=1"><\/script>/, page);
    if (existsSync(new URL(`../mobile/www/${page}`, import.meta.url))) assert.equal(read(`mobile/www/${page}`), html, `mobile/www/${page}`);
  }
});

test('los módulos con skeleton llegan igual a web y móvil', () => {
  for (const file of MODULES) assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file}`);
});

test('ya no queda un «Cargando…» suelto como única señal de carga en las pantallas principales', () => {
  const clinic = read('smyl-clinic.js');
  assert.doesNotMatch(clinic, /content\.append\(notice\('Cargando el expediente…'\)\)/);
  const finance = read('smyl-finance.js');
  assert.match(finance, /loadingSkeleton\(true\)/);
  assert.match(read('smyl-schedule.js'), /'calendar'/);
});
