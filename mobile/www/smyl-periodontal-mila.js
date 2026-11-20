/* Optional dictation and clinician-reviewed summaries for the periodontal chart. */
(function (root, factory) {
  const dental = typeof module === 'object' && module.exports ? require('./smyl-dental-dictation.js') : root.SmylDentalDictation;
  const api = factory(root, dental);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylPeriodontalMila = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, dental) {
  'use strict';
  const sites = ['MB', 'B', 'DB', 'ML', 'L', 'DL'];
  const numberWords = 'cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte'.split(' ');
  const sources = { clinical: 'Exploración clínica', photo: 'Fotografía', radiograph: 'Radiografía' };
  const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const faceName = tooth => Number(String(tooth)[0]) <= 2 ? 'Palatina' : 'Lingual';
  const toothValid = tooth => /^[1-4][1-8]$/.test(String(tooth));
  const hasNumber = n => typeof n === 'number' && Number.isFinite(n);
  const depthValid = n => Number.isInteger(n) && n >= 0 && n <= 20;

  function parse(transcript) {
    const original = normalize(transcript).trim().replace(/[.;]$/, '');
    const invalid = { tooth: '', face: '', values: [] };
    if (!original || /[-−]|\d[.,]\d|\b(menos|punto|coma|sangrado|margen|milimetro y medio)\b/.test(original)) return invalid;
    const text = original.replace(/[,;:]/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = text.match(/^(.*?)\b(vestibular|bucal|labial|lingual|palatin[ao])\b(.*)$/);
    if (!parts) return invalid;
    const head = parts[1].replace(/\b(?:profundidad|sondaje|sondeo|cara|en|la|de|del)\b/g, ' ').trim();
    const parsed = (dental || root.SmylDentalDictation)?.parse(head);
    if (!parsed?.tooth || parsed.condition || parsed.ambiguous) return invalid;
    const face = /^(vestibular|bucal|labial)$/.test(parts[2]) ? 'V' : 'I';
    if ((/^palatin/.test(parts[2]) && Number(parsed.tooth[0]) > 2) || (parts[2] === 'lingual' && Number(parsed.tooth[0]) <= 2)) return invalid;
    let tail = parts[3].trim();
    const reverse = /\b(?:de )?distal a mesial\b/.test(tail);
    tail = tail.replace(/\b(?:de )?(?:mesial a distal|distal a mesial)\b/g, '').replace(/\b(?:profundidad|sondaje|sondeo|milimetros?|mm)\b/g, '').trim();
    const tokens = tail.split(/\s+(?:y\s+)?/);
    const values = tokens.map(v => /^\d{1,2}$/.test(v) ? Number(v) : numberWords.indexOf(v));
    if (values.length !== 3 || !values.every(depthValid)) return { tooth: parsed.tooth, face, values: [] };
    return { tooth: parsed.tooth, face, values: reverse ? values.reverse() : values };
  }

  function factsFor(context) {
    const tooth = String(context.tooth || '');
    const current = context.confirmed;
    if (!toothValid(tooth) || !current || current.id !== context.current?.id) return [];
    const previous = context.previous && context.previous.id !== current.id ? context.previous : null;
    const siteNames = ['mesiovestibular', 'vestibular central', 'distovestibular', 'mesio' + faceName(tooth).toLowerCase(), faceName(tooth).toLowerCase() + ' central', 'disto' + faceName(tooth).toLowerCase()];
    const facts = [];
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      const now = current.teeth?.[tooth]?.[site];
      if (!now) continue;
      const data = { kind: 'site', site };
      const descriptions = [];
      for (const [field, label] of [['depth', 'sondaje'], ['margin', 'margen']]) {
        if (!hasNumber(now[field])) continue;
        data[field] = now[field];
        descriptions.push(label + ' ' + now[field] + ' mm');
      }
      if (typeof now.bleeding === 'boolean') {
        data.bleeding = now.bleeding;
        descriptions.push(now.bleeding ? 'sangrado presente' : 'sangrado ausente');
      }
      if (!descriptions.length) continue;
      facts.push({ data, text: siteNames[i] + ', ' + descriptions.join(', ') + '.', source: 'Sondaje · ' + (current.date || 'actual') });
      const before = previous?.teeth?.[tooth]?.[site];
      if (!before) continue;
      const changes = [], change = { kind: 'change', site };
      for (const [field, label] of [['depth', 'sondaje'], ['margin', 'margen'], ['bleeding', 'sangrado']]) {
        if (!(field in data) || typeof before[field] !== typeof data[field] || before[field] === data[field]) continue;
        change[field] = data[field];
        change['previous_' + field] = before[field];
        const printable = n => typeof n === 'boolean' ? (n ? 'presente' : 'ausente') : n + ' mm';
        changes.push(label + ' de ' + printable(before[field]) + ' a ' + printable(data[field]));
      }
      if (changes.length) facts.push({ data: change, text: siteNames[i] + ', ' + changes.join(', ') + '.', source: 'Comparación · ' + (previous.date || 'previa') + ' / ' + (current.date || 'actual') });
    }
    // Findings may be free text. They stay in SMYL; MILA receives only the modality and count.
    if (!facts.length) return facts;
    for (const [kind, label] of Object.entries(sources)) {
      const items = (context.findings || []).filter(f => f && f.id && String(f.tooth) === tooth && f.source === kind && String(f.label || '').trim());
      if (!items.length) continue;
      facts.push({ data: { kind, count: Math.min(items.length, 999) }, text: label + ': ' + items.map(f => String(f.label).trim() + (f.date ? ' (' + f.date + ')' : '')).join('; ') + '.', source: label + ' · ' + items.length });
    }
    return facts;
  }

  async function requestSummary(context, facts, signal) {
    const session = await root.sb?.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Vuelve a iniciar sesión para usar MILA.');
    const response = await root.fetch(root.SUPA_URL + '/functions/v1/periodontal-summary', {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + token, apikey: root.SUPA_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: context.patientId, facts: facts.map(f => f.data) })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'No se pudo generar el resumen. Intenta de nuevo.');
    return payload?.indices;
  }

  function reviewText(facts, indices, tooth) {
    if (!Array.isArray(indices) || !indices.length || indices.length > facts.length || new Set(indices).size !== indices.length ||
        !indices.every(n => Number.isInteger(n) && n >= 0 && n < facts.length)) return '';
    return 'Pieza ' + tooth + '. ' + indices.map(index => {
      const f = facts[index];
      return (/^(site|change)$/.test(f.data.kind) ? f.source + ' · ' : '') + f.text;
    }).join('\n');
  }

  function mount(host, options) {
    if (!host || !options || typeof options.getContext !== 'function') return { destroy() {} };
    const initial = options.getContext();
    const tooth = String(initial.tooth || options.tooth || '');
    const sessionKey = initial.sessionKey;
    const controller = new AbortController();
    let recognition = null, request = null, authWatcher = null, revision = 0, destroyed = false;
    const doc = host.ownerDocument;
    const active = () => {
      const c = options.getContext();
      return !destroyed && host.isConnected && c?.sessionKey === sessionKey && String(c.tooth) === tooth && c.patientId === initial.patientId && c.canEdit !== false;
    };
    host.replaceChildren();
    if (!toothValid(tooth) || initial.canEdit === false) return { destroy() {} };
    host.classList.add('perio-mila');
    function element(parent, tag, text, cls) {
      const el = doc.createElement(tag);
      if (text) el.textContent = text;
      if (cls) el.className = cls;
      parent.append(el);
      return el;
    }
    function button(parent, title, run) {
      const b = element(parent, 'button', title);
      b.type = 'button';
      b.addEventListener('click', run, { signal: controller.signal });
      return b;
    }
    const group = element(host, 'details');
    element(group, 'summary', 'Asistencia de MILA');
    const tools = element(group, 'div', '', 'perio-mila-tools');
    const dictate = button(tools, 'Dictar sondaje', openDictation);
    const summarize = button(tools, 'Resumir esta pieza', openSummary);
    const status = element(group, 'p', '', 'perio-mila-status');
    status.setAttribute('role', 'status');
    const panel = element(group, 'div', '', 'perio-mila-panel');
    function stop() {
      ++revision;
      authWatcher?.unsubscribe();
      authWatcher = null;
      if (recognition) {
        const running = recognition;
        recognition = null;
        running.onresult = running.onerror = running.onend = null;
        try { running.abort(); } catch (_) { /* Already stopped by the browser. */ }
      }
      request?.abort();
      request = null;
    }
    function watchSession() {
      let actor;
      const result = root.sb?.auth?.onAuthStateChange?.((event, session) => {
        if (event === 'SIGNED_OUT' || (actor && session?.user?.id && actor !== session.user.id)) {
          destroyed = true;
          reset();
          status.textContent = 'La sesión cambió. Vuelve a abrir la exploración.';
        }
        else if (session?.user?.id) actor = session.user.id;
      });
      authWatcher = result?.data?.subscription || null;
    }
    function reset() { stop(); panel.replaceChildren(); status.textContent = ''; }
    function field(parent, title, tag, value) {
      const label = element(parent, 'label', title);
      const input = element(label, tag);
      if (value != null) input.value = value;
      return input;
    }
    function preview(candidate) {
      reset();
      if (!active()) return;
      if (candidate.tooth && candidate.tooth !== tooth) {
        status.textContent = 'Escuché la pieza ' + candidate.tooth + '. Estás editando la ' + tooth + '. Selecciona la pieza correcta o vuelve a dictar.';
        return;
      }
      if (!candidate.tooth || !candidate.values.length) {
        status.textContent = 'La frase quedó incompleta. Comprueba la pieza ' + tooth + ' y captura los tres valores.';
      } else status.textContent = 'Revisa el sondaje de la pieza ' + tooth + ' antes de incorporarlo.';
      const face = field(panel, 'Cara', 'select');
      for (const [value, name] of [['', 'Elige la cara'], ['V', 'Vestibular'], ['I', faceName(tooth)]]) {
        const option = element(face, 'option', name);
        option.value = value;
      }
      face.value = candidate.face;
      const row = element(panel, 'div', '', 'perio-mila-values');
      const values = ['Mesial', 'Central', 'Distal'].map((name, i) => {
        const input = field(row, name + ' (mm)', 'input', candidate.values[i]);
        input.type = 'number'; input.min = '0'; input.max = '20'; input.step = '1'; input.inputMode = 'numeric';
        return input;
      });
      const actions = element(panel, 'div', '', 'perio-mila-tools');
      button(actions, 'Aplicar al borrador', () => {
        if (!active()) return reset();
        const numbers = values.map(i => i.value.trim() === '' ? NaN : Number(i.value));
        if (!['I','V'].includes(face.value) || !numbers.every(depthValid)) { status.textContent = 'Elige la cara y revisa los tres valores en milímetros.'; return; }
        const patch = { tooth, face: face.value, values: numbers };
        if (options.onApply(patch) === false) { status.textContent = 'No se pudo incorporar la medición. Comprueba que la exploración esté abierta.'; return; }
        reset();
        if (active()) status.textContent = 'Sondaje incorporado al borrador de la pieza ' + tooth + '.';
      });
      button(actions, 'Cancelar', () => { reset(); dictate.focus(); });
      face.focus({ preventScroll:true });
    }
    function openDictation() {
      reset();
      if (!active()) return;
      const Speech = root.SpeechRecognition || root.webkitSpeechRecognition;
      if (!Speech) {
        status.textContent = 'Este navegador permite la captura manual. Puedes escribir las medidas en la tabla.';
        return;
      }
      element(panel, 'p', 'Di la pieza, la cara y tres profundidades de mesial a distal. Por ejemplo, «pieza dieciséis, vestibular, tres cuatro cinco».');
      element(panel, 'p', 'El reconocimiento de voz lo procesa tu navegador. Dicta únicamente las mediciones.');
      if (root.navigator?.onLine === false) { status.textContent = 'Vuelve a conectarte para dictar o captura las medidas en la tabla.'; return; }
      const start = button(panel, 'Iniciar micrófono', () => {
        reset();
        if (!active()) return;
        const turn = revision;
        try {
          const rec = new Speech();
          recognition = rec;
          rec.lang = 'es-MX'; rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 1;
          rec.onresult = event => {
            if (turn !== revision) return;
            if (!active()) return stop();
            const entry = event.results?.[event.resultIndex || 0];
            if (!entry || entry.isFinal === false) return;
            preview(parse(entry[0]?.transcript));
          };
          rec.onerror = event => {
            if (!active() || turn !== revision) return;
            reset();
            status.textContent = event.error === 'not-allowed' ? 'El micrófono está desactivado. Puedes escribir en la tabla o habilitar el permiso.' : 'No se pudo completar el dictado. Puedes volver a intentarlo o escribir en la tabla.';
          };
          rec.onend = () => { if (turn === revision && active()) { reset(); status.textContent = 'Terminó la escucha. Puedes volver a dictar.'; } };
          rec.start();
          watchSession();
          status.textContent = 'Escuchando las medidas de la pieza ' + tooth + '…';
          button(panel, 'Cancelar dictado', () => { reset(); dictate.focus(); }).focus({ preventScroll:true });
        } catch (_) { reset(); status.textContent = 'El micrófono no está disponible. Puedes escribir las medidas en la tabla.'; }
      });
      start.focus({ preventScroll:true });
    }
    function openSummary() {
      reset();
      if (!active()) return;
      if (!factsFor(options.getContext()).length) { status.textContent = 'Guarda primero las mediciones de esta pieza para preparar su resumen.'; return; }
      element(panel, 'p', 'MILA organizará las mediciones guardadas, sus cambios y las fuentes confirmadas de esta pieza. Cada resumen utiliza 1 crédito de IA.');
      const generate = button(panel, 'Generar resumen', async () => {
        reset();
        if (!active()) return;
        const context = options.getContext(), facts = factsFor(context);
        if (!facts.length) return openSummary();
        const signature = JSON.stringify(facts), turn = revision;
        const fresh = () => active() && turn === revision;
        const sameFacts = () => signature === JSON.stringify(factsFor(options.getContext()));
        request = new AbortController();
        watchSession();
        status.textContent = 'Preparando resumen…';
        try {
          const indices = await requestSummary(context, facts, request.signal);
          if (!fresh()) return;
          request = null;
          if (!sameFacts()) { reset(); status.textContent = 'El registro cambió. Genera un resumen actualizado.'; return; }
          const text = reviewText(facts, indices, tooth);
          if (!text) throw new Error('La respuesta de MILA quedó incompleta. Puedes reintentar.');
          status.textContent = 'Comprueba las fuentes y edita el texto antes de incorporarlo.';
          const draft = field(panel, 'Resumen propuesto', 'textarea', text);
          draft.rows = 4;
          draft.focus({ preventScroll:true });
          const actions = element(panel, 'div', '', 'perio-mila-tools');
          button(actions, 'Incorporar al resumen', () => {
            if (!fresh() || !sameFacts()) { reset(); status.textContent = 'El registro cambió. Genera un resumen actualizado.'; return; }
            const addition = draft.value.trim();
            if (!addition) { status.textContent = 'Escribe el texto que deseas incorporar.'; return; }
            const existing = String(options.getContext().current?.summary || '').trim();
            const summary = existing ? existing + '\n\n' + addition : addition;
            if (summary.length > 2000) {
              status.textContent = 'Acorta la propuesta en ' + (summary.length - 2000) + ' caracteres para incorporarla a la nota.';
              return;
            }
            if (options.onApply({ summary }) === false) { status.textContent = 'La nota no se pudo actualizar. Comprueba la exploración.'; return; }
            reset();
            if (active()) status.textContent = 'Texto incorporado al borrador de la nota.';
          });
          button(actions, 'Descartar', () => { reset(); summarize.focus(); });
        } catch (error) {
          if (fresh()) {
            request = null;
            status.textContent = error?.name === 'TypeError' ? 'No hay conexión con MILA. Puedes reintentar o redactar el resumen.' : (error?.message || 'MILA no está disponible.');
          }
        }
      });
      generate.focus({ preventScroll:true });
    }
    const pause = () => {
      const wasRunning = !!(recognition || request);
      stop();
      if (wasRunning) { panel.replaceChildren(); status.textContent = 'Se interrumpió la asistencia. Puedes volver a intentarlo.'; }
    };
    for (const event of ['pagehide','offline','popstate','hashchange']) root.addEventListener(event, pause, { signal: controller.signal });
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) pause(); }, { signal: controller.signal });
    group.addEventListener('toggle', () => { if (!group.open) reset(); }, { signal: controller.signal });
    dictate.title = 'Dictar tres profundidades de sondaje';
    return { destroy() { destroyed = true; stop(); controller.abort(); host.replaceChildren(); } };
  }
  return Object.freeze({ mount, parse, factsFor, reviewText });
});
