(function () {
  'use strict';

  const scriptUrl = document.currentScript.src;
  const readerUrl = new URL('vendor/pdfjs-6.5.438/', scriptUrl);
  const writerUrl = new URL('vendor/pdf-lib-1.17.1.min.mjs', scriptUrl);
  const maxPixels = 8 * 1024 * 1024;
  const maxSide = 4096;

  function canvasScale(width, height, requested) {
    return Math.min(requested, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  }

  function paintOverlay(canvas, width, height, marks) {
    const context = canvas.getContext('2d');
    context.scale(canvas.width / width, canvas.height / height);
    context.lineCap = context.lineJoin = 'round';
    for (const mark of marks) {
      const size = mark.size * Math.min(width, height);
      if (!Number.isFinite(size) || size <= 0) continue;
      context.strokeStyle = context.fillStyle = mark.color;
      context.globalAlpha = mark.tool === 'highlighter' ? 0.38 : 1;
      if (mark.tool === 'text') {
        context.font = size + 'px Arial, sans-serif';
        String(mark.text).split('\n').forEach((line, index) => {
          context.fillText(line, mark.x * width, mark.y * height + size * (1 + index * 1.24));
        });
        continue;
      }
      const points = mark.points || [];
      if (!points.length) continue;
      const x = points[0].x * width;
      const y = points[0].y * height;
      context.beginPath();
      if (points.length === 1) {
        context.arc(x, y, size / 2, 0, 2 * Math.PI);
        context.fill();
        continue;
      }
      context.moveTo(x, y);
      for (let i = 1; i < points.length; i++) context.lineTo(points[i].x * width, points[i].y * height);
      context.lineWidth = size;
      context.stroke();
    }
  }

  async function addOverlay(writer, target, viewport, marks, lib) {
    const { width, height } = viewport;
    const canvas = document.createElement('canvas');
    const scale = canvasScale(width, height, 3);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    try {
      paintOverlay(canvas, width, height, marks);
      const png = await new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('No se pudieron exportar las anotaciones.'));
      }, 'image/png'));
      const overlay = await writer.embedPng(await png.arrayBuffer());
      // Convert the three displayed corners through the original crop box, user units and rotation.
      const [x, y] = viewport.convertToPdfPoint(0, height);
      const [rightX, rightY] = viewport.convertToPdfPoint(width, height);
      const [topX, topY] = viewport.convertToPdfPoint(0, 0);
      target.drawImage(overlay, {
        x, y, width: Math.hypot(rightX - x, rightY - y), height: Math.hypot(topX - x, topY - y),
        rotate: lib.degrees(Math.atan2(rightY - y, rightX - x) * 180 / Math.PI),
      });
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  async function open(blob, { signal } = {}) {
    const abortError = () => new DOMException('Se cerró el documento.', 'AbortError');
    if (signal?.aborted) throw abortError();
    const [reader, buffer] = await Promise.all([import(new URL('pdf.min.mjs', readerUrl).href), blob.arrayBuffer()]);
    if (signal?.aborted) throw abortError();
    reader.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', readerUrl).href;
    const loading = reader.getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: new URL('cmaps/', readerUrl).href, cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', readerUrl).href,
      wasmUrl: new URL('wasm/', readerUrl).href,
      iccUrl: new URL('iccs/', readerUrl).href,
      enableXfa: false,
    });
    let disposed = false;
    const targets = new WeakMap();
    let cleanup;
    function destroy() {
      if (disposed) return cleanup;
      disposed = true;
      signal?.removeEventListener('abort', destroy);
      cleanup = loading.destroy();
      // Abort listeners cannot await teardown; its promise is also available to explicit callers.
      cleanup.catch(() => {});
      return cleanup;
    }
    signal?.addEventListener('abort', destroy, { once: true });
    let pdf;
    try {
      pdf = await loading.promise;
      if (disposed) throw abortError();
    } catch (error) {
      const wasClosed = disposed;
      await destroy().catch(() => {});
      if (wasClosed) throw abortError();
      if (error.name === 'PasswordException') throw new Error('Este PDF está protegido con contraseña. Abre el original en tu lector de PDF.');
      throw error;
    }

    async function render(pageNumber, canvas, scale = 1) {
      if (disposed) throw abortError();
      const previous = targets.get(canvas);
      const target = { task: null };
      targets.set(canvas, target);
      previous?.task?.cancel();
      try {
        const page = await pdf.getPage(pageNumber);
        if (disposed || targets.get(canvas) !== target) throw abortError();
        const viewport = page.getViewport({ scale: 1 });
        const density = canvasScale(viewport.width, viewport.height, Number.isFinite(scale) && scale > 0 ? scale : 1);
        const display = page.getViewport({ scale: density });
        canvas.width = Math.max(1, Math.ceil(display.width));
        canvas.height = Math.max(1, Math.ceil(display.height));
        target.task = page.render({ canvas, viewport: display });
        await target.task.promise;
        if (disposed || targets.get(canvas) !== target) throw abortError();
        return { width: viewport.width, height: viewport.height };
      } finally {
        if (targets.get(canvas) === target) targets.delete(canvas);
      }
    }

    async function exportCopy(marksByPage) {
      if (disposed) throw abortError();
      const annotated = marksByPage instanceof Map ? Array.from(marksByPage) : Object.entries(marksByPage || {});
      const pages = annotated.filter(([, marks]) => Array.isArray(marks) && marks.length);
      if (!pages.length) return blob;
      const [lib, original] = await Promise.all([import(writerUrl.href), blob.arrayBuffer()]);
      if (disposed) throw abortError();
      const writer = await lib.PDFDocument.load(original, { updateMetadata: false });
      for (const [key, marks] of pages) {
        if (disposed) throw abortError();
        const number = Number(key);
        const page = await pdf.getPage(number);
        await addOverlay(writer, writer.getPage(number - 1), page.getViewport({ scale: 1 }), marks, lib);
      }
      if (disposed) throw abortError();
      return new Blob([await writer.save({ updateFieldAppearances: false })], { type: 'application/pdf' });
    }
    return { pageCount: pdf.numPages, render, exportCopy, destroy };
  }

  window.SmylChatPdf = { open };
})();
