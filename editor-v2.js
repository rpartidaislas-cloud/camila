(function () {
  'use strict';

  var STORAGE_KEY = 'smyl_editor_v2_design';
  var IDS = ['13', '12', '11', '21', '22', '23'];
  var ROLE_NAMES = { central: 'Central', lateral: 'Lateral', canine: 'Canino' };
  var PATHS = {
    central: 'M -5.4 0 C -3.8 -1.4 3.8 -1.4 5.4 0 C 6.1 4.5 6.1 13.6 5.2 18.4 C 3.7 20.2 -3.7 20.2 -5.2 18.4 C -6.1 13.6 -6.1 4.5 -5.4 0 Z',
    lateral: 'M -4.4 0 C -3.2 -1.2 3.2 -1.2 4.4 0 C 5.1 4.2 5 12.3 4.2 16.8 C 2.9 18.2 -2.9 18.2 -4.2 16.8 C -5 12.3 -5.1 4.2 -4.4 0 Z',
    canine: 'M -4.3 0 C -2.9 -1 2.9 -1 4.3 0 C 5 4.1 4.8 11.6 3.7 15.2 C 2.5 16.1 1.3 17.5 0 18.5 C -1.3 17.5 -2.5 16.1 -3.7 15.2 C -4.8 11.6 -5 4.1 -4.3 0 Z'
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
      rotation: rotation, shape: 'natural-soft',
      gingivalAnchor: { x: 0.5, y: 0 }, incisalAnchor: { x: 0.5, y: 1 }
    };
  }

  var state = { schema: 'smyl.veneer-design', version: 1, updatedAt: null, selectedId: '11', teeth: clone(defaults) };
  var drag = null;

  var svg = document.getElementById('design-svg');
  var layer = document.getElementById('teeth-layer');
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

  function isModified(t) {
    var d = original(t.id);
    return ['x','y','width','height','rotation'].some(function (key) { return Math.abs(t[key] - d[key]) > 0.001; });
  }

  function render() {
    layer.innerHTML = state.teeth.map(function (t) {
      var selectedClass = t.id === state.selectedId ? ' selected' : '';
      var modifiedClass = isModified(t) ? ' modified' : '';
      var sx = t.width / 11;
      var sy = t.height / 20;
      // Las anatomías de esta etapa son simétricas. No reflejamos el grupo
      // completo porque también invertiría etiquetas y puntos de control.
      var transform = 'translate(' + t.x + ' ' + t.y + ') rotate(' + t.rotation + ') scale(' + sx + ' ' + sy + ')';
      var path = PATHS[t.role];
      return '<g class="tooth' + selectedClass + modifiedClass + '" data-id="' + esc(t.id) + '" tabindex="0" role="button" aria-label="Diente ' + esc(t.id) + ', ' + ROLE_NAMES[t.role] + '" transform="' + transform + '">' +
        '<path class="shape" d="' + path + '"></path>' +
        '<path class="inner" d="M -3.1 2 C -1.2 1.1 1.2 1.1 3.1 2 M -3.5 5.2 C -2.5 8.2 -2.4 13.4 -1.5 17 M 3.5 5.2 C 2.5 8.2 2.4 13.4 1.5 17"></path>' +
        '<path class="selection" d="' + path + '"></path>' +
        '<circle class="anchor" cx="0" cy="0" r="1.05" fill="#55d8a3" stroke="#07100d" stroke-width=".35"></circle>' +
        '<circle class="anchor" cx="0" cy="' + (t.role === 'central' ? '19.2' : t.role === 'lateral' ? '17.4' : '18') + '" r="1.05" fill="#f3b84f" stroke="#130d04" stroke-width=".35"></circle>' +
        '<text class="tooth-label" x="0" y="10">' + esc(t.id) + '</text></g>';
    }).join('');
    renderList();
    syncControls();
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
    state.teeth = clone(defaults); state.selectedId = '11'; render(); setStatus('Diseño completo restaurado.');
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
    if (!candidate || candidate.schema !== 'smyl.veneer-design' || candidate.version !== 1 || !Array.isArray(candidate.teeth)) throw new Error('esquema desconocido');
    if (candidate.teeth.length !== 6 || IDS.some(function (id) { return !candidate.teeth.some(function (t) { return t.id === id; }); })) throw new Error('deben existir las seis piezas 13–23');
    candidate.teeth.forEach(function (t) {
      ['x','y','width','height','rotation'].forEach(function (key) { if (!Number.isFinite(Number(t[key]))) throw new Error('valor inválido en ' + t.id); t[key] = Number(t[key]); });
      if (!PATHS[t.role]) throw new Error('anatomía desconocida en ' + t.id);
    });
    if (IDS.indexOf(candidate.selectedId) === -1) candidate.selectedId = '11';
    return candidate;
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function setStatus(message) { statusEl.textContent = message; }

  render();
}());
