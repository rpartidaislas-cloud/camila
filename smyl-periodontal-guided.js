/* Chairside voice capture. Proposals only enter the clinical draft after review. */
(function (root) {
  'use strict';
  const siteNames = {MB:'Mesial', B:'Central', DB:'Distal', ML:'Mesial', L:'Central', DL:'Distal'};
  const faceName = (tooth,face) => face === 'V' ? 'Vestibular' : Number(tooth) < 30 ? 'Palatina' : 'Lingual';

  function mount(host, options) {
    const doc = host.ownerDocument, events = new AbortController();
    const speechApi = root.SpeechRecognition || root.webkitSpeechRecognition;
    const initial = options.getState(), examId = initial.current?.id;
    const prefKey = options.preferenceKey ? 'smyl.perio.guide.prefs.'+options.preferenceKey : '';
    let prefs = {};
    if (prefKey) {
      try { prefs = JSON.parse(root.localStorage.getItem(prefKey) || '{}') || {}; } catch (_) {}
    }
    let session = null, mode = 'keyboard', spoken = prefs.spoken !== false, destroyed = false, exitPrompt = false;
    let audioSequence = 0, recognition = null, utterance = null, timer = null, emptyTurns = 0, audioState = '';
    let applying = false, typed = '', notice = '', pendingOpen = false, commandsOpen = false, authSubscription;
    let pieceField, faceField, directionField, advanceField, spokenField, audioLabel;
    const shell = el('section','', 'perio-guide');
    shell.setAttribute('aria-label','Sondaje guiado con MILA');
    const body = el('div','', 'pgd-body'), status = el('p','','pgd-status');
    status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); status.setAttribute('aria-atomic','true');
    shell.append(body,status); host.replaceChildren(shell);

    function el(tag, text, cls) {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (text) node.textContent = text;
      return node;
    }
    function button(text, action, cls = '', key = text) {
      const node = el('button',text,'pgd-btn '+cls);
      node.type = 'button'; node.dataset.guideKey = key;
      node.addEventListener('click',action);
      return node;
    }
    function select(caption, choices, selected, container) {
      const label = el('label','','pgd-field');
      const node = el('select');
      node.setAttribute('aria-label',caption); node.dataset.guideKey = caption;
      for (const [id,text] of choices) {
        const item = el('option',text); item.value=id; node.append(item);
      }
      if (choices.some(([id])=>id===String(selected))) node.value=selected;
      label.append(el('span',caption),node); container.append(label);
      return node;
    }
    function check(caption, checked, container) {
      const label=el('label','','pgd-check'), node=el('input'); node.type='checkbox'; node.checked=checked;
      label.append(node,doc.createTextNode(caption)); container.append(label); return node;
    }
    function editable() {
      const s = options.getState();
      return !destroyed && host.isConnected && s.canRead !== false && s.canEdit && s.ready !== false &&
        !s.busy && !s.conflict && s.current?.id === examId && s.current.status === 'draft';
    }
    function missing() { return new Set(Array.from(options.getState().missingTeeth || [],String)); }
    function listen(target, name, handler) { target.addEventListener(name,handler,{signal:events.signal}); }
    function feedback(text) { status.textContent = text || ''; }
    function audio(text, phase = '') {
      audioState = text;
      if (audioLabel) { audioLabel.textContent = text; audioLabel.dataset.phase=phase; }
    }
    function stopAudio() {
      ++audioSequence;
      clearTimeout(timer); timer=null;
      if (recognition) {
        const old=recognition; recognition=null;
        old.onstart=old.onresult=old.onerror=old.onend=null;
        try { old.abort(); } catch (_) {}
      }
      if (utterance) {
        utterance.onend=utterance.onerror=null; utterance=null;
        try { root.speechSynthesis.cancel(); } catch (_) {}
      }
    }
    function canListen() {
      return editable() && !exitPrompt && !doc.hidden && session?.getState().status==='active' && mode==='voice';
    }
    function interrupt(message) {
      stopAudio();
      if (session?.getState().status==='active') session.pause();
      notice=message; audio(mode==='voice'?'Micrófono en pausa':'En pausa'); render();
    }
    function beginListening() {
      if (!canListen()) return;
      if (root.navigator.onLine === false) return interrupt('Sin conexión. Puedes continuar con el teclado o reanudar la voz al reconectar.');
      const seq=audioSequence;
      let rec;
      try {
        rec=new speechApi(); recognition=rec;
        rec.lang='es-MX'; rec.continuous=false; rec.interimResults=false; rec.maxAlternatives=1;
        const current=()=>!destroyed && recognition===rec && seq===audioSequence && canListen();
        rec.onstart=()=>{if(current()) audio('Escuchando','listening');};
        rec.onresult=event=>{
          if(!current()) return;
          const result=event.results?.[event.resultIndex || 0];
          if(!result || result.isFinal===false) return;
          const text=String(result[0]?.transcript || '').trim();
          if(!text) return;
          const confidence=result[0]?.confidence;
          if (typeof confidence==='number' && confidence>0 && confidence<0.5) {
            notice='No se distinguieron las medidas. Repite la lectura de la pieza '+session.getState().tooth+'.';
            feedback(notice); speakOrListen(notice); return;
          }
          emptyTurns=0; run(()=>session.hear(text));
        };
        const silence=()=>{
          if(!current()) return;
          stopAudio();
          if(++emptyTurns > 1) return interrupt('La escucha quedó en pausa por silencio. Reanuda cuando estés listo.');
          timer=setTimeout(beginListening,250);
        };
        rec.onend=silence;
        rec.onerror=event=>{
          if(!current()) return;
          if(event.error==='no-speech') return silence();
          const reason = ['not-allowed','service-not-allowed'].includes(event.error) ? 'El navegador no dio acceso al micrófono.'
            : event.error==='network' ? 'Se interrumpió la conexión del dictado.' : 'Se interrumpió el micrófono.';
          interrupt(reason+' Las lecturas siguen aquí. Puedes reanudar o usar el teclado.');
        };
        audio('Activando micrófono'); rec.start();
      } catch (_) { interrupt('El micrófono no está disponible. Puedes reanudar o usar el teclado.'); }
    }
    function speakOrListen(message) {
      stopAudio();
      if(!canListen()) return;
      if(!message || !spoken || !root.speechSynthesis || !root.SpeechSynthesisUtterance) {
        beginListening(); return;
      }
      const seq=audioSequence;
      try {
        const line=new root.SpeechSynthesisUtterance(message);
        utterance=line; line.lang='es-MX';
        const done=()=>{
          if(seq!==audioSequence || utterance!==line) return;
          clearTimeout(timer); utterance=null;
          // Let loudspeaker audio settle before another turn may consume a final result.
          timer=setTimeout(beginListening,180);
        };
        line.onend=done;
        line.onerror=()=>{
          if(seq!==audioSequence || utterance!==line) return;
          spoken=false; done(); feedback('Las indicaciones están disponibles en pantalla.');
        };
        audio('MILA está hablando','speaking');
        timer=setTimeout(()=>{if(seq===audioSequence) interrupt('La lectura en voz alta se interrumpió. Reanuda para continuar.');},20000);
        root.speechSynthesis.speak(line);
      } catch (_) {
        stopAudio(); spoken=false; feedback('Las indicaciones están disponibles en pantalla.'); beginListening();
      }
    }
    function announceSelection() {
      const s=session.getState();
      if(s.tooth && s.sites?.length) options.onSelectionChange?.({tooth:s.tooth, site:s.nextSite || s.sites[0], patches:session.getPatches()});
    }
    function prompt(s) {
      const site=s.nextSite && siteNames[s.nextSite];
      return 'Pieza '+s.tooth+', '+faceName(s.tooth,s.face)+'. '+(site?'Desde '+site.toLowerCase()+'.':'Mediciones completas.');
    }
    function run(action) {
      if (!session || !editable() || exitPrompt) return;
      stopAudio(); notice=''; action();
      if (destroyed) return;
      const s=session.getState();
      audio(s.status==='paused'?'En pausa':mode==='keyboard'?'Teclado':'Micrófono listo');
      render(); announceSelection();
      if(s.status==='active') speakOrListen(s.speak || prompt(s));
    }
    function useMode(next) {
      if(!editable()) return;
      const isNew=!session;
      if(isNew) {
        const prefsNow={face:faceField.value,direction:directionField.value,autoAdvance:advanceField.checked,spoken:spokenField.checked};
        spoken=prefsNow.spoken;
        if(prefKey) { try { root.localStorage.setItem(prefKey,JSON.stringify(prefsNow)); } catch (_) {} }
        session=root.SmylPeriodontalGuidedModel.create({
          tooth:pieceField.value, ...prefsNow, missingTeeth:[...missing()],
          getDepth:(tooth,site)=>options.getState().current?.teeth?.[tooth]?.[site]?.depth ?? null,
          onApplyBatch:patches=>editable() && options.onApplyBatch?.(patches)===true
        });
      }
      mode=next; emptyTurns=0;
      run(()=>{if(session.getState().status==='paused') session.resume();});
      if(mode==='keyboard') body.querySelector('[data-guide-key="command"]')?.focus({preventScroll:true});
    }
    function setup() {
      body.append(el('p','Dicta las profundidades de mesial a distal. Al terminar podrás corregirlas y aplicarlas al borrador.','pgd-help'));
      const fields=el('div','','pgd-setup'), absent=missing();
      const teeth=root.SmylDentalModel.teeth.filter(id=>!absent.has(id));
      pieceField=select('Pieza inicial',teeth.map(id=>[id,id]),String(options.tooth || ''),fields);
      faceField=select('Cara inicial',[['V','Vestibular'],['I','Palatina']],prefs.face,fields);
      const previewStart=()=>{
        faceField.options[1].text=faceName(pieceField.value,'I');
        if(pieceField.value) options.onSelectionChange?.({tooth:pieceField.value,site:faceField.value==='V'?'MB':'ML',patches:[]});
      };
      previewStart();
      pieceField.addEventListener('change',previewStart);
      faceField.addEventListener('change',previewStart);
      directionField=select('Sentido del recorrido',[['forward','Derecha a izquierda'],['reverse','Izquierda a derecha']],prefs.direction,fields);
      body.append(fields);
      const settings=el('div','','pgd-settings');
      advanceField=check('Avance automático',prefs.autoAdvance!==false,settings);
      spokenField=check('Indicaciones por voz',spoken,settings);
      spokenField.disabled=!root.speechSynthesis || !root.SpeechSynthesisUtterance || !speechApi;
      if(spokenField.disabled) spokenField.parentElement.hidden=true;
      body.append(settings);
      const actions=el('div','','pgd-actions');
      if(speechApi) actions.append(button('Iniciar micrófono',()=>useMode('voice'),'pgd-primary'));
      actions.append(button('Usar teclado',()=>useMode('keyboard'),speechApi?'':'pgd-primary'),
        button('Volver al periodontograma',requestExit,'pgd-link'));
      if(!teeth.length) for(const node of actions.querySelectorAll('button:not(.pgd-link)')) node.disabled=true;
      body.append(actions);
      feedback(!teeth.length?'Todas las piezas se registraron como ausentes.':speechApi?'El navegador procesa el dictado. Dicta únicamente las mediciones.':'Este navegador permite la captura por teclado.');
    }
    function goPending(s,container) {
      if(!s.pending?.length) return;
      const details=el('details','','pgd-details'); details.open=pendingOpen;
      details.append(el('summary','Revisar pendientes'));
      details.addEventListener('toggle',()=>{if(details.isConnected) pendingOpen=details.open;});
      const row=el('div','','pgd-inline');
      const choices=s.pending.map(item=>[item.tooth+':'+item.face,'Pieza '+item.tooth+' · '+faceName(item.tooth,item.face)+' · '+item.sites.map(site=>siteNames[site]).join(', ')]);
      const field=select('Sitio pendiente',choices,choices[0][0],row);
      row.append(button('Ir a pendiente',()=>{
        const [tooth,face]=field.value.split(':'); pendingOpen=false;
        run(()=>session.goTo(tooth,face));
      }));
      details.append(row); container.append(details);
    }
    function entryForm(container) {
      const form=el('form','','pgd-inline'), label=el('label','','pgd-field');
      const input=el('input'); input.type='text'; input.value=typed; input.maxLength=160;
      input.dataset.guideKey='command'; input.autocomplete='off'; input.spellcheck=false;
      input.placeholder='Ej. tres cuatro cinco'; input.setAttribute('aria-label','Medidas o comando');
      input.addEventListener('input',()=>{typed=input.value;});
      label.append(el('span','Medidas o comando'),input);
      const submit=el('button','Aplicar entrada','pgd-btn'); submit.type='submit';
      form.append(label,submit);
      form.addEventListener('submit',e=>{
        e.preventDefault(); const command=input.value.trim();
        if (!command) { input.focus(); return; }
        typed=''; run(()=>session.hear(command));
        body.querySelector('[data-guide-key="command"]')?.focus({preventScroll:true});
      });
      container.append(form);
    }
    function overwrite(s,container) {
      if(!s.conflict) return;
      const block=el('section','','pgd-conflict');
      block.setAttribute('aria-label','Revisar reemplazo');
      block.append(el('strong','Revisar lectura existente'),el('p',s.feedback || 'Confirma el cambio antes de continuar.'));
      const actions=el('div','','pgd-actions');
      actions.append(button('Confirmar reemplazo',()=>run(()=>session.confirmOverwrite()),'pgd-primary'),
        button('Conservar anterior',()=>run(()=>session.cancelOverwrite())));
      block.append(actions); container.append(block);
    }
    function activePanel(s) {
      const head=el('div','','pgd-head'), identity=el('div');
      identity.append(el('span','Pieza '+s.tooth,'pgd-tooth'),el('span',faceName(s.tooth,s.face),'pgd-face'));
      audioLabel=el('span',audioState || (mode==='voice'?'Micrófono listo':'Teclado'),'pgd-audio');
      const progress=el('div','','pgd-progress');
      progress.append(el('span','Cara '+s.position+' de '+s.total),audioLabel);
      head.append(identity,progress); body.append(head);
      const readings=el('dl','','pgd-readings');
      s.sites.forEach((site,i)=>{
        const cell=el('div'); cell.dataset.current=String(site===s.nextSite); cell.dataset.measured=String(s.values[i]!=null);
        cell.append(el('dt',siteNames[site]),el('dd',s.values[i]==null?'—':String(s.values[i])));
        readings.append(cell);
      });
      readings.setAttribute('aria-label','Profundidades de sondaje en milímetros');
      body.append(readings,status);
      const actions=el('div','','pgd-actions');
      if(s.status==='paused') {
        actions.append(button('Reanudar',()=>useMode(mode),'pgd-primary'));
        if(mode==='voice') actions.append(button('Usar teclado',()=>useMode('keyboard')));
      } else {
        actions.append(button('Pausar',()=>interrupt('Recorrido en pausa.')));
        if(!s.autoAdvance) actions.append(button('Siguiente',()=>run(()=>session.next()),'pgd-primary'));
        if(mode==='keyboard') entryForm(body);
      }
      actions.append(button('Terminar recorrido',()=>run(()=>session.review()),'pgd-link'));
      body.append(actions); overwrite(s,body);
      goPending(s,body);
      if(s.status==='active') {
        const more=el('details','','pgd-details');
        more.open=commandsOpen; more.append(el('summary','Controles del recorrido'));
        more.addEventListener('toggle',()=>{if(more.isConnected) commandsOpen=more.open;});
        const controls=el('div','','pgd-actions');
        controls.append(button('Anterior',()=>run(()=>session.previous())),button('Saltar cara',()=>run(()=>session.skip())));
        if(mode==='voice') controls.append(button('Repetir indicación',()=>speakOrListen(prompt(session.getState()))),button('Usar teclado',()=>useMode('keyboard')));
        else if(speechApi) controls.append(button('Usar micrófono',()=>useMode('voice')));
        more.append(controls,el('p','Puedes decir «siguiente», «saltar sitio», «pausa» o «corrige la 16 vestibular central a cuatro».','pgd-help'));
        body.append(more);
      }
    }
    function reviewPanel(s) {
      const title=el('h3','Revisa las lecturas'); title.tabIndex=-1; title.dataset.guideKey='review'; body.append(title);
      const count=s.changes.length;
      body.append(el('p',count ? count+(count===1?' lectura preparada.':' lecturas preparadas.') : 'Aún no hay lecturas nuevas.','pgd-help'));
      if(count) {
        const list=el('div','','pgd-review-list');
        for(const change of s.changes) {
          const row=el('label','','pgd-review-row'), caption='Pieza '+change.tooth+' · '+faceName(change.tooth,change.face)+' · '+siteNames[change.site];
          const field=el('input'); field.type='number'; field.inputMode='numeric'; field.min='0'; field.max='20'; field.step='1';
          field.dataset.guideKey='value-'+change.tooth+'-'+change.site; field.setAttribute('aria-label',caption+' en mm');
          field.value=String(change.value);
          field.addEventListener('input',()=>{
            const ok=field.value!=='' && field.validity.valid;
            field.setAttribute('aria-invalid',String(!ok));
            if(!ok) feedback('Revisa el valor señalado. El sondaje admite milímetros enteros del 0 al 20.');
          });
          field.addEventListener('change',()=>{
            if(!editable()) return;
            if(field.value==='' || !field.validity.valid) {field.setAttribute('aria-invalid','true');return;}
            const next=session.edit(change.tooth,change.site,Number(field.value));
            if(next.conflict || next.changes.length!==count) render();
            else feedback(next.feedback);
            announceSelection();
          });
          row.append(el('span',caption),field); list.append(row);
        }
        body.append(list);
      }
      overwrite(s,body); goPending(s,body);
      const actions=el('div','','pgd-actions');
      if(count) {
        const apply=button('Aplicar al borrador',()=>{
          const invalid=body.querySelector('[aria-invalid=true]');
          if(invalid) {invalid.focus();return;}
          if(applying || !editable()) return;
          applying=true;
          try {
            session.apply();
            if(session.getState().status==='complete') {stopAudio();options.onExit();return;}
          } finally { applying=false; }
          render();
        },'pgd-primary');
        apply.disabled=!!s.conflict;actions.append(apply);
      }
      if(s.tooth) actions.append(button('Seguir midiendo',()=>run(()=>session.goTo(s.tooth,s.face))));
      actions.append(button('Volver al periodontograma',requestExit,'pgd-link'));body.append(actions);
    }
    function render() {
      if(destroyed || !host.isConnected) return;
      const focused=body.contains(doc.activeElement)?doc.activeElement.dataset.guideKey:null;
      shell.append(status);
      body.replaceChildren(); audioLabel=null;
      if(!editable()) {feedback('La exploración no está disponible para captura.');return;}
      if(exitPrompt) {
        body.append(el('h3','¿Salir de la guía?'),el('p','Hay lecturas pendientes de aplicar al borrador.','pgd-help'));
        const actions=el('div','','pgd-actions');
        actions.append(button('Revisar lecturas',()=>{exitPrompt=false;run(()=>session.review());},'pgd-primary'),
          button('Seguir en la guía',()=>{exitPrompt=false;render();}),
          button('Descartar y salir',()=>{stopAudio();options.onExit();},'pgd-link'));
        body.append(actions); feedback(''); actions.firstElementChild.focus({preventScroll:true});return;
      }
      if(!session) {setup();return;}
      const s=session.getState();
      if(s.status==='review' || s.status==='complete') reviewPanel(s); else activePanel(s);
      feedback(notice || s.feedback);
      if(focused) [...body.querySelectorAll('[data-guide-key]')].find(node=>node.dataset.guideKey===focused)?.focus({preventScroll:true});
    }
    function requestExit() {
      if(destroyed) return;
      if(!session || (!session.getPatches().length && !session.getState().conflict)) {stopAudio(); options.onExit();return;}
      stopAudio(); if(session.getState().status==='active') session.pause();
      exitPrompt=true; render();
    }
    const interruptIfActive=()=>{if(session?.getState().status==='active') interrupt('El recorrido quedó en pausa. Reanuda para volver al sitio actual.');};
    listen(doc,'visibilitychange',()=>{if(doc.hidden) interruptIfActive();});
    for(const event of ['pagehide','offline','popstate','hashchange']) listen(root,event,interruptIfActive);
    let actor=initial.actorId;
    authSubscription=root.sb?.auth?.onAuthStateChange?.((event,authSession)=>{
      const id=authSession?.user?.id;
      if(event==='SIGNED_OUT' || (id && actor && actor!==id)) destroy();
      else if(id) actor=id;
    })?.data?.subscription;
    function update() {
      if(destroyed || applying) return;
      if(!editable()) {
        stopAudio();
        if(session?.getState().status==='active') session.pause();
        render();
      } else if(!body.childElementCount) render();
    }
    function destroy() {
      destroyed=true; stopAudio(); events.abort(); authSubscription?.unsubscribe();
      session=null; typed=''; notice='';host.replaceChildren();
    }
    render();
    return {update,destroy,requestExit};
  }
  root.SmylPeriodontalGuided=Object.freeze({mount});
})(window);
