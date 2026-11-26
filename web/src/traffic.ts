import * as THREE from "three";
import { Vehicle, type Kind } from "./vehicle";
import type { RoadNet } from "./roads";
import type { Collider } from "./collide";

const tmp = { x: 0, z: 0, tx: 0, tz: 0 };
const angDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

function pickKind(wide: boolean): Kind {
  const r = Math.random();
  if (r < 0.32) return "taxi";
  if (r < 0.6) return "sedan";
  if (r < 0.8) return "suv";
  if (r < 0.88) return "van";
  if (r < 0.91 && wide) return "bus";
  if (r < 0.95) return "sports";
  if (r < 0.98) return "police";
  return "sedan";
}

export class Traffic {
  cars: Vehicle[] = [];
  target = 70;
  constructor(public scene: THREE.Scene, public net: RoadNet, public col: Collider) {}

  laneOffset(e: any, lane: number) {
    const two = e.d === 0;
    const laneW = Math.min(3.4, e.w / Math.max(e.l, 1));
    if (two) return (lane + 0.5) * laneW;
    const tw = laneW * e.l;
    return -tw / 2 + (lane + 0.5) * laneW;
  }
  lanesFor(e: any) { return e.d === 0 ? Math.max(1, Math.floor(e.l / 2)) : e.l; }

  railPose(c: Vehicle) {
    const a = c.ai, e = this.net.edges[a.e];
    this.net.at(e, a.dir === 1 ? a.p : e.len - a.p, tmp);
    const tx = tmp.tx * a.dir, tz = tmp.tz * a.dir;
    const off = this.laneOffset(e, a.lane);
    return { x: tmp.x + -tz * off, z: tmp.z + tx * off, h: Math.atan2(tz, tx) };
  }

  spawnOn(eI: number, dir: 1 | -1, p: number, kind: Kind) {
    const e = this.net.edges[eI];
    const c = new Vehicle(kind);
    c.driver = "ai";
    const lanes = this.lanesFor(e);
    c.ai = { e: eI, dir, p, lane: Math.floor(Math.random() * lanes), v: 6, cruise: Math.min(13, e.s * 0.44) * (0.85 + Math.random() * 0.3) * (kind === "bus" ? 0.75 : 1), honk: 0, block: 0, fare: kind === "taxi" ? Math.random() < 0.6 : undefined };
    if (kind === "bus" && lanes > 1) c.ai.lane = lanes - 1;
    const p0 = this.railPose(c);
    c.x = c.rx = p0.x; c.z = c.rz = p0.z; c.heading = c.rh = p0.h;
    this.cars.push(c);
    this.scene.add(c.group);
    return c;
  }

  remove(c: Vehicle) {
    this.scene.remove(c.group);
    c.alive = false;
    const i = this.cars.indexOf(c);
    if (i >= 0) this.cars.splice(i, 1);
  }

