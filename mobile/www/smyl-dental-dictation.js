/* Optional voice input for the canonical dental draft. No audio or transcript persistence. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SmylDentalDictation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const teeth=[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38].map(String);
  const toothSet=new Set(teeth);
  const surfaces=Object.freeze([
    {value:'whole',label:'Pieza completa',terms:['pieza completa','toda la pieza','completa']},
    {value:'O',label:'Oclusal',terms:['oclusal']},
    {value:'M',label:'Mesial',terms:['mesial']},
    {value:'D',label:'Distal',terms:['distal']},
    {value:'V',label:'Vestibular',terms:['vestibular','bucal','labial']},
    {value:'L',label:'Lingual / palatina',terms:['lingual','palatina','palatino','palatal']},
    {value:'I',label:'Incisal',terms:['incisal']}
  ]);
  const wordNumbers={
    11:'once',12:'doce',13:'trece',14:'catorce',15:'quince',16:'dieciseis',17:'diecisiete',18:'dieciocho',
    21:'veintiuno',22:'veintidos',23:'veintitres',24:'veinticuatro',25:'veinticinco',26:'veintiseis',27:'veintisiete',28:'veintiocho',
    31:'treinta y uno',32:'treinta y dos',33:'treinta y tres',34:'treinta y cuatro',35:'treinta y cinco',36:'treinta y seis',37:'treinta y siete',38:'treinta y ocho',
    41:'cuarenta y uno',42:'cuarenta y dos',43:'cuarenta y tres',44:'cuarenta y cuatro',45:'cuarenta y cinco',46:'cuarenta y seis',47:'cuarenta y siete',48:'cuarenta y ocho'
  };
  const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const plain=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-MX').replace(/[^a-z0-9ñ]+/g,' ').replace(/\s+/g,' ').trim();
  const tidy=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,240);
  const capitalize=value=>{
    const text=tidy(value);
    return text?text.charAt(0).toLocaleUpperCase('es-MX')+text.slice(1):'';
  };
  const tokenize=value=>(String(value||'').match(/[\p{L}\p{N}]+/gu)||[]).map(raw=>({raw,norm:plain(raw)}));
  const numberPatterns=Object.entries(wordNumbers).map(([number,words])=>({number,tokens:words.split(' ')})).sort((a,b)=>b.tokens.length-a.tokens.length);
  const sameAt=(tokens,index,pattern)=>pattern.every((part,offset)=>tokens[index+offset]?.norm===part);

  function surfaceAllowed(tooth,surface){
    tooth=String(tooth||'');surface=String(surface||'');
    if(!toothSet.has(tooth)||!surfaces.some(item=>item.value===surface))return false;
    if(surface==='O')return Number(tooth[1])>=4;
    if(surface==='I')return Number(tooth[1])<=3;
    return true;
  }

  function parse(transcript){
    const original=tidy(transcript),tokens=tokenize(original),matches=[],prefixes=new Set(['pieza','diente','fdi','numero']);
    const addMatch=(number,start,end)=>{
      number=String(number);if(!toothSet.has(number))return;
      let prefixStart=start,explicit=false;
      if(prefixes.has(tokens[start-1]?.norm)){prefixStart=start-1;explicit=true;}
      if(tokens[start-1]?.norm==='fdi'&&prefixes.has(tokens[start-2]?.norm)){prefixStart=start-2;explicit=true;}
      if(!matches.some(item=>item.number===number&&item.start===start))matches.push({number,start,end,prefixStart,explicit});
    };
    tokens.forEach((token,index)=>{
      if(/^[1-4][1-8]$/.test(token.norm))addMatch(token.norm,index,index);
      for(const pattern of numberPatterns){if(sameAt(tokens,index,pattern.tokens)){addMatch(pattern.number,index,index+pattern.tokens.length-1);break;}}
    });
    const explicit=matches.filter(item=>item.explicit),considered=explicit.length?explicit:matches,candidates=[];
    considered.forEach(item=>{if(!candidates.includes(item.number))candidates.push(item.number);});
    let matchedSurface=null;
    surfaceLoop:for(const surface of surfaces){
      for(const term of surface.terms){
        const termTokens=term.split(' ');
        for(let index=0;index<tokens.length;index++)if(sameAt(tokens,index,termTokens)){matchedSurface={...surface,start:index,end:index+termTokens.length-1};break surfaceLoop;}
      }
    }
    const removed=new Set(),removeRange=(start,end)=>{for(let index=start;index<=end;index++)removed.add(index);};
    considered.forEach(item=>removeRange(item.prefixStart,item.end));
    if(matchedSurface)removeRange(matchedSurface.start,matchedSurface.end);
    const fillers=new Set(['cara','superficie','zona','hallazgo','condicion','presenta','presentando','observo','observa','se','en']);
    tokens.forEach((token,index)=>{if(fillers.has(token.norm))removed.add(index);});
    const condition=tokens.filter((_,index)=>!removed.has(index)).map(token=>token.raw).join(' ');
    const tooth=candidates.length===1?candidates[0]:'';
    const result={transcript:original,tooth,toothCandidates:candidates,surface:matchedSurface?.value||'',surfaceLabel:matchedSurface?.label||'',condition:capitalize(condition)};
    result.complete=!!(result.tooth&&result.surface&&result.condition&&surfaceAllowed(result.tooth,result.surface));
    result.ambiguous=candidates.length>1;
    return result;
  }

  function format(value){
    const tooth=String(value?.tooth||''),surface=surfaces.find(item=>item.value===value?.surface),condition=capitalize(value?.condition);
    if(!toothSet.has(tooth)||!surface||!condition||!surfaceAllowed(tooth,surface.value))return '';
    return surface.label+': '+condition.replace(/[.!?]+$/,'')+'.';
  }

  function supported(){return !!(root&&root.document&&(root.SpeechRecognition||root.webkitSpeechRecognition));}

  function node(tag,cls,text){const element=root.document.createElement(tag);element.className=cls||'';if(text!=null)element.textContent=text;return element;}
  function control(text,cls){const element=node('button',cls||'',text);element.type='button';return element;}

  function open(options={}){
    if(!supported()||typeof options.onApply!=='function')return false;
    const Recognition=root.SpeechRecognition||root.webkitSpeechRecognition,returnFocus=options.returnFocus||root.document.activeElement;
    const dialog=node('dialog','dvd-dialog'),header=node('header','dvd-head'),heading=node('div','dvd-heading'),close=control('','dvd-close');
    const uid='dvd-'+Math.random().toString(36).slice(2,9),title=node('h2','', 'Dictar hallazgo');title.id=uid+'-title';
    heading.append(node('span','dvd-kicker','CAPTURA RÁPIDA'),title);
    close.setAttribute('aria-label','Cerrar dictado');header.append(heading,close);
    const intro=node('p','dvd-intro','Di, por ejemplo: “Pieza 16, oclusal, caries”. Revisa el resultado antes de agregarlo.');intro.id=uid+'-intro';
    const privacy=node('p','dvd-privacy','Al escuchar, el navegador procesa tu voz. SMYL no guarda el audio ni el texto provisional.');privacy.id=uid+'-privacy';
    dialog.setAttribute('aria-labelledby',title.id);dialog.setAttribute('aria-describedby',intro.id+' '+privacy.id);dialog.setAttribute('aria-modal','true');
    const listening=node('section','dvd-listening'),listen=control('','dvd-listen'),mic=node('span','dvd-mic'),listenLabel=node('span','','Escuchar'),waves=node('span','dvd-waves'),status=node('p','dvd-status','Activa el micrófono cuando estés listo.');
    mic.setAttribute('aria-hidden','true');waves.setAttribute('aria-hidden','true');waves.append(node('i'),node('i'),node('i'),node('i'));listen.append(mic,listenLabel);listen.setAttribute('aria-pressed','false');status.setAttribute('role','status');status.setAttribute('aria-live','polite');listening.append(listen,waves,status);
    const heard=node('p','dvd-heard');heard.hidden=true;heard.setAttribute('aria-label','Texto reconocido');
    const summary=node('section','dvd-summary');summary.hidden=true;summary.tabIndex=-1;summary.setAttribute('aria-label','Hallazgo preparado');
    const summaryCopy=node('div','dvd-summary-copy'),summaryKicker=node('span','dvd-summary-kicker','HALLAZGO PREPARADO'),chips=node('div','dvd-chips');
    const toothChip=node('span','dvd-chip'),surfaceChip=node('span','dvd-chip'),conditionChip=node('span','dvd-chip dvd-chip-condition'),correct=control('Corregir','dvd-correct');
    chips.append(toothChip,surfaceChip,conditionChip);summaryCopy.append(summaryKicker,chips);summary.append(summaryCopy,correct);
    const review=node('fieldset','dvd-review');review.hidden=true;const legend=node('legend','','Revisa antes de agregar');review.append(legend);
    const toothLabel=node('label','dvd-field'),toothCopy=node('span','','Pieza'),tooth=node('select');tooth.setAttribute('aria-label','Pieza FDI');tooth.add(new Option('Seleccionar…',''));teeth.forEach(value=>tooth.add(new Option('Pieza '+value,value)));tooth.value=toothSet.has(String(options.initialTooth||''))?String(options.initialTooth):'';toothLabel.append(toothCopy,tooth);
    const surfaceLabel=node('label','dvd-field'),surfaceCopy=node('span','','Superficie'),surface=node('select');surface.setAttribute('aria-label','Superficie dental');surface.add(new Option('Seleccionar…',''));surfaces.forEach(item=>surface.add(new Option(item.label,item.value)));surfaceLabel.append(surfaceCopy,surface);
    const findingLabel=node('label','dvd-field dvd-condition'),findingCopy=node('span','','Hallazgo'),finding=node('input');finding.type='text';finding.maxLength=180;finding.autocomplete='off';finding.placeholder='Ej. caries';finding.setAttribute('aria-label','Hallazgo clínico');findingLabel.append(findingCopy,finding);review.append(toothLabel,surfaceLabel,findingLabel);
    const feedback=node('p','dvd-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
    const actions=node('footer','dvd-actions'),cancel=control('Cancelar','dvd-secondary'),apply=control('Agregar al borrador','dvd-primary');apply.disabled=true;actions.append(cancel,apply);
    dialog.append(header,intro,privacy,listening,heard,summary,review,feedback,actions);root.document.body.append(dialog);
    let recognition=null,listeningNow=false,closed=false,hadError=false,applying=false;
    const initialTooth=tooth.value;

    const setListening=value=>{listeningNow=!!value;dialog.dataset.listening=String(listeningNow);listen.setAttribute('aria-pressed',String(listeningNow));listenLabel.textContent=listeningNow?'Detener':'Volver a dictar';};
    const candidate=()=>({tooth:tooth.value,surface:surface.value,condition:tidy(finding.value)});
    const valid=()=>toothSet.has(tooth.value)&&surfaces.some(item=>item.value===surface.value)&&surfaceAllowed(tooth.value,surface.value)&&!!tidy(finding.value);
    const paintSummary=()=>{const item=surfaces.find(value=>value.value===surface.value);toothChip.textContent='Pieza '+tooth.value;surfaceChip.textContent=item?.label||'Superficie pendiente';conditionChip.textContent=tidy(finding.value)||'Hallazgo pendiente';};
    const notifyPreview=()=>{if(!valid()||typeof options.onPreview!=='function')return;try{options.onPreview(candidate());}catch(_){ }};
    const validate=()=>{apply.disabled=applying||!valid();feedback.textContent='';paintSummary();notifyPreview();};
    [tooth,surface,finding].forEach(element=>element.addEventListener('input',validate));
    const fill=result=>{
      heard.hidden=!result.transcript;heard.textContent=result.transcript?'“'+result.transcript+'”':'';
      tooth.value=result.tooth||(!result.ambiguous?initialTooth:'');surface.value='';finding.value='';
      if(result.surface)surface.value=result.surface;if(result.condition)finding.value=result.condition;
      validate();
      const incompatible=!!(result.tooth&&result.surface&&!surfaceAllowed(result.tooth,result.surface));
      const compact=result.complete&&valid();summary.hidden=!compact;review.hidden=compact;
      if(result.ambiguous)feedback.textContent='Escuché más de una pieza. Selecciona la correcta.';
      else if(incompatible)feedback.textContent=result.surface==='O'?'La cara oclusal sólo corresponde a premolares y molares. Corrige la pieza o la superficie.':'La cara incisal sólo corresponde a incisivos y caninos. Corrige la pieza o la superficie.';
      else if(!result.complete)feedback.textContent='Completa o corrige los datos que faltan.';
      if(compact)requestAnimationFrame(()=>summary.focus({preventScroll:true}));
    };
    const destroy=()=>{
      if(closed)return;closed=true;
      try{recognition?.abort();}catch(_){ }
      recognition=null;setListening(false);
      if(dialog.open)dialog.close();dialog.remove();
      options.onClose?.();
      if(returnFocus?.isConnected)requestAnimationFrame(()=>returnFocus.focus({preventScroll:true}));
    };
    const start=()=>{
      if(closed||listeningNow)return;
      recognition=new Recognition();hadError=false;recognition.lang='es-MX';recognition.continuous=false;recognition.interimResults=false;recognition.maxAlternatives=1;
      recognition.onstart=()=>{if(closed)return;setListening(true);status.textContent='Escuchando… di pieza, superficie y hallazgo.';status.dataset.state='recording';};
      recognition.onresult=event=>{
        if(closed)return;const phrases=[];
        for(let index=0;index<event.results.length;index++){const phrase=event.results[index]?.[0]?.transcript;if(phrase)phrases.push(phrase);}
        const result=parse(phrases.join(' '));fill(result);status.textContent='Dictado preparado. Revísalo antes de agregar.';status.dataset.state='ready';
      };
      recognition.onerror=event=>{
        if(closed)return;hadError=true;
        const messages={
          'not-allowed':'Activa el permiso del micrófono para dictar. El editor manual sigue disponible.',
          'service-not-allowed':'El navegador bloqueó el servicio de voz. El editor manual sigue disponible.',
          'no-speech':'No escuché una frase. Intenta de nuevo.',
          'network':'La voz no está disponible en este momento. Intenta de nuevo.'
        };
        status.textContent=messages[event.error]||'No pude convertir la voz. Intenta de nuevo.';status.dataset.state='attention';
      };
      recognition.onend=()=>{if(closed)return;recognition=null;setListening(false);if(!hadError&&heard.hidden){status.textContent='No se recibió una frase. Puedes volver a dictar.';status.dataset.state='attention';}};
      try{recognition.start();}catch(_){recognition=null;setListening(false);status.textContent='No pude iniciar el micrófono. Intenta de nuevo.';status.dataset.state='attention';}
    };
    listen.onclick=()=>{if(listeningNow){try{recognition?.stop();}catch(_){setListening(false);}return;}start();};
    correct.onclick=()=>{summary.hidden=true;review.hidden=false;feedback.textContent='Corrige sólo lo necesario.';(tooth.value?surface:tooth).focus({preventScroll:true});};
    close.onclick=destroy;cancel.onclick=destroy;dialog.addEventListener('cancel',event=>{event.preventDefault();destroy();});
    apply.onclick=()=>{
      if(applying||!valid())return;
      const prepared=candidate();if(!format(prepared))return;
      applying=true;apply.disabled=true;feedback.textContent='Agregando al borrador…';
      try{const accepted=options.onApply(prepared);if(accepted===false)throw new Error('No se pudo preparar el borrador.');destroy();}
      catch(error){applying=false;validate();feedback.textContent=error?.message||'No se pudo preparar el borrador.';}
    };
    dialog.showModal();return {close:destroy,dialog};
  }

  return Object.freeze({teeth,surfaces,surfaceAllowed,parse,format,supported,open});
});
