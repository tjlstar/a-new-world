import * as THREE from './vendor/three.module.min.js';

// Span runs along local Z. Every cross section belongs to the same indexed
// surface, including both feet below the seabed and the underside of the vault.
export function buildSeaArchGeometry(span, { width, crownZ, clearZ }, noise, groundAtLocal) {
  const half = span / 2;
  const reach = half + 30;
  const spacing = 2*reach/112, sides = 36;
  let slices = 112;
  // The eastern shoreline marks the foot of a sloping cliff. Find solid rock
  // above the highest possible crown vertex across the full thickness of the rib.
  const buriedAcross = s => {
    for (let j = -8; j <= 8; j++) {
      if (groundAtLocal(j*width/10,s) < crownZ+20) return false;
    }
    return true;
  };
  while (slices < 224 && !buriedAcross(-reach + slices*spacing)) slices++;
  // Seat the cap a few metres deeper than the sampled contact to allow for the
  // displacement of the rendered cliff relative to the collision heightfield.
  slices += Math.ceil(8/spacing);
  const positions = [], colors = [], uv = [], triangles = [];
  const signedPow = (v, exponent) => Math.sign(v) * Math.pow(Math.abs(v), exponent);
  for (let i = 0; i <= slices; i++) {
    const s = -reach + i*spacing;
    const irregular = noise(s*.051, 8.1) - .5;
    const shoulder = Math.abs((s + 2.5 + 2*irregular) / half);
    // Sweep from a broad vault to solid footings at the banks.
    const drop = THREE.MathUtils.smoothstep(shoulder,.48,1.08);
    const bottom = clearZ - 7*shoulder*shoulder - (clearZ+120)*drop + 3*irregular;
    const top = crownZ + 10*irregular + 8*THREE.MathUtils.smoothstep(shoulder,.55,1.15);
    const breadth = width * (.49 + .16*drop + .09*irregular);
    const center = 4*(noise(s*.028,1.6)-.5);
    for (let j = 0; j < sides; j++) {
      const angle = 2*Math.PI*j/sides;
      const side = signedPow(Math.cos(angle),.64), elevation = signedPow(Math.sin(angle),.72);
      const y = THREE.MathUtils.lerp(bottom,top,(elevation+1)/2);
      const weathering = noise(s*.095 + y*.018, y*.065 + side*1.7)-.5;
      const x = center + side*(breadth + 3*weathering);
      positions.push(x, y + 1.5*weathering, s);
      colors.push(.09,.095,.097);
      uv.push(s/16,y/16);
      if (i < slices) {
        const a=i*sides+j, b=i*sides+(j+1)%sides;
        triangles.push(a,b,a+sides,b,b+sides,a+sides);
      }
    }
  }
  for (let j=1; j<sides-1; j++) {
    const end=slices*sides;
    triangles.push(0,j+1,j,end,end+j,end+j+1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return geometry;
}
