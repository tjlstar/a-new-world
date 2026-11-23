import * as THREE from './vendor/three.module.min.js';
import { BEACH, beachShore, beachProfile } from './beach.js';

// Frozen local CC0 assets. A failed asset keeps a usable procedural fallback.
export async function loadSurfaceTextures(renderer, fallback) {
  const loader = new THREE.TextureLoader();
  const failed = [];
  const sets = {};
  await Promise.all(['coast_sand_rocks_02', 'coast_sand_03', 'forest_ground_04'].map(async (id) => {
    const textures = await Promise.all(['diff', 'nor_gl', 'rough'].map(async (kind) => {
      try {
        const tex = await loader.loadAsync(`./assets/textures/${id}_${kind}_1k.jpg`);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        tex.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        return tex;
      } catch { failed.push(`${id}/${kind}`); return null; }
    }));
    sets[id] = { map: textures[0] || fallback, normalMap: textures[1], roughnessMap: textures[2] };
  }));
  return { rock: sets.coast_sand_rocks_02, sand: sets.coast_sand_03, forest: sets.forest_ground_04, failed };
}

export function installTerrainSurface(material, sets, useBeach = false) {
  if (sets.failed.length) return; // Never compile a shader with incomplete samplers.
  material.map = null;
  const previous = material.onBeforeCompile;
  const originalProgram = material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    previous(shader); // Preserve the villa's facade and hangar cutouts.
    for (const [prefix, set] of Object.entries({ rock: sets.rock, sand: sets.sand, soil: sets.forest })) {
      for (const [suffix, key] of [['Color', 'map'], ['Normal', 'normalMap'], ['Rough', 'roughnessMap']]) {
        shader.uniforms[prefix + suffix] = { value: set[key] };
      }
    }
    shader.vertexShader = 'varying vec3 vSurfacePosition; varying vec3 vSurfaceNormal;\n' + shader.vertexShader;
    if (useBeach) {
      shader.vertexShader = 'attribute float beachSand; varying float vBeachSand;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvBeachSand = beachSand;');
    }
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vSurfacePosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vSurfaceNormal = normalize(mat3(modelMatrix) * normal);
    `);
    shader.fragmentShader = `
      varying vec3 vSurfacePosition;
      varying vec3 vSurfaceNormal;
      ${useBeach ? 'varying float vBeachSand;' : ''}
      uniform sampler2D rockColor, rockNormal, rockRough;
      uniform sampler2D sandColor, sandNormal, sandRough;
      uniform sampler2D soilColor, soilNormal, soilRough;
      vec4 projectRock(sampler2D tex, vec3 p, vec3 w) {
        return texture2D(tex, p.zy / 16.0) * w.x
             + texture2D(tex, p.xz / 16.0) * w.y
             + texture2D(tex, p.xy / 16.0) * w.z;
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 groundNormal = normalize(vSurfaceNormal);
      vec3 weights = pow(abs(groundNormal), vec3(5.0));
      weights /= max(dot(weights, vec3(1.0)), 0.001);
      vec3 p = vSurfacePosition;
      float sandWeight = ${useBeach ? 'vBeachSand * smoothstep(0.63, 0.92, groundNormal.y)' : '0.0'};
      float grassWeight = smoothstep(0.018, 0.065, vColor.g - vColor.r)
        * smoothstep(0.55, 0.90, groundNormal.y) * (1.0 - sandWeight);
      vec3 rockP = p + 2.8*sin(p.zxy*.046+p.yzx*.017) + 1.2*sin(p.yzx*.093-p.xyz*.037);
      vec3 rockTex = projectRock(rockColor, rockP, weights).rgb;
      vec3 soilTex = texture2D(soilColor, p.xz / 9.0).rgb;
      vec2 sandUV = p.xz * .49 + .27 * sin(p.zx * .16 + sin(p.xz * .047));
      vec3 sandTex = texture2D(sandColor, sandUV).rgb;
      sandTex = mix(sandTex, texture2D(sandColor,mat2(.8,.6,-.6,.8)*sandUV*.59).rgb,.45);
      // Photos supply grain and cracks; the island's basalt palette supplies geology.
      vec3 macroRock = projectRock(rockColor,rockP * 0.32 + vec3(13.0),weights).rgb;
      float rockGrain = clamp(dot(rockTex,vec3(0.333))*5.2,0.19,2.5);
      float cliffMask = 1.0 - smoothstep(0.48,0.82,groundNormal.y);
      vec3 basalt = mix(vec3(.062,.069,.073), vec3(.21,.195,.164), clamp(dot(macroRock,vec3(.9)),0.0,1.0));
      diffuseColor.rgb = mix(diffuseColor.rgb,basalt,cliffMask);
      vec3 landColor = diffuseColor.rgb * mix(vec3(rockGrain), clamp(soilTex * 5.0, 0.45, 1.7), grassWeight);
      float litter = .5+.24*sin(p.x*.083+sin(p.z*.071))+.22*sin(p.z*.157-p.x*.053);
      vec3 forestFloor=soilTex*vec3(.78,.78,.64);
      landColor=mix(landColor,forestFloor,grassWeight*(.34+.55*litter));
      float wet = 1.0 - smoothstep(0.15, 1.8, p.y);
      vec3 sandTint = mix(vec3(0.81, 0.785, 0.71), vec3(0.40, 0.385, 0.33), wet);
      float sandGrain = 0.82 + 0.32 * clamp(dot(sandTex, vec3(0.8, 1.6, 0.6)), 0.0, 1.0);
      diffuseColor.rgb = mix(landColor, sandTint * sandGrain, sandWeight);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      float rockR = projectRock(rockRough, rockP, weights).g;
      float soilR = texture2D(soilRough, p.xz / 9.0).g;
      float sandR = texture2D(sandRough, sandUV).g;
      float roughnessFactor = mix(mix(max(0.72, rockR), max(0.86, soilR), grassWeight), mix(max(0.8, sandR), 0.28, wet), sandWeight);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      vec3 nx = texture2D(rockNormal, rockP.zy / 16.0).xyz * 2.0 - 1.0;
      vec3 ny = texture2D(rockNormal, rockP.xz / 16.0).xyz * 2.0 - 1.0;
      vec3 nz = texture2D(rockNormal, rockP.xy / 16.0).xyz * 2.0 - 1.0;
      vec3 perturb = vec3(0.0, nx.y, nx.x) * weights.x
        + vec3(ny.x, 0.0, ny.y) * weights.y + vec3(nz.x, nz.y, 0.0) * weights.z;
      vec3 soilN = texture2D(soilNormal, p.xz / 9.0).xyz * 2.0 - 1.0;
      vec3 sandN = texture2D(sandNormal, sandUV).xyz * 2.0 - 1.0;
      perturb = mix(perturb, vec3(soilN.x, 0.0, soilN.y), grassWeight);
      perturb = mix(perturb, vec3(sandN.x, 0.0, sandN.y) * 0.28, sandWeight);
      perturb -= groundNormal * dot(groundNormal, perturb);
      normal = normalize(normal + mat3(viewMatrix) * perturb * 0.92);
    `);
  };
  material.customProgramCacheKey = () => 'island-weathered-rock:' + useBeach + originalProgram;
  material.needsUpdate = true;
}

export function buildCoastalDetails({ scene, heightAt, sets, random, software }) {
  const root = new THREE.Group(); root.name = '黑砾湾 · 白沙滩与近岸礁石'; scene.add(root);
  const dummy = new THREE.Object3D();
  const rockMaterial = new THREE.MeshStandardMaterial({ ...sets.rock, color: 0x686e70, roughness: 0.93, normalScale: new THREE.Vector2(0.7, 0.7) });
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const pos = rockGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const f = 1 + 0.2 * Math.sin(x * 8 + y * 12 + z * 5);
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  rockGeo.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rockGeo, rockMaterial, software ? 75 : 180);
  rocks.name = '近岸浅水礁石';
  // 礁石沿几处浅海岩脊成簇分布。坐标为沿岸比例和离岸米数。
  const reefs = [[0.14, 21], [0.32, 37], [0.58, 26], [0.74, 42], [0.88, 20]];
  let count = 0;
  for (let i = 0; i < 2000 && count < rocks.instanceMatrix.count; i++) {
    const [along, offshore] = reefs[i % reefs.length];
    const dx = (random() + random() - 1) * 23;
    const x = BEACH.west + along * (BEACH.east - BEACH.west) + dx / 1000;
    const wx = x * 1000, wz = -beachShore(x) * 1000 - offshore - dx * 0.23 - (random() - 0.5) * 17;
    const h = heightAt(wx, wz);
    const size = 0.65 + 3.6 * random() ** 2, length = size * (1.1 + 0.6 * random());
    const radius = length * 1.21;
    if (h > -0.65 || h < -7) continue;
    const wetFootprint = [-radius, 0, radius].every(ox =>
      [-radius, 0, radius].every(oz => heightAt(wx + ox, wz + oz) < -0.35));
    if (!wetFootprint) continue;
    dummy.position.set(wx, h + size * 0.12, wz);
    dummy.rotation.set(random() * 0.5, random() * 6.28, random() * 0.4);
    dummy.scale.set(length, size * 0.82, size);
    dummy.updateMatrix(); rocks.setMatrixAt(count, dummy.matrix);
    rocks.setColorAt(count++, new THREE.Color().setHSL(0.55, 0.04, 0.44 + random() * 0.25));
  }
  rocks.count = count; rocks.receiveShadow = true; rocks.castShadow = !software; root.add(rocks);

  // Small wind-bent grasses along the backshore, using one instanced draw call.
  const blades = [], bladeNormals = [];
  for (let b = 0; b < 7; b++) {
    const a = b * 2.4, dx = Math.cos(a), dz = Math.sin(a), h = 0.65 + (b % 3) * 0.27;
    blades.push(-dz * 0.055, 0, dx * 0.055, dz * 0.055, 0, -dx * 0.055, dx * 0.32, h, dz * 0.32);
    for (let k = 0; k < 3; k++) bladeNormals.push(dx, 0.4, dz);
  }
  const grassGeo = new THREE.BufferGeometry();
  grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
  grassGeo.setAttribute('normal', new THREE.Float32BufferAttribute(bladeNormals, 3));
  const grass = new THREE.InstancedMesh(grassGeo, new THREE.MeshStandardMaterial({ color: 0x6d7950, side: THREE.DoubleSide, roughness: 1 }), software ? 500 : 1800);
  count = 0;
  for (let i = 0; i < 6000 && count < grass.instanceMatrix.count; i++) {
    const x = BEACH.west + random() * (BEACH.east - BEACH.west);
    const shore = beachShore(x), back = beachProfile(x, shore).width;
    const y = shore - (back + 12 + random() * 25) / 1000, h = heightAt(x * 1000, -y * 1000);
    const beach = beachProfile(x, y);
    if (h < 3.6 || h > 29 || beach.sand > 0.08 || beach.weight < 0.15) continue;
    dummy.position.set(x * 1000, h - 0.05, -y * 1000); dummy.rotation.set(0, random() * 6.28, 0);
    dummy.scale.setScalar(0.6 + random() * 1.3); dummy.updateMatrix(); grass.setMatrixAt(count++, dummy.matrix);
  }
  grass.count = count; root.add(grass);

  const uniforms = { time: { value: 0 } };
  const foamMaterial = new THREE.MeshBasicMaterial({ color: 0xc8ddd8, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  foamMaterial.onBeforeCompile = shader => {
    shader.uniforms.surfTime = uniforms.time;
    shader.vertexShader = 'varying vec2 vSurf;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = uv;');
    shader.fragmentShader = 'uniform float surfTime; varying vec2 vSurf;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float wave = fract(vSurf.y * 2.0 - surfTime * 0.13 + sin(vSurf.x * 40.0) * 0.05);
      float lace = 0.6 + 0.4 * sin(vSurf.x * 530.0 + sin(vSurf.y * 92.0) * 3.0);
      diffuseColor.a *= pow(max(0.0, 1.0 - abs(wave - 0.5) * 8.0), 2.0) * lace
        * sin(vSurf.y * 3.14159) * smoothstep(0.0, 0.12, vSurf.x) * (1.0 - smoothstep(0.88, 1.0, vSurf.x));
    `);
  };
  const v = [], uv = [], indices = [];
  for (let i = 0; i <= 120; i++) {
    const x = BEACH.west + (BEACH.east - BEACH.west) * i / 120;
    for (let j = 0; j <= 8; j++) {
      v.push(x * 1000, 0.13, -beachShore(x) * 1000 - j * 1.8);
      uv.push(i / 120, j / 8);
      if (i < 120 && j < 8) { const a = i * 9 + j; indices.push(a, a + 9, a + 1, a + 1, a + 9, a + 10); }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices);
  const surf = new THREE.Mesh(geo, foamMaterial); surf.renderOrder = 4; root.add(surf);
  return { update(time) { uniforms.time.value = time; }, root };
}
