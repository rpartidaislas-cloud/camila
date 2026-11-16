/* SMYL · Historia clínica por preguntas: lógica pura (sin DOM ni red).
 * La entrevista responde una pregunta a la vez, pero NO inventa otro formato: el documento que se guarda lo arma el mismo
 * modelo del editor (SmylHistoryModel.buildDocument), así que tiene exactamente la misma forma y las mismas reglas.
 * El borrador vive solo en memoria; el único guardado es el canónico (smyl_save_patient_history, con control de revisión). */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylHistoryInterview=api;})(globalThis,function(){
  'use strict';
  var STATUS_NO='no',STATUS_YES='yes',STATUS_UNKNOWN='unknown',STATUS_PENDING='pending';
  /* Orden de seguridad: primero lo que cambia lo que se puede hacer hoy. `kind`: record (con detalle), alert (texto corto), text (texto libre). */
  var QUESTIONS=[
    {key:'allergies',block:'allergies',kind:'record',record:'allergy',label:'Alergias',safety:true,title:'¿Es alérgico a algún medicamento, material o al látex?',hint:'Es lo primero que se pregunta: cambia lo que puedes usar hoy.',add:'Agregar otra alergia',primaryLabel:'Alergia a',primaryHint:'Ej. penicilina'},
    {key:'alerts',block:'alerts',kind:'alert',label:'Alertas médicas',safety:true,title:'¿Hay algo que deba saberse antes de atender?',hint:'Por ejemplo embarazo, anticoagulantes, marcapasos o una cirugía reciente.',add:'Agregar otra alerta',primaryLabel:'Qué debe saberse',primaryHint:'Ej. toma anticoagulantes'},
    {key:'conditions',block:'conditions',kind:'record',record:'condition',label:'Condiciones médicas',title:'¿Tiene alguna condición médica?',hint:'Diabetes, hipertensión, del corazón u otras.',add:'Agregar otra condición',primaryLabel:'Condición',primaryHint:'Ej. hipertensión'},
    {key:'medications',block:'medications',kind:'record',record:'medication',label:'Medicamentos',title:'¿Toma algún medicamento actualmente?',hint:'',add:'Agregar otro medicamento',primaryLabel:'Medicamento',primaryHint:'Ej. losartán'},
    {key:'surgeries',block:'surgeries',kind:'record',record:'surgery',label:'Cirugías',title:'¿Le han hecho alguna cirugía u hospitalización?',hint:'',add:'Agregar otra',primaryLabel:'Cirugía u hospitalización',primaryHint:'Ej. apendicectomía'},
    {key:'dental',block:'dental',kind:'text',textField:'dental_history',label:'Antecedentes dentales',title:'¿Qué tratamientos dentales ha tenido antes?',hint:'Ortodoncia, endodoncias, extracciones u otros.',primaryLabel:'Tratamientos previos',primaryHint:'Ej. ortodoncia hace 5 años'},
    {key:'habits',block:'habits',kind:'text',textField:'habits',label:'Hábitos',title:'¿Tiene algún hábito que afecte sus dientes?',hint:'Por ejemplo rechinar los dientes, fumar o morderse las uñas.',primaryLabel:'Hábito',primaryHint:'Ej. rechina los dientes'}
  ];
  function question(key){return QUESTIONS.filter(function(q){return q.key===key;})[0]||null;}
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function text(v){return String(v==null?'':v).trim();}
  /* Una alerta es un texto corto; las comas separan alertas en el editor, así que aquí se evitan. */
  function plainAlert(v){return text(v).replace(/\s*,\s*/g,' ');}
  function blankRow(H,record){var row={};H.RECORD_KINDS[record].fields.forEach(function(f){row[f]='';});return row;}
  function rowsOf(H,doc,record){return H.recordsOf(doc,record).map(function(row){return Object.assign(blankRow(H,record),row);});}
  function statusOf(H,doc,block,hasData){return H.status(doc,block+'_status',hasData);}

  /* Borrador a partir de la historia vigente (o vacía). Lo que ya está registrado se conserva tal cual, con todos sus campos. */
  function create(doc,H){
    var d=Object.assign(H.defaultHistory(),clone(doc||{})),answers={};
    answers.allergies={status:statusOf(H,d,'allergies',H.recordsOf(d,'allergy').length>0),rows:rowsOf(H,d,'allergy')};
    answers.alerts={status:statusOf(H,d,'alerts',H.arr(d.alerts).length>0),rows:H.arr(d.alerts).map(text).filter(Boolean).map(function(t){return {text:t};})};
    answers.conditions={status:statusOf(H,d,'conditions',H.recordsOf(d,'condition').length>0),rows:rowsOf(H,d,'condition')};
    answers.medications={status:statusOf(H,d,'medications',H.recordsOf(d,'medication').length>0),rows:rowsOf(H,d,'medication')};
    answers.surgeries={status:statusOf(H,d,'surgeries',H.recordsOf(d,'surgery').length>0),rows:rowsOf(H,d,'surgery')};
    answers.dental={status:statusOf(H,d,'dental',!!(text(d.dental_history)||text(d.last_dental_visit))),text:text(d.dental_history)};
    answers.habits={status:statusOf(H,d,'habits',!!text(d.habits)),text:text(d.habits)};
    return {H:H,base:d,answers:answers};
  }
  function primaryOf(H,q,row){return q.kind==='alert'?text(row.text):text(row[H.RECORD_KINDS[q.record].primary]);}

  /* Secciones que aún no están confirmadas (las que conviene preguntar). */
  function pendingKeys(doc,H){
    var d=Object.assign(H.defaultHistory(),clone(doc||{})),labels=H.pendingLabels(d),map={'Alergias':'allergies','Condiciones':'conditions','Medicamentos':'medications','Cirugías':'surgeries','Dental':'dental','Hábitos':'habits'};
    var keys=labels.map(function(l){return map[l];}).filter(Boolean);
    var alerts=H.arr(d.alerts).length?'ok':statusOf(H,d,'alerts',false);
    if(alerts==='pending'||alerts==='unknown'||alerts==='yes')keys.push('alerts');
    return QUESTIONS.map(function(q){return q.key;}).filter(function(k){return keys.indexOf(k)>=0;});
  }

  /* Reductores: devuelven un borrador nuevo; nunca modifican el anterior. */
  function update(draft,key,fn){var next={H:draft.H,base:draft.base,answers:clone(draft.answers)};fn(next.answers[key],question(key),draft.H);return next;}
  function setStatus(draft,key,status){
    return update(draft,key,function(a,q){
      if(a.rows&&a.rows.length&&status!==STATUS_YES)return;         // lo ya registrado no se borra por accidente: se quita fila por fila
      if(q.kind==='text'&&text(a.text)&&status!==STATUS_YES)return;
      a.status=status;
      if(status===STATUS_YES&&a.rows&&!a.rows.length)a.rows.push(q.kind==='alert'?{text:''}:blankRow(draft.H,q.record));
    });
  }
  function addRow(draft,key){return update(draft,key,function(a,q,H){if(a.rows.length>=H.MAX_RECORDS)return;a.rows.push(q.kind==='alert'?{text:''}:blankRow(H,q.record));a.status=STATUS_YES;});}
  function setField(draft,key,index,field,value){return update(draft,key,function(a){if(a.rows[index])a.rows[index][field]=String(value==null?'':value);});}
  function removeRow(draft,key,index){return update(draft,key,function(a){a.rows.splice(index,1);if(!a.rows.length)a.status=STATUS_PENDING;});}
  function setText(draft,key,value){return update(draft,key,function(a){a.text=String(value==null?'':value);a.status=text(value)?STATUS_YES:(a.status===STATUS_YES?STATUS_PENDING:a.status);});}

  function filled(H,q,a){return q.kind==='text'?!!text(a.text):a.rows.some(function(r){return primaryOf(H,q,r);});}
  /* ¿Ya se respondió? «No» y «No se sabe» sí; «Sí» solo si dice cuál. */
  function isAnswered(draft,key){
    var q=question(key),a=draft.answers[key];
    if(a.status===STATUS_NO||a.status===STATUS_UNKNOWN)return true;
    return filled(draft.H,q,a);
  }
  /* Problemas que impiden guardar: «Sí» sin decir cuál, o una sección sin responder que el usuario eligió contestar. */
  function problems(draft){
    return QUESTIONS.filter(function(q){var a=draft.answers[q.key];return a.status===STATUS_YES&&!filled(draft.H,q,a);}).map(function(q){return {key:q.key,message:q.kind==='text'?'Escribe qué respondió, o cambia a «No».':'Escribe cuál, o cambia a «No».'};});
  }

  /* Documento a guardar: lo arma el modelo del editor con lo que la persona respondió. */
  function toDocument(draft){
    var H=draft.H,A=draft.answers,base=draft.base,values={},lists={};
    function put(name,v){values[name]=v;}
    ['allergy','condition','medication','surgery'].forEach(function(record){
      var key={allergy:'allergies',condition:'conditions',medication:'medications',surgery:'surgeries'}[record];
      H.RECORD_KINDS[record].fields.forEach(function(f){lists[H.inputName(record,f)+'[]']=A[key].rows.map(function(r){return r[f]||'';});});
    });
    put('alerts',A.alerts.rows.map(function(r){return plainAlert(r.text);}).filter(Boolean).join(', '));
    put('dental_history',A.dental.text);put('last_dental_visit',base.last_dental_visit||'');put('habits',A.habits.text);
    put('emergency_contact',base.emergency_contact||'');put('notes',base.notes||'');
    QUESTIONS.forEach(function(q){put(q.block+'_status',A[q.key].status);});
    return H.buildDocument({get:function(name){return values[name]==null?null:values[name];},getAll:function(name){return lists[name]||[];}});
  }

  /* Texto de una respuesta para la pantalla de revisión. */
  function summary(draft,key){
    var H=draft.H,q=question(key),a=draft.answers[key];
    if(q.kind==='text')return text(a.text)?[text(a.text)]:[a.status===STATUS_NO?'No':a.status===STATUS_UNKNOWN?'No se sabe':'Sin responder'];
    var rows=a.rows.filter(function(r){return primaryOf(H,q,r);});
    if(rows.length)return rows.map(function(r){return q.kind==='alert'?text(r.text):[primaryOf(H,q,r),r.reaction?'reacción: '+r.reaction:'',r.dose,r.frequency].filter(Boolean).join(', ');});
    return [a.status===STATUS_NO?'No':a.status===STATUS_UNKNOWN?'No se sabe':'Sin responder'];
  }
  function isDirty(draft,doc){
    var before=draft.H.buildDocument(formOf(draft.H,doc?Object.assign(draft.H.defaultHistory(),clone(doc)):draft.H.defaultHistory())),after=toDocument(draft);
    return JSON.stringify(before)!==JSON.stringify(after);
  }
  /* Inverso de buildDocument: documento → objeto con get/getAll (se usa para comparar, no para guardar). */
  function formOf(H,d){
    var values={},lists={};
    ['allergy','condition','medication','surgery'].forEach(function(record){H.RECORD_KINDS[record].fields.forEach(function(f){lists[H.inputName(record,f)+'[]']=H.recordsOf(d,record).map(function(r){return r[f]||'';});});});
    values.alerts=H.arr(d.alerts).join(', ');values.dental_history=d.dental_history||'';values.last_dental_visit=d.last_dental_visit||'';values.habits=d.habits||'';values.emergency_contact=d.emergency_contact||'';values.notes=d.notes||'';
    ['alerts','allergies','conditions','medications','surgeries','dental','habits'].forEach(function(b){values[b+'_status']=d[b+'_status'];});
    return {get:function(n){return values[n]==null?null:values[n];},getAll:function(n){return lists[n]||[];}};
  }
  return {QUESTIONS:QUESTIONS,question:question,create:create,pendingKeys:pendingKeys,setStatus:setStatus,addRow:addRow,setField:setField,removeRow:removeRow,setText:setText,isAnswered:isAnswered,problems:problems,toDocument:toDocument,summary:summary,isDirty:isDirty,formOf:formOf};
});
