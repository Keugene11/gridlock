import * as THREE from "three";
import type { RoadNet } from "./roads";
import type { Collider } from "./collide";

export type Pose = {
  x: number; y: number; z: number; heading: number;
  phase: number; amp: number; fall: number; // fall: 0 standing .. 1 lying flat
  scale: number; shirt: THREE.Color; pants: THREE.Color; skin: THREE.Color; hair: THREE.Color; punch?: number;
};

export type Ped = Pose & {
  e: number; dir: 1 | -1; p: number; side: number; off: number; v: number;
  state: "walk" | "flee" | "down" | "dead"; t: number; vx: number; vz: number; vy: number; spin: number;
  rx: number; rz: number; id: number; wait: number;
};

const SHIRTS = [0x1c1c1e, 0x2b2f3a, 0x4a4f57, 0x6b2a2a, 0x2e4a6b, 0x7c6a55, 0xb8b2a6, 0x3d5a3a, 0x8c1c2c, 0x223344, 0x5a4636, 0xd9d4c7, 0x111111, 0x6d7f8f];
const PANTS = [0x1a1b20, 0x23324a, 0x3a3a3a, 0x4a4136, 0x15161a, 0x5b5f66, 0x2a2219];
const SKIN = [0xf1c9a5, 0xe0ac84, 0xc68863, 0x9b6a48, 0x6e4a32, 0x4a3022, 0xf6d7bd];
const HAIR = [0x1a120c, 0x2e1f14, 0x4a3524, 0x0c0c0c, 0x7a5a3a, 0xb8a37c, 0x5a5a5a];
const pick = (a: number[]) => new THREE.Color(a[Math.floor(Math.random() * a.length)]);

const MAX = 190;
const tmp = { x: 0, z: 0, tx: 0, tz: 0 };

export class Humans {
  meshes: Record<string, THREE.InstancedMesh> = {};
  peds: Ped[] = [];
  extra: Pose[] = []; // player etc.
  target = 130;
  nextId = 1;
  private m = new THREE.Matrix4(); private base = new THREE.Matrix4(); private part = new THREE.Matrix4();
  private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private s = new THREE.Vector3();

