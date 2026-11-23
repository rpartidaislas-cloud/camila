/* SMYL · Hojas de cálculo: arma un archivo .xlsx real (Excel, Numbers, Google Sheets) sin librerías externas.
   Los textos van como texto (una referencia larga no se vuelve notación científica ni una fórmula) y el dinero y las fechas, como números. */
(function(){
  'use strict';
  var MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main',DOC='http://schemas.openxmlformats.org/officeDocument/2006/relationships',PKG='http://schemas.openxmlformats.org/package/2006/relationships',CT='application/vnd.openxmlformats-officedocument.spreadsheetml.',HEAD='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  // Estilos de celda (índices de cellXfs): normal, encabezado, dinero, fecha y hora, fecha (las fechas, alineadas a la izquierda), negritas, dinero en negritas.
  var STYLE={text:0,number:0,head:1,money:2,datetime:3,date:4,bold:5,moneyBold:6},NUMERIC={number:1,money:1,moneyBold:1},DATED={date:1,datetime:1};
  function xml(v){return String(v==null?'':v).slice(0,32767).replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function column(i){var s='';for(i+=1;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;}
  // Excel cuenta los días desde el 30 de diciembre de 1899; se usa la hora local de quien exporta.
  function serial(d,dayOnly){var ms=Date.UTC(d.getFullYear(),d.getMonth(),d.getDate(),dayOnly?0:d.getHours(),dayOnly?0:d.getMinutes(),dayOnly?0:d.getSeconds());return (ms-Date.UTC(1899,11,30))/86400000;}
  function cell(ref,value,type){
    if(value==null||value==='')return '';
    var style=STYLE[type]?' s="'+STYLE[type]+'"':'';
    if(NUMERIC[type]){var n=Number(value);return isFinite(n)?'<c r="'+ref+'"'+style+'><v>'+n+'</v></c>':'';}
    if(DATED[type]){var d=new Date(value);return isNaN(d.getTime())?'':'<c r="'+ref+'"'+style+'><v>'+serial(d,type==='date')+'</v></c>';}
    return '<c r="'+ref+'" t="inlineStr"'+style+'><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
  }
  function sheetName(v,i){var s=String(v||'').replace(/[\\\/?*\[\]:]/g,' ').trim().slice(0,31);return s||'Hoja '+(i+1);}
  function sheetXml(sheet,first){
    var cols=sheet.columns||[],rows=sheet.rows||[],out=['<row r="1">'+cols.map(function(c,i){return cell(column(i)+'1',c.header,'head');}).join('')+'</row>'];
    rows.forEach(function(row,r){var n=r+2;out.push('<row r="'+n+'">'+cols.map(function(c,i){var v=row[i],type=c.type||'text';if(v&&typeof v==='object'&&'value' in v){type=v.type||type;v=v.value;}return cell(column(i)+n,v,type);}).join('')+'</row>');});
    return HEAD+'<worksheet xmlns="'+MAIN+'"><sheetViews><sheetView workbookViewId="0"'+(first?' tabSelected="1"':'')+'><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>'
      +(cols.length?'<cols>'+cols.map(function(c,i){return '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+(Number(c.width)||14)+'" customWidth="1"/>';}).join('')+'</cols>':'')
      +'<sheetData>'+out.join('')+'</sheetData>'+(sheet.filter&&rows.length&&cols.length?'<autoFilter ref="A1:'+column(cols.length-1)+(rows.length+1)+'"/>':'')+'</worksheet>';
  }
  var STYLES=HEAD+'<styleSheet xmlns="'+MAIN+'"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>'
    +'<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
    +'<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF7F5"/><bgColor indexed="64"/></patternFill></fill></fills>'
    +'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    +'<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs>'
    +'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function parts(sheets){
    var names=sheets.map(function(s,i){return sheetName(s.name,i);}),n=sheets.length;
    return [
      {name:'[Content_Types].xml',text:HEAD+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="'+CT+'sheet.main+xml"/>'+sheets.map(function(_,i){return '<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="'+CT+'worksheet+xml"/>';}).join('')+'<Override PartName="/xl/styles.xml" ContentType="'+CT+'styles+xml"/></Types>'},
      {name:'_rels/.rels',text:HEAD+'<Relationships xmlns="'+PKG+'"><Relationship Id="rId1" Type="'+DOC+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',text:HEAD+'<workbook xmlns="'+MAIN+'" xmlns:r="'+DOC+'"><bookViews><workbookView/></bookViews><sheets>'+names.map(function(name,i){return '<sheet name="'+xml(name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>';}).join('')+'</sheets></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',text:HEAD+'<Relationships xmlns="'+PKG+'">'+sheets.map(function(_,i){return '<Relationship Id="rId'+(i+1)+'" Type="'+DOC+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>';}).join('')+'<Relationship Id="rId'+(n+1)+'" Type="'+DOC+'/styles" Target="styles.xml"/></Relationships>'},
      {name:'xl/styles.xml',text:STYLES}
    ].concat(sheets.map(function(s,i){return {name:'xl/worksheets/sheet'+(i+1)+'.xml',text:sheetXml(s,i===0)};}));
  }
  // El .xlsx es un ZIP. Se comprime si el navegador puede; si no, los archivos van sin comprimir (igual de válido, solo más pesado).
  var CRC=(function(){var t=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
  function crc32(bytes){var c=0xFFFFFFFF;for(var i=0;i<bytes.length;i++)c=CRC[(c^bytes[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
  async function deflate(bytes){try{if(typeof CompressionStream!=='function')return null;return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());}catch(_){return null;}}
  async function zip(files){
    var enc=new TextEncoder(),body=[],central=[],offset=0,now=new Date(),time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),day=((Math.max(1980,now.getFullYear())-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
    for(var i=0;i<files.length;i++){
      var name=enc.encode(files[i].name),raw=enc.encode(files[i].text),packed=await deflate(raw),method=packed&&packed.length<raw.length?8:0,data=method?packed:raw,crc=crc32(raw);
      var local=new DataView(new ArrayBuffer(30));local.setUint32(0,0x04034b50,true);local.setUint16(4,20,true);local.setUint16(8,method,true);local.setUint16(10,time,true);local.setUint16(12,day,true);local.setUint32(14,crc,true);local.setUint32(18,data.length,true);local.setUint32(22,raw.length,true);local.setUint16(26,name.length,true);
      var entry=new DataView(new ArrayBuffer(46));entry.setUint32(0,0x02014b50,true);entry.setUint16(4,20,true);entry.setUint16(6,20,true);entry.setUint16(10,method,true);entry.setUint16(12,time,true);entry.setUint16(14,day,true);entry.setUint32(16,crc,true);entry.setUint32(20,data.length,true);entry.setUint32(24,raw.length,true);entry.setUint16(28,name.length,true);entry.setUint32(42,offset,true);
      body.push(new Uint8Array(local.buffer),name,data);central.push(new Uint8Array(entry.buffer),name);offset+=30+name.length+data.length;
    }
    var size=central.reduce(function(s,b){return s+b.length;},0),end=new DataView(new ArrayBuffer(22));end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,size,true);end.setUint32(16,offset,true);
    var all=body.concat(central,[new Uint8Array(end.buffer)]),out=new Uint8Array(offset+size+22),at=0;all.forEach(function(b){out.set(b,at);at+=b.length;});return out;
  }
  // sheets: [{name, filter, columns:[{header,width,type}], rows:[[valor | {value,type}]]}] · type: text, number, money, date, datetime, bold, moneyBold.
  function build(sheets){return zip(parts(sheets&&sheets.length?sheets:[{name:'Hoja 1',columns:[],rows:[]}]));}
  async function download(filename,sheets){
    var bytes=await build(sheets),url=URL.createObjectURL(new Blob([bytes],{type:CT+'sheet'})),a=document.createElement('a');
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},4000);return bytes.length;
  }
  window.SmylXlsx=Object.freeze({build:build,download:download});
})();
