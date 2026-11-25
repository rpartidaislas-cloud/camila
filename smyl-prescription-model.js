/* SMYL · Receta médica: modelo puro (sin DOM ni red).
 *
 * Refleja en el navegador las reglas que la función SQL smyl_issue_prescription aplica de forma AUTORITATIVA, para avisar antes de
 * enviar. Si ambas difieren, manda el servidor. IMPORTANTE: los requisitos salen de fuentes secundarias y no se han contrastado con
 * el texto oficial (docs/RECETA_REQUISITOS.md); las listas de antibióticos y controlados son una red de apoyo, NO una lista legal.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SmylPrescriptionModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_ITEMS = 12, ANTIBIOTIC_MAX_DAYS = 30;
  // Mismas listas que la función SQL (una prueba comprueba que no se desalineen).
  var CONTROLLED = ['morfina', 'codeina', 'fentanil', 'tramadol', 'buprenorfina', 'metadona', 'oxicodona', 'hidrocodona', 'meperidina',
    'petidina', 'tapentadol', 'nalbufina', 'diazepam', 'alprazolam', 'clonazepam', 'lorazepam', 'midazolam', 'bromazepam', 'clobazam', 'zolpidem',
    'fenobarbital', 'ketamina', 'metilfenidato', 'anfetamina', 'lisdexanfetamina'];
  var ANTIBIOTICS = ['amoxicilina', 'ampicilina', 'penicilina', 'dicloxacilina', 'cefalexina', 'cefadroxilo', 'cefuroxima', 'cefixima',
    'ceftriaxona', 'azitromicina', 'claritromicina', 'eritromicina', 'clindamicina', 'doxiciclina', 'tetraciclina', 'minociclina', 'metronidazol',
    'ciprofloxacino', 'levofloxacino', 'moxifloxacino', 'trimetoprima', 'sulfametoxazol', 'nitrofurantoina', 'gentamicina', 'amikacina', 'vancomicina'];
  // Familias para el aviso de alergias (orientativo; el criterio es del profesional).
  var FAMILIES = {
    penicilinas: ['penicilina', 'amoxicilina', 'ampicilina', 'dicloxacilina'],
    sulfonamidas: ['sulfa', 'sulfametoxazol', 'trimetoprima'],
    aines: ['aine', 'antiinflamatorio', 'ibuprofeno', 'naproxeno', 'ketorolaco', 'diclofenaco', 'aspirina', 'acido acetilsalicilico', 'meloxicam', 'nimesulida'],
    macrolidos: ['macrolido', 'azitromicina', 'claritromicina', 'eritromicina']
  };
  // Sugerencias para escribir más rápido. No son una recomendación terapéutica: el profesional decide.
  var SUGGESTIONS = ['Amoxicilina', 'Amoxicilina con ácido clavulánico', 'Clindamicina', 'Metronidazol', 'Azitromicina', 'Ibuprofeno', 'Paracetamol',
    'Naproxeno', 'Ketorolaco', 'Diclofenaco', 'Dexametasona', 'Clorhexidina'];
  var FORMS = ['tabletas', 'cápsulas', 'suspensión', 'solución', 'enjuague bucal', 'gel', 'crema', 'ampolleta', 'jarabe', 'gotas'];
  var ROUTES = ['oral', 'bucal (enjuague)', 'tópica', 'intramuscular', 'intravenosa', 'sublingual'];

  function norm(v) { return String(v == null ? '' : v).toLowerCase().replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i').replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n'); }
  function has(list, text) { return list.filter(function (term) { return text.indexOf(term) >= 0; }); }

  function classify(generic, brand) {
    var text = norm(generic) + ' ' + norm(brand);
    return { controlled: has(CONTROLLED, text), antibiotic: has(ANTIBIOTICS, text).length > 0 };
  }

  function len(v) { return String(v == null ? '' : v).trim().length; }

  // Mensajes iguales a los del servidor. `n` es el número de renglón (1..).
  function itemIssues(item, n) {
    item = item || {}; var out = [], c = classify(item.generic, item.brand), days = Number(item.duration_days);
    if (len(item.generic) < 2 || len(item.generic) > 120) out.push('Medicamento ' + n + ': escribe el nombre genérico.');
    if (len(item.form) < 2) out.push('Medicamento ' + n + ': indica la presentación (por ejemplo tabletas o cápsulas).');
    if (len(item.dose) < 1) out.push('Medicamento ' + n + ': indica la dosis.');
    if (len(item.route) < 2) out.push('Medicamento ' + n + ': indica la vía de administración.');
    if (len(item.frequency) < 2) out.push('Medicamento ' + n + ': indica la frecuencia.');
    if (len(item.quantity) < 1) out.push('Medicamento ' + n + ': indica la cantidad a surtir.');
    if (!Number.isInteger(days) || days < 1 || days > 365) out.push('Medicamento ' + n + ': indica la duración del tratamiento en días.');
    if (c.controlled.length) out.push('Medicamento ' + n + ' (' + String(item.generic || '').trim() + '): parece un medicamento controlado. SMYL no emite recetas con estupefacientes ni psicotrópicos; requieren el recetario especial.');
    else if (c.antibiotic && Number.isInteger(days) && days > ANTIBIOTIC_MAX_DAYS) out.push('Medicamento ' + n + ': los antibióticos no pueden recetarse por más de ' + ANTIBIOTIC_MAX_DAYS + ' días.');
    return out;
  }

  function issues(items, declared) {
    var list = Array.isArray(items) ? items : [], out = [];
    if (!list.length || list.length > MAX_ITEMS) out.push('La receta debe tener de 1 a ' + MAX_ITEMS + ' medicamentos.');
    list.forEach(function (item, i) { out = out.concat(itemIssues(item, i + 1)); });
    if (declared !== true) out.push('Confirma que la receta no incluye medicamentos controlados.');
    return out;
  }

  // Lo que se manda al servidor (solo los campos que la función conoce).
  function payload(items) {
    return (items || []).map(function (i) {
      return { generic: String(i.generic || '').trim(), brand: String(i.brand || '').trim(), strength: String(i.strength || '').trim(), form: String(i.form || '').trim(),
        dose: String(i.dose || '').trim(), route: String(i.route || '').trim(), frequency: String(i.frequency || '').trim(),
        duration_days: Number(i.duration_days), quantity: String(i.quantity || '').trim() };
    });
  }

  // Copia segura para preparar una receta nueva desde una receta anterior. La fila
  // emitida permanece inmutable: sólo se trasladan los campos editables al borrador.
  function draftItems(items) {
    var source = Array.isArray(items) ? items : [];
    return source.slice(0, MAX_ITEMS).map(function (i) {
      i = i && typeof i === 'object' ? i : {};
      var days = Number(i.duration_days);
      if (!Number.isInteger(days)) {
        var match = String(i.duration || '').match(/\d+/);
        days = match ? Number(match[0]) : '';
      }
      return {
        generic: String(i.generic || '').slice(0, 120), brand: String(i.brand || '').slice(0, 120),
        strength: String(i.strength || '').slice(0, 60), form: String(i.form || '').slice(0, 60),
        dose: String(i.dose || '').slice(0, 120), route: String(i.route || 'oral').slice(0, 60),
        frequency: String(i.frequency || '').slice(0, 80), duration_days: days,
        quantity: String(i.quantity || '').slice(0, 60)
      };
    });
  }

  function draftFromPrescription(row) {
    var snapshot = row && row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {};
    return {
      items: draftItems(snapshot.items),
      diagnosis: String(snapshot.diagnosis || '').slice(0, 240),
      indications: String(snapshot.indications || '').slice(0, 900)
    };
  }

  // Alergias del documento de la historia clínica: lista de sustancias + estado.
  function allergiesOf(doc) {
    doc = doc && typeof doc === 'object' ? doc : {};
    var names = [];
    (Array.isArray(doc.allergy_records) ? doc.allergy_records : []).forEach(function (r) { if (r && r.substance) names.push(String(r.substance).trim()); });
    (Array.isArray(doc.allergies) ? doc.allergies : []).forEach(function (a) { var s = typeof a === 'string' ? a : a && a.substance; if (s) names.push(String(s).trim()); });
    var seen = {}; names = names.filter(function (n) { var k = norm(n); if (!k || seen[k]) return false; seen[k] = 1; return true; });
    return { status: doc.allergies_status || 'pending', names: names };
  }

  // Avisos de alergia para los medicamentos escritos. Orientativo: coincidencia directa o misma familia.
  function allergyWarnings(items, allergy) {
    var out = [], names = (allergy && allergy.names) || [];
    (items || []).forEach(function (item, i) {
      var med = norm(item && item.generic) + ' ' + norm(item && item.brand);
      if (!med.trim()) return;
      names.forEach(function (name) {
        var a = norm(name), direct = a.length >= 4 && med.indexOf(a) >= 0, family = '';
        Object.keys(FAMILIES).forEach(function (key) {
          var f = FAMILIES[key], allergyIn = f.some(function (t) { return a.indexOf(t) >= 0; }), medIn = f.some(function (t) { return med.indexOf(t) >= 0; });
          if (allergyIn && medIn) family = key;
        });
        if (direct || family) out.push({ item: i + 1, allergy: name, reason: direct ? 'coincide con la alergia registrada' : 'pertenece a la misma familia (' + family + ')' });
      });
    });
    return out;
  }

  function allergyNote(allergy) {
    if (!allergy) return 'No se pudo consultar la historia clínica: pregunta al paciente por alergias.';
    if (allergy.names.length) return 'Alergias registradas: ' + allergy.names.join(', ') + '.';
    if (allergy.status === 'no') return 'La historia indica que el paciente no tiene alergias.';
    return 'Las alergias no están confirmadas en la historia clínica: pregunta al paciente.';
  }

  // Fila de smyl_prescriptions -> objeto que dibuja SmylPrescriptionPrint.
  function toSheet(row) {
    var s = row && row.snapshot ? row.snapshot : {};
    return { folio: s.folio || '', issued_at: s.issued_at || row.issued_at || '', professional: s.professional || {}, clinic: s.clinic || {}, patient: s.patient || {},
      diagnosis: s.diagnosis || '', items: Array.isArray(s.items) ? s.items : [], indications: s.indications || '', legends: [] };
  }

  return { MAX_ITEMS: MAX_ITEMS, ANTIBIOTIC_MAX_DAYS: ANTIBIOTIC_MAX_DAYS, CONTROLLED: CONTROLLED, ANTIBIOTICS: ANTIBIOTICS, FAMILIES: FAMILIES,
    SUGGESTIONS: SUGGESTIONS, FORMS: FORMS, ROUTES: ROUTES, norm: norm, classify: classify, itemIssues: itemIssues, issues: issues, payload: payload,
    draftItems: draftItems, draftFromPrescription: draftFromPrescription, allergiesOf: allergiesOf, allergyWarnings: allergyWarnings,
    allergyNote: allergyNote, toSheet: toSheet };
});
