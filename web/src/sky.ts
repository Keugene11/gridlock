import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Time of day: sun path for NYC in late autumn, sky, fog, lights and the PMREM environment. */
export class Atmosphere {
  sky = new Sky();
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbcd2ff, 0x3a3530, 0.6);
  fog = new THREE.FogExp2(0x9aa6b4, 0.00032);
  hours = 15.35;
  night = 0;
  dusk = 0;
  sunDir = new THREE.Vector3();
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private lastEnvAngle = -999;
  private envRT: THREE.WebGLRenderTarget | null = null;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.sky.scale.setScalar(20000);
    (this.sky.material as THREE.ShaderMaterial).depthWrite = false;
    scene.add(this.sky);
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220; sc.near = 10; sc.far = 1800;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    // a dark ground disc in the env so reflections aren't lit from below
    const g = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshBasicMaterial({ color: 0x1c1d20 }));
    g.rotation.x = -Math.PI / 2; g.position.y = -2;
    this.envScene.add(g);
    this.envGround = g.material as THREE.MeshBasicMaterial;
  }
  private envGround: THREE.MeshBasicMaterial;

  setShadowSize(n: number) {
    this.sun.shadow.mapSize.set(n, n);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as any;
  }

  update(dt: number, focus: THREE.Vector3, rate = 1 / 120) {
    this.hours = (this.hours + (dt * rate)) % 24; // rate: game hours per real second
    // Sun model: NYC (40.7N) near late November: declination ~ -21 deg, solar noon ~11:50 EST
    const lat = (40.73 * Math.PI) / 180, dec = (-21 * Math.PI) / 180;
    const H = ((this.hours - 11.85) * 15 * Math.PI) / 180;
    const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(H)); // from north, clockwise
    const elDeg = (el * 180) / Math.PI;
    // world: north = -z, east = +x
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    // keep a faint "sun" (moonlight-ish) above the horizon at night for shading
    this.night = smooth(4, -7, elDeg);
    this.dusk = smooth(-6, 2, elDeg) * smooth(22, 3, elDeg);

    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    const sd = this.sunDir.clone();
    if (elDeg < -4) sd.y = Math.max(sd.y, -0.07);
    u.sunPosition.value.copy(sd);
    u.turbidity.value = 3.5 + this.dusk * 4;
    u.rayleigh.value = 2.4 + this.dusk * 1.0;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.86;

    // lights
    const day = 1 - this.night;
    const warm = new THREE.Color().setHSL(0.08, 0.85, 0.62);
    const noon = new THREE.Color(0xfff3e2);
    this.sun.color.copy(noon).lerp(warm, this.dusk);
    const lightDir = this.sunDir.clone();
    if (this.night > 0.5) {
      // moon from the southwest
      lightDir.set(-0.35, 0.6, 0.45).normalize();
      this.sun.color.set(0x8ea6d8);
    }
    this.sun.intensity = Math.max(0.0, smooth(-2, 10, elDeg)) * (2.6 - this.dusk * 0.9) + this.night * 0.18;
    this.hemi.intensity = 0.6 - day * 0.1 - this.dusk * 0.1;
    this.hemi.color.set(0xbcd2ff).lerp(new THREE.Color(0xffc99a), this.dusk * 0.6).lerp(new THREE.Color(0x4a5470), this.night);
    this.hemi.groundColor.set(0x3a3530).lerp(new THREE.Color(0x8a5a32), this.night * 0.8);

    const fogDay = new THREE.Color(0xa7b3c0), fogDusk = new THREE.Color(0xc79a7e), fogNight = new THREE.Color(0x141824);
    this.fog.color.copy(fogDay).lerp(fogDusk, this.dusk).lerp(fogNight, this.night);
    this.fog.density = 0.00026 + this.dusk * 0.00008 + this.night * 0.00014;
    this.envGround.color.set(0x8a8d92).lerp(new THREE.Color(0x8a6a50), this.dusk * 0.5).lerp(new THREE.Color(0x0c0d10), this.night);

    // shadow camera follows focus, snapped to texels to avoid shimmer
    const D = 700;
    const snap = (440 / this.sun.shadow.mapSize.x) * 2;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + lightDir.x * D, Math.max(60, lightDir.y * D), fz + lightDir.z * D);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(focus);

    const ang = this.hours * 15;
    if (Math.abs(ang - this.lastEnvAngle) > 1.2) {
      this.lastEnvAngle = ang;
      const eu = (this.envSky.material as THREE.ShaderMaterial).uniforms;
      for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) eu[k].value = u[k].value;
      eu.sunPosition.value.copy(sd);
      const rt = this.pmrem.fromScene(this.envScene as any, 0, 0.1, 2000);
      this.scene.environment = rt.texture;
      this.envRT?.dispose();
      this.envRT = rt;
    }
    this.renderer.toneMappingExposure = 0.55 + this.night * 0.35 + this.dusk * 0.1;
    (this.scene as any).environmentIntensity = 0.3 + day * 0.9;
  }
}
