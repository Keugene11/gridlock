import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Building } from "./data";

export const U = { uNight: { value: 0 }, uTime: { value: 0 } };

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function styleOf(b: Building, seed: number) {
  const yr = b.yr || 1925, h = b.h;
  if (yr >= 1985 && h > 45) return 0;
  if (h > 90 && yr >= 1955) return seed < 0.55 ? 0 : 1;
  if (yr >= 1955 && h > 22) return seed < 0.3 ? 1 : 4;
  if (yr < 1950 && h > 30) return 2;
  if (h <= 30) return seed < 0.18 ? 2 : 3;
  return 4;
}
const FLOOR = [4.0, 3.9, 3.6, 3.2, 2.9];

const GLSL_COMMON = /* glsl */ `
uniform float uNight; uniform float uTime;
varying vec2 vW; varying vec4 vB;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float boxAA(float x, float a, float b, float fw){ fw = max(fw, 1e-4); return smoothstep(a-fw,a+fw,x) - smoothstep(b-fw,b+fw,x); }
float gRough = 0.9; float gMetal = 0.0; vec3 gEmit = vec3(0.0);
`;

const FACADE = /* glsl */ `
{
  float seed = floor(vB.x*997.0+0.5)/997.0; float style = floor(vB.y+0.5); float H = vB.z; float fh = vB.w;
  vec2 w = vW;
  vec3 wall; float colW; vec2 wx; vec2 wy;
  vec3 glassC = vec3(0.045,0.06,0.075);
  float r1 = h21(vec2(seed*91.0, 3.1)), r2 = h21(vec2(seed*17.0, 7.7));
  if (style < 0.5) {
    wall = mix(vec3(0.30,0.32,0.34), vec3(0.58,0.59,0.58), r1); colW = 1.5; wx = vec2(0.05,0.95); wy = vec2(0.10,0.96);
    glassC = mix(vec3(0.05,0.08,0.11), vec3(0.08,0.11,0.10), r2);
  } else if (style < 1.5) {
    wall = mix(vec3(0.56,0.55,0.52), vec3(0.40,0.38,0.36), r1); colW = 1.6; wx = vec2(0.04,0.96); wy = vec2(0.34,0.88);
  } else if (style < 2.5) {
    wall = mix(vec3(0.70,0.63,0.52), vec3(0.60,0.50,0.40), r1); colW = 2.4; wx = vec2(0.28,0.72); wy = vec2(0.22,0.82);
  } else if (style < 3.5) {
    wall = mix(mix(vec3(0.40,0.19,0.13), vec3(0.34,0.25,0.19), r1), vec3(0.56,0.45,0.35), step(0.78,r2)); colW = 2.2; wx = vec2(0.27,0.73); wy = vec2(0.20,0.80);
  } else {
    wall = mix(vec3(0.74,0.70,0.62), vec3(0.60,0.56,0.50), r1); colW = 2.0; wx = vec2(0.2,0.8); wy = vec2(0.25,0.78);
  }
  float gh = style < 1.5 ? 5.5 : 4.2;
  vec2 fw2 = fwidth(w);
  float fwx = fw2.x/colW, fwy = fw2.y/fh;
  float lod = clamp(max(fwx, fwy)*2.2 - 0.3, 0.0, 1.0);
  float isGround = step(w.y, gh) * step(8.0, H);
  float top = step(H - 1.1, w.y) * step(8.0, H);
  float fy = (w.y - gh)/fh;
  float fi = floor(fy);
  float ci = floor(w.x/colW);
  vec2 f = vec2(fract(w.x/colW), fract(fy));
  float cover = (wx.y-wx.x)*(wy.y-wy.x);
  float win = boxAA(f.x, wx.x, wx.y, fwx) * boxAA(f.y, wy.x, wy.y, fwy);
  win = mix(win, cover, lod) * (1.0 - top) * (1.0 - isGround);
  if (H < 8.0) win *= step(1.0, w.y) * step(w.y, H - 0.8);
  float sf = 0.0; vec3 sfEmit = vec3(0.0);
  if (isGround > 0.5) {
    float sc = floor(w.x / 5.0); float sx = fract(w.x/5.0);
    float fsx = fw2.x/5.0;
    sf = boxAA(sx, 0.07, 0.93, fsx) * boxAA(w.y, 0.35, gh-1.15, fw2.y);
    float hs = h21(vec2(sc, seed*31.0));
    vec3 signC = 0.5 + 0.5*cos(6.2831*(hs + vec3(0.0,0.33,0.67)));
    float band = boxAA(w.y, gh-1.05, gh-0.25, fw2.y);
    wall = mix(wall, signC*0.3, band*0.85);
    float shelf = 0.75 + 0.25*step(0.5, fract(w.y*1.3 + hs));
    sfEmit = mix(vec3(1.0,0.72,0.42), vec3(0.85,0.92,1.0), step(0.62,hs)) * (0.25 + 0.9*hs) * step(0.22, hs) * sf * (0.3 + 0.7*smoothstep(0.3, gh-1.2, w.y)) * shelf;
    sfEmit += signC * band * step(0.5, hs) * 1.6;
  }
  float grime = 0.8 + 0.2*smoothstep(0.0, 14.0, w.y);
  float flVar = 0.95 + 0.1*h21(vec2(fi, seed*7.0));
  float bv = mix(0.92 + 0.16*h21(floor(w*vec2(4.0,13.0)) + seed), 1.0, clamp(fw2.x*6.0, 0.0, 1.0));
  vec3 wallC = wall * grime * flVar * bv;
  wallC *= 1.0 - top*0.25;
  float hw = h21(vec2(ci, fi) + seed*113.0);
  float thr = mix(0.995, 0.62 - 0.1*step(style,0.5), uNight);
  float lit = step(thr, hw);
  vec3 litC = mix(vec3(1.0,0.70,0.40), vec3(0.82,0.9,1.0), step(0.68, h21(vec2(fi,ci)*1.7+seed)));
  litC *= 0.6 + 1.5*h21(vec2(ci*3.0, fi+seed));
  vec3 glass = glassC * (0.65 + 0.7*h21(vec2(ci,fi)*0.37+seed));
  float wsum = max(win, sf);
  diffuseColor.rgb = mix(wallC, glass, wsum);
  gRough = mix(0.9, mix(0.08, 0.35, lod), wsum);
  gMetal = mix(0.0, 0.8, wsum);
  vec3 emitWin = mix(litC*lit, vec3(1.0,0.82,0.6)*0.9*(1.0-thr), lod);
  gEmit = (emitWin * win * 0.8 + sfEmit * 0.5) * smoothstep(0.05, 0.9, uNight);
}
`;

