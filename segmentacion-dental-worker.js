import { env, SamModel, AutoProcessor, RawImage, Tensor } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'Xenova/slimsam-77-uniform';
let modelPromise = null;
let processorPromise = null;
let imageInputs = null;
let imageEmbeddings = null;

function automaticBoundaryNegatives(teeth, toothIndex) {
  const center = teeth[toothIndex].center;
  const neighbors = [teeth[toothIndex - 1], teeth[toothIndex + 1]].filter(Boolean);
  const gaps = neighbors.map((tooth) => Math.abs(tooth.center.x - center.x)).filter((gap) => gap > 0);
  const span = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : .06;
  const points = neighbors.map((tooth) => ({ x: (center.x + tooth.center.x) / 2, y: (center.y + tooth.center.y) / 2, label: 0 }));
  points.push({ x: center.x, y: Math.max(0, center.y - span * 1.35), label: 0 });
  points.push({ x: center.x, y: Math.min(1, center.y + span * 1.35), label: 0 });
  return points;
}

function progress(update) {
  self.postMessage({ type: 'progress', data: update || {} });
}

function loadModel() {
  if (!modelPromise) {
    modelPromise = SamModel.from_pretrained(MODEL_ID, { quantized: true, progress_callback: progress });
    processorPromise = AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: progress });
  }
  return Promise.all([modelPromise, processorPromise]);
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    const [model, processor] = await loadModel();
    if (message.type === 'load') {
      self.postMessage({ type: 'ready', data: { model: MODEL_ID } });
      return;
    }
    if (message.type === 'reset') {
      imageInputs = null;
      imageEmbeddings = null;
      self.postMessage({ type: 'reset_done' });
      return;
    }
    if (message.type === 'segment') {
      self.postMessage({ type: 'encoding' });
      const image = await RawImage.read(message.data);
      imageInputs = await processor(image);
      imageEmbeddings = await model.get_image_embeddings(imageInputs);
      self.postMessage({ type: 'encoded' });
      return;
    }
    if (message.type === 'decode') {
      if (!imageInputs || !imageEmbeddings) throw new Error('La imagen todavía no está preparada.');
      const reshaped = imageInputs.reshaped_input_sizes[0];
      const prompts = message.points || [];
      const points = prompts.map((item) => [item.x * reshaped[1], item.y * reshaped[0]]);
      const labels = prompts.map((item) => BigInt(item.label));
      const inputPoints = new Tensor('float32', points.flat(), [1, 1, points.length, 2]);
      const inputLabels = new Tensor('int64', labels, [1, 1, labels.length]);
      const started = performance.now();
      const outputs = await model({ ...imageEmbeddings, input_points: inputPoints, input_labels: inputLabels });
      const masks = await processor.post_process_masks(outputs.pred_masks, imageInputs.original_sizes, imageInputs.reshaped_input_sizes);
      self.postMessage({ type: 'decoded', requestId: message.requestId, data: { mask: RawImage.fromTensor(masks[0][0]), scores: Array.from(outputs.iou_scores.data), elapsedMs: performance.now() - started } });
      return;
    }
    if (message.type === 'decode_batch') {
      if (!imageInputs || !imageEmbeddings) throw new Error('La imagen todavía no está preparada.');
      const teeth = message.teeth || [];
      if (teeth.length !== 6 || teeth.some((tooth) => !tooth.center)) throw new Error('Se requieren los seis centros dentales.');
      const reshaped = imageInputs.reshaped_input_sizes[0];
      const started = performance.now();
      const results = [];
      for (let toothIndex = 0; toothIndex < teeth.length; toothIndex += 1) {
        const prompts = teeth.map((tooth, index) => ({ ...tooth.center, label: index === toothIndex ? 1 : 0 }));
        prompts.push(...automaticBoundaryNegatives(teeth, toothIndex));
        for (const exclusion of teeth[toothIndex].exclusions || []) prompts.push({ ...exclusion, label: 0 });
        const points = prompts.map((item) => [item.x * reshaped[1], item.y * reshaped[0]]);
        const labels = prompts.map((item) => BigInt(item.label));
        const inputPoints = new Tensor('float32', points.flat(), [1, 1, points.length, 2]);
        const inputLabels = new Tensor('int64', labels, [1, 1, labels.length]);
        const outputs = await model({ ...imageEmbeddings, input_points: inputPoints, input_labels: inputLabels });
        const masks = await processor.post_process_masks(outputs.pred_masks, imageInputs.original_sizes, imageInputs.reshaped_input_sizes);
        results.push({ mask: RawImage.fromTensor(masks[0][0]), scores: Array.from(outputs.iou_scores.data) });
        self.postMessage({ type: 'batch_progress', requestId: message.requestId, data: { completed: toothIndex + 1, total: teeth.length } });
      }
      self.postMessage({ type: 'batch_decoded', requestId: message.requestId, data: { results, elapsedMs: performance.now() - started } });
      return;
    }
    throw new Error('Acción de segmentación desconocida.');
  } catch (error) {
    self.postMessage({ type: 'error', data: { message: error && error.message ? error.message : String(error) } });
  }
};
