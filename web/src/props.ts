import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { World } from "./data";
import type { RoadNet } from "./roads";

const rnd = (n: number) => { const x = Math.sin(n * 91.345 + 47.853) * 43758.5453; return x - Math.floor(x); };

function colorize(g: THREE.BufferGeometry, f: (x: number, y: number, z: number) => [number, number, number]) {
  g = g.index ? g.toNonIndexed() : g;
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c.set(f(p.getX(i), p.getY(i), p.getZ(i)), i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

function blob(r: number, x: number, y: number, z: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = 0.78 + 0.44 * rnd(Math.floor(vx * 7.1 + vy * 13.3 + vz * 5.7 + seed));
    p.setXYZ(i, vx * k + x, vy * k * 0.85 + y, vz * k + z);
  }
  return g;
}

function treeGeoms() {
  const bark = (): [number, number, number] => [0.22, 0.17, 0.13];
  const leaf = (x: number, y: number, z: number): [number, number, number] => {
    const v = 0.75 + 0.5 * rnd(x * 3.1 + y * 7.7 + z * 1.3);
    return [v, v, v];
  };
  // broadleaf (London plane / oak / maple)
  const t0 = [colorize(new THREE.CylinderGeometry(0.14, 0.22, 4.2, 6).translate(0, 2.1, 0), bark)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    t0.push(colorize(blob(1.9 + rnd(i) * 0.6, Math.cos(a) * 1.3, 5.2 + rnd(i + 4) * 1.2, Math.sin(a) * 1.3, i), leaf));
  }
  t0.push(colorize(blob(2.1, 0, 6.6, 0, 9), leaf));
  // conifer
  const t1 = [colorize(new THREE.CylinderGeometry(0.12, 0.18, 2.0, 6).translate(0, 1.0, 0), bark)];
  for (let i = 0; i < 3; i++) t1.push(colorize(new THREE.ConeGeometry(2.2 - i * 0.55, 2.8, 8).translate(0, 2.6 + i * 1.6, 0), leaf));
  // honey locust / pear (smaller, airy)
  const t2 = [colorize(new THREE.CylinderGeometry(0.1, 0.16, 3.6, 6).translate(0, 1.8, 0), bark)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    t2.push(colorize(blob(1.1 + rnd(i + 20) * 0.5, Math.cos(a) * 1.4, 4.3 + rnd(i + 30) * 1.4, Math.sin(a) * 1.4, i + 50), leaf));
  }
  return [t0, t1, t2].map((a) => mergeGeometries(a));
}

function inRing(r: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export class Props {
  group = new THREE.Group();
  trees: { x: number; z: number; k: number; s: number; r: number; c: THREE.Color }[] = [];
  tgrid = new Map<number, number[]>();
  treeMeshes: THREE.InstancedMesh[] = [];
  lampHeads: THREE.InstancedMesh;
  lampMat: THREE.MeshBasicMaterial;
  sigLights: THREE.InstancedMesh;
  sig: { n: number; axis: number }[] = [];
  beacon: THREE.InstancedMesh;
  beaconMat: THREE.MeshBasicMaterial;
  lamps: Float32Array; // x,z of lamp heads (for car headlight-free night lighting hints)

  constructor(w: World, net: RoadNet, inside: (x: number, z: number) => number, beacons: THREE.Vector3[]) {
    // ---- trees: real street-tree census + scattered park trees
    const autumn = [0x5c6b2a, 0x7a7a22, 0xa07a1e, 0xb05a18, 0x8a3c14, 0x6b5a2a, 0x4e5e26, 0xc09030].map((c) => new THREE.Color(c));
    const addTree = (x: number, z: number, k: number, i: number) => {
      const c = autumn[Math.floor(rnd(i * 1.7) * autumn.length)].clone();
      if (k === 1) c.set(0x2e4a2a);
      this.trees.push({ x, z, k, s: 0.75 + rnd(i * 3.3) * 0.6, r: rnd(i * 5.5) * 6.28, c });
    };
    const T = w.trees;
    for (let i = 0; i < T.length / 3; i++) addTree(T[i * 3] / 2, T[i * 3 + 1] / 2, T[i * 3 + 2], i);
    let pi = 900000;
    for (const poly of w.parks) {
      const r = poly[0];
      let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
      for (let i = 0; i < r.length; i += 2) { minx = Math.min(minx, r[i]); maxx = Math.max(maxx, r[i]); minz = Math.min(minz, r[i + 1]); maxz = Math.max(maxz, r[i + 1]); }
      const area = (maxx - minx) * (maxz - minz);
      const n = Math.min(4000, Math.floor(area / 140));
      for (let k = 0; k < n; k++) {
        const x = minx + rnd(pi++) * (maxx - minx), z = minz + rnd(pi++) * (maxz - minz);
        if (!inRing(r, x, z) || poly.slice(1).some((h) => inRing(h, x, z))) continue;
        if (inside(x, z) >= 0) continue;
        if (net.nearest(x, z, 8)) continue;
        addTree(x, z, rnd(pi) < 0.12 ? 1 : 0, pi++);
      }
    }
    this.trees.forEach((t, i) => {
      const key = Math.floor(t.x / 100) * 10000 + Math.floor(t.z / 100);
      let a = this.tgrid.get(key);
      if (!a) this.tgrid.set(key, (a = []));
      a.push(i);
    });
    const tmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    for (const g of treeGeoms()) {
      const m = new THREE.InstancedMesh(g, tmat, 9000);
      m.count = 0;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(9000 * 3), 3);
      this.treeMeshes.push(m);
      this.group.add(m);
    }

    // ---- street lights (cobra-head poles, alternating sides every 32 m — matches the road shader pools)
    const pole = mergeGeometries([
      new THREE.CylinderGeometry(0.09, 0.13, 8.5, 6).translate(0, 4.25, 0),
      new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5).rotateZ(Math.PI / 2).translate(1.1, 8.4, 0),
      new THREE.BoxGeometry(0.7, 0.22, 0.38).translate(2.15, 8.35, 0),
    ].map((g) => g.toNonIndexed()));
    const lampPts: number[] = [];
    const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
    const mats: THREE.Matrix4[] = [], heads: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const e of w.edges) {
      for (let k = 0, u = 10; u < e.len - 4; k++, u += 32) {
        net.at(e, u, tmp);
        const side = (k % 2) * 2 - 1;
        const rx = -tmp.tz, rz = tmp.tx;
        const off = e.w / 2 + 0.45;
        const px = tmp.x + rx * side * off, pz = tmp.z + rz * side * off;
        if (inside(px, pz) >= 0) continue;
        // arm points toward the road: local +x -> -side*right
        const ax = -rx * side, az = -rz * side;
        q.setFromAxisAngle(up, Math.atan2(-az, ax));
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), q.clone(), one));
        heads.push(new THREE.Matrix4().compose(new THREE.Vector3(px + ax * 2.15, 8.22, pz + az * 2.15), q.clone(), one));
        lampPts.push(px + ax * 2.15, pz + az * 2.15);
      }
    }
    this.lamps = new Float32Array(lampPts);
    const pm = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x3a3d3f, roughness: 0.5, metalness: 0.6 }), mats.length);
    mats.forEach((m, i) => pm.setMatrixAt(i, m));
    pm.castShadow = true;
    this.group.add(pm);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    this.lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.06, 0.3), this.lampMat, heads.length);
    heads.forEach((m, i) => this.lampHeads.setMatrixAt(i, m));
    this.group.add(this.lampHeads);

    // ---- traffic signals
    const sigPole = mergeGeometries([
      new THREE.CylinderGeometry(0.1, 0.12, 4.6, 6).translate(0, 2.3, 0),
      new THREE.BoxGeometry(0.38, 1.1, 0.32).translate(0, 4.3, 0),
    ].map((g) => g.toNonIndexed()));
    const sp: THREE.Matrix4[] = [], sl: THREE.Matrix4[] = [];
    for (let n = 0; n < net.nodes.length; n++) {
      if (!net.signal[n]) continue;
      const [nx, nz] = net.nodes[n];
      for (const o of net.any[n]) {
        const e = w.edges[o.e];
        const s = o.dir === 1 ? Math.min(e.len, (e.clA || 6) + 1) : Math.max(0, e.len - (e.clB || 6) - 1);
        net.at(e, s, tmp);
        let tx = tmp.tx * o.dir, tz = tmp.tz * o.dir; // pointing away from node
        const rx = -tz, rz = tx;
        const px = tmp.x + rx * (e.w / 2 + 0.6), pz = tmp.z + rz * (e.w / 2 + 0.6);
        if (inside(px, pz) >= 0) continue;
        q.setFromAxisAngle(up, Math.atan2(-tz, tx) + Math.PI / 2);
        sp.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), q.clone(), one));
        for (let k = 0; k < 3; k++) sl.push(new THREE.Matrix4().compose(new THREE.Vector3(px + tx * 0.17, 4.65 - k * 0.34, pz + tz * 0.17), q.clone(), one));
        this.sig.push({ n, axis: e.axis });
        void nx; void nz;
      }
    }
    const spm = new THREE.InstancedMesh(sigPole, new THREE.MeshStandardMaterial({ color: 0x2c3a2a, roughness: 0.6, metalness: 0.4 }), sp.length);
    sp.forEach((m, i) => spm.setMatrixAt(i, m));
    spm.castShadow = true;
    this.group.add(spm);
    this.sigLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), sl.length);
    sl.forEach((m, i) => this.sigLights.setMatrixAt(i, m));
    this.sigLights.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sl.length * 3), 3);
    this.group.add(this.sigLights);

    // ---- aircraft warning beacons on skyscrapers
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    this.beacon = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 8, 6), this.beaconMat, Math.max(1, beacons.length));
    beacons.forEach((b, i) => this.beacon.setMatrixAt(i, new THREE.Matrix4().makeTranslation(b.x, b.y, b.z)));
    this.beacon.count = beacons.length;
    this.group.add(this.beacon);
  }

  private lastTree = new THREE.Vector3(1e9, 0, 0);
  private sigT = 0;
  update(cam: THREE.Vector3, t: number, night: number, net: RoadNet) {
    if (cam.distanceTo(this.lastTree) > 30) {
      this.lastTree.copy(cam);
      const R = 520, cnt = [0, 0, 0];
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      const gx = Math.floor(cam.x / 100), gz = Math.floor(cam.z / 100), r = Math.ceil(R / 100);
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const a = this.tgrid.get((gx + dx) * 10000 + gz + dz);
          if (!a) continue;
          for (const i of a) {
            const tr = this.trees[i];
            if ((tr.x - cam.x) ** 2 + (tr.z - cam.z) ** 2 > R * R) continue;
            const mesh = this.treeMeshes[tr.k];
            if (cnt[tr.k] >= 9000) continue;
            q.setFromAxisAngle(up, tr.r);
            m.compose(p.set(tr.x, 0, tr.z), q, s.set(tr.s, tr.s, tr.s));
            mesh.setMatrixAt(cnt[tr.k], m);
            mesh.setColorAt(cnt[tr.k], tr.c);
            cnt[tr.k]++;
          }
        }
      this.treeMeshes.forEach((mm, k) => {
        mm.count = cnt[k];
        mm.instanceMatrix.needsUpdate = true;
        if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
      });
    }
    const lampOn = THREE.MathUtils.smoothstep(night, 0.15, 0.6);
    this.lampMat.color.setRGB(0.18 + lampOn * 3.2, 0.17 + lampOn * 2.1, 0.15 + lampOn * 1.1);
    this.beaconMat.color.setRGB((Math.sin(t * 3) > 0.2 ? 1 : 0.05) * (1 + night * 6), 0.02, 0.0);
    if ((this.sigT -= 1 / 60) <= 0) {
      this.sigT = 0.2;
      const c = new THREE.Color();
      const I = 2.5 + night * 4;
      this.sig.forEach((s, i) => {
        const st = net.light(s.n, s.axis, t);
        for (let k = 0; k < 3; k++) {
          const on = (k === 0 && st === 2) || (k === 1 && st === 1) || (k === 2 && st === 0);
          if (!on) c.setRGB(0.04, 0.04, 0.04);
          else if (k === 0) c.setRGB(I, 0.05, 0.02);
          else if (k === 1) c.setRGB(I, I * 0.55, 0.0);
          else c.setRGB(0.05, I * 0.9, I * 0.55);
          this.sigLights.setColorAt(i * 3 + k, c);
        }
      });
      if (this.sigLights.instanceColor) this.sigLights.instanceColor.needsUpdate = true;
    }
  }
}
