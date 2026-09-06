const FDI = ['13', '12', '11', '21', '22', '23'];
const MASK_COLORS = [[69, 214, 168], [87, 190, 245], [114, 99, 255], [176, 91, 238], [244, 114, 182], [251, 146, 60]];

const ui = {
  input: document.getElementById('file-input'), empty: document.getElementById('empty'), stage: document.getElementById('stage'),
  photo: document.getElementById('photo'), mask: document.getElementById('mask'), markers: document.getElementById('markers'),
  status: document.getElementById('model-status'), title: document.getElementById('status-title'), detail: document.getElementById('status-detail'), progress: document.getElementById('progress-bar'),
  positive: document.getElementById('positive'), negative: document.getElementById('negative'), opacity: document.getElementById('opacity'), opacityValue: document.getElementById('opacity-value'),
  clear: document.getElementById('clear'), change: document.getElementById('change-photo'), download: document.getElementById('download'), demo: document.getElementById('synthetic-demo'), reference: document.getElementById('reference-demo'), segmentAll: document.getElementById('segment-all'),
  toothButtons: [...document.querySelectorAll('[data-tooth]')], score: document.getElementById('score'), coverage: document.getElementById('coverage'), points: document.getElementById('points-count'), time: document.getElementById('time')
};

const state = {
  mode: 'positive', encoded: false, modelReady: false, selectedTooth: 0,
  teeth: FDI.map((fdi) => ({ fdi, center: null, exclusions: [], binary: null, score: null })),
  requestId: 0, acceptedRequestId: 0, imageUrl: '', labelImage: null
};
const qaAuto = new URLSearchParams(location.search).has('qaAuto');
const worker = new Worker(new URL('./segmentacion-dental-worker.js?v=phase-2b-3', import.meta.url), { type: 'module' });

function setStatus(kind, title, detail) {
  ui.status.className = `status ${kind || ''}`;
  ui.title.textContent = title;
  ui.detail.textContent = detail || '';
}

function placedCount() { return state.teeth.filter((tooth) => tooth.center).length; }

function resetMetrics() {
  ui.score.textContent = '—'; ui.coverage.textContent = '—'; ui.time.textContent = '—';
  ui.points.textContent = `${placedCount()}/6`;
}

function clearMask() {
  ui.mask.getContext('2d').clearRect(0, 0, ui.mask.width, ui.mask.height);
  state.labelImage = null;
  state.invalidTeeth = [];
  state.teeth.forEach((tooth) => { tooth.binary = null; tooth.score = null; });
  ui.download.disabled = true;
}

function selectTooth(index) {
  state.selectedTooth = Math.max(0, Math.min(5, Number(index)));
  ui.toothButtons.forEach((button, buttonIndex) => button.classList.toggle('active', buttonIndex === state.selectedTooth));
  renderMarkers();
}

function updateControls() {
  const count = placedCount();
  ui.points.textContent = `${count}/6`;
  ui.clear.disabled = count === 0;
  ui.segmentAll.disabled = !state.encoded || count !== 6;
  ui.toothButtons.forEach((button, index) => button.classList.toggle('placed', Boolean(state.teeth[index].center)));
  ui.toothButtons.forEach((button, index) => button.classList.toggle('invalid', (state.invalidTeeth || []).includes(index)));
}

function clearPrompts() {
  state.acceptedRequestId = ++state.requestId;
  state.teeth.forEach((tooth) => { tooth.center = null; tooth.exclusions = []; });
  state.selectedTooth = 0;
  clearMask(); resetMetrics(); updateControls(); selectTooth(0);
  if (state.encoded) setStatus('ready', 'Imagen lista', 'Marca el centro de las piezas 13 a 23.');
}

function setMode(mode) {
  state.mode = mode;
  ui.positive.classList.toggle('active', mode === 'positive');
  ui.negative.classList.toggle('active', mode === 'negative');
  setStatus('ready', mode === 'positive' ? `Marcando pieza ${FDI[state.selectedTooth]}` : `Afinando pieza ${FDI[state.selectedTooth]}`, mode === 'positive' ? 'Toca aproximadamente el centro visible del diente.' : 'Toca la zona que debe quedar fuera de esta pieza.');
}

function renderMarkers() {
  ui.markers.replaceChildren();
  state.teeth.forEach((tooth, toothIndex) => {
    if (tooth.center) {
      const marker = document.createElement('i');
      marker.className = 'marker positive tooth-center'; marker.textContent = tooth.fdi;
      marker.style.left = `${tooth.center.x * 100}%`; marker.style.top = `${tooth.center.y * 100}%`;
      ui.markers.appendChild(marker);
    }
    if (toothIndex === state.selectedTooth) tooth.exclusions.forEach((point) => {
      const marker = document.createElement('i'); marker.className = 'marker negative';
      marker.style.left = `${point.x * 100}%`; marker.style.top = `${point.y * 100}%`;
      ui.markers.appendChild(marker);
    });
  });
}

