const ui = {
  input: document.getElementById('file-input'), empty: document.getElementById('empty'), stage: document.getElementById('stage'),
  photo: document.getElementById('photo'), mask: document.getElementById('mask'), markers: document.getElementById('markers'),
  status: document.getElementById('model-status'), title: document.getElementById('status-title'), detail: document.getElementById('status-detail'), progress: document.getElementById('progress-bar'),
  positive: document.getElementById('positive'), negative: document.getElementById('negative'), opacity: document.getElementById('opacity'), opacityValue: document.getElementById('opacity-value'),
  clear: document.getElementById('clear'), change: document.getElementById('change-photo'), download: document.getElementById('download'), demo: document.getElementById('synthetic-demo'),
  score: document.getElementById('score'), coverage: document.getElementById('coverage'), points: document.getElementById('points-count'), time: document.getElementById('time')
};

const state = { mode: 'positive', encoded: false, modelReady: false, points: [], requestId: 0, acceptedRequestId: 0, imageUrl: '', maskImage: null, scores: [] };
const worker = new Worker(new URL('./segmentacion-dental-worker.js', import.meta.url), { type: 'module' });

function setStatus(kind, title, detail) {
  ui.status.className = `status ${kind || ''}`;
  ui.title.textContent = title;
  ui.detail.textContent = detail || '';
}

function resetMetrics() {
  ui.score.textContent = '—'; ui.coverage.textContent = '—'; ui.time.textContent = '—';
  ui.points.textContent = String(state.points.length);
}

function clearMask() {
  const ctx = ui.mask.getContext('2d');
  ctx.clearRect(0, 0, ui.mask.width, ui.mask.height);
  state.maskImage = null; state.scores = []; ui.download.disabled = true;
}

function clearPrompts() {
  state.points = [];
  state.acceptedRequestId = ++state.requestId;
  ui.markers.replaceChildren();
  ui.clear.disabled = true;
  clearMask(); resetMetrics();
  if (state.encoded) setStatus('ready', 'Imagen lista', 'Toca dentro de un diente para crear la máscara.');
}

function setMode(mode) {
  state.mode = mode;
  ui.positive.classList.toggle('active', mode === 'positive');
  ui.negative.classList.toggle('active', mode === 'negative');
}

function addMarker(point) {
  const marker = document.createElement('i');
  marker.className = `marker ${point.label === 1 ? 'positive' : 'negative'}`;
  marker.style.left = `${point.x * 100}%`;
  marker.style.top = `${point.y * 100}%`;
  ui.markers.appendChild(marker);
}

function bestMaskIndex(scores) {
  let best = 0;
  for (let i = 1; i < scores.length; i += 1) if (scores[i] > scores[best]) best = i;
  return best;
}

function drawMask(mask, scores) {
  const width = mask.width, height = mask.height, count = scores.length;
  ui.mask.width = width; ui.mask.height = height;
  const ctx = ui.mask.getContext('2d');
  const image = ctx.createImageData(width, height);
  const best = bestMaskIndex(scores);
  let selected = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (mask.data[count * pixel + best] > 0) {
      const offset = pixel * 4;
      image.data[offset] = 82; image.data[offset + 1] = 98; image.data[offset + 2] = 255; image.data[offset + 3] = 255;
      selected += 1;
    }
  }
  ctx.putImageData(image, 0, 0);
  state.maskImage = image; state.scores = scores;
  ui.score.textContent = scores[best] == null ? '—' : `${Math.round(Math.max(0, Math.min(1, scores[best])) * 100)}%`;
  ui.coverage.textContent = `${((selected / Math.max(1, width * height)) * 100).toFixed(1)}%`;
  ui.download.disabled = selected === 0;
}

function decode() {
  if (!state.encoded || !state.points.length) return;
  const requestId = ++state.requestId;
  setStatus('', 'Calculando máscara', 'Ajustando el límite con tus puntos guía…');
  worker.postMessage({ type: 'decode', requestId, points: state.points });
}

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la fotografía.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('El archivo no contiene una imagen válida.'));
      image.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
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
  try {
    setStatus('', 'Preparando fotografía', 'Redimensionando localmente para acelerar la prueba…');
    const image = await resizePhoto(file);
    usePreparedImage(image);
  } catch (error) {
    setStatus('error', 'No pudimos abrir la fotografía', error.message);
  }
}

function usePreparedImage(image) {
  state.encoded = false; state.imageUrl = image.url; clearPrompts();
  ui.photo.src = image.url;
  ui.stage.style.aspectRatio = `${image.width} / ${image.height}`;
  ui.stage.style.display = 'block'; ui.empty.style.display = 'none';
  ui.mask.width = image.width; ui.mask.height = image.height;
  setStatus('', 'Analizando fotografía', 'Creando una representación local reutilizable…');
  worker.postMessage({ type: 'segment', data: image.url });
}

