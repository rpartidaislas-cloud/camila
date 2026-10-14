/* SMYL · Etapa 9: sistema unificado de ventanas operativas. */
(function () {
  'use strict';

  var SELECTOR = [
    '.inventory-dialog', '.finance-dialog', '.schedule-dialog', '.catalog-dialog',
    '.clinic-admin-dialog', '.clinic-dialog', '.p360-dialog', '.pc-dialog',
    '.proposal-preview-dialog', '.smyl-inbox-forward-dialog',
    '.smyl-inbox-copilot-dialog', '.smyl-inbox-operations-dialog',
    '.lana-handoff-dialog'
  ].join(',');

  var FOOTER_SELECTOR = [
    '.inventory-actions', '.finance-actions', '.schedule-dialog-actions',
    '.catalog-dialog-actions', '.clinic-admin-actions', '.clinic-actions',
    '.p360-actions', '.pc-actions', '.proposal-actions', 'footer'
  ].join(',');

  function directChild(parent, selector) {
    return Array.prototype.find.call(parent.children || [], function (child) {
      return child.matches(selector);
    }) || null;
  }

  function sizeFor(dialog) {
    if (dialog.matches('.clinic-dialog,.clinic-admin-dialog,.smyl-inbox-forward-dialog,.lana-handoff-dialog')) return 'small';
    if (dialog.matches('.proposal-preview-dialog,.smyl-inbox-operations-dialog,.pc-dialog')) return 'large';
    return 'medium';
  }

  function makeHeader(form, dialog) {
    var existing = directChild(form, 'header');
    if (existing) {
      existing.classList.add('smyl-dialog-header');
      var existingClose = existing.querySelector('[data-close],[aria-label*="Cerrar" i]');
      if (existingClose) existingClose.classList.add('smyl-dialog-close');
      return existing;
    }
    var title = directChild(form, 'h1,h2,h3');
    if (!title) return null;
    var description = title.nextElementSibling && title.nextElementSibling.matches('p') ? title.nextElementSibling : null;
    var header = document.createElement('header');
    header.className = 'smyl-dialog-header';
    var copy = document.createElement('div');
    form.insertBefore(header, title);
    header.append(copy);
    copy.append(title);
    if (description) copy.append(description);
    return header;
  }

  function ensureClose(dialog, header) {
    if (!header) return;
    var close = header.querySelector('[data-close],[aria-label*="Cerrar" i]');
    if (!close) {
      close = document.createElement('button');
      close.type = 'button';
      close.dataset.smylDialogClose = 'true';
      close.setAttribute('aria-label', 'Cerrar ventana');
      close.textContent = '×';
      header.append(close);
    }
    close.classList.add('smyl-dialog-close');
  }

  function makeBody(form, header, footer) {
    var body = directChild(form, '.smyl-dialog-body');
    if (body) return body;
    body = document.createElement('div');
    body.className = 'smyl-dialog-body';
    var nodes = Array.prototype.slice.call(form.childNodes).filter(function (node) {
      return node !== header && node !== footer;
    });
    if (!nodes.length) return null;
    form.insertBefore(body, footer || null);
    nodes.forEach(function (node) { body.append(node); });
    return body;
  }

  function improveLabels(form) {
    form.querySelectorAll('label').forEach(function (label) {
      var control = directChild(label, 'input:not([type="checkbox"]):not([type="radio"]),select,textarea');
      if (!control || label.querySelector('.smyl-field-label')) return;
      var textNode = Array.prototype.find.call(label.childNodes, function (node) {
        return node.nodeType === Node.TEXT_NODE && node.textContent.trim();
      });
      if (!textNode) return;
      var caption = document.createElement('span');
      caption.className = 'smyl-field-label';
      caption.textContent = textNode.textContent.trim();
      if (control.required) {
        var required = document.createElement('i');
        required.textContent = 'Obligatorio';
        caption.append(required);
      }
      label.insertBefore(caption, label.firstChild);
      textNode.remove();
    });
  }

  function labelDialog(dialog, form) {
    var title = form.querySelector('.smyl-dialog-header h1,.smyl-dialog-header h2,.smyl-dialog-header h3');
    if (!title) return;
    if (!title.id) title.id = 'smyl-dialog-title-' + Math.random().toString(36).slice(2, 9);
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.setAttribute('aria-modal', 'true');
  }

  function protectDirtyForm(dialog, form) {
    form.addEventListener('input', function () { dialog.dataset.smylDirty = 'true'; });
    form.addEventListener('change', function () { dialog.dataset.smylDirty = 'true'; });
    form.addEventListener('submit', function () { dialog.dataset.smylDirty = 'false'; }, true);
  }

  function bindDialog(dialog) {
    if (dialog.dataset.smylDialogBound === 'true') return;
    dialog.dataset.smylDialogBound = 'true';
    dialog.addEventListener('click', function (event) {
      var close = event.target.closest('[data-close],[data-smyl-dialog-close]');
      if (!close || dialog.dataset.smylDirty !== 'true') return;
      if (!window.confirm('¿Cerrar sin guardar los cambios?')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    dialog.addEventListener('cancel', function (event) {
      if (dialog.dataset.smylDirty === 'true' && !window.confirm('¿Cerrar sin guardar los cambios?')) event.preventDefault();
    });
    dialog.addEventListener('close', function () {
      dialog.dataset.smylDirty = 'false';
      dialog.querySelectorAll('[data-smyl-invalid]').forEach(function (control) { delete control.dataset.smylInvalid; });
    });
  }

  function validation(form) {
    form.addEventListener('invalid', function (event) {
      event.target.dataset.smylInvalid = 'true';
      event.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, true);
    form.addEventListener('input', function (event) {
      if (event.target.validity && event.target.validity.valid) delete event.target.dataset.smylInvalid;
    });
  }

  function enhance(dialog) {
    if (!dialog) return;
    var form = directChild(dialog, 'form');
    if (!form) return;
    if (form.classList.contains('smyl-dialog-form')) return;
    dialog.dataset.smylDialogSystem = 'true';
    dialog.dataset.smylDialogSize = sizeFor(dialog);
    dialog.dataset.smylDirty = 'false';
    form.classList.add('smyl-dialog-form');
    var header = makeHeader(form, dialog);
    ensureClose(dialog, header);
    var footer = directChild(form, FOOTER_SELECTOR);
    if (footer) footer.classList.add('smyl-dialog-footer');
    makeBody(form, header, footer);
    improveLabels(form);
    labelDialog(dialog, form);
    bindDialog(dialog);
    protectDirtyForm(dialog, form);
    validation(form);
    var systemClose = dialog.querySelector('[data-smyl-dialog-close]');
    if (systemClose) systemClose.addEventListener('click', function () { dialog.close(); });
  }

  function scan(root) {
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.matches && root.matches(SELECTOR)) enhance(root);
    root.querySelectorAll(SELECTOR).forEach(enhance);
  }

  function enhanceLegacy(overlay) {
    if (!overlay || overlay.dataset.smylLegacyDialog === 'true') return;
    var modal = overlay.querySelector('.modal');
    if (!modal) return;
    overlay.dataset.smylLegacyDialog = 'true';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    var title = modal.querySelector('.modal-header h1,.modal-header h2,.modal-header h3');
    if (title) {
      if (!title.id) title.id = 'smyl-legacy-title-' + Math.random().toString(36).slice(2, 9);
      overlay.setAttribute('aria-labelledby', title.id);
    }
    modal.querySelectorAll('.modal-close').forEach(function (button) {
      if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', 'Cerrar ventana');
    });
    overlay.addEventListener('input', function () { overlay.dataset.smylDirty = 'true'; });
    overlay.addEventListener('change', function () { overlay.dataset.smylDirty = 'true'; });
    overlay.addEventListener('click', function (event) {
      var cancel = event.target.closest('.modal-close,.modal-footer .btn-secondary');
      if (!cancel || overlay.dataset.smylDirty !== 'true') return;
      if (!window.confirm('¿Cerrar sin guardar los cambios?')) {
        event.preventDefault(); event.stopImmediatePropagation();
      } else overlay.dataset.smylDirty = 'false';
    }, true);
  }

  function init() {
    scan(document);
    document.querySelectorAll('.modal-bg').forEach(enhanceLegacy);
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) { scan(node); });
        if (record.type === 'attributes' && record.target.matches && record.target.matches(SELECTOR)) enhance(record.target);
      });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.SmylDialogSystem = Object.freeze({ enhance: enhance, selector: SELECTOR });
})();
