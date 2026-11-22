import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

const base = './assets/landscape/';
export async function loadCliff(renderer) {
  const loader = new THREE.TextureLoader();
  const [map,normalMap,roughnessMap,relief] = await Promise.all(['Diffuse','nor_gl','Rough','Displacement'].map(name => loader.loadAsync(base + name + '.jpg')));
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
  }
  map.colorSpace = THREE.SRGBColorSpace;
  const c = document.createElement('canvas'); c.width=c.height=128;
  const ctx=c.getContext('2d'); ctx.drawImage(relief.image,0,0,128,128);
  const data=ctx.getImageData(0,0,128,128).data;
  relief.dispose();
  const pixel=(x,y)=>data[4*((x&127)+128*(y&127))]/255;
  const sample=(u,v)=>{
    const x=u*128, y=-v*128, i=Math.floor(x), j=Math.floor(y);
    const top=THREE.MathUtils.lerp(pixel(i,j),pixel(i+1,j),x-i);
    const bottom=THREE.MathUtils.lerp(pixel(i,j+1),pixel(i+1,j+1),x-i);
    return THREE.MathUtils.lerp(top,bottom,y-j);
  };
  return {map,normalMap,roughnessMap,sample};
}

// Retain the original edges and facade openings. Subdivide the interiors of steep rock
// triangles in world space, so the shadow pass sees exactly the same rock relief.
export function fractureCliffs(geo, cliff, protectedPoint) {
  const source=geo.attributes, original=geo.index.array;
  const arrays=Object.fromEntries(Object.entries(source).map(([name,a])=>[name,Array.from(a.array)]));
  const indices=[], p=source.position, a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3(), face=new THREE.Vector3(), side=new THREE.Vector3();
  const outcropAt=(x,y,z,ny)=>{
    const steep=1-THREE.MathUtils.smoothstep(ny,.22,.76);
    if(!steep || y<2 || protectedPoint(x,z)) return 0;
    const mass=cliff.sample((x+.43*z+.16*y)/83,(z-.51*x+.7*y)/91);
    const joint=cliff.sample((.62*x-z+.28*y)/37+mass*.32,(x+.54*z-.38*y)/46);
    return steep*THREE.MathUtils.smoothstep(y,2,25)*(5.5*(mass-.5)+2.6*(joint-.5));
  };
  const norm=source.normal;
  for(let i=0;i<p.count;i++){
    const ledge=outcropAt(p.getX(i),p.getY(i),p.getZ(i),norm.getY(i));
    arrays.position[3*i]+=norm.getX(i)*ledge;
    arrays.position[3*i+2]+=norm.getZ(i)*ledge;
  }
  for(let t=0;t<original.length;t+=3){
    const i=original[t],j=original[t+1],k=original[t+2];
    a.fromBufferAttribute(p,i); b.fromBufferAttribute(p,j); c.fromBufferAttribute(p,k);
    face.subVectors(b,a).cross(side.subVectors(c,a)).normalize();
    if(face.y>.70 || Math.max(a.y,b.y,c.y)<-48 || protectedPoint(a.x,a.z)){
      indices.push(i,j,k); continue;
    }
    const rise=Math.max(a.y,b.y,c.y)-Math.min(a.y,b.y,c.y);
    const steps=Math.min(13,Math.max(4,Math.ceil(rise/18))), rows=[];
    for(let v=0;v<=steps;v++){
      const row=[]; rows.push(row);
      for(let u=0;u<=steps-v;u++){
        if((u===0&&v===0)||u===steps||v===steps){row.push(u===steps?j:v===steps?k:i);continue;}
        const s=u/steps,h=v/steps,w=1-s-h;
        const x=w*a.x+s*b.x+h*c.x,y=w*a.y+s*b.y+h*c.y,z=w*a.z+s*b.z+h*c.z;
        const horizontal=Math.abs(face.x)>Math.abs(face.z)?z:x;
        const rough=cliff.sample(horizontal/19,y/15);
        const offset=Math.min(1,Math.min(w,s,h)*8)*(rough-.48)*1.8;
        row.push(arrays.position.length/3);
        const edgeX=w*arrays.position[3*i]+s*arrays.position[3*j]+h*arrays.position[3*k];
        const edgeZ=w*arrays.position[3*i+2]+s*arrays.position[3*j+2]+h*arrays.position[3*k+2];
        const interior=Math.min(1,Math.min(w,s,h)*8);
        const ledge=outcropAt(x,y,z,w*norm.getY(i)+s*norm.getY(j)+h*norm.getY(k));
        arrays.position.push(edgeX+(x-edgeX+face.x*ledge)*interior+face.x*offset,
          y+face.y*offset,edgeZ+(z-edgeZ+face.z*ledge)*interior+face.z*offset);
        for(const name of ['normal','color','uv']){
          const attr=source[name],n=attr.itemSize;
          for(let d=0;d<n;d++) arrays[name].push(w*attr.array[i*n+d]+s*attr.array[j*n+d]+h*attr.array[k*n+d]);
        }
      }
    }
    for(let v=0;v<steps;v++)for(let u=0;u<steps-v;u++){
      indices.push(rows[v][u],rows[v][u+1],rows[v+1][u]);
      if(u+v<steps-1)indices.push(rows[v][u+1],rows[v+1][u+1],rows[v+1][u]);
    }
  }
  for(const name in arrays) geo.setAttribute(name,new THREE.Float32BufferAttribute(arrays[name],source[name].itemSize));
  geo.setIndex(indices);
  // Keep shared terrain normals at original vertices. Recalculate relief normals inside each facet.
  const inherited=geo.attributes.normal.array.slice();
  geo.computeVertexNormals();
  const normals = geo.attributes.normal.array;
  for (let i = p.count*3; i < normals.length; i++) normals[i] = .32*normals[i] + .68*inherited[i];
  normals.set(inherited.subarray(0,p.count*3));
  geo.normalizeNormals();
}

