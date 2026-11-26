import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Collider } from "./collide";

export type Kind = "sedan" | "taxi" | "police" | "suv" | "van" | "bus" | "sports";

type Spec = { L: number; W: number; belt: number; roof: number; wheelR: number; wb: number; accel: number; vmax: number; grip: number; mass: number };
export const SPECS: Record<Kind, Spec> = {
  sedan: { L: 4.8, W: 1.85, belt: 0.95, roof: 1.45, wheelR: 0.34, wb: 2.8, accel: 7.5, vmax: 50, grip: 7, mass: 1500 },
  taxi: { L: 4.9, W: 1.9, belt: 1.0, roof: 1.55, wheelR: 0.35, wb: 2.85, accel: 7.0, vmax: 48, grip: 7, mass: 1700 },
  police: { L: 5.0, W: 1.95, belt: 1.0, roof: 1.55, wheelR: 0.36, wb: 2.95, accel: 9.5, vmax: 60, grip: 8, mass: 1900 },
  suv: { L: 5.0, W: 2.0, belt: 1.15, roof: 1.85, wheelR: 0.4, wb: 2.95, accel: 7.0, vmax: 47, grip: 6.5, mass: 2300 },
  van: { L: 6.6, W: 2.2, belt: 1.25, roof: 2.9, wheelR: 0.42, wb: 3.9, accel: 4.5, vmax: 36, grip: 5.5, mass: 4200 },
  bus: { L: 12.2, W: 2.55, belt: 1.2, roof: 3.2, wheelR: 0.5, wb: 7.0, accel: 3.0, vmax: 26, grip: 5, mass: 13000 },
  sports: { L: 4.5, W: 1.95, belt: 0.82, roof: 1.2, wheelR: 0.34, wb: 2.65, accel: 12.5, vmax: 75, grip: 9.5, mass: 1400 },
};

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0f13, metalness: 0.2, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.4 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.25, metalness: 1 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.55, metalness: 0.2 });
const paintCache = new Map<number, THREE.MeshPhysicalMaterial>();
export function paint(hex: number) {
  let m = paintCache.get(hex);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
    paintCache.set(hex, m);
  }
  return m;
}

function extrude(pts: [number, number][], depth: number, bevel = 0.06) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

const geoCache = new Map<string, any>();
function bodyGeo(kind: Kind) {
  if (geoCache.has(kind)) return geoCache.get(kind);
  const s = SPECS[kind];
  const h = s.L / 2, W = s.W;
  let body: [number, number][], cabin: [number, number][], roof: [number, number][];
  const b = s.belt, r = s.roof, y0 = 0.28;
  if (kind === "van") {
    body = [[-h, y0], [h, y0], [h, 1.05], [h - 0.35, b], [h - 1.0, b + 0.2], [h - 1.25, b + 0.25], [-h, b + 0.25]];
    cabin = [[h - 1.3, b + 0.2], [h - 0.95, b + 0.2], [h - 1.3, 2.05], [h - 1.9, 2.05]];
    roof = [[-h, b + 0.2], [h - 1.9, b + 0.2], [h - 1.9, r], [-h, r]];
  } else if (kind === "bus") {
    body = [[-h, y0], [h, y0], [h, b], [-h, b]];
    cabin = [[-h + 0.1, b], [h - 0.05, b], [h - 0.05, r - 0.35], [-h + 0.1, r - 0.35]];
    roof = [[-h, r - 0.38], [h, r - 0.38], [h - 0.15, r], [-h + 0.1, r]];
  } else {
    const hood = kind === "sports" ? 1.5 : kind === "suv" ? 1.25 : 1.35;
    const trunk = kind === "suv" ? 0.25 : kind === "sports" ? 0.85 : 0.95;
    body = [[-h, y0 + 0.05], [-h + 0.15, y0], [h - 0.2, y0], [h, y0 + 0.12], [h, b - 0.18], [h - 0.25, b - 0.05], [h - hood, b + 0.02], [-h + trunk, b + 0.02], [-h, b - 0.05]];
    const ws = h - hood, rw = -h + trunk;
    const rf = kind === "suv" ? 0.25 : 0.45, rb = kind === "suv" ? 0.05 : 0.5;
    cabin = [[rw - 0.05, b], [ws + 0.05, b], [ws - (r - b) * 1.25 + rf * 0.3, r - 0.06], [rw + (r - b) * (kind === "suv" ? 0.15 : 0.9) + rb * 0.2, r - 0.06]];
    roof = [[cabin[3][0] - 0.02, r - 0.09], [cabin[2][0] + 0.02, r - 0.09], [cabin[2][0] - 0.05, r], [cabin[3][0] + 0.05, r]];
  }
  const g = {
    body: extrude(body, W, 0.08),
    cabin: extrude(cabin, W - 0.16, 0.05),
    roof: extrude(roof, W - 0.12, 0.04),
  };
  geoCache.set(kind, g);
  return g;
}

