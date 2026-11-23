/* Temporary voice proposal for a single periodontal examination. Only apply() touches its clinical draft. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./smyl-dental-model.js'), require('./smyl-dental-dictation.js'));
  } else {
    root.SmylPeriodontalGuidedModel = factory(root.SmylDentalModel, root.SmylDentalDictation);
  }
})(typeof globalThis === 'undefined' ? this : globalThis, function (dental, dictation) {
  'use strict';
  const sites = {V:['MB','B','DB'], I:['ML','L','DL']};
  const positions = ['mesial','central','distal'];
  const words = 'cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte'.split(' ');
  const key = (tooth,site) => tooth + '/' + site;
  const siteFace = site => sites.V.includes(site) ? 'V' : 'I';
  const siteName = site => positions[sites[siteFace(site)].indexOf(site)];
  const faceName = (tooth,face) => face === 'V' ? 'vestibular' : Number(tooth) < 30 ? 'palatina' : 'lingual';
  const location = (tooth,face) => 'Pieza '+tooth+', '+faceName(tooth,face);
  const validDepth = n => Number.isInteger(n) && n >= 0 && n <= 20;
  const depthOf = token => /^\d{1,2}$/.test(token) ? Number(token) : words.indexOf(token);
  function normalize(text) {
    const plain = String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    // Preserve decimal separators, minus signs and other meaningful punctuation as invalid input.
    if (plain.length > 160 || /\d[.,]\d|[-−]/.test(plain)) return '';
    return plain.replace(/[.!?]$/,'').replace(/[,;:]/g,' ').replace(/\s+/g,' ').trim();
  }
  function parseTooth(text) {
    if (/^[1-4][1-8]$/.test(text)) return text;
    if (!/^(?:once|doce|trece|catorce|quince|dieci\w+|veinti\w+|(?:treinta|cuarenta) y \w+)$/.test(text)) return '';
    const parsed = dictation?.parse('pieza '+text);
    return parsed && !parsed.condition && !parsed.ambiguous ? parsed.tooth : '';
  }
  function parseTarget(text, current) {
    if (!text) return current;
    const parts = text.match(/^(?:(?:la|el) )?(?:pieza |diente )?(.+?) (?:cara )?(vestibular|bucal|lingual|palatin[ao])$/);
    if (!parts) return null;
    const tooth = parseTooth(parts[1]);
    if (!tooth || (parts[2] === 'lingual' && Number(tooth)<30) || (parts[2].startsWith('palatin') && Number(tooth)>30)) return null;
    return {tooth, face:['vestibular','bucal'].includes(parts[2]) ? 'V' : 'I'};
  }
  function buildRoute(options) {
    const firstTooth = String(options.tooth || '18'), firstFace = options.face === 'I' ? 'I' : 'V';
    const arches = [dental.upper, dental.lower];
    if (Number(firstTooth) >= 30) arches.reverse();
    const stops = [];
    for (const arch of arches) {
      const teeth = arch.map(String);
      if (options.direction === 'reverse') teeth.reverse();
      for (const tooth of teeth) stops.push({tooth, face:firstFace});
      for (const tooth of teeth.reverse()) stops.push({tooth, face:firstFace === 'V' ? 'I' : 'V'});
    }
    const start = Math.max(0,stops.findIndex(s => s.tooth === firstTooth && s.face === firstFace));
    const missing = new Set(Array.from(options.missingTeeth || [], String));
    return stops.slice(start).concat(stops.slice(0,start)).filter(s => !missing.has(s.tooth));
  }

  function create(options) {
    const route = buildRoute(options);
    const originals = new Map(), proposed = new Map(), skipped = new Set();
    const autoAdvance = options.autoAdvance !== false;
    let index = 0, status = route.length ? 'active' : 'review', transaction = null;
    let feedback = route.length ? location(route[0].tooth,route[0].face)+'. De mesial a distal.' : 'No hay piezas disponibles para el recorrido.';
    let speak = feedback;
    function read(tooth,site) {
      const n = options.getDepth?.(tooth,site);
      return validDepth(n) ? n : null;
    }
    for (const {tooth,face} of route) {
      for (const site of sites[face]) originals.set(key(tooth,site),read(tooth,site));
    }
    const current = () => route[index] || {tooth:'',face:'V'};
    const effective = (tooth,site) => proposed.get(key(tooth,site))?.value ?? originals.get(key(tooth,site)) ?? null;
    const missing = stop => sites[stop.face].filter(site => effective(stop.tooth,site) === null);
    const vacant = stop => missing(stop).filter(site => !skipped.has(key(stop.tooth,site)));
    const find = (tooth,face) => route.findIndex(stop => stop.tooth === String(tooth) && stop.face === face);
    function getState() {
      const {tooth,face} = current(), siteList = sites[face];
      const unresolved = transaction?.questions[0];
      return {
        status,tooth,face,faceLabel:faceName(tooth,face),sites:[...siteList],autoAdvance,
        values:siteList.map(site => effective(tooth,site)),
        sources:siteList.map(site => proposed.has(key(tooth,site)) ? 'proposed' : effective(tooth,site) !== null ? 'original' : 'empty'),
        nextSite:route.length ? vacant(current())[0] || null : null,position:route.length ? index+1 : 0,total:route.length,feedback,speak,
        changes:Array.from(proposed.values(),item=>({...item})),
        pending:route.map(stop=>({...stop,sites:missing(stop)})).filter(stop=>stop.sites.length),
        conflict:unresolved ? {...unresolved} : null
      };
    }
    function say(message, spoken=message) {
      feedback = message; speak = spoken;
      return getState();
    }
    function getPatches() {
      const patches = new Map();
      for (const {tooth,site,value} of proposed.values()) {
        if (!patches.has(tooth)) patches.set(tooth,{tooth,changes:[]});
        patches.get(tooth).changes.push({site,field:'depth',value});
      }
      return [...patches.values()];
    }
    function move(step, prefix='') {
      if (status !== 'active' || transaction) return getState();
      if (index+step >= route.length) {
        status='review';
        return say(prefix+'Recorrido terminado. Revisa las mediciones.');
      }
      index=Math.max(0,index+step);
      return say(prefix+location(current().tooth,current().face)+'. De mesial a distal.');
    }
    function requestOverwrite() {
      const item=transaction.questions[0];
      const earlier=item.original === null ? 'Ahora figura sin medir' : 'Hay '+item.original+' mm';
      return say(location(item.tooth,item.face)+', '+siteName(item.site)+'. '+earlier+'. ¿Reemplazar por '+item.value+' mm?');
    }
    function propose(items, after) {
      const entries=items.map(({tooth,site,value})=>({
        tooth,site,value,face:siteFace(site),original:originals.get(key(tooth,site)) ?? null
      }));
      function stage(accepted) {
        for (const item of accepted) {
          const id=key(item.tooth,item.site);
          if (item.value === item.original) proposed.delete(id);
          else proposed.set(id,item);
          skipped.delete(id);
        }
        return after(accepted);
      }
      const questions=entries.filter(item=>item.original !== null && effective(item.tooth,item.site) !== item.value);
      if (!questions.length) return stage(entries);
      transaction={entries,questions,finish:stage};
      return requestOverwrite();
    }
    function resolveOverwrite(accept) {
      if (!transaction || status==='paused') return getState();
      const item=transaction.questions.shift();
      if (!accept) transaction.entries=transaction.entries.filter(entry=>entry!==item);
      if (transaction.questions.length) return requestOverwrite();
      const tx=transaction; transaction=null;
      return tx.finish(tx.entries);
    }
    function record(items, correction) {
      const dest=items[0], stop=current();
      return propose(items, accepted => {
        if (!accepted.length) return say('Se conservó la medición anterior.');
        const values = accepted.map(item=>item.value).join(', ');
        if (correction) {
          const returnTo=status==='active' && (dest.tooth!==stop.tooth || dest.face!==stop.face);
          return say(location(dest.tooth,dest.face)+', '+siteName(dest.site)+', '+values+' mm.'+
            (returnTo ? ' Continúa en '+location(stop.tooth,stop.face)+'.' : ''));
        }
        const next=vacant(stop)[0];
        const readings=next ? accepted : sites[stop.face].map(site=>({site,value:effective(stop.tooth,site)}));
        const prefix=location(stop.tooth,stop.face)+', '+readings.map(item=>siteName(item.site)+' '+(item.value ?? 'sin medir')).join(', ')+'. ';
        if (next) return say(prefix+'Falta '+siteName(next)+'.');
        if (autoAdvance) return move(1,prefix);
        return say(prefix+'Di siguiente.');
      });
    }
    function edit(tooth,site,value) {
      tooth=String(tooth); const face=siteFace(site);
      if (status==='complete' || transaction || !sites[face].includes(site) || find(tooth,face)<0) return getState();
      if (value === null || value === '') {
        proposed.delete(key(tooth,site)); skipped.delete(key(tooth,site));
        return say('Propuesta retirada.');
      }
      const depth = typeof value==='string' && /^\d{1,2}$/.test(value) ? Number(value) : value;
      if (!validDepth(depth)) return say('Indica un número entero de 0 a 20 mm.');
      return record([{tooth,face,site,value:depth}],true);
    }
    function goTo(tooth,face) {
      const target=find(tooth,face);
      if (target<0 || status==='complete' || transaction) return getState();
      index=target; status='active';
      for (const site of sites[face]) skipped.delete(key(String(tooth),site));
      return say(location(String(tooth),face)+'. De mesial a distal.');
    }
    function pause() {
      if (status !== 'active') return getState();
      status='paused'; return say('Sondaje en pausa.');
    }
    function resume() {
      if (status!=='paused') return getState();
      status='active';
      if (transaction) return requestOverwrite();
      const stop=current(), next=vacant(stop)[0];
      return say(location(stop.tooth,stop.face)+'. '+(next?'Continúa en '+siteName(next)+'.':'Di siguiente.'));
    }
    function review() {
      if (!['paused','active'].includes(status)) return getState();
      status='review';
      if (transaction) return requestOverwrite();
      return say('Revisa las mediciones antes de aplicarlas.');
    }
    function apply() {
      if (status!=='review' || transaction) return getState();
      const changed=[];
      for (const item of proposed.values()) {
        const now=read(item.tooth,item.site);
        if (now!==item.original && now!==item.value) changed.push({...item,original:now});
      }
      if (changed.length) {
        transaction={entries:[...changed],questions:[...changed],finish(accepted) {
          for (const item of changed) {
            const id=key(item.tooth,item.site); originals.set(id,item.original);
            if (accepted.includes(item)) proposed.set(id,item);
            else proposed.delete(id);
          }
          return say('Revisa los cambios actualizados y pulsa Aplicar.');
        }};
        return requestOverwrite();
      }
      const batch=getPatches();
      if (!batch.length) return say('No hay mediciones nuevas para aplicar.');
      let applied=false;
      try {
        applied=typeof options.onApplyBatch==='function' ? options.onApplyBatch(batch)===true :
          batch.length===1 && options.onApply?.(batch[0])===true;
      } catch { applied=false; }
      if (!applied) return say('No se pudo aplicar el sondaje. Conservamos tus lecturas para revisarlas.');
      for (const item of proposed.values()) originals.set(key(item.tooth,item.site),item.value);
      proposed.clear(); status='complete';
      return say('Mediciones aplicadas al borrador.');
    }
    function hear(transcript) {
      if (status!=='active') return getState();
      const text=normalize(transcript);
      if (['pausa','pausar'].includes(text)) return pause();
      if (transaction) {
        if (['confirmar reemplazo','reemplazar'].includes(text)) return resolveOverwrite(true);
        if (['conservar anterior','cancelar reemplazo'].includes(text)) return resolveOverwrite(false);
        return requestOverwrite();
      }
      const stop=current();
      if (['siguiente','saltar','saltar cara','siguiente pieza'].includes(text)) return move(1);
      if (['anterior','pieza anterior'].includes(text)) return move(-1);
      if (['terminar recorrido','revisar mediciones','revisar pendientes'].includes(text)) return review();
      const next=vacant(stop);
      if (text==='saltar sitio') {
        if (next.length) skipped.add(key(stop.tooth,next[0]));
        if (next.length<=1) return move(1);
        return say('Sitio sin medir. Continúa en '+siteName(next[1])+'.');
      }
      const correction=text.match(/^(?:corrige|corregir|cambia|cambiar) (.*?)\b(?:el |la )?(mesial|central|distal) (?:a |en )?(\w+)(?: mm| milimetros)?$/);
      if (correction) {
        const target=parseTarget(correction[1].trim(),stop), depth=depthOf(correction[3]);
        if (target && find(target.tooth,target.face)>=0 && validDepth(depth)) {
          return edit(target.tooth,sites[target.face][positions.indexOf(correction[2])],depth);
        }
        return say('Repite la pieza, cara, sitio y nueva profundidad.');
      }
      let numbers=text.replace(/ (?:milimetros|mm)$/,'');
      const named=numbers.match(/^(.*?)\b(vestibular|bucal|lingual|palatin[ao])\s+(.+)$/);
      if (named) {
        const target=parseTarget((named[1]+named[2]).trim(),stop);
        if (!target || target.tooth!==stop.tooth || target.face!==stop.face) return say('Comprueba el sitio. '+location(stop.tooth,stop.face)+'.');
        numbers=named[3];
      }
      if (/^(mesial|central|distal)\b/.test(numbers)) {
        const matches=[...numbers.matchAll(/\b(mesial|central|distal) (\w+)(?: y)?(?= |$)/g)];
        const complete=matches.map(match=>match[0]).join(' ')===numbers;
        const distinct=new Set(matches.map(match=>match[1])).size===matches.length;
        if (!complete || !distinct || !matches.every(match=>validDepth(depthOf(match[2])))) {
          return say('Indica una sola profundidad válida para cada sitio.');
        }
        return record(matches.map(match=>({...stop,site:sites[stop.face][positions.indexOf(match[1])],value:depthOf(match[2])})),false);
      }
      let ordered=[...sites[stop.face]];
      if (numbers.startsWith('de distal a mesial ')) {
        ordered.reverse(); numbers=numbers.slice('de distal a mesial '.length);
      } else numbers=numbers.replace(/^de mesial a distal /,'');
      const parts=numbers.split(/\s+(?:y\s+)?/);
      const values=parts.map(depthOf);
      if (values.length>3 || !values.every(validDepth)) return say('Repite las profundidades en milímetros.');
      const targets=values.length===3 && !ordered.some(site=>proposed.has(key(stop.tooth,site)) || skipped.has(key(stop.tooth,site))) ?
        ordered : ordered.filter(site=>next.includes(site));
      if (values.length>targets.length) return say('La cantidad no coincide con los sitios pendientes. Puedes corregir un sitio por nombre.');
      return record(values.map((value,i)=>({...stop,site:targets[i],value})),false);
    }
    return {getState,getPatches,hear,edit,goTo,pause,resume,review,apply,next:()=>move(1),previous:()=>move(-1),
      skip:()=>move(1),confirmOverwrite:()=>resolveOverwrite(true),cancelOverwrite:()=>resolveOverwrite(false)};
  }
  return Object.freeze({create});
});
