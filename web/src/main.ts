import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
// @ts-ignore - n8ao ships without types
import { N8AOPass } from "n8ao";
import { loadWorld } from "./data";
import { RoadNet } from "./roads";
import { Collider } from "./collide";
import { Atmosphere } from "./sky";
import { buildCity, U } from "./city";
import { buildGround } from "./ground";
import { Props } from "./props";
import { buildBillboards } from "./signs";
import { Vehicle, type Kind } from "./vehicle";
import { Traffic, policeDrive } from "./traffic";
import { Humans, type Ped, type Pose } from "./peds";
import { MapArt, drawRadar, type Blip } from "./minimap";
import { Audio } from "./audio";
import { Particles } from "./fx";

const $ = (id: string) => document.getElementById(id)!;
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const angd = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const LAT0 = 40.7342, LON0 = -73.989, KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KY = 110540;
const ll = (lat: number, lon: number) => ({ x: (lon - LON0) * KX, z: -(lat - LAT0) * KY });

type Q = "low" | "medium" | "high";
let quality: Q = "high";
try { quality = (localStorage.getItem("gl-q") as Q) || "high"; } catch {}

function setLoad(f: number, txt?: string) {
  ($("loadbar") as HTMLElement).style.width = `${Math.round(f * 100)}%`;
  if (txt) $("loadtxt").textContent = txt;
}

