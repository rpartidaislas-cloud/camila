/* UI samples only. Do not use this module for diagnosis or shade measurement.
 * CIELAB lookup: Huang et al., J Prosthodont 2023, Table 1 (Easyshade V database).
 * https://doi.org/10.1111/jopr.13571
 * Author institution copy: https://ss.bjmu.edu.cn/Sites/Uploaded/File/2024/03/146384600462049850764510217.pdf
 * These are device-specific published coordinates, NOT official VITA RGB values.
 * D65/sRGB is a display approximation; no screen, material or illuminant calibration.
 * Generated ceramic supplies texture only, never the shade assignments.
 */
(function(root){
 'use strict';
 var coordinates={
  A1:[82,-.7,13],A2:[77.7,0,18.5],A3:[75.5,.8,22.5],'A3.5':[73.2,1.9,26.9],A4:[69,2.5,23.9],
  B1:[86,-1,12],B2:[78.5,-.3,16],B3:[74,1,22],B4:[72,1.6,26.5],
  C1:[73,-.2,13.5],C2:[72,0,17],C3:[69,1,19.5],C4:[61,2.7,22.3],
  D2:[73,.2,14.3],D3:[72.5,.8,19.3],D4:[65,.3,20]
 };
 Object.values(coordinates).forEach(Object.freeze);Object.freeze(coordinates);
 function rgb(code){
  var lab=coordinates[code];if(!lab)throw new Error('Unknown VITA code');
  var fy=(lab[0]+16)/116,fx=fy+lab[1]/500,fz=fy-lab[2]/200;
  function inverse(t){var delta=6/29;return t>delta?t*t*t:3*delta*delta*(t-4/29);}
  var x=inverse(fx)*.95047,y=inverse(fy),z=inverse(fz)*1.08883;
  function channel(c){return Math.max(0,Math.min(255,Math.round(255*(c<=.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-.055))));}
  return [channel(3.2404542*x-1.5371385*y-.4985314*z),channel(-.969266*x+1.8760108*y+.041556*z),channel(.0556434*x-.2040259*y+1.0572252*z)];
 }
 function matrix(code){
  // Mean of the ceramic's central patch x220/y280/w120/h150 at 560x724.
  // Shift its body color to the reference, retaining local relief and a little
  // native chroma variation. Identical transform before/after selection.
  var base=[207.6151,199.5257,183.8899],target=rgb(code),weights=[.2126,.7152,.0722];
  var rows=target.map(function(t,i){var coefficients=weights.map(function(w,j){return .82*w+(i===j?.18:0);});var offset=(t-coefficients.reduce(function(sum,c,j){return sum+c*base[j];},0))/255;return coefficients.concat(0,offset);});
  return rows.flat().concat(0,0,0,1,0);
 }
 function attachFilter(image,code){
  if(!coordinates[code])return;
  var ns='http://www.w3.org/2000/svg',id='smyl-vita-sample-'+code.replace('.','-'),defs=document.getElementById('smyl-vita-sample-defs');
  if(!defs){var svg=document.createElementNS(ns,'svg');svg.setAttribute('width','0');svg.setAttribute('height','0');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.style.position='absolute';defs=document.createElementNS(ns,'defs');defs.id='smyl-vita-sample-defs';svg.append(defs);document.body.append(svg);}
  if(!document.getElementById(id)){var filter=document.createElementNS(ns,'filter'),color=document.createElementNS(ns,'feColorMatrix');filter.id=id;filter.setAttribute('color-interpolation-filters','sRGB');color.setAttribute('type','matrix');color.setAttribute('values',matrix(code).join(' '));filter.append(color);defs.append(filter);}
  image.style.filter='url(#'+id+')';
 }
 var api=Object.freeze({coordinates:coordinates,rgb:rgb,matrix:matrix,attachFilter:attachFilter});
 if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylVitaSamples=api;
})(typeof window!=='undefined'?window:globalThis);