  /** keep the population around the player; spawn out of sight. */
  populate(px: number, pz: number, camDir: THREE.Vector3, protect: Set<Vehicle>) {
    for (const c of [...this.cars]) {
      if (protect.has(c)) continue;
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d > (c.driver === "police" ? 750 : 460)) this.remove(c);
    }
    let tries = 0;
    const rail = this.cars.filter((c) => c.driver === "ai").length;
    let need = this.target - rail;
    while (need > 0 && tries++ < 25) {
      const ang = Math.random() * Math.PI * 2, R = 90 + Math.random() * 300;
      const x = px + Math.cos(ang) * R, z = pz + Math.sin(ang) * R;
      // prefer spawning behind the camera when close
      if (R < 200 && (Math.cos(ang) * camDir.x + Math.sin(ang) * camDir.z) > 0.3) continue;
      const h = this.net.nearest(x, z, 60, (e) => !e.hw || true);
      if (!h) continue;
      const e = this.net.edges[h.e];
      if (e.len < 20) continue;
      const dir: 1 | -1 = e.d === 0 ? (Math.random() < 0.5 ? 1 : -1) : (e.d as 1 | -1);
      const p = dir === 1 ? h.s : e.len - h.s;
      if (p < e.len * 0.1 || p > e.len * 0.8) continue;
      if (this.cars.some((c) => (c.x - h.x) ** 2 + (c.z - h.z) ** 2 < 15 * 15)) continue;
      this.spawnOn(h.e, dir, p, pickKind(e.w > 16));
      need--;
    }
  }

  update(dt: number, t: number, others: { x: number; z: number; r: number }[], onHonk: (c: Vehicle) => void) {
    for (const c of this.cars) {
      if (c.driver !== "ai") continue;
      if (c.physics) {
        c.throttle = 0; c.brake = 0.4; c.steer = 0;
        c.step(dt, this.col);
        continue;
      }
      const a = c.ai, e = this.net.edges[a.e];
      const endNode = a.dir === 1 ? e.b : e.a;
      const cl = a.dir === 1 ? e.clB : e.clA;
      const remain = e.len - a.p;
      let vAllow = a.cruise;
      // signals
      const st = this.net.light(endNode, e.axis, t);
      if (st !== 0) {
        const stopAt = remain - (cl + 5.5);
        if (stopAt > -0.5 && !(st === 1 && stopAt < 6)) vAllow = Math.min(vAllow, Math.sqrt(2 * 5 * Math.max(0, stopAt - 0.5)));
      }
      // slow before sharp turns
      if (remain < 14 && a.turn && Math.abs(a.turn) > 0.6) vAllow = Math.min(vAllow, 6);
      // vehicles / people ahead
      const fx = Math.cos(c.rh), fz = Math.sin(c.rh);
      let blockedByPlayer = false;
      for (const o of this.cars) {
        if (o === c) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        const fwd = dx * fx + dz * fz;
        if (fwd < 0 || fwd > 32) continue;
        const lat = Math.abs(-dx * fz + dz * fx);
        if (lat > 1.9) continue;
        const gap = fwd - (c.spec.L + o.spec.L) / 2;
        vAllow = Math.min(vAllow, Math.sqrt(2 * 6 * Math.max(0, gap - 2.2)));
        if (o.driver === "player" && gap < 6) blockedByPlayer = true;
      }
      for (const o of others) {
        const dx = o.x - c.x, dz = o.z - c.z;
        const fwd = dx * fx + dz * fz;
        if (fwd < 0 || fwd > 24) continue;
        const lat = Math.abs(-dx * fz + dz * fx);
        if (lat > 1.3 + o.r) continue;
        const gap = fwd - c.spec.L / 2 - o.r;
        vAllow = Math.min(vAllow, Math.sqrt(2 * 6 * Math.max(0, gap - 2.0)));
        if (o.r > 0.55) blockedByPlayer = true;
      }
      if (blockedByPlayer && a.v < 1) {
        a.block += dt;
        if (a.block > 2.5 && (a.honk -= dt) <= 0) { onHonk(c); a.honk = 2 + Math.random() * 3; }
      } else a.block = 0;
      const dv = vAllow - a.v;
      a.v += dv > 0 ? Math.min(dv, 2.6 * dt) : Math.max(dv, -8 * dt);
      a.v = Math.max(0, a.v);
      c.brake = dv < -1 && a.v < a.cruise ? 1 : 0;
      a.p += a.v * dt;
      if (a.p >= e.len) {
        // choose next edge
        const outs = this.net.out[endNode].filter((o) => o.e !== a.e);
        if (!outs.length) { this.remove(c); continue; }
        const inH = Math.atan2(fz, fx);
        const scored = outs.map((o) => {
          const ne = this.net.edges[o.e];
          this.net.at(ne, o.dir === 1 ? Math.min(6, ne.len) : Math.max(0, ne.len - 6), tmp);
          const turn = angDiff(inH, Math.atan2(tmp.tz * o.dir, tmp.tx * o.dir));
          return { o, turn, w: Math.abs(turn) < 0.4 ? 3 : Math.abs(turn) < 2.2 ? 1 : 0.05 };
        });
        let r = Math.random() * scored.reduce((s, x) => s + x.w, 0);
        let pick = scored[0];
        for (const s of scored) { r -= s.w; if (r <= 0) { pick = s; break; } }
        a.p -= e.len;
        a.e = pick.o.e;
        a.dir = pick.o.dir;
        a.turn = 0;
        const ne = this.net.edges[a.e];
        a.lane = Math.min(a.lane, this.lanesFor(ne) - 1);
        if (Math.abs(pick.turn) > 0.5) a.lane = pick.turn > 0 ? this.lanesFor(ne) - 1 : 0;
        a.p = Math.min(a.p, ne.len);
        a.cruise = Math.min(14, ne.s * 0.44) * (0.85 + Math.random() * 0.3) * (c.kind === "bus" ? 0.75 : 1);
        // peek the following turn for slowing
        const en2 = a.dir === 1 ? ne.b : ne.a;
        a.turn = this.net.out[en2].length > 1 ? 0 : 0;
      }
      const p = this.railPose(c);
      const k = Math.min(1, dt * 5);
      c.rx += (p.x - c.rx) * k;
      c.rz += (p.z - c.rz) * k;
      const mv = Math.hypot(p.x - c.x, p.z - c.z);
      c.rh += angDiff(c.rh, p.h) * Math.min(1, dt * 4);
      c.vx = (c.rx - c.x) / dt;
      c.vz = (c.rz - c.z) / dt;
      c.x = c.rx; c.z = c.rz; c.heading = c.rh;
      c.fwd = a.v; c.speed = a.v;
      c.throttle = 0;
      c.steer = THREE.MathUtils.clamp(angDiff(c.rh, p.h) * 3, -1, 1);
      void mv;
    }
  }
}

