import * as THREE from "three";
import { createRingSprite, createSpark } from "./textures";

/* ------------------------------------------------------------------ *
 *  补间 / 动画调度
 * ------------------------------------------------------------------ */

export const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInCubic = (t: number) => t * t * t;
export const easeOutElastic = (t: number) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export interface Anim {
  update(dt: number): boolean;
}

/** 极简动画队列：update 返回 true 表示这一条播完了 */
export class Animator {
  private list: Anim[] = [];
  private done: (() => void)[] = [];

  wait(anim: Anim): Promise<void> {
    return new Promise<void>((resolve) => {
      this.done.push(resolve);
      this.list.push(anim);
    });
  }

  /** 纯延时 */
  delay(seconds: number): Promise<void> {
    let t = 0;
    return this.wait({
      update(dt) {
        t += dt;
        return t >= seconds;
      },
    });
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      let finished = false;
      try {
        finished = a.update(dt);
      } catch {
        finished = true;
      }
      if (finished) {
        this.list.splice(i, 1);
        const resolve = this.done.splice(i, 1)[0];
        resolve?.();
      }
    }
  }

  clear() {
    this.list = [];
    const pending = this.done;
    this.done = [];
    pending.forEach((r) => r());
  }

  get size() {
    return this.list.length;
  }
}

/** 数值 tween → 每帧回调 */
export function tween(
  dur: number,
  onUpdate: (k: number, raw: number) => void,
  ease: (t: number) => number = easeInOutQuad,
): Anim {
  let t = 0;
  return {
    update(dt) {
      t += dt;
      const raw = Math.min(1, t / dur);
      onUpdate(ease(raw), raw);
      return raw >= 1;
    },
  };
}

/* ------------------------------------------------------------------ *
 *  粒子系统（单 draw call）
 * ------------------------------------------------------------------ */

interface P {
  life: number;
  max: number;
  vx: number;
  vy: number;
  vz: number;
  drag: number;
  grav: number;
  size: number;
  cr: number;
  cg: number;
  cb: number;
}

const MAX_PARTICLES = 1400;

export class Particles {
  points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private pool: P[] = [];
  private cursor = 0;
  private sprite: THREE.Texture;
  private pixelScale = 40;

  constructor() {
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.alpha = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pos[i * 3 + 1] = -999;
      this.pool.push({
        life: 0, max: 1, vx: 0, vy: 0, vz: 0, drag: 1.4, grav: -9,
        size: 1, cr: 1, cg: 1, cb: 1,
      });
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.sprite = createSpark();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.sprite },
        uPixelScale: { value: this.pixelScale },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uPixelScale;
        void main() {
          vAlpha = aAlpha;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, aSize * uPixelScale);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  setPixelScale(v: number) {
    this.pixelScale = v;
    this.mat.uniforms.uPixelScale.value = v;
  }

  emit(
    x: number, y: number, z: number,
    count: number,
    opts: {
      color: THREE.Color | string;
      speed?: number;
      spread?: number;
      size?: number;
      life?: number;
      grav?: number;
      drag?: number;
      up?: number;
      coneY?: number;
    },
  ) {
    const c = opts.color instanceof THREE.Color ? opts.color : new THREE.Color(opts.color);
    const speed = opts.speed ?? 4;
    const spread = opts.spread ?? 1;
    const size = opts.size ?? 0.16;
    const life = opts.life ?? 0.9;
    const grav = opts.grav ?? -9;
    const drag = opts.drag ?? 1.6;
    const up = opts.up ?? 0.5;
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const p = this.pool[idx];
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const dirX = Math.sin(phi) * Math.cos(theta);
      const dirZ = Math.sin(phi) * Math.sin(theta);
      const dirY = Math.cos(phi) * 0.6 + up;
      const s = speed * (0.45 + Math.random() * 0.9);
      p.vx = dirX * s * spread;
      p.vz = dirZ * s * spread;
      p.vy = dirY * s;
      p.max = life * (0.6 + Math.random() * 0.7);
      p.life = p.max;
      p.size = size * (0.6 + Math.random() * 0.85);
      p.grav = grav;
      p.drag = drag;
      const jitter = 0.86 + Math.random() * 0.28;
      p.cr = Math.min(1, c.r * jitter);
      p.cg = Math.min(1, c.g * jitter);
      p.cb = Math.min(1, c.b * jitter);
      const jx = (Math.random() - 0.5) * 0.28;
      const jz = (Math.random() - 0.5) * 0.28;
      const jy = (Math.random() - 0.5) * 0.28;
      this.pos[idx * 3] = x + jx;
      this.pos[idx * 3 + 1] = y + jy;
      this.pos[idx * 3 + 2] = z + jz;
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i];
      if (p.life <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d + p.grav * dt;
      this.pos[i * 3] += p.vx * dt;
      this.pos[i * 3 + 1] += p.vy * dt;
      this.pos[i * 3 + 2] += p.vz * dt;
      if (this.pos[i * 3 + 1] < 0.3 && p.grav < 0) {
        this.pos[i * 3 + 1] = 0.3;
        p.vy = Math.abs(p.vy) * 0.22;
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
      this.alpha[i] = k * k;
      this.col[i * 3] = p.cr;
      this.col[i * 3 + 1] = p.cg;
      this.col[i * 3 + 2] = p.cb;
      this.size[i] = p.size;
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.sprite.dispose();
  }
}

/* ------------------------------------------------------------------ *
 *  冲击波光环池
 * ------------------------------------------------------------------ */

interface RingInstance {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  from: number;
  to: number;
  active: boolean;
}

export class ShockPool {
  group = new THREE.Group();
  private rings: RingInstance[] = [];
  private tex: THREE.Texture;

  constructor(count = 10) {
    this.tex = createRingSprite(0.16);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.tex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, life: 0, max: 1, from: 0, to: 1, active: false });
    }
  }

  spawn(x: number, y: number, z: number, from: number, to: number, color: string, dur = 0.6) {
    const r = this.rings.find((q) => !q.active) ?? this.rings[0];
    r.active = true;
    r.life = dur;
    r.max = dur;
    r.from = from;
    r.to = to;
    r.mesh.visible = true;
    r.mesh.position.set(x, y, z);
    r.mat.color.set(color);
    r.mat.opacity = 1;
    r.mesh.scale.setScalar(from);
  }

  update(dt: number) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.life -= dt;
      const k = 1 - Math.max(0, r.life) / r.max;
      const s = r.from + (r.to - r.from) * easeOutCubic(k);
      r.mesh.scale.setScalar(s);
      r.mat.opacity = (1 - k) * 0.95;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
      }
    }
  }

  dispose() {
    this.tex.dispose();
    this.rings.forEach((r) => {
      r.mesh.geometry.dispose();
      r.mat.dispose();
    });
  }
}