function maskContains(mask, candidate, point, count) {
  const x = Math.max(0, Math.min(mask.width - 1, Math.round(point.x * (mask.width - 1))));
  const y = Math.max(0, Math.min(mask.height - 1, Math.round(point.y * (mask.height - 1))));
  return mask.data[(y * mask.width + x) * count + candidate] > 0;
}

function bestMaskIndex(mask, scores, toothIndex) {
  const count = scores.length; const center = state.teeth[toothIndex].center;
  let best = 0; let bestRank = -Infinity;
  for (let candidate = 0; candidate < count; candidate += 1) {
    const ownHit = maskContains(mask, candidate, center, count);
    const foreignHits = state.teeth.reduce((hits, tooth, index) => hits + (index !== toothIndex && maskContains(mask, candidate, tooth.center, count) ? 1 : 0), 0);
    const rank = Math.max(0, Math.min(1, scores[candidate] || 0)) + (ownHit ? 1 : -2) - foreignHits * .5;
    if (rank > bestRank) { bestRank = rank; best = candidate; }
  }
  return best;
}

function binaryFromResult(mask, scores, toothIndex) {
  const best = bestMaskIndex(mask, scores, toothIndex); const pixels = mask.width * mask.height; const count = scores.length;
  const binary = new Uint8Array(pixels); let selected = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) if (mask.data[count * pixel + best] > 0) { binary[pixel] = 1; selected += 1; }
  const ownHit = maskContains(mask, best, state.teeth[toothIndex].center, count);
  const foreignHits = state.teeth.reduce((hits, tooth, index) => hits + (index !== toothIndex && maskContains(mask, best, tooth.center, count) ? 1 : 0), 0);
  return { binary, selected, score: Math.max(0, Math.min(1, scores[best] || 0)), valid: ownHit && foreignHits === 0, width: mask.width, height: mask.height };
}

function drawBatchMasks(results) {
  if (!results.length) return;
  const { width, height } = results[0]; ui.mask.width = width; ui.mask.height = height;
  const ctx = ui.mask.getContext('2d'); const image = ctx.createImageData(width, height); const labels = new Uint8Array(width * height);
  let union = 0; let collisions = 0;
  results.forEach((result, toothIndex) => {
    const tooth = state.teeth[toothIndex]; tooth.binary = result.binary; tooth.score = result.score;
    const color = MASK_COLORS[toothIndex];
    for (let pixel = 0; pixel < result.binary.length; pixel += 1) if (result.binary[pixel]) {
      if (!labels[pixel]) union += 1; else if (labels[pixel] !== toothIndex + 1) collisions += 1;
      labels[pixel] = toothIndex + 1;
      const offset = pixel * 4; image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
    }
  });
  ctx.putImageData(image, 0, 0); state.labelImage = { width, height, labels };
  const mean = results.reduce((sum, result) => sum + result.score, 0) / results.length;
  ui.score.textContent = `${Math.round(mean * 100)}%`;
  ui.coverage.textContent = `${((union / Math.max(1, width * height)) * 100).toFixed(1)}%`;
  state.overlapRatio = collisions / Math.max(1, union); state.invalidTeeth = results.map((result, index) => result.valid ? -1 : index).filter((index) => index >= 0); state.invalidMasks = state.invalidTeeth.length;
  ui.download.disabled = state.overlapRatio > .08 || state.invalidMasks > 0;
}

function segmentAll() {
  if (!state.encoded || placedCount() !== 6) return;
  clearMask(); const requestId = ++state.requestId;
  setStatus('', 'Separando seis piezas', 'Cada diente usa los otros cinco centros como exclusiones automáticas…');
  ui.segmentAll.disabled = true;
  worker.postMessage({ type: 'decode_batch', requestId, teeth: state.teeth.map((tooth) => ({ center: tooth.center, exclusions: tooth.exclusions })) });
}

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('No se pudo leer la fotografía.'));
    reader.onload = () => {
      const image = new Image(); image.onerror = () => reject(new Error('El archivo no contiene una imagen válida.'));
      image.onload = () => {
        const maxSide = 1600; const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale)); const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, width, height);
        resolve({ url: canvas.toDataURL('image/jpeg', .93), width, height });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function loadPhoto(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { setStatus('error', 'Archivo no compatible', 'Selecciona una fotografía JPG, PNG o WebP.'); return; }
  if (file.size > 20 * 1024 * 1024) { setStatus('error', 'Fotografía demasiado grande', 'El límite de este laboratorio es 20 MB.'); return; }
  try { setStatus('', 'Preparando fotografía', 'Redimensionando localmente para acelerar la prueba…'); usePreparedImage(await resizePhoto(file)); }
  catch (error) { setStatus('error', 'No pudimos abrir la fotografía', error.message); }
}

