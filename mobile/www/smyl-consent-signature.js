/* SMYL · Firma pública de consentimiento informado
 * El token vive sólo en el fragmento URL y se retira del historial al iniciar.
 * El servidor conserva el documento exacto y decide vigencia, uso e integridad.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://rpxshsiwoxdbuevjjpfw.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_2YmASbqlTpFXz12VxzzKJw_m9TWVLLo';
  var RPC_INFO = 'smyl_informed_consent_signature_link_info';
  var RPC_CAPTURE = 'smyl_submit_informed_consent_signature';
  var ACCEPTANCE_VERSION = 'patient-consent-v1';
  var ACCEPTANCE_TEXT = 'Leí o recibí la lectura de este documento, pude hacer preguntas y autorizo libremente el procedimiento descrito.';

  var main = document.getElementById('ics-main');
  var actions = document.getElementById('ics-actions');
  var clinic = document.getElementById('ics-clinic');
  var params = new URLSearchParams(globalThis.location.hash.slice(1));
  var token = params.get('token') || '';
  var state = {
    info: null,
    stage: 'document',
    accepted: false,
    acceptedAt: '',
    signaturePng: '',
    pad: null,
    busy: false,
    expired: false,
    expiryTimer: null,
    resizeFallback: false
  };

  globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search);

  function node(tag, className, text) {
    var item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = text;
    return item;
  }

  function button(text, className, handler) {
    var control = node('button', className, text);
    control.type = 'button';
    if (handler) control.addEventListener('click', handler);
    return control;
  }

  function focusHeading(host) {
    var heading = host && host.querySelector('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    requestAnimationFrame(function () { heading.focus({ preventScroll: true }); });
  }

  function clearTimer() {
    if (state.expiryTimer) clearInterval(state.expiryTimer);
    state.expiryTimer = null;
  }

  function destroyPad() {
    if (state.pad) state.pad.destroy();
    state.pad = null;
  }

  function clearView() {
    destroyPad();
    main.replaceChildren();
    actions.replaceChildren();
    actions.hidden = true;
  }

  function friendlyError(error) {
    var message = String(error && error.message || '');
    if (/expired|vencid|used|utilizado|invalid|inválid|not found|no disponible/i.test(message)) return 'Este enlace ya se usó o venció. Solicita un código nuevo al personal de la clínica.';
    if (/fetch|network|conexi|Failed to fetch/i.test(message)) return 'No hay conexión. Revisa tu red e inténtalo de nuevo antes de que venza el código.';
    return 'No pudimos completar la operación. Inténtalo nuevamente o pide ayuda al personal de la clínica.';
  }

  async function rpc(name, args) {
    var response;
    try {
      response = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + SUPABASE_KEY
        },
        body: JSON.stringify(args || {})
      });
    } catch (error) {
      throw new Error('No hay conexión.');
    }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body && (body.message || body.error_description || body.hint) || 'No pudimos completar la operación.');
    return body;
  }

  function one(value) {
    return Array.isArray(value) ? value[0] : value;
  }

  function signerRelation(value) {
    return value === 'guardian' ? 'Tutor o representante' : 'Paciente';
  }

  function normalizeInfo(value) {
    value = one(value) || {};
    return {
      available: value.available !== false,
      clinicName: value.clinic_name || 'SMYL',
      reference: value.reference || '',
      patientName: value.patient_name || 'Paciente',
      signerName: value.signer_name || value.patient_name || 'Paciente',
      signerRelation: value.signer_relation || 'patient',
      procedureTitle: value.procedure_title || 'Consentimiento informado',
      documentText: value.document_text || '',
      documentSha256: value.document_sha256 || '',
      acceptanceVersion: value.acceptance_version || ACCEPTANCE_VERSION,
      acceptanceText: value.acceptance_text || ACCEPTANCE_TEXT,
      expiresAt: value.expires_at || ''
    };
  }

  function showState(mark, title, copy, tone, help) {
    clearTimer();
    clearView();
    var section = node('section', 'ics-state');
    section.dataset.tone = tone || 'success';
    section.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    var icon = node('span', 'ics-state__mark', mark);
    icon.setAttribute('aria-hidden', 'true');
    section.append(icon, node('h1', '', title), node('p', '', copy));
    if (help) section.append(node('p', 'ics-state__help', help));
    main.append(section);
    focusHeading(section);
  }

  function progress(active) {
    var list = node('ol', 'ics-progress');
    list.setAttribute('aria-label', 'Progreso de la firma');
    [['1', 'Documento'], ['2', 'Firma'], ['3', 'Confirmar']].forEach(function (entry, index) {
      var item = node('li');
      item.dataset.state = index < active ? 'complete' : index === active ? 'active' : 'pending';
      if (index === active) item.setAttribute('aria-current', 'step');
      item.append(node('span', '', index < active ? '✓' : entry[0]), node('strong', '', entry[1]));
      list.append(item);
    });
    return list;
  }

  function intro(eyebrow, title, copy) {
    var section = node('header', 'ics-intro');
    section.append(node('span', 'ics-eyebrow', eyebrow), node('h1', '', title), node('p', '', copy));
    return section;
  }

  function summary(info) {
    var section = node('section', 'ics-summary');
    section.setAttribute('aria-label', 'Datos de este consentimiento');
    [
      ['Firmante', info.signerName + ' · ' + signerRelation(info.signerRelation)],
      ['Procedimiento', info.procedureTitle],
      ['Clínica', info.clinicName],
      ['Folio', info.reference || 'Asignado por la clínica']
    ].forEach(function (entry) {
      var row = node('div');
      row.append(node('small', '', entry[0]), node('strong', '', entry[1]));
      section.append(row);
    });
    return section;
  }

  function feedbackNode() {
    var feedback = node('p', 'ics-feedback');
    feedback.setAttribute('role', 'alert');
    feedback.setAttribute('aria-live', 'assertive');
    return feedback;
  }

  function expiryBanner() {
    var banner = node('p', 'ics-expiry');
    banner.append(node('span', '', 'Enlace de un solo uso'), node('span', '', 'Vigencia'), node('time', '', 'Calculando…'));
    banner.querySelector('time').setAttribute('aria-label', 'Tiempo restante');
    return banner;
  }

  function startExpiry(banner, feedback, controls) {
    clearTimer();
    var expires = Date.parse(state.info.expiresAt || '');
    var time = banner.querySelector('time');
    controls = controls || [];
    function update() {
      var seconds = Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - Date.now()) / 1000)) : 0;
      state.expired = seconds <= 0;
      banner.dataset.expired = state.expired ? 'true' : 'false';
      time.textContent = state.expired ? 'Vencido' : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      controls.forEach(function (control) { if (state.expired) control.disabled = true; });
      if (state.expired) {
        feedback.textContent = 'El código venció. Solicita uno nuevo al personal de la clínica.';
        feedback.dataset.tone = 'warning';
        clearTimer();
      }
    }
    update();
    if (!state.expired) state.expiryTimer = setInterval(update, 1000);
  }

  function renderDocument() {
    state.stage = 'document';
    clearView();
    main.append(progress(0), intro('PASO 1 DE 3', 'Revisa este consentimiento', 'Lee el documento completo. Si algo no está claro, no firmes todavía y pide ayuda al personal de la clínica.'), summary(state.info));

    var feedback = feedbackNode();
    var expiry = expiryBanner();
    main.append(expiry);

    var card = node('section', 'ics-card');
    var head = node('header', 'ics-card__head');
    head.append(node('span', 'ics-eyebrow', 'DOCUMENTO EXACTO'), node('h2', '', state.info.procedureTitle), node('p', '', 'Esta es la versión que quedará vinculada a tu firma.'));
    var documentBox = node('div', 'ics-document');
    documentBox.tabIndex = 0;
    documentBox.setAttribute('aria-label', 'Contenido completo del consentimiento');
    documentBox.append(node('pre', '', state.info.documentText), node('span', 'ics-document__end'));
    var hash = node('p', 'ics-hash', state.info.documentSha256 ? 'Huella del documento: ' + state.info.documentSha256 : 'Documento protegido por la clínica');
    card.append(head, documentBox, hash);
    main.append(card);

    var acceptance = node('label', 'ics-acceptance');
    var check = node('input');
    check.type = 'checkbox';
    check.checked = state.accepted;
    var copy = node('span');
    copy.append(node('strong', '', 'Acepto este consentimiento'), node('span', '', state.info.acceptanceText), node('small', '', 'Al continuar, esta aceptación quedará asociada al documento y a la firma que envíes.'));
    acceptance.append(check, copy);
    main.append(acceptance, feedback);

    var next = button('Continuar a la firma', 'ics-button ics-button--primary', function () {
      if (!check.checked || state.expired) return;
      state.accepted = true;
      state.acceptedAt = new Date().toISOString();
      renderSignature();
    });
    next.disabled = !check.checked;
    check.addEventListener('change', function () {
      state.accepted = check.checked;
      next.disabled = state.expired || !check.checked;
      feedback.textContent = '';
    });
    actions.append(next);
    actions.hidden = false;
    startExpiry(expiry, feedback, [next]);
    focusHeading(main);
  }

  function signaturePad(canvas, onChange) {
    var strokes = [];
    var drawing = null;
    var observer = null;
    var windowResize = false;

    function point(event) {
      var box = canvas.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width))),
        y: Math.min(1, Math.max(0, (event.clientY - box.top) / Math.max(1, box.height)))
      };
    }

    function measure() {
      var points = 0;
      var distance = 0;
      strokes.forEach(function (stroke) {
        points += stroke.length;
        for (var index = 1; index < stroke.length; index += 1) {
          var dx = (stroke[index].x - stroke[index - 1].x) * canvas.clientWidth;
          var dy = (stroke[index].y - stroke[index - 1].y) * canvas.clientHeight;
          distance += Math.sqrt(dx * dx + dy * dy);
        }
      });
      return { ok: points >= 2 && distance >= 24, points: points, distance: distance };
    }

    function paint() {
      var context = canvas.getContext('2d');
      var ratio = globalThis.devicePixelRatio || 1;
      var width = canvas.clientWidth;
      var height = canvas.clientHeight;
      if (!width || !height) return;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = '#0b2439';
      context.lineWidth = 2.8;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      strokes.forEach(function (stroke) {
        if (!stroke.length) return;
        context.beginPath();
        stroke.forEach(function (value, index) {
          if (index) context.lineTo(value.x * width, value.y * height);
          else context.moveTo(value.x * width, value.y * height);
        });
        context.stroke();
      });
    }

    function update() {
      paint();
      onChange(measure());
    }

    canvas.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch (error) {}
      drawing = [point(event)];
      strokes.push(drawing);
      update();
    });
    canvas.addEventListener('pointermove', function (event) {
      if (!drawing) return;
      event.preventDefault();
      drawing.push(point(event));
      update();
    });
    function end() {
      if (!drawing) return;
      drawing = null;
      update();
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);

    if (globalThis.ResizeObserver) {
      observer = new ResizeObserver(paint);
      observer.observe(canvas);
    } else {
      globalThis.addEventListener('resize', paint);
      windowResize = true;
    }
    requestAnimationFrame(paint);

    return {
      clear: function () { strokes = []; drawing = null; update(); },
      valid: function () { return measure().ok; },
      image: function () {
        var output = document.createElement('canvas');
        output.width = 600;
        output.height = 200;
        var context = output.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, output.width, output.height);
        context.strokeStyle = '#0b2439';
        context.lineWidth = 3;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        strokes.forEach(function (stroke) {
          if (!stroke.length) return;
          context.beginPath();
          stroke.forEach(function (value, index) {
            if (index) context.lineTo(value.x * output.width, value.y * output.height);
            else context.moveTo(value.x * output.width, value.y * output.height);
          });
          context.stroke();
        });
        return output.toDataURL('image/png');
      },
      destroy: function () {
        if (observer) observer.disconnect();
        if (windowResize) globalThis.removeEventListener('resize', paint);
      }
    };
  }

  function renderSignature() {
    state.stage = 'signature';
    clearView();
    main.append(progress(1), intro('PASO 2 DE 3', 'Firma con el dedo', 'Dibuja tu firma dentro del recuadro. En el siguiente paso podrás verla completa antes de enviarla.'), summary(state.info));
    var feedback = feedbackNode();
    var expiry = expiryBanner();
    main.append(expiry);

    var card = node('section', 'ics-card ics-sign-card');
    var head = node('header', 'ics-sign-card__head');
    var copy = node('div');
    copy.append(node('span', 'ics-eyebrow', 'FIRMA DEL ' + signerRelation(state.info.signerRelation).toUpperCase()), node('h2', '', state.info.signerName), node('p', '', 'Usa el dedo o un lápiz táctil.'));
    var status = node('span', 'ics-status-chip', 'Pendiente');
    head.append(copy, status);

    var wrap = node('div', 'ics-pad');
    var canvas = node('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Área para dibujar la firma con el dedo');
    var hint = node('span', 'ics-pad__hint', 'Firma aquí');
    var clear = button('Borrar firma', 'ics-clear');
    clear.disabled = true;
    wrap.append(canvas, hint, clear);
    card.append(head, wrap, node('p', 'ics-pad-help', 'El trazo se convertirá en una imagen PNG de 600 × 200 píxeles y quedará vinculado únicamente a este documento.'));
    main.append(card, feedback);

    var back = button('Volver al documento', 'ics-button', renderDocument);
    var review = button('Revisar firma', 'ics-button ics-button--primary', function () {
      if (state.expired || !state.pad || !state.pad.valid()) return;
      state.signaturePng = state.pad.image();
      renderPreview();
    });
    review.disabled = true;
    actions.append(back, review);
    actions.hidden = false;

    state.pad = signaturePad(canvas, function (value) {
      clear.disabled = !value.points;
      hint.hidden = !!value.points;
      status.textContent = value.ok ? 'Trazo listo' : 'Pendiente';
      status.dataset.state = value.ok ? 'ready' : 'pending';
      review.disabled = state.expired || !value.ok;
      feedback.textContent = value.points && !value.ok ? 'Completa el trazo antes de continuar.' : '';
    });
    clear.addEventListener('click', function () { if (state.pad) state.pad.clear(); });
    startExpiry(expiry, feedback, [review]);
    focusHeading(main);
    requestAnimationFrame(function () { canvas.focus(); });
  }

  function renderPreview() {
    state.stage = 'preview';
    clearView();
    main.append(progress(2), intro('PASO 3 DE 3', 'Confirma tu firma', 'Revisa el trazo antes de enviarlo. Todavía puedes volver y firmar nuevamente.'), summary(state.info));
    var feedback = feedbackNode();
    var expiry = expiryBanner();
    main.append(expiry);

    var preview = node('section', 'ics-preview');
    var figure = node('figure');
    var image = node('img');
    image.src = state.signaturePng;
    image.alt = 'Vista previa de la firma dibujada';
    figure.append(image, node('figcaption', '', 'Firma de ' + state.info.signerName));
    preview.append(figure);
    var proof = node('p', 'ics-proof');
    proof.append(node('span', '', '✓'), node('span', '', 'Confirmo que este trazo es mío y corresponde al consentimiento y folio mostrados. La clínica revisará la firma antes de incorporarla al expediente.'));
    preview.append(proof);
    main.append(preview, feedback);

    var retry = button('Volver a firmar', 'ics-button', renderSignature);
    var confirm = button('Confirmar y enviar', 'ics-button ics-button--primary', function () { capture(confirm, retry, feedback); });
    actions.append(retry, confirm);
    actions.hidden = false;
    startExpiry(expiry, feedback, [confirm]);
    focusHeading(main);
  }

  async function capture(confirm, retry, feedback) {
    if (state.busy || state.expired || !state.signaturePng) return;
    state.busy = true;
    confirm.disabled = true;
    retry.disabled = true;
    confirm.textContent = 'Enviando firma…';
    feedback.textContent = '';
    try {
      await rpc(RPC_CAPTURE, {
        p_token: token,
        p_signature_png: state.signaturePng,
        p_accepted: true
      });
      showState('✓', 'Firma enviada a la clínica', 'Vuelve con el personal. La firma será revisada antes de incorporar el consentimiento al expediente.', 'success', 'Puedes cerrar esta página. Este enlace ya no puede volver a utilizarse.');
    } catch (error) {
      state.busy = false;
      confirm.disabled = state.expired;
      retry.disabled = false;
      confirm.textContent = 'Confirmar y enviar';
      feedback.textContent = friendlyError(error);
    }
  }

  async function init() {
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      showState('!', 'Enlace no disponible', 'Solicita un código nuevo al personal de la clínica.', 'error');
      return;
    }
    try {
      var info = normalizeInfo(await rpc(RPC_INFO, { p_token: token }));
      if (!info.available || !info.documentText || !info.expiresAt) {
        showState('!', 'Enlace no disponible', 'Este enlace ya se usó o venció. Solicita un código nuevo al personal de la clínica.', 'error');
        return;
      }
      state.info = info;
      clinic.textContent = info.clinicName;
      document.title = 'Firma de consentimiento · ' + info.clinicName;
      renderDocument();
    } catch (error) {
      showState('!', 'No pudimos verificar el enlace', friendlyError(error), 'error');
    }
  }

  globalThis.addEventListener('pagehide', function () {
    clearTimer();
    destroyPad();
  });

  init();
})();
