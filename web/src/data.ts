export type Building = {
  pts: Float32Array; // x,z pairs, CCW (positive signed area in x/z)
  h: number; yr: number; area: number;
  cx: number; cz: number; minx: number; maxx: number; minz: number; maxz: number;
};
export type Edge = {
  a: number; b: number; p: number[]; w: number; d: number; l: number; n: string; hw: number; s: number;
  cum: Float32Array; len: number; clA: number; clB: number; axis: number;
};
export type Place = { n: string; x: number; z: number };
export type World = {
  buildings: Building[];
  nodes: [number, number][];
  edges: Edge[];
  land: number[][][];
  parks: number[][][];
  trees: Int32Array;
  places: Place[];
};

const BASE = "/world/";

async function bin(name: string, onProg: (f: number) => void) {
  const r = await fetch(BASE + name);
  const total = Number(r.headers.get("content-length")) || 0;
  if (!r.body || !total) return r.arrayBuffer();
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProg(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

// Manhattan's street grid runs about 29 degrees east of true north.
export const AVE = { x: Math.sin((29 * Math.PI) / 180), z: -Math.cos((29 * Math.PI) / 180) };

export async function loadWorld(onProg: (f: number) => void): Promise<World> {
  const prog = [0, 0, 0, 0, 0];
  const p = (i: number) => (f: number) => { prog[i] = f; onProg(prog.reduce((a, b) => a + b, 0) / prog.length); };
  const [bb, roads, land, tb, places] = await Promise.all([
    bin("buildings.bin", p(0)),
    fetch(BASE + "roads.json").then((r) => { p(1)(1); return r.json(); }),
    fetch(BASE + "land.json").then((r) => { p(2)(1); return r.json(); }),
    bin("trees.bin", p(3)),
    fetch(BASE + "places.json").then((r) => { p(4)(1); return r.json(); }),
  ]);

  const dv = new DataView(bb);
  const n = dv.getUint32(0, true);
  let o = 4;
  const buildings: Building[] = [];
  for (let i = 0; i < n; i++) {
    const nv = dv.getUint16(o, true), h = dv.getUint16(o + 2, true) / 10, yr = dv.getUint16(o + 4, true);
    o += 6;
    const pts = new Float32Array(nv * 2);
    for (let k = 0; k < nv; k++) {
      pts[k * 2] = dv.getInt16(o, true) / 4;
      pts[k * 2 + 1] = dv.getInt16(o + 2, true) / 4;
      o += 4;
    }
    // orient CCW (positive area in x/z)
    let A = 0;
    for (let k = 0; k < nv; k++) {
      const j = (k + 1) % nv;
      A += pts[k * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[k * 2 + 1];
    }
    if (A < 0) {
      for (let k = 0; k < nv / 2; k++) {
        const j = nv - 1 - k;
        const tx = pts[k * 2], tz = pts[k * 2 + 1];
        pts[k * 2] = pts[j * 2]; pts[k * 2 + 1] = pts[j * 2 + 1];
        pts[j * 2] = tx; pts[j * 2 + 1] = tz;
      }
    }
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, cx = 0, cz = 0;
    for (let k = 0; k < nv; k++) {
      const x = pts[k * 2], z = pts[k * 2 + 1];
      cx += x; cz += z;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    buildings.push({ pts, h, yr, area: Math.abs(A) / 2, cx: cx / nv, cz: cz / nv, minx, maxx, minz, maxz });
  }

  const nodes: [number, number][] = roads.nodes;
  const edges: Edge[] = roads.edges;
  for (const e of edges) {
    const m = e.p.length / 2;
    e.cum = new Float32Array(m);
    for (let i = 1; i < m; i++) e.cum[i] = e.cum[i - 1] + Math.hypot(e.p[i * 2] - e.p[i * 2 - 2], e.p[i * 2 + 1] - e.p[i * 2 - 1]);
    e.len = e.cum[m - 1];
    const dx = e.p[e.p.length - 2] - e.p[0], dz = e.p[e.p.length - 1] - e.p[1];
    const L = Math.hypot(dx, dz) || 1;
    e.axis = Math.abs((dx / L) * AVE.x + (dz / L) * AVE.z) > 0.7 ? 0 : 1;
  }
  // clearance at each end = half-width of the widest crossing street (intersections only)
  const inc: number[][] = nodes.map(() => []);
  edges.forEach((e, i) => { inc[e.a].push(i); inc[e.b].push(i); });
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const cl = (nd: number) => {
      if (inc[nd].length < 3) return 0;
      let m = 0;
      for (const j of inc[nd]) if (j !== i) m = Math.max(m, edges[j].w / 2);
      return Math.min(m, e.len * 0.45);
    };
    e.clA = cl(e.a);
    e.clB = cl(e.b);
  }
  return { buildings, nodes, edges, land: land.land, parks: land.parks, trees: new Int32Array(tb, 4), places };
}
