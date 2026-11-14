import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const model = require('../smyl-evidence-model.js');
const workspaceSource = readFileSync(new URL('../smyl-evidence-workspace.js', import.meta.url), 'utf8');

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.className = '';
    this.textContent = '';
    this.classList = {
      add: (...names) => {
        const next = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach(name => next.add(name));
        this.className = Array.from(next).join(' ');
      }
    };
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const data = selector.match(/^\[data-([a-z-]+)="([^"]+)"\]$/);
    if (data) {
      const key = data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return this.dataset[key] === data[2];
    }
    const attribute = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    return attribute ? this.getAttribute(attribute[1]) === attribute[2] : false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = node => {
      node.children.forEach(child => {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }
}

const document = { createElement: tagName => new FakeElement(tagName) };
const window = { document, SmylEvidenceModel: model };
vm.runInNewContext(workspaceSource, { window, document }, { filename: 'smyl-evidence-workspace.js' });
const workspace = window.SmylEvidenceWorkspace;

test('el modelo define un solo contrato transversal para todas las modalidades', () => {
  assert.deepEqual(model.WORKSPACE_PHASES.map(phase => phase.key), [
    'original', 'quality', 'suggestions', 'decision', 'history'
  ]);
  assert.deepEqual(model.WORKSPACE_PHASES.map(phase => phase.label), [
    'Original', 'Calidad', 'Sugerencias', 'Decisión', 'Historial'
  ]);
  assert.deepEqual(model.WORKSPACE_PHASE_STATES, ['pending', 'current', 'complete', 'skipped', 'error']);
  assert.deepEqual(model.ANALYSIS_STATES, ['pending', 'running', 'ready', 'failed', 'unsupported']);
});

test('cada modalidad comparte el gobierno pero conserva su visor y analizador especializados', () => {
  assert.deepEqual(Object.keys(model.MODALITY_CAPABILITIES), model.MODALITIES);

  const photo = model.getModalityCapabilities('photograph');
  const radiograph = model.getModalityCapabilities('radiograph_2d');
  assert.equal(photo.analysis, true);
  assert.equal(radiograph.analysis, true);
  assert.notEqual(photo.viewer, radiograph.viewer);
  assert.equal(model.getModalityCapabilities('document').analysis, false);
  assert.equal(model.getModalityCapabilities('document').history, true);

  for (const modality of ['scan_model', 'clinical_measurement', 'cbct_3d']) {
    const capability = model.getModalityCapabilities(modality);
    assert.equal(capability.analysis, false, modality);
    assert.notEqual(capability.viewer, photo.viewer, modality);
  }
  assert.equal(model.getModalityCapabilities('unknown'), null);

  photo.analysis = false;
  assert.equal(model.MODALITY_CAPABILITIES.photograph.analysis, true, 'la consulta no debe mutar el contrato compartido');
});

test('la mesa visual consume exactamente las mismas fases del contrato clínico', () => {
  assert.deepEqual(
    Array.from(workspace.phases, phase => ({ key: phase.key, label: phase.label })),
    Array.from(model.WORKSPACE_PHASES, phase => ({ key: phase.key, label: phase.label }))
  );
  for (const modality of model.MODALITIES) {
    assert.deepEqual(
      { ...workspace.getCapabilities(modality) },
      model.getModalityCapabilities(modality),
      modality
    );
  }
  assert.equal(workspace.getCapabilities('unknown'), null);
});

test('el progreso expone cinco fases accesibles y nunca más de una fase actual', () => {
  const progress = workspace.createProgress({
    document,
    states: { original: 'current', quality: 'current', suggestions: 'invalid' }
  });

  assert.equal(progress.tagName, 'OL');
  assert.equal(progress.getAttribute('aria-label'), 'Progreso de la revisión clínica');
  assert.equal(progress.children.length, 5);
  assert.equal(progress.querySelectorAll('[aria-current="step"]').length, 1);
  assert.ok(['original', 'quality'].includes(progress.dataset.currentPhase));
  assert.equal(progress.querySelector('[data-phase="suggestions"]').dataset.state, 'pending');

  workspace.setProgress(progress, {
    original: 'complete',
    quality: 'complete',
    suggestions: 'skipped',
    decision: 'current',
    history: 'pending'
  });
  assert.equal(progress.dataset.currentPhase, 'decision');
  assert.equal(progress.querySelector('[data-phase="suggestions"]').querySelector('.smyl-ew-progress__status').textContent, 'Omitido');
  assert.equal(progress.querySelectorAll('[aria-current="step"]').length, 1);
});

test('fotografía traduce sus estados existentes al ciclo compartido sin confirmar por IA', () => {
  const cases = [
    [{}, { quality: 'current' }],
    [{ quality: 'usable', analyzing: true }, { suggestions: 'current' }],
    [{ quality: 'usable', findings: 3, pending: 2 }, { decision: 'current' }],
    [{ quality: 'unusable' }, { suggestions: 'skipped', decision: 'current' }],
    [{ quality: 'usable', failed: true }, { suggestions: 'error', decision: 'pending' }],
    [{ quality: 'limited', closed: true }, { decision: 'complete', history: 'current' }]
  ];

  for (const [input, expected] of cases) {
    const result = workspace.photoProgress(input);
    assert.deepEqual(Object.keys(result), model.WORKSPACE_PHASES.map(phase => phase.key));
    assert.ok(Object.values(result).filter(value => value === 'current').length <= 1);
    Object.values(result).forEach(value => assert.ok(model.WORKSPACE_PHASE_STATES.includes(value), value));
    Object.entries(expected).forEach(([phase, value]) => assert.equal(result[phase], value, JSON.stringify(input)));
  }
});

test('la decoración identifica la modalidad sin alterar el contenido clínico', () => {
  const node = new FakeElement('section');
  const returned = workspace.decorate(node, 'photograph');
  assert.equal(returned, node);
  assert.match(node.className, /smyl-evidence-workspace/);
  assert.equal(node.dataset.evidenceModality, 'photograph');
});

test('los errores repetidos se consolidan por operación y no saturan la interfaz', () => {
  const errors = workspace.dedupeErrors([
    { operation: 'radiograph_upload', code: 'loader', message: 'No se pudo abrir el cargador.' },
    { operation: 'radiograph_upload', code: 'loader', message: 'No se pudo abrir el cargador.' },
    { operation: 'photo_analysis', code: 'loader', message: 'No se pudo abrir el cargador.' }
  ]);
  assert.equal(errors.length, 2);
  assert.equal(errors.find(error => error.operation === 'radiograph_upload').count, 2);
  assert.equal(errors.find(error => error.operation === 'photo_analysis').count, 1);

  const feedback = new FakeElement('p');
  assert.equal(workspace.setFeedback(feedback, { key: 'load:radiograph', tone: 'error', message: 'No se pudo abrir.' }), true);
  assert.equal(workspace.setFeedback(feedback, { key: 'load:radiograph', tone: 'error', message: 'No se pudo abrir.' }), false);
  assert.equal(feedback.textContent, 'No se pudo abrir.');
  assert.equal(feedback.dataset.feedbackCount, '2');
});
