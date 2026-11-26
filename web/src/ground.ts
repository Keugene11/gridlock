import * as THREE from "three";
import type { World } from "./data";
import { U } from "./city";

const NOISE = /* glsl */ `
float gh(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*vn(p); p *= 2.03; a *= 0.5; } return s; }
`;

function polyMesh(rings: number[][][], y: number, mat: THREE.Material) {
  const pos: number[] = [], idx: number[] = [];
  for (const poly of rings) {
    const toV = (r: number[]) => { const a: THREE.Vector2[] = []; for (let i = 0; i < r.length; i += 2) a.push(new THREE.Vector2(r[i], r[i + 1])); return a; };
    const outer = toV(poly[0]);
    const holes = poly.slice(1).map(toV);
    const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
    const all = outer.concat(...holes);
    const b = pos.length / 3;
    for (const v of all) pos.push(v.x, y, v.y);
    for (const [a, c, d] of tris) {
      const A = all[a], C = all[c], D = all[d];
      const cr = (C.x - A.x) * (D.y - A.y) - (C.y - A.y) * (D.x - A.x);
      if (cr > 0) idx.push(b + a, b + d, b + c); else idx.push(b + a, b + c, b + d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

function worldPosInject(m: THREE.MeshStandardMaterial, frag: string, extraCommon = "", vert = "") {
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.uNight;
    s.uniforms.uTime = U.uTime;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;" + vert)
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz;");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP; uniform float uNight; uniform float uTime;\n" + NOISE + extraCommon)
      .replace("#include <map_fragment>", frag);
  };
}

export function buildGround(w: World, scene: THREE.Scene) {
  const group = new THREE.Group();
  // sidewalks / land: concrete slabs
  const landMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  worldPosInject(landMat, `
    vec2 p = vWP.xz;
    vec2 sl = fract(p/1.6); vec2 fw = fwidth(p/1.6);
    float seam = 1.0 - (1.0-smoothstep(0.0, fw.x*1.5+0.02, sl.x)*smoothstep(1.0, 1.0-fw.x*1.5-0.02, sl.x)) * 0.25 * (1.0-clamp(fw.x*4.0,0.0,1.0));
    seam *= 1.0 - (1.0-smoothstep(0.0, fw.y*1.5+0.02, sl.y)*smoothstep(1.0, 1.0-fw.y*1.5-0.02, sl.y)) * 0.25 * (1.0-clamp(fw.y*4.0,0.0,1.0));
    float slab = 0.9 + 0.12*gh(floor(p/1.6));
    float st = 0.8 + 0.3*fbm(p*0.15);
    diffuseColor.rgb = vec3(0.34,0.335,0.325) * slab * seam * st;
  `);
  const land = polyMesh(w.land, 0, landMat);
  group.add(land);

  // seawalls along shorelines
  const wallPos: number[] = [];
  for (const poly of w.land) {
    const r = poly[0];
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const x0 = r[i], z0 = r[i + 1], x1 = r[j], z1 = r[j + 1];
      wallPos.push(x0, 0, z0, x1, 0, z1, x1, -4, z1, x0, 0, z0, x1, -4, z1, x0, -4, z0);
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute("position", new THREE.Float32BufferAttribute(wallPos, 3));
  wg.computeVertexNormals();
  const seawall = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x3d3b38, roughness: 0.95, side: THREE.DoubleSide }));
  group.add(seawall);

  // parks: grass
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  worldPosInject(grassMat, `
    vec2 p = vWP.xz;
    float n = fbm(p*0.08), n2 = fbm(p*0.9);
    vec3 g1 = vec3(0.16,0.24,0.08), g2 = vec3(0.26,0.30,0.12), dirt = vec3(0.30,0.26,0.20);
    vec3 c = mix(g1, g2, n);
    c = mix(c, dirt, smoothstep(0.62, 0.75, fbm(p*0.03+7.0))*0.6);
    diffuseColor.rgb = c * (0.85 + 0.3*n2);
  `);
  const parks = polyMesh(w.parks, 0.03, grassMat);
  group.add(parks);

  // water
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0d1a1f, roughness: 0.06, metalness: 0.0 });
  waterMat.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.uTime;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz;");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP; uniform float uTime;\n" + NOISE)
      .replace("#include <normal_fragment_maps>", `
        vec2 p = vWP.xz;
        float t = uTime;
        float e = 0.6;
        float h0 = fbm(p*0.12 + vec2(t*0.05, t*0.03)) + 0.5*fbm(p*0.45 - vec2(t*0.09, -t*0.06));
        float hx = fbm((p+vec2(e,0.0))*0.12 + vec2(t*0.05, t*0.03)) + 0.5*fbm((p+vec2(e,0.0))*0.45 - vec2(t*0.09, -t*0.06));
        float hz = fbm((p+vec2(0.0,e))*0.12 + vec2(t*0.05, t*0.03)) + 0.5*fbm((p+vec2(0.0,e))*0.45 - vec2(t*0.09, -t*0.06));
        vec3 nW = normalize(vec3(-(hx-h0)*1.6, 1.0, -(hz-h0)*1.6));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      `);
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), waterMat);
  water.position.y = -1.1;
  water.receiveShadow = true;
  group.add(water);

  group.add(buildRoads(w));
  scene.add(group);
  return group;
}