export async function plantForest(scene, trees, random, software) {
  const images=await Promise.all([0,1,2].map(i=>new THREE.TextureLoader().loadAsync(base+'forest-'+i+'.png')));
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  const instances=trees.map(([x,y,z,scale,rotation])=>({x,y,z,height:scale*(9+random()*7),width:.8+random()*.5,rotation,tint:.65+random()*.32}));
  const cards=[];
  for(let view=0;view<3;view++){
    const tex=images[view];tex.colorSpace=THREE.SRGBColorSpace;
    const geo=new THREE.PlaneGeometry(1,1);
    if(view===2){geo.rotateX(-Math.PI/2);geo.translate(0,.68,0);}
    else {geo.translate(0,.44,0);geo.rotateY(view*Math.PI/2);}
    const mat=new THREE.MeshLambertMaterial({
      map:tex, alphaTest:.34, side:THREE.DoubleSide,
      emissiveMap:tex, emissive:0xbcd1ac, emissiveIntensity:.95,
    });
    // The canopy cap fills the crown seen from above. Fade it out at grazing angles.
    if (view === 2) mat.onBeforeCompile = shader => {
      shader.vertexShader = 'varying float crownAngle;\n' + shader.vertexShader.replace('#include <project_vertex>', `
        #include <project_vertex>
        vec3 crownWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;
        crownAngle = normalize(cameraPosition - crownWorld).y;
      `);
      shader.fragmentShader = 'varying float crownAngle;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>', `
        diffuseColor.a *= smoothstep(.17,.65,crownAngle);
        #include <alphatest_fragment>
      `);
    };
    const mesh=new THREE.InstancedMesh(geo,mat,instances.length);
    cards.push(mesh);
    instances.forEach(({x,y,z,height,width,rotation,tint},i)=>{
      dummy.position.set(x,y,z);dummy.scale.set(height*width,height,height*width);dummy.rotation.y=rotation;dummy.updateMatrix();
      mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,color.setRGB(tint,tint*.99,tint*.92));
    });
    mesh.castShadow=view!==2;mesh.receiveShadow=true;scene.add(mesh);
  }

  const {scene:model}=await new GLTFLoader().loadAsync(base+'island-tree-near.glb');
    const budget=software?4:12, detailed=[];
  model.traverse(part=>{
    if(!part.isMesh)return;
    const tree=new THREE.InstancedMesh(part.geometry,part.material,budget);
    tree.count=0;tree.frustumCulled=false;tree.castShadow=true;tree.receiveShadow=true;
    detailed.push(tree);scene.add(tree);
  });
  const hidden=new THREE.Matrix4().makeScale(0,0,0);
  const last=new THREE.Vector3(Infinity,Infinity,Infinity);
  let active=new Set();
  return cameraPosition=>{
    if(last.distanceToSquared(cameraPosition)<25)return false;
    last.copy(cameraPosition);
    const close=[];
    instances.forEach((tree,id)=>{
      const d=(tree.x-last.x)**2+(tree.y+tree.height*.42-last.y)**2+(tree.z-last.z)**2;
      if(d<65**2)close.push({id,d});
    });
    close.sort((a,b)=>a.d-b.d);
    const selected=new Set(close.slice(0,budget).map(t=>t.id));
    if(selected.size===active.size && [...selected].every(id=>active.has(id)))return false;
    for(const id of active){
      if(selected.has(id))continue;
      const t=instances[id];
      dummy.position.set(t.x,t.y,t.z);dummy.rotation.set(0,t.rotation,0);
      dummy.scale.set(t.height*t.width,t.height,t.height*t.width);dummy.updateMatrix();
      for(const card of cards)card.setMatrixAt(id,dummy.matrix);
    }
    let slot=0;
    for(const id of selected){
      const t=instances[id];
      for(const card of cards)card.setMatrixAt(id,hidden);
      dummy.position.set(t.x,t.y,t.z);dummy.rotation.set(0,t.rotation,0);
      const unit=t.height/5.6;
      dummy.scale.set(unit*t.width,unit,unit*t.width);dummy.updateMatrix();
      for(const tree of detailed)tree.setMatrixAt(slot,dummy.matrix);
      slot++;
    }
    for(const tree of detailed){tree.count=slot;tree.instanceMatrix.needsUpdate=true;}
    for(const card of cards)card.instanceMatrix.needsUpdate=true;
    active=selected;
    return true;
  };
}

