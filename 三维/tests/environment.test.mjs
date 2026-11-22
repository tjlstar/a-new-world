import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BEACH, beachShore, beachProfile, sculptBeach } from '../beach.js';
import * as THREE from '../vendor/three.module.min.js';
import { buildSeaArchGeometry } from '../sea-arch.js';

const read = path => readFileSync(new URL(path, import.meta.url));
const meta = JSON.parse(read('../data/island.json'));
const heights = read('../data/height.bin'), mats = read('../data/mat.bin');
test('sea arch is one connected rock with an open channel and submerged feet', () => {
  const spec = meta.seaArch;
  const span = Math.hypot(spec.b[0]-spec.a[0],spec.b[1]-spec.a[1])*1000;
  const g=meta.grid;
  const groundAtLocal=(across,along)=>{
    const dx=(spec.b[0]-spec.a[0])*1000/span, dy=(spec.b[1]-spec.a[1])*1000/span;
    const x=(spec.a[0]+spec.b[0])/2 + (along*dx-across*dy)/1000;
    const y=(spec.a[1]+spec.b[1])/2 + (along*dy+across*dx)/1000;
    const gx=(x-g.x0)/g.step, gy=(y-g.y0)/g.step;
    const i=Math.floor(gx), j=Math.floor(gy), u=gx-i, v=gy-j;
    const h=(ix,iy)=>heights.readInt16LE(2*(ix+iy*g.nx))*meta.heightScale;
    return u+v<=1
      ? h(i,j)*(1-u-v)+h(i+1,j)*u+h(i,j+1)*v
      : h(i+1,j+1)*(u+v-1)+h(i,j+1)*(1-u)+h(i+1,j)*(1-v);
  };
  const geometry = buildSeaArchGeometry(span,spec,(x,y)=>(1+Math.sin(x+y))/2,groundAtLocal);
  geometry.computeBoundingBox();
  const pos=geometry.attributes.position, east=geometry.boundingBox.max.z;
  // A low footing alone passes the old connectivity test. Check that even the
  // last several metres of the top and both outer faces are inside East Islet.
  for(let i=0;i<pos.count;i++){
    const z=pos.getZ(i);
    if(z>east-6) assert.ok(groundAtLocal(pos.getX(i),z)>pos.getY(i)+5,'Exposed east abutment');
  }
  const vertexCount = geometry.attributes.position.count;
  const adjacent = Array.from({length:vertexCount},()=>[]);
  const index=geometry.index.array;
  for(let i=0;i<index.length;i+=3){
    for (let k=0;k<3;k++) adjacent[index[i+k]].push(index[i+(k+1)%3]);
  }
  const connected = new Set([0]);
  for (const vertex of connected) for (const next of adjacent[vertex]) connected.add(next);
  assert.equal(connected.size,vertexCount,'Every rock vertex must connect to the arch');

  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  const ray=new THREE.Raycaster();
  const across=new THREE.Vector3(1,0,0);
  for (const z of [-40,-20,0,20,40]) {
    for (const y of [-15,0,15,35,50]) {
      ray.set(new THREE.Vector3(-60,y,z),across);
      assert.equal(ray.intersectObject(mesh).length,0,`Blocked at height ${y} m, span ${z} m`);
    }
  }
  ray.set(new THREE.Vector3(0,0,0),new THREE.Vector3(0,1,0));
  assert.ok(Math.abs(ray.intersectObject(mesh)[0].distance-spec.clearZ)<4);
  for(const z of [-span*.55,span*.55]) {
    ray.set(new THREE.Vector3(-60,-100,z),across);
    assert.ok(ray.intersectObject(mesh).length>=2,'Foot must extend to the channel bed');
  }
});
test('beach does not alter waterfall, river mouth, lake, villa or flanking cliffs', () => {
  const points = [...meta.riverProfile, [meta.plunge.x, meta.plunge.y], [-.42, -.02], meta.villa.p, [-.55, .72], [.45, .55]];
  for (const [x, y] of points) assert.equal(sculptBeach(x, y, 123.4), 123.4, `Protected point ${x},${y}`);
});
test('beach crosses sea level gradually and offers walkable dry sand', () => {
  for (const x of [-.20, -.10, 0]) {
    let previous = -Infinity;
    for (let inland = -30; inland <= 35; inland++) {
      const h = sculptBeach(x, beachShore(x) - inland / 1000, 80);
      assert.ok(h >= previous, 'Shore profile must not form steps or reverse slopes');
      if (previous !== -Infinity) assert.ok(h - previous < .25, 'Shore slope must be walkable');
      previous = h;
    }
    assert.ok(sculptBeach(x, beachShore(x) + .02, 80) < 0);
    assert.ok(sculptBeach(x, beachShore(x) - .03, 80) > 1);
  }
});
test('exported height and sand material agree with the beach profile', () => {
  const g = meta.grid;
  assert.equal(heights.length, g.nx * g.ny * 2);
  assert.equal(mats.length, g.nx * g.ny);
  let drySand = 0;
  for (let k = 0; k < mats.length; k++) {
    const x = g.x0 + k % g.nx * g.step, y = g.y0 + Math.floor(k / g.nx) * g.step;
    const b = beachProfile(x, y), height = heights.readInt16LE(k * 2) * meta.heightScale;
    if (b.weight === 1) assert.ok(Math.abs(height - b.height) <= .051);
    if (mats[k] === 7) {
      assert.ok(x >= BEACH.west && x <= BEACH.east && height > -1.5 && height < 8);
      if (height > 0.5 && height < 5) drySand++;
    }
  }
  assert.ok(drySand > 150, 'A substantial dry, walkable sand area must exist');
});
test('all nine local CC0 texture files match their recorded source hashes', () => {
  const sources = JSON.parse(read('../assets/textures/sources.json').toString().replace(/^\uFEFF/, ''));
  assert.equal(sources.length, 9);
  for (const source of sources) {
    assert.equal(source.license, 'CC0-1.0');
    assert.equal(createHash('md5').update(read(`../assets/textures/${source.file}`)).digest('hex'), source.md5);
  }
});
