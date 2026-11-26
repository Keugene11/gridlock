import * as THREE from "three";

/** Soft particle pool: tire smoke, engine smoke, impact dust. */
export class Particles {
  N = 900;
  pos = new Float32Array(this.N * 3);
  vel = new Float32Array(this.N * 3);
  life = new Float32Array(this.N);
  max = new Float32Array(this.N);
  size = new Float32Array(this.N);
  alpha = new Float32Array(this.N);
  shade = new Float32Array(this.N);
  geo = new THREE.BufferGeometry();
  points: THREE.Points;
  i = 0;
  constructor(scene: THREE.Scene) {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setAttribute("aShade", new THREE.BufferAttribute(this.shade, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 600 }, uLight: { value: 1 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aShade; varying float vA; varying float vS; uniform float uScale;
        void main(){ vA = aAlpha; vS = aShade; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uScale/max(0.5,-mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying float vA; varying float vS; uniform float uLight;
        void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); float a = smoothstep(0.5, 0.1, d)*vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(vS)*uLight, a); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, shade: number) {
    const i = this.i++ % this.N;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.shade[i] = shade;
  }
  update(dt: number, light: number) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const f = this.life[i] / this.max[i];
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3] *= 0.97; this.vel[i * 3 + 2] *= 0.97;
      this.size[i] += dt * 1.6;
      this.alpha[i] = Math.max(0, f) * 0.45;
    }
    (this.points.material as THREE.ShaderMaterial).uniforms.uLight.value = light;
    for (const k of ["position", "aSize", "aAlpha", "aShade"]) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}
