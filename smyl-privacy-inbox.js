/* SMYL · Solicitudes de derechos (ARCO) que llegan por el chat. Detecta, en lo que escribe el paciente, frases que piden acceso,
 * corrección, borrado u oposición al uso de sus datos, y avisa al personal con un aviso sobre el hilo para registrar la solicitud
 * con un clic, ya prellenada. NO contesta ni borra nada solo: la ley da 20 días hábiles y antes de entregar o borrar datos una
 * persona debe confirmar que quien escribe es el paciente. La detección es deliberadamente conservadora (pocas frases claras);
 * es una ayuda, no un filtro: si no salta, la solicitud se sigue pudiendo registrar a mano en Privacidad y derechos. */
(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.SmylPrivacyInbox = api; })(globalThis, function () {
  'use strict';
  var RIGHTS = { access: 'Acceso a sus datos', rectification: 'Corrección de sus datos', cancellation: 'Borrar sus datos', opposition: 'Oposición al uso de sus datos', revocation: 'Retirar su consentimiento' };
  var ORDER = ['access', 'rectification', 'cancellation', 'opposition', 'revocation'];
  function norm(v) { return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  var DATA = '(?:datos(?: personales)?|informacion(?: personal)?|expediente|historial(?: clinico)?|fotos?|fotografias?|radiografias?)';
  var P = {
    cancellation: [
      new RegExp('\\b(?:borr|elimin|suprim|destru|quit)\\w*\\s+(?:de\\s+sus\\s+(?:sistemas?|bases?)\\s+)?(?:todos\\s+|todas\\s+)?(?:mis|mi)\\s+' + DATA + '\\b'),
      /\bdar(?:me)? de baja (?:mis|mi) (?:datos|informacion|expediente)\b/,
      /\bderecho al olvido\b/,
      /\bcancel(?:ar|en|acion de)\s+(?:mis|mi)\s+datos\b/
    ],
    opposition: [
      /\bno quiero que (?:usen|utilicen|compartan|traten|manejen|vendan|ocupen) (?:mis|mi) (?:datos|informacion|fotos?|fotografias?)\b/,
      /\bme opongo\b/,
      /\bdejen de (?:escribirme|enviarme|mandarme|contactarme|molestarme)\b/,
      /\bno (?:me )?(?:escriban|manden|envien|contacten|llamen)(?: mas)?\b.{0,40}\b(?:promociones|publicidad|mensajes|ofertas|promos)\b/,
      /\bno quiero (?:recibir )?(?:mas )?(?:promociones|publicidad|ofertas|promos)\b/,
      /\bno quiero que (?:se )?(?:use|usen|utilicen) (?:inteligencia artificial|ia)\b/,
      /\bquiero darme de baja de (?:las |sus )?(?:promociones|mensajes|lista|publicidad)\b/
    ],
    revocation: [
      /\b(?:retiro|revoco|revocar|retirar|quito|quitar)\s+(?:mi|el)\s+(?:consentimiento|autorizacion|permiso)\b/,
      /\bya no (?:autorizo|doy mi autorizacion|doy mi consentimiento|doy permiso)\b/
    ],
    rectification: [
      /\b(?:corregir|rectificar|actualizar|modificar)\s+(?:mis|mi)\s+(?:datos(?: personales)?|informacion personal)\b/,
      /\b(?:mis|mi)\s+datos\s+(?:estan|esta)\s+(?:mal|incorrectos?|equivocados?)\b/,
      /\brectificacion\b/
    ],
    access: [
      /\b(?:que|cuales) datos (?:mios |personales |de mi )?(?:tienen|guardan|manejan|han guardado|almacenan|conservan|estan guardados)\b/,
      /\bquiero (?:saber|conocer|ver|que me (?:digan|informen|envien|manden)) (?:que|cuales|todos)? ?(?:mis )?datos\b/,
      /\bacceso (?:a )?(?:mis|mi) (?:datos|expediente|informacion|historial)\b/,
      /\bcopia (?:de )?(?:mis datos|(?:de )?mi expediente|(?:de )?mi historial)\b/,
      /\b(?:derechos? arco|derechos? de acceso|ley (?:federal )?de proteccion de datos|inai)\b/
    ]
  };
  /* text → { right, label } o null. Si coincide con varias, manda la más delicada: borrar > oposición > retirar permiso > corregir > acceso. */
  function detect(text) {
    var t = norm(text);
    if (t.length < 8 || t.length > 1500) return null;
    var found = ['cancellation', 'opposition', 'revocation', 'rectification', 'access'];
    for (var i = 0; i < found.length; i++) {
      var list = P[found[i]];
      for (var j = 0; j < list.length; j++) if (list[j].test(t)) return { right: found[i], label: RIGHTS[found[i]] };
    }
    return null;
  }
  var WINDOW_DAYS = 14;
  /* messages: [{ id, text, at }] del paciente, en cualquier orden. Devuelve la solicitud posible más reciente aún sin atender. */
  function latest(messages, o) {
    o = o || {}; var now = o.now || Date.now(), skip = o.skip || {}, best = null;
    (messages || []).forEach(function (m) {
      if (!m || skip[m.id]) return;
      var at = new Date(m.at || 0).getTime();
      if (!Number.isFinite(at) || at <= 0 || now - at > WINDOW_DAYS * 86400000) return;
      var d = detect(m.text); if (!d) return;
      if (!best || at > best.at) best = { id: m.id, at: at, right: d.right, label: d.label, text: String(m.text || '').trim() };
    });
    return best;
  }
  function snippet(text, max) { var t = String(text || '').replace(/\s+/g, ' ').trim(); max = max || 140; return t.length > max ? t.slice(0, max - 1) + '…' : t; }
  /* canal de la conversación → canal de la solicitud (los que acepta la base). */
  function channelOf(channel) { return channel === 'whatsapp' ? 'whatsapp' : 'other'; }
  function dayOf(at) { var d = new Date(at); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function args(o) {
    return { p_patient_id: o.patientId || null, p_right: o.right, p_channel: channelOf(o.channel), p_requester_name: String(o.name || '').trim().slice(0, 150) || 'Sin nombre',
      p_requester_contact: String(o.contact || '').trim().slice(0, 150), p_details: String(o.details || '').trim().slice(0, 2000), p_received_on: o.receivedOn || null };
  }

  /* ── Navegador ── */
  var memory = { dismissed: {}, registered: {} };
  function store(kind) { try { return JSON.parse(globalThis.localStorage.getItem('smyl-priv-inbox-' + kind) || '{}') || {}; } catch (e) { return {}; } }
  function save(kind, map) { try { var keys = Object.keys(map); if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(function (k) { delete map[k]; }); globalThis.localStorage.setItem('smyl-priv-inbox-' + kind, JSON.stringify(map)); } catch (e) {} }
  function mark(kind, id, value) { memory[kind][id] = value || 1; var s = store(kind); s[id] = value || 1; save(kind, s); }
  function seen(kind) { return Object.assign({}, store(kind), memory[kind]); }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function show(o) {
    var win = globalThis, doc = win.document;
    if (!doc || !o || !o.anchor || !o.anchor.parentNode) return;
    var parent = o.anchor.parentNode, old = parent.querySelector('[data-priv-banner]');
    var hit = latest(o.messages, { skip: seen('dismissed') });
    if (!hit) { if (old) old.remove(); return; }
    var done = seen('registered')[hit.id];
    if (old && old.dataset.privMessage === String(hit.id) && old.dataset.privConversation === String(o.conversationId) && old.dataset.privDone === String(!!done)) return;
    if (old) old.remove();
    var box = el('div', 'priv-banner'); box.dataset.privBanner = ''; box.dataset.privMessage = String(hit.id); box.dataset.privConversation = String(o.conversationId); box.dataset.privDone = String(!!done);
    box.setAttribute('role', 'status');
    var text = el('div', 'priv-banner-text');
    if (done) {
      text.append(el('strong', '', 'Solicitud de derechos registrada'), el('span', '', ' · ' + hit.label + '. Atiéndela en el expediente del paciente, en «Consentimiento de privacidad».'));
    } else {
      text.append(el('strong', '', 'Posible solicitud de derechos: ' + hit.label), el('q', '', snippet(hit.text)));
      if (o.canManage && o.patientId) text.append(el('small', '', 'Tienes 20 días hábiles para responder. Antes de entregar o borrar datos, confirma que quien escribe es el paciente.'));
      else if (o.canManage) text.append(el('small', '', 'Para registrarla, primero liga esta conversación a un paciente: la solicitud se atiende en su expediente.'));
      else text.append(el('small', '', 'Avisa a quien administra la privacidad de la clínica para que la registre.'));
    }
    var acts = el('div', 'priv-banner-acts');
    function btn(label, cls, fn) { var b = el('button', cls, label); b.type = 'button'; b.onclick = fn; acts.append(b); return b; }
    if (done) { if (o.patientId && typeof win.verPaciente === 'function') btn('Abrir expediente', 'priv-primary', function () { win.verPaciente(o.patientId); }); }
    else {
      if (o.canManage && o.patientId) btn('Registrar solicitud', 'priv-primary', function () { openForm(o, hit, box); });
      btn('No es una solicitud', '', function () { mark('dismissed', hit.id, 1); box.remove(); });
    }
    box.append(text, acts);
    parent.insertBefore(box, o.anchor);
  }
  function openForm(o, hit, box) {
    var win = globalThis, doc = win.document, d = doc.createElement('dialog'); d.className = 'priv-dialog';
    var form = el('form', 'priv-form'); form.method = 'dialog';
    form.append(el('h2', '', 'Registrar solicitud de derechos'), el('p', '', 'Se anotará con la fecha en que el paciente escribió, y desde ahí corren los 20 días hábiles.'));
    function field(label, node) { var l = el('label', '', label); l.append(node); form.append(l); return node; }
    var sel = field('Derecho que ejerce', doc.createElement('select'));
    Object.keys(RIGHTS).forEach(function (k) { var opt = el('option', '', RIGHTS[k]); opt.value = k; if (k === hit.right) opt.selected = true; sel.append(opt); });
    var name = field('Quién solicita', doc.createElement('input')); name.type = 'text'; name.maxLength = 150; name.value = o.contactName || '';
    var contact = field('Contacto', doc.createElement('input')); contact.type = 'text'; contact.maxLength = 150; contact.value = o.contactPhone || '';
    var details = field('Lo que pidió', doc.createElement('textarea')); details.rows = 4; details.maxLength = 2000; details.value = hit.text;
    var err = el('p', 'priv-error'); err.hidden = true; err.setAttribute('role', 'alert'); form.append(err);
    var acts = el('div', 'priv-form-acts'), cancel = el('button', '', 'Cancelar'), ok = el('button', 'priv-primary', 'Registrar'); cancel.type = 'button'; ok.type = 'submit'; acts.append(cancel, ok); form.append(acts); d.append(form);
    function close() { try { d.close(); } catch (e) {} d.remove(); }
    cancel.onclick = close; d.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    form.onsubmit = function (e) {
      e.preventDefault(); ok.disabled = true; ok.textContent = 'Guardando…'; err.hidden = true;
      var payload = args({ patientId: o.patientId, right: sel.value, channel: o.channel, name: name.value, contact: contact.value, details: details.value, receivedOn: dayOf(hit.at) });
      win.sb.rpc('smyl_open_data_request', payload).then(function (r) {
        if (r.error) throw r.error;
        mark('registered', hit.id, 1); close(); show(o);
      }).catch(function (x) {
        ok.disabled = false; ok.textContent = 'Registrar';
        var code = x && x.code, msg = String(x && x.message || '');
        err.textContent = code === '42501' ? 'Tu rol no permite registrar solicitudes de derechos.' : /PGRST202|42883|schema cache/i.test(code + ' ' + msg) ? 'Falta aplicar la migración de privacidad en la base de datos.' : 'No se pudo registrar. Revisa tu conexión e inténtalo de nuevo.';
        err.hidden = false;
      });
    };
    doc.body.append(d); d.showModal();
  }
  return { RIGHTS: RIGHTS, ORDER: ORDER, detect: detect, latest: latest, snippet: snippet, channelOf: channelOf, args: args, norm: norm, show: show };
});
