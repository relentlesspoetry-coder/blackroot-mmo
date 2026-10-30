// Isolated CPU benchmark, no WebGL. Full mode intentionally takes ~2 minutes
// for the frozen original; do not run alongside another benchmark.
// Usage: node tools/dirtbench.mjs [--full]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { makeBuilder, original, optimized, worldInputs } from '../test/helpers/dirt-field-harness.mjs';
const full = process.argv.includes('--full');
const results=[];
for(const [name,code] of [['original',original],['indexed',optimized]]) {
  const inputs=worldInputs(),build=makeBuilder(code, full?'grid':'sample');
  const start=performance.now(),field=build(...inputs);
  let values;
  if(full) values=field.A;
  else {
    values=new Float32Array(20000);
    for(let i=0;i<values.length;i++){
      const x=field.mnx+(field.mxx-field.mnx)*((i*0.6180339887498949)%1);
      const z=field.mnz+(field.mxz-field.mnz)*((i*0.4142135623730951)%1);
      values[i]=field.alphaAt(x,z);
    }
  }
  const ms=performance.now()-start;
  const sha256=createHash('sha256').update(new Uint8Array(values.buffer,values.byteOffset,values.byteLength)).digest('hex');
  const result={name,mode:full?'full-grid':'20000-samples',ms,samples:values.length,nx:field.nx,nz:field.nz,sha256};
  results.push(result);console.log(JSON.stringify(result));
}
assert.equal(results[1].sha256,results[0].sha256,'Original and indexed alpha must be byte-identical');
console.log('Exact parity; speedup '+(results[0].ms/results[1].ms).toFixed(2)+'x');
