/* Reglas del SAT para los datos fiscales del RECEPTOR (el paciente) en un CFDI 4.0.
 * Solo valida y normaliza texto; no consulta al SAT. El PAC (Facturapi) vuelve a validar contra el padrón del SAT al timbrar.
 * Fuentes: Anexo 20 y catálogos c_RegimenFiscal / c_UsoCFDI del SAT. Si el SAT cambia un catálogo, se actualiza aquí y en
 * supabase/functions/_shared/fiscal-core.mjs (un test compara ambos). */
(function (root) {
  'use strict';
  // F = persona física, M = persona moral.
  var REGIMENES = {
    '601': { name: 'General de Ley Personas Morales', tipos: 'M' },
    '603': { name: 'Personas Morales con Fines no Lucrativos', tipos: 'M' },
    '605': { name: 'Sueldos y Salarios e Ingresos Asimilados a Salarios', tipos: 'F' },
    '606': { name: 'Arrendamiento', tipos: 'F' },
    '607': { name: 'Régimen de Enajenación o Adquisición de Bienes', tipos: 'F' },
    '608': { name: 'Demás ingresos', tipos: 'F' },
    '610': { name: 'Residentes en el Extranjero sin Establecimiento Permanente en México', tipos: 'FM' },
    '611': { name: 'Ingresos por Dividendos (socios y accionistas)', tipos: 'F' },
    '612': { name: 'Personas Físicas con Actividades Empresariales y Profesionales', tipos: 'F' },
    '614': { name: 'Ingresos por intereses', tipos: 'F' },
    '615': { name: 'Régimen de los ingresos por obtención de premios', tipos: 'F' },
    '616': { name: 'Sin obligaciones fiscales', tipos: 'F' },
    '620': { name: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos', tipos: 'M' },
    '621': { name: 'Incorporación Fiscal', tipos: 'F' },
    '622': { name: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras', tipos: 'FM' },
    '623': { name: 'Opcional para Grupos de Sociedades', tipos: 'M' },
    '624': { name: 'Coordinados', tipos: 'M' },
    '625': { name: 'Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', tipos: 'F' },
    '626': { name: 'Régimen Simplificado de Confianza', tipos: 'FM' }
  };
  // Usos que se ofrecen para pacientes. D01 solo aplica a personas físicas con estos regímenes (columna «Régimen fiscal receptor» de c_UsoCFDI).
  var USOS = [
    { code: 'D01', label: 'Honorarios médicos y dentales (lo deduce el paciente)' },
    { code: 'G03', label: 'Gastos en general' },
    { code: 'S01', label: 'Sin efectos fiscales' }
  ];
  var D01_REGIMENES = ['605', '606', '607', '608', '611', '612', '614', '615', '625'];
  var RFC_GENERICOS = ['XAXX010101000', 'XEXX010101000'];

  function tipoPersona(rfc) {
    var n = String(rfc || '').trim().length;
    return n === 13 ? 'F' : n === 12 ? 'M' : '';
  }
  function fechaValida(yy, mm, dd) {
    var year = Number(yy) + (Number(yy) <= 30 ? 2000 : 1900), month = Number(mm), day = Number(dd);
    if (month < 1 || month > 12 || day < 1) return false;
    var limit = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= limit;
  }
  function normalizarRfc(value) { return String(value || '').toUpperCase().replace(/[\s-]/g, ''); }
  function validarRfc(value) {
    var rfc = normalizarRfc(value);
    if (!rfc) return { ok: false, error: 'Escribe el RFC.' };
    if (RFC_GENERICOS.indexOf(rfc) !== -1) return { ok: false, rfc: rfc, error: 'Ese es un RFC genérico (público en general o extranjero). Para facturar a un paciente usa su RFC real.' };
    var m = /^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z0-9]{3})$/.exec(rfc);
    if (!m) return { ok: false, rfc: rfc, error: 'El RFC debe tener 13 caracteres (persona física) o 12 (persona moral), sin espacios.' };
    if (!fechaValida(m[2], m[3], m[4])) return { ok: false, rfc: rfc, error: 'La fecha dentro del RFC no es válida. Revisa que coincida con la constancia.' };
    return { ok: true, rfc: rfc, tipo: tipoPersona(rfc) };
  }

  // Régimen societario que NO debe ir en el nombre del receptor (CFDI 4.0: se escribe como en la constancia, sin «S.A. de C.V.», etc.).
  var SOCIETARIO = /[\s,.]+(S\.?\s?A\.?\s?P\.?\s?I\.?(\s+DE\s+C\.?\s?V\.?)?|S\.?\s?A\.?\s+DE\s+C\.?\s?V\.?|S\.?\s?A\.?\s?B\.?\s+DE\s+C\.?\s?V\.?|S\.?\s+DE\s+R\.?\s?L\.?(\s+DE\s+C\.?\s?V\.?)?|S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|S\.?\s?C\.?|A\.?\s?C\.?|S\.?\s?C\.?\s?P\.?|S\.?\s+EN\s+C\.?(\s+POR\s+A\.?)?|S\.?\s+EN\s+N\.?\s?C\.?)\s*$/;
  function normalizarNombre(value, tipo) {
    var text = String(value || '').toUpperCase().replace(/Ñ/g, '\u0001').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\u0001/g, 'Ñ');
    text = text.replace(/[^A-Z0-9Ñ&.,'\- ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (tipo === 'M') { var cut = text.replace(SOCIETARIO, '').trim(); if (cut.length >= 2) text = cut; }
    return text;
  }

  // Reglas del perfil: { errors: {campo: mensaje}, warnings: [texto], clean: valores normalizados }.
  function validarPerfil(p) {
    p = p || {};
    var errors = {}, warnings = [];
    var r = validarRfc(p.rfc), tipo = r.tipo || tipoPersona(normalizarRfc(p.rfc));
    if (!r.ok) errors.rfc = r.error;
    var nombre = normalizarNombre(p.legal_name, tipo);
    if (nombre.length < 2) errors.legal_name = 'Escribe el nombre o razón social tal como aparece en la constancia.';
    else if (String(p.legal_name || '').trim() && nombre !== String(p.legal_name).trim().toUpperCase()) warnings.push('El nombre se escribirá «' + nombre + '» (mayúsculas, sin acentos' + (tipo === 'M' ? ' y sin el régimen societario' : '') + '), igual que en la constancia.');
    var regimen = String(p.fiscal_regime || '').trim();
    if (!/^\d{3}$/.test(regimen) || !REGIMENES[regimen]) errors.fiscal_regime = 'Elige el régimen fiscal de la constancia.';
    else if (tipo && REGIMENES[regimen].tipos.indexOf(tipo) === -1) errors.fiscal_regime = tipo === 'F' ? 'Ese régimen es de personas morales; el RFC corresponde a una persona física.' : 'Ese régimen es de personas físicas; el RFC corresponde a una persona moral.';
    var cp = String(p.tax_postal_code || '').trim();
    if (!/^\d{5}$/.test(cp)) errors.tax_postal_code = 'El código postal fiscal tiene 5 dígitos (el del domicilio fiscal de la constancia).';
    var uso = String(p.cfdi_use || '').trim().toUpperCase();
    if (!/^[A-Z]\d{2}$/.test(uso)) errors.cfdi_use = 'Elige el uso de la factura.';
    else if (uso === 'D01' && !errors.fiscal_regime && (tipo !== 'F' || D01_REGIMENES.indexOf(regimen) === -1)) errors.cfdi_use = 'D01 (honorarios médicos y dentales) solo aplica a personas físicas con un régimen que pueda deducirlos. Usa «Gastos en general» (G03).';
    var email = String(p.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Revisa el correo.';
    if (!email) warnings.push('Sin correo no se podrá enviar la factura al paciente por email.');
    return { ok: Object.keys(errors).length === 0, errors: errors, warnings: warnings, clean: { rfc: r.rfc || normalizarRfc(p.rfc), legal_name: nombre, fiscal_regime: regimen, tax_postal_code: cp, cfdi_use: uso, email: email, tipo: tipo } };
  }
  // ¿Se puede preparar la factura con lo que ya hay guardado?
  function perfilListo(profile) { return Boolean(profile) && validarPerfil(profile).ok; }
  // Opciones de uso compatibles con el régimen elegido (para que el menú no ofrezca lo que el SAT rechazaría).
  function usosParaRegimen(regimen, rfc) {
    var tipo = tipoPersona(normalizarRfc(rfc));
    return USOS.filter(function (u) { return u.code !== 'D01' || ((!tipo || tipo === 'F') && D01_REGIMENES.indexOf(String(regimen)) !== -1); });
  }
  function regimenesParaTipo(tipo) {
    return Object.keys(REGIMENES).filter(function (code) { return !tipo || REGIMENES[code].tipos.indexOf(tipo) !== -1; }).map(function (code) { return { code: code, name: REGIMENES[code].name }; });
  }

  var api = { REGIMENES: REGIMENES, USOS: USOS, D01_REGIMENES: D01_REGIMENES, tipoPersona: tipoPersona, validarRfc: validarRfc, normalizarRfc: normalizarRfc, normalizarNombre: normalizarNombre, validarPerfil: validarPerfil, perfilListo: perfilListo, usosParaRegimen: usosParaRegimen, regimenesParaTipo: regimenesParaTipo };
  root.SmylFiscalRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
