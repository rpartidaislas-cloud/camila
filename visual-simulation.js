(function (root) {
  'use strict';
  const CONTRACT = 'visual-preview-v3-tooth-lock';
  let active = false;
  const constructionOf = options => options?.construction === 'monolithic' ? 'monolithic' : 'layered';
  const constructionLabel = value => value === 'monolithic' ? 'Monolítico' : 'Estratificado';
  const shadeDescriptions = {
    B1:'very high-value neutral ivory, the brightest natural shade in this guide, with less warmth than A1',
    A1:'light high-value warm ivory with restrained warm chroma; visibly cleaner and more luminous than C2, but never bleach-white',
    B2:'light ivory with a soft yellow warmth, slightly lower in value than A1',
    D2:'light ivory with a restrained red-warm nuance',
    A2:'medium-light warm ivory with more chroma and lower value than A1',
    C1:'light neutral ivory with a subtle gray cast and reduced yellow chroma',
    C2:'medium-value, low-chroma neutral gray ivory; distinctly less luminous, less warm and more muted than A1, but never blue or cyan',
    D4:'medium ivory with a discreet red-warm nuance',
    A3:'medium warm dentin shade with clearly greater chroma than A1',
    D3:'medium-low value warm ivory with a restrained reddish nuance',
    B3:'medium-low value ivory with evident yellow warmth',
    'A3.5':'deeper warm ivory from the A family with increased chroma',
    B4:'deep warm ivory with pronounced yellow chroma',
    C3:'deep, muted neutral ivory with a soft gray cast',
    A4:'deep high-chroma warm ivory from the A family',
    C4:'the deepest muted neutral-gray ivory in the C family'
  };
  function prompt(options) {
    const shadeCode = /^(A[1-4](\.5)?|B[1-4]|C[1-4]|D[2-4])$/.test(options.shade) ? options.shade : 'A1';
    const shade = options.current ? 'Keep the original enamel shade as the ceramic color reference; still perform the requested finished veneer morphology.' :
      'VITA SHADE — REQUIRED: approximate VITA Classical ' + shadeCode + ' under the ORIGINAL light and apply it consistently to every selected veneer. ' +
      'PERCEPTUAL TARGET: ' + shadeDescriptions[shadeCode] + '. Do not collapse different VITA codes into the same generic cream or ivory. Preserve a subtle cervical warmth and translucent incisal depth so the result reads as porcelain rather than a flat color filter. ' +
      ' Preserve one photographic white balance across the entire image. If both arches are selected, upper and lower veneers must share the same VITA family and value; do not render one arch warm and the other blue-gray. Use only natural differences caused by the existing light and shadows. This is a visual shade reference, not a calibrated measurement.';
    const construction = constructionOf(options) === 'monolithic'
      ? 'CERAMIC CONSTRUCTION — MONOLITHIC: depict a single continuous ceramic body with a more homogeneous internal optical appearance and smooth shade transitions. Retain natural translucency and individualized reflections; uniform material must not become opaque plastic or identical teeth. Do not simulate separate dentin/enamel strata, pronounced internal layering or painted internal bands. If a translucent finish is selected, use gentle transmission through the single body rather than adding enamel layers.'
      : 'CERAMIC CONSTRUCTION — LAYERED: depict stratified porcelain with a softly luminous dentin-like core beneath a translucent enamel-like layer. Make the optical depth perceptible: gentle cervical warmth, luminous body, a restrained translucent incisal zone, delicate opalescence and a fine incisal halo. Suggest faint internal mamelon variation only where visible at the photograph resolution. Avoid painted stripes, exaggerated markings, gray edges or transparent holes. Layering must differ from a homogeneous monolithic body without artificial contrast.';
    const finish = {natural:'Fine satin glaze with soft, coherent highlights.',translucent:'Restrained ceramic translucency consistent with the selected construction, never gray or transparent holes.',luminous:'Luminous glazed porcelain with defined but controlled highlights, never chalk white or blown out.'}[options.finish] || 'Fine satin glaze with soft, coherent highlights.';
    const strength = {subtle:'Keep ceramic optics understated while completing the veneer design.',balanced:'Make the finished veneer morphology and ceramic depth visible but believable.',notable:'A more polished ceramic finish, without exaggerated whiteness or oversized crowns.'}[options.intensity] || 'Make the finished veneer morphology and ceramic depth visible but believable.';
    const materialLock = options.materialOnly ? [
      'MATERIAL-ONLY VITA OVERRIDE — HIGHEST PRIORITY: the supplied photograph already contains the approved final veneer design. Change ceramic shade and optical material only.',
      'Pixel-lock every crown silhouette, cervical margin, incisal edge, facial axis, width, height, contact, embrasure, tooth position, arch relationship and gingival boundary exactly as supplied. Do not realign, reshape, resize, rotate, lengthen, shorten, smooth or reconstruct any tooth.',
      'Preserve every non-dental pixel and the complete photograph exactly. The new output must register perfectly over the supplied image; only perceptual value, hue, chroma, translucency, internal depth and existing-light reflections inside the already restored ceramic surfaces may differ.',
      'This override cancels any morphology, alignment or contour instruction elsewhere in the prompt. If a requested shade would require changing geometry, keep the geometry and adapt only the material appearance.',
      'SHADE CONSISTENCY CHECK: centrals, laterals, canines and every selected tooth must remain recognizably in the same selected VITA family. Preserve plausible shadow and translucency differences, but reject a result where centrals turn gray while adjacent teeth turn yellow, or where upper and lower selected arches belong to visibly different shade families.'
    ].join(' ') : '';
    const multiviewLock = options.multiviewReference ? [
      'MULTI-VIEW DENTAL IDENTITY LOCK — HIGHEST PRIORITY: IMAGE 2 shows the already accepted master dental design for this SAME patient in another view. Reproduce the same dental identity in IMAGE 1; change only what perspective and natural photographic visibility require.',
      'TOOTH-COUNT AND BOUNDARY LOCK: IMAGE 2 is authoritative for the identity, count, order and interproximal separation of the corresponding anterior teeth. Transfer every corresponding visible tooth one-to-one. Preserve six distinct maxillary anterior units in FDI order 13-12-11-21-22-23 whenever that same span is visible in IMAGE 1. Never merge 11 and 21, never absorb a lateral into a central, never split one tooth into two and never replace two narrow or overlapping source teeth with one oversized crown.',
      'Keep the same relative width-to-height hierarchy, central-incisor dominance, lateral-incisor scale, canine character, incisal-edge design, contact rhythm, embrasures, smile-arc intent, VITA shade family, ceramic construction and surface character. Keep the restored anterior group inside the dental envelope visible in IMAGE 1; blur or low resolution is not permission to enlarge crowns, erase contact lines or invent a second smile design.',
      'Do NOT paste, warp or trace IMAGE 2 and do not copy its lips, gingiva, face, crop, lighting or camera angle. IMAGE 1 remains the sole source for patient pose, soft tissues, occlusion, illumination and perspective. IMAGE 2 overrides IMAGE 1 only when the target photograph is ambiguous about tooth count, individual boundaries or relative crown proportions. Translate the master design anatomically into the target view with correct foreshortening and visibility.',
      'If a feature is hidden in IMAGE 1, do not expose it merely because it appears in IMAGE 2. Preserve the target photograph outside the requested dental restoration. The purpose of IMAGE 2 is cross-view consistency, not pixel registration.',
      'Before output, count the corresponding teeth from left to right and verify each boundary separately against IMAGE 2. The result must be recognizable as the same planned veneers photographed from another angle, not a new set of teeth.'
    ].join(' ') : '';
    const ceramic = [
      multiviewLock,
      materialLock,
      'EDIT THE SUPPLIED PHOTOGRAPH. Show the FINISHED PORCELAIN VENEERS ALREADY IN PLACE in one photorealistic quick consultation preview. This is a restorative aesthetic illustration, not merely whitening and not a staged correction workflow. The source photograph anchors patient identity, tooth count, relative scale and the surrounding smile.',
      'REQUESTED CHANGE — FINISHED VENEER MORPHOLOGY: redesign the visible facial surfaces and contours of selected crowns into a coherent finished restoration. You may refine irregular outlines, restore worn or chipped incisal edges, harmonize modest length differences and apparent facial axes, and improve visible contact transitions within the existing smile envelope. Do not copy the original chips and uneven borders onto the finished ceramic. Preserve recognizable relative tooth sizes: dominant centrals, smaller laterals and distinct canine character; avoid oversized crowns, stock teeth and mirror cloning. No orthodontic alignment is being prescribed or predicted: apparent crown pose may be idealized for this aesthetic illustration, not represented as achievable with veneers alone. Do not alter jaw position, bite, arch width or tooth count. Do not impose golden proportions or mathematical symmetry.',
      'FINISHED ARRANGEMENT — ALL SELECTED ANTERIOR TEETH: harmonize apparent whole-crown axes and facial-surface depth from canine to lateral to central on BOTH sides. Resolve visually recessed, tilted or overlapping laterals within a natural curved sequence, rather than leaving them behind newly regular centrals. Adjust apparent crown pose and restorative contour together, not just the incisal tip. Keep laterals smaller and naturally shorter than centrals; keep recognizable canine cusps and individual width-to-height relationships. When both arches are selected, apply this to the lower anterior group as well; otherwise leave the unselected arch untouched. Do not make space by shrinking teeth, expanding the arch or enlarging the mouth opening. This is an idealized finished-smile illustration, not a faithful-only alignment or a guarantee of treatment feasibility.',
      'CENTRAL INCISAL FINISH — TEETH 11 AND 21: give both maxillary central veneers a deliberately finished, smooth and continuous incisal contour. Remove source chips, notches, serrations, flattened wear steps and irregular enamel scallops from the final ceramic edge; do not trace or copy those defects into the veneer. Keep a subtle natural curvature and softly rounded mesial/distal corners, with two distinct non-cloned centrals and a clean contact between them. Smooth does not mean a ruler-straight horizontal bar, identical rectangles or loss of natural asymmetry. At final image scale, neither central may show a bite-like notch, jagged segment, double edge or remnant of the original worn contour.',
      'PRIORITY 2 — PRESERVE TISSUE AND PHOTOGRAPH: keep gingival margins, papillae, color and texture, lips, mouth opening, lower teeth and lower gingiva, tongue, oral cavity, skin and facial details unchanged. No gingival refinement or lip retouching. Preserve crop, angle, perspective, exposure, white balance, shadow direction and photographic grain. Do not crop, rotate, zoom, reframe or beautify the face.',
      'COMPLETE FACIAL COVERAGE: give each visible upper tooth one continuous finished porcelain surface from its existing gingival junction to its designed incisal edge. No uncovered strips of original enamel around or below the ceramic, no inset borders, yellow rims, ledges, double incisal edges or second tooth layer showing underneath. Render one coherent final crown boundary, including the requested contour refinements. Maintain distinct teeth, natural contact shadows and incisal embrasures; do not paint over gingiva, bridge missing teeth or erase gingival black triangles.',
      'CERAMIC MATERIAL — MORE THAN WHITENING: render individualized porcelain according to the selected construction, with a fine polished glaze and subtle non-repeating surface texture. Shape primary facial convexities, transition lines and delicate secondary anatomy coherently with the finished contours. Avoid retaining every source enamel imperfection beneath a white filter. Use optical depth, soft specular highlights and gentle tonal gradients consistent with the original light. Keep gentle cervical warmth continuous with the selected shade, not an exposed yellow collar. Blend at the unchanged tissue boundary without a white outline. No flat tiles, plastic, artificial sparkle or new light source. Match photographic sharpness, grain and exposure.',
      'VENEER OPTICAL INTEGRATION — APPLY TO EVERY SELECTED TOOTH: show delicate, integrated all-ceramic facial restorations, not thick full-coverage caps. Keep a slender emergence profile without an inflated cervical bulge, raised perimeter, opaque collar or dark metallic-looking rim. Preserve existing gingiva and genuine contact shadows; do not erase tissue shadows to fake integration. Central incisors must not become featureless cream-colored blocks: articulate soft facial curvature with broad light falloff, restrained transition lines and fine photographic microtexture. Use a continuous cervical-to-body-to-incisal optical gradient, not three painted bands. Keep the selected shade, with natural depth rather than yellow opaque fill or uniform bleaching. Match optical quality across centrals, laterals and canines without identical highlights. Do not leave one central flat and opaque beside translucent neighbors. No rectangular white outline, chalky core, plastic shell, excessive thickness or artificial sparkle. The existing lighting determines highlights; do not add a studio light.',
      construction, shade, finish, strength,
      'MATERIAL SELF-CHECK BEFORE OUTPUT: compare both central incisors with their neighbors at the final photograph scale. If a selected tooth reads as a flat opaque patch or bulky cap, revise its curvature shading, material depth and edge integration within this same image. For layered construction, retain a softly luminous body beneath translucent enamel and restrained incisal opalescence; for monolithic construction, retain a smoother single-body gradient without invented strata. Never make the incisal edge transparent, dark gray or outlined merely to emphasize layering. Preserve intentional contour improvements and relative tooth dimensions. Do not rely on a whiter shade alone to communicate veneers.',
      'FINAL CHECK: each selected tooth must read as a finished veneer, with purposeful contours and ceramic depth rather than whitening alone. Inspect the complete incisal outline of 11 and 21 separately: both must be smooth, finished and free of copied source defects while retaining natural curvature. If both arches are selected, compare upper and lower anterior value and hue: correct any blue-gray lower arch, orange upper arch or unrelated white-balance split so both express the same requested VITA shade under the same photographed light. Check no uncovered enamel rim or double edge, then check all tissue boundaries, tooth count, non-target teeth, color and framing. Protected tissue and patient identity take priority; requested restorative contour changes are intentional, not preservation failures. ' + (options.materialOnly ? 'For this material-only pass, compare against the supplied design one final time and undo any geometric or tissue change before output.' : '') + ' This image does not establish clinical feasibility. OUTPUT ONLY the edited photograph with the same framing and aspect ratio. No side-by-side, guides, text, annotations, masks or watermark.'
    ].join('\n');
    return root.SmylSmileModes ? root.SmylSmileModes.prompt(options,ceramic) : ceramic;
  }

  function loadImage(url) {
    return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('No se pudo preparar la referencia dental maestra.'));image.src=url;});
  }

  async function fitGuideToInput(guide,input) {
    if(!guide)return null;
    const target=await loadImage(input.dataUrl||('data:'+(input.mimeType||'image/png')+';base64,'+input.b64));
    const source=await loadImage(guide.dataUrl||('data:'+(guide.mimeType||'image/png')+';base64,'+guide.b64));
    const canvas=document.createElement('canvas');canvas.width=target.naturalWidth||target.width;canvas.height=target.naturalHeight||target.height;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);
    // Contain, no cover: recortar los extremos de la intraoral podía ocultar
    // laterales/caninos y debilitaba precisamente el conteo que debe transferir.
    const scale=Math.min(canvas.width/(source.naturalWidth||source.width),canvas.height/(source.naturalHeight||source.height));
    const width=(source.naturalWidth||source.width)*scale,height=(source.naturalHeight||source.height)*scale;
    ctx.drawImage(source,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
    const dataUrl=canvas.toDataURL('image/png');
    return {dataUrl,b64:dataUrl.split(',')[1],mimeType:'image/png'};
  }
  function review({before, after, consent = false, construction = 'layered', adjust, options={}, rawBefore, rawAfter}) {
    return new Promise(resolve => {
      const previous = document.activeElement;
      const dialog = document.createElement('dialog'); dialog.className = 'smyl-visual-dialog';
      dialog.innerHTML = '<div class="sv-eyebrow">SMYL · SIMULACIÓN VISUAL IA</div><h2></h2><p class="sv-description"></p><div class="sv-comparison"></div><label class="sv-check"><input type="checkbox"><span></span></label><div class="sv-actions"><button type="button" data-action="cancel"></button><button type="button" data-action="accept" disabled></button></div><p class="sv-footnote"></p>';
      dialog.querySelector('h2').textContent = consent ? 'Una primera aproximación a tu sonrisa' : 'Compara antes de presentar';
      dialog.querySelector('.sv-description').textContent = consent ? 'La IA trabajará sobre este recorte de tu fotografía, sin marcar dientes. Comprueba que la sonrisa se vea completa.' : 'Comprueba encía, labios, dientes inferiores y forma de cada diente. Revisa que el acabado cubra cada superficie, sin franjas ni bordes dobles. Descarta la propuesta si altera la anatomía. No se generará otra automáticamente.';
      const material = document.createElement('p'); material.className = 'sv-material';
      material.textContent = 'Apariencia cerámica: ' + constructionLabel(construction) + ' · simulación visual';
      if(root.SmylSmileModes){material.textContent=root.SmylSmileModes.label(options)+(root.SmylSmileModes.alignment(options)?' · conservar color y forma individual':' · '+constructionLabel(construction));
        dialog.querySelector('.sv-description').textContent=consent?'Revisa la foto y la arcada seleccionada. Solo se enviará esta imagen al autorizar. '+(options.stage==='finishing'?'Etapa 2: carillas sobre la alineación aceptada; esta es otra generación.':''):'Revisa que solo cambie lo solicitado. Comprueba tejido, dientes no seleccionados, número de piezas y encuadre. La alineación es hipotética; no valida movimientos, raíces ni mordida. Descarta si aparecen cambios no autorizados.';
      }
      dialog.querySelector('.sv-description').after(material);
      if(root.SmylSmileModes&&!root.SmylSmileModes.alignment(options)){
        dialog.querySelector('h2').textContent=consent?'Visualiza tus carillas terminadas':'Tu propuesta de carillas terminadas';
        dialog.querySelector('.sv-description').textContent=consent?'Se armonizarán la posición aparente, los contornos y el acabado cerámico de los dientes seleccionados. Es una sonrisa idealizada: no significa que pueda lograrse solo con carillas. Revisa foto y arcada antes de autorizar.'+(options.stage==='finishing'?' Esta segunda etapa consume otro cupo.':''):'Compara centrales, laterales y caninos: posición aparente, forma, bordes y cerámica pueden cambiar intencionalmente. Revisa tamaño relativo, continuidad entre dientes y conservación de rostro, encía y piezas no seleccionadas. Sin bordes dobles. Es una propuesta idealizada, no un resultado garantizado ni necesariamente realizable solo con carillas.';
      }
      if(options.refineTargets?.length){material.textContent='Corrección localizada · laterales superiores';dialog.querySelector('.sv-description').textContent=consent?'Se enviará el resultado actual para corregir los laterales seleccionados. Esta edición consume cupo.':'Compara los laterales seleccionados y comprueba que las demás piezas se conservaron. Descartar mantiene tu resultado anterior.';}
      if(options.materialOnly){
        dialog.querySelector('h2').textContent=consent?'Cambiar únicamente el tono VITA':'Comprueba el cambio de material';
        material.textContent='Diseño bloqueado · '+(options.baseShade?options.baseShade+' → ':'')+(options.current?'tono natural':'VITA '+options.shade);
        dialog.querySelector('.sv-description').textContent=consent?'Se enviará el diseño de carillas ya aprobado. Solo deben cambiar el tono y la óptica cerámica; forma, posición, encía y fotografía permanecerán bloqueadas. Esta generación consume cupo.':'Compara ambas imágenes: deben conservar exactamente las mismas formas, posiciones, contactos, encía y encuadre. Acepta únicamente si el cambio se limita al material cerámico y el tono es coherente entre dientes.';
      }
      const comparison = dialog.querySelector('.sv-comparison');
      const sources = consent ? [['Fotografía que se enviará',before]] : [[options.refineTargets?.length?'Antes · resultado conservado':'Antes · fotografía original',before],['Después · propuesta IA',after]];
      if (consent) comparison.classList.add('sv-single');
      for (const [caption,url] of sources) {
        const figure = document.createElement('figure'), img = document.createElement('img'), label = document.createElement('figcaption');
        const viewport=document.createElement('div');viewport.style.overflow='hidden';
        img.src = url; img.alt = caption; label.textContent = caption; viewport.append(img);figure.append(viewport,label); comparison.append(figure);
      }
      dialog.querySelector('.sv-check span').textContent = consent ? 'Tengo autorización para enviar este recorte a OpenAI mediante SMYL. Entiendo que generar consume cupo y puede tener coste.' : 'Revisé la comparación y acepto usarla únicamente como aproximación visual, no como predicción clínica.';
      if(!consent&&root.SmylSmileModes?.alignment(options)){
        dialog.querySelector('.sv-check span').textContent='Comparé centrales, laterales y caninos: no observo dientes sustituidos, ensanchados ni bordes reconstruidos. Acepto solo una aproximación visual, no una predicción clínica.';
        const warning=document.createElement('p');warning.className='sv-footnote';warning.textContent='Alineación no es cambio de forma. Si un diente perdió su desgaste, cúspide, proporción o textura individual, descarta la propuesta aunque se vea más recto. Esta revisión es manual; el sistema no certifica conservación anatómica.';comparison.after(warning);
      }
      if(root.SmylSmileModes?.alignment(options)&&options.alignmentStyle==='idealized'){
        material.textContent=root.SmylSmileModes.label(options)+' · interpretación visual, no anatomía exacta';
        dialog.querySelector('.sv-description').textContent=consent?'Alineación estética idealizada: interpreta ejes, posiciones y contactos procurando conservar cada diente. Solo usa referencias visibles; no determina Clase I, mordida ni función. Revisa foto y arcada antes de autorizar.':'Compara línea media visible, ejes, identidad dental, tamaño, textura, encía y detalles ajenos a la alineación. La propuesta interpreta posiciones y contactos; no diagnostica oclusión, sustrato ni función.';
        if(!consent)dialog.querySelector('.sv-check span').textContent='Revisé la fidelidad a la foto y acepto una alineación estética idealizada, con interpretación de posiciones y contactos, únicamente como ilustración visual y no como resultado de tratamiento.';
      }
      const yes = dialog.querySelector('[data-action=accept]'), no = dialog.querySelector('[data-action=cancel]'), check = dialog.querySelector('input');
      let direct=false;
      if(!consent){
        const controls=document.createElement('div');controls.className='sv-actions';
        const zoom=document.createElement('button');zoom.type='button';zoom.textContent='Acercar comparación ×2';zoom.setAttribute('aria-pressed','false');
        zoom.onclick=()=>{const on=zoom.getAttribute('aria-pressed')!=='true';zoom.setAttribute('aria-pressed',String(on));zoom.textContent=on?'Ver encuadre completo':'Acercar comparación ×2';comparison.querySelectorAll('img').forEach(img=>{img.style.transform=on?'scale(2)':'none';});};controls.append(zoom);
        if(rawBefore&&rawAfter){
          const toggle=document.createElement('button');toggle.type='button';toggle.textContent='Revisar salida IA sin mezcla';toggle.setAttribute('aria-pressed','false');
          const hint=document.createElement('p');hint.className='sv-footnote';hint.textContent='El zoom amplía ambas vistas por igual. La salida sin mezcla permite comprobar si el cambio ya falta en la imagen generada; no genera otra imagen.';
          toggle.onclick=()=>{direct=!direct;toggle.setAttribute('aria-pressed',String(direct));toggle.textContent=direct?'Volver al resultado integrado':'Revisar salida IA sin mezcla';const imgs=comparison.querySelectorAll('img'),labels=comparison.querySelectorAll('figcaption');imgs[0].src=direct?rawBefore:before;imgs[1].src=direct?rawAfter:after;labels[0].textContent=direct?'Antes · recorte enviado a IA':sources[0][0];labels[1].textContent=direct?'Salida directa IA · solo diagnóstico':sources[1][0];check.checked=false;check.disabled=direct;yes.disabled=true;hint.textContent=direct?'Vista de diagnóstico: no se puede aceptar esta salida sin integrar. Si aquí tampoco hay alineación, ajustar la unión no la corregirá.':'Revisa el resultado integrado antes de aceptarlo. No se ha generado otra imagen.';};controls.append(toggle);comparison.after(hint);
        }
        comparison.before(controls);
      }
      if(!consent&&adjust){
        const button=document.createElement('button');button.type='button';button.textContent='Ajustar unión · sin IA';
        dialog.querySelector('.sv-actions').prepend(button);
        button.onclick=async()=>{button.disabled=true;yes.disabled=true;check.checked=false;try{const url=await adjust();if(url){after=url;if(!direct)comparison.querySelectorAll('img')[1].src=url;}}catch(error){dialog.querySelector('.sv-description').textContent=error.message;}finally{button.disabled=false;}};
      }
      yes.textContent = consent ? 'Generar con IA' : 'Usar esta aproximación'; no.textContent = consent ? 'Volver sin generar' : 'Descartar propuesta';
      dialog.querySelector('.sv-footnote').textContent = 'La IA puede modificar detalles. No garantiza exactitud anatómica ni resultado de tratamiento. Sustrato, oclusión y función requieren valoración clínica; los cambios profesionales se realizan en el editor.';
      check.addEventListener('change',()=>{yes.disabled=!check.checked;});
      function close(value) { dialog.close(); dialog.remove(); previous?.focus(); resolve(value); }
      yes.addEventListener('click',()=>{if(check.checked&&!direct)close(true);}); no.addEventListener('click',()=>close(false));
      dialog.addEventListener('cancel',event=>{event.preventDefault();close(false);});
      document.body.append(dialog); dialog.showModal(); no.focus();
    });
  }
  async function request({endpoint, headers, input, options, requestId}) {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),155000);
    try {
      const guide=await fitGuideToInput(options.masterGuide,input);
      const response = await fetch(endpoint, {method:'POST',headers:typeof headers==='function'?headers():headers,signal:controller.signal,body:JSON.stringify({
        action:'generate_image',requestId,requestReason:'primera_aproximacion_visual',
        imageBase64:input.b64,mimeType:input.mimeType||'image/png',prompt:prompt(options)+(root.SmylDentalReview?.instruction(options.dentalReview,options)||''),
        guideImageBase64:guide?.b64||'',guideMimeType:guide?.mimeType||'image/png',
        guideLibraryVersion:guide?'same-patient-master-v2':'',
        contractVersion:CONTRACT,imageProvider:'openai',responseMode:'binary'
      })});
      if(!response.ok){let detail;try{detail=await response.json();}catch{}const error=new Error(detail?.error||'El servicio no pudo generar la propuesta.');error.status=response.status;throw error;}
      let url, meta;
      if((response.headers.get('content-type')||'').startsWith('image/')) {
        const blob=await response.blob();if(!blob.size)throw new Error('El servicio devolvió una imagen vacía.');
        url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
        meta={requestId:response.headers.get('x-smyl-request-id')||requestId,provider:response.headers.get('x-smyl-provider'),model:response.headers.get('x-smyl-model'),quality:response.headers.get('x-smyl-quality')};
      } else {
        const data=await response.json();url=data.imageBase64?'data:'+(data.mimeType||'image/png')+';base64,'+data.imageBase64:data.imageUrl;
        meta=data.generation||{requestId,provider:data.source,model:data.model};
      }
      if(!url)throw new Error('No llegó una imagen válida.');
      return {url,meta:{...meta,contract:CONTRACT,construction:constructionOf(options),visualOptions:{...(root.SmylSmileModes?root.SmylSmileModes.normalize(options):{}),shade:options.shade,current:!!options.current,finish:options.finish||'natural',intensity:options.intensity||'balanced',construction:constructionOf(options),materialOnly:!!options.materialOnly,baseShade:options.baseShade||''}}};
    } catch(error) {
      if(error.name==='AbortError')error=new Error('Se agotó la espera. El intento pudo consumir cupo; no se reintentó automáticamente.');
      error.requestId=requestId;throw error;
    } finally {clearTimeout(timer);}
  }
  async function run(context) {
    if(active)throw new Error('Ya hay una simulación en curso.');
    active=true;
    const options = {...context.options, construction:constructionOf(context.options)};
    try {
      await context.authorize();
      const input=await context.prepare();
      let candidate=context.cached;
      if(!candidate) {
        if(context.revalidate)throw new Error('No hay una propuesta de esta modalidad para revisar. No se generó otra.');
        if(root.SmylDentalReview&&!options.materialOnly){
          context.onStatus?.('dental-review');
          options.dentalReview=await root.SmylDentalReview.open(input,options);
          if(!options.dentalReview)throw new Error('Revisión cancelada. No se solicitó una imagen.');
        }
        context.onStatus?.('consent');
        if(!await review({before:input.dataUrl,consent:true,construction:options.construction,options}))throw new Error('Generación cancelada. No se solicitó una imagen.');
        context.onStatus?.('generating');
        candidate=await request({...context,input,options});
        candidate.meta.dentalReview=options.dentalReview||null;
        context.save(candidate);
      }
      let after=await context.compose(candidate.url,input,candidate.meta.visualOptions||{});
      const adjust=context.adjust?async()=>{const url=await context.adjust(candidate.url,input);if(url)after=url;return url;}:null;
      context.onStatus?.('review');
      if(!await review({before:context.original,after,rawBefore:input.dataUrl,rawAfter:candidate.url,construction:constructionOf(candidate.meta),adjust,options:candidate.meta.visualOptions||{}})) {context.discard();throw new Error('Propuesta descartada. La fotografía original sigue intacta; no se generó otra imagen.');}
      context.accept(candidate.meta,after,candidate,input);
      return after;
    } catch(error) {
      error.requestId=error.requestId||context.requestId;
      throw error;
    } finally {active=false;}
  }
  root.SmylVisualSimulation={CONTRACT,prompt,review,run};
})(typeof window==='undefined'?globalThis:window);
