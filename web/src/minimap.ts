import type { World } from "./data";

/** Pre-rendered top-down map of the world, drawn rotated into the radar each frame. */
export class MapArt {
  canvas = document.createElement("canvas");
  S = 0.45; // px per metre
  x0: number; z0: number;
  constructor(w: World) {
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (const [x, z] of w.nodes) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    minx -= 900; maxx += 900; minz -= 900; maxz += 900;
    this.x0 = minx; this.z0 = minz;
    const c = this.canvas;
    c.width = Math.ceil((maxx - minx) * this.S);
    c.height = Math.ceil((maxz - minz) * this.S);
    const g = c.getContext("2d")!;
    const P = (x: number, z: number): [number, number] => [(x - minx) * this.S, (z - minz) * this.S];
    g.fillStyle = "#0e2230"; g.fillRect(0, 0, c.width, c.height);
    const poly = (rings: number[][], fill: string) => {
      g.beginPath();
      for (const r of rings) {
        for (let i = 0; i < r.length; i += 2) { const [px, pz] = P(r[i], r[i + 1]); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); }
        g.closePath();
      }
      g.fillStyle = fill; g.fill("evenodd");
    };
    for (const p of w.land) poly(p, "#2b2f33");
    for (const p of w.parks) poly(p, "#2c4a2a");
    g.fillStyle = "#3b4046";
    for (const b of w.buildings) {
      g.beginPath();
      const p = b.pts;
      for (let i = 0; i < p.length; i += 2) { const [px, pz] = P(p[i], p[i + 1]); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); }
      g.closePath(); g.fill();
    }
    g.lineCap = "round"; g.lineJoin = "round";
    for (const pass of [0, 1]) {
      for (const e of w.edges) {
        g.beginPath();
        for (let i = 0; i < e.p.length; i += 2) { const [px, pz] = P(e.p[i], e.p[i + 1]); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); }
        g.strokeStyle = pass === 0 ? "#15181b" : e.hw ? "#c9a24a" : e.w > 18 ? "#a9adb3" : "#7d8288";
        g.lineWidth = Math.max(1.4, e.w * this.S * (pass === 0 ? 1.0 : 0.72));
        g.stroke();
      }
    }
  }
  px(x: number) { return (x - this.x0) * this.S; }
  pz(z: number) { return (z - this.z0) * this.S; }
}

export type Blip = { x: number; z: number; color: string; r?: number; ring?: boolean; edge?: boolean };

export function drawRadar(ctx: CanvasRenderingContext2D, art: MapArt, x: number, z: number, heading: number, blips: Blip[], zoom = 1) {
  const W = ctx.canvas.width, H = ctx.canvas.height, R = W / 2;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#0e2230"; ctx.fillRect(0, 0, W, H);
  ctx.translate(R, R);
  ctx.rotate(-heading - Math.PI / 2);
  ctx.scale(zoom, zoom);
  ctx.drawImage(art.canvas, -art.px(x), -art.pz(z));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // blips in rotated frame
  const rot = -heading - Math.PI / 2, cs = Math.cos(rot), sn = Math.sin(rot);
  for (const b of blips) {
    let dx = (b.x - x) * art.S * zoom, dz = (b.z - z) * art.S * zoom;
    let sx = dx * cs - dz * sn, sy = dx * sn + dz * cs;
    const d = Math.hypot(sx, sy);
    const lim = R - 12;
    let clamped = false;
    if (d > lim) { if (!b.edge) continue; sx *= lim / d; sy *= lim / d; clamped = true; }
    ctx.beginPath();
    ctx.arc(R + sx, R + sy, b.r ?? 4, 0, Math.PI * 2);
    ctx.fillStyle = b.color; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.stroke();
    if (clamped && b.ring) { ctx.beginPath(); ctx.arc(R + sx, R + sy, (b.r ?? 4) + 3, 0, Math.PI * 2); ctx.strokeStyle = b.color; ctx.stroke(); }
  }
  // player arrow (always points up)
  ctx.translate(R, R);
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath();
  ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
  // north marker
  const nx = R + Math.cos(-heading - Math.PI / 2 - Math.PI / 2) * (R - 10) * 0, ny = 0;
  void nx; void ny;
}