function buildRoads(w: World) {
  const pos: number[] = [], uv: number[] = [], ar: number[] = [], ac: number[] = [], idx: number[] = [];
  for (const e of w.edges) {
    const m = e.p.length / 2;
    const hw = e.w / 2;
    const base = pos.length / 3;
    for (let i = 0; i < m; i++) {
      const x = e.p[i * 2], z = e.p[i * 2 + 1];
      // averaged tangent for a mitred strip
      let tx = 0, tz = 0;
      if (i > 0) { const dx = x - e.p[i * 2 - 2], dz = z - e.p[i * 2 - 1], L = Math.hypot(dx, dz) || 1; tx += dx / L; tz += dz / L; }
      if (i < m - 1) { const dx = e.p[i * 2 + 2] - x, dz = e.p[i * 2 + 3] - z, L = Math.hypot(dx, dz) || 1; tx += dx / L; tz += dz / L; }
      const L = Math.hypot(tx, tz) || 1;
      tx /= L; tz /= L;
      const rx = -tz, rz = tx; // right
      // extend the strip a little past each end so intersections are filled
      let ex = 0, ez = 0;
      if (i === 0) { ex = -tx * hw * 0.3; ez = -tz * hw * 0.3; }
      if (i === m - 1) { ex = tx * hw * 0.3; ez = tz * hw * 0.3; }
      const s = e.cum[i] + (i === 0 ? -hw * 0.3 : i === m - 1 ? hw * 0.3 : 0);
      pos.push(x - rx * hw + ex, 0.02, z - rz * hw + ez, x + rx * hw + ex, 0.02, z + rz * hw + ez);
      uv.push(s, -hw, s, hw);
      for (let k = 0; k < 2; k++) {
        ar.push(e.len, e.w, e.l, e.d === 0 ? 1 : 0);
        ac.push(e.clA, e.clB, e.hw, e.d);
      }
    }
    for (let i = 0; i < m - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  g.setAttribute("aUV", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aR", new THREE.Float32BufferAttribute(ar, 4));
  g.setAttribute("aC", new THREE.Float32BufferAttribute(ac, 4));
  // make sure winding faces up
  const ix = g.index;
  g.setIndex(idx);
  void ix;
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.uNight;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aUV; attribute vec4 aR; attribute vec4 aC; varying vec2 vR; varying vec4 vA; varying vec4 vC; varying vec3 vWP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvR = aUV; vA = aR; vC = aC;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz;");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vR; varying vec4 vA; varying vec4 vC; varying vec3 vWP; uniform float uNight;\n" + NOISE + `
      float gRough = 0.9; vec3 gEmit = vec3(0.0);
      float line(float x, float c, float hw, float fw){ return smoothstep(c-hw-fw, c-hw+fw, x) - smoothstep(c+hw-fw, c+hw+fw, x); }
    `)
      .replace("#include <map_fragment>", `
      {
        float u = vR.x, v = vR.y; float len = vA.x, W = vA.y, lanes = vA.z, two = vA.w;
        float clA = vC.x, clB = vC.y, hwy = vC.z;
        vec2 p = vWP.xz;
        float n = fbm(p*0.35), n2 = fbm(p*0.05+3.0);
        vec3 asph = vec3(0.085,0.087,0.09) * (0.8 + 0.4*n) * (0.85 + 0.3*n2);
        // patches + manholes
        asph *= 1.0 - 0.18*smoothstep(0.62, 0.66, fbm(p*0.08+11.0));
        float mh = length(fract(p/23.0+0.37)*23.0 - 11.5);
        asph = mix(asph, vec3(0.05,0.05,0.05), (1.0-smoothstep(0.32,0.36,mh))*0.9);
        float fw = fwidth(u) + fwidth(v);
        float paint = 0.0; vec3 pc = vec3(0.82,0.82,0.78);
        float body = step(clA + 6.0, u) * step(u, len - clB - 6.0);
        float laneW = min(3.4, W/max(lanes,1.0));
        float tw = laneW*lanes;
        float worn = 0.65 + 0.35*smoothstep(0.3, 0.7, vn(p*1.7));
        if (body > 0.5) {
          if (two > 0.5) {
            float y = line(v, -0.14, 0.06, fw) + line(v, 0.14, 0.06, fw);
            pc = mix(pc, vec3(0.85,0.62,0.12), step(0.01, y));
            paint = max(paint, y);
            float lps = max(1.0, floor(lanes/2.0));
            float dash = step(fract(u/12.0), 0.25);
            for (int k = 1; k < 4; k++) { float fk = float(k); if (fk < lps) { paint = max(paint, (line(v, fk*laneW, 0.06, fw) + line(v, -fk*laneW, 0.06, fw))*dash); } }
          } else if (lanes > 1.0) {
            float dash = step(fract(u/12.0), 0.25);
            for (int k = 1; k < 6; k++) { float fk = float(k); if (fk < lanes) paint = max(paint, line(v, -tw*0.5 + fk*laneW, 0.06, fw)*dash); }
          }
          if (hwy < 0.5) paint = max(paint, (line(v, -W*0.5+0.35, 0.05, fw) + line(v, W*0.5-0.35, 0.05, fw))*0.0);
        }
        // crosswalks + stop lines at signalised/major intersections
        float zebra = step(0.5, fract(v/1.1));
        if (clA > 0.5) {
          paint = max(paint, line(u, clA + 2.5, 1.6, fw) * zebra * step(abs(v), W*0.5-0.3));
          paint = max(paint, line(u, clA + 5.0, 0.22, fw) * step(abs(v), W*0.5-0.3) * (two > 0.5 ? step(v, 0.0) : 1.0) * step(vC.w, 0.5) );
        }
        if (clB > 0.5) {
          paint = max(paint, line(u, len - clB - 2.5, 1.6, fw) * zebra * step(abs(v), W*0.5-0.3));
          paint = max(paint, line(u, len - clB - 5.0, 0.22, fw) * step(abs(v), W*0.5-0.3) * (two > 0.5 ? step(0.0, v) : 1.0) * step(-0.5, vC.w));
        }
        paint *= worn * (1.0 - clamp(fw*1.5 - 0.3, 0.0, 0.7));
        // gutter: darker band along curbs
        float gut = smoothstep(W*0.5-0.6, W*0.5-0.05, abs(v));
        asph = mix(asph, vec3(0.13,0.12,0.11), gut*0.6);
        diffuseColor.rgb = mix(asph, pc, paint);
        gRough = mix(0.85 - 0.25*smoothstep(0.55,0.75,n2), 0.6, paint);
        // street-light pools (lamps every 32 m on alternating sides)
        float du = mod(u - 10.0, 32.0) - 16.0;
        float side = mod(floor((u - 10.0)/32.0 + 0.5), 2.0) * 2.0 - 1.0;
        float dv = v - side*(W*0.5 - 1.6);
        float pool = exp(-(du*du)/45.0 - (dv*dv)/20.0);
        gEmit = vec3(1.0,0.72,0.42) * pool * 0.1 * uNight;
      }`)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = gRough;")
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance = gEmit;");
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}
