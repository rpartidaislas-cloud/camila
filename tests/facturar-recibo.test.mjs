import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  REGIMENES as CORE_REGIMENES, D01_REGIMENES as CORE_D01, FISCAL_SCHEMA, archivoValido, evaluarTopeFiscal, topesDeEntorno,
  leerConstancia, normalizarNombre as coreNombre, rfcValido, codigoDeRegimen, FISCAL_EXTRACT_MODEL,
} from '../supabase/functions/_shared/fiscal-core.mjs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sandbox = { window: undefined };
sandbox.globalThis = sandbox;
vm.runInNewContext(read('smyl-fiscal-rules.js'), sandbox);
const R = sandbox.SmylFiscalRules;

test('RFC: física 13, moral 12, fecha real, sin genéricos', () => {
  assert.equal(R.validarRfc('mupj800229ab1').ok, true);
  assert.equal(R.validarRfc('MUPJ800230AB1').ok, false);
  assert.equal(R.validarRfc('XAXX010101000').ok, false);
  assert.match(R.validarRfc('XEXX010101000').error, /genérico/);
  assert.equal(R.validarRfc('ABC800101AB1').tipo, 'M');
  assert.equal(R.validarRfc('ABC800101AB').ok, false);
  assert.equal(R.validarRfc('').ok, false);
});

test('nombre: como en la constancia (mayúsculas, sin acentos, conserva Ñ y sin régimen societario)', () => {
  assert.equal(R.normalizarNombre('José Muñoz Pérez', 'F'), 'JOSE MUÑOZ PEREZ');
  assert.equal(R.normalizarNombre('Constructora Peña, S.A. de C.V.', 'M'), 'CONSTRUCTORA PEÑA');
  assert.equal(R.normalizarNombre('Dental Norte SA DE CV', 'M'), 'DENTAL NORTE');
  assert.equal(R.normalizarNombre('Clínica Sonrisa S. de R.L. de C.V.', 'M'), 'CLINICA SONRISA');
  assert.equal(R.normalizarNombre('Asociación Dental A.C.', 'M'), 'ASOCIACION DENTAL');
  assert.equal(R.normalizarNombre('Ana SA', 'F'), 'ANA SA'); // en una persona física no se recorta nada
});

test('perfil: régimen según tipo de persona, CP de 5 dígitos y D01 solo donde el SAT lo permite', () => {
  const base = { rfc: 'MUPJ800229AB1', legal_name: 'José Muñoz Pérez', fiscal_regime: '612', tax_postal_code: '72000', cfdi_use: 'D01', email: 'a@b.mx' };
  assert.equal(R.validarPerfil(base).ok, true);
  assert.equal(R.validarPerfil(base).clean.legal_name, 'JOSE MUÑOZ PEREZ');
  assert.ok(R.validarPerfil(Object.assign({}, base, { fiscal_regime: '601' })).errors.fiscal_regime);
  assert.ok(R.validarPerfil(Object.assign({}, base, { tax_postal_code: '7200' })).errors.tax_postal_code);
  assert.ok(R.validarPerfil(Object.assign({}, base, { fiscal_regime: '626' })).errors.cfdi_use, 'RESICO no deduce D01');
  assert.equal(R.validarPerfil(Object.assign({}, base, { fiscal_regime: '626', cfdi_use: 'G03' })).ok, true);
  assert.ok(R.validarPerfil(Object.assign({}, base, { rfc: 'ABC800101AB1', fiscal_regime: '601' })).errors.cfdi_use, 'persona moral no usa D01');
  assert.ok(R.validarPerfil(Object.assign({}, base, { email: 'mal' })).errors.email);
  assert.ok(R.validarPerfil(Object.assign({}, base, { email: '' })).warnings.some((w) => /correo/i.test(w)));
  assert.equal(R.perfilListo(null), false);
  assert.equal(R.perfilListo(base), true);
});

