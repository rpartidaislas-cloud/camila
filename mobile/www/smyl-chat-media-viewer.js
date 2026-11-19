/* Shared, local attachment viewer for the inbox and pipeline. */
(function () {
  'use strict';

  const colors = [['Coral', '#ef5048'], ['Azul', '#1689e4'], ['Verde', '#15a487'],
    ['Amarillo', '#ffd643'], ['Blanco', '#ffffff'], ['Negro', '#192330']];
  const icons = {
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
    pdf: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    pan: '<path d="M8 12V7a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-6.5 7H12c-2.2 0-4.1-1-5.4-2.8l-3.4-4.8a1.7 1.7 0 0 1 2.6-2.2L8 14"/>',
    pen: '<path d="m14.5 5.5 4 4M4 20l4.2-1 12-12a2.8 2.8 0 0 0-4-4l-12 12z"/>',
    highlighter: '<path d="m13 4 7 7m-13 2 9-10 6 6-10 9-5-5ZM5 15l4 4-2 2H2z"/>',
    text: '<path d="M4 7V4h16v3M12 4v16m-4 0h8"/>',
    undo: '<path d="M8 5 3 10l5 5M4 10h10a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
    redo: '<path d="m16 5 5 5-5 5m4-5H10a6 6 0 0 0 0 12" transform="translate(0 -2)"/>',
    minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14m-7-7v14"/>',
    fit: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/>',
    prev: '<path d="m14 5-7 7 7 7"/>', next: '<path d="m10 5 7 7-7 7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    attach: '<path d="M8 15.5 16.5 7a2.1 2.1 0 0 1 3 3l-10 10a4.3 4.3 0 0 1-6-6L14 3.5"/>'
  };
  const svgNS = 'http://www.w3.org/2000/svg';
  const bound = (value, low, high) => Math.max(low, Math.min(high, value));
  let active = null;
  let openId = 0;

  function icon(key) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[key] + '</svg>';
  }
  function button(action, label, glyph, visibleLabel) {
    return '<button type="button" data-cmv-action="' + action + '" aria-label="' + label + '" title="' + label + '">' +
      icon(glyph) + (visibleLabel ? '<span>' + visibleLabel + '</span>' : '') + '</button>';
  }
  function svgNode(tag, attrs) {
    const el = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  }

  function markNode(mark, width, height) {
    const size = mark.size * Math.min(width, height);
    if (mark.tool === 'text') {
      const el = svgNode('text', { fill: mark.color, 'font-family': 'Arial, sans-serif', 'font-size': size });
      mark.text.split('\n').forEach((line, i) => {
        const span = svgNode('tspan', { x: mark.x * width, y: mark.y * height + size * (1 + i * 1.24) });
        span.textContent = line;
        el.append(span);
      });
      return el;
    }
    const opacity = mark.tool === 'highlighter' ? .38 : 1;
    if (mark.points.length === 1) {
      return svgNode('circle', { cx: mark.points[0].x * width, cy: mark.points[0].y * height,
        r: size / 2, fill: mark.color, opacity });
    }
    return svgNode('polyline', { points: mark.points.map(p => (p.x * width).toFixed(2) + ',' + (p.y * height).toFixed(2)).join(' '),
      fill: 'none', stroke: mark.color, 'stroke-width': size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity });
  }

  function drawImageMarks(ctx, marks, width, height) {
    for (const mark of marks) {
      const size = mark.size * Math.min(width, height);
      ctx.fillStyle = ctx.strokeStyle = mark.color;
      ctx.globalAlpha = mark.tool === 'highlighter' ? .38 : 1;
      if (mark.tool === 'text') {
        ctx.font = size + 'px Arial, sans-serif';
        mark.text.split('\n').forEach((line, i) => ctx.fillText(line, mark.x * width, mark.y * height + size * (1 + i * 1.24)));
      } else if (mark.points.length === 1) {
        const point = mark.points[0];
        ctx.beginPath();
        ctx.arc(point.x * width, point.y * height, size / 2, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.lineWidth = size;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(mark.points[0].x * width, mark.points[0].y * height);
        for (const p of mark.points.slice(1)) ctx.lineTo(p.x * width, p.y * height);
        ctx.stroke();
      }
    }
  }

  function attachmentUrl(raw) {
    if (!raw) return '';
    const url = new URL(raw, document.baseURI);
    if (['https:', 'http:', 'blob:'].includes(url.protocol)) return url.href;
    if (/^data:(?:image\/(?:png|jpe?g|webp|gif|avif)|application\/pdf);base64,/i.test(url.href)) return url.href;
    throw Error('La dirección del archivo no es válida.');
  }

  function create(options) {
    const pdf = options.kind === 'pdf';
    const previousFocus = options.returnFocus || options.trigger || document.activeElement;
    const title = String(options.name || options.filename || (pdf ? 'Documento PDF' : 'Imagen'));
    const d = document.createElement('dialog');
    d.className = 'smyl-media-dialog';
    d.dataset.smylMediaDialog = '';
    d.setAttribute('aria-labelledby', 'smyl-media-title');
    d.innerHTML = `
      <header class="cmv-head"><div class="cmv-file-icon">${icon(pdf ? 'pdf' : 'image')}</div>
        <div class="cmv-title"><span>${pdf ? 'PDF del chat' : 'Imagen del chat'}</span><h2 id="smyl-media-title"></h2></div>
        ${button('close', 'Cerrar visor', 'close')}</header>
      <div class="cmv-toolbar" aria-label="Herramientas de anotación">
        <div class="cmv-modes" role="group" aria-label="Modo de interacción">
          ${button('pan', 'Mover', 'pan', 'Mover')}${button('pen', 'Plumón', 'pen', 'Plumón')}${button('highlighter', 'Resaltador', 'highlighter', 'Resaltador')}${button('text', 'Texto', 'text', 'Texto')}
        </div><div class="cmv-history">${button('undo', 'Deshacer', 'undo')}${button('redo', 'Rehacer', 'redo')}</div>
      </div>
      <div class="cmv-options" hidden><div class="cmv-colors" role="group" aria-label="Color de la anotación"></div>
        <label class="cmv-size"><span>Grosor</span><select aria-label="Grosor"><option value="0">Fino</option><option value="1" selected>Medio</option><option value="2">Grueso</option></select></label></div>
      <div class="cmv-text-editor" hidden><textarea aria-label="Texto de la anotación" maxlength="1200" rows="2" placeholder="Escribe tu nota"></textarea>
        <div><button type="button" data-cmv-action="cancel-text">Cancelar</button><button type="button" data-cmv-action="place-text">Colocar texto</button></div></div>
      <div class="cmv-stage" data-media-stage tabindex="0" aria-label="Vista del archivo. Usa dos dedos para ampliar. Con teclado, usa más, menos y las flechas.">
        <div class="cmv-plane" hidden><div class="cmv-original"></div><svg data-media-ink aria-hidden="true" preserveAspectRatio="none"></svg></div>
        <div class="cmv-message" role="status"><span>Abriendo archivo…</span><a hidden target="_blank" rel="noopener noreferrer">Abrir original</a></div>
      </div>
      <div class="cmv-navigation">
        <div class="cmv-pages" ${pdf ? '' : 'hidden'}>${button('prev', 'Página anterior', 'prev')}<output data-media-page aria-live="polite"></output>${button('next', 'Página siguiente', 'next')}</div>
        <div class="cmv-zoom">${button('minus', 'Reducir zoom', 'minus')}<input type="range" aria-label="Zoom" min="100" max="600" step="1" value="100">${button('plus', 'Aumentar zoom', 'plus')}<output data-media-scale>100%</output>${button('fit', 'Ajustar a la ventana', 'fit')}</div>
      </div>
      <footer class="cmv-footer"><span class="cmv-status" role="status" aria-live="polite"></span><div class="cmv-actions">
        ${button('download', 'Descargar original', 'download', 'Descargar original')}${button('attach', 'Adjuntar copia al chat', 'attach', 'Adjuntar copia')}</div></footer>
      <section class="cmv-confirm" role="alertdialog" aria-label="Anotaciones sin guardar" hidden><strong>¿Descartar las anotaciones sin guardar?</strong>
        <button type="button" data-cmv-action="keep">Seguir editando</button><button type="button" data-cmv-action="discard">Descartar</button></section>`;
    const find = selector => d.querySelector(selector);
    const act = action => find('[data-cmv-action="' + action + '"]');
    find('h2').textContent = title;
    const stage = find('.cmv-stage'), plane = find('.cmv-plane'), ink = find('[data-media-ink]');
    const original = find('.cmv-original'), message = find('.cmv-message'), status = find('.cmv-status');
    const range = find('input[type=range]'), toolOptions = find('.cmv-options'), editor = find('.cmv-text-editor');
    const textField = editor.querySelector('textarea'), sizeField = find('.cmv-size select');
    const pages = new Map(), undone = new Map(), pointers = new Map();
    const controller = new AbortController();
    let ready = false, busy = false, readOnly = false, closed = false, closeDecision = null;
    let fileBlob, pdfDoc, loadedImage, blobUrl, page = 1, loadVersion = 0, detailVersion = 0, detailTimer, renderScale = 0;
    let width = 1, height = 1, base = 1, zoom = 1, offsetX = 0, offsetY = 0;
    let tool = 'pan', gesture, stroke, liveInk, drawFrame, textPoint, revision = 0, saved = 0;
    const preferred = { pen: colors[0][1], highlighter: colors[3][1], text: colors[0][1] };
    const strokeSizes = { pen: [.003, .007, .014], highlighter: [.018, .033, .058], text: [.028, .043, .066] };
    const sizeChoices = { pen: 1, highlighter: 1, text: 1 };
    const marks = () => pages.get(page) || [];
    const hasMarks = () => Array.from(pages.values()).some(list => list.length);
    const hasDraft = () => !editor.hidden && !!textField.value.trim();
    const dirty = () => (hasMarks() && revision !== saved) || hasDraft();
    const colorButtons = find('.cmv-colors');
    colors.forEach(([name, value]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.dataset.color = value;
      item.setAttribute('aria-label', 'Color ' + name.toLowerCase());
      item.title = name;
      item.style.setProperty('--ink', value);
      colorButtons.append(item);
    });

    function controls() {
      const canEdit = ready && !busy && !readOnly;
      for (const mode of ['pan', 'pen', 'highlighter', 'text']) {
        act(mode).setAttribute('aria-pressed', String(mode === tool));
        act(mode).disabled = !ready || busy || (mode !== 'pan' && !canEdit);
      }
      toolOptions.hidden = tool === 'pan' || !canEdit;
      if (!toolOptions.hidden) {
        [...colorButtons.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === preferred[tool])));
        const label = tool === 'text' ? 'Tamaño' : 'Grosor';
        sizeField.previousElementSibling.textContent = label;
        sizeField.setAttribute('aria-label', label);
        sizeField.value = String(sizeChoices[tool]);
        [...sizeField.options].forEach((option,i) => {
          option.textContent = (tool === 'text' ? ['Pequeño','Medio','Grande'] : ['Fino','Medio','Grueso'])[i];
        });
      }
      act('undo').disabled = !canEdit || !marks().length;
      act('redo').disabled = !canEdit || !undone.get(page)?.length;
      act('prev').disabled = !ready || busy || page <= 1;
      act('next').disabled = !ready || busy || page >= (pdfDoc?.pageCount || 1);
      if (pdfDoc) find('[data-media-page]').textContent = page + ' / ' + pdfDoc.pageCount;
      const annotated = hasMarks();
      const downloadLabel = annotated ? 'Descargar copia' : 'Descargar original';
      act('download').querySelector('span').textContent = downloadLabel;
      act('download').setAttribute('aria-label', downloadLabel);
      act('download').title = downloadLabel;
      act('download').disabled = !ready || busy || readOnly;
      act('attach').hidden = !options.onAttach || !annotated;
      act('attach').disabled = !ready || busy || !annotated || readOnly;
      range.disabled = !ready || busy;
      act('fit').disabled = !ready || busy;
      act('minus').disabled = !ready || busy || zoom <= 1;
      act('plus').disabled = !ready || busy || zoom >= 6;
      stage.dataset.mode = tool;
    }

    function resetEditor() {
      editor.hidden = true;
      textField.value = '';
      textPoint = null;
    }

    function repaintMarks() {
      ink.replaceChildren();
      for (const mark of marks()) ink.append(markNode(mark, width, height));
      liveInk = null;
    }
    function paintStroke() {
      drawFrame = 0;
      liveInk?.remove();
      liveInk = null;
      if (stroke) {
        liveInk = markNode(stroke, width, height);
        ink.append(liveInk);
      }
    }
    function cancelStroke() {
      stroke = null;
      cancelAnimationFrame(drawFrame);
      drawFrame = 0;
      liveInk?.remove();
      liveInk = null;
    }
    function addMark(mark) {
      const list = marks();
      list.push(mark);
      pages.set(page, list);
      undone.delete(page);
      revision++;
      status.textContent = '';
      repaintMarks();
      controls();
    }

    function paintTransform() {
      const dw = width * base * zoom, dh = height * base * zoom;
      const maxX = Math.max(0, (dw - stage.clientWidth) / 2), maxY = Math.max(0, (dh - stage.clientHeight) / 2);
      offsetX = bound(offsetX, -maxX, maxX);
      offsetY = bound(offsetY, -maxY, maxY);
      plane.style.transform = 'translate3d(' + ((stage.clientWidth - dw) / 2 + offsetX) + 'px,' +
        ((stage.clientHeight - dh) / 2 + offsetY) + 'px,0) scale(' + zoom + ')';
      range.value = Math.round(zoom * 100);
      find('[data-media-scale]').textContent = range.value + '%';
      act('plus').disabled = !ready || busy || zoom >= 6;
      act('minus').disabled = !ready || busy || zoom <= 1;
    }
    function scheduleDetail() {
      clearTimeout(detailTimer);
      if (!pdfDoc || !ready || closed) return;
      const scale = Math.min(base * zoom * Math.min(window.devicePixelRatio || 1, 3), Math.sqrt(8000000 / (width * height)));
      if (scale <= renderScale * 1.16) return;
      const token = ++detailVersion, pageToken = loadVersion;
      detailTimer = setTimeout(async () => {
        const canvas = document.createElement('canvas');
        try {
          await pdfDoc.render(page, canvas, scale);
          if (closed || token !== detailVersion || pageToken !== loadVersion) return;
          original.replaceChildren(canvas);
          renderScale = scale;
        } catch (_) { /* The existing render remains legible if detail loading fails. */ }
      }, 180);
    }

    function fit() {
      if (!ready || !stage.clientWidth || !stage.clientHeight) return;
      const pad = stage.clientWidth <= 520 ? 8 : 20;
      base = Math.min(Math.max(1, stage.clientWidth - pad * 2) / width, Math.max(1, stage.clientHeight - pad * 2) / height);
      if (!pdf) base = Math.min(1, base);
      plane.style.width = (width * base) + 'px';
      plane.style.height = (height * base) + 'px';
      paintTransform();
      scheduleDetail();
    }
    function setZoom(value, anchor = {x: 0, y: 0}) {
      const next = bound(value, 1, 6), factor = next / zoom;
      offsetX = anchor.x - (anchor.x - offsetX) * factor;
      offsetY = anchor.y - (anchor.y - offsetY) * factor;
      zoom = next;
      paintTransform();
      scheduleDetail();
    }
    function local(event) {
      const rect = stage.getBoundingClientRect();
      return {x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2};
    }
    function position(point, allowOutside) {
      const x = .5 + (point.x - offsetX) / (width * base * zoom);
      const y = .5 + (point.y - offsetY) / (height * base * zoom);
      if (!allowOutside && (x < 0 || y < 0 || x > 1 || y > 1)) return null;
      return {x: bound(x, 0, 1), y: bound(y, 0, 1)};
    }
    function resetGesture() {
      const [first, second] = pointers.values();
      if (second) {
        cancelStroke();
        gesture = {kind: 'pinch', centerX: (first.x + second.x) / 2, centerY: (first.y + second.y) / 2,
          distance: Math.max(1, Math.hypot(first.x-second.x,first.y-second.y)), zoom, offsetX, offsetY};
      } else if (first) {
        gesture = {kind: 'pan', start: first, offsetX, offsetY};
      } else gesture = null;
    }
    function beginText(at) {
      if (!at) return;
      textPoint = at;
      editor.hidden = false;
      textField.focus();
    }
    function commitText() {
      const text = textField.value.trim();
      if (!text || !textPoint) return;
      addMark({tool: 'text', ...textPoint, color: preferred.text, size: strokeSizes.text[sizeChoices.text], text});
      resetEditor();
      stage.focus({preventScroll:true});
    }

    stage.addEventListener('pointerdown', e => {
      if (!ready || busy || closeDecision || e.button !== 0 || !editor.hidden || e.target.closest('a')) return;
      stage.setPointerCapture(e.pointerId);
      stage.focus({preventScroll:true});
      e.preventDefault();
      const point = local(e);
      pointers.set(e.pointerId, point);
      resetGesture();
      if (pointers.size !== 1 || tool === 'pan') return;
      const at = position(point, false);
      if (!at) return;
      if (tool === 'text') { gesture = {kind: 'text', start: point, at}; return; }
      stroke = {tool, color: preferred[tool], size: strokeSizes[tool][sizeChoices[tool]], points: [at]};
      gesture = {kind: 'ink'};
      paintStroke();
    });
    stage.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      e.preventDefault();
      const point = local(e);
      pointers.set(e.pointerId, point);
      const [first, second] = pointers.values();
      if (gesture.kind === 'pinch' && second) {
        const next = bound(gesture.zoom * Math.hypot(first.x-second.x, first.y-second.y) / gesture.distance, 1, 6);
        const ratio = next / gesture.zoom;
        offsetX = (first.x + second.x) / 2 - (gesture.centerX - gesture.offsetX) * ratio;
        offsetY = (first.y + second.y) / 2 - (gesture.centerY - gesture.offsetY) * ratio;
        zoom = next;
        paintTransform();
      } else if (gesture.kind === 'pan') {
        offsetX = gesture.offsetX + point.x - gesture.start.x;
        offsetY = gesture.offsetY + point.y - gesture.start.y;
        paintTransform();
      } else if (gesture.kind === 'ink' && stroke) {
        const events = e.getCoalescedEvents?.();
        for (const sample of (events?.length ? events : [e])) {
          const at = position(local(sample), true), last = stroke.points[stroke.points.length - 1];
          if (Math.hypot((at.x-last.x)*width*base*zoom, (at.y-last.y)*height*base*zoom) >= .7) stroke.points.push(at);
        }
        if (!drawFrame) drawFrame = requestAnimationFrame(paintStroke);
      }
    });
    function pointerEnd(e) {
      if (!pointers.has(e.pointerId)) return;
      const finished = e.type === 'pointerup';
      if (stroke) {
        const mark = stroke;
        cancelStroke();
        if (finished) addMark(mark);
      }
      if (finished && gesture?.kind === 'text') {
        const end = local(e);
        if (Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) < 10) beginText(gesture.at);
      }
      pointers.delete(e.pointerId);
      resetGesture();
      scheduleDetail();
    }
    ['pointerup','pointercancel','lostpointercapture'].forEach(event => stage.addEventListener(event, pointerEnd));
    stage.addEventListener('wheel', e => {
      if (!ready || busy) return;
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1);
      setZoom(zoom * Math.exp(-delta * .002), local(e));
    }, {passive:false});
    stage.addEventListener('dblclick', e => {
      if (ready && !busy && tool === 'pan') setZoom(zoom > 1.01 ? 1 : 2, local(e));
    });
    range.addEventListener('input', () => setZoom(Number(range.value) / 100));
    sizeField.addEventListener('change', () => { sizeChoices[tool] = Number(sizeField.value); });
    colorButtons.addEventListener('click', e => {
      const item = e.target.closest('button[data-color]');
      if (item) { preferred[tool] = item.dataset.color; controls(); }
    });
    stage.addEventListener('keydown', e => {
      if (!ready || busy || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25);
      else if (e.key === '-') setZoom(zoom / 1.25);
      else if (e.key === '0') setZoom(1);
      else if (e.key === 'Enter' && tool === 'text') beginText(position({x:0,y:0}, false));
      else if (e.key.startsWith('Arrow')) {
        if (e.key === 'ArrowLeft') offsetX += 40;
        if (e.key === 'ArrowRight') offsetX -= 40;
        if (e.key === 'ArrowUp') offsetY += 40;
        if (e.key === 'ArrowDown') offsetY -= 40;
        paintTransform();
      } else return;
      e.preventDefault();
    });
    textField.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); }
    });

    function showMessage(text, href) {
      message.hidden = false;
      message.querySelector('span').textContent = text;
      const link = message.querySelector('a');
      link.hidden = !href;
      if (href) link.href = href; else link.removeAttribute('href');
    }
    function showPage(element, w, h) {
      width = w; height = h;
      zoom = 1; offsetX = 0; offsetY = 0;
      original.replaceChildren(element);
      ink.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      repaintMarks();
      ready = true;
      plane.hidden = false;
      message.hidden = true;
      fit(); controls();
    }
    async function loadPage(number) {
      const version = ++loadVersion;
      const priorPage = page;
      ready = false;
      cancelStroke(); pointers.clear(); resetGesture(); resetEditor();
      clearTimeout(detailTimer);
      detailVersion++;
      renderScale = 0;
      showMessage('Abriendo página…');
      controls();
      const canvas = document.createElement('canvas');
      try {
        const result = await pdfDoc.render(number, canvas, 1);
        if (closed || loadVersion !== version) return;
        page = number;
        renderScale = 1;
        showPage(canvas, result.width, result.height);
      } catch (err) {
        if (closed || loadVersion !== version) return;
        if (!plane.hidden) {
          page = priorPage; ready = true; message.hidden = true; controls();
          status.textContent = 'No se pudo abrir esa página. Inténtalo de nuevo.';
        } else throw err;
      }
    }
    function loadImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.draggable = false;
        image.alt = title;
        image.referrerPolicy = 'no-referrer';
        const cleanup = () => {
          image.onload = image.onerror = null;
          controller.signal.removeEventListener('abort', abort);
        };
        const abort = () => { cleanup(); image.removeAttribute('src'); reject(new DOMException('Cerrado','AbortError')); };
        image.onload = () => { cleanup(); resolve(image); };
        image.onerror = () => { cleanup(); reject(Error('No se pudo leer la imagen.')); };
        controller.signal.addEventListener('abort', abort, {once:true});
        image.src = url;
      });
    }

    async function load() {
      let url;
      try {
        url = attachmentUrl(options.url);
        if (options.blob instanceof Blob) fileBlob = options.blob;
        else if (typeof options.loadBlob === 'function') {
          try {
            fileBlob = await options.loadBlob(controller.signal);
            if (!(fileBlob instanceof Blob)) throw Error('El archivo no está disponible.');
          } catch (error) {
            if (error?.originalUrl && (error.allowImagePreview === true || error.allowOpenOriginal === true)) url = attachmentUrl(error.originalUrl);
            if (closed || controller.signal.aborted || pdf || !url || error?.allowImagePreview !== true) throw error;
            readOnly = true;
          }
        }
        else {
          if (!url) throw Error('El archivo no está disponible.');
          try {
            const response = await fetch(url, {cache:'no-store', referrerPolicy:'no-referrer', credentials:'same-origin', signal:controller.signal});
            if (!response.ok) throw Error('No se pudo recuperar el archivo.');
            fileBlob = await response.blob();
          } catch (error) {
            if (closed || pdf || !(error instanceof TypeError) || new URL(url).origin === location.origin) throw error;
            readOnly = true;
          }
        }
        if (closed) return;
        if (pdf) {
          if (!window.SmylChatPdf) throw Error('El lector de PDF todavía no está disponible.');
          const doc = await window.SmylChatPdf.open(fileBlob, {signal:controller.signal});
          if (closed) { doc.destroy(); return; }
          pdfDoc = doc;
          await loadPage(1);
        } else {
          if (fileBlob) blobUrl = URL.createObjectURL(fileBlob);
          loadedImage = await loadImage(blobUrl || url);
          if (closed) return;
          showPage(loadedImage, loadedImage.naturalWidth, loadedImage.naturalHeight);
          if (readOnly) status.textContent = 'Sólo lectura. El proveedor permite ver la imagen y restringe la edición.';
        }
      } catch (err) {
        if (closed) return;
        const reason = err?.message || '';
        const friendly = /contrase|protegid|cifrad|tamaño|demasiado|formato/i.test(reason) ? reason :
          (pdf ? 'No se pudo abrir el PDF.' : 'No se pudo abrir la imagen.');
        let fallback = err?.allowOpenOriginal === true ? url : '';
        if (fileBlob && (pdf || /^image\/(?:png|jpeg|webp|avif|gif|heic|heif|tiff|bmp)$/i.test(fileBlob.type))) {
          if (!blobUrl) blobUrl = URL.createObjectURL(pdf ? fileBlob.slice(0, fileBlob.size, 'application/pdf') : fileBlob);
          fallback = blobUrl;
        }
        showMessage(friendly, fallback);
        controls();
      }
    }
    function imageCopy() {
      const factor = Math.min(1, Math.sqrt(16000000 / (width * height)), 8192 / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * factor));
      canvas.height = Math.max(1, Math.round(height * factor));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(loadedImage, 0, 0, canvas.width, canvas.height);
      drawImageMarks(ctx, marks(), canvas.width, canvas.height);
      const format = fileBlob?.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      return new Promise((resolve, reject) => canvas.toBlob(blob => {
        canvas.width = canvas.height = 1;
        if (blob) resolve(blob); else reject(Error('No se pudo preparar la imagen.'));
      }, format, .94));
    }
    async function exportFile(attach) {
      if (!ready || busy || readOnly) return;
      if (hasDraft()) { status.textContent = 'Coloca tu texto antes de guardar.'; textField.focus(); return; }
      busy = true; controls();
      status.textContent = 'Preparando archivo…';
      try {
        const annotated = hasMarks();
        const blob = annotated ? (pdf ? await pdfDoc.exportCopy(pages) : await imageCopy()) : fileBlob;
        if (closed) return;
        const extension = pdf ? '.pdf' : blob.type === 'image/jpeg' ? '.jpg' : '.png';
        const baseName = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0,140) || 'Archivo';
        let fileName = baseName;
        if (annotated) fileName = baseName.replace(/\.[^.]{1,8}$/, '') + '-anotado' + extension;
        else if (!/\.[a-z0-9]{1,8}$/i.test(baseName)) {
          const imageExt = /^image\/(png|webp|avif|gif|heic|heif|tiff|bmp)$/i.exec(blob.type);
          fileName += imageExt ? '.' + imageExt[1].toLowerCase() : extension;
        }
        if (attach) {
          const attached = await options.onAttach(new File([blob], fileName, {type:blob.type || (pdf ? 'application/pdf' : 'image/png')}));
          if (attached === false) {
            if (!closed) status.textContent = 'La copia sigue disponible en el visor.';
            return;
          }
          if (!closed) finishClose();
        } else {
          const link = document.createElement('a');
          const downloadURL = URL.createObjectURL(blob);
          link.href = downloadURL; link.download = fileName;
          d.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(downloadURL), 60000);
          saved = revision;
          status.textContent = annotated ? 'Copia descargada.' : 'Descarga iniciada.';
        }
      } catch (err) {
        if (!closed) status.textContent = err?.message || 'No se pudo preparar el archivo. Vuelve a intentarlo.';
      } finally {
        busy = false; if (!closed) controls();
      }
    }

    const externalAbort = () => finishClose();
    const resize = new ResizeObserver(fit);
    function finishClose() {
      if (closed) return;
      closed = true;
      controller.abort();
      options.signal?.removeEventListener('abort', externalAbort);
      clearTimeout(detailTimer); cancelAnimationFrame(drawFrame); resize.disconnect();
      pointers.clear(); pages.clear(); undone.clear();
      try { pdfDoc?.destroy(); } catch (_) {}
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (d.open) d.close();
      d.remove();
      if (active?.dialog === d) active = null;
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
      if (closeDecision) { closeDecision.resolve(true); closeDecision = null; }
    }
    function requestClose(force) {
      if (closed) return Promise.resolve(true);
      if (force) { finishClose(); return Promise.resolve(true); }
      if (busy) return Promise.resolve(false);
      if (!dirty()) { finishClose(); return Promise.resolve(true); }
      if (closeDecision) return closeDecision.promise;
      find('.cmv-confirm').hidden = false;
      for (const section of d.children) if (!section.classList.contains('cmv-confirm')) section.inert = true;
      const resolver = {};
      resolver.promise = new Promise(resolve => { resolver.resolve = resolve; });
      closeDecision = resolver;
      act('keep').focus();
      return resolver.promise;
    }
    function keepEditing() {
      find('.cmv-confirm').hidden = true;
      for (const section of d.children) section.inert = false;
      closeDecision?.resolve(false); closeDecision = null;
      stage.focus({preventScroll:true});
    }
    function history(redo) {
      if (busy || !ready || readOnly) return;
      const current = marks(), future = undone.get(page) || [];
      if (redo && future.length) current.push(future.pop());
      else if (!redo && current.length) future.push(current.pop());
      else return;
      pages.set(page, current); undone.set(page, future); revision++;
      repaintMarks(); controls(); status.textContent = '';
    }

    d.addEventListener('click', e => {
      const target = e.target.closest('[data-cmv-action]');
      if (!target || target.disabled) return;
      const action = target.dataset.cmvAction;
      if (action === 'keep') { keepEditing(); return; }
      if (action === 'discard') { finishClose(); return; }
      if (action === 'close') { requestClose(); return; }
      if (closeDecision) return;
      if (['pan','pen','highlighter','text'].includes(action)) {
        if (hasDraft()) { textField.focus(); return; }
        resetEditor(); cancelStroke();
        tool = action; status.textContent = action === 'text' ? 'Toca el lugar donde quieres escribir.' : '';
        controls(); return;
      }
      switch (action) {
        case 'minus': setZoom(zoom / 1.25); break;
        case 'plus': setZoom(zoom * 1.25); break;
        case 'fit': setZoom(1); break;
        case 'prev': case 'next':
          if (hasDraft()) { textField.focus(); break; }
          loadPage(page + (action === 'prev' ? -1 : 1)); break;
        case 'undo': history(false); break;
        case 'redo': history(true); break;
        case 'place-text': commitText(); break;
        case 'cancel-text': resetEditor(); stage.focus({preventScroll:true}); break;
        case 'download': exportFile(false); break;
        case 'attach': exportFile(true); break;
      }
    });
    d.addEventListener('keydown', e => {
      if (closeDecision && e.key === 'Tab') {
        e.preventDefault(); (document.activeElement === act('keep') ? act('discard') : act('keep')).focus(); return;
      }
      if (e.target.matches('textarea,input,select') || closeDecision) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); history(e.shiftKey); }
    });
    d.addEventListener('cancel', e => {
      e.preventDefault();
      if (closeDecision) keepEditing();
      else if (!editor.hidden && !hasDraft()) resetEditor();
      else requestClose();
    });
    d.addEventListener('close', finishClose);
    controls(); document.body.append(d);
    d.showModal();
    act('close').focus({preventScroll:true});
    resize.observe(stage);
    options.signal?.addEventListener('abort', externalAbort, {once:true});
    return {dialog:d, requestClose, load};
  }

  window.SmylChatMediaViewer = {
    async open(options) {
      if (!options || options.signal?.aborted) return;
      const id = ++openId;
      if (active && !(await active.requestClose())) return;
      if (id !== openId || options.signal?.aborted) return;
      const viewer = create(options);
      active = viewer;
      await viewer.load();
    },
    close(force = false) {
      if (force) openId++;
      return active ? active.requestClose(force) : Promise.resolve(true);
    }
  };
})();
