/* Protección de acceso de SMYL (expedientes clínicos):
 *  - Contraseñas de al menos 10 caracteres con letras y números (la regla del servidor de Auth debe coincidir).
 *  - Cierre de sesión tras 30 minutos sin actividad, con aviso 3 minutos antes.
 *  - Verificación en dos pasos con app autenticadora (TOTP de Supabase Auth): activarla en Mi cuenta y pedir
 *    el código al entrar cuando la cuenta la tiene activa.
 * No guarda contraseñas ni códigos; usa solo la API de Supabase Auth. */
(function (global) {
  'use strict';
  var MIN_PASSWORD = 10;
  var IDLE_MS = 30 * 60 * 1000;
  var WARN_MS = 3 * 60 * 1000;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  // ── Contraseñas ────────────────────────────────────────────────────────────
  function passwordProblem(password) {
    var p = String(password || '');
    if (p.length < MIN_PASSWORD) return 'La contraseña debe tener al menos ' + MIN_PASSWORD + ' caracteres.';
    if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(p) || !/\d/.test(p)) return 'La contraseña debe combinar letras y números.';
    return '';
  }

  // ── Inactividad ────────────────────────────────────────────────────────────
  var idle = { timer: null, warnTimer: null, banner: null, onExpire: null, last: 0, started: false };
  function hideWarning() { if (idle.banner) { idle.banner.remove(); idle.banner = null; } }
  function showWarning() {
    if (idle.banner) return;
    var box = el('div', 'smyl-idle-warning');
    box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-live', 'assertive');
    box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;background:#0f172a;color:#fff;padding:14px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;max-width:calc(100vw - 32px);font:14px/1.4 Inter,system-ui,sans-serif';
    var text = el('span', '', 'Por seguridad cerraremos tu sesión en unos minutos por inactividad.');
    var keep = el('button', '', 'Seguir conectado');
    keep.type = 'button';
    keep.style.cssText = 'flex:none;background:#fff;color:#0f172a;border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer';
    keep.addEventListener('click', function () { touch(true); });
    box.append(text, keep); document.body.appendChild(box); idle.banner = box;
  }
  function schedule() {
    clearTimeout(idle.timer); clearTimeout(idle.warnTimer);
    idle.warnTimer = setTimeout(showWarning, IDLE_MS - WARN_MS);
    idle.timer = setTimeout(function () { hideWarning(); stopIdleLogout(); if (idle.onExpire) idle.onExpire(); }, IDLE_MS);
  }
  function touch(force) {
    if (!idle.started) return;
    var now = Date.now();
    if (!force && now - idle.last < 15000) return; // no reprogramar en cada movimiento
    idle.last = now; hideWarning(); schedule();
  }
  var EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
  function onActivity() { touch(false); }
  function startIdleLogout(onExpire) {
    idle.onExpire = onExpire; if (idle.started) { touch(true); return; }
    idle.started = true; idle.last = Date.now();
    EVENTS.forEach(function (name) { document.addEventListener(name, onActivity, { passive: true, capture: true }); });
    schedule();
  }
  function stopIdleLogout() {
    idle.started = false; clearTimeout(idle.timer); clearTimeout(idle.warnTimer); hideWarning();
    EVENTS.forEach(function (name) { document.removeEventListener(name, onActivity, { capture: true }); });
  }

  // ── Verificación en dos pasos (TOTP) ───────────────────────────────────────
  function dialogShell(title, intro) {
    var dialog = el('dialog', 'smyl-mfa-dialog');
    dialog.style.cssText = 'margin:auto;inset:0;max-height:calc(100vh - 32px);overflow:auto;max-width:420px;width:calc(100vw - 32px);border:0;border-radius:16px;padding:22px;font:14px/1.5 Inter,system-ui,sans-serif;color:#0f172a';
    var h = el('h2', '', title); h.style.cssText = 'margin:0 0 8px;font-size:19px';
    var p = el('p', '', intro); p.style.cssText = 'margin:0 0 14px;color:#475569';
    var body = el('div');
    var feedback = el('p', 'smyl-mfa-feedback'); feedback.setAttribute('role', 'status'); feedback.style.cssText = 'min-height:20px;margin:10px 0 0;color:#b91c1c';
    var actions = el('div'); actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap';
    dialog.append(h, p, body, feedback, actions); document.body.appendChild(dialog);
    return { dialog: dialog, body: body, feedback: feedback, actions: actions };
  }
  function codeInput() {
    var input = el('input');
    input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; input.maxLength = 6; input.placeholder = '123456';
    input.setAttribute('aria-label', 'Código de 6 dígitos');
    input.style.cssText = 'width:100%;box-sizing:border-box;font-size:22px;letter-spacing:6px;text-align:center;padding:10px;border:1px solid #cbd5e1;border-radius:10px';
    return input;
  }
  function btn(text, primary) {
    var b = el('button', '', text); b.type = 'button';
    b.style.cssText = 'border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;border:1px solid ' + (primary ? '#1e3a8a;background:#1e3a8a;color:#fff' : '#cbd5e1;background:#fff;color:#0f172a');
    return b;
  }

  async function verifiedTotp(sb) {
    var res = await sb.auth.mfa.listFactors();
    if (res.error) throw res.error;
    return ((res.data && res.data.totp) || []).filter(function (f) { return f.status === 'verified'; });
  }

  /** Si la cuenta tiene la verificación en dos pasos activa y la sesión aún no la cumplió, pide el código.
   *  Devuelve true si la sesión puede continuar. */
  async function ensureSecondFactor(sb) {
    if (!sb || !sb.auth || !sb.auth.mfa) return true;
    var level = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level.error) throw level.error;
    if (!level.data || level.data.nextLevel !== 'aal2' || level.data.currentLevel === 'aal2') return true;
    var factors = await verifiedTotp(sb);
    if (!factors.length) return true;
    return new Promise(function (resolve) {
      var ui = dialogShell('Verificación en dos pasos', 'Escribe el código de 6 dígitos de tu app autenticadora.');
      var input = codeInput(); ui.body.append(input);
      var cancel = btn('Salir'), ok = btn('Verificar', true);
      ui.actions.append(cancel, ok);
      var done = function (value) { ui.dialog.close(); ui.dialog.remove(); resolve(value); };
      cancel.addEventListener('click', function () { done(false); });
      ui.dialog.addEventListener('cancel', function (e) { e.preventDefault(); });
      var submit = async function () {
        var code = input.value.replace(/\D/g, '');
        if (code.length !== 6) { ui.feedback.textContent = 'El código tiene 6 dígitos.'; return; }
        ok.disabled = true; ui.feedback.textContent = '';
        var res = await sb.auth.mfa.challengeAndVerify({ factorId: factors[0].id, code: code });
        ok.disabled = false;
        if (res.error) { ui.feedback.textContent = 'Código incorrecto o vencido. Inténtalo de nuevo.'; input.select(); return; }
        done(true);
      };
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      ui.dialog.showModal(); input.focus();
    });
  }

  /** Activa la verificación en dos pasos: muestra el QR, pide el primer código y confirma. */
  async function openSetup(sb, onChange) {
    var ui = dialogShell('Activar verificación en dos pasos', 'Escanea el código con Google Authenticator, Microsoft Authenticator u otra app compatible y escribe el código que te muestre.');
    var close = btn('Cancelar'), ok = btn('Activar', true);
    ui.actions.append(close, ok);
    var factorId = null;
    var finish = async function (verified) {
      if (!verified && factorId) { try { await sb.auth.mfa.unenroll({ factorId: factorId }); } catch (_) {} }
      ui.dialog.close(); ui.dialog.remove(); if (onChange) onChange();
    };
    close.addEventListener('click', function () { finish(false); });
    ui.dialog.showModal();
    try {
      var enrolled = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SMYL ' + new Date().toISOString().slice(0, 10) });
      if (enrolled.error) throw enrolled.error;
      factorId = enrolled.data.id;
      var img = el('img'); img.src = enrolled.data.totp.qr_code; img.alt = 'Código QR para tu app autenticadora';
      img.style.cssText = 'display:block;width:180px;height:180px;margin:0 auto 10px';
      var secret = el('p', '', 'Si no puedes escanear, escribe esta clave: ' + enrolled.data.totp.secret);
      secret.style.cssText = 'font-size:12px;color:#475569;word-break:break-all;margin:0 0 10px';
      var input = codeInput();
      ui.body.append(img, secret, input); input.focus();
      var submit = async function () {
        var code = input.value.replace(/\D/g, '');
        if (code.length !== 6) { ui.feedback.textContent = 'El código tiene 6 dígitos.'; return; }
        ok.disabled = true; ui.feedback.textContent = '';
        var res = await sb.auth.mfa.challengeAndVerify({ factorId: factorId, code: code });
        ok.disabled = false;
        if (res.error) { ui.feedback.textContent = 'Código incorrecto. Revisa la hora de tu teléfono e inténtalo de nuevo.'; return; }
        factorId = null; await finish(true);
      };
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    } catch (error) {
      ui.feedback.textContent = 'No se pudo iniciar la activación: ' + (error && error.message || 'intenta de nuevo') + '.';
      ok.disabled = true;
    }
  }

  async function disable(sb, onChange) {
    if (!window.confirm('¿Desactivar la verificación en dos pasos? Tu cuenta quedará protegida solo con la contraseña.')) return;
    var factors = await verifiedTotp(sb);
    for (var i = 0; i < factors.length; i++) {
      var res = await sb.auth.mfa.unenroll({ factorId: factors[i].id });
      if (res.error) { window.alert('No se pudo desactivar: ' + res.error.message + '. Vuelve a entrar con tu código e inténtalo de nuevo.'); break; }
    }
    if (onChange) onChange();
  }

  /** Dibuja la tarjeta «Verificación en dos pasos» dentro de host (Mi cuenta). */
  async function renderCard(sb, host) {
    if (!host || !sb || !sb.auth || !sb.auth.mfa) return;
    host.replaceChildren();
    var title = el('div', 'card-title', 'Verificación en dos pasos');
    var text = el('p', '', 'Cargando…'); text.style.cssText = 'font-size:12.5px;color:var(--texto2);line-height:1.5;margin:0 0 12px';
    host.append(title, text);
    var refresh = function () { renderCard(sb, host); };
    try {
      var factors = await verifiedTotp(sb);
      var action = el('button', 'btn ' + (factors.length ? 'btn-secondary' : 'btn-primary'), factors.length ? 'Desactivar' : 'Activar verificación en dos pasos');
      action.type = 'button';
      text.textContent = factors.length
        ? 'Activa. Al entrar te pediremos el código de tu app autenticadora además de tu contraseña.'
        : 'Recomendada para quien consulta expedientes: además de tu contraseña, pediremos un código de tu app autenticadora al entrar.';
      action.addEventListener('click', function () { if (factors.length) disable(sb, refresh); else openSetup(sb, refresh); });
      host.append(action);
    } catch (error) {
      text.textContent = 'No se pudo consultar la verificación en dos pasos. Intenta más tarde.';
    }
  }

  global.SmylAuthGuard = Object.freeze({
    MIN_PASSWORD: MIN_PASSWORD,
    IDLE_MINUTES: IDLE_MS / 60000,
    passwordProblem: passwordProblem,
    startIdleLogout: startIdleLogout,
    stopIdleLogout: stopIdleLogout,
    ensureSecondFactor: ensureSecondFactor,
    renderCard: renderCard
  });
})(window);
