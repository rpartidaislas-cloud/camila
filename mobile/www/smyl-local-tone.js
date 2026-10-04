/* Local, manually bounded shade preview. No fetch, inference, or generation.
 * The user paints the visible enamel; this is NOT automatic segmentation.
 * Every render starts from one immutable accepted image, never a tinted copy.
 */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const codes = ['B1','A1','B2','D2','A2','C1','C2','D4','A3','D3','B3','A3.5','B4','C3','A4','C4'];
  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const load = url => new Promise((resolve, reject) => {
    // Do not download a remote patient image, model, or mask in this feature.
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url || '')) return reject(Error('Esta imagen no está disponible localmente. Conserva el resultado y vuelve a abrirlo desde el simulador.'));
    const image = new Image();
    image.onload = () => image.naturalWidth * image.naturalHeight <= 8388608 ? resolve(image) : reject(Error('La imagen es demasiado grande para este ajuste local.'));
    image.onerror = () => reject(Error('No se pudo abrir la imagen. El resultado anterior se conserva.'));
    image.src = url;
  });
  async function hash(text) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function source(photo) { return photo.dataUrl || 'data:' + (photo.mimeType || 'image/jpeg') + ';base64,' + photo.b64; }
  function bind(record, original, base, output, owner) {
    Object.defineProperties(record, { _source: { value: original }, _base: { value: base }, _output: { value: output }, _owner: { value: owner } });
    return record;
  }
  function currentRecord(state, view) {
    const record = state.localToneByView?.[view], photo = state.photos.find(p => p.view === view);
    return photo && record && record._owner === progressKey() && record._source === source(photo) && record._base === state.veneerBaseByView?.[view] && record._output === state.results?.[view] ? record : null;
  }
  async function verify(record, original, base, output, view, owner) {
    if (!record || record.schema !== 1 || record.view !== view || !['base', ...codes].includes(record.shade) || !base || !output || typeof record.mask !== 'string') return null;
    const hashes = await Promise.all([original, base, output, owner || ''].map(hash));
    if (hashes.some((v, i) => v !== [record.sourceHash, record.baseHash, record.resultHash, record.ownerHash][i])) return null;
    return bind({ ...record }, original, base, output, owner);
  }
  async function restore(state) {
    const records = state.localToneByView, owner = progressKey();
    for (const view of Object.keys(records || {})) {
      const photo = state.photos.find(p => p.view === view), record = records[view];
      if (!photo) continue;
      const original = source(photo), base = state.veneerBaseByView?.[view], output = state.results?.[view];
      const valid = await verify(record, original, base, output, view, owner).catch(() => null);
      if (owner === progressKey() && state.localToneByView === records && state.photos.includes(photo) && source(photo) === original && state.results?.[view] === output && state.veneerBaseByView?.[view] === base) {
        if (valid) records[view] = valid; else delete records[view];
      }
    }
  }
  // A luminance-relative display transform: preserve relief and small chroma
  // variation. RGB targets come from the same approximate guide as the carousel.
  // Exact alpha-zero pixels (including lips/background) are copied untouched.
  function tint(pixels, mask, rgb) {
    if (pixels.length !== mask.length || !rgb || rgb.length !== 3 || rgb.some(v => !Number.isFinite(v))) throw Error('La selección no coincide con la imagen.');
    const out = new Uint8ClampedArray(pixels);
    let weight = 0, mean = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) {
      const a = mask[i + 3] / 255, lum = .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
      if (a < .5 || lum < 40 || lum > 247) continue;
      for (let k = 0; k < 3; k++) mean[k] += pixels[i + k] * a;
      weight += a;
    }
    if (weight < 4) throw Error('Marca una zona de esmalte visible antes de probar el tono.');
    mean = mean.map(v => v / weight);
    const avg = .2126 * mean[0] + .7152 * mean[1] + .0722 * mean[2];
    for (let i = 0; i < pixels.length; i += 4) {
      const a = mask[i + 3] / 255;
      if (!a) continue;
      const lum = .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
      // Preserve deep gaps and specular peaks even if a brush includes them.
      const strength = a * clamp((lum - 32) / 42, 0, 1) * clamp((255 - lum) / 14, 0, 1);
      for (let k = 0; k < 3; k++) {
        const target = clamp(rgb[k] + (lum - avg) * .92 + ((pixels[i + k] - lum) - (mean[k] - avg)) * .18, 0, 255);
        out[i + k] = Math.round(pixels[i + k] * (1 - strength) + target * strength);
      }
    }
    return out;
  }
  let busy = false;
  async function open({ original, base, result, record, view, label, archLabel, isCurrent, owner }) {
    if (busy) return null;
    busy = true;
    let image;
    try { image = await load(base); } catch (error) { busy = false; throw error; }
    if (!isCurrent()) { busy = false; return null; }
    return new Promise((resolve, reject) => {
      const previous = document.activeElement, d = document.createElement('dialog');
      d.className = 'lt-dialog'; d.setAttribute('aria-labelledby', 'lt-title');
      d.innerHTML = `<header><div><span class="lt-eyebrow">SIN GENERAR OTRA IMAGEN</span><h2 id="lt-title">Prueba el tono</h2><p class="lt-context"></p></div><button type="button" data-act="cancel" aria-label="Cancelar cambio de tono">✕</button></header>
        <div class="lt-layout"><div class="lt-image-panel"><div class="lt-viewport"><canvas class="lt-photo" tabindex="0" aria-label="Selecciona esmalte con el pincel. Con teclado, mueve el cursor con flechas y pinta con Espacio."></canvas></div><div class="lt-view-tools"><button type="button" data-act="zoom-out" aria-label="Alejar fotografía">−</button><output class="lt-zoom">1×</output><button type="button" data-act="zoom-in" aria-label="Ampliar fotografía">+</button><button type="button" data-act="compare">Ver base</button></div></div>
        <section class="lt-controls"><details class="lt-selection"><summary>Seleccionar dientes <span>· una vez por foto</span></summary><p>Pinta solo el esmalte que quieres cambiar. Evita encías, labios y espacios entre dientes. Amplía la foto para revisar los bordes.</p><div class="lt-tools"><button type="button" data-mode="paint" aria-pressed="true">Pintar</button><button type="button" data-mode="erase" aria-pressed="false">Borrar</button><button type="button" data-mode="move" aria-pressed="false">Mover foto</button></div><label>Tamaño del pincel <input type="range" class="lt-size" min="3" max="40" value="12" aria-label="Tamaño del pincel"></label><div class="lt-tools"><button type="button" data-act="undo">Deshacer</button><button type="button" data-act="clear">Limpiar selección</button></div><label class="lt-check"><input type="checkbox" class="lt-overlay" checked> Ver zona seleccionada</label></details>
        <div class="lt-shade-heading"><strong class="lt-shade-label">Elige un tono</strong><span>Desliza: el centro selecciona el tono</span></div><div class="lt-tones" role="group" aria-label="Tonos VITA"></div><button type="button" data-act="base" class="lt-base">Restablecer tono de la simulación</button>
        <p class="lt-status" role="status" aria-live="polite"></p><label class="lt-check"><input type="checkbox" class="lt-reviewed"> Revisé el tono y que solo cambien los dientes seleccionados.</label><p class="lt-note">Aproximación VITA en pantalla, no medición clínica. Cambia solo esta vista. La foto original y la forma se conservan. La selección se guarda en el avance de este dispositivo, no en el expediente.</p></section></div>
        <footer><button type="button" data-act="back">Cancelar</button><button type="button" data-act="use" class="lt-primary" disabled>Usar tono</button></footer>`;
      const $ = selector => d.querySelector(selector);
      $('.lt-context').textContent = label + ' · ' + archLabel;
      const W = image.naturalWidth, H = image.naturalHeight, baseCanvas = canvas(W, H), maskCanvas = canvas(W, H), output = canvas(W, H);
      baseCanvas.getContext('2d').drawImage(image, 0, 0);
      const pixels = baseCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H);
      const mg = maskCanvas.getContext('2d', { willReadFrequently: true });
      const display = $('.lt-photo'), g = display.getContext('2d'); display.width = W; display.height = H;
      let mode = 'paint', shade = record?.shade || 'base', zoom = 1, history = [], stroke = null, comparing = false, dirty = false, closed = false, submitting = false, renderFrame = null, paintOK = false, cursor = { x: W / 2, y: H / 2 }, keyboard = false, shadeCarousel = null;
      const dispose = () => {
        clearInterval(watch); cancelAnimationFrame(renderFrame); shadeCarousel?.destroy(); d.close(); d.remove();
        [baseCanvas, maskCanvas, output, display].forEach(c => { c.width = 1; c.height = 1; });
        previous?.focus(); busy = false;
      };
      const close = value => { if (closed) return; closed = true; dispose(); resolve(value); };
      const changed = () => { dirty = true; $('.lt-reviewed').checked = false; schedule(); };
      function remember() { history.push(mg.getImageData(0, 0, W, H)); if (history.length > Math.max(2, Math.min(12, Math.floor(32000000 / (W * H * 4))))) history.shift(); }
      function repaint() {
        renderFrame = null; if (closed) return;
        const mask = mg.getImageData(0, 0, W, H); paintOK = false;
        try {
          const data = tint(pixels.data, mask.data, root.SmylVitaSamples.rgb(shade === 'base' ? 'A1' : shade));
          output.getContext('2d').putImageData(new ImageData(shade === 'base' ? new Uint8ClampedArray(pixels.data) : data, W, H), 0, 0);
          paintOK = true; $('.lt-status').textContent = shade === 'base' ? 'Base sin recolorear. No cambia la foto original.' : 'Vista previa local · VITA ' + shade;
        } catch (_) {
          output.getContext('2d').drawImage(baseCanvas, 0, 0);
          $('.lt-status').textContent = 'Primero marca los dientes con el pincel.';
        }
        g.drawImage(comparing ? baseCanvas : output, 0, 0);
        if (!comparing && $('.lt-overlay').checked) {
          const overlay = new ImageData(new Uint8ClampedArray(mask.data), W, H);
          for (let i = 0; i < overlay.data.length; i += 4) { overlay.data[i] = 83; overlay.data[i + 1] = 228; overlay.data[i + 2] = 204; overlay.data[i + 3] *= .38; }
          const layer = canvas(W, H); layer.getContext('2d').putImageData(overlay, 0, 0); g.drawImage(layer, 0, 0); layer.width = 1;
        }
        if (keyboard) { g.strokeStyle = '#ffffff'; g.lineWidth = W / display.getBoundingClientRect().width; g.beginPath(); g.arc(cursor.x, cursor.y, radius(), 0, Math.PI * 2); g.stroke(); }
        $('.lt-shade-label').textContent = shade === 'base' ? 'Tono de la simulación' : 'VITA ' + shade;
        d.querySelectorAll('[data-shade]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.shade === shade)));
        $('[data-act="base"]').setAttribute('aria-pressed', String(shade === 'base'));
        $('[data-act="use"]').disabled = !dirty || !$('.lt-reviewed').checked || (shade !== 'base' && !paintOK) || comparing || $('.lt-overlay').checked || !!stroke;
        $('[data-act="undo"]').disabled = !history.length;
      }
      function schedule() { if (!renderFrame) renderFrame = requestAnimationFrame(repaint); }
      function radius() { return +$('.lt-size').value / 2 * W / Math.max(1, display.getBoundingClientRect().width); }
      function point(event) { const box = display.getBoundingClientRect(); return { x: clamp((event.clientX - box.left) * W / box.width, 0, W), y: clamp((event.clientY - box.top) * H / box.height, 0, H) }; }
      function paint(a, b) {
        mg.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
        mg.strokeStyle = mg.fillStyle = '#ffffff'; mg.lineCap = mg.lineJoin = 'round'; mg.lineWidth = radius() * 2;
        mg.beginPath(); mg.moveTo(a.x, a.y); mg.lineTo(b.x, b.y); mg.stroke();
        mg.beginPath(); mg.arc(b.x, b.y, radius(), 0, Math.PI * 2); mg.fill(); mg.globalCompositeOperation = 'source-over';
        changed();
      }
      function setMode(next) {
        mode = next; display.style.touchAction = next === 'move' ? 'pan-x pan-y' : 'none';
        display.style.cursor = next === 'move' ? 'grab' : 'crosshair';
        d.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      }
      display.onpointerdown = event => {
        if (submitting || stroke || event.button > 0) return;
        if (mode === 'move') { if (event.pointerType !== 'mouse') return; stroke = { id: event.pointerId, mode, x: event.clientX, y: event.clientY, left: $('.lt-viewport').scrollLeft, top: $('.lt-viewport').scrollTop }; }
        else { remember(); keyboard = false; cursor = point(event); stroke = { id: event.pointerId, mode, point: cursor }; paint(cursor, cursor); }
        display.setPointerCapture(event.pointerId); event.preventDefault();
      };
      display.onpointermove = event => {
        if (!stroke || stroke.id !== event.pointerId) return;
        if (stroke.mode === 'move') { $('.lt-viewport').scrollLeft = stroke.left + stroke.x - event.clientX; $('.lt-viewport').scrollTop = stroke.top + stroke.y - event.clientY; }
        else { cursor = point(event); paint(stroke.point, cursor); stroke.point = cursor; }
      };
      display.onpointerup = display.onpointercancel = display.onlostpointercapture = event => {
        if (!stroke || stroke.id !== event.pointerId) return; stroke = null; schedule();
      };
      display.onkeydown = event => {
        if (submitting || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(event.key)) return;
        event.preventDefault(); keyboard = true;
        const step = (event.shiftKey ? 10 : 2) * W / display.getBoundingClientRect().width;
        if (event.key === ' ') { if (mode !== 'move') { remember(); paint(cursor, cursor); } }
        else { cursor.x = clamp(cursor.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), 0, W); cursor.y = clamp(cursor.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), 0, H); }
        schedule();
      };
      codes.forEach(code => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.shade = code; b.setAttribute('aria-label', 'VITA ' + code);
        const swatch = document.createElement('img'); swatch.className = 'lt-swatch'; swatch.src = 'icons/vita/veneer-ceramic-v2.webp'; swatch.alt = ''; swatch.draggable = false; root.SmylVitaSamples.attachFilter(swatch, code);
        b.append(swatch, document.createTextNode(code)); b.onclick = () => shadeCarousel.pick(code); $('.lt-tones').append(b);
      });
      shadeCarousel = root.SmylShadeCarousel.attach({ track: $('.lt-tones'), selector: '[data-shade]', key: 'data-shade', enabled: () => !closed && !submitting,
        onSelect(code) { shade = code; $('.lt-overlay').checked = false; comparing = false; $('[data-act="compare"]').textContent = 'Ver base'; if (paintOK) $('.lt-selection').open = false; changed(); }
      });
      shadeCarousel.sync(shade);
      d.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { setMode(b.dataset.mode); $('.lt-overlay').checked = true; schedule(); }; });
      function zoomTo(value) {
        const v = $('.lt-viewport'), ratio = value / zoom, x = (v.scrollLeft + v.clientWidth / 2) * ratio - v.clientWidth / 2, y = (v.scrollTop + v.clientHeight / 2) * ratio - v.clientHeight / 2;
        zoom = value; display.style.width = zoom * 100 + '%'; v.scrollLeft = x; v.scrollTop = y; $('.lt-zoom').textContent = zoom + '×'; schedule();
      }
      $('[data-act="zoom-in"]').onclick = () => zoomTo(Math.min(4, zoom + 1));
      $('[data-act="zoom-out"]').onclick = () => zoomTo(Math.max(1, zoom - 1));
      $('[data-act="undo"]').onclick = () => { if (!history.length) return; mg.putImageData(history.pop(), 0, 0); changed(); };
      $('[data-act="clear"]').onclick = () => { remember(); mg.clearRect(0, 0, W, H); changed(); };
      $('[data-act="compare"]').onclick = () => { comparing = !comparing; $('[data-act="compare"]').textContent = comparing ? 'Ver nuevo tono' : 'Ver base'; schedule(); };
      $('[data-act="base"]').onclick = () => { shade = 'base'; shadeCarousel.sync(shade); $('.lt-overlay').checked = false; changed(); };
      $('.lt-reviewed').onchange = schedule; $('.lt-overlay').onchange = schedule; $('.lt-size').oninput = schedule;
      $('[data-act="cancel"]').onclick = $('[data-act="back"]').onclick = () => close(null);
      d.oncancel = event => { event.preventDefault(); close(null); };
      $('[data-act="use"]').onclick = async () => {
        if (submitting) return;
        if (!isCurrent()) return close(null);
        repaint(); if ($('[data-act="use"]').disabled) return;
        submitting = true;
        d.querySelectorAll('button,input').forEach(b => { b.disabled = true; });
        try {
          const selectedShade = shade, maskUrl = maskCanvas.toDataURL('image/png');
          const url = selectedShade === 'base' ? base : output.toDataURL('image/png');
          const hashes = await Promise.all([original, base, url, owner || ''].map(hash));
          if (closed) return;
          if (!isCurrent()) return close(null);
          const saved = bind({ schema: 1, view, width: W, height: H, shade: selectedShade, mask: maskUrl, sourceHash: hashes[0], baseHash: hashes[1], resultHash: hashes[2], ownerHash: hashes[3] }, original, base, url, owner);
          close({ url, base, record: saved });
        } catch (error) { if (closed) return; submitting = false; d.querySelectorAll('button,input').forEach(b => { b.disabled = false; }); repaint(); $('.lt-status').textContent = 'No se pudo preparar el tono. El resultado anterior se conserva; puedes reintentar.'; }
      };
      const watch = setInterval(() => { if (!isCurrent()) close(null); }, 300);
      async function start() {
        try {
          if (record) {
            const mask = await load(record.mask);
            if (mask.naturalWidth === W && mask.naturalHeight === H) mg.drawImage(mask, 0, 0);
            else throw Error('La selección guardada no coincide con la fotografía.');
          }
          if (closed) return;
          document.body.append(d); d.showModal(); $('.lt-selection').open = !record; $('.lt-overlay').checked = !record;
          setMode('paint'); repaint();
        } catch (error) { if (closed) return; closed = true; dispose(); reject(error); }
      }
      start();
    });
  }
  async function openFromResult() {
    if (busy) return;
    let f;
    try {
      const state = S; f = fotoVisualActual();
      const result = state.results?.[f.view];
      if (!result) throw Error('Genera y acepta primero una simulación de esta vista.');
      const owner = progressKey(), photo = f.photo, original = f.original, caseId = state.casoId;
      const current = () => S === state && progressKey() === owner && S.casoId === caseId && S.photos.includes(photo) && source(photo) === original && S.results?.[f.view] === result && S.baVistaActual === f.view && document.getElementById('s-res').classList.contains('active');
      let record = currentRecord(state, f.view) || await verify(state.localToneByView?.[f.view], original, state.veneerBaseByView?.[f.view], result, f.view, owner);
      if (!current()) return;
      const base = record ? state.veneerBaseByView[f.view] : result;
      const meta = state.simulationQualityByView?.[f.view]?.metrics?.trace?.visualOptions || state.smileDesign || {};
      const choice = await open({ original, base, result, record, view: f.view, label: root.SmylCaseModel?.label(f.view) || f.view,
        archLabel: 'Selecciona ' + ({ upper: 'solo dientes de arriba', lower: 'solo dientes de abajo', both: 'dientes de ambas arcadas' }[meta.arch] || 'los dientes a cambiar'), isCurrent: current, owner });
      if (!choice || !current()) return;
      if (!state.localToneByView) state.localToneByView = {};
      state.localToneByView[f.view] = choice.record;
      state.veneerBaseByView[f.view] = choice.base;
      state.results[f.view] = choice.url;
      if (f.view === state.photos[0]?.view || f.view === 'frontal') state.result = choice.url;
      // Do not overwrite generation settings or the provenance of other views.
      const quality = state.simulationQualityByView[f.view] || { version: SIM_QUALITY_VERSION, status: 'review', metrics: {} };
      state.simulationQualityByView[f.view] = { ...quality, status: quality.status === 'rejected' ? 'rejected' : 'review' };
      document.getElementById('img-a').src = choice.url;
      initBASlider(); renderResPhotos(); renderControlCalidadSimulacion(); actualizarBotonVitaResultado(); saveProgress('s-res');
      let saved = false; try { const snapshot = JSON.parse(progressStorage().getItem(owner)); saved = snapshot.results?.[f.view] === choice.url && snapshot.localToneByView?.[f.view]?.resultHash === choice.record.resultHash; } catch (_) {}
      if (!saved) mostrarAvisoAplicacion('Tono aplicado en esta pantalla', 'No hay espacio para recuperar este ajuste al cerrar. Guárdalo en el paciente o descarga la imagen antes de salir.');
    } catch (error) { mostrarAvisoAplicacion('Cambio de tono local', error.message); }
  }
  root.SmylLocalTone = { openFromResult, open, tint, hash, verify, restore, currentRecord, codes };
})(typeof window === 'undefined' ? globalThis : window);
