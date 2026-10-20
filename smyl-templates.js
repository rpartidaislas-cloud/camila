/* SMYL · Mensajería → Plantillas de WhatsApp.
   Muestra el catálogo de plantillas para clínicas dentales (smyl-template-catalog.js) y,
   si LANA responde, cuáles ya están aprobadas. Las plantillas se solicitan a Meta desde LANA. */
(function () {
  'use strict';

  var catalog = window.SmylTemplateCatalog;
  if (!catalog) return;

  var CATEGORY = { UTILITY: 'Utilidad', MARKETING: 'Marketing' };
  var state = { category: 'all', group: 'all', query: '', approved: null, loading: false, error: '', loadedAt: 0 };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('es-MX').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  async function copy(value) {
    try { await navigator.clipboard.writeText(value); return true; }
    catch (_) {
      var area = document.createElement('textarea');
      area.value = value; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (__) {}
      area.remove();
      return done;
    }
  }

  async function loadApproved(force) {
    if (state.loading || (!force && state.loadedAt && Date.now() - state.loadedAt < 60 * 1000)) return;
    state.loading = true; state.error = ''; renderStatus();
    try {
      var session = await window.sb.auth.getSession();
      var jwt = session && session.data && session.data.session && session.data.session.access_token;
      if (!jwt) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
      var response = await fetch(SUPA_URL + '/functions/v1/lana-inbox?action=templates', { headers: { Authorization: 'Bearer ' + jwt, apikey: SUPA_KEY } });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'El servicio de mensajería no respondió.');
      state.approved = new Set((data.templates || []).map(function (item) { return String(item.name || ''); }));
      state.loadedAt = Date.now();
    } catch (error) {
      state.approved = null; state.error = error.message || 'No pudimos consultar el servicio de mensajería.';
    } finally {
      state.loading = false; renderStatus(); renderGrid();
    }
  }

  function visibleTemplates() {
    var query = normalize(state.query);
    return catalog.TEMPLATES.filter(function (template) {
      if (state.category !== 'all' && template.category !== state.category) return false;
      if (state.group !== 'all' && template.group !== state.group) return false;
      if (query && normalize([template.title, template.body, template.id, template.when].join(' ')).indexOf(query) === -1) return false;
      return true;
    });
  }

  function bodyNodes(template) {
    var fragment = document.createDocumentFragment();
    template.body.split(/(\{\{\s*\d+\s*\}\})/).forEach(function (part) {
      var match = part.match(/^\{\{\s*(\d+)\s*\}\}$/);
      if (!match) { fragment.append(document.createTextNode(part)); return; }
      var variable = template.variables[Number(match[1]) - 1];
      var mark = el('mark', 'tpl-var', variable ? variable.example : part);
      mark.title = '{{' + match[1] + '}} · ' + (variable ? variable.label : '');
      fragment.append(mark);
    });
    return fragment;
  }

  function copyButton(label, getValue, primary) {
    var button = el('button', 'btn ' + (primary ? 'btn-primary' : 'btn-secondary') + ' btn-sm', label);
    button.type = 'button';
    button.onclick = async function () {
      var ok = await copy(getValue());
      button.textContent = ok ? 'Copiada ✓' : 'No se pudo copiar';
      setTimeout(function () { button.textContent = label; }, 1800);
    };
    return button;
  }

  function statusChip(template) {
    if (!state.approved) return null;
    var approved = state.approved.has(template.id);
    var chip = el('span', 'tpl-chip tpl-chip-status', approved ? 'Aprobada por Meta' : 'Por solicitar');
    chip.dataset.state = approved ? 'approved' : 'missing';
    return chip;
  }

  function card(template) {
    var article = el('article', 'tpl-card'); article.dataset.category = template.category;
    var head = el('header', 'tpl-card-head');
    var chips = el('div', 'tpl-chips');
    var category = el('span', 'tpl-chip', CATEGORY[template.category]); category.dataset.category = template.category;
    chips.append(category);
    var status = statusChip(template); if (status) chips.append(status);
    if (template.automatic) chips.append(el('span', 'tpl-chip tpl-chip-auto', 'Recordatorio automático'));
    head.append(chips, el('h3', '', template.title), el('p', 'tpl-when', template.when));
    article.append(head);

    var bubble = el('div', 'tpl-bubble');
    if (template.header) bubble.append(el('strong', 'tpl-bubble-header', template.header));
    var body = el('p', 'tpl-bubble-body'); body.append(bodyNodes(template)); bubble.append(body);
    if (template.footer) bubble.append(el('small', 'tpl-bubble-footer', template.footer));
    article.append(bubble);
    if (template.buttons.length) {
      var buttons = el('div', 'tpl-buttons');
      template.buttons.forEach(function (button) { buttons.append(el('span', '', button.text)); });
      article.append(buttons);
    }
    if (template.note) article.append(el('p', 'tpl-note', template.note));

    var details = el('details', 'tpl-details');
    details.append(el('summary', '', 'Variables y datos técnicos'));
    var list = el('dl', 'tpl-facts');
    [['Nombre en Meta', template.id], ['Idioma', catalog.LANGUAGE.label + ' · ' + catalog.LANGUAGE.code]].forEach(function (row) {
      list.append(el('dt', '', row[0]), el('dd', '', row[1]));
    });
    template.variables.forEach(function (variable, index) {
      list.append(el('dt', '', '{{' + (index + 1) + '}}'), el('dd', '', variable.label + ' · ej. ' + variable.example));
    });
    details.append(list); article.append(details);

    var actions = el('footer', 'tpl-actions');
    actions.append(copyButton('Copiar datos de solicitud', function () { return catalog.formatForLana(template); }, true), copyButton('Copiar solo el texto', function () { return template.body; }, false));
    article.append(actions);
    return article;
  }

  function renderStatus() {
    var host = document.querySelector('[data-tpl-status]');
    if (!host) return;
    host.innerHTML = '';
    if (state.loading) { host.append(el('span', 'tpl-status-text', 'Consultando plantillas aprobadas…')); return; }
    if (state.error) {
      var retry = el('button', 'btn btn-secondary btn-sm', 'Reintentar'); retry.type = 'button'; retry.onclick = function () { loadApproved(true); };
      host.append(el('span', 'tpl-status-text', 'No pudimos consultar el servicio de mensajería, así que no sabemos cuáles están aprobadas.'), retry);
      return;
    }
    if (state.approved) {
      var count = catalog.TEMPLATES.filter(function (template) { return state.approved.has(template.id); }).length;
      host.append(el('strong', '', count + ' de ' + catalog.TEMPLATES.length), el('span', 'tpl-status-text', 'ya están aprobadas por Meta'));
    }
  }

  function renderToolbar() {
    var tabs = document.querySelector('[data-tpl-tabs]');
    if (!tabs) return;
    tabs.innerHTML = '';
    [['all', 'Todas'], ['UTILITY', 'Utilidad'], ['MARKETING', 'Marketing']].forEach(function (entry) {
      var total = catalog.TEMPLATES.filter(function (template) { return entry[0] === 'all' || template.category === entry[0]; }).length;
      var button = el('button', '', entry[1]); button.type = 'button'; button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(state.category === entry[0]));
      button.append(el('b', '', String(total)));
      button.onclick = function () { state.category = entry[0]; renderToolbar(); renderGrid(); };
      tabs.append(button);
    });
  }

  function renderGrid() {
    var grid = document.querySelector('[data-tpl-grid]');
    var count = document.querySelector('[data-tpl-count]');
    if (!grid) return;
    var items = visibleTemplates();
    grid.innerHTML = '';
    if (count) count.textContent = items.length === catalog.TEMPLATES.length ? items.length + ' plantillas' : items.length + ' de ' + catalog.TEMPLATES.length + ' plantillas';
    if (!items.length) {
      var empty = el('div', 'tpl-empty'); empty.append(el('strong', '', 'No hay plantillas con esos filtros'), el('p', '', 'Prueba con otra categoría o borra la búsqueda.'));
      grid.append(empty); return;
    }
    items.forEach(function (template) { grid.append(card(template)); });
  }

  function build() {
    var page = el('section', 'pantalla templates-page'); page.id = 'p-plantillas';
    var head = el('header', 'tpl-head');
    var copyBlock = el('div');
    copyBlock.append(el('span', 'pro-eyebrow', 'MENSAJERÍA'), el('h1', '', 'Plantillas de WhatsApp'),
      el('p', '', catalog.TEMPLATES.length + ' propuestas para clínicas dentales. Meta debe aprobar cada una antes de usarla fuera de la ventana de 24 horas; se solicitan desde tu panel de mensajería.'));
    var status = el('div', 'tpl-status'); status.dataset.tplStatus = '';
    head.append(copyBlock, status);

    // En celular los pasos empiezan plegados para llegar antes a las plantillas.
    var how = el('details', 'tpl-how'); how.open = !window.matchMedia('(max-width:760px)').matches;
    how.append(el('summary', '', 'Cómo solicitarlas'));
    var steps = el('ol', 'tpl-steps');
    [['Copia la plantilla', 'Elige una y presiona «Copiar datos de solicitud».'],
     ['Solicítala en tu panel de mensajería', 'Entra a Mensajería → Plantillas WhatsApp → Nueva plantilla y pega los datos.'],
     ['Espera a Meta', 'Suele tardar de unos minutos a 48 horas. Cuando se apruebe, aquí dirá «Aprobada por Meta».']].forEach(function (step, index) {
      var item = el('li'); item.append(el('b', '', String(index + 1)));
      var text = el('div'); text.append(el('strong', '', step[0]), el('span', '', step[1])); item.append(text); steps.append(item);
    });

    var rules = el('details', 'tpl-rules');
    rules.append(el('summary', '', 'Reglas de Meta que respetan estas plantillas'));
    var ruleList = el('div', 'tpl-rule-list');
    catalog.RULES.forEach(function (rule) { var item = el('div'); item.append(el('strong', '', rule.title), el('p', '', rule.text)); ruleList.append(item); });
    rules.append(ruleList);

    var toolbar = el('div', 'tpl-toolbar');
    var tabs = el('div', 'tpl-tabs'); tabs.dataset.tplTabs = ''; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Categoría');
    var search = el('input'); search.type = 'search'; search.placeholder = 'Buscar plantilla'; search.setAttribute('aria-label', 'Buscar plantilla');
    search.oninput = function () { state.query = search.value; renderGrid(); };
    var group = el('select'); group.setAttribute('aria-label', 'Tipo de mensaje');
    group.append(new Option('Todos los tipos', 'all'));
    catalog.GROUPS.forEach(function (entry) { group.append(new Option(entry.label, entry.id)); });
    group.onchange = function () { state.group = group.value; renderGrid(); };
    toolbar.append(tabs, group, search);

    var count = el('p', 'tpl-count'); count.dataset.tplCount = '';
    var grid = el('div', 'tpl-grid'); grid.dataset.tplGrid = '';
    how.append(steps);
    page.append(head, how, rules, toolbar, count, grid);
    document.querySelector('.contenido').append(page);
    renderToolbar(); renderStatus(); renderGrid();
  }

  function init() {
    if (document.getElementById('p-plantillas')) return;
    window.TITULOS = window.TITULOS || {};
    window.TITULOS.plantillas = 'Plantillas de WhatsApp';
    build();
    var previous = window.ir;
    if (typeof previous === 'function') {
      window.ir = function (route) {
        var result = previous.apply(this, arguments);
        if (route === 'plantillas') loadApproved(false);
        return result;
      };
    }
    window.SmylTemplates = Object.freeze({ reload: function () { return loadApproved(true); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