async function boot() {
  const canvas = $("c") as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 9000);

  const world = await loadWorld((f) => setLoad(f * 0.5, "Downloading Manhattan…"));
  setLoad(0.52, `Raising ${world.buildings.length.toLocaleString()} buildings…`); await frame();
  const col = new Collider(world.buildings);
  const net = new RoadNet(world);
  const city = buildCity(world.buildings, (x, z) => col.inside(x, z));
  scene.add(city.group);
  setLoad(0.7, `Paving ${world.edges.length.toLocaleString()} street segments…`); await frame();
  buildGround(world, scene);
  setLoad(0.8, `Planting ${(world.trees.length / 3).toLocaleString()} street trees…`); await frame();
  const props = new Props(world, net, (x, z) => col.inside(x, z), city.beacons);
  scene.add(props.group);
  const ts = world.places.find((p) => p.n === "Times Square")!;
  scene.add(buildBillboards(world.buildings, ts.x, ts.z));
  setLoad(0.9, "Drawing the map…"); await frame();
  const art = new MapArt(world);
  const atmo = new Atmosphere(scene, renderer);
  const traffic = new Traffic(scene, net, col);
  const humans = new Humans(scene, net, col);
  const fx = new Particles(scene);
  const audio = new Audio();

  // ---------- post-processing ----------
  let composer: EffectComposer;
  let bloom: UnrealBloomPass;
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.9 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uVig; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime)*43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        vec2 d = vUv - 0.5; float v = 1.0 - dot(d,d)*uVig;
        vec3 col = c.rgb * v;
        float l = dot(col, vec3(0.299,0.587,0.114));
        col = mix(vec3(l), col, 1.08);              // a touch more saturation
        col = col*vec3(1.02,1.0,0.97) + vec3(0.0,0.004,0.012)*(1.0-l); // warm highs, cool shadows
        col += (h(vUv*1000.0)-0.5)*0.018;            // film grain
        gl_FragColor = vec4(col, c.a); }`,
  });
  let ao: any = null;
  function setupPost() {
    const pr = Math.min(devicePixelRatio, quality === "high" ? 1.5 : 1);
    renderer.setPixelRatio(pr);
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(pr);
    composer.setSize(innerWidth, innerHeight);
    if (quality === "high") {
      ao = new N8AOPass(scene, camera, innerWidth, innerHeight);
      ao.configuration.aoRadius = 4;
      ao.configuration.distanceFalloff = 1.5;
      ao.configuration.intensity = 2.6;
      ao.configuration.halfRes = true;
      ao.configuration.gammaCorrection = false;
      composer.addPass(ao);
    } else {
      ao = null;
      composer.addPass(new RenderPass(scene, camera));
    }
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.35, 1.0);
    if (quality !== "low") composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.addPass(grade);
    if (quality !== "low") composer.addPass(new SMAAPass(innerWidth * pr, innerHeight * pr));
    atmo.setShadowSize(quality === "high" ? 4096 : quality === "medium" ? 2048 : 1024);
    renderer.shadowMap.type = quality === "low" ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    traffic.target = quality === "low" ? 40 : quality === "medium" ? 60 : 75;
    humans.target = quality === "low" ? 70 : quality === "medium" ? 110 : 150;
  }
  setupPost();
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  // ---------- player ----------
  const spawn = (() => {
    // nearest sidewalk spot to Times Square with clear space around it
    const cands = net.edges.map((e, i) => ({ e, i, d: Math.hypot(e.p[0] - ts.x, e.p[1] - ts.z) }))
      .filter((c) => !c.e.hw && c.e.len > 40 && c.e.d !== 0).sort((a, b) => a.d - b.d);
    const o = { x: 0, z: 0, tx: 0, tz: 0 };
    const clear = (x: number, z: number, r: number) => {
      for (let k = 0; k < 12; k++) if (col.inside(x + Math.cos(k * 0.52) * r, z + Math.sin(k * 0.52) * r) >= 0) return false;
      return col.inside(x, z) < 0;
    };
    for (const c of cands) {
      for (const f of [0.5, 0.35, 0.65]) {
        net.at(c.e, c.e.len * f, o);
        const off = c.e.w / 2 + 1.6;
        const x = o.x - o.tz * off, z = o.z + o.tx * off;
        if (clear(x, z, 3.2) && clear(x + o.tx * 4, z + o.tz * 4, 3.2)) return { x, z, h: Math.atan2(o.tz, o.tx), e: c.e, o: { ...o } };
      }
    }
    const e = cands[0].e;
    net.at(e, e.len / 2, o);
    return { x: o.x - o.tz * (e.w / 2 + 1.6), z: o.z + o.tx * (e.w / 2 + 1.6), h: Math.atan2(o.tz, o.tx), e, o };
  })();
  const me: Pose = humans.newPose();
  me.shirt.set(0x2a1d16); me.pants.set(0x1f2d44); me.skin.set(0xd9a982); me.hair.set(0x120c08); me.scale = 1.02;
  me.x = spawn.x; me.z = spawn.z; me.heading = spawn.h;
  const P = { vy: 0, vx: 0, vz: 0, car: null as Vehicle | null, health: 100, hurtT: 0, punchT: 0, money: 250, fares: 0 };
  humans.extra = [me];

  // a parked cab waiting at the curb next to you
  {
    const c = new Vehicle("taxi");
    const e = spawn.e, o = spawn.o;
    const off = e.w / 2 - 1.3;
    c.x = o.x - o.tz * off + o.tx * 8; c.z = o.z + o.tx * off + o.tz * 8; c.heading = spawn.h;
    c.physics = true; c.driver = "none";
    traffic.cars.push(c); scene.add(c.group);
  }

  // ---------- input ----------
  const keys = new Set<string>();
  let camYaw = spawn.h, camPitch = 0.18, mouseT = 10, camMode = 0;
  addEventListener("keydown", (e) => {
    if (e.repeat) { keys.add(e.code); return; }
    keys.add(e.code);
    if (!playing) return;
    if (e.code === "KeyF" || e.code === "Enter") toggleCar();
    if (e.code === "KeyH") { audio.horn(); hornT = 0.6; }
    if (e.code === "KeyM") toggleMap();
    if (e.code === "KeyT") { atmo.hours = (atmo.hours + 1) % 24; toast(fmtClock(atmo.hours), "time skipped"); }
    if (e.code === "KeyR") resetCar();
    if (e.code === "KeyV") camMode = (camMode + 1) % 3;
    if (e.code === "KeyN") muted = !muted;
    if (e.code === "Space") e.preventDefault();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    camYaw += e.movementX * 0.0025;
    camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * 0.002, -0.35, 1.2);
    mouseT = 0;
  });
  addEventListener("mousedown", (e) => {
    if (!playing) return;
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
    if (e.button === 0 && !P.car) punch();
  });
  let playing = false, paused = false, muted = false, hornT = 0;
  document.addEventListener("pointerlockchange", () => {
    if (!playing) return;
    paused = document.pointerLockElement !== canvas;
    $("overlay").hidden = !paused;
    if (paused) { $("loading").hidden = true; ($("play") as HTMLButtonElement).textContent = "Resume"; }
  });

  // quality buttons
  const qb = document.querySelectorAll<HTMLButtonElement>(".quality button");
  const markQ = () => qb.forEach((b) => b.classList.toggle("on", b.dataset.q === quality));
  qb.forEach((b) => b.addEventListener("click", () => {
    quality = b.dataset.q as Q;
    try { localStorage.setItem("gl-q", quality); } catch {}
    markQ(); setupPost();
  }));
  markQ();
  $("play").addEventListener("click", () => {
    audio.start();
    playing = true; paused = false;
    $("overlay").hidden = true;
    $("hud").hidden = false;
    canvas.requestPointerLock();
  });

  // ---------- game state ----------
  let heat = 0, stars = 0, evadeT = 0, bustT = 0, deadT = 0, pursuitT = 0;
  let simT = 0;
  let fare: null | { stage: "pickup" | "drop"; x: number; z: number; client?: Pose; dest?: string; t: number; dist: number; pay: number } = null;
  let fareCooldown = 2;
  const marker = new THREE.Group();
  {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 90, 24, 1, true).translate(0, 45, 0),
      new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 40).rotateX(-Math.PI / 2).translate(0, 0.08, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    marker.add(beam, ring);
    marker.visible = false;
    scene.add(marker);
  }
  const headlight = new THREE.SpotLight(0xfff2dd, 0, 70, 0.55, 0.5, 1.4);
  scene.add(headlight, headlight.target);

  function crime(sev: number, why: string) {
    const before = stars;
    heat = Math.min(5.99, heat + sev);
    stars = Math.min(5, Math.floor(heat));
    evadeT = 0;
    if (before === 0 && stars > 0) pursuitT = 0;
    if (stars > before) toast(stars === 1 ? "WANTED" : `${stars} STARS`, why);
  }

  let toastT = 0;
  function toast(big: string, small = "") {
    $("toast").innerHTML = `${big}${small ? `<small>${small}</small>` : ""}`;
    $("toast").classList.add("show");
    toastT = 2.6;
  }

  function toggleCar() {
    if (P.car) {
      const c = P.car;
      if (c.speed > 6) return;
      const lx = Math.sin(c.heading), lz = -Math.cos(c.heading); // driver side = left
      let ex = c.x + lx * (c.spec.W / 2 + 0.7), ez = c.z + lz * (c.spec.W / 2 + 0.7);
      if (col.inside(ex, ez) >= 0) { ex = c.x - lx * (c.spec.W / 2 + 0.7); ez = c.z - lz * (c.spec.W / 2 + 0.7); }
      me.x = ex; me.z = ez; me.y = 0; me.heading = c.heading;
      c.driver = "none"; c.throttle = 0; c.steer = 0; c.hand = 1;
      P.car = null;
      humans.extra = [me];
      if (fare) { endFare("Passenger got out."); }
      return;
    }
    let best: Vehicle | null = null, bd = 1e9;
    for (const c of traffic.cars) {
      const d = Math.hypot(c.x - me.x, c.z - me.z) - c.spec.L / 2;
      if (d < 2.8 && d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    const c = best;
    if (c.driver === "ai" || c.driver === "police") {
      // yank the driver out
      const lx = Math.sin(c.heading), lz = -Math.cos(c.heading);
      const pd = Object.assign(humans.newPose(), {
        e: 0, dir: 1 as 1, p: 0, side: 1, off: 1.5, v: 1.3, state: "flee" as const, t: 0, vx: 0, vz: 0, vy: 0, spin: 0,
        rx: 0, rz: 0, id: humans.nextId++, wait: 0,
      }) as Ped;
      pd.x = c.x + lx * (c.spec.W / 2 + 0.8); pd.z = c.z + lz * (c.spec.W / 2 + 0.8);
      if (c.kind === "police") { pd.shirt.set(0x16233d); pd.pants.set(0x16233d); }
      humans.peds.push(pd);
      if (c.kind === "police") crime(2, "You stole a police cruiser");
      else if (Math.random() < 0.55) crime(1, "Carjacking reported");
      c.vx = Math.cos(c.heading) * c.speed; c.vz = Math.sin(c.heading) * c.speed;
    }
    c.driver = "player"; c.physics = true; c.ai = c.kind === "taxi" ? { fare: true } : null;
    c.hand = 0;
    P.car = c;
    humans.extra = [];
    if (c.kind === "taxi") fareCooldown = Math.min(fareCooldown, 2.5);
  }

  function resetCar() {
    const c = P.car;
    if (!c) return;
    const h = net.nearest(c.x, c.z, 300);
    if (!h) return;
    const e = net.edges[h.e];
    const o = { x: 0, z: 0, tx: 0, tz: 0 };
    net.at(e, h.s, o);
    c.x = o.x; c.z = o.z;
    const along = Math.atan2(o.tz, o.tx);
    c.heading = Math.abs(angd(c.heading, along)) < Math.PI / 2 ? along : along + Math.PI;
    c.vx = c.vz = c.yaw = 0;
  }

  function punch() {
    if (P.punchT > 0) return;
    P.punchT = 0.45;
    const fx2 = Math.cos(me.heading), fz2 = Math.sin(me.heading);
    for (const p of humans.peds) {
      if (p.state === "down") continue;
      const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz);
      if (d < 1.5 && (dx * fx2 + dz * fz2) / (d || 1) > 0.3) {
        humans.knock(p, fx2 * 3, fz2 * 3, false);
        audio.thud(3);
        if (Math.random() < 0.6) crime(1, "Assault reported");
        break;
      }
    }
  }

  function endFare(msg: string) {
    if (fare?.client) humans.extra = humans.extra.filter((x) => x !== fare!.client);
    fare = null;
    marker.visible = false;
    fareCooldown = 4;
    $("mission").innerHTML = "";
    if (msg) toast("FARE LOST", msg);
  }

  function updateFare(dt: number) {
    const c = P.car;
    const inCab = c && c.kind === "taxi";
    if (!inCab) {
      if (fare) endFare("");
      $("mission").innerHTML = P.car ? "" : `Steal a <b>yellow cab</b> to pick up fares &nbsp;<kbd>F</kbd>`;
      if (P.car) $("mission").innerHTML = stars ? "" : `Yellow cabs take fares. Or just cruise.`;
      return;
    }
    if (!fare) {
      $("mission").innerHTML = `On duty — looking for a fare…`;
      if ((fareCooldown -= dt) > 0) return;
      for (let k = 0; k < 20; k++) {
        const a = Math.random() * Math.PI * 2, R = 140 + Math.random() * 280;
        const h = net.nearest(c.x + Math.cos(a) * R, c.z + Math.sin(a) * R, 60, (e) => !e.hw);
        if (!h) continue;
        const e = net.edges[h.e];
        const o = { x: 0, z: 0, tx: 0, tz: 0 };
        net.at(e, h.s, o);
        const side = Math.random() < 0.5 ? 1 : -1;
        const px = o.x - o.tz * side * (e.w / 2 + 0.9), pz = o.z + o.tx * side * (e.w / 2 + 0.9);
        if (col.inside(px, pz) >= 0) continue;
        const client = humans.newPose();
        client.x = px; client.z = pz; client.heading = Math.atan2(-o.tx * side, o.tz * side);
        client.punch = 1;
        humans.extra.push(client);
        fare = { stage: "pickup", x: o.x - o.tz * side * (e.w / 2 - 1.5), z: o.z + o.tx * side * (e.w / 2 - 1.5), client, t: 0, dist: 0, pay: 0 };
        marker.visible = true;
        toast("FARE", `Someone's hailing a cab on ${pretty(e.n)}`);
        break;
      }
      return;
    }
    marker.position.set(fare.x, 0, fare.z);
    const d = Math.hypot(c.x - fare.x, c.z - fare.z);
    if (fare.stage === "pickup") {
      $("mission").innerHTML = `Pick up the passenger — <b>${Math.round(d)} m</b>`;
      if (fare.client) fare.client.punch = 0.7 + 0.3 * Math.sin(simT * 8);
      if (d < 10 && c.speed < 2.5) {
        humans.extra = humans.extra.filter((x) => x !== fare!.client);
        const far = world.places.filter((p) => { const dd = Math.hypot(p.x - c.x, p.z - c.z); return dd > 600 && dd < 3000; });
        const dest = (far.length ? far : world.places)[Math.floor(Math.random() * (far.length || world.places.length))];
        const h = net.nearest(dest.x, dest.z, 300, (e) => !e.hw)!;
        const dist = Math.hypot(h.x - c.x, h.z - c.z);
        fare = { stage: "drop", x: h.x, z: h.z, dest: dest.n, t: 30 + dist * 1.3 / 11, dist, pay: Math.round(6 + (dist / 1000) * 14) };
        audio.chime();
        toast(dest.n.toUpperCase(), `"${LINES[Math.floor(Math.random() * LINES.length)]}"`);
      }
    } else {
      fare.t -= dt;
      const m = Math.max(0, fare.t);
      $("mission").innerHTML = `Take the passenger to <b>${fare.dest}</b> — ${Math.round(d)} m · <b>${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, "0")}</b>`;
      if (d < 15 && c.speed < 3) {
        const tip = Math.round(Math.max(0, fare.t) * 0.25);
        const total = fare.pay + tip;
        P.money += total; P.fares++;
        audio.chime();
        toast(`+$${total}`, tip ? `fare $${fare.pay} + $${tip} tip` : "no tip — you were late");
        fare = null; marker.visible = false; fareCooldown = 3;
      } else if (fare.t <= 0) endFare("You took too long. They jumped out at a red light.");
    }
  }

  // ---------- police ----------
  function updatePolice(dt: number, tx: number, tz: number, tvx: number, tvz: number) {
    const cops = traffic.cars.filter((c) => c.driver === "police");
    const want = [0, 2, 3, 4, 6, 8][stars];
    // patrol cars that see you join the chase
    if (stars > 0) {
      for (const c of traffic.cars) {
        if (c.driver === "ai" && c.kind === "police" && Math.hypot(c.x - tx, c.z - tz) < 140 && col.los(c.x, c.z, tx, tz)) {
          c.driver = "police"; c.physics = true; c.ai = { siren: true };
          c.vx = Math.cos(c.heading) * c.speed; c.vz = Math.sin(c.heading) * c.speed;
        }
      }
    }
    if (cops.length < want) {
      for (let k = 0; k < 6; k++) {
        const a = Math.random() * Math.PI * 2, R = 170 + Math.random() * 140;
        const h = net.nearest(tx + Math.cos(a) * R, tz + Math.sin(a) * R, 80);
        if (!h) continue;
        if (col.los(h.x, h.z, tx, tz) && R < 220) continue;
        const e = net.edges[h.e];
        const o = { x: 0, z: 0, tx: 0, tz: 0 };
        net.at(e, h.s, o);
        const c = new Vehicle("police");
        c.x = o.x; c.z = o.z;
        const toP = Math.atan2(tz - o.z, tx - o.x), along = Math.atan2(o.tz, o.tx);
        c.heading = Math.abs(angd(along, toP)) < Math.PI / 2 ? along : along + Math.PI;
        c.driver = "police"; c.physics = true; c.ai = { siren: true };
        traffic.cars.push(c); scene.add(c.group);
        break;
      }
    }
    let seen = false, nearest = 1e9;
    for (const c of cops) {
      if (stars === 0) {
        // give up: drive off and despawn
        c.ai.siren = false;
        c.throttle = 0.6; c.steer = 0; c.brake = 0;
        c.step(dt, col);
        continue;
      }
      policeDrive(c, dt, tx, tz, tvx, tvz, net, col);
      const d = Math.hypot(c.x - tx, c.z - tz);
      nearest = Math.min(nearest, d);
      if (c.ai.sees || d < 35) seen = true;
    }
    if (stars > 0) {
      pursuitT += dt;
      if (seen) evadeT = 0;
      else if (pursuitT > 14 || nearest > 220) evadeT += dt;
      if (evadeT > 7 + stars * 3) {
        heat = 0; stars = 0; evadeT = 0; pursuitT = 0;
        toast("LOST THEM", "Wanted level cleared");
      }
    }
    // busted?
    const mySpeed = P.car ? P.car.speed : Math.hypot(P.vx, P.vz);
    if (stars > 0 && nearest < 7.5 && mySpeed < 2.2) bustT += dt;
    else bustT = Math.max(0, bustT - dt * 2);
    if (bustT > 2.4 && deadT <= 0) gameOver("busted");
    return nearest;
  }

  function gameOver(kind: "busted" | "wasted") {
    deadT = 4;
    $("big").textContent = kind.toUpperCase();
    $("big").className = kind;
    $("big").hidden = false;
    const fee = Math.min(P.money, kind === "busted" ? 100 + Math.floor(P.money * 0.1) : 100);
    P.money -= fee;
    setTimeout(() => {
      $("big").hidden = true;
      if (P.car) { P.car.driver = "none"; P.car = null; }
      const at = kind === "busted" ? ll(40.7538, -73.9946) : ll(40.7392, -73.9754); // Midtown South Precinct / Bellevue
      const h = net.nearest(at.x, at.z, 200, (e) => !e.hw)!;
      const e = net.edges[h.e];
      const o = { x: 0, z: 0, tx: 0, tz: 0 };
      net.at(e, h.s, o);
      me.x = o.x - o.tz * (e.w / 2 + 1.5); me.z = o.z + o.tx * (e.w / 2 + 1.5); me.y = 0; me.fall = 0;
      humans.extra = [me];
      P.health = 100;
      heat = 0; stars = 0; bustT = 0; evadeT = 0;
      for (const c of [...traffic.cars]) if (c.driver === "police") traffic.remove(c);
      if (fare) endFare("");
      toast(kind === "busted" ? "RELEASED" : "DISCHARGED", `-$${fee} ${kind === "busted" ? "in fines" : "hospital bill"}`);
    }, 3500);
  }

  // ---------- car-car + car-ped collisions ----------
  const circles = (c: Vehicle) => {
    const r = c.spec.W * 0.52, hl = c.spec.L / 2 - r, n = Math.max(2, Math.ceil(c.spec.L / (r * 1.5)));
    const out: [number, number][] = [];
    for (let k = 0; k < n; k++) { const off = -hl + (2 * hl * k) / (n - 1); out.push([c.x + Math.cos(c.heading) * off, c.z + Math.sin(c.heading) * off]); }
    return { r, out };
  };
  function carCollisions() {
    const cars = traffic.cars;
    for (let i = 0; i < cars.length; i++)
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const R = (a.spec.L + b.spec.L) / 2;
        if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > R * R) continue;
        if (!a.physics && !b.physics) continue;
        const ca = circles(a), cb = circles(b);
        for (const [ax, az] of ca.out)
          for (const [bx, bz] of cb.out) {
            const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz), rr = ca.r + cb.r;
            if (d >= rr || d < 1e-4) continue;
            const nx = dx / d, nz = dz / d, pen = rr - d;
            const rv = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
            const hard = -rv;
            // rail cars become physical when hit hard enough
            for (const c of [a, b]) if (!c.physics && hard > 2.5) { c.physics = true; c.vx = Math.cos(c.heading) * c.speed; c.vz = Math.sin(c.heading) * c.speed; }
            const ia = a.physics ? 1 / a.spec.mass : 0, ib = b.physics ? 1 / b.spec.mass : 0;
            if (ia + ib === 0) continue;
            a.x += nx * pen * (ia / (ia + ib)); a.z += nz * pen * (ia / (ia + ib));
            b.x -= nx * pen * (ib / (ia + ib)); b.z -= nz * pen * (ib / (ia + ib));
            if (rv < 0) {
              const jimp = (-(1.3) * rv) / (ia + ib);
              a.vx += jimp * ia * nx; a.vz += jimp * ia * nz;
              b.vx -= jimp * ib * nx; b.vz -= jimp * ib * nz;
              if (hard > 3) {
                for (const c of [a, b]) c.damage += hard * 0.55;
                const pc = a.driver === "player" ? b : b.driver === "player" ? a : null;
                const me3 = a.driver === "player" ? a : b;
                if (pc) {
                  audio.thud(hard); shake = Math.min(1, shake + hard * 0.05);
                  // only your fault if you were the one driving into them
                  const towards = (me3.vx * (pc.x - me3.x) + me3.vz * (pc.z - me3.z)) / (Math.hypot(pc.x - me3.x, pc.z - me3.z) || 1);
                  if (pc.kind === "police" && hard > 4 && towards > 4 && me3.speed > pc.speed) crime(pc.driver === "police" ? 0.5 : 1, "You rammed a cop");
                  if (hard > 12) P.health -= (hard - 12) * 1.2;
                }
              }
            }
          }
      }
  }

  function pedHits() {
    for (const c of traffic.cars) {
      if (c.speed < 2.5) continue;
      const cx = Math.cos(c.heading), cz = Math.sin(c.heading);
      for (const p of humans.peds) {
        if (p.state === "down") continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        const lx = dx * cx + dz * cz, lz = -dx * cz + dz * cx;
        if (Math.abs(lx) < c.spec.L / 2 + 0.25 && Math.abs(lz) < c.spec.W / 2 + 0.25) {
          humans.knock(p, c.vx * 0.9 + (lz > 0 ? -cz : cz) * 2, c.vz * 0.9 + (lz > 0 ? cx : -cx) * 2, c.speed > 6);
          if (c.driver === "player") { audio.thud(c.speed * 0.6); crime(c.speed > 6 ? 1 : 0.5, "Hit and run"); shake = Math.min(1, shake + 0.2); }
          c.vx *= 0.94; c.vz *= 0.94;
        }
      }
      // the player on foot
      if (!P.car && c.driver !== "player" && deadT <= 0) {
        const dx = me.x - c.x, dz = me.z - c.z;
        const lx = dx * cx + dz * cz, lz = -dx * cz + dz * cx;
        if (Math.abs(lx) < c.spec.L / 2 + 0.3 && Math.abs(lz) < c.spec.W / 2 + 0.3 && me.y < 0.8) {
          P.health -= c.speed * 5; P.hurtT = 0;
          P.vx = c.vx * 1.1; P.vz = c.vz * 1.1; P.vy = 3 + c.speed * 0.2;
          audio.thud(c.speed);
          shake = 0.6;
        }
      }
    }
  }

  // ---------- on foot ----------
  const oc = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
  function walk(dt: number) {
    const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const run = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const fx2 = Math.cos(camYaw), fz2 = Math.sin(camYaw);
    let mx = fx2 * f - fz2 * s, mz = fz2 * f + fx2 * s;
    const L = Math.hypot(mx, mz);
    const sp = run ? 6.2 : 1.9;
    const onGround = me.y <= 0.001;
    if (L > 0) { mx /= L; mz /= L; me.heading += angd(me.heading, Math.atan2(mz, mx)) * Math.min(1, dt * 12); }
    const ctl = onGround ? 12 : 2;
    P.vx += ((L > 0 ? mx * sp : 0) - P.vx) * Math.min(1, ctl * dt);
    P.vz += ((L > 0 ? mz * sp : 0) - P.vz) * Math.min(1, ctl * dt);
    if (keys.has("Space") && onGround) P.vy = 4.6;
    me.x += P.vx * dt; me.z += P.vz * dt;
    me.y = Math.max(0, me.y + P.vy * dt);
    P.vy = me.y > 0 ? P.vy - 13 * dt : 0;
    col.circle(me.x, me.z, 0.32, oc);
    if (oc.hit) { me.x = oc.x; me.z = oc.z; }
    // cars are solid
    for (const c of traffic.cars) {
      const dx = me.x - c.x, dz = me.z - c.z;
      if (dx * dx + dz * dz > 100) continue;
      const cx = Math.cos(c.heading), cz = Math.sin(c.heading);
      let lx = dx * cx + dz * cz, lz = -dx * cz + dz * cx;
      const hx = c.spec.L / 2 + 0.3, hz = c.spec.W / 2 + 0.3;
      if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
        if (me.y > c.spec.roof - 0.3) { me.y = c.spec.roof; P.vy = Math.max(0, P.vy); continue; }
        if (hx - Math.abs(lx) < hz - Math.abs(lz)) lx = Math.sign(lx) * hx; else lz = Math.sign(lz) * hz;
        me.x = c.x + lx * cx - lz * cz; me.z = c.z + lx * cz + lz * cx;
      }
    }
    const v = Math.hypot(P.vx, P.vz);
    me.amp = Math.min(1, v / 1.6);
    me.phase += dt * (run && v > 3 ? 11 : 6.5) * Math.min(1, v / 1.5 + 0.2);
    P.punchT = Math.max(0, P.punchT - dt);
    me.punch = P.punchT > 0 ? Math.sin((1 - P.punchT / 0.45) * Math.PI) : 0;
  }

  function drive(c: Vehicle, dt: number) {
    const up = keys.has("KeyW") || keys.has("ArrowUp"), dn = keys.has("KeyS") || keys.has("ArrowDown");
    const lt = keys.has("KeyA") || keys.has("ArrowLeft"), rt = keys.has("KeyD") || keys.has("ArrowRight");
    c.throttle = deadT > 0 ? 0 : (up ? 1 : 0) - (dn ? 1 : 0);
    c.brake = 0;
    const st = (rt ? 1 : 0) - (lt ? 1 : 0);
    const rate = st === 0 ? 5 : Math.sign(st) !== Math.sign(c.steer) ? 6 : 2.6;
    c.steer += THREE.MathUtils.clamp(st - c.steer, -rate * dt, rate * dt);
    c.hand = keys.has("Space") ? 1 : 0;
    c.step(dt, col);
    if (c.impact > 3) { audio.thud(c.impact); shake = Math.min(1, shake + c.impact * 0.04); if (c.impact > 14) P.health -= (c.impact - 14) * 1.5; }
  }

  // ---------- camera ----------
  const camPos = new THREE.Vector3(me.x - 6, 3, me.z);
  const look = new THREE.Vector3();
  let shake = 0;
  function updateCamera(dt: number) {
    mouseT += dt;
    let tx: number, ty: number, tz: number, dist: number;
    const c = P.car;
    if (c) {
      if (mouseT > 1.4 && c.speed > 2) {
        const moveH = c.fwd < -1 ? c.heading : Math.atan2(c.vz, c.vx);
        camYaw += angd(camYaw, c.fwd < -1 ? c.heading : moveH) * Math.min(1, dt * 2.2);
        camPitch += (0.17 - camPitch) * Math.min(1, dt * 1.5);
      }
      tx = c.x; ty = c.spec.roof * 0.85 + 0.6; tz = c.z;
      dist = [c.spec.L * 1.05 + 3.2, c.spec.L * 1.6 + 5, c.spec.L * 0.7 + 1.8][camMode] + c.speed * 0.035;
    } else {
      tx = me.x + Math.cos(camYaw + Math.PI / 2) * 0.45; ty = me.y + 1.6; tz = me.z + Math.sin(camYaw + Math.PI / 2) * 0.45;
      dist = [3.4, 5.5, 2.2][camMode];
    }
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    let dx = -Math.cos(camYaw) * cp, dy = sp, dz = -Math.sin(camYaw) * cp;
    // pull in if a wall is between target and camera
    let dd = dist;
    for (let s = 0.6; s <= dist; s += 0.4) {
      const x = tx + dx * s, y = ty + dy * s, z = tz + dz * s;
      const bh = col.heightAt(x, z);
      if (bh > y - 0.3) { dd = Math.max(0.6, s - 0.5); break; }
    }
    const want = new THREE.Vector3(tx + dx * dd, Math.max(0.5, ty + dy * dd), tz + dz * dd);
    const k = 1 - Math.exp(-dt * (c ? 14 : 20));
    camPos.lerp(want, dd < dist ? 1 : k);
    camera.position.copy(camPos);
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.4; camera.position.y += (Math.random() - 0.5) * shake * 0.3; shake = Math.max(0, shake - dt * 2.5); }
    look.set(tx, ty + (c ? 0.2 : 0), tz);
    camera.lookAt(look);
    const fov = 60 + (c ? Math.min(18, c.speed * 0.32) : 0);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  }

  // ---------- HUD ----------
  const radar = ($("radar") as HTMLCanvasElement).getContext("2d")!;
  let hudT = 0, mapOpen = false, shownMoney = P.money;
  function toggleMap() { mapOpen = !mapOpen; $("bigmap").hidden = !mapOpen; if (mapOpen) drawBig(); }
  function drawBig() {
    const cv = $("bigc") as HTMLCanvasElement;
    cv.width = innerWidth; cv.height = innerHeight;
    const g = cv.getContext("2d")!;
    const px = P.car ? P.car.x : me.x, pz = P.car ? P.car.z : me.z;
    const sc = Math.min(innerWidth / art.canvas.width, innerHeight / art.canvas.height) * 1.6;
    const ox = innerWidth / 2 - art.px(px) * sc, oz = innerHeight / 2 - art.pz(pz) * sc;
    g.fillStyle = "#0e2230"; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(art.canvas, ox, oz, art.canvas.width * sc, art.canvas.height * sc);
    const to = (x: number, z: number) => [ox + art.px(x) * sc, oz + art.pz(z) * sc];
    g.font = "600 12px Inter"; g.textAlign = "center";
    for (const p of world.places) {
      const [x, y] = to(p.x, p.z);
      g.fillStyle = "rgba(255,255,255,.85)"; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
      g.fillStyle = "rgba(0,0,0,.8)"; g.fillText(p.n, x + 1, y - 7); g.fillStyle = "#fff"; g.fillText(p.n, x, y - 8);
    }
    if (fare) { const [x, y] = to(fare.x, fare.z); g.fillStyle = "#ffd23f"; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); }
    for (const c of traffic.cars) if (c.driver === "police") { const [x, y] = to(c.x, c.z); g.fillStyle = "#3b7bff"; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
    const [x, y] = to(px, pz);
    g.save(); g.translate(x, y); g.rotate(camYaw + Math.PI / 2);
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath();
    g.fillStyle = "#fff"; g.fill(); g.strokeStyle = "#000"; g.lineWidth = 2; g.stroke(); g.restore();
  }
  const fmtClock = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
  function pretty(n: string) {
    return n.toLowerCase().replace(/\b(\w)/g, (m) => m.toUpperCase()).replace(/\b(\d+) St\b/, (m, d) => `${d}${ord(+d)} St`).replace(/\b(\d+) Ave\b/, (m, d) => `${d}${ord(+d)} Ave`);
  }
  const ord = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  function hud(dt: number) {
    toastT -= dt;
    if (toastT <= 0) $("toast").classList.remove("show");
    if ((hudT -= dt) > 0) return;
    hudT = 0.1;
    const px = P.car ? P.car.x : me.x, pz = P.car ? P.car.z : me.z;
    $("clock").textContent = fmtClock(atmo.hours);
    shownMoney += (P.money - shownMoney) * 0.35;
    if (Math.abs(P.money - shownMoney) < 1) shownMoney = P.money;
    $("money").textContent = `$${Math.round(shownMoney).toLocaleString()}`;
    $("stars").innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="s${i < stars ? " on" : ""}">★</span>`).join("");
    $("stars").classList.toggle("flash", stars > 0 && evadeT > 1.5);
    ($("health").firstElementChild as HTMLElement).style.width = `${Math.max(0, P.health)}%`;
    const h = net.nearest(px, pz, 60);
    let near = "", nd = 1e9;
    for (const p of world.places) { const d = Math.hypot(p.x - px, p.z - pz); if (d < nd) { nd = d; near = p.n; } }
    $("street").innerHTML = `${h ? pretty(net.edges[h.e].n) : ""}${nd < 700 ? ` <span>· ${near}</span>` : ""}`;
    $("speedo").style.visibility = P.car ? "visible" : "hidden";
    if (P.car) {
      $("mph").textContent = String(Math.round(P.car.speed * 2.237));
      ($("dmg").firstElementChild as HTMLElement).style.width = `${Math.min(100, P.car.damage)}%`;
    }
    // prompt: car nearby?
    let pr = "";
    if (!P.car) {
      for (const c of traffic.cars) if (Math.hypot(c.x - me.x, c.z - me.z) - c.spec.L / 2 < 2.8) { pr = `<kbd>F</kbd> ${c.driver === "none" ? "get in" : "steal"} ${c.kind === "taxi" ? "cab" : c.kind}`; break; }
    } else if (P.car.damage >= 100) pr = "Engine's dead. <kbd>F</kbd> get out and find another ride";
    $("prompt").innerHTML = pr;
    const blips: Blip[] = [];
    for (const c of traffic.cars) if (c.driver === "police") blips.push({ x: c.x, z: c.z, color: Math.floor(simT * 4) % 2 ? "#ff3b3b" : "#3b7bff", r: 4.5, edge: true });
    if (fare) blips.push({ x: fare.x, z: fare.z, color: "#ffd23f", r: 6, edge: true, ring: true });
    drawRadar(radar, art, px, pz, camYaw, blips, 1);
    if (mapOpen) drawBig();
  }

  // ---------- main loop ----------
  setLoad(1, "Ready.");
  $("loading").hidden = true;
  $("ready").hidden = false;
  let last = performance.now();
  const others: { x: number; z: number; r: number }[] = [];
  const threats: { x: number; z: number; vx: number; vz: number }[] = [];
  let popT = 0;
  // warm-up population so the street is busy on the first frame
  traffic.populate(me.x, me.z, new THREE.Vector3(1, 0, 0), new Set());
  humans.populate(me.x, me.z, 0);
  atmo.update(0, new THREE.Vector3(me.x, 0, me.z));

  function loop(now: number) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const run = playing && !paused;
    if (run) {
      simT += dt;
      U.uTime.value = simT;
      if (deadT > 0) deadT -= dt;
      const c = P.car;
      if (c) drive(c, dt); else walk(dt);
      const px = c ? c.x : me.x, pz = c ? c.z : me.z;
      // others for AI yielding
      others.length = 0;
      if (!c) others.push({ x: me.x, z: me.z, r: 0.6 });
      for (const p of humans.peds) if (p.state !== "down") others.push({ x: p.x, z: p.z, r: 0.4 });
      traffic.update(dt, simT, others, (car) => audio.horn(Math.hypot(car.x - px, car.z - pz)));
      for (const v of traffic.cars) if (v.driver === "none" && v.physics) { v.throttle = 0; v.brake = 1; v.steer = 0; v.step(dt, col); }
      const tvx = c ? c.vx : P.vx, tvz = c ? c.vz : P.vz;
      const copD = updatePolice(dt, px, pz, tvx, tvz);
      carCollisions();
      pedHits();
      threats.length = 0;
      for (const v of traffic.cars) if (v.physics && v.speed > 5) threats.push({ x: v.x, z: v.z, vx: v.vx, vz: v.vz });
      humans.update(dt, threats);
      if ((popT -= dt) <= 0) {
        popT = 0.5;
        const camDir = new THREE.Vector3(Math.cos(camYaw), 0, Math.sin(camYaw));
        traffic.populate(px, pz, camDir, new Set(c ? [c] : []));
        humans.populate(px, pz, atmo.night);
      }
      updateFare(dt);
      // health
      P.hurtT += dt;
      if (P.hurtT > 5 && P.health < 100) P.health = Math.min(100, P.health + dt * 3);
      if (P.health <= 0 && deadT <= 0) { P.health = 0; gameOver("wasted"); }
      // effects
      for (const v of traffic.cars) {
        if (v.physics && v.slip > 5.5 && v.speed > 4) {
          for (const side of [-1, 1]) {
            const bx = v.x - Math.cos(v.heading) * v.spec.wb * 0.5 + Math.sin(v.heading) * side * v.spec.W * 0.4;
            const bz = v.z - Math.sin(v.heading) * v.spec.wb * 0.5 - Math.cos(v.heading) * side * v.spec.W * 0.4;
            if (Math.random() < 0.7) fx.emit(bx, 0.3, bz, (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 1.5, 1.6, 0.9, 0.75);
          }
        }
        if (v.damage > 55 && Math.random() < (v.damage - 50) / 90) {
          const hx = v.x + Math.cos(v.heading) * v.spec.L * 0.35, hz = v.z + Math.sin(v.heading) * v.spec.L * 0.35;
          fx.emit(hx, v.spec.belt + 0.1, hz, (Math.random() - 0.5) * 0.6, 1.4 + Math.random(), (Math.random() - 0.5) * 0.6, 2.2, 0.6, v.damage > 90 ? 0.12 : 0.45);
        }
      }
      fx.update(dt, 0.35 + (1 - atmo.night) * 0.65);
      // audio
      const me2 = c;
      audio.update({
        driving: !!me2, rpm: me2 ? Math.min(1.4, (Math.abs(me2.fwd) % 14) / 14 + Math.abs(me2.fwd) / 60) : 0,
        throttle: me2 ? Math.abs(me2.throttle) : 0, slip: me2 ? me2.slip : 0, sirenDist: copD, muted,
      });
      if (hornT > 0) hornT -= dt;
      atmo.update(dt, new THREE.Vector3(px, 0, pz));
      U.uNight.value = atmo.night;
      bloom.strength = 0.16 + atmo.night * 0.3;
      updateCamera(dt);
      props.update(camera.position, simT, atmo.night, net);
      for (const v of traffic.cars) v.sync(dt, atmo.night, simT);
      humans.render(camera.position);
      // player headlights at night
      if (c && atmo.night > 0.2) {
        headlight.intensity = 60 * atmo.night;
        headlight.position.set(c.x + Math.cos(c.heading) * c.spec.L * 0.5, 0.9, c.z + Math.sin(c.heading) * c.spec.L * 0.5);
        headlight.target.position.set(c.x + Math.cos(c.heading) * 30, 0, c.z + Math.sin(c.heading) * 30);
      } else headlight.intensity = 0;
      (marker.children[1] as THREE.Mesh).scale.setScalar(1 + 0.08 * Math.sin(simT * 4));
      hud(dt);
    } else {
      // idle: slow orbit for the title screen
      simT += dt;
      U.uTime.value = simT;
      const a = simT * 0.04;
      camera.position.set(ts.x + Math.cos(a) * 560, 250, ts.z + Math.sin(a) * 560);
      camera.lookAt(ts.x, 20, ts.z);
      atmo.update(0, new THREE.Vector3(ts.x, 0, ts.z));
      U.uNight.value = atmo.night;
      if (bloom) bloom.strength = 0.16 + atmo.night * 0.3;
      props.update(camera.position, simT, atmo.night, net);
      traffic.update(dt, simT, [], () => {});
      for (const v of traffic.cars) v.sync(dt, atmo.night, simT);
      humans.update(dt, []);
      humans.render(camera.position);
    }
    grade.uniforms.uTime.value = simT % 10;
    composer.render();
  }
  requestAnimationFrame(loop);
  (window as any).__g = { scene, camera, renderer, traffic, humans, P, me, atmo, net, col, world, setHours: (h: number) => (atmo.hours = h), crime, get stars() { return stars; } };
}

const LINES = [
  "Take the FDR, it's faster.", "Don't take the FDR.", "I'm late, I'm so late.", "Can you not drive like that?",
  "My Uber canceled, thank god you're here.", "Is it always this bad on Broadway?", "Just get me there in one piece.",
  "Do you take Venmo?", "I'm visiting from Ohio!", "Step on it.",
];

boot().catch((e) => {
  console.error(e);
  $("loadtxt").textContent = "Failed to load: " + e.message;
});
