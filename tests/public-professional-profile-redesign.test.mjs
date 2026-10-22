import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const exists = (path) => fs.existsSync(new URL(path, import.meta.url));

const profile = read('../dentista.html');
const profileCss = read('../smyl-public-profile.css');
const designCss = read('../smyl-design-system-v2.css');
const mobileProfile = read('../mobile/www/dentista.html');
const sw = read('../sw.js');
const mobileSw = read('../mobile/www/sw.js');

function inlineClassicScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/application\/ld\+json/i.test(match[1]))
    .map((match) => match[2]);
}

function cssVariables(source) {
  return {
    declared: new Set([...source.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1])),
    used: [...source.matchAll(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g)].map((match) => ({
      name: match[1],
      hasFallback: Boolean(match[2] && match[2].trim()),
    })),
  };
}

test('el perfil público mantiene sintaxis ejecutable y hojas de estilo disponibles', () => {
  const scripts = inlineClassicScripts(profile);
  assert.ok(scripts.length, 'dentista.html debe conservar al menos un script clásico inline');
  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(() => new Function(source), `script inline ${index + 1} con sintaxis inválida`);
  }

  assert.match(profile, /<link rel="stylesheet" href="\.\/smyl-design-system-v2\.css\?v=2"\s*\/>/);
  assert.match(profile, /<link rel="stylesheet" href="\.\/smyl-public-profile\.css\?v=\d+"\s*\/>/);
  assert.ok(exists('../smyl-design-system-v2.css'));
  assert.ok(exists('../smyl-public-profile.css'));
  assert.match(profile, /<style id="smyl-public-profile-legacy" media="not all">/,
    'el CSS legado sólo puede permanecer temporalmente si está desactivado');
});

test('las variables CSS del perfil están declaradas, heredadas o tienen fallback', () => {
  const own = cssVariables(profileCss);
  const design = cssVariables(designCss);
  const declared = new Set([...own.declared, ...design.declared]);
  const missing = own.used
    .filter((usage) => !declared.has(usage.name) && !usage.hasFallback)
    .map((usage) => usage.name);
  assert.deepEqual([...new Set(missing)], []);
});

test('la política visual clínica evita recursos decorativos prohibidos', () => {
  assert.doesNotMatch(profileCss, /linear-gradient\(/i, 'los paneles públicos no deben usar degradados decorativos');
  assert.doesNotMatch(profileCss, /font-weight\s*:\s*(?:620|650|680|750|800|900)\b/,
    'la política permite pesos 400, 500, 600 y 700');
  assert.match(profileCss, /:focus-visible\s*\{/);
  assert.match(profileCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(profileCss, /@media\s*\(max-width:\s*820px\)/);
  assert.match(profileCss, /@media\s*\(max-width:\s*520px\)/);
  assert.match(profileCss, /\.appointment (?:input|input,)[\s\S]*?font-size:\s*16px/,
    'los campos móviles deben evitar el zoom automático');
});

test('el formulario sólo aparece cuando el perfil está verificado y tiene profesional, servicios y sedes disponibles', () => {
  assert.match(profile, /canRequest\s*=\s*Boolean\(p\.verified_profile\s*&&\s*p\.accepts_new_patients\s*&&\s*services\.length\s*&&\s*locations\.length\)/);
  assert.match(profile, /function bookingMarkup\(p, services, locations, phone, canRequest\)/);
  assert.match(profile, /if \(!canRequest\)[\s\S]*?request-unavailable/);
  assert.match(profile, /Servicios en actualización/);
  assert.match(profile, /Ubicación por confirmar/);
  assert.match(profile, /Solicitudes temporalmente no disponibles/);
});

test('la solicitud envía las preferencias y el consentimiento del formulario actual', () => {
  for (const field of ['requested_date', 'requested_period', 'preferred_contact']) {
    assert.match(profile, new RegExp(`${field}: data\\.get\\("${field}"\\)`), `falta enviar ${field}`);
  }
  assert.match(profile, /privacy_consent:\s*data\.get\("privacy_consent"\)\s*===\s*"on"/);
  assert.doesNotMatch(profile, /requested_start:\s*data\.get\("requested_start"\)/,
    'el formulario ya no captura una hora exacta');
});

test('Turnstile se monta explícitamente después de renderizar el paso de contacto', () => {
  assert.match(profile, /turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(profile, /window\.turnstile\.render\(container/);
  assert.match(profile, /if \(current === 2\) renderTurnstile\(\)/);
  assert.match(profile, /id="appointment-turnstile"/);
  assert.doesNotMatch(profile, /class="cf-turnstile"/,
    'el modo implícito puede perder widgets insertados después de cargar el script');
});

test('la navegación por pasos y las respuestas dinámicas son accesibles', () => {
  assert.match(profile, /<a class="skip-link" href="#app">/);
  assert.match(profile, /<main id="app">/);
  assert.match(profile, /id="form-error"[^>]*role="alert"[^>]*aria-live="assertive"/);
  assert.match(profile, /class="review-rating" aria-label="/);
  assert.match(profile, /id="share-status"[^>]*(?:role="status"|aria-live="polite")/,
    'copiar el enlace debe anunciarse sin mover el foco');
  for (const step of [1, 2, 3]) {
    assert.match(profile, new RegExp(`<h3 id="booking-step-${step}" tabindex="-1">`),
      `el encabezado del paso ${step} debe ser programáticamente enfocable`);
  }
  assert.match(profile, /steps\[current\]\.querySelector\("h3"\)\.focus/);
  assert.match(profileCss, /\.honeypot\s*\{[^}]*clip-path:\s*inset\(50%\)/s,
    'el honeypot debe quedar fuera de la presentación visual');
});

test('web y PWA distribuyen exactamente el mismo perfil y sus estilos', () => {
  assert.ok(exists('../mobile/www/smyl-public-profile.css'), 'falta la hoja nueva en mobile/www');
  const mobileCss = read('../mobile/www/smyl-public-profile.css');
  assert.equal(profile, mobileProfile);
  assert.equal(profileCss, mobileCss);
  for (const worker of [sw, mobileSw]) {
    assert.match(worker, /\/camila\/dentista\.html/);
    assert.match(worker, /\/camila\/smyl-public-profile\.css\?v=\d+/);
    assert.match(worker, /\/camila\/smyl-design-system-v2\.css\?v=2/);
  }
  assert.equal(sw, mobileSw);
});
