/* SMYL · Historia clínica: modelo puro.
 * Todo lo que decide qué dice la historia (normalizar registros, estados, cobertura, armar el documento que se guarda y el modelo
 * de la vista de lectura) vive aquí, sin DOM ni red, para poder probarlo en Node. smyl-patient-360.js solo dibuja y conecta.
 * Fuente única de los nombres de campo de los registros: el editor los dibuja con inputName() y el guardado los lee con la misma
 * función; así un campo no puede dibujarse con un nombre y leerse con otro (la fecha de una cirugía se perdía por eso). */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylHistoryModel=api;})(globalThis,function(){
  'use strict';
  var MAX_RECORDS=20,MAX_ALERTS=40;
  var STATUSES=['yes','no','unknown','pending'];
  /* Los cuatro registros con detalle: clave del documento, campo obligatorio y columnas, en el orden en que se guardan. */
  var RECORD_KINDS={
    allergy:{records:'allergy_records',primary:'substance',fields:['substance','reaction','severity']},
    condition:{records:'condition_records',primary:'name',fields:['name','diagnosed_at','status']},
    medication:{records:'medication_records',primary:'name',fields:['name','dose','frequency','changed_at']},
    surgery:{records:'surgery_records',primary:'procedure',fields:['procedure','date']}
  };
  function inputName(kind,field){return kind+'_'+field;}
  function arr(v){return Array.isArray(v)?v:[];}
  function text(v){return String(v==null?'':v).trim();}
  function csv(v){return String(v||'').split(',').map(function(x){return x.trim();}).filter(Boolean).slice(0,MAX_ALERTS);}
  function date(v){
    var value=text(v);if(!value)return '';
    var monthOnly=/^\d{4}-\d{2}$/.test(value),parsed=new Date(monthOnly?value+'-01T12:00:00':/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00':value);
    if(Number.isNaN(parsed.getTime()))return value;
    return new Intl.DateTimeFormat('es-MX',monthOnly?{month:'long',year:'numeric'}:{day:'numeric',month:'short',year:'numeric'}).format(parsed);
  }
  function defaultHistory(){return {alerts:[],alerts_status:'pending',allergies:[],allergies_status:'pending',allergy_records:[],conditions:[],conditions_status:'pending',condition_records:[],conditions_since:'',medications:[],medications_status:'pending',medication_records:[],medications_changed_at:'',surgeries:'',surgeries_status:'pending',surgery_records:[],surgery_date:'',dental_history:'',dental_status:'pending',last_dental_visit:'',habits:'',habits_status:'pending',emergency_contact:'',notes:''};}

  /* Registros con detalle. Si el documento solo trae las listas antiguas (allergies, conditions, ...) se reconstruyen desde ellas. */
  function records(d,key,legacy){
    var rows=arr(d[key]).filter(function(row){return row&&typeof row==='object';}).map(function(row){var copy={};Object.keys(row).forEach(function(name){copy[name]=String(row[name]||'').trim();});return copy;}).filter(function(row){return Object.keys(row).some(function(name){return row[name];});});
    if(rows.length)return rows;
    if(key==='allergy_records')return arr(d.allergies).map(function(value){return {substance:text(value),reaction:'',severity:''};}).filter(function(row){return row.substance;});
    if(key==='condition_records')return arr(d.conditions).map(function(value,index){return {name:text(value),diagnosed_at:index===0?String(d.conditions_since||''):'',status:''};}).filter(function(row){return row.name;});
    if(key==='medication_records')return arr(d.medications).map(function(value,index){return {name:text(value),dose:'',frequency:'',changed_at:index===0?String(d.medications_changed_at||''):''};}).filter(function(row){return row.name;});
    if(key==='surgery_records'&&text(d.surgeries))return [{procedure:text(d.surgeries),date:String(d.surgery_date||'')}];
    return arr(legacy);
  }
  function recordsOf(d,kind){return records(d,RECORD_KINDS[kind].records);}

  var SEVERITY={low:'Baja',moderate:'Moderada',high:'Alta'},CONDITION_STATUS={active:'Activa',controlled:'Controlada',resolved:'Resuelta',unknown:'Por confirmar'};
  function severityLabel(value){return SEVERITY[value]||'';}
  function conditionStatusLabel(value){return CONDITION_STATUS[value]||'';}
  var summaries={
    allergy:function(row){return [row.substance,row.reaction?'Reacción: '+row.reaction:'',severityLabel(row.severity)?'Gravedad: '+severityLabel(row.severity):''].filter(Boolean).join(' · ');},
    condition:function(row){return [row.name,date(row.diagnosed_at),conditionStatusLabel(row.status)].filter(Boolean).join(' · ');},
    medication:function(row){return [row.name,row.dose,row.frequency,date(row.changed_at)].filter(Boolean).join(' · ');},
    surgery:function(row){return [row.procedure,date(row.date)].filter(Boolean).join(' · ');}
  };

  /* Estado de cada apartado: con datos siempre es "yes"; sin datos vale lo guardado o "pending". */
  function status(d,key,hasData){var value=String(d&&d[key]||'');if(hasData)return 'yes';return STATUSES.indexOf(value)>=0?value:'pending';}
  function statusText(value){return ({yes:'Sí, falta detalle',no:'No, confirmado',unknown:'No se sabe',pending:'Pendiente de confirmar'})[value]||'Pendiente de confirmar';}
  function needsDetail(d,key,hasData){var s=status(d,key,hasData);return s==='pending'||(s==='yes'&&!hasData);}
  function reviewed(d,key,hasData){var s=status(d,key,hasData);return ['pending','unknown'].indexOf(s)<0&&!(s==='yes'&&!hasData);}

  /* Las seis secciones clínicas que cuentan para "N de 6" (contacto de emergencia y notas no cuentan). */
  function checks(d){return [
    ['Alergias','allergies_status',recordsOf(d,'allergy').length],
    ['Condiciones','conditions_status',recordsOf(d,'condition').length],
    ['Medicamentos','medications_status',recordsOf(d,'medication').length],
    ['Cirugías','surgeries_status',recordsOf(d,'surgery').length||(d.surgeries?1:0)],
    ['Dental','dental_status',d.dental_history||d.last_dental_visit],
    ['Hábitos','habits_status',d.habits]
  ];}
  function pendingLabels(d){return checks(d).filter(function(check){return !reviewed(d,check[1],check[2]);}).map(function(check){return check[0];});}
  function coverage(d){return checks(d).length-pendingLabels(d).length;}
  /* Qué falta confirmar para la prioridad del Resumen (cirugías y hábitos no bloquean la prioridad). */
  function missing(d){
    var out=[];
    [['alergias','allergies_status',recordsOf(d,'allergy').length],['condiciones médicas','conditions_status',recordsOf(d,'condition').length],['medicamentos','medications_status',recordsOf(d,'medication').length],['antecedentes dentales','dental_status',d.dental_history||d.last_dental_visit]].forEach(function(item){if(needsDetail(d,item[1],item[2]))out.push(item[0]);});
    return out;
  }
  function conciseValue(d,key,statusKey,emptyLabel){
    var values=arr(d[key]).map(text).filter(Boolean);if(values.length)return values.join(', ');
    var s=status(d,statusKey,false);if(s==='no')return emptyLabel;if(s==='unknown')return 'No se sabe';return 'Por confirmar';
  }

  /* Guardado: lee un FormData (o algo con get/getAll) y arma el documento que se envía. Mantiene las listas antiguas por compatibilidad. */
  function formRecords(f,kind){
    var spec=RECORD_KINDS[kind],columns={},length=0,rows=[];
    spec.fields.forEach(function(field){columns[field]=f.getAll(inputName(kind,field)+'[]');length=Math.max(length,columns[field].length);});
    for(var index=0;index<length&&rows.length<MAX_RECORDS;index++){
      var row={};spec.fields.forEach(function(field){row[field]=String(columns[field][index]||'').trim();});
      if(row[spec.primary])rows.push(row);
    }
    return rows;
  }
  function formStatus(f,block,hasData){var value=String(f.get(block+'_status')||'pending');return hasData?'yes':(STATUSES.indexOf(value)>=0?value:'pending');}
  function buildDocument(f){
    var alerts=csv(f.get('alerts')),allergy=formRecords(f,'allergy'),condition=formRecords(f,'condition'),medication=formRecords(f,'medication'),surgery=formRecords(f,'surgery');
    var dentalHistory=text(f.get('dental_history')),lastDentalVisit=text(f.get('last_dental_visit')),habits=text(f.get('habits'));
    function first(rows,field){return (rows.find(function(row){return row[field];})||{})[field]||'';}
    return {
      alerts:alerts,alerts_status:formStatus(f,'alerts',alerts.length),
      allergy_records:allergy,allergies_status:formStatus(f,'allergies',allergy.length),allergies:allergy.map(function(row){return row.substance;}),
      condition_records:condition,conditions_status:formStatus(f,'conditions',condition.length),conditions:condition.map(function(row){return row.name;}),conditions_since:first(condition,'diagnosed_at'),
      medication_records:medication,medications_status:formStatus(f,'medications',medication.length),medications:medication.map(function(row){return row.name;}),medications_changed_at:first(medication,'changed_at'),
      surgery_records:surgery,surgeries_status:formStatus(f,'surgeries',surgery.length),surgeries:surgery.map(function(row){return row.procedure;}).join('; '),surgery_date:first(surgery,'date'),
      dental_history:dentalHistory,dental_status:formStatus(f,'dental',dentalHistory||lastDentalVisit),last_dental_visit:lastDentalVisit,
      habits:habits,habits_status:formStatus(f,'habits',habits),
      emergency_contact:text(f.get('emergency_contact')),notes:text(f.get('notes'))
    };
  }

  /* Vista de lectura: cinco secciones con filas etiqueta / valor / estado, que smyl-history-read.js dibuja. */
  function pendingText(s){return s==='unknown'?'El paciente no lo sabe':s==='yes'?'Marcado como "Sí": falta registrar el detalle':'Aún no se ha confirmado con el paciente';}
  function recordRow(label,rows,summary,s){
    if(rows.length)return {label:label,lines:rows.map(summary),state:'records',badge:rows.length+(rows.length===1?' registro':' registros')};
    if(s==='no')return {label:label,text:'No, confirmado',state:'ok',badge:'Ninguno confirmado'};
    return {label:label,text:pendingText(s),state:'pending',badge:'Por confirmar'};
  }
  function textRow(label,value,s){
    var content=text(value);
    if(content)return {label:label,lines:[content],state:'ok',badge:'Confirmado'};
    if(s==='no')return {label:label,text:'No, confirmado',state:'ok',badge:'Ninguno confirmado'};
    return {label:label,text:pendingText(s),state:'pending',badge:'Por confirmar'};
  }
  function sectionState(rows){return rows.some(function(row){return row.state==='pending';})?'pending':'ok';}
  function readModel(d,meta){
    meta=meta||{};
    var alerts=arr(d.alerts).map(text).filter(Boolean),allergies=recordsOf(d,'allergy'),conditions=recordsOf(d,'condition'),medications=recordsOf(d,'medication'),surgeries=recordsOf(d,'surgery');
    var alertsStatus=status(d,'alerts_status',alerts.length),allergiesStatus=status(d,'allergies_status',allergies.length);
    var allergyRow=recordRow('Alergias',allergies,summaries.allergy,allergiesStatus);
    if(allergies.length){allergyRow.state='alert';if(allergies.some(function(row){return row.severity==='high';}))allergyRow.badge='Grave';}
    var alertRow=alerts.length?{label:'Alertas médicas',lines:alerts,state:'alert',badge:'Alerta'}:alertsStatus==='no'?{label:'Alertas médicas',text:'Ninguna confirmada',state:'ok',badge:'Ninguna confirmada'}:{label:'Alertas médicas',text:pendingText(alertsStatus),state:'pending',badge:'Por confirmar'};
    var count=alerts.length+allergies.length,unconfirmed=['pending','unknown','yes'];
    var pending=!count&&(unconfirmed.indexOf(alertsStatus)>=0||unconfirmed.indexOf(allergiesStatus)>=0),safetyState=count?'alert':pending?'pending':'ok';
    var safetyCopy=count?'Lo que puede cambiar la atención. Revisar antes de atender.':pending?'Alertas por confirmar: confírmalas antes de procedimientos.':'Sin alertas conocidas. Estado confirmado en esta versión.';
    var medical=[recordRow('Condiciones médicas',conditions,summaries.condition,status(d,'conditions_status',conditions.length)),recordRow('Medicamentos actuales',medications,summaries.medication,status(d,'medications_status',medications.length)),recordRow('Cirugías y hospitalizaciones',surgeries,summaries.surgery,status(d,'surgeries_status',surgeries.length))];
    var visit=date(d.last_dental_visit);
    var dental=[textRow('Antecedentes dentales',d.dental_history,status(d,'dental_status',d.dental_history||d.last_dental_visit)),visit?{label:'Última visita dental',text:visit,state:'ok',badge:'Confirmado'}:{label:'Última visita dental',text:'Sin fecha registrada',state:'empty',badge:''}];
    var habits=[textRow('Hábitos relevantes',d.habits,status(d,'habits_status',d.habits))];
    var admin=[{label:'Contacto de emergencia',text:text(d.emergency_contact)||'Sin registrar',state:'empty',badge:''},{label:'Notas adicionales',text:text(d.notes)||'Sin registrar',state:'empty',badge:''}];
    return {updated:meta.updated,revision:meta.revision,canWrite:!!meta.canWrite,coverage:{done:coverage(d),total:checks(d).length,pending:pendingLabels(d)},sections:[
      {key:'safety',step:0,title:'Seguridad clínica',copy:safetyCopy,state:safetyState,rows:[allergyRow,alertRow]},
      {key:'medical',step:1,title:'Salud médica',copy:'Condiciones, medicamentos y cirugías.',state:sectionState(medical),rows:medical},
      {key:'dental',step:2,title:'Antecedentes dentales',copy:'Tratamientos previos y última visita.',state:sectionState(dental),rows:dental},
      {key:'habits',step:3,title:'Hábitos y factores de riesgo',copy:'Contexto referido por el paciente.',state:sectionState(habits),rows:habits},
      {key:'admin',step:4,title:'Contacto y notas',copy:'Datos de apoyo, no clínicos.',state:'neutral',rows:admin}]};
  }

  /* Historial de cambios: qué cambió entre dos versiones del documento, en frases que lee una persona. */
  var VERSION_LIMIT=30;
  var KIND_WORDS={allergy:['Alergia',true],condition:['Condición',true],medication:['Medicamento',false],surgery:['Cirugía',true]};
  var KIND_SECTION={allergy:'safety',condition:'medical',medication:'medical',surgery:'medical'};
  var FIELD_WORDS={
    allergy:{reaction:['reacción'],severity:['gravedad',severityLabel]},
    condition:{diagnosed_at:['fecha de diagnóstico',date],status:['estado',conditionStatusLabel]},
    medication:{dose:['dosis'],frequency:['frecuencia'],changed_at:['inicio o ajuste',date]},
    surgery:{date:['fecha',date]}
  };
  var SIMPLE_FIELDS=[
    {key:'dental_history',label:'Antecedentes dentales',section:'dental'},
    {key:'last_dental_visit',label:'Última visita dental',section:'dental',format:date},
    {key:'habits',label:'Hábitos',section:'habits'},
    {key:'emergency_contact',label:'Contacto de emergencia',section:'admin'},
    {key:'notes',label:'Notas adicionales',section:'admin'}
  ];
  var SECTION_ORDER=['safety','medical','dental','habits','admin'];
  var STATUS_PHRASE={no:'confirmado que no hay',unknown:'marcado como "No se sabe"',pending:'vuelto a pendiente de confirmar',yes:'marcado como "Sí", falta el detalle'};
  function clip(v,n){var t=text(v);return t.length>n?t.slice(0,n-1)+'…':t;}
  function shown(value,format){var t=text(value);return t?(format?format(t):t):'sin dato';}
  function withDefaults(doc){return Object.assign({},defaultHistory(),doc&&typeof doc==='object'?doc:{});}
  function recordChanges(kind,before,after){
    var spec=RECORD_KINDS[kind],word=KIND_WORDS[kind],ending=word[1]?'a':'o',out=[];
    function key(row){return text(row[spec.primary]).toLowerCase();}
    var was={},now={};before.forEach(function(row){was[key(row)]=row;});after.forEach(function(row){now[key(row)]=row;});
    after.forEach(function(row){
      var old=was[key(row)];
      if(!old){out.push({section:KIND_SECTION[kind],kind:'added',text:word[0]+' agregad'+ending+': '+summaries[kind](row)});return;}
      var parts=[];
      spec.fields.forEach(function(field){
        if(field===spec.primary||text(old[field])===text(row[field]))return;
        var def=FIELD_WORDS[kind][field]||[field];
        parts.push(def[0]+' '+shown(old[field],def[1])+' → '+shown(row[field],def[1]));
      });
      if(parts.length)out.push({section:KIND_SECTION[kind],kind:'changed',text:text(row[spec.primary])+': '+parts.join('; ')});
    });
    before.forEach(function(row){if(!now[key(row)])out.push({section:KIND_SECTION[kind],kind:'removed',text:word[0]+' quitad'+ending+': '+summaries[kind](row)});});
    return out;
  }
  function statusChange(section,label,a,b,hasBefore,hasAfter,keyName){
    if(hasAfter)return null;
    var before=status(a,keyName,hasBefore),after=status(b,keyName,false);
    if(before===after)return null;
    return {section:section,kind:'confirmed',text:label+': '+STATUS_PHRASE[after]};
  }
  /* Devuelve [{section, kind: added|removed|changed|confirmed, text}] ordenado por sección. prev puede ser null (primera versión). */
  function diff(prev,next){
    var a=withDefaults(prev),b=withDefaults(next),out=[],status2=[];
    var alertsA=arr(a.alerts).map(text).filter(Boolean),alertsB=arr(b.alerts).map(text).filter(Boolean);
    alertsB.forEach(function(item){if(alertsA.map(function(x){return x.toLowerCase();}).indexOf(item.toLowerCase())<0)out.push({section:'safety',kind:'added',text:'Alerta agregada: '+item});});
    alertsA.forEach(function(item){if(alertsB.map(function(x){return x.toLowerCase();}).indexOf(item.toLowerCase())<0)out.push({section:'safety',kind:'removed',text:'Alerta quitada: '+item});});
    Object.keys(RECORD_KINDS).forEach(function(kind){out=out.concat(recordChanges(kind,recordsOf(a,kind),recordsOf(b,kind)));});
    SIMPLE_FIELDS.forEach(function(field){
      var before=text(a[field.key]),after=text(b[field.key]);
      if(before===after)return;
      var f=field.format;
      if(!before)out.push({section:field.section,kind:'added',text:field.label+': se agregó "'+clip(f?f(after):after,80)+'"'});
      else if(!after)out.push({section:field.section,kind:'removed',text:field.label+': se quitó "'+clip(f?f(before):before,80)+'"'});
      else out.push({section:field.section,kind:'changed',text:field.label+': "'+clip(f?f(before):before,60)+'" → "'+clip(f?f(after):after,60)+'"'});
    });
    [['safety','Alertas médicas','alerts_status',alertsA.length,alertsB.length],
     ['safety','Alergias','allergies_status',recordsOf(a,'allergy').length,recordsOf(b,'allergy').length],
     ['medical','Condiciones','conditions_status',recordsOf(a,'condition').length,recordsOf(b,'condition').length],
     ['medical','Medicamentos','medications_status',recordsOf(a,'medication').length,recordsOf(b,'medication').length],
     ['medical','Cirugías','surgeries_status',recordsOf(a,'surgery').length,recordsOf(b,'surgery').length],
     ['dental','Antecedentes dentales','dental_status',a.dental_history||a.last_dental_visit?1:0,b.dental_history||b.last_dental_visit?1:0],
     ['habits','Hábitos','habits_status',a.habits?1:0,b.habits?1:0]
    ].forEach(function(item){var change=statusChange(item[0],item[1],a,b,item[3],item[4],item[2]);if(change)status2.push(change);});
    out=out.concat(status2);
    return out.map(function(change,index){return {change:change,index:index};}).sort(function(x,y){return SECTION_ORDER.indexOf(x.change.section)-SECTION_ORDER.indexOf(y.change.section)||x.index-y.index;}).map(function(item){return item.change;});
  }
  /* rows: versiones guardadas (cualquier orden). Se compara cada una con la anterior; pide limit+1 filas para poder comparar la última mostrada. */
  function versionEntries(rows,options){
    var limit=(options&&options.limit)||VERSION_LIMIT,sorted=arr(rows).slice().sort(function(x,y){return y.revision-x.revision;});
    return sorted.slice(0,limit).map(function(row,index){
      var older=sorted[index+1],comparable=older&&older.revision===row.revision-1,first=row.revision===1;
      return {revision:row.revision,updated_at:row.updated_at,updated_by:row.updated_by,isFirst:first,
        changes:comparable?diff(older.document,row.document):first?diff(null,row.document):null};
    });
  }

  return {RECORD_KINDS:RECORD_KINDS,MAX_RECORDS:MAX_RECORDS,inputName:inputName,arr:arr,csv:csv,date:date,defaultHistory:defaultHistory,records:records,recordsOf:recordsOf,
    severityLabel:severityLabel,conditionStatusLabel:conditionStatusLabel,summaries:summaries,status:status,statusText:statusText,needsDetail:needsDetail,reviewed:reviewed,
    pendingLabels:pendingLabels,coverage:coverage,missing:missing,conciseValue:conciseValue,formRecords:formRecords,formStatus:formStatus,buildDocument:buildDocument,readModel:readModel,diff:diff,versionEntries:versionEntries,VERSION_LIMIT:VERSION_LIMIT};
});
