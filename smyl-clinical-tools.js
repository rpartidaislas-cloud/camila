/* Accesos al expediente desde Consultorio y Agenda. Los módulos clínicos conservan la captura y el guardado. */
(() => {
  'use strict';

  const tools = [
    { id: 'periodontal', label: 'Periodontograma', detail: 'Sondaje por pieza', icon: '<path d="M4 18h16M5 14l4-4 4 2 6-7M5 17v2m4-2v2m4-2v2m4-2v2"/>' },
    { id: 'interview', label: 'Entrevista con MILA', detail: 'Historia clínica', icon: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2m-6 8v3m-3 0h6"/>' },
    { id: 'guided-photos', label: 'Fotografías guiadas', detail: 'Serie intraoral', icon: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3.4"/>' },
    { id: 'simulator', label: 'Simulador de carillas', detail: 'Diseño de sonrisa', icon: '<path d="M3 10c3 1.7 6 2.5 9 2.5s6-.8 9-2.5c-1.2 5-5.1 8-9 8s-7.8-3-9-8Zm5 2v3m4-2.5V16m4-4v3"/>' }
  ];
  let active = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function button(text, cls, action) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.onclick = action;
    return b;
  }
  function cards(host, select) {
    const grid = el('div', 'ct-tools-grid');
    for (const tool of tools) {
      const b = button('', 'ct-tool', () => select(tool));
      b.dataset.tool = tool.id;
      b.setAttribute('aria-label',tool.label);
      const glyph = el('span','ct-tool-icon');
      glyph.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + tool.icon + '</svg>';
      const copy = el('span','ct-tool-copy');
      copy.append(el('strong','',tool.label),el('small','',tool.detail));
      b.append(glyph,copy);
      grid.append(b);
    }
    host.replaceChildren(grid);
  }
  function mountTools(host) { cards(host, tool => open({tool:tool.id})); }
  function current(s) {
    return active === s && s.dialog.open && s.tenant === window.tenantId &&
      s.actor === (window.miUsuario?.id || null);
  }
  function ensureCurrent(s) {
    if (!current(s)) throw new Error('La sesión o la clínica cambió. Vuelve a abrir la herramienta.');
  }
  function dismiss(s) {
    clearTimeout(s.timer);
    if (active === s) active = null;
    if (s.dialog.open) s.dialog.close();
    s.dialog.remove();
  }
  async function read(builder) {
    const reply = await (window.sbTimeout ? window.sbTimeout(builder) : builder);
    if (reply?.error || !reply) throw new Error('No se pudo consultar la clínica. Revisa tu conexión e inténtalo de nuevo.');
    return reply.data;
  }
  function patientName(row) {
    return window.SmylPatientQuick?.listName(row) || [row.nombre,row.apellido].filter(Boolean).join(' ') || 'Paciente';
  }
  function status(s, message, error = false) {
    s.status.textContent = message;
    s.status.classList.toggle('ct-error',error);
  }
  function showCards(s) {
    s.title.textContent = 'Herramientas clínicas';
    s.context.textContent = s.person?.name || '';
    cards(s.body, tool => {
      if (s.busy) return;
      s.tool = tool;
      if (s.person) launch(s); else choosePatient(s);
    });
  }
  function showSelection(s, row) {
    clearTimeout(s.timer);
    s.searchId++;
    s.person = {id:row.id,name:patientName(row)};
    s.context.textContent = '';
    const block = el('div','ct-selection');
    block.append(el('span','ct-label','Paciente'),el('strong','',s.person.name));
    if (row.telefono || row.email) block.append(el('span','ct-sub',row.telefono || row.email));
    const change = button('Cambiar paciente','ct-back',() => choosePatient(s));
    const start = button('Abrir herramienta','ct-primary',() => launch(s));
    s.body.replaceChildren(block,change,start);
    status(s,'');
    start.focus();
  }
  function choosePatient(s) {
    s.person = null;
    s.title.textContent = s.tool.label;
    s.context.textContent = '';
    const label = el('label','ct-field','Elegir paciente');
    const input = el('input');
    input.type = 'search'; input.placeholder = 'Buscar por nombre o teléfono'; input.autocomplete = 'off';
    label.append(input);
    const list = el('ul','ct-patients');
    s.body.replaceChildren(label,list);
    async function search() {
      clearTimeout(s.timer);
      const id = ++s.searchId, text = input.value.trim();
      list.replaceChildren();
      if (text.length === 1) { status(s,'Escribe al menos dos caracteres.'); return; }
      status(s, text ? 'Buscando…' : 'Cargando pacientes recientes…');
      s.timer = setTimeout(async () => {
        try {
          ensureCurrent(s);
          const rows = await read(window.sb.rpc('smyl_search_patients',{p_tenant_id:s.tenant,p_query:text,p_limit:6}));
          if (!current(s) || s.searchId !== id) return;
          for (const row of rows || []) {
            const item = el('li');
            const b = button('','ct-patient',() => showSelection(s,row));
            b.append(el('strong','',patientName(row)));
            if (row.telefono || row.email) b.append(el('small','',row.telefono || row.email));
            item.append(b); list.append(item);
          }
          status(s,list.children.length ? (text ? '' : 'Pacientes recientes') : (text ? 'Sin coincidencias. Prueba otro nombre o teléfono.' : 'Busca un paciente para comenzar.'));
        } catch (_) {
          if (active === s && s.searchId === id) status(s,'No se pudo cargar la lista. Vuelve a buscar o abre la herramienta de nuevo.',true);
        }
      },text ? 220 : 0);
    }
    input.addEventListener('input',search); input.focus(); search();
  }
  async function launch(s) {
    if (s.busy) return;
    const {tool,person} = s;
    s.busy = true; s.body.inert = true;
    status(s,'Abriendo ' + tool.label + '…');
    try {
      ensureCurrent(s);
      const db = window.sb;
      if (!db || !s.tenant || !person?.id) throw new Error('Selecciona un paciente de tu clínica.');
      if (s.appointmentId) {
        const visit = await read(db.from('smyl_appointments').select('id,patient_id,branch_id').eq('tenant_id',s.tenant).eq('id',s.appointmentId).maybeSingle());
        ensureCurrent(s);
        if (!visit || visit.patient_id !== person.id || (s.branchId && visit.branch_id !== s.branchId)) throw new Error('Los datos de la cita cambiaron. Vuelve a abrirla en la agenda.');
      }
      const patient = await read(db.from('camila_pacientes').select('id,tenant_id,nombre,apellido').eq('tenant_id',s.tenant).eq('id',person.id).maybeSingle());
      ensureCurrent(s);
      if (!patient || patient.id !== person.id || patient.tenant_id !== s.tenant) throw new Error('El expediente no está disponible para esta cuenta.');
      if (tool.id === 'simulator') {
        if (window.miRolEquipo !== 'dueño') throw new Error('Solo la cuenta titular puede iniciar una simulación vinculada al expediente.');
        const url = new URL('simulacion-rapida.html',location.href);
        url.search = new URLSearchParams({workspace:'professional',patient:person.id,clinic:s.tenant,from:'consultorio'}).toString();
        location.assign(url.href);
      } else {
        if (tool.id === 'interview') {
          const access = await window.SmylConsultorio?.accessFor?.(s.tenant);
          ensureCurrent(s);
          if (!access || (!access.owner && !(access.perms.includes('clinical.read') && access.perms.includes('clinical.write')))) throw new Error('Tu cuenta necesita permiso de lectura y edición clínica para iniciar la entrevista.');
        }
        if (typeof window.verPaciente !== 'function' || !(await window.verPaciente(person.id))) throw new Error('No se pudo abrir el expediente seleccionado.');
        ensureCurrent(s);
        const selected = window.pacienteActual;
        if (selected?.id !== person.id || selected._local || (selected.tenant_id && selected.tenant_id !== s.tenant) || !document.querySelector('#p-paciente-detalle.activa')) throw new Error('El paciente activo cambió. Vuelve a elegir la herramienta.');
        const opened = tool.id === 'interview'
          ? window.SmylMilaInterview?.open({tenant:s.tenant,patient:person.id,patientInfo:patient,appointmentId:s.appointmentId,view:'clinic',returnFocus:document.querySelector('#p-paciente-detalle .clinic-back')})
          : await window.SmylCaseWorkspace?.openChairside(tool.id,s.tenant,person.id,{isCurrent:() => current(s)});
        if (!opened) throw new Error('No se pudo abrir la herramienta. Inténtalo de nuevo.');
      }
      dismiss(s);
    } catch (error) {
      if (active === s) status(s,error.message || 'No se pudo abrir la herramienta.',true);
    } finally {
      s.busy = false; s.body.inert = false;
    }
  }
  function open(opts = {}) {
    if (active) dismiss(active);
    const dialog = el('dialog','ct-dialog'); dialog.id = 'smyl-clinical-tool-dialog';
    dialog.setAttribute('aria-labelledby','ct-dialog-title');
    const head = el('header','ct-head'), intro = el('div'), title = el('h2');
    title.id = 'ct-dialog-title';
    const context = el('p','ct-sub'), body = el('div','ct-body'), message = el('p','ct-status');
    message.setAttribute('role','status');
    const s = {dialog,title,context,body,status:message,tenant:window.tenantId,actor:window.miUsuario?.id || null,
      tool:tools.find(t => t.id === opts.tool),person:opts.patientId ? {id:opts.patientId,name:opts.patientName || 'Paciente de la cita'} : null,
      appointmentId:opts.appointmentId || null,branchId:opts.branchId || null,searchId:0,busy:false};
    const close = button('×','ct-close',() => dismiss(s)); close.setAttribute('aria-label','Cerrar herramientas clínicas');
    intro.append(title,context); head.append(intro,close); dialog.append(head,body,message); document.body.append(dialog);
    active = s;
    dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss(s);});
    dialog.addEventListener('close',()=>dismiss(s),{once:true});
    dialog.showModal();
    if (!s.tenant || (s.appointmentId && !s.person)) {
      title.textContent = 'Herramientas clínicas';
      status(s,!s.tenant ? 'Inicia sesión en tu clínica para continuar.' : 'Vincula un paciente a esta cita desde Agenda para usar sus herramientas.',true);
    } else if (s.tool) {
      if (s.person) {
        title.textContent = s.tool.label; context.textContent = s.person.name;
        launch(s);
      } else choosePatient(s);
    } else {
      showCards(s);
      body.querySelector('button')?.focus();
    }
    return true;
  }

  window.SmylClinicalTools = Object.freeze({open,mountTools});
})();
