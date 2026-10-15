import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const mobile = fs.readFileSync(new URL('../mobile/www/app.html', import.meta.url), 'utf8');

test('todos los scripts principales de app.html son sintácticamente válidos', () => {
  const scripts = Array.from(
    app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi),
    (match) => match[1],
  ).filter((script) => script.trim());
  assert.ok(scripts.length > 0);
  scripts.forEach((script, index) => new vm.Script(script, { filename: `app-inline-${index}.js` }));
});

test('SMYL ofrece recuperación de contraseña sin revelar si el correo existe', () => {
  assert.match(app, /id="ag-btn-recovery"/);
  assert.match(app, /resetPasswordForEmail\(email, \{ redirectTo: redirectTo \}\)/);
  assert.match(app, /Si ese correo está registrado/);
  assert.match(app, /qp\.get\('recovery'\) === '1'/);
  assert.match(app, /updateUser\(\{ password: p1 \}\)/);
});

test('una suscripción vencida conserva el acceso y no cierra la sesión', () => {
  assert.match(app, /suscripcionVencida = Boolean/);
  assert.match(app, /Tu plan necesita renovación/);
  assert.doesNotMatch(app, /if \(new Date\(tenantData\.vence_en\) < new Date\(\)\) \{ alert\([^}]+cerrarSesion\(\)/);
});

test('la cuenta suspendida continúa bloqueada', () => {
  assert.match(app, /if \(!tenantData\.activo\).*cerrarSesion\(\)/);
});

test('la copia móvil conserva exactamente el mismo flujo de acceso', () => {
  assert.equal(mobile, app);
});