test('menús: los usos y regímenes ofrecidos son los que el SAT aceptaría', () => {
  assert.deepEqual(Array.from(R.usosParaRegimen('626', 'MUPJ800229AB1'), (u) => u.code), ['G03', 'S01']);
  assert.deepEqual(Array.from(R.usosParaRegimen('612', 'MUPJ800229AB1'), (u) => u.code), ['D01', 'G03', 'S01']);
  assert.ok(R.regimenesParaTipo('M').every((r) => R.REGIMENES[r.code].tipos.includes('M')));
  assert.ok(!R.regimenesParaTipo('F').some((r) => r.code === '601'));
});

test('el navegador y la función de IA usan el mismo catálogo y las mismas reglas', () => {
  assert.deepEqual(Object.keys(R.REGIMENES).sort(), Object.keys(CORE_REGIMENES).sort());
  for (const code of Object.keys(R.REGIMENES)) assert.equal(R.REGIMENES[code].tipos, CORE_REGIMENES[code], code);
  assert.deepEqual([...R.D01_REGIMENES].sort(), [...CORE_D01].sort());
  for (const [name, tipo] of [['José Muñoz', 'F'], ['Peña, S.A. de C.V.', 'M'], ['Dental Norte S. de R.L. de C.V.', 'M'], ['Ana SA', 'F'], ['Asociación A.C.', 'M']]) assert.equal(R.normalizarNombre(name, tipo), coreNombre(name, tipo), name);
  for (const rfc of ['MUPJ800229AB1', 'MUPJ800230AB1', 'ABC800101AB1', 'XAXX010101000', 'AB800101AB1']) assert.equal(R.validarRfc(rfc).ok, rfcValido(rfc), rfc);
});

test('constancia: la sugerencia se normaliza y nunca inventa lo que no se leyó', () => {
  const ok = leerConstancia(JSON.stringify({ is_constancia: true, legible: true, rfc: 'mupj 800229 ab1', legal_name: 'José Muñoz Pérez', tax_postal_code: '72000', fiscal_regimes: ['Régimen de Actividades Empresariales y Profesionales'], email: 'a@b.mx' }));
  assert.equal(ok.rfc, 'MUPJ800229AB1');
  assert.equal(ok.legal_name, 'JOSE MUÑOZ PEREZ');
  assert.equal(ok.fiscal_regime, '612');
  assert.equal(ok.suggested_cfdi_use, 'D01');
  assert.deepEqual(ok.warnings, []);
  const resico = leerConstancia(JSON.stringify({ is_constancia: true, legible: true, rfc: 'MUPJ800229AB1', legal_name: 'X Y', tax_postal_code: '72000', fiscal_regimes: ['Régimen Simplificado de Confianza'], email: '' }));
  assert.equal(resico.fiscal_regime, '626');
  assert.equal(resico.suggested_cfdi_use, 'G03');
  const varios = leerConstancia(JSON.stringify({ is_constancia: true, legible: true, rfc: 'MUPJ800229AB1', legal_name: 'X Y', tax_postal_code: '72000', fiscal_regimes: ['Sueldos y Salarios', 'Arrendamiento'], email: '' }));
  assert.equal(varios.fiscal_regime, '');
  assert.deepEqual(varios.fiscal_regimes, ['605', '606']);
  const mala = leerConstancia(JSON.stringify({ is_constancia: true, legible: false, rfc: 'XAXX010101000', legal_name: '', tax_postal_code: '7200', fiscal_regimes: [], email: 'no' }));
  assert.equal(mala.rfc, '');
  assert.equal(mala.tax_postal_code, '');
  assert.equal(mala.email, '');
  assert.ok(mala.warnings.length >= 3);
  assert.equal(leerConstancia(JSON.stringify({ is_constancia: false })).is_constancia, false);
  assert.equal(leerConstancia('no es json'), null);
  assert.equal(codigoDeRegimen('626 Régimen Simplificado de Confianza'), '626');
  // régimen de moral descartado si el RFC es de persona física
  const cruzado = leerConstancia(JSON.stringify({ is_constancia: true, legible: true, rfc: 'MUPJ800229AB1', legal_name: 'X Y', tax_postal_code: '72000', fiscal_regimes: ['General de Ley Personas Morales'], email: '' }));
  assert.equal(cruzado.fiscal_regime, '');
});