/** Police pursuit driving on top of the regular car physics. */
export function policeDrive(c: Vehicle, dt: number, tx: number, tz: number, tvx: number, tvz: number, net: RoadNet, col: Collider) {
  const a = c.ai;
  const dx = tx - c.x, dz = tz - c.z;
  const dist = Math.hypot(dx, dz);
  a.pathT = (a.pathT ?? 0) - dt;
  const see = dist < 90 && col.los(c.x, c.z, tx, tz);
  let gx = tx + tvx * Math.min(1.2, dist / 25), gz = tz + tvz * Math.min(1.2, dist / 25);
  if (!see) {
    if (a.pathT <= 0 || !a.path) {
      a.pathT = 1.5;
      // start from the end of our current street that lies ahead of us (avoids U-turn oscillation)
      const h = net.nearest(c.x, c.z, 80);
      let from = net.nearestNode(c.x, c.z);
      if (h) {
        const e = net.edges[h.e], fx = Math.cos(c.heading), fz = Math.sin(c.heading);
        const [ax, az] = net.nodes[e.a], [bx, bz] = net.nodes[e.b];
        from = (ax - c.x) * fx + (az - c.z) * fz > (bx - c.x) * fx + (bz - c.z) * fz ? e.a : e.b;
      }
      const to = net.nearestNode(tx, tz);
      a.path = net.path(from, to) ?? null;
      a.pi = 0;
    }
    if (a.path && a.path.length) {
      while (a.pi < a.path.length - 1) {
        const [nx, nz] = net.nodes[a.path[a.pi]];
        const ahead = (nx - c.x) * Math.cos(c.heading) + (nz - c.z) * Math.sin(c.heading);
        const dn = Math.hypot(nx - c.x, nz - c.z);
        if (dn < 14 || (ahead < 0 && dn < 45)) a.pi++;
        else break;
      }
      const [nx, nz] = net.nodes[a.path[Math.min(a.pi, a.path.length - 1)]];
      gx = nx; gz = nz;
    }
  }
  a.sees = see;
  const want = Math.atan2(gz - c.z, gx - c.x);
  let d = angDiff(c.heading, want);
  if (a.rev > 0) {
    a.rev -= dt;
    c.throttle = -1; c.brake = 0; c.steer = -Math.sign(d); c.hand = 0;
  } else {
    c.steer = THREE.MathUtils.clamp(d * 2.2, -1, 1);
    c.throttle = 1;
    c.brake = Math.abs(d) > 1.1 && c.speed > 14 ? 0.6 : 0;
    c.hand = Math.abs(d) > 1.6 && c.speed > 10 ? 1 : 0;
    if (dist < 8 && Math.abs(d) > 1.4) c.throttle = 0.4;
    // close in hard but don't fly past: cap closing speed near the target
    const tSpeed = Math.hypot(tvx, tvz);
    if (dist < 40 && c.speed > tSpeed + 4 + dist * 0.6) { c.throttle = 0; c.brake = 0.5; }
    if (c.speed < 1.2) { a.stuck = (a.stuck ?? 0) + dt; if (a.stuck > 1.3) { a.rev = 1.1; a.stuck = 0; } }
    else a.stuck = 0;
  }
  c.step(dt, col);
}