// Deterministic ground cover within a few strides of the observer. The same cells
// regenerate at the same positions after a flight or a teleport.
export function buildUnderstory(scene,heightAt,biomeAt,software){
  const positions=[],colors=[];
  for(let blade=0;blade<17;blade++){
    const angle=blade*2.4, x=Math.cos(angle),z=Math.sin(angle);
    const w=.009+.004*(blade%3),h=.18+(blade%5)*.063;
    const root=[x*.056,0,z*.056], left=[root[0]-z*w,0,root[2]+x*w],right=[root[0]+z*w,0,root[2]-x*w];
    const radius=.062+.026*(blade%4), halfWidth=w*.64;
    const ml=[x*radius-z*halfWidth,h*.64,z*radius+x*halfWidth];
    const mr=[x*radius+z*halfWidth,h*.64,z*radius-x*halfWidth];
    const tip=[x*radius*2.3,h,z*radius*2.3];
    positions.push(...left,...right,...ml,...right,...mr,...ml,...ml,...mr,...tip);
    const foot=[.048,.067,.026],middle=[.12,.155,.053],end=[.23,.245,.094];
    colors.push(...foot,...foot,...middle,...foot,...middle,...middle,...middle,...middle,...end);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.computeVertexNormals();
  const count=software?40:135,mesh=new THREE.InstancedMesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}),count*25);
  mesh.count=0;mesh.receiveShadow=true;mesh.frustumCulled=false;scene.add(mesh);
  const obj=new THREE.Object3D();
  let previous='';
  return position=>{
    const cx=Math.floor(position.x/15),cz=Math.floor(position.z/15);
    const above=position.y-heightAt(position.x,position.z);
    if(above>65 || position.y<0){mesh.count=0;previous='';return;}
    const cell=cx+','+cz;
    if(previous===cell)return;
    previous=cell;let used=0;
    for(let j=cz-2;j<=cz+2;j++)for(let i=cx-2;i<=cx+2;i++){
      let seed=(Math.imul(i,73856093)^Math.imul(j,19349663))>>>0;
      const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let k=0;k<count;k++){
        const x=(i+rand())*15,z=(j+rand())*15;
        const biome=biomeAt(x,z);
        if(biome!==1 && biome!==2)continue;
        const y=heightAt(x,z);
        if(y<5 || Math.abs(heightAt(x+1,z)-y)>.68 || Math.abs(heightAt(x,z+1)-y)>.68)continue;
        obj.position.set(x,y-.04,z);obj.rotation.y=rand()*Math.PI*2;
        obj.scale.setScalar((biome===2?1.3:.85)*(.6+rand()*.8));obj.updateMatrix();
        mesh.setMatrixAt(used++,obj.matrix);
      }
    }
    mesh.count=used;mesh.instanceMatrix.needsUpdate=true;
  };
}