let taxiTex: THREE.CanvasTexture | null = null;
function taxiSign() {
  if (taxiTex) return taxiTex;
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff7d8"; x.fillRect(0, 0, 256, 64);
  x.fillStyle = "#1a1a1a"; x.font = "bold 44px Arial"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText("TAXI", 128, 34);
  taxiTex = new THREE.CanvasTexture(c);
  taxiTex.colorSpace = THREE.SRGBColorSpace;
  return taxiTex;
}

const COLORS = [0x1b1c1e, 0xdedfe0, 0x8d9195, 0x2a3f5f, 0x5a1218, 0x1e2b24, 0x3d3f42, 0xc9c6bd, 0x0e2a4a, 0x6b6e72];

export class Vehicle {
  kind: Kind;
  spec: Spec;
  group = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Object3D[] = [];
  x = 0; z = 0; heading = 0; // forward = (cos h, sin h)
  vx = 0; vz = 0; yaw = 0;
  steer = 0; throttle = 0; brake = 0; hand = 0;
  speed = 0; fwd = 0; lat = 0;
  damage = 0;
  driver: "player" | "ai" | "police" | "none" = "none";
  physics = false;
  ai: any = null;
  headMat: THREE.MeshBasicMaterial;
  tailMat: THREE.MeshBasicMaterial;
  bar: THREE.MeshBasicMaterial[] = [];
  signMat: THREE.MeshBasicMaterial | null = null;
  roll = 0; pitch = 0;
  wheelSpin = 0;
  impact = 0; // last impact speed (for audio/camera)
  slip = 0;
  stuck = 0;
  rx = 0; rz = 0; rh = 0; // rendered (smoothed) pose for rail cars
  alive = true;
  smoke = 0;

