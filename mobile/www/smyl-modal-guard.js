/* SMYL · Ventanas: hacer clic FUERA de una ventana nunca la cierra.
   Pasaba que cada ventana traía su propio «si el clic fue en el fondo, cerrar» y, además, al seleccionar texto
   y soltar el ratón fuera, el navegador lo contaba como clic en el fondo: se perdía lo escrito. Este guardián
   intercepta el clic en el fondo (antes que cualquier código de la ventana) y la deja abierta con un pequeño
   latido que indica que no se cerró. Se cierran con su botón (Cerrar / Cancelar / ×) o con Esc.
   Excepciones: la paleta de búsqueda (#smyl-command-dialog) y lo que lleve data-allow-outside-close. */
(function (root, factory) {
  var api = factory(typeof window !== 'undefined' ? window : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  // Excepciones: paleta de búsqueda, menú «Más opciones» del celular y pantalla de inicio de sesión no son ventanas con datos.
  var ALLOW = '#smyl-command-dialog,#panel-admin-mobile,#auth-gate-overlay,[data-allow-outside-close]';
  // Capas a pantalla completa que hacen de fondo de una ventana propia (no <dialog>). A propósito NO se incluye todo lo que
  // se llame «overlay» o «backdrop»: los menús laterales y hojas del celular sí deben cerrarse al tocar fuera.
  var OVERLAY_HINT = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],.modal-bg,[id^="modal-"],.lana-handoff-overlay';
  var EVENTS = ['click', 'auxclick', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];

  function isModalDialog(node) {
    if (!node.open) return false;
    try { return node.matches(':modal'); } catch (_) { return true; }
  }

  function isBackdrop(node) {
    if (!win || !node || node.nodeType !== 1) return false;
    if (node.closest && node.closest(ALLOW)) return false;
    if (node.tagName === 'DIALOG') return isModalDialog(node);
    if (!node.firstElementChild || !node.matches(OVERLAY_HINT)) return false;
    var style = win.getComputedStyle(node);
    if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') return false;
    var box = node.getBoundingClientRect();
    return box.width >= win.innerWidth - 2 && box.height >= win.innerHeight - 2;
  }

  function nudge(node) {
    var panel = node.tagName === 'DIALOG' ? node : node.firstElementChild;
    if (!panel) return;
    panel.classList.remove('smyl-modal-nudge');
    void panel.offsetWidth;
    panel.classList.add('smyl-modal-nudge');
    setTimeout(function () { panel.classList.remove('smyl-modal-nudge'); }, 360);
  }

  function onEvent(event) {
    var target = event.target;
    if (!isBackdrop(target)) return;
    event.stopImmediatePropagation();
    if (event.type === 'click') { event.preventDefault(); nudge(target); }
  }

  if (win && win.document) EVENTS.forEach(function (type) { win.document.addEventListener(type, onEvent, true); });
  return { isBackdrop: isBackdrop, ALLOW: ALLOW, EVENTS: EVENTS };
});