test('archivo y topes: PDF/JPG/PNG acotados; la IA tiene tope diario y mensual', () => {
  const b64 = 'A'.repeat(200);
  assert.equal(archivoValido(b64, 'application/pdf'), true);
  assert.equal(archivoValido(b64, 'image/png'), true);
  assert.equal(archivoValido(b64, 'image/webp'), false);
  assert.equal(archivoValido('data:application/pdf;base64,' + b64, 'application/pdf'), false);
  assert.equal(archivoValido('A'.repeat(6_000_001), 'application/pdf'), false);
  const topes = topesDeEntorno({ get: () => undefined });
  assert.equal(evaluarTopeFiscal(topes.diario, 0, topes).permitido, false);
  assert.equal(evaluarTopeFiscal(0, topes.mensual, topes).permitido, false);
  assert.equal(evaluarTopeFiscal(1, 1, topes).permitido, true);
  assert.equal(FISCAL_EXTRACT_MODEL, 'claude-haiku-5-5');
  assert.equal(FISCAL_SCHEMA.additionalProperties, false);
});

test('la función exige JWT y finance.manage, mide el consumo y no guarda el archivo', () => {
  const fn = read('supabase/functions/fiscal-extract/index.ts');
  assert.match(read('supabase/config.toml'), /\[functions\.fiscal-extract\]\s*\nverify_jwt = true/);
  assert.match(fn, /p_permission: "finance\.manage"/);
  assert.match(fn, /feature: "fiscal_extract"/);
  assert.doesNotMatch(fn, /storage|\.upsert\(|smyl_patient_fiscal_profiles/);
  assert.match(read('supabase/migrations/20261117140000_smyl_fiscal_extract.sql'), /'cloud_classify', 'fiscal_extract'/);
});

test('Cobros: «Facturar» en el recibo, alta de datos fiscales al vuelo y continuación al guardar', () => {
  const js = read('smyl-finance.js');
  assert.match(js, /data-success-invoice>Facturar/);
  assert.match(js, /inv\.onclick=function\(\)\{d\.close\(\);startInvoice\(payment\);\}/);
  assert.match(js, /function startInvoice\(payment\)/);
  assert.match(js, /if\(fiscalReady\(payment\.patient_id\)\)return prepareCfdi\(payment\)/);
  assert.match(js, /openFiscal\(payment\.patient_id,function\(\)\{return prepareCfdi\(payment\);\}\)/);
  assert.match(js, /window\.SmylFiscalCapture\.open\(/);
  const ui = read('smyl-fiscal-capture.js');
  assert.match(ui, /invoke\('fiscal-extract'/);
  assert.match(ui, /from\('smyl_patient_fiscal_profiles'\)\.upsert\(row\)/);
  assert.match(ui, /El archivo no se guarda/);
});

test('publicación: scripts cargados antes de Cobros y copias de móvil idénticas', () => {
  for (const html of ['app.html', 'mobile/www/app.html']) {
    const page = read(html);
    assert.ok(page.indexOf('smyl-fiscal-rules.js?v=2') < page.indexOf('smyl-fiscal-capture.js?v=1'));
    assert.ok(page.indexOf('smyl-fiscal-capture.js?v=1') < page.indexOf('smyl-finance.js?v=51'));
  }
  for (const sw of ['sw.js', 'mobile/www/sw.js']) assert.match(read(sw), /smyl-fiscal-rules\.js\?v=2[\s\S]*smyl-fiscal-capture\.js\?v=1/);
  for (const f of ['smyl-fiscal-rules.js', 'smyl-fiscal-capture.js', 'smyl-finance.js', 'smyl-finance.css']) assert.equal(read(f), read('mobile/www/' + f), f);
});
