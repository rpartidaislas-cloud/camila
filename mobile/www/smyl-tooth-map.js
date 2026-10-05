/* Reusable view of the existing schematic adult odontogram. Not an anatomical detector. */
(function(){
 'use strict';
 const upper=[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],lower=[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
 const positions=[[235,64,-5,42,40],[191,74,-20,36,38],[156,100,-38,37,42],[133,141,-65,40,43],[123,187,-80,42,45],[120,240,-88,50,51],[121,296,-90,49,49],[125,348,-92,45,47]];
 // Same original silhouettes as smyl-dental-record.js, preserved for visual continuity.
 const shapes={
  incisor:['M12 9 Q30 4 48 9 Q53 13 50 26 L45 47 Q42 53 30 54 Q18 53 15 47 L10 26 Q7 13 12 9Z','M15 17 Q30 12 45 17 M19 42 Q30 48 41 42'],
  canine:['M30 5 Q39 7 47 17 Q53 27 47 43 Q42 54 30 56 Q18 54 13 43 Q7 27 13 17 Q21 7 30 5Z','M18 22 L30 13 L42 22 M19 43 Q30 49 41 43'],
  premolar:['M16 7 Q24 4 30 8 Q39 3 46 11 Q54 20 50 32 Q53 44 43 51 Q35 57 28 52 Q17 56 11 44 Q5 32 10 20 Q9 12 16 7Z','M17 18 Q25 12 30 20 Q37 12 44 20 M17 41 Q24 48 30 40 Q36 48 43 39'],
  molar:['M12 8 Q22 3 30 8 Q40 3 49 12 Q55 19 51 30 Q56 40 48 49 Q40 57 30 52 Q20 57 11 49 Q4 41 8 30 Q3 18 12 8Z','M16 17 Q23 12 29 19 L35 15 Q42 12 46 21 M14 39 Q20 47 28 41 L34 45 Q42 48 46 39 M12 29 L19 30 M42 30 L49 28']
 };
 function render(host,{state=()=>({}),onSelect=()=>{},disabled=false}){
  host.replaceChildren();host.classList.add('dr-map');
  const svg=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));return e;};
  const arch=svg('svg',{viewBox:'0 0 520 760',class:'dr-arch-base','aria-hidden':'true'}),curve='M125 348 C110 269 111 178 142 121 C166 76 206 62 260 62 C314 62 354 76 378 121 C409 178 410 269 395 348';
  arch.append(svg('path',{d:curve}),svg('path',{d:curve,transform:'translate(0 760) scale(1 -1)'}));host.append(arch);
  for(const [cls,label] of [['dr-upper','Superior'],['dr-lower','Inferior']]){const n=document.createElement('span');n.className='dr-arch-label '+cls;n.textContent=label;host.append(n);}
  for(const [row,ids] of [[0,upper],[1,lower]])ids.forEach((id,i)=>{
   const unit=id%10,[px,py,angle,w,h]=positions[unit-1],left=i<8,x=left?px:520-px,y=row?760-py:py;
   const kind=unit<3?'incisor':unit===3?'canine':unit<6?'premolar':'molar',s=state(String(id)),b=document.createElement('button');
   b.type='button';b.className='dr-tooth '+(s.className||'');b.dataset.tooth=String(id);b.dataset.toothKind=kind;
   b.style.left=x/5.2+'%';b.style.top=y/7.6+'%';b.style.width=w/5.2+'%';b.style.height=h/7.6+'%';b.disabled=disabled;
   const crown=svg('svg',{viewBox:'0 0 60 60','aria-hidden':'true',class:'dr-crown'});crown.style.transform='rotate('+((left?angle:-angle)*(row?-1:1)+(row?180:0))+'deg) scale(1.15)';
   crown.append(svg('path',{d:shapes[kind][0],class:'dr-enamel'}),svg('path',{d:shapes[kind][1],class:'dr-fissure'}));
   const number=document.createElement('span');number.className='dr-tooth-number';number.textContent=String(id);b.append(crown,number);
   b.setAttribute('aria-label','Diente '+id+' · '+(s.label||'Sin evaluar'));b.onclick=()=>onSelect(String(id));host.append(b);
   if(s.selected!==undefined)b.setAttribute('aria-pressed',String(!!s.selected));
   if(s.count>1){const count=document.createElement('span');count.className='pr-tooth-count';count.textContent=String(s.count);b.append(count);}
  });
 }
 window.SmylToothMap={render,teeth:[...upper,...lower].map(String)};
})();