function syntheticSmile() {
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 640;
  const ctx = canvas.getContext('2d');
  const skin = ctx.createRadialGradient(480, 260, 50, 480, 320, 620); skin.addColorStop(0, '#d99b78'); skin.addColorStop(1, '#8e5946'); ctx.fillStyle = skin; ctx.fillRect(0, 0, 960, 640);
  ctx.fillStyle = '#5a2330'; ctx.beginPath(); ctx.ellipse(480, 365, 326, 142, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1e1117'; ctx.beginPath(); ctx.ellipse(480, 362, 278, 91, 0, 0, Math.PI * 2); ctx.fill();
  const widths = [74, 88, 112, 112, 88, 74], start = 204, gap = 7;
  let x = start;
  widths.forEach((width, index) => {
    const height = index === 2 || index === 3 ? 132 : index === 1 || index === 4 ? 116 : 106;
    const top = 292 + Math.abs(2.5 - index) * 5;
    const enamel = ctx.createLinearGradient(x, top, x + width, top + height); enamel.addColorStop(0, '#e7dcc5'); enamel.addColorStop(.45, '#fffdf2'); enamel.addColorStop(1, '#d5c6aa');
    ctx.fillStyle = enamel; ctx.strokeStyle = '#b7a58a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + 10, top + 4); ctx.quadraticCurveTo(x + width / 2, top - 8, x + width - 10, top + 4); ctx.lineTo(x + width - 4, top + height - 18); ctx.quadraticCurveTo(x + width / 2, top + height + 8, x + 4, top + height - 18); ctx.closePath(); ctx.fill(); ctx.stroke();
    x += width + gap;
  });
  return { url: canvas.toDataURL('image/jpeg', .96), width: canvas.width, height: canvas.height };
}

worker.addEventListener('message', (event) => {
  const { type, data, requestId } = event.data || {};
  if (type === 'progress') {
    if (ui.status.classList.contains('error')) return;
    const value = Number(data && data.progress);
    if (Number.isFinite(value)) ui.progress.style.width = `${Math.max(0, Math.min(100, value))}%`;
    if (data && data.file) ui.detail.textContent = `Descargando ${data.file.split('/').pop()}…`;
  } else if (type === 'ready') {
    state.modelReady = true; ui.progress.style.width = '100%';
    ui.input.disabled = false; ui.demo.disabled = false; ui.change.disabled = false;
    if (!state.imageUrl) setStatus('ready', 'Modelo local preparado', 'Selecciona una fotografía para comenzar.');
  } else if (type === 'encoding') {
    setStatus('', 'Analizando fotografía', 'La primera imagen puede tardar un poco según el dispositivo.');
  } else if (type === 'encoded') {
    state.encoded = true; setStatus('ready', 'Imagen lista', 'Toca dentro de un diente para crear la máscara.');
  } else if (type === 'decoded') {
    if (requestId < state.acceptedRequestId || requestId < state.requestId) return;
    state.acceptedRequestId = requestId;
    drawMask(data.mask, data.scores);
    ui.time.textContent = `${Math.round(data.elapsedMs)} ms`;
    setStatus('ready', 'Máscara calculada', 'Añade puntos de inclusión o exclusión para mejorar el límite.');
  } else if (type === 'error') {
    console.error('SMYL_SEGMENTATION_WORKER:', data.message);
    setStatus('error', 'No se pudo ejecutar el modelo', `${data.message} Comprueba tu conexión durante la primera carga.`);
  }
});

worker.addEventListener('error', () => setStatus('error', 'No se pudo iniciar el modelo', 'Este navegador puede bloquear módulos o almacenamiento del modelo.'));
ui.input.disabled = true; ui.demo.disabled = true; ui.change.disabled = true;
worker.postMessage({ type: 'load' });

ui.input.addEventListener('change', (event) => loadPhoto(event.target.files && event.target.files[0]));
ui.demo.addEventListener('click', () => usePreparedImage(syntheticSmile()));
ui.positive.addEventListener('click', () => setMode('positive'));
ui.negative.addEventListener('click', () => setMode('negative'));
ui.clear.addEventListener('click', clearPrompts);
ui.change.addEventListener('click', () => { ui.input.value = ''; ui.input.click(); });
ui.opacity.addEventListener('input', () => { ui.mask.style.opacity = String(Number(ui.opacity.value) / 100); ui.opacityValue.textContent = `${ui.opacity.value}%`; });
ui.mask.style.opacity = String(Number(ui.opacity.value) / 100);

ui.stage.addEventListener('pointerdown', (event) => {
  if (!state.encoded) return;
  const rect = ui.stage.getBoundingClientRect();
  const point = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)), label: (event.button === 2 || state.mode === 'negative') ? 0 : 1 };
  state.points.push(point); addMarker(point); ui.points.textContent = String(state.points.length); ui.clear.disabled = false; decode();
});
ui.stage.addEventListener('contextmenu', (event) => event.preventDefault());

ui.download.addEventListener('click', () => {
  if (!state.maskImage) return;
  const output = document.createElement('canvas'); output.width = state.maskImage.width; output.height = state.maskImage.height;
  const ctx = output.getContext('2d'); const binary = ctx.createImageData(output.width, output.height);
  for (let i = 0; i < state.maskImage.data.length; i += 4) if (state.maskImage.data[i + 3]) { binary.data[i] = 255; binary.data[i + 1] = 255; binary.data[i + 2] = 255; binary.data[i + 3] = 255; }
  ctx.putImageData(binary, 0, 0);
  const link = document.createElement('a'); link.download = 'smyl-mascara-dental.png'; link.href = output.toDataURL('image/png'); link.click();
});
