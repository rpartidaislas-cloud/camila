(function () {
  'use strict';

  var STORAGE_KEY = 'smyl_editor_v2_design';
  var IDS = ['13', '12', '11', '21', '22', '23'];
  var ROLE_NAMES = { central: 'Central', lateral: 'Lateral', canine: 'Canino' };
  var SHAPE_NAMES = { 'rectangular-soft': 'Rectangular suave', oval: 'Ovalada', triangular: 'Triangular' };
  var VITA_COLORS = { B1: '#f4edda', A1: '#eee2c7', B2: '#ead9b8', D2: '#e2d1b9', A2: '#dfc8a4' };
  var defaultMaterial = { vita: 'A1', value: 0, chroma: 0, translucency: 35, texture: 'natural' };
  var ROLE_END = { central: 20.2, lateral: 18.2, canine: 18.5 };
  var SHAPE_ROLE_WIDTH = {
    'rectangular-soft': { central: 12.2, lateral: 10.2, canine: 10 },
    oval: { central: 12, lateral: 10.2, canine: 10 },
    triangular: { central: 11.8, lateral: 10, canine: 9.8 }
  };
  var PATHS = {
    'rectangular-soft': {
      central: 'M -5.4 0 C -3.8 -1.4 3.8 -1.4 5.4 0 C 6.1 4.5 6.1 13.6 5.2 18.4 C 3.7 20.2 -3.7 20.2 -5.2 18.4 C -6.1 13.6 -6.1 4.5 -5.4 0 Z',
      lateral: 'M -4.4 0 C -3.2 -1.2 3.2 -1.2 4.4 0 C 5.1 4.2 5 12.3 4.2 16.8 C 2.9 18.2 -2.9 18.2 -4.2 16.8 C -5 12.3 -5.1 4.2 -4.4 0 Z',
      canine: 'M -4.3 0 C -2.9 -1 2.9 -1 4.3 0 C 5 4.1 4.8 11.6 3.7 15.2 C 2.5 16.1 1.3 17.5 0 18.5 C -1.3 17.5 -2.5 16.1 -3.7 15.2 C -4.8 11.6 -5 4.1 -4.3 0 Z'
    },
    oval: {
      central: 'M -4.7 0 C -3.2 -1.5 3.2 -1.5 4.7 0 C 6 4.8 5.8 13.9 4.5 18.1 C 2.8 20.4 -2.8 20.4 -4.5 18.1 C -5.8 13.9 -6 4.8 -4.7 0 Z',
      lateral: 'M -3.9 0 C -2.6 -1.3 2.6 -1.3 3.9 0 C 5.1 4.4 4.9 12.3 3.8 16.6 C 2.5 18.4 -2.5 18.4 -3.8 16.6 C -4.9 12.3 -5.1 4.4 -3.9 0 Z',
      canine: 'M -3.9 0 C -2.5 -1.1 2.5 -1.1 3.9 0 C 5 4.2 4.7 11.8 3.4 15 C 2.3 16 1.2 17.4 0 18.5 C -1.2 17.4 -2.3 16 -3.4 15 C -4.7 11.8 -5 4.2 -3.9 0 Z'
    },
    triangular: {
      central: 'M -3.8 0 C -2.8 -1.1 2.8 -1.1 3.8 0 C 4.8 5.2 5.9 14.7 5.2 18.5 C 3.6 20.1 -3.6 20.1 -5.2 18.5 C -5.9 14.7 -4.8 5.2 -3.8 0 Z',
      lateral: 'M -3.2 0 C -2.2 -1 2.2 -1 3.2 0 C 4.1 4.9 5 13.2 4.2 16.8 C 2.9 18.2 -2.9 18.2 -4.2 16.8 C -5 13.2 -4.1 4.9 -3.2 0 Z',
      canine: 'M -3.2 0 C -2.1 -.9 2.1 -.9 3.2 0 C 4.1 4.8 4.9 12.1 3.8 15.1 C 2.5 16.1 1.3 17.5 0 18.5 C -1.3 17.5 -2.5 16.1 -3.8 15.1 C -4.9 12.1 -4.1 4.8 -3.2 0 Z'
    }
  };

  var defaults = [
    tooth('13', 'canine', 'right', 20.8, 63.7, 9.6, 25.6, -4),
    tooth('12', 'lateral', 'right', 31.7, 64.8, 9.3, 24.4, -2),
    tooth('11', 'central', 'right', 43.8, 63.2, 12.1, 30, -0.5),
    tooth('21', 'central', 'left', 56.2, 63.2, 12.1, 30, 0.5),
    tooth('22', 'lateral', 'left', 68.3, 64.8, 9.3, 24.4, 2),
    tooth('23', 'canine', 'left', 79.2, 63.7, 9.6, 25.6, 4)
  ];

  function tooth(id, role, side, x, y, width, height, rotation) {
    return {
      id: id, role: role, side: side, x: x, y: y, width: width, height: height,
      rotation: rotation, shape: 'rectangular-soft', material: clone(defaultMaterial),
      gingivalAnchor: { x: 0.5, y: 0 }, incisalAnchor: { x: 0.5, y: 1 }
    };
  }

  var defaultGuides = { incisalCenter: 93.5, incisalArc: 4.5, gingivalCenter: 63.2, gingivalArc: 2.2, red: 70 };
  var state = { schema: 'smyl.veneer-design', version: 4, updatedAt: null, selectedId: '11', teeth: clone(defaults), guides: clone(defaultGuides) };
  var drag = null;

  var svg = document.getElementById('design-svg');
  var layer = document.getElementById('teeth-layer');
  var guidesLayer = document.getElementById('guides-layer');
  var photo = document.getElementById('patient-photo');
  var demoBg = document.getElementById('demo-bg');
  var statusEl = document.getElementById('status');
  var widthControl = document.getElementById('width-control');
  var heightControl = document.getElementById('height-control');
  var rotationControl = document.getElementById('rotation-control');

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function selected() { return state.teeth.find(function (t) { return t.id === state.selectedId; }); }
  function original(id) { return defaults.find(function (t) { return t.id === id; }); }
  function esc(value) { return String(value).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  function materialColors(material) {
    var hex = VITA_COLORS[material.vita] || VITA_COLORS.A1;
    var rgb = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
    var average = (rgb[0] + rgb[1] + rgb[2]) / 3;
    var saturation = 1 + material.chroma / 55;
    rgb = rgb.map(function (value) { return clamp((average + (value - average) * saturation) + material.value * 2.3, 0, 255); });
    function tone(offset) { return 'rgb(' + rgb.map(function (value) { return Math.round(clamp(value + offset, 0, 255)); }).join(',') + ')'; }
    return { light: tone(13), middle: tone(0), dark: tone(-22) };
  }

  function isModified(t) {
    var d = original(t.id);
    return t.shape !== d.shape || JSON.stringify(t.material) !== JSON.stringify(d.material) || ['x','y','width','height','rotation'].some(function (key) { return Math.abs(t[key] - d[key]) > 0.001; });
  }

  function guideTarget(kind, x) {
    var normalized = Math.min(1, Math.abs(x - 50) / 30);
    var curve = normalized * normalized;
    return kind === 'incisal'
      ? state.guides.incisalCenter - state.guides.incisalArc * curve
      : state.guides.gingivalCenter + state.guides.gingivalArc * curve;
  }

  function applyGuides() {
    state.teeth.forEach(function (t) {
      var gingival = guideTarget('gingival', t.x);
      var incisal = guideTarget('incisal', t.x);
      t.y = gingival;
      t.height = Math.max(8, (incisal - gingival) * 20 / ROLE_END[t.role]);
    });
  }

  function actualHalfWidth(t) {
    return SHAPE_ROLE_WIDTH[t.shape][t.role] * t.width / 22;
  }

  function smoothPath(points) {
    if (!points.length) return '';
    var d = 'M ' + points[0].x.toFixed(2) + ' ' + points[0].y.toFixed(2);
    for (var i = 1; i < points.length - 1; i++) {
      var midX = (points[i].x + points[i + 1].x) / 2;
      var midY = (points[i].y + points[i + 1].y) / 2;
      d += ' Q ' + points[i].x.toFixed(2) + ' ' + points[i].y.toFixed(2) + ' ' + midX.toFixed(2) + ' ' + midY.toFixed(2);
    }
    var last = points[points.length - 1];
    d += ' T ' + last.x.toFixed(2) + ' ' + last.y.toFixed(2);
    return d;
  }

  function renderGuides() {
    var ordered = state.teeth.slice().sort(function (a, b) { return a.x - b.x; });
    var gingivalPoints = ordered.map(function (t) { return { x: t.x, y: guideTarget('gingival', t.x) }; });
    var incisalPoints = ordered.map(function (t) { return { x: t.x, y: guideTarget('incisal', t.x) }; });
    var boundaries = [ordered[0].x - actualHalfWidth(ordered[0])];
    for (var i = 0; i < ordered.length - 1; i++) {
      var rightEdge = ordered[i].x + actualHalfWidth(ordered[i]);
      var leftEdge = ordered[i + 1].x - actualHalfWidth(ordered[i + 1]);
      boundaries.push((rightEdge + leftEdge) / 2);
    }
    boundaries.push(ordered[ordered.length - 1].x + actualHalfWidth(ordered[ordered.length - 1]));
    var top = Math.min.apply(null, gingivalPoints.map(function (p) { return p.y; })) - 4;
    var bottom = Math.max.apply(null, incisalPoints.map(function (p) { return p.y; })) + 4;
    var html = '<path class="clinical-curve gingival" d="' + smoothPath(gingivalPoints) + '"></path>' +
      '<path class="clinical-curve incisal" d="' + smoothPath(incisalPoints) + '"></path>';
    gingivalPoints.forEach(function (p) { html += '<circle class="curve-point gingival" cx="' + p.x + '" cy="' + p.y + '" r=".8"></circle>'; });
    incisalPoints.forEach(function (p) { html += '<circle class="curve-point incisal" cx="' + p.x + '" cy="' + p.y + '" r=".8"></circle>'; });
    boundaries.forEach(function (x, index) { html += '<line class="proportion-line" x1="' + x.toFixed(2) + '" y1="' + top.toFixed(2) + '" x2="' + x.toFixed(2) + '" y2="' + bottom.toFixed(2) + '"></line><text class="guide-label" x="' + x.toFixed(2) + '" y="' + (top - 1).toFixed(2) + '">' + (index + 1) + '</text>'; });
    guidesLayer.innerHTML = html;
  }

  function render() {
    renderGuides();
    var materialDefs = state.teeth.map(function (t) {
      var colors = materialColors(t.material);
      return '<linearGradient id="enamel-' + t.id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + colors.light + '"/><stop offset=".56" stop-color="' + colors.middle + '"/><stop offset="1" stop-color="' + colors.dark + '"/></linearGradient>';
    }).join('');
    layer.innerHTML = '<defs>' + materialDefs + '</defs>' + state.teeth.map(function (t) {
      var selectedClass = t.id === state.selectedId ? ' selected' : '';
      var modifiedClass = isModified(t) ? ' modified' : '';
      var sx = t.width / 11;
      var sy = t.height / 20;
      // Las anatomías de esta etapa son simétricas. No reflejamos el grupo
      // completo porque también invertiría etiquetas y puntos de control.
      var transform = 'translate(' + t.x + ' ' + t.y + ') rotate(' + t.rotation + ') scale(' + sx + ' ' + sy + ')';
      var path = PATHS[t.shape][t.role];
      return '<g class="tooth' + selectedClass + modifiedClass + '" data-id="' + esc(t.id) + '" tabindex="0" role="button" aria-label="Diente ' + esc(t.id) + ', ' + ROLE_NAMES[t.role] + '" transform="' + transform + '">' +
        '<path class="shape" style="fill:url(#enamel-' + t.id + ')" d="' + path + '"></path>' +
        '<path class="incisal-layer" style="opacity:' + (t.material.translucency / 250).toFixed(3) + '" d="M -3.9 ' + (ROLE_END[t.role] - 1.3) + ' Q 0 ' + (ROLE_END[t.role] + .15) + ' 3.9 ' + (ROLE_END[t.role] - 1.3) + '"></path>' +
        '<path class="inner" style="opacity:' + (t.material.texture === 'smooth' ? '.18' : t.material.texture === 'characterized' ? '.9' : '.55') + '" d="M -3.1 2 C -1.2 1.1 1.2 1.1 3.1 2 M -3.5 5.2 C -2.5 8.2 -2.4 13.4 -1.5 17 M 3.5 5.2 C 2.5 8.2 2.4 13.4 1.5 17"></path>' +
        (t.material.texture === 'characterized' ? '<path class="material-texture" d="M -3.8 7 Q -2.8 7.5 -2 7 M -4 10 Q -3 10.6 -2.1 10 M 2 7 Q 2.8 7.5 3.7 7 M 2.1 10 Q 3 10.6 3.9 10 M -2.8 14 Q 0 13.2 2.8 14"></path>' : '') +
        '<path class="selection" d="' + path + '"></path>' +
        '<circle class="anchor" cx="0" cy="0" r="1.05" fill="#55d8a3" stroke="#07100d" stroke-width=".35"></circle>' +
        '<circle class="anchor" cx="0" cy="' + (t.role === 'central' ? '19.2' : t.role === 'lateral' ? '17.4' : '18') + '" r="1.05" fill="#f3b84f" stroke="#130d04" stroke-width=".35"></circle>' +
        '<text class="tooth-label" x="0" y="10">' + esc(t.id) + '</text></g>';
    }).join('');
    renderList();
    syncControls();
    syncGuideControls();
    syncShapeControls();
    syncMaterialControls();
  }

  function renderList() {
    document.getElementById('teeth-list').innerHTML = state.teeth.map(function (t) {
      return '<button type="button" class="tooth-select' + (t.id === state.selectedId ? ' active' : '') + (isModified(t) ? ' modified' : '') + '" data-select="' + t.id + '">' + t.id + '</button>';
    }).join('');
  }

  function syncControls() {
    var t = selected();
    var d = original(t.id);
    var widthPct = Math.round(t.width / d.width * 100);
    var heightPct = Math.round(t.height / d.height * 100);
    widthControl.value = widthPct;
    heightControl.value = heightPct;
    rotationControl.value = t.rotation;
    document.getElementById('width-output').textContent = widthPct + '%';
    document.getElementById('height-output').textContent = heightPct + '%';
    document.getElementById('rotation-output').textContent = Number(t.rotation).toFixed(1) + '°';
    document.getElementById('selected-name').textContent = t.id + ' · ' + ROLE_NAMES[t.role];
  }

  function syncGuideControls() {
    var bindings = [
      ['incisal-center', 'incisalCenter', 'incisal-center-output', ''],
      ['incisal-arc', 'incisalArc', 'incisal-arc-output', ''],
      ['gingival-center', 'gingivalCenter', 'gingival-center-output', ''],
      ['gingival-arc', 'gingivalArc', 'gingival-arc-output', ''],
      ['red-control', 'red', 'red-output', '%']
    ];
    bindings.forEach(function (binding) {
      var value = state.guides[binding[1]];
      document.getElementById(binding[0]).value = value;
      document.getElementById(binding[2]).textContent = Number(value).toFixed(binding[1] === 'red' ? 0 : 1) + binding[3];
    });
  }

  function syncShapeControls() {
    document.querySelectorAll('[data-shape]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.shape === selected().shape);
      button.setAttribute('aria-pressed', button.dataset.shape === selected().shape ? 'true' : 'false');
    });
  }

  function syncMaterialControls() {
    var material = selected().material;
    document.querySelectorAll('[data-vita]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.vita === material.vita);
      button.setAttribute('aria-pressed', button.dataset.vita === material.vita ? 'true' : 'false');
    });
    document.querySelectorAll('[data-texture]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.texture === material.texture);
      button.setAttribute('aria-pressed', button.dataset.texture === material.texture ? 'true' : 'false');
    });
    [['value-control','value','value-output'],['chroma-control','chroma','chroma-output'],['translucency-control','translucency','translucency-output']].forEach(function (binding) {
      document.getElementById(binding[0]).value = material[binding[1]];
      document.getElementById(binding[2]).textContent = (material[binding[1]] > 0 && binding[1] !== 'translucency' ? '+' : '') + material[binding[1]] + (binding[1] === 'translucency' ? '%' : '');
    });
  }

  function select(id) {
    if (IDS.indexOf(id) === -1) return;
    state.selectedId = id;
    render();
  }

  function pointerPosition(event) {
    var point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }

  svg.addEventListener('pointerdown', function (event) {
    var node = event.target.closest('.tooth');
    if (!node) return;
    event.preventDefault();
    select(node.dataset.id);
    var p = pointerPosition(event);
    var t = selected();
    drag = { pointerId: event.pointerId, dx: p.x - t.x, dy: p.y - t.y };
    node.classList.add('dragging');
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener('pointermove', function (event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    var p = pointerPosition(event);
    var t = selected();
    t.x = clamp(p.x - drag.dx, 5, 95);
    t.y = clamp(p.y - drag.dy, 8, 88);
    render();
  });

  function endDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    render();
    setStatus('Pieza ' + state.selectedId + ' movida. El resto del diseño no cambió.');
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  document.getElementById('teeth-list').addEventListener('click', function (event) {
    var button = event.target.closest('[data-select]');
    if (button) select(button.dataset.select);
  });

  widthControl.addEventListener('input', function () {
    var t = selected(), d = original(t.id);
    t.width = d.width * Number(this.value) / 100;
    render();
  });
  heightControl.addEventListener('input', function () {
    var t = selected(), d = original(t.id);
    t.height = d.height * Number(this.value) / 100;
    render();
  });
  rotationControl.addEventListener('input', function () {
    selected().rotation = Number(this.value);
    render();
  });

  [
    ['incisal-center', 'incisalCenter'],
    ['incisal-arc', 'incisalArc'],
    ['gingival-center', 'gingivalCenter'],
    ['gingival-arc', 'gingivalArc']
  ].forEach(function (binding) {
    document.getElementById(binding[0]).addEventListener('input', function () {
      state.guides[binding[1]] = Number(this.value);
      applyGuides();
      render();
      setStatus('Curvas clínicas aplicadas a las seis piezas superiores.');
    });
  });

  document.getElementById('red-control').addEventListener('input', function () {
    state.guides.red = Number(this.value);
    render();
  });

  document.getElementById('apply-red').addEventListener('click', function () {
    var ratio = state.guides.red / 100;
    var centrals = state.teeth.filter(function (t) { return t.role === 'central'; });
    var centralVisualWidth = centrals.reduce(function (sum, t) { return sum + actualHalfWidth(t) * 2; }, 0) / centrals.length;
    var targetVisual = {
      central: centralVisualWidth,
      lateral: centralVisualWidth * ratio,
      canine: centralVisualWidth * ratio * ratio
    };
    state.teeth.forEach(function (t) { t.width = targetVisual[t.role] * 11 / SHAPE_ROLE_WIDTH[t.shape][t.role]; });

    var byId = {};
    state.teeth.forEach(function (t) { byId[t.id] = t; });
    byId['11'].x = 50 - targetVisual.central / 2;
    byId['21'].x = 50 + targetVisual.central / 2;
    byId['12'].x = byId['11'].x - (targetVisual.central + targetVisual.lateral) / 2;
    byId['22'].x = byId['21'].x + (targetVisual.central + targetVisual.lateral) / 2;
    byId['13'].x = byId['12'].x - (targetVisual.lateral + targetVisual.canine) / 2;
    byId['23'].x = byId['22'].x + (targetVisual.lateral + targetVisual.canine) / 2;
    applyGuides();
    render();
    setStatus('Proporción RED ' + state.guides.red + '% aplicada de forma simétrica: centrales, laterales y caninos.');
  });

  document.getElementById('reset-guides').addEventListener('click', function () {
    state.guides = clone(defaultGuides);
    applyGuides();
    render();
    setStatus('Guías clínicas restauradas y reaplicadas.');
  });

  document.getElementById('shape-options').addEventListener('click', function (event) {
    var button = event.target.closest('[data-shape]');
    if (!button || !PATHS[button.dataset.shape]) return;
    selected().shape = button.dataset.shape;
    render();
    setStatus('Pieza ' + state.selectedId + ': familia ' + SHAPE_NAMES[button.dataset.shape].toLowerCase() + '.');
  });

  document.getElementById('apply-shape-all').addEventListener('click', function () {
    var shape = selected().shape;
    state.teeth.forEach(function (t) { t.shape = shape; });
    render();
    setStatus('Familia ' + SHAPE_NAMES[shape].toLowerCase() + ' aplicada de forma simétrica a 13–23.');
  });

  document.getElementById('vita-options').addEventListener('click', function (event) {
    var button = event.target.closest('[data-vita]');
    if (!button || !VITA_COLORS[button.dataset.vita]) return;
    selected().material.vita = button.dataset.vita;
    render();
    setStatus('Pieza ' + state.selectedId + ': referencia VITA ' + button.dataset.vita + '.');
  });

  [['value-control','value'],['chroma-control','chroma'],['translucency-control','translucency']].forEach(function (binding) {
    document.getElementById(binding[0]).addEventListener('input', function () {
      selected().material[binding[1]] = Number(this.value);
      render();
      setStatus('Material de la pieza ' + state.selectedId + ' actualizado localmente.');
    });
  });

  document.getElementById('texture-options').addEventListener('click', function (event) {
    var button = event.target.closest('[data-texture]');
    if (!button) return;
    selected().material.texture = button.dataset.texture;
    render();
    setStatus('Textura de la pieza ' + state.selectedId + ' actualizada.');
  });

  document.getElementById('apply-material-all').addEventListener('click', function () {
    var material = clone(selected().material);
    state.teeth.forEach(function (t) { t.material = clone(material); });
    render();
    setStatus('Material VITA ' + material.vita + ' aplicado a las seis piezas.');
  });

  document.querySelector('.nudge-grid').addEventListener('click', function (event) {
    var button = event.target.closest('[data-nudge]');
    if (!button) return;
    var bits = button.dataset.nudge.split(',').map(Number);
    if (bits[0] === 0 && bits[1] === 0) {
      var d = original(state.selectedId), t = selected(); t.x = d.x; t.y = d.y;
    } else {
      selected().x = clamp(selected().x + bits[0], 5, 95);
      selected().y = clamp(selected().y + bits[1], 8, 88);
    }
    render();
  });

  document.getElementById('reset-tooth').addEventListener('click', function () {
    var index = state.teeth.findIndex(function (t) { return t.id === state.selectedId; });
    state.teeth[index] = clone(original(state.selectedId));
    render(); setStatus('Pieza ' + state.selectedId + ' restaurada.');
  });
  document.getElementById('reset-all').addEventListener('click', function () {
    state.teeth = clone(defaults); state.guides = clone(defaultGuides); state.selectedId = '11'; render(); setStatus('Diseño completo restaurado.');
  });

  document.getElementById('save-design').addEventListener('click', function () {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setStatus('Diseño guardado localmente a las ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '.');
  });
  document.getElementById('load-design').addEventListener('click', function () {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return setStatus('Todavía no existe un diseño guardado.');
    try { state = validate(JSON.parse(raw)); render(); setStatus('Diseño recuperado sin modificar la fotografía.'); }
    catch (error) { setStatus('El diseño guardado no es compatible: ' + error.message); }
  });
  document.getElementById('export-design').addEventListener('click', function () {
    state.updatedAt = new Date().toISOString();
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'smyl-diseno-' + Date.now() + '.json'; link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 500);
    setStatus('JSON exportado. No incluye la fotografía.');
  });
  document.getElementById('import-design').addEventListener('change', function () {
    var file = this.files && this.files[0]; if (!file) return;
    file.text().then(function (raw) { state = validate(JSON.parse(raw)); render(); setStatus('JSON importado correctamente.'); }).catch(function (error) { setStatus('No se pudo importar: ' + error.message); });
    this.value = '';
  });

  document.getElementById('photo-input').addEventListener('change', function () {
    var file = this.files && this.files[0]; if (!file) return;
    var url = URL.createObjectURL(file);
    photo.onload = function () {
      document.getElementById('canvas-shell').style.aspectRatio = photo.naturalWidth + ' / ' + photo.naturalHeight;
      demoBg.style.display = 'none'; photo.style.display = 'block'; URL.revokeObjectURL(url);
      setStatus('Fotografía abierta sólo en memoria. El lienzo respetó su proporción original.');
    };
    photo.src = url; this.value = '';
  });
  document.getElementById('clear-photo').addEventListener('click', function () {
    photo.removeAttribute('src'); photo.style.display = 'none'; demoBg.style.display = 'block';
    document.getElementById('canvas-shell').style.aspectRatio = '4 / 3';
    setStatus('Fotografía retirada del prototipo.');
  });

  document.addEventListener('keydown', function (event) {
    if (/^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
    var i = IDS.indexOf(state.selectedId);
    if (event.key === 'Tab') return;
    if (event.key === '[') { event.preventDefault(); select(IDS[(i + IDS.length - 1) % IDS.length]); }
    if (event.key === ']') { event.preventDefault(); select(IDS[(i + 1) % IDS.length]); }
    var amount = event.shiftKey ? 1 : 0.25;
    if (event.key === 'ArrowLeft') { selected().x -= amount; event.preventDefault(); render(); }
    if (event.key === 'ArrowRight') { selected().x += amount; event.preventDefault(); render(); }
    if (event.key === 'ArrowUp') { selected().y -= amount; event.preventDefault(); render(); }
    if (event.key === 'ArrowDown') { selected().y += amount; event.preventDefault(); render(); }
  });

  function validate(candidate) {
    if (!candidate || candidate.schema !== 'smyl.veneer-design' || !Array.isArray(candidate.teeth)) throw new Error('esquema desconocido');
    if (candidate.version === 1) {
      candidate.guides = clone(defaultGuides);
    }
    if (candidate.version === 1 || candidate.version === 2) {
      candidate.teeth.forEach(function (t) { if (!t.shape || t.shape === 'natural-soft') t.shape = 'rectangular-soft'; });
    }
    if (candidate.version >= 1 && candidate.version <= 3) {
      candidate.version = 4;
      candidate.teeth.forEach(function (t) {
        if (!t.shape || t.shape === 'natural-soft') t.shape = 'rectangular-soft';
        if (!t.material) t.material = clone(defaultMaterial);
      });
    }
    if (candidate.version !== 4) throw new Error('versión no compatible');
    if (candidate.teeth.length !== 6 || IDS.some(function (id) { return !candidate.teeth.some(function (t) { return t.id === id; }); })) throw new Error('deben existir las seis piezas 13–23');
    candidate.teeth.forEach(function (t) {
      ['x','y','width','height','rotation'].forEach(function (key) { if (!Number.isFinite(Number(t[key]))) throw new Error('valor inválido en ' + t.id); t[key] = Number(t[key]); });
      if (!PATHS[t.shape] || !PATHS[t.shape][t.role]) throw new Error('anatomía desconocida en ' + t.id);
      if (!t.material) t.material = clone(defaultMaterial);
      if (!VITA_COLORS[t.material.vita]) t.material.vita = defaultMaterial.vita;
      t.material.value = clamp(Number(t.material.value) || 0, -12, 12);
      t.material.chroma = clamp(Number(t.material.chroma) || 0, -20, 20);
      t.material.translucency = clamp(Number(t.material.translucency) || 0, 0, 100);
      if (['smooth','natural','characterized'].indexOf(t.material.texture) === -1) t.material.texture = defaultMaterial.texture;
    });
    if (!candidate.guides) candidate.guides = clone(defaultGuides);
    ['incisalCenter','incisalArc','gingivalCenter','gingivalArc','red'].forEach(function (key) {
      if (!Number.isFinite(Number(candidate.guides[key]))) candidate.guides[key] = defaultGuides[key];
      candidate.guides[key] = Number(candidate.guides[key]);
    });
    candidate.guides.incisalCenter = clamp(candidate.guides.incisalCenter, 82, 98);
    candidate.guides.incisalArc = clamp(candidate.guides.incisalArc, 0, 10);
    candidate.guides.gingivalCenter = clamp(candidate.guides.gingivalCenter, 48, 75);
    candidate.guides.gingivalArc = clamp(candidate.guides.gingivalArc, -5, 5);
    candidate.guides.red = clamp(candidate.guides.red, 62, 80);
    if (IDS.indexOf(candidate.selectedId) === -1) candidate.selectedId = '11';
    return candidate;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function setStatus(message) { statusEl.textContent = message; }

  render();
}());
