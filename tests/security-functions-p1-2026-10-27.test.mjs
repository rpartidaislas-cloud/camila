// Auditoría 2026-10-26, P1: membresía activa, permisos por rol, SSRF y pisado de máscaras.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const loadTs = (file) => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(read(file))).toString('base64'));

const { decidirMembresia } = await loadTs('supabase/functions/_shared/auth-membership.ts');
const safety = await loadTs('supabase/functions/_shared/request-safety.ts');

test('membresía: un staff desactivado no resuelve ninguna clínica', () => {
  const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.deepEqual(decidirMembresia({ tenant_id: 'T1', activo: false }, uid), { inactivo: true });
  assert.deepEqual(decidirMembresia({ tenant_id: 'T1', activo: true }, uid), { tenantId: 'T1' });
  assert.deepEqual(decidirMembresia({ tenant_id: 'T1', activo: null }, uid), { tenantId: 'T1' });
  // el dueño de siempre no necesita fila: su id es el tenant
  assert.deepEqual(decidirMembresia(null, uid), { tenantId: uid });
  assert.deepEqual(decidirMembresia(undefined, uid), { tenantId: uid });
});

test('auth.ts usa decidirMembresia, responde 403 al desactivado y exige permisos fallando cerrado', () => {
  const auth = read('supabase/functions/_shared/auth.ts');
  assert.match(auth, /select\('tenant_id, activo'\)/);
  assert.match(auth, /'inactivo' in membresia[\s\S]{0,400}status: 403/);
  assert.match(auth, /export async function requirePermission/);
  assert.match(auth, /smyl_actor_has_permission_explicit/);
  assert.match(auth, /if \(auth\.user\.id === auth\.tenantId\) return null;/); // el dueño pasa
  assert.match(auth, /if \(error\) \{[\s\S]{0,200}reply\(503/); // falla cerrado
  assert.match(auth, /if \(data !== true\) return reply\(403/);
});

for (const [fn, permiso] of [
  ['meta-send', 'messages.respond'],
  ['mila-transcribe', 'clinical.write'],
  ['mila-realtime-session', 'clinical.write'],
  ['sign-segmentation-masks', 'clinical.read'],
  ['lana-webhook', 'clinical.write'],
]) {
  test(`${fn} exige el permiso ${permiso}`, () => {
    const src = read(`supabase/functions/${fn}/index.ts`);
    assert.match(src, /requirePermission/);
    assert.match(src, new RegExp(`requirePermission\\(auth, ?CORS, ?["']${permiso.replace('.', '\\.')}["']\\)`));
    // el permiso se exige antes de cualquier trabajo con datos
    assert.ok(src.indexOf('requirePermission(auth') < src.indexOf('await req.'), 'el permiso va antes de leer el body');
    const bundle = read(`docs/bundles/${fn}.single-file.ts`);
    assert.match(bundle, new RegExp(`requirePermission\\(auth, ?CORS, ?["']${permiso.replace('.', '\\.')}["']\\)`));
  });
}

test('lana-webhook ya no menciona un fallback anónimo inexistente', () => {
  assert.doesNotMatch(read('supabase/functions/lana-webhook/index.ts'), /conserva un fallback anónimo/);
});

test('constantTimeEqual compara secretos sin cortar en el primer byte', () => {
  const { constantTimeEqual } = safety;
  assert.equal(constantTimeEqual('secreto-largo-123', 'secreto-largo-123'), true);
  assert.equal(constantTimeEqual('secreto-largo-123', 'secreto-largo-124'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual('', 'x'), false);
});

test('isAllowedRemoteUrl solo acepta https de hosts permitidos (anti-SSRF)', () => {
  const { isAllowedRemoteUrl, parseAllowedHostSuffixes } = safety;
  const suf = parseAllowedHostSuffixes('');
  assert.deepEqual(suf, ['.supabase.co']);
  for (const ok of [
    'https://abcdefgh.supabase.co/storage/v1/object/sign/camila-fotos/x.png?token=t',
    'https://proyecto.supabase.co/functions/v1/smyl-webhook',
  ]) assert.equal(isAllowedRemoteUrl(ok, suf), true, ok);
  for (const malo of [
    'http://abcdefgh.supabase.co/x',                     // sin TLS
    'https://169.254.169.254/latest/meta-data/',        // metadatos de la nube
    'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x',
    'https://10.0.0.5/x', 'https://servicio.internal/x',
    'https://supabase.co.evil.com/x',                    // sufijo falso
    'https://evilsupabase.co/x',
    'https://user:pass@abcdefgh.supabase.co/x',          // credenciales en la URL
    'https://abcdefgh.supabase.co:8443/x',               // puerto no estándar
    'file:///etc/passwd', 'ftp://x.supabase.co/x', 'javascript:alert(1)', '',
    'https://' + 'a'.repeat(5000) + '.supabase.co/',
  ]) assert.equal(isAllowedRemoteUrl(malo, suf), false, String(malo).slice(0, 60));
  assert.equal(isAllowedRemoteUrl(undefined, suf), false);
  assert.equal(isAllowedRemoteUrl({ href: 'https://a.supabase.co' }, suf), false);
});

test('los hosts extra se configuran por entorno y se validan', () => {
  const { parseAllowedHostSuffixes, isAllowedRemoteUrl } = safety;
  const suf = parseAllowedHostSuffixes('img.mi-cdn.com, .otro.mx, no es host, ;;;');
  assert.deepEqual(suf, ['.supabase.co', '.img.mi-cdn.com', '.otro.mx']);
  assert.equal(isAllowedRemoteUrl('https://a.img.mi-cdn.com/x.jpg', suf), true);
  assert.equal(isAllowedRemoteUrl('https://mi-cdn.com/x.jpg', suf), false);
});

test('isAllowedImageSource acepta data URL de imagen o https permitido, nada más', () => {
  const { isAllowedImageSource, parseAllowedHostSuffixes } = safety;
  const suf = parseAllowedHostSuffixes('');
  assert.equal(isAllowedImageSource('data:image/png;base64,iVBORw0KGgo=', suf), true);
  assert.equal(isAllowedImageSource('data:image/jpeg;base64,/9j/4AAQ', suf), true);
  assert.equal(isAllowedImageSource('data:image/svg+xml;base64,PHN2Zz4=', suf), false);
  assert.equal(isAllowedImageSource('data:text/html;base64,PHNjcmlwdD4=', suf), false);
  assert.equal(isAllowedImageSource('https://a.supabase.co/x.png', suf), true);
  assert.equal(isAllowedImageSource('https://evil.com/x.png', suf), false);
  assert.equal(isAllowedImageSource('data:image/png;base64,' + 'A'.repeat(40), suf, 30), false); // tope de tamaño
});

test('readBodyWithLimit rechaza respuestas demasiado grandes', async () => {
  const { readBodyWithLimit } = safety;
  const ok = new Response(new Uint8Array(10));
  assert.equal((await readBodyWithLimit(ok, 100)).byteLength, 10);
  await assert.rejects(() => readBodyWithLimit(new Response(new Uint8Array(200)), 100), /demasiado grande/);
  await assert.rejects(() => readBodyWithLimit(new Response('x', { headers: { 'content-length': '999999' } }), 100), /demasiado grande/);
});

test('segment-teeth: valida el origen de la imagen y no pisa máscaras de otra clínica', () => {
  const src = read('supabase/functions/segment-teeth/index.ts');
  assert.match(src, /isAllowedImageSource\(imageUrl, SUFIJOS_IMAGEN_PERMITIDOS\)/);
  assert.match(src, /fetch\(imageUrl, \{ redirect: "error" \}\)/);
  assert.match(src, /readBodyWithLimit\(response\)/);
  assert.match(src, /UUID_CASO_RE\.test\(casoId\)/);
  assert.match(src, /casoExistente\.tenant_id !== tenantId/);
  // un anónimo (prospecto) no puede tocar casos reales de la clínica
  assert.match(src, /!user && casoExistente\.es_prospecto !== true/);
  // la verificación ocurre antes de empezar a generar
  assert.ok(src.indexOf('Ese caso no está disponible') < src.indexOf('const responseStream'));
});

test('analizar-foto: secreto en tiempo constante, entradas validadas y simulación firmada', () => {
  const src = read('supabase/functions/analizar-foto/index.ts');
  assert.match(src, /!constantTimeEqual\(tokenEntrante, LANA_API_KEY\)/);
  assert.doesNotMatch(src, /tokenEntrante !== LANA_API_KEY/);
  assert.match(src, /UUID_RE\.test\(tenant_id\)/);
  assert.match(src, /isAllowedRemoteUrl\(imagen_url, SUFIJOS_PERMITIDOS\)/);
  assert.match(src, /isAllowedRemoteUrl\(callback_url, SUFIJOS_PERMITIDOS\)/);
  assert.match(src, /fetch\(imagen_url, \{ redirect: "error" \}\)/);
  assert.match(src, /createSignedUrl\(path, SIMULACION_URL_SEGUNDOS\)/);
  // las validaciones van antes de lanzar la tarea de fondo
  assert.ok(src.indexOf('callback_url no es una URL permitida') < src.indexOf('const tarea = procesarFotoDental'));
});

test('los bundles que se pegan en el panel están al día con el código', () => {
  // invite-staff: el bundle debe traer el diseño vigente de invitaciones (smyl_staff_invitations)
  const fuente = read('supabase/functions/invite-staff/index.ts');
  const invite = read('docs/bundles/invite-staff.single-file.ts');
  assert.match(fuente, /smyl_staff_invitations/);
  assert.match(invite, /smyl_staff_invitations/);
  assert.match(invite, /decidirMembresia/);
  for (const name of fs.readdirSync(new URL('../docs/bundles/', import.meta.url))) {
    const text = read('docs/bundles/' + name);
    if (/_shared\/auth\.ts ──/.test(text)) assert.match(text, /decidirMembresia/, name + ' debe traer la membresía activa');
  }
});

test('las funciones públicas que se endurecieron tienen bundle actualizado', () => {
  const lead = read('docs/bundles/guardar-lead-prospecto.single-file.ts');
  assert.match(lead, /function validarFila/);
  assert.match(lead, /Ese identificador ya está en uso/);
  const foto = read('docs/bundles/analizar-foto.single-file.ts');
  assert.match(foto, /constantTimeEqual\(tokenEntrante, LANA_API_KEY\)/);
  assert.match(foto, /createSignedUrl\(path, SIMULACION_URL_SEGUNDOS\)/);
});