export function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = U.uNight;
    s.uniforms.uTime = U.uTime;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aUV; attribute vec4 aB; varying vec2 vW; varying vec4 vB;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvW = aUV; vB = aB;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\n" + GLSL_COMMON)
      .replace("#include <map_fragment>", FACADE)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = gRough;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = gMetal;")
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance = gEmit;");
  };
  return m;
}

export type CityOut = { group: THREE.Group; beacons: THREE.Vector3[] };

export function buildCity(buildings: Building[], isInside: (x: number, z: number) => number): CityOut {
  const group = new THREE.Group();
  const wallMat = facadeMaterial();
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x46474a, roughness: 0.95 });
  roofMat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWP = (modelMatrix*vec4(transformed,1.0)).xyz;");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;\nfloat rh(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }")
      .replace("#include <map_fragment>", "diffuseColor.rgb *= 0.75 + 0.5*rh(floor(vWP.xz*0.25)) * 0.6 + 0.15*rh(floor(vWP.xz*3.0));");
  };
  const CH = 500;
  const chunks = new Map<string, Building[]>();
  buildings.forEach((b) => {
    const k = Math.floor(b.cx / CH) + "," + Math.floor(b.cz / CH);
    let a = chunks.get(k);
    if (!a) chunks.set(k, (a = []));
    a.push(b);
  });
  const beacons: THREE.Vector3[] = [];
  const towers: THREE.Matrix4[] = [], hvac: THREE.Matrix4[] = [];
  const tmpM = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  let bid = 0;
  for (const list of chunks.values()) {
    let nv = 0;
    for (const b of list) nv += (b.pts.length / 2) * 4;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ab = new Float32Array(nv * 4);
    const idx: number[] = [];
    const rpos: number[] = [], ridx: number[] = [];
    let v = 0;
    for (const b of list) {
      bid++;
      const seed = hash(bid * 1.37 + b.cx * 0.01);
      const st = styleOf(b, seed);
      const fh = FLOOR[st] * (0.95 + 0.1 * hash(bid + 9));
      const p = b.pts, m = p.length / 2;
      let u = 0;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 0.05) continue;
        const nx = (z1 - z0) / L, nz = -(x1 - x0) / L;
        const base = v;
        const P = [[x0, 0, z0], [x1, 0, z1], [x1, b.h, z1], [x0, b.h, z0]];
        const UV = [[u, 0], [u + L, 0], [u + L, b.h], [u, b.h]];
        for (let k = 0; k < 4; k++) {
          pos.set(P[k], v * 3);
          nor.set([nx, 0, nz], v * 3);
          uv.set(UV[k], v * 2);
          ab.set([seed, st, b.h, fh], v * 4);
          v++;
        }
        idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
        u += L;
      }
      // roof
      const contour: THREE.Vector2[] = [];
      for (let i = 0; i < m; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const rb = rpos.length / 3;
      for (let i = 0; i < m; i++) rpos.push(p[i * 2], b.h, p[i * 2 + 1]);
      for (const t of tris) {
        const [a, c, d] = t;
        const ax = p[a * 2], az = p[a * 2 + 1], cx = p[c * 2], cz = p[c * 2 + 1], dx = p[d * 2], dz = p[d * 2 + 1];
        const cr = (cx - ax) * (dz - az) - (cz - az) * (dx - ax);
        if (cr > 0) ridx.push(rb + a, rb + d, rb + c);
        else ridx.push(rb + a, rb + c, rb + d);
      }
      // rooftop dressing
      const inside = isInside(b.cx, b.cz) >= 0;
      if (inside && b.area > 180 && b.h > 14 && b.h < 95 && (b.yr || 1925) < 1975 && hash(bid * 3.3) < 0.42) {
        const s = 0.8 + 0.4 * hash(bid * 5.1);
        ps.set(b.cx + (hash(bid) - 0.5) * 3, b.h, b.cz + (hash(bid * 2) - 0.5) * 3);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(bid * 7) * 6.28);
        if (isInside(ps.x, ps.z) >= 0) towers.push(new THREE.Matrix4().compose(ps.clone(), q.clone(), sc.set(s, s, s).clone()));
      } else if (inside && b.area > 120 && b.h > 8 && hash(bid * 4.4) < 0.6) {
        const n = 1 + Math.floor(hash(bid * 8.8) * 3);
        for (let k = 0; k < n; k++) {
          ps.set(b.cx + (hash(bid * 11 + k) - 0.5) * Math.sqrt(b.area) * 0.4, b.h, b.cz + (hash(bid * 13 + k) - 0.5) * Math.sqrt(b.area) * 0.4);
          if (isInside(ps.x, ps.z) < 0) continue;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(bid * 17 + k) * 6.28);
          const s = 0.7 + hash(bid * 19 + k) * 1.2;
          hvac.push(new THREE.Matrix4().compose(ps.clone(), q.clone(), new THREE.Vector3(s, 0.6 + hash(bid + k) * 0.8, s)));
        }
      }
      if (b.h > 140 && inside) beacons.push(new THREE.Vector3(b.cx, b.h + 1.5, b.cz));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    g.setAttribute("aUV", new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
    g.setAttribute("aB", new THREE.BufferAttribute(ab.subarray(0, v * 4), 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const wm = new THREE.Mesh(g, wallMat);
    wm.castShadow = wm.receiveShadow = true;
    group.add(wm);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.Float32BufferAttribute(rpos, 3));
    rg.setIndex(ridx);
    rg.computeVertexNormals();
    rg.computeBoundingSphere();
    const rm = new THREE.Mesh(rg, roofMat);
    rm.castShadow = rm.receiveShadow = true;
    group.add(rm);
  }
  void tmpM;

  // water towers: wooden tank on a steel stand
  const wood = new THREE.Color(0x5a4232), steel = new THREE.Color(0x2b2b2d);
  const col = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g;
  };
  const parts: THREE.BufferGeometry[] = [];
  parts.push(col(new THREE.CylinderGeometry(1.9, 2.0, 3.8, 18).translate(0, 3.6 + 1.9, 0), wood));
  parts.push(col(new THREE.ConeGeometry(2.1, 1.3, 18).translate(0, 3.6 + 3.8 + 0.65, 0), wood.clone().multiplyScalar(0.8)));
  parts.push(col(new THREE.CylinderGeometry(2.2, 2.2, 0.25, 18).translate(0, 3.5, 0), steel));
  for (const [x, z] of [[1.3, 1.3], [-1.3, 1.3], [1.3, -1.3], [-1.3, -1.3]]) parts.push(col(new THREE.CylinderGeometry(0.1, 0.12, 3.5, 6).translate(x, 1.75, z), steel));
  for (let k = 0; k < 3; k++) parts.push(col(new THREE.TorusGeometry(1.97, 0.04, 4, 24).rotateX(Math.PI / 2).translate(0, 4.4 + k * 1.2, 0), steel));
  const tg = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  const tm = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), towers.length);
  towers.forEach((m, i) => tm.setMatrixAt(i, m));
  tm.castShadow = tm.receiveShadow = true;
  group.add(tm);
  const hg = new THREE.BoxGeometry(2, 1.4, 1.6).translate(0, 0.7, 0);
  const hm = new THREE.InstancedMesh(hg, new THREE.MeshStandardMaterial({ color: 0x8a8c8e, roughness: 0.6, metalness: 0.4 }), hvac.length);
  hvac.forEach((m, i) => hm.setMatrixAt(i, m));
  hm.castShadow = hm.receiveShadow = true;
  group.add(hm);
  return { group, beacons };
}
