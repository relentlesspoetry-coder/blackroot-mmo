import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBuilder, original, optimized, worldInputs, seeded } from './helpers/dirt-field-harness.mjs';
const line = (pts, extra={}) => ({pts:pts.map(([x,z])=>({x,z})),hw:0.7,fr:1,...extra});
const small = [
  [line([[-17,-17],[0,0],[17,16]], {fadeEnd:6, river:true}),line([[0,0],[0,0],[5,1]],{hw:2.6,fr:1.8})],
  [{x:-2,z:4,r:2,fr:3}], null, 0.05, 3,
  [{pts:[{x:4,z:4},{x:10,z:4},{x:8,z:9}],fr:2}]
];
function pair(inputs, mode) {
  return [original,optimized].map(code=>makeBuilder(code,mode)(...structuredClone(inputs)));
}
test('indexed dirt grid is byte-identical for overlap, fades, zero-length segments, discs and ragged polygons',()=>{
  const [a,b]=pair(small,'grid');
  assert.deepEqual(b,a);
});
test('dirt mesh attributes, indices and computed normals are byte-identical',()=>{
  const [a,b]=pair(small,'mesh');
  for(const name of Object.keys(a.geometry.attributes)) assert.deepEqual(b.geometry.attributes[name].array,a.geometry.attributes[name].array,name);
  assert.deepEqual(b.geometry.index.array,a.geometry.index.array);
});
test('bin boundaries, negative coordinates, disconnected paths and wide fallback preserve exact alpha',()=>{
  const input = [[...small[0],line([[-10000,-10000],[10000,10000]],{fadeEnd:600}),line([[1000,-1000],[1004,-1003]])],small[1],null,0.05,3,small[5]];
  const [a,b]=pair(input,'sample'),rand=seeded();
  for(let n=0;n<12000;n++) {
    const x=n<6000?(rand()-.5)*70:(rand()-.5)*22000;
    const z=n<6000?(rand()-.5)*70:x+(rand()-.5)*8;
    assert.equal(b.alphaAt(x,z),a.alphaAt(x,z));
  }
  for(const x of [-32,-16,0,16,32]) for(const dx of [-1e-12,0,1e-12]) for(const z of [-16,0,16])
    assert.equal(b.alphaAt(x+dx,z),a.alphaAt(x+dx,z));
});
test('actual Blackroot samples match original exactly, including river masks and endpoints',()=>{
  const input=worldInputs(),[a,b]=pair(input,'sample'),rand=seeded(847);
  for(let n=0;n<16000;n++){
    const x=a.mnx+rand()*(a.mxx-a.mnx),z=a.mnz+rand()*(a.mxz-a.mnz);
    assert.equal(b.alphaAt(x,z),a.alphaAt(x,z));
  }
  for(const s of input[0]) for(const p of s.pts) for(const offset of [0,s.hw,s.hw+s.fr])
    assert.equal(b.alphaAt(p.x+offset,p.z),a.alphaAt(p.x+offset,p.z));
});
test('a field rebuild uses edited paths and does not retain the previous zone bins',()=>{
  const inputs=structuredClone(small), build=makeBuilder(optimized,'sample');
  const old=build(...inputs);
  inputs[0]=[line([[500,500],[510,510]])];inputs[1]=[];inputs[5]=[];
  const next=build(...inputs),oracle=makeBuilder(original,'sample')(...structuredClone(inputs));
  for(const [x,z] of [[0,0],[505,505],[510,511],[-17,-17]]) assert.equal(next.alphaAt(x,z),oracle.alphaAt(x,z));
  assert.ok(old.alphaAt(0,0)>0);assert.equal(next.alphaAt(0,0),0);
});
test('empty fields and single point paths preserve original null/zero behavior',()=>{
  assert.equal(makeBuilder(optimized)([],[],null,0.05,3,[]),null);
  const [a,b]=pair([[line([[0,0]])],[],null,0.05,3,[]],'grid');
  assert.deepEqual(b,a);
});
