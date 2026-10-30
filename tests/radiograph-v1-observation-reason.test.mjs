// Cuando la IA devuelve una observación fuera del contrato, la pantalla debe decir CUÁL campo falló
// (antes decía solo "Observación radiográfica no válida."). El contrato sigue igual de estricto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../smyl-radiograph-review-model.js');

const obs = (cambios = {}) => Object.assign({ id: 'r1', category: 'density', tooth: null, observation: 'Zona radiopaca aparente por comprobar.', evidence: 'Región posterior derecha.' }, cambios);
const informe = (observations) => ({ schema: 1, quality: 'usable', qualityNote: 'Imagen utilizable.', observations, limitations: [] });
const motivo = (o, extra = []) => { try { M.parseReport(informe([...extra, o])); return null; } catch (e) { return e.message; } };

test('el informe válido sigue aceptándose, también con diente FDI y null', () => {
  assert.doesNotThrow(() => M.parseReport(informe([obs(), obs({ id: 'r2', tooth: '11' })])));
});

test('cada incumplimiento dice qué campo falló y cita r# y el valor recortado', () => {
  const casos = [
    [obs({ tooth: '' }), /\(r1\): diente "" no es un número FDI válido ni null/],
    [obs({ tooth: 'región anterior' }), /diente "región anterior" no es un número FDI/],
    [obs({ tooth: '18-28' }), /diente "18-28"/],
    [obs({ tooth: 99 }), /diente number/],
    [obs({ category: 'caries' }), /categoría "caries" no permitida/],
    [obs({ observation: 'x'.repeat(501) }), /observación vacía o de más de 500 caracteres \(501\)/],
    [obs({ observation: '   ' }), /observación vacía/],
    [obs({ evidence: 'e'.repeat(301) }), /evidencia vacía o de más de 300 caracteres \(301\)/],
    [obs({ evidence: '' }), /evidencia vacía/],
    [obs({ id: 'r13' }), /id "r13" fuera de r1 a r12/],
    [Object.assign(obs(), { extra: 1 }), /campos distintos de los esperados \(.*extra/],
  ];
  for (const [o, re] of casos) {
    const m = motivo(o);
    assert.match(m, /^Observación radiográfica no válida/, JSON.stringify(o).slice(0, 60));
    assert.match(m, re, JSON.stringify(o).slice(0, 80));
  }
});

test('un id repetido se identifica', () => {
  assert.match(motivo(obs({ id: 'r1' }), [obs({ id: 'r1' })]), /\(r1\): id repetido/);
});

test('lo que cita la IA se limpia y se recorta antes de mostrarse', () => {
  const m = motivo(obs({ tooth: '<img src=x onerror=alert(1)>'.repeat(5) }));
  assert.doesNotMatch(m, /[<>=]/);
  assert.ok(m.length < 220, 'mensaje acotado: ' + m.length);
});

test('relajar el contrato no es parte de este cambio: sigue rechazando lo mismo que antes', () => {
  for (const o of [obs({ tooth: '' }), obs({ tooth: 'región anterior' }), obs({ category: 'caries' }), obs({ observation: 'x'.repeat(501) })]) {
    assert.throws(() => M.parseReport(informe([o])), /no válida/);
  }
});
