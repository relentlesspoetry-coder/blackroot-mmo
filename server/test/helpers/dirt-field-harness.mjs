import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as TERRAIN from '../../../shared/terrain.js';
import { blackroot } from '../../zones/blackroot.js';
const source = readFileSync(new URL('../../../client/index.html', import.meta.url), 'utf8');
export function clientFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Missing function: ' + name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
// Frozen pre-optimization implementation: independent mathematical oracle.
export const original = readFileSync(new URL('../fixtures/dirt-field-original.txt', import.meta.url), 'utf8');
export const optimized = clientFunction('buildDirtField');
export const zone = blackroot;
export function makeBuilder(code, mode = 'mesh', rivers = TERRAIN.riversOf(zone)) {
  if (mode === 'sample') code = code.slice(0, code.indexOf('  const nx =')) + 'return {alphaAt, mnx, mxx, mnz, mxz};\n}';
  if (mode === 'grid') code = code.slice(0, code.indexOf('  const pos =')) + 'return {A, nx, nz, mnx, mnz};\n}';
  return new Function('THREE', 'worldRivers', 'riverWaterHalf', 'distToPolyline',
    ['pointInPoly', 'vnoise2', 'fbm2'].map(clientFunction).join('\n') +
    '\nconst dirtCol = new THREE.Color(), scene = {add(){}}, groundMeshY = (x,z) => Math.sin(x)*0.2 + Math.cos(z)*0.3;\n' +
    code + '\nreturn buildDirtField;'
  )(THREE, () => rivers, TERRAIN.riverWaterHalf, TERRAIN.distToPolyline);
}
export function worldInputs() {
  const smoothPoly = new Function(clientFunction('smoothPoly') + ';return smoothPoly;')();
  const shapes = (zone.paths || []).map(p => {
    const points = Array.isArray(p) ? p : p.points, road = Array.isArray(p) || p.kind !== 'trail';
    return {pts:smoothPoly(points,8), hw:road?2.6:0.7, fr:road?1.8:1, river:true, fadeEnd:6};
  });
  return [shapes, (zone.dirt || []).map(d => ({...d, fr:d.fr??3})), null, 0.05, 3, []];
}
export function seeded(seed=57) {
  return () => { seed = Math.imul(seed,1664525)+1013904223|0; return (seed>>>0)/4294967296; };
}