function usePreparedImage(image) {
  state.encoded = false; state.imageUrl = image.url; clearPrompts(); ui.photo.src = image.url;
  ui.stage.style.aspectRatio = `${image.width} / ${image.height}`; ui.stage.style.display = 'block'; ui.empty.style.display = 'none';
  ui.mask.width = image.width; ui.mask.height = image.height; setStatus('', 'Analizando fotografía', 'Creando una representación local reutilizable…');
  worker.postMessage({ type: 'segment', data: image.url });
}

function syntheticSmile() {
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 640; const ctx = canvas.getContext('2d');
  const skin = ctx.createRadialGradient(480, 260, 50, 480, 320, 620); skin.addColorStop(0, '#d99b78'); skin.addColorStop(1, '#8e5946'); ctx.fillStyle = skin; ctx.fillRect(0, 0, 960, 640);
  ctx.fillStyle = '#5a2330'; ctx.beginPath(); ctx.ellipse(480, 365, 326, 142, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1e1117'; ctx.beginPath(); ctx.ellipse(480, 362, 278, 91, 0, 0, Math.PI * 2); ctx.fill();
  const widths = [74, 88, 112, 112, 88, 74], start = 204, gap = 7; let x = start;
  widths.forEach((width, index) => {
    const height = index === 2 || index === 3 ? 132 : index === 1 || index === 4 ? 116 : 106; const top = 292 + Math.abs(2.5 - index) * 5;
    const enamel = ctx.createLinearGradient(x, top, x + width, top + height); enamel.addColorStop(0, '#e7dcc5'); enamel.addColorStop(.45, '#fffdf2'); enamel.addColorStop(1, '#d5c6aa');
    ctx.fillStyle = enamel; ctx.strokeStyle = '#b7a58a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 10, top + 4); ctx.quadraticCurveTo(x + width / 2, top - 8, x + width - 10, top + 4); ctx.lineTo(x + width - 4, top + height - 18); ctx.quadraticCurveTo(x + width / 2, top + height + 8, x + 4, top + height - 18); ctx.closePath(); ctx.fill(); ctx.stroke(); x += width + gap;
  });
  return { url: canvas.toDataURL('image/jpeg', .96), width: canvas.width, height: canvas.height };
}

function useReferencePhoto() {
  const image = new Image();
  image.onload = () => usePreparedImage({ url: image.src, width: image.naturalWidth, height: image.naturalHeight });
  image.onerror = () => setStatus('error', 'No se pudo abrir la referencia', 'Recarga la página para descargar nuevamente el archivo de prueba.');
  image.src = new URL('./assets/references/smyl-segmentation-reference-v1.png', import.meta.url).href;
}

worker.addEventListener('message', (event) => {
  const { type, data, requestId } = event.data || {};
  if (type === 'progress') {
    if (ui.status.classList.contains('error')) return; const value = Number(data && data.progress);
    if (Number.isFinite(value)) ui.progress.style.width = `${Math.max(0, Math.min(100, value))}%`;
    if (data && data.file) ui.detail.textContent = `Descargando ${data.file.split('/').pop()}…`;
  } else if (type === 'ready') {
    state.modelReady = true; ui.progress.style.width = '100%'; ui.input.disabled = false; ui.demo.disabled = false; ui.change.disabled = false;
    if (!state.imageUrl && qaAuto) usePreparedImage(syntheticSmile());
    else if (!state.imageUrl) setStatus('ready', 'Modelo local preparado', 'Selecciona una fotografía para comenzar.');
  } else if (type === 'encoding') setStatus('', 'Analizando fotografía', 'La primera imagen puede tardar un poco según el dispositivo.');
  else if (type === 'encoded') {
    state.encoded = true;
    if (qaAuto && placedCount() === 0) {
      [[.251,.56],[.343,.56],[.454,.56],[.578,.56],[.69,.56],[.781,.56]].forEach(([x, y], index) => { state.teeth[index].center = { x, y }; });
      state.selectedTooth = 5; renderMarkers(); updateControls(); segmentAll();
    } else { updateControls(); setStatus('ready', 'Imagen lista', 'Marca el centro de las piezas 13 a 23.'); }
  }
  else if (type === 'batch_progress') {
    if (requestId < state.requestId) return;
    setStatus('', `Separando pieza ${data.completed} de ${data.total}`, 'Aplicando exclusiones automáticas entre dientes…');
  } else if (type === 'batch_decoded') {
    if (requestId < state.acceptedRequestId || requestId < state.requestId) return;
    state.acceptedRequestId = requestId;
    const results = data.results.map((result, toothIndex) => binaryFromResult(result.mask, result.scores, toothIndex));
    drawBatchMasks(results); ui.time.textContent = `${Math.round(data.elapsedMs)} ms`; updateControls();
    if (state.invalidMasks > 0) {
      selectTooth(state.invalidTeeth[0]);
      setStatus('error', `Revisa ${state.invalidTeeth.map((index) => FDI[index]).join(', ')}`, 'La pieza marcada en rojo invadió otro centro. Añade una exclusión y vuelve a separar.');
    }
    else if (state.overlapRatio > .08) setStatus('error', 'Las piezas todavía se superponen', 'Selecciona la pieza afectada, añade una exclusión y vuelve a separar.');
    else setStatus('ready', 'Seis máscaras calculadas', 'Cada color corresponde a una pieza independiente. Selecciona una pieza y añade exclusiones si necesita ajuste.');
  } else if (type === 'error') {
    console.error('SMYL_SEGMENTATION_WORKER:', data.message); updateControls();
    if (/acción de segmentación desconocida/i.test(data.message)) setStatus('error', 'El navegador conservó una versión anterior', 'Recarga con Ctrl + F5 y vuelve a pulsar “Separar las 6 piezas”.');
    else setStatus('error', 'No se pudo ejecutar el modelo', `${data.message} Comprueba tu conexión durante la primera carga.`);
  }
});

worker.addEventListener('error', () => setStatus('error', 'No se pudo iniciar el modelo', 'Este navegador puede bloquear módulos o almacenamiento del modelo.'));
ui.input.disabled = false; ui.demo.disabled = true; ui.change.disabled = false; worker.postMessage({ type: 'load' });

ui.input.addEventListener('change', (event) => loadPhoto(event.target.files && event.target.files[0]));
ui.reference.addEventListener('click', useReferencePhoto);
ui.demo.addEventListener('click', () => usePreparedImage(syntheticSmile()));
ui.positive.addEventListener('click', () => setMode('positive')); ui.negative.addEventListener('click', () => setMode('negative'));
ui.toothButtons.forEach((button) => button.addEventListener('click', () => selectTooth(button.dataset.tooth)));
ui.segmentAll.addEventListener('click', segmentAll); ui.clear.addEventListener('click', clearPrompts);
ui.change.addEventListener('click', () => { ui.input.value = ''; ui.input.click(); });
ui.opacity.addEventListener('input', () => { ui.mask.style.opacity = String(Number(ui.opacity.value) / 100); ui.opacityValue.textContent = `${ui.opacity.value}%`; });
ui.mask.style.opacity = String(Number(ui.opacity.value) / 100);

ui.stage.addEventListener('pointerdown', (event) => {
  if (!state.encoded) return; const rect = ui.stage.getBoundingClientRect();
  const point = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  const tooth = state.teeth[state.selectedTooth]; clearMask();
  if (event.button === 2 || state.mode === 'negative') tooth.exclusions.push(point);
  else {
    tooth.center = point;
    const nextMissing = state.teeth.findIndex((item, index) => index > state.selectedTooth && !item.center);
    if (nextMissing >= 0) state.selectedTooth = nextMissing;
  }
  renderMarkers(); updateControls();
  if (placedCount() === 6) setStatus('ready', 'Seis centros registrados', 'Pulsa “Separar las 6 piezas” para generar máscaras independientes.');
  else setStatus('ready', `Ahora marca la pieza ${FDI[state.selectedTooth]}`, `${placedCount()} de 6 centros registrados.`);
});
ui.stage.addEventListener('contextmenu', (event) => event.preventDefault());

ui.download.addEventListener('click', () => {
  if (!state.labelImage) return;
  const output = document.createElement('canvas'); output.width = state.labelImage.width; output.height = state.labelImage.height;
  const ctx = output.getContext('2d'); const image = ctx.createImageData(output.width, output.height);
  for (let pixel = 0; pixel < state.labelImage.labels.length; pixel += 1) {
    const label = state.labelImage.labels[pixel]; if (!label) continue; const color = MASK_COLORS[label - 1]; const offset = pixel * 4;
    image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0); const link = document.createElement('a'); link.download = 'smyl-mapa-13-12-11-21-22-23.png'; link.href = output.toDataURL('image/png'); link.click();
});
