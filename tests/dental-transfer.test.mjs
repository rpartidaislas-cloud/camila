import assert from 'node:assert/strict';
import '../dental-transfer.js';
const {affine,map,validPolygon}=globalThis.SmylDentalTransfer;
const s=[{x:50,y:10},{x:10,y:80},{x:90,y:80}];
for(const expected of [[1,0,0,1,0,0],[.5,.1,-.1,.5,80,30],[1,.2,.3,1,100,50]]){
  const target=s.map(p=>map(p,expected)),actual=affine(s,target);
  actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-9));
  for(const p of [...s,{x:45,y:40}]){const a=map(p,actual),b=map(p,expected);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-8);}
}
assert.throws(()=>affine(s,[s[0],s[2],s[1]]));
assert.throws(()=>affine(s,[{x:0,y:0},{x:10,y:10},{x:20,y:20}]));
assert.equal(validPolygon([{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]),true);
assert.equal(validPolygon([{x:0,y:0},{x:20,y:20},{x:20,y:0},{x:0,y:20}]),false);
console.log('Affine correspondence, interior mapping, mirrored/degenerate rejection and contour validation passed.');
