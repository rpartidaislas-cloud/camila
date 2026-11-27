import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../smyl-clinic-setup.js');
const styles = read('../smyl-clinic-setup.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('Puesta en marcha: 11 pasos obligatorios y 5 recomendados, verificados con datos reales y solo de lectura', () => {
  const required = ['branch', 'hours', 'rooms', 'professional', 'team', 'services', 'whatsapp', 'template', 'reminders', 'patient', 'appointment'];
  const extra = ['sat', 'invoicing', 'noshow', 'gcal', 'ai'];
  for (const id of required) assert.match(script, new RegExp("id: '" + id + "', group: '[a-z]+', required: true"), id);
  for (const id of extra) assert.match(script, new RegExp("id: '" + id + "', group: 'extra', required: false"), id);
  for (const table of ['smyl_branches', 'smyl_clinic_hours', 'smyl_rooms', 'smyl_professional_hours', 'camila_usuarios', 'smyl_member_roles', 'smyl_services', 'camila_pacientes', 'smyl_appointments', 'smyl_google_calendar_connections']) {
    assert.ok(script.includes("'" + table + "'"), table);
  }
  assert.match(script, /smyl_reminder_settings'\)\.select\('enabled,no_show_enabled'\)/);
  assert.match(script, /smyl_ai_scheduling_settings'\)\.select\('level'\)/);
  assert.match(script, /smyl_issuer_fiscal_profiles'\)\.select\('tenant_id', \{ count: 'exact', head: true \}\)[\s\S]*fiscal_status', 'reviewed'/);
  assert.match(script, /functions\/v1\/lana-channels/);
  assert.match(script, /functions\.invoke\('whatsapp-templates', \{ body: \{ action: 'list' \} \}\)/);
  assert.match(script, /item\.status === 'APPROVED' && item\.category === 'UTILITY'/);
  assert.doesNotMatch(script, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|method: 'POST'/, 'solo lectura');
});

test('el 100 % cuenta solo los obligatorios; un fallo de lectura nunca cuenta como paso listo', () => {
  assert.match(script, /var REQUIRED = STEPS\.filter\(function \(step\) \{ return step\.required; \}\)/);
  assert.match(script, /percent: Math\.round\(done \/ REQUIRED\.length \* 100\)/);
  assert.match(script, /\{ unknown: true \}/);
  assert.match(script, /No pudimos verificarlo ahora/);
  assert.match(script, /Meta está revisando tu solicitud/);
  assert.match(script, /No cuentan para el 100 %/);
  // cada lectura se arma dentro de su propia función: una tabla que falla solo deja ese paso «sin verificar»
  assert.match(script, /function guarded\(build\)/);
  assert.match(script, /function counted\(build\)/);
});

test('solo la ve el propietario; la tarjeta desaparece al completar lo obligatorio y se puede ocultar por hoy', () => {
  assert.match(script, /window\.miRolEquipo === 'dueño'/);
  assert.match(script, /!isOwner\(\) \|\| !results \|\| info\.done >= info\.total \|\| hiddenToday\(\)/);
  assert.match(script, /smyl_clinic_setup_hidden_/);
  assert.match(script, /host\.append\(section\)/);
});

test('arquitectura visual: tarjeta (avance + un siguiente paso) y ventana accesible con la lista agrupada', () => {
  assert.match(script, /setAttribute\('role', 'progressbar'\)/);
  assert.match(script, /aria-valuenow/);
  assert.match(script, /Siguiente paso/);
  assert.match(script, /Ver todos los pasos/);
  assert.match(script, /showModal\(\)/);
  assert.match(script, /aria-labelledby', 'setup-dialog-title'/);
  assert.match(script, /¡Tu clínica está lista!/);
  for (const group of ['Tu clínica', 'Tu equipo', 'Servicios', 'Mensajes a pacientes', 'Pacientes y agenda', 'Recomendados']) assert.ok(script.includes("'" + group + "'"), group);
  assert.match(styles, /\.setup-dialog \{ margin: auto;/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /\(max-width: 540px\)/);
  assert.match(styles, /min-height: 44px/);
});

test('el recordatorio abre la revisión diaria del mismo módulo y no crea un flujo paralelo', () => {
  assert.match(script, /rpc\('smyl_compliance_overview'/);
  assert.match(script, /SmylComplianceModel\.dailyReview/);
  assert.match(script, /route\('cumplimiento'\)/);
  assert.match(script, /REVISIÓN DIARIA · OPCIONAL/);
  assert.match(script, /SmylCompliance\.open\('daily'\)/);
  assert.doesNotMatch(script, /smyl_regulatory_readiness_report|SmylReadiness\.open\('regulatory'\)/);
});

test('Configuración conserva su lectura (ids hours, patient, whatsapp, template, reminders) y ofrece el acceso permanente', () => {
  assert.match(script, /results: function \(\) \{ return isOwner\(\) && state\.tenant === window\.tenantId \? state\.results : null; \}/);
  assert.match(script, /summary: function \(\)/);
  assert.match(script, /open: function \(opener\)/);
  assert.match(read('../smyl-settings-hub.js'), /settings-hub-setup/);
  assert.match(read('../smyl-settings-hub.js'), /setup\.open\(guide\)/);
});

test('no muestra el nombre del motor de mensajería', () => {
  assert.doesNotMatch(script, /\bLANA\b|\bLana\b/);
});

test('web, móvil y PWA publican el módulo', () => {
  assert.match(app, /<link rel="stylesheet" href="smyl-clinic-setup\.css\?v=6">\s*<script defer src="smyl-clinic-setup\.js\?v=10"><\/script>/);
  assert.ok(app.indexOf('smyl-clinic-setup.js') > app.indexOf('smyl-daily-home.js'), 'carga después del Inicio');
  assert.ok(worker.includes("'/camila/smyl-clinic-setup.js?v=10'") && worker.includes("'/camila/smyl-clinic-setup.css?v=6'"));
  for (const file of ['smyl-clinic-setup.js', 'smyl-clinic-setup.css', 'smyl-settings-hub.js', 'app.html', 'sw.js']) assert.equal(read('../mobile/www/' + file), read('../' + file), file);
});
