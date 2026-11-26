import type { Building } from "./data";

/** Spatial hash of building wall segments for circle collision, point-in-building and line-of-sight. */
export class Collider {
  CELL = 16;
  seg: Float32Array; // x0,z0,x1,z1
  bid: Int32Array;
  grid = new Map<number, number[]>();
  bgrid = new Map<number, number[]>();
  b: Building[];

  constructor(b: Building[]) {
    this.b = b;
    let n = 0;
    for (const x of b) n += x.pts.length / 2;
    this.seg = new Float32Array(n * 4);
    this.bid = new Int32Array(n);
    let k = 0;
    b.forEach((bd, bi) => {
      const p = bd.pts, m = p.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
        this.seg.set([x0, z0, x1, z1], k * 4);
        this.bid[k] = bi;
        const minx = Math.floor(Math.min(x0, x1) / this.CELL), maxx = Math.floor(Math.max(x0, x1) / this.CELL);
        const minz = Math.floor(Math.min(z0, z1) / this.CELL), maxz = Math.floor(Math.max(z0, z1) / this.CELL);
        for (let gx = minx; gx <= maxx; gx++)
          for (let gz = minz; gz <= maxz; gz++) {
            const key = this.k(gx, gz);
            let a = this.grid.get(key);
            if (!a) this.grid.set(key, (a = []));
            a.push(k);
          }
        k++;
      }
      for (let gx = Math.floor(bd.minx / this.CELL); gx <= Math.floor(bd.maxx / this.CELL); gx++)
        for (let gz = Math.floor(bd.minz / this.CELL); gz <= Math.floor(bd.maxz / this.CELL); gz++) {
          const key = this.k(gx, gz);
          let a = this.bgrid.get(key);
          if (!a) this.bgrid.set(key, (a = []));
          a.push(bi);
        }
    });
  }

  k(gx: number, gz: number) {
    return (gx + 2000) * 8000 + (gz + 2000);
  }

  /** Building index containing point, or -1. */
  inside(x: number, z: number): number {
    const a = this.bgrid.get(this.k(Math.floor(x / this.CELL), Math.floor(z / this.CELL)));
    if (!a) return -1;
    for (const bi of a) {
      const b = this.b[bi];
      if (x < b.minx || x > b.maxx || z < b.minz || z > b.maxz) continue;
      const p = b.pts, m = p.length / 2;
      let c = false;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      if (c) return bi;
    }
    return -1;
  }

  heightAt(x: number, z: number) {
    const i = this.inside(x, z);
    return i < 0 ? 0 : this.b[i].h;
  }

  /**
   * Push a circle out of walls. Returns accumulated push normal (nx,nz) and depth, or null.
   */
  circle(x: number, z: number, r: number, out: { x: number; z: number; nx: number; nz: number; hit: boolean }) {
    out.x = x; out.z = z; out.nx = 0; out.nz = 0; out.hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const g0x = Math.floor((out.x - r) / this.CELL), g1x = Math.floor((out.x + r) / this.CELL);
      const g0z = Math.floor((out.z - r) / this.CELL), g1z = Math.floor((out.z + r) / this.CELL);
      for (let gx = g0x; gx <= g1x; gx++)
        for (let gz = g0z; gz <= g1z; gz++) {
          const a = this.grid.get(this.k(gx, gz));
          if (!a) continue;
          for (const s of a) {
            const x0 = this.seg[s * 4], z0 = this.seg[s * 4 + 1], x1 = this.seg[s * 4 + 2], z1 = this.seg[s * 4 + 3];
            const vx = x1 - x0, vz = z1 - z0, L2 = vx * vx + vz * vz;
            if (L2 < 1e-6) continue;
            const t = Math.max(0, Math.min(1, ((out.x - x0) * vx + (out.z - z0) * vz) / L2));
            const px = x0 + vx * t, pz = z0 + vz * t;
            let dx = out.x - px, dz = out.z - pz;
            const d = Math.hypot(dx, dz);
            if (d < r) {
              if (d < 1e-4) { const L = Math.sqrt(L2); dx = vz / L; dz = -vx / L; }
              else { dx /= d; dz /= d; }
              // outward normal of a CCW ring edge is (vz,-vx); if we're on the inner side, push outward through the wall
              const L = Math.sqrt(L2);
              const onx = vz / L, onz = -vx / L;
              if (t > 0.001 && t < 0.999 && dx * onx + dz * onz < 0) { dx = onx; dz = onz; out.x = px + dx * r; out.z = pz + dz * r; }
              else { out.x += dx * (r - d); out.z += dz * (r - d); }
              out.nx += dx; out.nz += dz; out.hit = true;
            }
          }
        }
    }
    const L = Math.hypot(out.nx, out.nz);
    if (L > 0) { out.nx /= L; out.nz /= L; }
    return out;
  }

  /** True if the straight line between two points crosses no wall (2D). */
  los(x0: number, z0: number, x1: number, z1: number) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(d / 6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.inside(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) >= 0) return false;
    }
    return true;
  }
}