  constructor(public scene: THREE.Scene, public net: RoadNet, public col: Collider) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const leg = new THREE.CapsuleGeometry(0.075, 0.72, 3, 8).translate(0, -0.43, 0);
    const arm = new THREE.CapsuleGeometry(0.055, 0.52, 3, 6).translate(0, -0.31, 0);
    const torso = new THREE.CapsuleGeometry(0.15, 0.42, 4, 10).scale(0.72, 1, 1.32);
    const head = new THREE.SphereGeometry(0.112, 12, 10).scale(0.95, 1.08, 0.9);
    const hair = new THREE.SphereGeometry(0.118, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(-0.01, 0.015, 0);
    const shoe = new THREE.BoxGeometry(0.24, 0.08, 0.1).translate(0.05, -0.86, 0);
    const parts: Record<string, THREE.BufferGeometry> = { legL: leg, legR: leg, armL: arm, armR: arm, torso, head, hair, shoeL: shoe, shoeR: shoe };
    for (const [k, g] of Object.entries(parts)) {
      const im = new THREE.InstancedMesh(g, mat, MAX + 4);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((MAX + 4) * 3), 3);
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      this.meshes[k] = im;
      scene.add(im);
    }
  }

  newPose(): Pose {
    return { x: 0, y: 0, z: 0, heading: 0, phase: Math.random() * 6, amp: 0, fall: 0, scale: 0.92 + Math.random() * 0.16, shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKIN), hair: pick(HAIR) };
  }

  sidewalkPos(pd: Ped) {
    const e = this.net.edges[pd.e];
    this.net.at(e, pd.dir === 1 ? pd.p : e.len - pd.p, tmp);
    const tx = tmp.tx * pd.dir, tz = tmp.tz * pd.dir;
    const off = (e.w / 2 + pd.off) * pd.side;
    return { x: tmp.x - tz * off, z: tmp.z + tx * off, h: Math.atan2(tz, tx) };
  }

  populate(px: number, pz: number, night: number) {
    for (const p of [...this.peds]) {
      if (Math.hypot(p.x - px, p.z - pz) > 190) this.peds.splice(this.peds.indexOf(p), 1);
    }
    const target = Math.round(this.target * (1 - night * 0.5));
    let tries = 0;
    while (this.peds.length < target && tries++ < 30) {
      const ang = Math.random() * Math.PI * 2, R = (this.peds.length < target * 0.5 ? 15 : 70) + Math.random() * 110;
      const h = this.net.nearest(px + Math.cos(ang) * R, pz + Math.sin(ang) * R, 50, (e) => !e.hw);
      if (!h) continue;
      const e = this.net.edges[h.e];
      const pd = Object.assign(this.newPose(), {
        e: h.e, dir: (Math.random() < 0.5 ? 1 : -1) as 1 | -1, p: 0, side: Math.random() < 0.5 ? 1 : -1, off: 1.0 + Math.random() * 2.2,
        v: 1.15 + Math.random() * 0.5, state: "walk" as const, t: 0, vx: 0, vz: 0, vy: 0, spin: 0, rx: 0, rz: 0, id: this.nextId++, wait: 0,
      });
      pd.p = pd.dir === 1 ? h.s : e.len - h.s;
      const sp = this.sidewalkPos(pd);
      if (this.col.inside(sp.x, sp.z) >= 0) continue;
      pd.x = pd.rx = sp.x; pd.z = pd.rz = sp.z; pd.heading = sp.h;
      this.peds.push(pd);
    }
  }

  knock(p: Ped, vx: number, vz: number, hard: boolean) {
    p.state = "down";
    p.t = 0;
    p.vx = vx; p.vz = vz;
    p.vy = hard ? 2 + Math.hypot(vx, vz) * 0.25 : 1.2;
    p.spin = (Math.random() - 0.5) * 8;
    (p as any).hard = hard;
  }

  update(dt: number, threats: { x: number; z: number; vx: number; vz: number }[]) {
    const o = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    for (const p of [...this.peds]) {
      p.t += dt;
      if (p.state === "down") {
        p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt; p.vy -= 9.8 * dt;
        p.heading += p.spin * dt;
        if (p.y <= 0) { p.y = 0; p.vy = 0; p.vx *= 0.85; p.vz *= 0.85; p.spin *= 0.8; }
        p.fall = Math.min(1, p.fall + dt * 3.5);
        p.amp = 0;
        this.col.circle(p.x, p.z, 0.3, o);
        if (o.hit) { p.x = o.x; p.z = o.z; p.vx *= -0.3; p.vz *= -0.3; }
        if (p.t > ((p as any).hard ? 14 : 3.5)) {
          if ((p as any).hard) { this.peds.splice(this.peds.indexOf(p), 1); continue; }
          p.state = "flee"; p.t = 0; p.fall = 0;
        }
        continue;
      }
      // threats: fast cars nearby -> dodge
      if (p.state === "walk") {
        for (const th of threats) {
          const dx = p.x - th.x, dz = p.z - th.z, d = Math.hypot(dx, dz);
          const sp = Math.hypot(th.vx, th.vz);
          if (d < 9 && sp > 6 && (th.vx * dx + th.vz * dz) > 0) { p.state = "flee"; p.t = 0; break; }
        }
      }
      if (p.state === "flee") {
        // run away from the nearest threat, staying out of buildings
        let ax = 0, az = 0;
        for (const th of threats) {
          const dx = p.x - th.x, dz = p.z - th.z, d = Math.hypot(dx, dz) || 1;
          if (d < 25) { ax += dx / d / d; az += dz / d / d; }
        }
        const L = Math.hypot(ax, az);
        if (L > 0) p.heading = Math.atan2(az, ax);
        const sp = 4.2;
        p.x += Math.cos(p.heading) * sp * dt;
        p.z += Math.sin(p.heading) * sp * dt;
        this.col.circle(p.x, p.z, 0.3, o);
        if (o.hit) { p.x = o.x; p.z = o.z; p.heading += 0.8; }
        p.amp = 1; p.phase += dt * 11;
        if (p.t > 4) {
          // rejoin the sidewalk network
          const h = this.net.nearest(p.x, p.z, 40, (e) => !e.hw);
          if (h) {
            p.e = h.e; const e = this.net.edges[h.e];
            p.dir = Math.random() < 0.5 ? 1 : -1; p.p = p.dir === 1 ? h.s : e.len - h.s;
            p.side = h.lat >= 0 ? 1 : -1; p.off = Math.max(1, Math.min(3, Math.abs(h.lat) - e.w / 2));
            if (!isFinite(p.off)) p.off = 1.5;
            p.rx = p.x; p.rz = p.z;
          }
          p.state = "walk";
        }
        continue;
      }
      // walking the sidewalk graph
      if (p.wait > 0) { p.wait -= dt; p.amp *= 0.9; }
      else {
        p.p += p.v * dt;
        const e = this.net.edges[p.e];
        if (p.p >= e.len) {
          const end = p.dir === 1 ? e.b : e.a;
          const outs = this.net.any[end].filter((x) => x.e !== p.e && !this.net.edges[x.e].hw);
          if (!outs.length) { p.dir = (p.dir * -1) as 1 | -1; p.p = 0; p.side *= -1; }
          else {
            const n = outs[Math.floor(Math.random() * outs.length)];
            p.p -= e.len; p.e = n.e; p.dir = n.dir;
            if (Math.random() < 0.15) p.wait = 1 + Math.random() * 4;
          }
        }
        const sp = this.sidewalkPos(p);
        const k = Math.min(1, dt * 3);
        p.rx += (sp.x - p.rx) * k; p.rz += (sp.z - p.rz) * k;
        const mx = p.rx - p.x, mz = p.rz - p.z;
        if (mx * mx + mz * mz > 1e-5) p.heading += angd(p.heading, Math.atan2(mz, mx)) * Math.min(1, dt * 6);
        p.x = p.rx; p.z = p.rz;
        p.amp = Math.min(1, Math.hypot(mx, mz) / dt / 1.4);
        p.phase += dt * 6.2 * p.v / 1.35;
      }
    }
  }

  /** Write instance matrices for peds + extra poses (the player). */
  render(cam: THREE.Vector3) {
    let i = 0;
    const all: Pose[] = [...this.extra];
    for (const p of this.peds) if ((p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 < 170 * 170) all.push(p);
    for (const p of all) {
      if (i >= MAX + 4) break;
      this.pose(i++, p);
    }
    for (const im of Object.values(this.meshes)) {
      im.count = i;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private setPart(name: string, i: number, local: THREE.Matrix4, c: THREE.Color) {
    this.part.multiplyMatrices(this.base, local);
    this.meshes[name].setMatrixAt(i, this.part);
    this.meshes[name].setColorAt(i, c);
  }

  private pose(i: number, p: Pose) {
    const S = p.scale;
    const lying = p.fall;
    // base: position, yaw, then tip over backwards around local z as it falls
    this.e.set(0, -p.heading, 0);
    this.q.setFromEuler(this.e);
    this.base.compose(this.v.set(p.x, p.y + lying * 0.18, p.z), this.q, this.s.set(S, S, S));
    if (lying > 0) this.base.multiply(this.m.makeRotationZ(lying * Math.PI * 0.5));
    const sw = Math.sin(p.phase) * 0.55 * p.amp;
    const L = new THREE.Matrix4();
    const at = (x: number, y: number, z: number, rz: number, rx = 0) => L.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e.set(rx, 0, rz)), this.s.set(1, 1, 1));
    const bob = Math.abs(Math.cos(p.phase)) * 0.035 * p.amp;
    this.setPart("legL", i, at(0, 0.93 + bob, 0.1, sw), p.pants);
    this.setPart("legR", i, at(0, 0.93 + bob, -0.1, -sw), p.pants);
    this.setPart("shoeL", i, at(0, 0.93 + bob, 0.1, sw), SHOE);
    this.setPart("shoeR", i, at(0, 0.93 + bob, -0.1, -sw), SHOE);
    this.setPart("torso", i, at(0, 1.24 + bob, 0, 0), p.shirt);
    const punch = p.punch ?? 0;
    this.setPart("armL", i, at(0, 1.45 + bob, 0.225, -sw * 0.8, 0.08), p.shirt);
    this.setPart("armR", i, at(punch > 0 ? 0.05 : 0, 1.45 + bob, -0.225, punch > 0 ? Math.PI / 2 * punch : sw * 0.8, -0.08), p.shirt);
    this.setPart("head", i, at(0, 1.66 + bob, 0, 0), p.skin);
    this.setPart("hair", i, at(0, 1.66 + bob, 0, 0), p.hair);
  }
}
const SHOE = new THREE.Color(0x151515);
function angd(a: number, b: number) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
