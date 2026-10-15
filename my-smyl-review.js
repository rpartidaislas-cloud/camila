/* Professional-only, transient preparation of the patient summary.
 * No storage, network, AI, approval RPC or sharing. Caller validates context.
 */
(function () {
  'use strict';
  let sequence=0;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n;};
  const button=(text,fn,cls)=>{const n=el('button',cls,text);n.type='button';n.onclick=fn;return n;};
  function mount(host,{source,previous,onPreview,onCancel,onRemove}) {
    const root=el('section','ms-review-editor'),prefix='ms-review-draft-'+(++sequence);
    let disposed=false;
    const valid=()=>!disposed && !!source?.isCurrent();
    root.append(el('p','ms-kicker','SOLO PARA EL DENTISTA'),el('h1','','Prepara su revisión.'),el('p','ms-review-lead','Elige cómo explicarle tu valoración. Nada se añade a mySmyl sin tu confirmación.'));
    const tip=el('div','ms-review-tip');tip.append(el('strong','','Vista previa, no envío'),el('p','','Esta selección dura mientras tengas abierta esta vista. No se guarda en el expediente ni se comparte con el paciente.'));
    root.append(tip);
    if(!valid()){
      root.append(el('h2','','Primero, revisa la valoración.'),el('p','','Guarda el plan como revisado en «Valoración y tratamiento», sin cambios pendientes. Después vuelve a abrir esta vista para preparar el resumen.'),button('Volver a la vista previa',onCancel,'ms-primary'));
    }else{
      const reference=el('details','ms-review-reference');
      reference.append(el('summary','','Consultar valoración revisada · versión '+source.revision),el('p','ms-review-source',source.assessment));root.append(reference);
      const label=el('label','ms-review-label','Lo que verá el paciente'),input=el('textarea','ms-review-input');
      input.id=prefix;input.maxLength=8000;input.rows=7;input.value=previous?.summary||'';label.htmlFor=input.id;
      input.placeholder='Resume lo que observaste y qué significa para el paciente. Usa palabras claras y evita notas internas.';
      const helper=el('p','ms-review-field-help','Solo se incluirá este texto. Antecedentes, notas internas, tratamientos, mapa dental y radiografías no se copian automáticamente.');helper.id=prefix+'-help';input.setAttribute('aria-describedby',helper.id);
      const copy=button('Usar valoración revisada',()=>{
        if(!valid())return;
        if(input.value.trim() && input.value!==source.assessment && !confirm('¿Reemplazar el resumen que escribiste por la valoración revisada?'))return;
        input.value=source.assessment;refresh();input.focus();
      },'ms-review-secondary');
      const tools=el('div','ms-review-field-tools'),count=el('span');tools.append(copy,count);
      const checkLabel=el('label','ms-review-confirm'),check=el('input');check.type='checkbox';check.id=prefix+'-confirm';
      checkLabel.append(check,document.createTextNode('Revisé este resumen y lo elijo para la vista del paciente. No contiene notas internas ni sugerencias pendientes de confirmar.'));
      const actions=el('div','ms-review-actions'),apply=button('Ver en Mi revisión',()=>{
        if(valid()&&check.checked&&input.value.trim()&&input.value.length<=8000)onPreview({confirmed:true,summary:input.value.trim(),sourceRevision:source.revision,reviewedAt:source.reviewedAt});
      },'ms-primary');
      function refresh(reset=true){if(reset)check.checked=false;count.textContent=input.value.length.toLocaleString('es-MX')+' / 8,000';apply.disabled=!valid()||!check.checked||!input.value.trim()||input.value.length>8000;}
      input.oninput=()=>refresh();check.onchange=()=>refresh(false);
      actions.append(button('Cancelar',onCancel,'ms-review-secondary'),apply);
      if(previous)actions.prepend(button('Quitar de la vista previa',()=>{if(valid())onRemove();},'ms-review-secondary'));
      root.append(label,input,tools,helper,checkLabel,actions);refresh();
    }
    host.replaceChildren(root);
    const title=root.querySelector('h1');title.tabIndex=-1;title.focus({preventScroll:true});
    return {destroy(){disposed=true;root.querySelectorAll('textarea').forEach(n=>n.value='');root.remove();}};
  }
  window.MySmylReview=Object.freeze({mount});
})();