  constructor(kind: Kind, color?: number) {
    this.kind = kind;
    this.spec = SPECS[kind];
    const s = this.spec;
    const g = bodyGeo(kind);
    let col = color ?? COLORS[Math.floor(Math.random() * COLORS.length)];
    if (kind === "taxi") col = 0xf2b705;
    if (kind === "police") col = 0xf4f5f6;
    if (kind === "bus") col = 0xe9ecef;
    const pm = paint(col);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.body.add(mesh);
      return mesh;
    };
    add(g.body, pm);
    add(g.cabin, glassMat);
    add(g.roof, pm);
    // bumpers / skirts
    const h = s.L / 2;
    add(new THREE.BoxGeometry(0.18, 0.22, s.W * 0.96).translate(h - 0.02, 0.42, 0), trimMat, false);
    add(new THREE.BoxGeometry(0.18, 0.22, s.W * 0.96).translate(-h + 0.02, 0.42, 0), trimMat, false);
    if (kind === "police") {
      add(new THREE.BoxGeometry(s.L * 0.82, 0.12, s.W + 0.005).translate(0, s.belt - 0.28, 0), paint(0x173a8a), false);
      const lb = new THREE.Group();
      const red = new THREE.MeshBasicMaterial({ color: 0xff0000 }), blue = new THREE.MeshBasicMaterial({ color: 0x0033ff });
      this.bar = [red, blue];
      const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.6), red); l1.position.set(0, 0, -0.42);
      const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.6), blue); l2.position.set(0, 0, 0.42);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 1.5), trimMat);
      lb.add(base, l1, l2);
      lb.position.set(-0.2, s.roof + 0.06, 0);
      this.body.add(lb);
    }
    if (kind === "taxi") {
      this.signMat = new THREE.MeshBasicMaterial({ map: taxiSign(), color: 0x777777 });
      const sm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.85), [trimMat, trimMat, trimMat, trimMat, this.signMat, this.signMat]);
      sm.rotation.y = Math.PI / 2;
      sm.position.set(-0.25, s.roof + 0.16, 0);
      this.body.add(sm);
      add(new THREE.BoxGeometry(s.L * 0.5, 0.1, s.W + 0.005).translate(0.2, s.belt - 0.3, 0), paint(0x111111), false);
    }
    if (kind === "bus") add(new THREE.BoxGeometry(s.L * 0.98, 0.35, s.W + 0.01).translate(0, s.belt - 0.25, 0), paint(0x1d4fa0), false);
    if (kind === "van") add(new THREE.BoxGeometry(s.L - 2.0, s.roof - s.belt - 0.3, s.W).translate(-1.0, (s.roof + s.belt + 0.2) / 2, 0), paint(0xf0f0f0));
    // lights
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
    const ly = kind === "bus" ? 0.8 : s.belt - 0.28;
    for (const zz of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.42), this.headMat);
      hl.position.set(h + 0.005, ly, zz * (s.W / 2 - 0.32));
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.4), this.tailMat);
      tl.position.set(-h - 0.005, ly + 0.05, zz * (s.W / 2 - 0.3));
      this.body.add(hl, tl);
    }
    // wheels
    const tg = new THREE.CylinderGeometry(s.wheelR, s.wheelR, 0.26, 18).rotateX(Math.PI / 2);
    const rg = new THREE.CylinderGeometry(s.wheelR * 0.62, s.wheelR * 0.62, 0.27, 10).rotateX(Math.PI / 2);
    const wx = s.wb / 2;
    for (const [px, pz] of [[wx, 1], [wx, -1], [-wx, 1], [-wx, -1]]) {
      const w = new THREE.Group();
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tg, tireMat);
      t.castShadow = true;
      const r = new THREE.Mesh(rg, rimMat);
      spin.add(t, r);
      w.add(spin);
      w.position.set(px, s.wheelR, pz * (s.W / 2 - 0.16));
      this.wheels.push(w);
      this.group.add(w);
    }
    this.group.add(this.body);
  }

  get pos() { return new THREE.Vector3(this.x, 0, this.z); }

  /** Arcade bicycle model with lateral slip. */
  step(dt: number, col: Collider) {
    const s = this.spec;
    const cx = Math.cos(this.heading), cz = Math.sin(this.heading);
    let fwd = this.vx * cx + this.vz * cz;
    let lat = this.vx * -cz + this.vz * cx;
    const dead = this.damage >= 100;
    const thr = dead ? 0 : this.throttle;
    // engine & brakes
    const spd = Math.abs(fwd);
    let acc = 0;
    if (thr > 0) acc = fwd < -0.5 ? 14 : s.accel * thr * (1 - Math.pow(Math.max(0, fwd) / s.vmax, 2));
    if (thr < 0) acc = fwd > 0.5 ? -14 * -thr : s.accel * 0.5 * thr * (fwd < -12 ? 0 : 1);
    if (this.brake > 0) acc = -Math.sign(fwd) * Math.min(spd / dt, 16 * this.brake);
    if (this.hand > 0) acc -= Math.sign(fwd) * Math.min(spd / dt, 6);
    const drag = 0.0009 * fwd * Math.abs(fwd) + 0.18 * fwd * (thr === 0 ? 1.6 : 0.4);
    fwd += (acc - drag) * dt;
    if (thr === 0 && this.brake === 0 && Math.abs(fwd) < 0.3) fwd *= 0.8;
    // steering
    const steerMax = 0.6 * (1 - Math.min(spd / 70, 0.65));
    const delta = this.steer * steerMax;
    const targetYaw = (fwd / s.wb) * Math.tan(delta);
    const grip = this.hand > 0 ? s.grip * 0.18 : s.grip;
    const yawResp = this.hand > 0 ? 3.5 : 9;
    this.yaw += (targetYaw * (this.hand > 0 ? 1.35 : 1) - this.yaw) * Math.min(1, yawResp * dt);
    this.heading += this.yaw * dt;
    // lateral grip (kills sideways velocity); handbrake lets it slide
    const latMax = (this.hand > 0 ? 4 : 22) * dt;
    const latF = -lat * Math.min(1, grip * dt);
    lat += Math.max(-latMax * 3, Math.min(latMax * 3, latF));
    this.slip = Math.abs(lat);
    // rebuild velocity in the new heading frame
    const nx = Math.cos(this.heading), nz = Math.sin(this.heading);
    this.vx = nx * fwd - nz * lat;
    this.vz = nz * fwd + nx * lat;
    this.fwd = fwd;
    this.lat = lat;
    this.speed = Math.hypot(this.vx, this.vz);
    // integrate with substeps + building collision (3 circles along the body)
    const sub = Math.max(1, Math.ceil((this.speed * dt) / 0.35));
    const r = s.W * 0.5;
    const o = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    this.impact = 0;
    for (let i = 0; i < sub; i++) {
      this.x += (this.vx * dt) / sub;
      this.z += (this.vz * dt) / sub;
      const hl = s.L / 2 - r;
      const n = Math.max(2, Math.ceil(s.L / (r * 1.6)));
      for (let k = 0; k < n; k++) {
        const off = -hl + (2 * hl * k) / (n - 1);
        const px = this.x + Math.cos(this.heading) * off, pz = this.z + Math.sin(this.heading) * off;
        col.circle(px, pz, r, o);
        if (o.hit) {
          this.x += o.x - px;
          this.z += o.z - pz;
          const vn = this.vx * o.nx + this.vz * o.nz;
          if (vn < 0) {
            this.impact = Math.max(this.impact, -vn);
            this.vx -= vn * o.nx * 1.25;
            this.vz -= vn * o.nz * 1.25;
            this.vx *= 0.92; this.vz *= 0.92;
            // glancing blows rotate the car toward the wall tangent
            this.yaw += (o.nx * Math.sin(this.heading) - o.nz * Math.cos(this.heading)) * -vn * 0.02 * Math.sign(off || 1);
          }
        }
      }
    }
    if (this.impact > 4) this.damage += (this.impact - 4) * 2.2;
    this.speed = Math.hypot(this.vx, this.vz);
    // body motion
    const latAcc = fwd * this.yaw;
    this.roll += (THREE.MathUtils.clamp(-latAcc * 0.012, -0.09, 0.09) - this.roll) * Math.min(1, 6 * dt);
    this.pitch += (THREE.MathUtils.clamp(acc * 0.004, -0.05, 0.05) - this.pitch) * Math.min(1, 6 * dt);
  }

  sync(dt: number, night: number, t: number) {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = -this.heading;
    this.body.rotation.set(this.roll, 0, this.pitch);
    this.wheelSpin -= (this.fwd / this.spec.wheelR) * dt;
    this.wheels.forEach((w, i) => {
      w.rotation.y = i < 2 ? -this.steer * 0.55 : 0;
      (w.children[0] as THREE.Object3D).rotation.z = this.wheelSpin;
    });
    const lit = night > 0.3 || this.driver === "player";
    this.headMat.color.setScalar(lit ? 1 + night * 6 : 0.9);
    const braking = this.brake > 0 || (this.throttle < 0 && this.fwd > 0.5);
    this.tailMat.color.setRGB(braking ? 7 : lit ? 1.6 + night * 1.5 : 0.35, 0.0, 0.0);
    if (this.signMat) this.signMat.color.setScalar(this.ai?.fare === false ? 0.3 : 0.6 + night * 2.5);
    if (this.bar.length) {
      const on = this.ai?.siren || this.driver === "police";
      const ph = Math.floor(t * 7) % 2;
      this.bar[0].color.setRGB(on && ph === 0 ? 9 : 0.2, 0, 0);
      this.bar[1].color.setRGB(0, 0.05, on && ph === 1 ? 10 : 0.25);
    }
  }
}

export function mergeForShadow(g: THREE.BufferGeometry[]) {
  return mergeGeometries(g);
}
