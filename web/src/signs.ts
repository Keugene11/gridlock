import * as THREE from "three";
import type { Building } from "./data";
import { U } from "./city";

/** Giant animated LED billboards on the facades around Times Square. */
export function buildBillboards(buildings: Building[], cx: number, cz: number, R = 150) {
  const pos: number[] = [], uv: number[] = [], sd: number[] = [], idx: number[] = [];
  let n = 0;
  for (const b of buildings) {
    if ((b.cx - cx) ** 2 + (b.cz - cz) ** 2 > (R + 60) ** 2 || b.h < 14) continue;
    const p = b.pts, m = p.length / 2;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 9) continue;
      const nx = (z1 - z0) / L, nz = -(x1 - x0) / L;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const dc = Math.hypot(mx - cx, mz - cz);
      if (dc > R) continue;
      // must face the open street (normal points away from the building into the square-ish)
      const tx = cx - mx, tz = cz - mz;
      if ((tx * nx + tz * nz) / (dc || 1) < -0.2 && dc > 40) continue;
      const seed = Math.random();
      const panels = 1 + Math.floor(Math.random() * 2);
      let y = 6 + Math.random() * 3;
      for (let k = 0; k < panels && y < b.h - 4; k++) {
        const h = Math.min(b.h - y - 2, 6 + Math.random() * 16);
        if (h < 4) break;
        const inset = Math.min(L * 0.15, 2);
        const ax = x0 + ((x1 - x0) / L) * inset, az = z0 + ((z1 - z0) / L) * inset;
        const bx = x1 - ((x1 - x0) / L) * inset, bz = z1 - ((z1 - z0) / L) * inset;
        const o = 0.35;
        const P = [[ax + nx * o, y, az + nz * o], [bx + nx * o, y, bz + nz * o], [bx + nx * o, y + h, bz + nz * o], [ax + nx * o, y + h, az + nz * o]];
        const w = L - inset * 2;
        P.forEach((q, qi) => {
          pos.push(...q);
          uv.push(qi === 1 || qi === 2 ? w : 0, qi >= 2 ? h : 0);
          sd.push(seed + k * 0.37, w, h, Math.floor(Math.random() * 4));
        });
        idx.push(n, n + 3, n + 2, n, n + 2, n + 1);
        n += 4;
        y += h + 1.5 + Math.random() * 4;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aUV", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aS", new THREE.Float32BufferAttribute(sd, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: U.uTime, uNight: U.uNight },
    vertexShader: /* glsl */ `
      attribute vec2 aUV; attribute vec4 aS; varying vec2 vU; varying vec4 vS;
      #include <common>
      #include <fog_pars_vertex>
      void main(){ vU = aUV; vS = aS; vec4 mvPosition = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uNight; varying vec2 vU; varying vec4 vS;
      #include <common>
      #include <fog_pars_fragment>
      float h1(float x){ return fract(sin(x*91.7)*43758.5); }
      vec3 pal(float t){ return 0.5 + 0.5*cos(6.2831*(t + vec3(0.0, 0.33, 0.67))); }
      void main(){
        vec2 uv = vU / vS.yz; float seed = floor(vS.x*997.0+0.5)/997.0; float kind = floor(vS.w+0.5);
        float slot = floor(uTime/7.0 + seed*5.0);
        float s2 = h1(slot + seed*13.0);
        vec3 c;
        float t = uTime;
        if (kind < 0.5) { // big gradient ad with a "product" blob
          vec2 q = uv - vec2(0.5 + 0.25*sin(t*0.6+seed*6.0), 0.5);
          c = mix(pal(s2), pal(s2+0.4), uv.y) * (0.6 + 0.4*smoothstep(0.45, 0.0, length(q*vec2(vS.y/vS.z,1.0))*0.6));
          c += step(abs(uv.y-0.18), 0.05) * step(abs(fract(uv.x*6.0 - t*0.4)-0.5), 0.3) * 0.8;
        } else if (kind < 1.5) { // ticker
          float row = floor(uv.y*3.0);
          float chars = step(0.45, h1(floor(uv.x*vS.y*1.2 - t*14.0*(0.6+row*0.2)) + row*7.0 + slot));
          c = mix(vec3(0.02,0.02,0.05), pal(s2+row*0.2)*1.2, chars*step(0.15, fract(uv.y*3.0))*step(fract(uv.y*3.0),0.85));
        } else if (kind < 2.5) { // video wall: moving bands
          float b = sin(uv.x*8.0 + t*2.0 + seed*10.0) + sin(uv.y*6.0 - t*1.4) + sin((uv.x+uv.y)*5.0 + t);
          c = pal(b*0.15 + s2 + t*0.03) * (0.5 + 0.5*smoothstep(-1.0, 2.0, b));
        } else { // brand logo on solid
          vec2 q = (uv - 0.5) * vec2(vS.y/vS.z, 1.0);
          float logo = smoothstep(0.32, 0.3, length(q)) - smoothstep(0.2, 0.18, length(q - vec2(0.08*sin(t), 0.0)));
          c = mix(pal(s2)*0.35, vec3(1.0), logo);
        }
        float px = step(0.18, fract(uv.x*vS.y*5.0)) * step(0.18, fract(uv.y*vS.z*5.0)); px = mix(px, 0.67, clamp(fwidth(vU.x)*8.0, 0.0, 1.0));
        c *= mix(1.0, 0.8 + 0.2*px, 0.6);
        float frame = step(0.01, uv.x)*step(uv.x,0.99)*step(0.015,uv.y)*step(uv.y,0.985);
        c = mix(vec3(0.02), c, frame);
        gl_FragColor = vec4(c * (0.9 + uNight*0.9), 1.0);
        #include <fog_fragment>
      }`,
    fog: true,
  });
  const mesh = new THREE.Mesh(g, mat);
  return mesh;
}
