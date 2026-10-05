/* Stage 1: a self-contained, synthetic presentation. No records or sharing.
 * The professional quote stays outside the patient view until confirmed.
 * Do not use demo contents as a fallback for a real patient's missing data.
 */
(function () {
  'use strict';
  const node=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!=null)e.textContent=text;return e;};
  const action=(text,fn,cls='mp-secondary')=>{const e=node('button',cls,text);e.type='button';e.onclick=fn;return e;};
  const money=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:0}).format(n);
  const observations=[
    {id:'shape',teeth:['11','21'],title:'La forma de tu sonrisa',area:'Dientes superiores del centro',body:'En este caso de ejemplo, se propone conversar sobre la forma y los bordes de estos dientes antes de elegir un cambio estético.',next:'Comparar opciones y elegir qué te gustaría conservar.'},
    {id:'care',teeth:['41','31'],title:'Primero, el cuidado',area:'Dientes inferiores del centro',body:'En este ejemplo ficticio se han registrado depósitos junto a la encía. La propuesta del dentista es revisar esta zona y preparar sus cuidados antes del cambio estético.',next:'Comentar la limpieza y los cuidados indicados por el dentista.'}
  ];
  // Only this fixed synthetic data is available to the demo. No caller-supplied
  // clinical data, patient identity, prices, URLs or saved drafts are accepted.
  function project(includeBudget) {
    const value={kind:'synthetic-demo',clinic:'Clínica Aurora · ficticia',observations,
      plan:[
        {title:'Escucharte y revisar',tag:'Primero',copy:'Hablar de lo que te gustaría cambiar, revisar tu salud bucal y resolver tus preguntas.',detail:'Tu prioridad: una sonrisa natural que siga sintiéndose tuya.'},
        {title:'Preparar tu sonrisa',tag:'Después',copy:'Acordar los cuidados previos que indique tu dentista. En este caso ficticio, se plantea una limpieza profesional.',detail:'La salud y tus necesidades guían el plan.'},
        {title:'Elegir el cambio, contigo',tag:'Cuando estés listo',copy:'Comparar alternativas estéticas y definir el tratamiento, los tiempos y sus límites antes de decidir.',detail:'La simulación orienta la conversación; no fija el tratamiento.'}
      ]};
    if(includeBudget===true)value.budget={currency:'MXN',items:[
      {label:'Valoración y registros',amount:800},
      {label:'Limpieza profesional',amount:1200},
      {label:'Opción estética ilustrativa · 6 piezas',amount:30000}
    ],total:32000};
    return value;
  }
  function renderBudget(host,budget) {
    const table=node('table','mp-budget-table'),caption=node('caption','','Presupuesto ilustrativo · MXN');table.append(caption);
    const head=node('thead'),headRow=node('tr');for(const title of ['Concepto','Importe']){const th=node('th','',title);th.scope='col';headRow.append(th);}head.append(headRow);table.append(head);
    const body=node('tbody');for(const item of budget.items){const tr=node('tr');tr.append(node('td','',item.label),node('td','',money(item.amount)));body.append(tr);}table.append(body);
    const foot=node('tfoot'),total=node('tr');total.append(node('th','','Total de ejemplo'),node('td','',money(budget.total)));foot.append(total);table.append(foot);host.append(table);
  }
  function mount(host) {
    const base=window.MySmyl.mount(host,{demo:true,views:[{view:'frontal',original:'icons/ui/my-smyl-example-before.svg',result:'icons/ui/my-smyl-example-after.svg'}]});
    const app=host.querySelector('.ms-app');app.classList.add('mp-presentation');
    const panels=[...app.querySelectorAll('.ms-panel')],tabs=[...app.querySelectorAll('.ms-tab')];
    let disposed=false,patientProjection=project(false),selectedObservation=0,questionDraft='';
    const go=i=>{tabs[i].click();tabs[i].focus();app.querySelector('.ms-nav').scrollIntoView({block:'start'});};
    const professional=node('section','mp-professional');professional.setAttribute('aria-label','Controles del dentista · demostración');
    const toolbar=node('div','mp-toolbar'),toolbarText=node('div');toolbarText.append(node('strong','','Preparar presentación'),node('span','','Caso ficticio · sin guardar ni enviar'));
    const settings=node('details','mp-settings'),settingsToggle=node('summary','','Opciones del dentista');settings.append(settingsToggle);
    const present=action('Presentar en consulta ↗',()=>setPresenting(true),'mp-present');toolbar.append(toolbarText,present);professional.append(toolbar,settings);host.prepend(professional);
    const config=node('div','mp-config'),configHeading=node('div');configHeading.append(node('h2','','Tú decides qué compartir'),node('p','','Esta muestra permite probar la presentación. No cambia expedientes ni envía información.'));
    const toggleLabel=node('label','mp-check'),toggle=node('input');toggle.type='checkbox';toggleLabel.append(toggle,node('span','','Incluir presupuesto en esta propuesta'));
    const pending=node('div','mp-budget-pending');pending.hidden=true;pending.append(node('p','','Revisa este presupuesto ficticio antes de incorporarlo a la presentación.'));
    const confirmationLabel=node('label','mp-check'),confirmation=node('input');confirmation.type='checkbox';confirmationLabel.append(confirmation,node('span','','Revisé los importes de ejemplo y quiero mostrarlos.'));
    const include=action('Confirmar e incluir',()=>{
      if(!toggle.checked||!confirmation.checked||disposed)return;
      patientProjection=project(true);renderPlan();status.textContent='Presupuesto incluido en esta muestra. No se ha guardado ni enviado.';
      pending.hidden=true;pending.replaceChildren();settings.open=false;go(2);
    },'mp-present');include.disabled=true;confirmation.onchange=()=>include.disabled=!confirmation.checked;
    const status=node('p','mp-config-status','Sin presupuesto: los importes no forman parte de la vista del paciente.');status.setAttribute('role','status');
    toggle.onchange=()=>{
      // Clear patient price data before opening a new approval, never CSS-hide it.
      patientProjection=project(false);renderPlan();confirmation.checked=false;include.disabled=true;pending.replaceChildren();
      pending.hidden=!toggle.checked;
      if(toggle.checked){
        pending.append(node('p','','Revisa este presupuesto ficticio antes de incorporarlo a la presentación.'));renderBudget(pending,project(true).budget);pending.append(confirmationLabel,include);
        status.textContent='Pendiente de confirmar. El paciente todavía no vería los importes.';
      }else status.textContent='Sin presupuesto: los importes no forman parte de la vista del paciente.';
    };
    config.append(configHeading,toggleLabel,pending,status);settings.append(config);
    const presentationBar=node('div','mp-presentation-bar');presentationBar.hidden=true;
    presentationBar.append(node('span','','Presentación · caso ficticio'),action('Volver a preparar',()=>setPresenting(false)));host.insertBefore(presentationBar,app);
    function setPresenting(on){professional.hidden=on;presentationBar.hidden=!on;app.classList.toggle('mp-presenting',on);if(on){settings.open=false;presentationBar.querySelector('button').focus();}else present.focus();host.scrollIntoView({block:'start'});}
    const header=app.querySelector('.ms-header');header.lastElementChild.remove();
    const clinic=node('div','mp-clinic'),monogram=node('span','mp-monogram','a.'),clinicText=node('div');monogram.setAttribute('aria-hidden','true');clinicText.append(node('strong','','Clínica Aurora'),node('small','','Clínica ficticia · ejemplo de identidad'));clinic.append(monogram,clinicText);header.append(clinic);
    app.querySelector('.ms-notice').textContent='Muestra ilustrativa · caso ficticio, no es una valoración clínica';
    const intro=app.querySelector('.ms-intro');intro.replaceChildren(node('p','ms-kicker','HECHO PARA CONVERSAR. PENSADO PARA TI.'),node('h1','','Tu sonrisa. Tu siguiente paso.'),node('p','','Una propuesta para explorar lo que te gustaría cambiar, entender tus opciones y decidir a tu ritmo.'));
    tabs.forEach((tab,i)=>{const text=tab.textContent;const number=node('span','mp-tab-number','0'+(i+1));number.setAttribute('aria-hidden','true');tab.replaceChildren(number,document.createTextNode(text));});
    const aside=app.querySelector('.ms-aside');aside.replaceChildren(node('p','ms-kicker','EL PUNTO DE PARTIDA'),node('h2','','Que se sienta como tú.'),node('p','','Una sonrisa natural empieza por escucharte. Esta imagen es una forma de explorar, no una decisión tomada.'));
    const goal=node('div','mp-goal');goal.append(node('span','','En este ejemplo buscamos'),node('strong','','Armonía, sin perder tu esencia.'),node('p','','Forma · equilibrio · un acabado natural'));aside.append(goal,action('Entender mi revisión →',()=>go(1),'ms-primary'),node('p','mp-fine','La simulación no garantiza un resultado ni define qué tratamiento necesitas.'));
    const continuation=node('div','mp-continuation');continuation.append(node('span','','La imagen es solo el comienzo.'),action('Entender mi revisión →',()=>go(1)));panels[0].append(continuation);
    buildReview();renderPlan();
    const footer=app.querySelector('.ms-footer');footer.replaceChildren(node('span','','mySmyl · Una propuesta, una conversación.'),node('span','','Demostración sin datos personales. No se guarda ni se envía.'));
    function buildReview(){
      const panel=panels[1];panel.replaceChildren();
      const heading=node('div','mp-section-heading');heading.append(node('p','ms-kicker','ENTENDER ANTES DE DECIDIR'),node('h2','','Tu revisión, sin complicaciones.'),node('p','','Así se verían las observaciones que tu dentista revise y elija compartir. En esta muestra, todas son ficticias.'));panel.append(heading);
      const layout=node('div','mp-review-grid'),mapCard=node('section','mp-map-card'),notes=node('section','mp-observations');
      mapCard.append(node('h3','','Tu mapa dental'),node('p','mp-map-hint','Elige una observación para ubicarla.'));
      const orientation=node('div','mp-orientation');orientation.append(node('span','','Tu derecha'),node('span','','Tu izquierda'));mapCard.append(orientation);
      const map=node('div','mp-map');map.setAttribute('role','img');mapCard.append(map);
      const legend=node('p','mp-map-legend');legend.append(node('span','','●'),document.createTextNode('Seleccionada'),node('span','mp-other-key','○'),document.createTextNode('Otra observación'));mapCard.append(legend,node('p','mp-fine','Sin marca significa sin observación compartida, no necesariamente sano. El mapa no se obtiene de esta ilustración.'));
      notes.append(node('p','mp-note-label','2 OBSERVACIONES DE EJEMPLO'));
      const noteButtons=[];
      patientProjection.observations.forEach((item,index)=>{
        const b=action('',()=>{selectedObservation=index;refreshMap();if(innerWidth<=650&&mapCard.getBoundingClientRect().top<0)mapCard.scrollIntoView({block:'start'});},'mp-observation');
        const top=node('span','mp-observation-top');top.append(node('span','mp-observation-number','0'+(index+1)),node('span','mp-observation-area',item.area));
        b.append(top,node('strong','',item.title),node('span','mp-observation-copy',item.body),node('span','mp-observation-next',item.next));
        noteButtons.push(b);notes.append(b);
      });
      const explain=node('div','mp-reviewed-note');explain.append(node('strong','','La última palabra es de tu dentista.'),node('p','','Las sugerencias de IA sin revisar no se mostrarán aquí. La explicación y el plan deben estar revisados antes de compartirse.'));notes.append(explain);
      function refreshMap(){
        const item=patientProjection.observations[selectedObservation];noteButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===selectedObservation)));
        map.setAttribute('aria-label','Mapa ilustrativo. Selección: '+item.area+', dientes '+item.teeth.join(' y ')+'. '+item.title+'. Consulta las otras observaciones en la lista.');
        window.SmylToothMap.render(map,{disabled:true,state:id=>{const related=patientProjection.observations.find(o=>o.teeth.includes(id));return {className:item.teeth.includes(id)?'mp-marked':related?'mp-other-marked':'',label:related?related.title:'Sin observación compartida'};}});
        // Equivalent, larger controls are the observation cards. The decorative
        // map is not a row of tiny inaccessible hit targets on a phone.
        map.querySelectorAll('button,.dr-arch-label').forEach(e=>e.setAttribute('aria-hidden','true'));
      }
      refreshMap();layout.append(mapCard,notes);panel.append(layout);
      const next=node('div','mp-continuation');next.append(node('span','','Ahora, conozcamos las posibilidades.'),action('Conocer mi plan →',()=>go(2)));panel.append(next);
    }
    function renderPlan(){
      const panel=panels[2];panel.replaceChildren();
      const heading=node('div','mp-section-heading');heading.append(node('p','ms-kicker','AVANZAR CON CONFIANZA'),node('h2','','Un plan a tu ritmo.'),node('p','','Una ruta para conversar con tu dentista. Puedes preguntar, comparar alternativas o tomarte tiempo antes de decidir.'));panel.append(heading);
      const grid=node('div','mp-plan-grid'),timeline=node('ol','mp-timeline');
      patientProjection.plan.forEach((step,i)=>{const li=node('li'),n=node('span','mp-step-number','0'+(i+1)),body=node('div','mp-step-body');n.setAttribute('aria-hidden','true');body.append(node('p','ms-kicker',step.tag),node('h3','',step.title),node('p','',step.copy),node('small','',step.detail));li.append(n,body);timeline.append(li);});
      const decision=node('aside','mp-decision');decision.append(node('span','mp-decision-symbol','↗'),node('h3','','El siguiente paso lo decides tú.'),node('p','','No necesitas resolverlo todo hoy. Empieza por lo que quieras preguntar.'));
      const ask=action('Preparar mis preguntas',()=>{questionBox.hidden=false;questionInput.focus();questionBox.scrollIntoView({block:'nearest'});},'ms-primary');decision.append(ask,node('p','mp-fine','En esta muestra no se contacta a la clínica.'));
      grid.append(timeline,decision);panel.append(grid);
      if(patientProjection.budget){const budget=node('section','mp-patient-budget');budget.append(node('p','ms-kicker','INCLUIDO POR EL DENTISTA · EJEMPLO'),node('h3','','Tu presupuesto, con claridad.'));renderBudget(budget,patientProjection.budget);budget.append(node('p','mp-fine','Importes ficticios para probar la presentación, no una cotización ni una referencia de precios. El tratamiento y sus condiciones se acuerdan con el dentista.'));panel.append(budget);}
      const questionBox=node('section','mp-questions');questionBox.hidden=true;
      const title=node('h3','','¿Qué te gustaría conversar?'),hint=node('p','','Elige una idea o escribe con tus palabras. Este borrador solo vive en esta muestra: no se guarda ni se envía.');
      const chips=node('div','mp-question-chips'),questionInput=node('textarea');questionInput.maxLength=1000;questionInput.rows=4;questionInput.setAttribute('aria-label','Mis preguntas para el dentista');questionInput.placeholder='Por ejemplo: me gustaría entender qué opciones tengo…';
      questionInput.value=questionDraft;questionInput.oninput=()=>questionDraft=questionInput.value;
      for(const q of ['¿Qué otras opciones tengo?','¿Qué cuidados necesitaría?','¿Cómo serían los tiempos?'])chips.append(action(q,()=>{const value=(questionInput.value?questionInput.value+'\n':'')+q;questionDraft=questionInput.value=value.slice(0,1000);questionInput.focus();}));
      const done=action('Listo, volver a mi plan',()=>{questionBox.hidden=true;ask.focus();});questionBox.append(title,hint,chips,questionInput,done);panel.append(questionBox);
      const more=node('details','mp-alternatives');more.append(node('summary','','Lo que conviene hablar antes de decidir'),node('p','','Pregunta por las alternativas, sus beneficios, límites, cuidados y posibles riesgos. También puedes preguntar qué ocurre si prefieres esperar. Esta propuesta de ejemplo no sustituye la valoración de tu dentista.'));panel.append(more);
      const bottom=node('div','mp-continuation');bottom.append(node('span','','Puedes volver a explorar cuando quieras.'),action('Volver a mi sonrisa',()=>go(0)));panel.append(bottom);
    }
    return {getPresentation:()=>JSON.parse(JSON.stringify(patientProjection)),destroy(){disposed=true;patientProjection=null;questionDraft='';base.destroy();professional.remove();presentationBar.remove();}};
  }
  window.MySmylPresentation={mount};
})();
