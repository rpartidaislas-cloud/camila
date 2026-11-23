/* Periodontal measurements inside the dental record. The host owns the draft and its revision. */
(function () {
  'use strict';
  const sites = ['MB', 'B', 'DB', 'ML', 'L', 'DL'];
  const positions = ['Mesial', 'Central', 'Distal'];
  const metrics = {depth:'Sondaje', margin:'Margen gingival', bleeding:'Sangrado'};
  let instanceId = 0;

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, action, className = 'perio-btn') {
    const el = element('button', className, text);
    el.type = 'button';
    el.addEventListener('click', action);
    return el;
  }
  function select(label, choices, value, change) {
    const el = element('select', 'perio-select');
    el.setAttribute('aria-label', label);
    for (const [key, text] of choices) el.add(new Option(text, key));
    el.value = value;
    el.addEventListener('change', () => change(el.value));
    return el;
  }
  function formatDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    const date = new Date(value + 'T12:00:00');
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString('es-MX', {day:'numeric', month:'short', year:'numeric'}) : '';
  }
  function today() {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  }
  function display(value) {
    if (value == null) return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    return String(value);
  }
  function faceName(tooth, index) {
    return index < 3 ? 'Vestibular' : Number(tooth) < 30 ? 'Palatina' : 'Lingual';
  }
  function siteLabel(tooth, index) {
    return positions[index % 3] + ' · ' + faceName(tooth, index);
  }
  function counts(exam, tooth) {
    const entries = Object.values(exam?.teeth?.[tooth] || {});
    return {depths:entries.filter(site => site.depth != null).length,
      bleeding:entries.filter(site => site.bleeding === true).length,
      checked:entries.filter(site => typeof site.bleeding === 'boolean').length};
  }
  function summary(exam, tooth) {
    const data = counts(exam, tooth);
    if (!Object.keys(exam?.teeth?.[tooth] || {}).length) return 'Sin mediciones registradas';
    return data.depths + '/6 sitios sondeados' + (data.checked ? ' · Sangrado en ' + data.bleeding + ' de ' + data.checked : '');
  }
  function historyFor(state) {
    const unique = new Map();
    for (const exam of [state.previous, ...(state.history || [])]) {
      if (exam?.id && exam.id !== state.current?.id && exam.status === 'closed' &&
          (!state.current?.date || exam.date <= state.current.date) && !unique.has(exam.id)) unique.set(exam.id, exam);
    }
    return [...unique.values()].sort((a,b) => b.date.localeCompare(a.date) || (b.revision || 0) - (a.revision || 0));
  }
  function gridTable(headers, label) {
    const table = element('table', 'perio-table');
    table.setAttribute('aria-label', label);
    const row = table.createTHead().insertRow();
    for (const heading of headers) {
      const th = element('th', '', heading); th.scope = 'col'; row.append(th);
    }
    return table;
  }

  function mount(host, initial) {
    let options = initial, tooth = String(initial.tooth || ''), patient = initial.patientId;
    let dialog = null, mila = null, destroyed = false, mode = 'tooth', chartMetric = 'depth';
    let chartView = 'graph', graph = null, graphTooth = tooth, graphSite = '', captureSite = '';
    let guide = null, guideSelection = null, guideExamId = '', guideReturn = 'chart';
    let renderedExam = null, renderedGraphState = '';
    let compareId = '', compareMetric = 'depth', comparisonOpen = false, savePending = false, confirmClose = false;
    let returnFocus = null, pageKey = '', fields = new Map(), message = '', entryOpen = false;
    let dialogBody, dialogTitle, dialogMeta, footer, alert, compareArea;
    const key = 'smyl-perio-' + (++instanceId);
    const state = () => options.getState() || {};
    const editable = s => !!s.canEdit && s.ready !== false && !s.conflict && !s.busy && !savePending && s.current?.status === 'draft';
    const teeth = window.SmylDentalModel.teeth;
    const activeTooth = () => teeth.includes(tooth);
    const wrapper = element('section', 'perio-entry');
    const toggle = button('', toggleEntry, 'perio-launch');
    const titleGroup = element('span','perio-launch-text');
    const subtitle = element('small');
    titleGroup.append(element('strong','','Periodoncia'), subtitle);
    const chevron = element('span','perio-chevron'); chevron.setAttribute('aria-hidden','true');
    toggle.append(titleGroup, chevron);
    const inline = element('div','perio-inline');
    inline.id = key + '-panel'; inline.hidden = true; toggle.setAttribute('aria-controls',inline.id);
    wrapper.append(toggle, inline);
    host.replaceChildren(wrapper);

    function setMessage(text) {
      message = text || '';
      if (alert) alert.textContent = message;
    }
    function refreshEntry() {
      const s = state();
      wrapper.hidden = s.canRead === false;
      toggle.disabled = s.ready === false;
      toggle.setAttribute('aria-expanded', String(!!dialog || entryOpen));
      toggle.setAttribute('aria-controls', dialog?.id || inline.id);
      subtitle.textContent = s.ready === false ? 'Cargando…' : summary(s.current, tooth);
      inline.hidden = !entryOpen;
      if (entryOpen) {
        inline.replaceChildren();
        const visit = s.current;
        if (visit) {
          inline.append(element('span','perio-caption',[formatDate(visit.date),visit.clinician].filter(Boolean).join(' · ')));
          if (activeTooth() && Object.keys(visit.teeth?.[tooth] || {}).length) {
            const table = gridTable(['Sondaje (mm)', ...positions], 'Sondaje actual de la pieza ' + tooth);
            const body = table.createTBody();
            for (const first of [0,3]) {
              const row = body.insertRow(), label = element('th','',faceName(tooth,first));
              label.scope = 'row'; row.append(label);
              for (const site of sites.slice(first,first+3)) row.insertCell().textContent = display(visit.teeth[tooth][site]?.depth);
            }
            inline.append(table);
            const prior = historyFor(s)[0];
            if (prior) inline.append(element('span','perio-caption','Control anterior · ' + formatDate(prior.date)));
          }
        }
        if (activeTooth()) inline.append(button(visit && Object.keys(visit.teeth?.[tooth] || {}).length ? 'Ver mediciones' : s.canEdit ? 'Registrar sondaje' : 'Ver pieza', () => open('tooth')));
        inline.append(button('Ver periodontograma completo', () => open('chart'), 'perio-link'));
      }
    }
    function toggleEntry() {
      if (window.matchMedia('(max-width: 700px)').matches) return open(activeTooth() ? 'tooth' : 'chart');
      entryOpen = !entryOpen;
      refreshEntry();
    }
    function disposeMila() {
      mila?.destroy?.();
      mila = null;
    }
    function disposeGraph() {
      graph?.destroy?.();
      graph = null; renderedExam = null; renderedGraphState = '';
    }
    function disposeGuide() {
      guide?.destroy();
      guide = null; guideSelection = null; guideExamId = '';
    }
    function closeDialog(restore = true) {
      if (!dialog) return;
      const target = returnFocus;
      disposeGuide(); disposeMila(); disposeGraph(); captureSite = '';
      const current = dialog;
      dialog = null; pageKey = ''; fields.clear(); confirmClose = false; compareArea = null; alert = null;
      current.close(); current.remove();
      if (!destroyed) refreshEntry();
      if (restore && !destroyed) {
        const selected = host.closest('.cw-clinical-map')?.querySelector('button.cw-map-selected');
        const visible = [target, selected, toggle].find(el => el?.isConnected && el.matches('button:not(:disabled),a[href],[tabindex="0"]') && el.getClientRects().length);
        visible?.focus({preventScroll:true});
      }
    }
    function validFields() {
      const invalid = dialog?.querySelector('[aria-invalid="true"]');
      if (!invalid) return true;
      invalid.focus();
      setMessage(invalid.validationMessage || 'Revisa el valor señalado.');
      return false;
    }
    function requestClose() {
      if (guide) { guide.requestExit(); return; }
      if (!validFields()) return;
      closeDialog();
    }
    function open(nextMode = 'tooth') {
      if (destroyed || state().canRead === false || state().ready === false) return;
      const next = nextMode === 'chart' || !activeTooth() ? 'chart' : 'tooth';
      if (dialog) { if (!guide && validFields()) { mode = next; renderDialog(true); } return; }
      mode = next;
      returnFocus = document.activeElement;
      message = ''; confirmClose = false;
      dialog = element('dialog','perio-dialog');
      dialog.id = key + '-dialog';
      dialog.setAttribute('aria-labelledby',key + '-title');
      const header = element('header','perio-header'), text = element('div');
      dialogTitle = element('h2'); dialogTitle.id = key + '-title';
      dialogMeta = element('p','perio-meta');
      text.append(dialogTitle, dialogMeta);
      const close = button('×', requestClose, 'perio-close');
      close.setAttribute('aria-label','Cerrar periodontograma');
      header.append(text, close);
      dialogBody = element('div','perio-body');
      footer = element('footer','perio-footer');
      alert = element('p','perio-feedback'); alert.setAttribute('role','status');
      dialog.append(header, dialogBody, alert, footer);
      document.body.append(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
      renderDialog(true);
      dialog.showModal();
      close.focus({preventScroll:true});
      refreshEntry();
      fetchHistory();
    }
    function fetchHistory() {
      if (!options.onHistory || state().historyLoading) return;
      const session = dialog;
      Promise.resolve().then(() => options.onHistory()).then(() => {
        if (dialog && dialog === session) update();
      }).catch(() => {
        if (dialog && dialog === session) { update(); setMessage('No se pudieron cargar los controles anteriores.'); }
      });
    }
    function changeMode(next) {
      if (!validFields()) return;
      mode = next; confirmClose = false; setMessage(''); renderDialog(true);
      dialogBody.scrollTop = 0;
      if (next === 'chart' && captureSite && graph?.focusSelection) graph.focusSelection();
      else { dialogTitle.tabIndex = -1; dialogTitle.focus({preventScroll:true}); }
    }
    function chooseTooth(next, site = '') {
      if (!teeth.includes(next) || !validFields()) return;
      captureSite = sites.includes(site) ? site : '';
      graphTooth = next; graphSite = captureSite;
      tooth = next; mode = 'tooth'; confirmClose = false; setMessage('');
      options.onSelectTooth?.(next);
      if (!destroyed && dialog) {
        refreshEntry(); renderDialog(true); dialogBody.scrollTop = 0;
        if (captureSite) {
          const target = fields.get(captureSite + '-depth') || dialogBody.querySelector('[data-perio-reading="'+captureSite+'-depth"]');
          target?.focus(); target?.select?.();
        }
      }
    }
    function newExam(s) {
      const area = element('section','perio-start');
      if (!s.canEdit || s.conflict) {
        area.append(element('p','','Sin exploración periodontal registrada.'));
        return area;
      }
      const dateLabel = element('label','perio-date','Fecha de exploración');
      const date = element('input'); date.type = 'date'; date.value = today(); date.required = true;
      dateLabel.append(date); area.append(dateLabel);
      area.append(button(s.current ? 'Iniciar nuevo control' : 'Iniciar exploración', () => {
        if (!date.reportValidity()) return;
        if (options.onStart?.(date.value) === false) { setMessage('Revisa la fecha y el estado del expediente antes de iniciar.'); return; }
        setMessage('Exploración iniciada.'); renderDialog(true); refreshEntry();
      }, 'perio-btn perio-primary'));
      return area;
    }
    function applyChange(patch) {
      if (!editable(state()) || !options.onChange || options.onChange(patch) === false) return false;
      refreshEntry(); syncFooter();
      if (compareArea && !('summary' in patch)) {
        const recorded = state().current?.teeth?.[tooth];
        for (const cell of compareArea.querySelectorAll('[data-perio-compare-site]')) {
          cell.textContent = display(recorded?.[cell.dataset.perioCompareSite]?.[compareMetric]);
        }
      }
      return true;
    }
    function measurementInput(s, site, index, metric) {
      const stored = s.current.teeth?.[tooth]?.[site]?.[metric] ?? null;
      const label = metrics[metric] + ' · ' + siteLabel(tooth,index) + ' · pieza ' + tooth;
      if (s.current.status === 'closed' || !s.canEdit) {
        const value = element('span','perio-read-value',display(stored));
        value.tabIndex = -1; value.dataset.perioReading = site + '-' + metric;
        value.setAttribute('aria-label',label + ' · ' + (stored == null ? 'Sin medir' : display(stored)));
        return value;
      }
      let input;
      if (metric === 'bleeding') {
        input = select(label, [['','—'],['yes','Sí'],['no','No']], stored == null ? '' : stored ? 'yes' : 'no', value => {
          if (!applyChange({tooth, site, field:metric, value:value === '' ? null : value === 'yes'})) update();
        });
      } else {
        input = element('input','perio-number');
        // El teclado numérico de algunos móviles carece de la tecla menos para el margen.
        input.type = 'text'; input.inputMode = metric === 'depth' ? 'numeric' : 'text';
        input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = '—';
        input.setAttribute('aria-label',label + ' en milímetros'); input.value = stored == null ? '' : String(stored);
        input.addEventListener('input', () => {
          const raw = input.value.trim(), value = raw === '' ? null : Number(raw);
          const valid = value === null || (/^-?\d+$/.test(raw) && Number.isInteger(value) && value >= (metric === 'depth' ? 0 : -20) && value <= 20);
          input.setAttribute('aria-invalid',String(!valid));
          input.setCustomValidity(valid ? '' : (metric === 'depth' ? 'Introduce un entero de 0 a 20 mm.' : 'Introduce un entero de −20 a 20 mm.'));
          if (!valid) { setMessage(input.validationMessage); return; }
          setMessage('');
          if (!applyChange({tooth,site,field:metric,value})) { input.value = display(state().current?.teeth?.[tooth]?.[site]?.[metric]).replace('—',''); update(); }
        });
        input.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (!validFields()) return;
          const next = fields.get((sites[index+1] || '') + '-' + metric);
          if (next) { next.focus(); next.select?.(); }
        });
      }
      input.disabled = !editable(s); input.dataset.perioSite = site; input.dataset.perioField = metric;
      fields.set(site + '-' + metric, input);
      return input;
    }
    function face(s, start) {
      const section = element('section','perio-face');
      const name = faceName(tooth,start);
      section.append(element('h3','',name));
      const table = gridTable(['Sitio', 'Mesial', 'Central', 'Distal'], name + ' de la pieza ' + tooth);
      const selectedColumn = sites.indexOf(captureSite) - start;
      if (selectedColumn >= 0 && selectedColumn < 3) table.tHead.rows[0].cells[selectedColumn + 1].classList.add('perio-selected-site');
      const tbody = table.createTBody();
      for (const [metric, label] of Object.entries(metrics)) {
        const tr = tbody.insertRow(), heading = element('th','',label); heading.scope = 'row';
        if (metric !== 'bleeding') heading.append(element('small','','mm'));
        tr.append(heading);
        for (let i=start; i<start+3; i++) {
          const cell = tr.insertCell();
          if (sites[i] === captureSite) cell.classList.add('perio-selected-site');
          cell.append(measurementInput(s,sites[i],i,metric));
        }
      }
      section.append(table);
      return section;
    }
    function comparison(s) {
      const prior = historyFor(s), selected = prior.find(e => e.id === compareId) || prior[0];
      const details = element('details','perio-details');
      details.open = comparisonOpen;
      details.addEventListener('toggle', () => { if (details.isConnected) comparisonOpen = details.open; });
      details.append(element('summary','','Comparar visitas'));
      const content = element('div','perio-details-body');
      if (s.historyLoading) content.append(element('p','perio-caption','Cargando visitas…'));
      if (s.historyError) content.append(button('Reintentar historial',fetchHistory,'perio-link'));
      if (!selected && !s.historyLoading && !s.historyError) content.append(element('p','perio-caption','La comparación estará disponible cuando haya otra exploración cerrada.'));
      if (selected) {
        const controls = element('div','perio-compare-controls');
        const visits = prior.map((e,index) => {
          const sameDay = prior.some(other => other.id !== e.id && other.date === e.date);
          const version = sameDay ? (e.revision ? 'Revisión '+e.revision : 'Control '+(prior.length-index)) : '';
          return [e.id,[formatDate(e.date),e.clinician,version].filter(Boolean).join(' · ')];
        });
        controls.append(select('Visita de comparación',visits,selected.id,id => { compareId = id; drawComparison(); }));
        controls.append(select('Medición a comparar',Object.entries(metrics),compareMetric,value => { compareMetric = value; drawComparison(); }));
        content.append(controls);
        const sameDay = selected.date === s.current.date;
        const table = gridTable(['Sitio',formatDate(selected.date)+(sameDay?' · Anterior':''),formatDate(s.current.date)+(sameDay?' · Actual':'')], 'Comparación de ' + metrics[compareMetric]);
        const tbody = table.createTBody();
        sites.forEach((site,i) => {
          const tr = tbody.insertRow();
          const heading = element('th','',siteLabel(tooth,i)); heading.scope = 'row'; tr.append(heading);
          tr.insertCell().textContent = display(selected.teeth?.[tooth]?.[site]?.[compareMetric]);
          const current = tr.insertCell(); current.dataset.perioCompareSite = site;
          current.textContent = display(s.current.teeth?.[tooth]?.[site]?.[compareMetric]);
        });
        content.append(table);
      }
      details.append(content);
      return details;
    }
    function drawComparison() {
      if (!compareArea?.isConnected || !state().current) return;
      const previous = compareArea.querySelector('details');
      if (previous) comparisonOpen = previous.open;
      const focused = compareArea.contains(document.activeElement) ? document.activeElement : null;
      const focus = focused?.getAttribute('aria-label');
      compareArea.replaceChildren(comparison(state()));
      if (focused?.tagName === 'SUMMARY') compareArea.querySelector('summary')?.focus({preventScroll:true});
      if (focus) [...compareArea.querySelectorAll('select')].find(el => el.getAttribute('aria-label') === focus)?.focus();
    }
    function showMila(s) {
      const api = window.SmylPeriodontalMila;
      if (!api || !activeTooth()) return;
      const target = element('div','perio-mila-host');
      dialogBody.append(target);
      const examId = s.current.id, fdi = tooth, session = patient + ':' + examId;
      function getContext() {
        const latest = state();
        return {tooth, patientId:options.patientId, tenantId:options.tenantId, current:latest.current, previous:historyFor(latest).find(exam => exam.id === compareId) || historyFor(latest)[0],
          findings:options.getFindings?.(tooth) || [], sessionKey:patient + ':' + (latest.current?.id || ''), canEdit:editable(latest),
          dirty:!!latest.dirty, confirmed:latest.confirmed};
      }
      mila = api.mount(target,{tooth,sessionKey:session,canEdit:editable(s),getContext,onApply(patch) {
        if (destroyed || !dialog || !target.isConnected || state().current?.id !== examId || tooth !== fdi || !editable(state())) return false;
        let change;
        if (typeof patch?.summary === 'string') change = {summary:patch.summary};
        else if (patch?.tooth === tooth && ['V','I'].includes(patch.face) && Array.isArray(patch.values) &&
          patch.values.length === 3 && patch.values.every(value => Number.isInteger(value) && value >= 0 && value <= 20)) {
          change = {tooth, changes:patch.values.map((value,i) => ({site:sites[(patch.face === 'V' ? 0 : 3) + i],field:'depth',value}))};
        } else return false;
        if (!applyChange(change)) return false;
        syncFields(); drawComparison(); return true;
      }});
    }
    function note(s) {
      const details = element('details','perio-details');
      details.append(element('summary','','Nota de la exploración'));
      const area = element('textarea','perio-note'); area.rows = 3; area.maxLength = 2000;
      area.setAttribute('aria-label','Nota de la exploración'); area.value = s.current.summary || '';
      area.readOnly = !editable(s); area.dataset.perioSummary = '';
      if (area.readOnly && !area.value) area.placeholder = 'Sin nota registrada';
      area.addEventListener('input',() => { if (!applyChange({summary:area.value})) update(); });
      details.append(area); return details;
    }
    function piece(s) {
      const actions = element('div','perio-piece-nav');
      actions.append(select('Seleccionar pieza',teeth.map(t => [t,'Pieza '+t]),tooth,chooseTooth));
      actions.append(button('Ver periodontograma completo',() => changeMode('chart'),'perio-link')); dialogBody.append(actions);
      if (!s.current) { dialogBody.append(newExam(s)); return; }
      addGuideButton(actions,s);
      const faces = element('div','perio-faces'); faces.append(face(s,0), face(s,3)); dialogBody.append(faces);
      dialogBody.append(element('p','perio-legend','— Sin medir. Margen positivo si hay recesión y negativo si está coronal a la referencia.'));
      compareArea = element('div'); compareArea.append(comparison(s)); dialogBody.append(compareArea);
      showMila(s); dialogBody.append(note(s));
    }
    function chart(s) {
      if (!s.current) { dialogBody.append(newExam(s)); return; }
      const toolbar = element('div','perio-chart-nav');
      const api = window.SmylPeriodontalGraph;
      if (typeof api?.mount === 'function') {
        const views = element('div','perio-views');
        views.setAttribute('role','group'); views.setAttribute('aria-label','Vista del periodontograma');
        for (const [value, title] of [['graph','Gráfica'],['table','Tabla']]) {
          const tab = button(title,() => {
            if (chartView === value || !validFields()) return;
            chartView = value; renderDialog(true);
            dialogBody.querySelector('[data-perio-view="'+chartView+'"]')?.focus({preventScroll:true});
          },'perio-view');
          tab.dataset.perioView = value; tab.setAttribute('aria-pressed',String(chartView === value)); views.append(tab);
        }
        toolbar.append(views);
      }
      if (activeTooth()) toolbar.append(button('Volver a pieza '+tooth,() => changeMode('tooth'),'perio-link'));
      addGuideButton(toolbar,s);
      dialogBody.append(toolbar);
      if (chartView === 'graph' && typeof api?.mount === 'function') {
        const target = element('div','perio-graph-host');
        dialogBody.append(target);
        try {
          graph = api.mount(target,graphOptions(s));
          return;
        } catch {
          target.remove(); toolbar.remove(); chartView = 'table';
          setMessage('La gráfica no está disponible. Puedes consultar las mediciones en la tabla.');
          dialog.classList.remove('perio-wide');
          chart(s); return;
        }
      }
      const label = element('label','perio-metric-label','Medición');
      label.append(select('Medición del periodontograma',Object.entries(metrics),chartMetric,value => { chartMetric = value; renderDialog(true); dialogBody.querySelector('.perio-metric-label select')?.focus(); }));
      toolbar.insertBefore(label,toolbar.querySelector('.perio-link'));
      dialogBody.append(element('p','perio-legend',chartMetric === 'bleeding' ? 'Sangrado al sondaje · — Sin medir' : metrics[chartMetric] + ' en mm · — Sin medir'));
      const groups = element('div','perio-arches');
      for (const [arch, title] of [[window.SmylDentalModel.upper,'Superior'],[window.SmylDentalModel.lower,'Inferior']]) {
        const section = element('section','perio-arch'); section.append(element('h3','',title));
        const table = gridTable(['Pieza','M','C','D','M','C','D'], 'Arcada '+ title);
        const orientation = table.tHead.insertRow(0); orientation.insertCell();
        for (const name of ['Vestibular',title === 'Superior' ? 'Palatina' : 'Lingual']) {
          const th = element('th','',name); th.scope = 'colgroup'; th.colSpan = 3; orientation.append(th);
        }
        const tbody = table.createTBody();
        for (const id of arch.map(String)) {
          const row = tbody.insertRow(), head = element('th');
          row.dataset.perioRow = id;
          head.scope = 'row';
          const action = button(id,() => chooseTooth(id),'perio-tooth'); action.setAttribute('aria-label','Ver pieza '+id);
          head.append(action); row.append(head);
          for (const site of sites) row.insertCell().textContent = display(s.current.teeth?.[id]?.[site]?.[chartMetric]);
        }
        section.append(table); groups.append(section);
      }
      dialogBody.append(groups);
    }
    function graphOptions(s) {
      return {
        exam:s.current, tooth:graphTooth || undefined, site:graphSite || undefined, missingTeeth:s.missingTeeth, canEdit:editable(s),
        onSelect(id,site) { if (teeth.includes(id) && sites.includes(site)) { graphTooth = id; graphSite = site; } },
        onEdit:chooseTooth
      };
    }
    function addGuideButton(toolbar,s) {
      if (!editable(s) || !window.SmylPeriodontalGuided?.mount || !window.SmylPeriodontalGuidedModel || !options.onApplyBatch) return;
      toolbar.append(button('Iniciar sondaje guiado',() => {
        guideReturn = mode;
        changeMode('guided');
      },'perio-btn perio-guided-entry'));
    }
    function renderGuideGraph(s) {
      if (!graph || !guideSelection || !s.current) return;
      const preview = {...s.current,teeth:{...s.current.teeth}};
      for (const patch of guideSelection.patches || []) {
        const record = {...preview.teeth[patch.tooth]};
        for (const {site,value} of patch.changes) record[site] = {...record[site],depth:value};
        preview.teeth[patch.tooth] = record;
      }
      graph.update({exam:preview,tooth:guideSelection.tooth,site:guideSelection.site,missingTeeth:s.missingTeeth});
    }
    function guided(s) {
      const host = element('div','perio-guide-host'), chartHost = element('div','perio-guide-graph');
      const startTooth = (guideReturn === 'chart' ? graphTooth : tooth) || tooth;
      const sessionId = s.current.id;
      guideExamId = sessionId;
      dialogBody.append(host,chartHost);
      if (window.SmylPeriodontalGraph?.mount) {
        graph = window.SmylPeriodontalGraph.mount(chartHost,{exam:s.current,tooth:startTooth,
          missingTeeth:s.missingTeeth,followOnly:true});
      }
      guide = window.SmylPeriodontalGuided.mount(host,{
        getState:state, preferenceKey:options.preferenceKey || '', tooth:startTooth,
        onSelectionChange(selection) {
          if (!host.isConnected || mode !== 'guided' || guideExamId !== sessionId) return;
          guideSelection = selection;
          renderGuideGraph(state());
        },
        onApplyBatch(patches) {
          const latest = state();
          if (!host.isConnected || mode !== 'guided' || latest.current?.id !== sessionId || !editable(latest)) return false;
          return options.onApplyBatch(patches) === true;
        },
        onExit() {
          if (!host.isConnected || mode !== 'guided') return;
          if (guideSelection?.tooth) {
            graphTooth = guideSelection.tooth; graphSite = guideSelection.site;
          }
          changeMode(guideReturn);
          dialogBody?.querySelector('.perio-guided-entry')?.focus({preventScroll:true});
        }
      });
    }
    function syncFields() {
      const s = state(), record = s.current?.teeth?.[tooth] || {};
      for (const input of fields.values()) {
        input.disabled = !editable(s);
        if (document.activeElement === input || input.getAttribute('aria-invalid') === 'true') continue;
        const field = input.dataset.perioField, raw = record[input.dataset.perioSite]?.[field];
        input.value = raw == null ? '' : field === 'bleeding' ? raw ? 'yes' : 'no' : String(raw);
      }
      const area = dialogBody?.querySelector('[data-perio-summary]');
      if (area) { area.readOnly = !editable(s); if (document.activeElement !== area) area.value = s.current?.summary || ''; }
    }
    async function save(close) {
      if (!editable(state()) || !validFields()) return;
      const id = state().current.id;
      savePending = true; setMessage(''); syncFields(); syncFooter();
      try {
        const ok = await options.onSave?.({close});
        if (destroyed || state().current?.id !== id || !dialog) return;
        setMessage(ok ? close ? 'Exploración cerrada.' : 'Mediciones guardadas.' : 'No se pudo guardar. Tu borrador sigue abierto.');
        if (ok) confirmClose = false;
      } catch (_) { if (!destroyed && dialog && state().current?.id === id) setMessage('No se pudo guardar. Puedes volver a intentarlo.'); }
      finally { savePending = false; if (!destroyed && dialog) { renderDialog(); refreshEntry(); } }
    }
    function syncFooter() {
      if (!dialog) return;
      const s = state();
      footer.replaceChildren();
      footer.hidden = false;
      if (mode === 'guided') { footer.hidden = true; return; }
      if (s.conflict) { footer.append(element('p','perio-warning','El expediente tiene una versión más reciente. Revisa el conflicto antes de guardar.')); return; }
      if (!s.current || !s.canEdit) { footer.hidden = true; return; }
      if (s.current.status === 'closed') { footer.append(newExam(s)); return; }
      if (confirmClose) {
        footer.append(element('p','perio-caption','Al cerrar la visita, las mediciones quedan en el historial. Los sitios pendientes conservarán el estado «Sin medir».'));
        if (s.otherChanges) footer.append(element('p','perio-caption','También se guardarán los cambios pendientes del odontograma y los estudios del expediente.'));
        footer.append(button('Volver',() => { confirmClose=false; syncFooter(); footer.querySelector('button')?.focus(); }));
        const yes = button('Confirmar cierre',() => save(true),'perio-btn perio-primary'); yes.disabled = !editable(s); footer.append(yes);
        return;
      }
      const status = element('span','perio-save-state',s.busy || savePending ? 'Guardando…' : s.dirty || s.otherChanges ? 'Cambios pendientes' : 'Borrador');
      footer.append(status);
      const close = button('Cerrar exploración',() => { if (validFields()) { confirmClose=true; syncFooter(); footer.querySelector('button')?.focus(); } },'perio-link');
      close.disabled = !editable(s) || !Object.keys(s.current.teeth || {}).length;
      const saveButton = button(s.otherChanges ? 'Guardar cambios del expediente' : 'Guardar mediciones',() => save(false),'perio-btn perio-primary');
      saveButton.disabled = !editable(s) || !(s.dirty || s.otherChanges);
      footer.append(close,saveButton);
    }
    function renderDialog(force = false) {
      if (!dialog) return;
      const s = state();
      if (s.canRead === false || destroyed) { closeDialog(false); return; }
      const current = s.current;
      if (mode === 'guided' && (!current || current.status !== 'draft' || !s.canEdit || s.ready === false ||
          (guideExamId && guideExamId !== current.id))) {
        mode = 'chart';
      }
      const graphState = mode === 'chart' ? [editable(s),...(s.missingTeeth || [])].join('|') : '';
      dialogTitle.textContent = mode === 'guided' ? 'Sondaje guiado con MILA' : mode === 'chart' ? 'Periodontograma completo' : 'Periodoncia · Pieza '+tooth;
      dialogMeta.textContent = current ? [formatDate(current.date),current.clinician,current.status === 'closed' ? 'Exploración cerrada' : 'Exploración en curso'].filter(Boolean).join(' · ') : 'Nueva exploración';
      const graphAvailable = typeof window.SmylPeriodontalGraph?.mount === 'function';
      dialog.classList.toggle('perio-wide',mode === 'guided' || (!!current && mode === 'chart' && chartView === 'graph' && graphAvailable));
      dialog.classList.toggle('perio-guiding',mode === 'guided');
      const nextKey = mode === 'guided' ? [patient,mode,current.id].join('|') :
        [patient,tooth,mode,chartView,graphAvailable,current?.id,current?.status,s.canEdit,s.conflict,s.ready].join('|');
      if (force || nextKey !== pageKey) {
        pageKey = nextKey; disposeGuide(); disposeMila(); disposeGraph(); fields.clear(); compareArea = null;
        dialogBody.replaceChildren();
        if (s.ready === false) dialogBody.append(element('p','perio-caption','Cargando expediente…'));
        else if (mode === 'guided') guided(s);
        else if (mode === 'chart') chart(s); else piece(s);
      } else if (mode === 'guided') {
        guide?.update();
        if (current !== renderedExam) renderGuideGraph(s);
      } else {
        syncFields();
        if (mode === 'tooth') drawComparison();
        else if (graph && (current !== renderedExam || graphState !== renderedGraphState)) graph.update(graphOptions(s));
        else if (!graph && current !== renderedExam) {
          for (const row of dialogBody.querySelectorAll('[data-perio-row]')) {
            const record = current?.teeth?.[row.dataset.perioRow];
            sites.forEach((site,index) => { row.cells[index+1].textContent = display(record?.[site]?.[chartMetric]); });
          }
        }
      }
      renderedExam = current; renderedGraphState = graphState;
      syncFooter();
    }
    function update(next = {}) {
      if (destroyed) return;
      const oldPatient = patient, oldTooth = tooth;
      options = {...options,...next};
      patient = options.patientId;
      if (Object.hasOwn(next,'tooth')) tooth = String(next.tooth || '');
      if (oldPatient !== patient || state().canRead === false) { closeDialog(false); entryOpen=false; comparisonOpen=false; compareId=''; graphTooth=tooth; graphSite=''; chartView='graph'; setMessage(''); }
      if (oldTooth !== tooth) { confirmClose=false; graphTooth=tooth; graphSite=''; captureSite=''; setMessage(''); }
      refreshEntry(); renderDialog();
    }
    function destroy() {
      destroyed = true; closeDialog(false); wrapper.remove();
    }
    refreshEntry();
    return {update, open, destroy};
  }
  window.SmylPeriodontalReview = Object.freeze({mount});
})();
