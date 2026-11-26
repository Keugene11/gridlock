import type { Edge, World } from "./data";

export type Out = { e: number; dir: 1 | -1 }; // leave node along edge e; dir=1 means a->b
export type Hit = { e: number; s: number; lat: number; d: number; x: number; z: number };

export class RoadNet {
  nodes: [number, number][];
  edges: Edge[];
  out: Out[][];     // legal (one-way aware) departures
  any: Out[][];     // all departures (pedestrians, police)
  signal: Uint8Array; // node has a traffic signal
  phaseOff: Float32Array;
  grid = new Map<number, number[]>();
  CELL = 40;

  constructor(w: World) {
    this.nodes = w.nodes;
    this.edges = w.edges;
    const N = w.nodes.length;
    this.out = Array.from({ length: N }, () => []);
    this.any = Array.from({ length: N }, () => []);
    w.edges.forEach((e, i) => {
      if (e.d >= 0) this.out[e.a].push({ e: i, dir: 1 });
      if (e.d <= 0) this.out[e.b].push({ e: i, dir: -1 });
      this.any[e.a].push({ e: i, dir: 1 });
      this.any[e.b].push({ e: i, dir: -1 });
    });
    this.signal = new Uint8Array(N);
    this.phaseOff = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const inc = this.any[n];
      if (inc.length >= 3 && !inc.some((o) => w.edges[o.e].hw)) {
        const axes = new Set(inc.map((o) => w.edges[o.e].axis));
        if (axes.size > 1) this.signal[n] = 1;
      }
      this.phaseOff[n] = ((Math.sin(n * 12.9898) * 43758.5453) % 1 + 1) % 1 * 40;
    }
    w.edges.forEach((e, i) => {
      for (let k = 0; k < e.p.length / 2 - 1; k++) {
        const x0 = e.p[k * 2], z0 = e.p[k * 2 + 1], x1 = e.p[k * 2 + 2], z1 = e.p[k * 2 + 3];
        const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (this.CELL / 2)) + 1;
        const seen = new Set<number>();
        for (let t = 0; t <= steps; t++) {
          const x = x0 + ((x1 - x0) * t) / steps, z = z0 + ((z1 - z0) * t) / steps;
          const key = this.key(x, z);
          if (seen.has(key)) continue;
          seen.add(key);
          let a = this.grid.get(key);
          if (!a) this.grid.set(key, (a = []));
          if (a[a.length - 1] !== i) a.push(i);
        }
      }
    });
  }

  key(x: number, z: number) {
    return (Math.floor(x / this.CELL) + 1000) * 4000 + (Math.floor(z / this.CELL) + 1000);
  }

  /** Point + tangent at distance s along edge (from a). */
  at(e: Edge, s: number, o: { x: number; z: number; tx: number; tz: number }) {
    const m = e.p.length / 2;
    s = Math.max(0, Math.min(e.len, s));
    let i = 1;
    while (i < m - 1 && e.cum[i] < s) i++;
    const s0 = e.cum[i - 1], s1 = e.cum[i];
    const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const x0 = e.p[i * 2 - 2], z0 = e.p[i * 2 - 1], x1 = e.p[i * 2], z1 = e.p[i * 2 + 1];
    const L = Math.hypot(x1 - x0, z1 - z0) || 1;
    o.x = x0 + (x1 - x0) * f;
    o.z = z0 + (z1 - z0) * f;
    o.tx = (x1 - x0) / L;
    o.tz = (z1 - z0) / L;
    return o;
  }

  nearest(x: number, z: number, maxD = 80, filter?: (e: Edge) => boolean): Hit | null {
    let best: Hit | null = null;
    const r = Math.ceil(maxD / this.CELL);
    const cx = Math.floor(x / this.CELL), cz = Math.floor(z / this.CELL);
    const seen = new Set<number>();
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const a = this.grid.get((cx + dx + 1000) * 4000 + (cz + dz + 1000));
        if (!a) continue;
        for (const i of a) {
          if (seen.has(i)) continue;
          seen.add(i);
          const e = this.edges[i];
          if (filter && !filter(e)) continue;
          for (let k = 0; k < e.p.length / 2 - 1; k++) {
            const x0 = e.p[k * 2], z0 = e.p[k * 2 + 1], x1 = e.p[k * 2 + 2], z1 = e.p[k * 2 + 3];
            const vx = x1 - x0, vz = z1 - z0, L2 = vx * vx + vz * vz || 1;
            const t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / L2));
            const px = x0 + vx * t, pz = z0 + vz * t;
            const d = Math.hypot(x - px, z - pz);
            if (d < maxD && (!best || d < best.d)) {
              const L = Math.sqrt(L2);
              const lat = ((x - x0) * -vz + (z - z0) * vx) / L; // + = left of a->b? (see sideOf)
              best = { e: i, s: e.cum[k] + t * L, lat, d, x: px, z: pz };
            }
          }
        }
      }
    return best;
  }

  /** Signal state for a car arriving at node n along an edge of the given axis: 0 green, 1 yellow, 2 red */
  light(n: number, axis: number, t: number) {
    if (!this.signal[n]) return 0;
    const c = (t + this.phaseOff[n]) % 40;
    const g = axis === 0 ? c : (c + 20) % 40;
    return g < 17 ? 0 : g < 20 ? 1 : 2;
  }

  /** A* over the (direction-agnostic) graph. Returns node list. */
  path(from: number, to: number, maxIter = 6000): number[] | null {
    if (from === to) return [from];
    const N = this.nodes.length;
    const g = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const [tx, tz] = this.nodes[to];
    const open: number[] = [from];
    const f = new Float32Array(N).fill(Infinity);
    g[from] = 0;
    f[from] = Math.hypot(this.nodes[from][0] - tx, this.nodes[from][1] - tz);
    let it = 0;
    while (open.length && it++ < maxIter) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const n = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (n === to) {
        const p: number[] = [];
        for (let c = to; c !== -1; c = prev[c]) p.push(c);
        return p.reverse();
      }
      closed[n] = 1;
      for (const o of this.any[n]) {
        const e = this.edges[o.e];
        const m = o.dir === 1 ? e.b : e.a;
        if (closed[m]) continue;
        const ng = g[n] + e.len;
        if (ng < g[m]) {
          if (g[m] === Infinity) open.push(m);
          g[m] = ng;
          prev[m] = n;
          f[m] = ng + Math.hypot(this.nodes[m][0] - tx, this.nodes[m][1] - tz);
        }
      }
    }
    return null;
  }

  nearestNode(x: number, z: number) {
    const h = this.nearest(x, z, 200);
    if (!h) return 0;
    const e = this.edges[h.e];
    return h.s < e.len / 2 ? e.a : e.b;
  }
}
