/* Clinical Workspace v3.3 · semántica y accesibilidad de la revisión clínica. */
(function clinicalReviewWorkspaceV33() {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function addWorkspaceLabel() {
    const center = $('.header-center');
    const title = $('#tabTitle');
    if (!center || !title || $('.review-workspace-label', center)) return;
    const label = document.createElement('div');
    label.className = 'review-workspace-label';
    label.textContent = 'Revisión clínica fotográfica';
    center.insertBefore(label, title);
  }

  function addRegionHeading(root, options) {
    if (!root || $('.review-region-heading', root)) return;
    const heading = document.createElement('div');
    heading.className = 'review-region-heading';
    heading.innerHTML = `
      <div>
        <div class="review-region-kicker">${options.kicker}</div>
        <h3 id="${options.id}">${options.title}</h3>
      </div>
      <p>${options.description}</p>`;
    root.insertBefore(heading, root.firstChild);
    root.setAttribute('role', 'region');
    root.setAttribute('aria-labelledby', options.id);
  }

  const panelForTab = (name) => name === 'encia' ? $('#panelEncia') : $(`#tab-${name}`);

  function syncTabs() {
    const nav = $('.sidenav-items');
    if (!nav) return;
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Herramientas de revisión clínica');

    const tabs = $$('[data-tab]', nav);
    tabs.forEach((tab, index) => {
      const name = tab.dataset.tab;
      const panel = panelForTab(name);
      const active = tab.classList.contains('active');
      const unavailable = tab.classList.contains('disabled');
      const tabId = `review-tab-${name}`;
      tab.id = tabId;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('aria-disabled', String(unavailable));
      tab.tabIndex = active && !unavailable ? 0 : -1;
      tab.disabled = unavailable;
      if (panel) {
        const panelId = panel.id || `review-panel-${index}`;
        panel.id = panelId;
        tab.setAttribute('aria-controls', panelId);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tabId);
        panel.setAttribute('aria-hidden', String(!active));
        panel.tabIndex = 0;
      }
    });
  }

  function tabKeyboard(event) {
    const current = event.target.closest('[data-tab]');
    if (!current || !current.closest('.sidenav-items')) return;
    const enabled = $$('[data-tab]:not([disabled])', current.closest('.sidenav-items'));
    const index = enabled.indexOf(current);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else return;
    event.preventDefault();
    enabled[next].focus();
    enabled[next].click();
    queueMicrotask(syncTabs);
  }

  function syncViewSelector() {
    const selector = $('#selectorVista');
    if (!selector) return;
    selector.setAttribute('role', 'group');
    selector.setAttribute('aria-label', 'Vista de evidencia');
    $$('[data-vista]', selector).forEach((button) => {
      button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    });
  }

  function labelSymbolControls() {
    const labels = [
      ['button[onclick="zoomImagen(-1)"]', 'Alejar fotografía'],
      ['button[onclick="zoomImagen(1)"]', 'Acercar fotografía'],
      ['button[onclick="zoomImagen(0)"]', 'Restablecer zoom de fotografía'],
      ['button[onclick="nudgeCarilla(0,-1)"]', 'Mover carilla hacia arriba'],
      ['button[onclick="nudgeCarilla(-1,0)"]', 'Mover carilla hacia la izquierda'],
      ['button[onclick="nudgeCarilla(1,0)"]', 'Mover carilla hacia la derecha'],
      ['button[onclick="nudgeCarilla(0,1)"]', 'Mover carilla hacia abajo']
    ];
    labels.forEach(([selector, label]) => {
      const control = $(selector);
      if (control && !control.getAttribute('aria-label')) control.setAttribute('aria-label', label);
    });
  }

  function enhanceInteractive(root = document) {
    $$('.chip,.forma-chip,.vita-swatch', root).forEach((control) => {
      if (control.matches('button,input,select,textarea,a[href]')) return;
      control.setAttribute('role', 'button');
      if (!control.hasAttribute('tabindex')) control.tabIndex = 0;
      if (control.dataset.reviewKeyboard === 'true') return;
      control.dataset.reviewKeyboard = 'true';
      control.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        control.click();
      });
    });
  }

  function classifyState(element, announce = true) {
    if (!element) return;
    const text = element.textContent.trim().toLocaleLowerCase('es');
    let state = 'ready';
    if (/error|fall[oó]|no se pudo|no pudimos/.test(text)) state = 'error';
    else if (/cargando|procesando|analizando|generando|segmentando/.test(text)) state = 'loading';
    else if (!text || /todav[ií]a|no hay|sin calibrar|sube una foto|selecciona un diente|esperando/.test(text)) state = 'empty';
    element.dataset.reviewState = state;
    element.setAttribute('aria-busy', String(state === 'loading'));
    if (!announce) {
      element.removeAttribute('aria-live');
      return;
    }
    if (state === 'error') {
      element.setAttribute('role', 'alert');
      element.setAttribute('aria-live', 'assertive');
    } else {
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
    }
  }

  function observeState(element, announce = true) {
    if (!element) return;
    classifyState(element, announce);
    const observer = new MutationObserver(() => classifyState(element, announce));
    observer.observe(element, { childList: true, subtree: true, characterData: true });
  }

  function observeDynamicControls() {
    ['#toothSelect', '#gumSelect', '#vitaSwatchRow', '#objetosLista', '#carillaLista'].forEach((selector) => {
      const root = $(selector);
      if (!root) return;
      const observer = new MutationObserver(() => enhanceInteractive(root));
      observer.observe(root, { childList: true, subtree: true });
    });
  }

  function init() {
    if (!document.body.classList.contains('clinical-review-v33')) return;
    addWorkspaceLabel();
    addRegionHeading($('.canvas-col2'), {
      kicker: 'Evidencia',
      title: 'Fotografía y contornos',
      description: 'Revisa la imagen original, la selección dental y las capas visibles.'
    });
    addRegionHeading($('.panel-col2'), {
      kicker: 'Decisión',
      title: 'Ajustes clínicos',
      description: 'Confirma color, forma, encía y criterios del resultado.'
    });
    syncTabs();
    syncViewSelector();
    labelSymbolControls();
    enhanceInteractive();
    observeDynamicControls();

    [
      '#status', '#statusGuardado', '#fotoStatus', '#genSimStatus', '#loginErr',
      '#objetosListaVacia', '#carillaListaVacia',
      '#calibracionStatus', '#gumStatus', '#ayudaCorreccionDiente'
    ].forEach((selector) => observeState($(selector)));
    observeState($('#misCasosLista'), false);

    $('.sidenav-items')?.addEventListener('keydown', tabKeyboard);
    $('.sidenav-items')?.addEventListener('click', () => queueMicrotask(syncTabs));
    $('#selectorVista')?.addEventListener('click', () => queueMicrotask(syncViewSelector));
    document.documentElement.dataset.clinicalReviewReady = 'true';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
