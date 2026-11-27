import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Horarios y servicios: cada tarjeta se pliega con un botón en su encabezado, resumen y estado recordado por clínica', () => {
  const js = read('smyl-agenda-accordion.js');
  assert.match(js, /#p-agenda \[data-schedule-panel="settings"\] \.schedule-settings-grid/);
  assert.match(js, /smyl_agenda_sections_/);
  assert.match(js, /aria-expanded/);
  assert.match(js, /'Ocultar ' : 'Mostrar '/);
  assert.match(js, /Expandir todo/); assert.match(js, /Contraer todo/);
  assert.match(js, /event\.target\.closest\('button, a, input, select, textarea, label'\)/, 'tocar el encabezado también pliega, sin pisar sus botones');
  assert.match(js, /attributeFilter: \['data-summary', 'data-summary-tone'\]/);
  assert.match(js, /setOpen\(card, saved === true, false\)/, 'abre plegada salvo que se haya dejado abierta');
  assert.doesNotMatch(js, /\.insert\(|\.update\(|\.rpc\(|fetch\(/, 'solo presentación');
  const css = read('smyl-agenda-accordion.css');
  assert.match(css, /\.schedule-card \.sc-toggle \{ display: none; \}/, 'fuera de la pestaña (Configuración) la tarjeta se ve siempre abierta');
  assert.match(css, /\[data-collapsed="true"\] > :not\(\.schedule-section-title\) \{ display: none; \}/);
  assert.match(css, /\(max-width: 640px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('las tarjetas publican su resumen: servicios, horario del equipo, mensajes automáticos y Agenda con IA', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /card\.dataset\.summary=total\?\(total\+\(total===1\?' servicio':' servicios'\)\):'Sin servicios'/);
  assert.match(schedule, /' sin horario'/);
  assert.match(read('smyl-reminders.js'), /card\.dataset\.summary = activeCount \+ ' de 4 activos'/);
  assert.match(read('smyl-ai-scheduling.js'), /off: 'Apagada', suggest: 'Solo sugiere', request: 'Deja solicitudes', book: 'Agenda sola'/);
});

test('Horario de tu equipo: una fila por profesional con una línea por sede, sin perder «Editar horario»', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /schedule-hour schedule-hour-pro/);
  assert.match(schedule, /schedule-hour-sites/);
  assert.match(schedule, /window\.SmylClinicAdmin\.editHours\(r\.p\.id,r\.br\.id\)/);
  assert.match(schedule, /Poner horario/);
});

test('web, móvil y PWA publican el acordeón', () => {
  const app = read('app.html'), worker = read('sw.js');
  assert.match(app, /<link rel="stylesheet" href="smyl-agenda-accordion\.css\?v=1">/);
  assert.match(app, /<script defer src="smyl-reminders\.js\?v=9"><\/script>\s*<script defer src="smyl-agenda-accordion\.js\?v=1"><\/script>/);
  assert.ok(worker.includes("'/camila/smyl-agenda-accordion.js?v=1'") && worker.includes("'/camila/smyl-agenda-accordion.css?v=1'"));
  for (const f of ['smyl-agenda-accordion.js', 'smyl-agenda-accordion.css', 'smyl-schedule.js', 'smyl-reminders.js', 'smyl-ai-scheduling.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});
