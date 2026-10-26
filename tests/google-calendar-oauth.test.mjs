import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const fn = read('../supabase/functions/google-calendar-oauth/index.ts');
const migration = read('../supabase/migrations/20261026160000_smyl_google_calendar_oauth.sql');
const client = read('../smyl-google-calendar.js');
const styles = read('../smyl-google-calendar.css');
const app = read('../app.html');
const worker = read('../sw.js');
const config = read('../supabase/config.toml');

test('OAuth de Google Calendar usa autorización servidor, PKCE y estado de un solo uso', () => {
  assert.match(fn, /https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  assert.match(fn, /https:\/\/oauth2\.googleapis\.com\/token/);
  assert.match(fn, /code_challenge_method", "S256"/);
  assert.match(fn, /state_hash/);
  assert.match(fn, /\.is\("used_at", null\)/);
  assert.match(fn, /10 \* 60 \* 1000/);
  assert.match(fn, /access_type", "offline"/);
  assert.match(fn, /prompt", "consent"/);
});

test('tokens y credenciales quedan fuera del navegador', () => {
  assert.match(fn, /GOOGLE_CALENDAR_CLIENT_SECRET/);
  assert.match(fn, /GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY/);
  assert.match(fn, /GOOGLE_CALENDAR_OAUTH_READY/);
  assert.match(fn, /GOOGLE_GMAIL_CLIENT_ID/);
  assert.match(fn, /GOOGLE_GMAIL_CLIENT_SECRET/);
  assert.match(fn, /AES-GCM/);
  assert.match(migration, /refresh_token_ciphertext text not null/);
  assert.match(migration, /revoke all on table public\.smyl_google_calendar_connections from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select, insert, update, delete on table public\.smyl_google_calendar_connections to service_role/);
  assert.doesNotMatch(client, /refresh_token|client_secret|GOOGLE_CALENDAR_CLIENT_SECRET/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
});

test('la conexión exige sesión y permiso de configuración aunque el callback sea público', () => {
  assert.match(config, /\[functions\.google-calendar-oauth\][\s\S]*verify_jwt = false/);
  assert.match(fn, /const auth = await requireUser\(req, cors\)/);
  assert.match(fn, /p_permission: "settings\.manage"/);
  assert.match(fn, /if \(req\.method === "GET"\) return callback\(req\)/);
  assert.match(fn, /safeReturnUrl/);
});

test('la primera autorización pide el scope mínimo de eventos', () => {
  assert.match(fn, /https:\/\/www\.googleapis\.com\/auth\/calendar\.events/);
  assert.doesNotMatch(fn, /auth\/calendar"/);
  assert.match(fn, /calendar_id: "primary"/);
});

test('Agenda muestra una conexión verificable, accesible y sin prometer sincronización antes de tiempo', () => {
  assert.match(client, /schedule-google-calendar/);
  assert.match(client, /aria-haspopup/);
  assert.match(client, /Acceso autorizado/);
  assert.match(client, /preparar la sincronización segura/);
  assert.match(client, /No se enviarán notas clínicas a Google/);
  assert.match(styles, /\.google-calendar-dialog::backdrop/);
  assert.match(styles, /@media\(max-width:560px\)/);
});

test('web, PWA y caché cargan la misma integración', () => {
  assert.match(app, /smyl-google-calendar\.css\?v=1/);
  assert.match(app, /smyl-google-calendar\.js\?v=1/);
  assert.match(worker, /smyl-google-calendar\.css\?v=1/);
  assert.match(worker, /smyl-google-calendar\.js\?v=1/);
  assert.equal(client, read('../mobile/www/smyl-google-calendar.js'));
  assert.equal(styles, read('../mobile/www/smyl-google-calendar.css'));
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(worker, read('../mobile/www/sw.js'));
});

