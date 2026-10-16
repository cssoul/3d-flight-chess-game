import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { pawnProfile } from "./boards/shared";
import { createBlobShadow } from "./textures";
import { Animator, easeOutBack, easeOutCubic, tween } from "./fx";

/* ------------------------------------------------------------------ *
 *  棋子
 * ------------------------------------------------------------------ */

export interface PieceLook {
  color: string;
  deep: string;
}

export class Piece {
  root = new THREE.Group();
  body = new THREE.Group();
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  ring: THREE.Mesh;
  bubble: THREE.Mesh;
  cryo: THREE.Mesh;
  height: number;
  private bodyMeshScale: number;

  constructor(look: PieceLook, height = 1.35) {
    this.height = height;
    const profile = pawnProfile();
    const geo = new THREE.LatheGeometry(profile, 30);
    // 轮廓高 1.0、底半径 0.32 → 这里 height=1.35 时整体高 1.35、底半径 0.43。
    // 旧版底半径是 0.74（直径 1.49，占到 1.9 的格子八成宽），挤在格里像四个大陀螺；
    // 现在直径 0.86 只占格子四成半，同一格站 4 个也分得开。
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(look.color),
      roughness: 0.18,
      metalness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.25,
      emissive: new THREE.Color(look.deep),
      emissiveIntensity: 0.06,
    });
    this.bodyMeshScale = height;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.scale.setScalar(height);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.body.add(this.mesh);
    this.root.add(this.body);

    // 影子与地环都要跟着新的落地半径（0.43）走，否则会出现"影比人大"的悬浮感
    const shadowTex = createBlobShadow();
    const shadowGeo = new THREE.PlaneGeometry(1.24, 1.24);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85,
    });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.position.y = 0.055;
    this.shadow.renderOrder = 2;
    this.root.add(this.shadow);

    // 玩家色地环（当前回合时点亮）
    const ringGeo = new THREE.RingGeometry(0.44, 0.6, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(look.color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.position.y = 0.075;
    this.ring.renderOrder = 3;
    this.root.add(this.ring);

    // 护盾泡
    const bubbleGeo = new THREE.SphereGeometry(0.6, 20, 14);
    const bubbleMat = new THREE.MeshPhysicalMaterial({
      color: 0x8fe8d0,
      transparent: true,
      opacity: 0,
      roughness: 0.05,
      metalness: 0,
      transmission: 0,
      clearcoat: 1,
      envMapIntensity: 1.6,
      depthWrite: false,
    });
    this.bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
    this.bubble.position.y = 0.62;
    this.bubble.scale.setScalar(height * 0.9);
    this.bubble.visible = false;
    this.root.add(this.bubble);

    // 冻结晶簇
    const cryoGeo = new THREE.IcosahedronGeometry(0.56, 0);
    const cryoMat = new THREE.MeshStandardMaterial({
      color: 0xa9e4fb,
      transparent: true,
      opacity: 0.46,
      roughness: 0.1,
      metalness: 0.1,
      emissive: new THREE.Color(0x7fd4ff),
      emissiveIntensity: 0.4,
      flatShading: true,
      depthWrite: false,
    });
    this.cryo = new THREE.Mesh(cryoGeo, cryoMat);
    this.cryo.position.y = 0.62;
    this.cryo.scale.setScalar(height * 0.86);
    this.cryo.visible = false;
    this.cryo.rotation.set(0.4, 0.7, 0.2);
    this.root.add(this.cryo);
  }

  setPosition(x: number, y: number, z: number) {
    this.root.position.set(x, y, z);
  }

  /** 跳跃过程中：抬高 + 挤压拉伸 + 假阴影变化 */
  setAirborne(lift: number) {
    this.body.userData.airborne = true;
    this.body.position.y = lift;
    const k = Math.min(1, lift / 1.5);
    const squash = 1 - k * 0.16;
    const stretch = 1 + k * 0.18;
    this.body.scale.set(squash, stretch, squash);
    this.body.rotation.y = lift * 0.4;
    const s = 1 + k * 0.45;
    this.shadow.scale.set(s, 1, s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.85 - k * 0.42;
  }

  /** 落地压扁回弹 */
  squash(intensity = 1) {
    const k = Math.min(1, intensity);
    this.body.scale.set(1 + 0.24 * k, 1 - 0.3 * k, 1 + 0.24 * k);
    this.body.position.y = 0;
  }

  setRingVisible(v: boolean) {
    (this.ring.material as THREE.MeshBasicMaterial).opacity = v ? 0.85 : 0;
  }

  setShield(on: boolean) {
    this.bubble.visible = on;
    (this.bubble.material as THREE.MeshPhysicalMaterial).opacity = on ? 0.24 : 0;
  }

  setFrozen(on: boolean) {
    this.cryo.visible = on;
    if (on) this.cryo.scale.setScalar(this.height * 0.86);
  }

  setOpacity(v: number) {
    const m = this.mesh.material as THREE.MeshPhysicalMaterial;
    m.transparent = v < 1;
    m.opacity = v;
  }

  tint(hex: string) {
    const m = this.mesh.material as THREE.MeshPhysicalMaterial;
    m.emissive.set(hex);
    m.emissiveIntensity = 0.6;
  }

  clearTint() {
    const m = this.mesh.material as THREE.MeshPhysicalMaterial;
    m.emissiveIntensity = 0.06;
  }

  update(dt: number, time: number, active: boolean, frozen: boolean) {
    // 待机呼吸 & 落地后复位
    if (!this.body.userData.airborne) {
      const bob = Math.sin(time * 2.1 + this.root.position.x) * 0.035;
      const k = Math.min(1, dt * 10);
      this.body.position.y += (bob - this.body.position.y) * k;
      this.body.scale.x += (1 - this.body.scale.x) * Math.min(1, dt * 13);
      this.body.scale.y += (1 - this.body.scale.y) * Math.min(1, dt * 13);
      this.body.scale.z += (1 - this.body.scale.z) * Math.min(1, dt * 13);
      this.body.rotation.y += (0 - this.body.rotation.y) * Math.min(1, dt * 7);
      const ss = this.shadow.scale.x;
      this.shadow.scale.setScalar(ss + (1 - ss) * Math.min(1, dt * 8));
      const sm = this.shadow.material as THREE.MeshBasicMaterial;
      sm.opacity += (0.85 - sm.opacity) * Math.min(1, dt * 8);
    }
    this.body.userData.airborne = false;

    const rm = this.ring.material as THREE.MeshBasicMaterial;
    const target = active ? 0.62 + Math.sin(time * 4) * 0.25 : 0;
    rm.opacity += (target - rm.opacity) * Math.min(1, dt * 6);
    const sc = active ? 1 + Math.sin(time * 4) * 0.06 : 1;
    this.ring.scale.setScalar(sc);

    if (this.bubble.visible) {
      const bs = this.height * 0.9 * (1 + Math.sin(time * 6) * 0.03);
      this.bubble.scale.setScalar(bs);
      this.bubble.rotation.y += dt * 0.6;
    }
    if (this.cryo.visible) {
      this.cryo.rotation.y += dt * 0.5;
      this.cryo.rotation.x = 0.4 + Math.sin(time) * 0.05;
      (this.cryo.material as THREE.MeshStandardMaterial).emissiveIntensity =
        frozen ? 0.4 + Math.sin(time * 5) * 0.2 : 0;
    }
    void this.bodyMeshScale;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 *  骰子
 * ------------------------------------------------------------------ */

const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, 1], [1, -1]],
  3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

/** 面朝向约定：+X=1 / −X=6 / +Y=2 / −Y=5 / +Z=3 / −Z=4 */
const FACE_NORMAL: { n: [number, number, number]; va: [number, number, number]; vb: [number, number, number]; value: number }[] = [
  { n: [1, 0, 0], va: [0, 1, 0], vb: [0, 0, 1], value: 1 },
  { n: [-1, 0, 0], va: [0, 1, 0], vb: [0, 0, -1], value: 6 },
  { n: [0, 1, 0], va: [1, 0, 0], vb: [0, 0, 1], value: 2 },
  { n: [0, -1, 0], va: [1, 0, 0], vb: [0, 0, 1], value: 5 },
  { n: [0, 0, 1], va: [1, 0, 0], vb: [0, 1, 0], value: 3 },
  { n: [0, 0, -1], va: [1, 0, 0], vb: [0, 1, 0], value: 4 },
];

/** 各点数对应的"朝上"姿态 */
function orientationFor(value: number): THREE.Quaternion {
  const e = new THREE.Euler(0, 0, 0);
  switch (value) {
    case 1: e.set(0, 0, Math.PI / 2); break;
    case 6: e.set(0, 0, -Math.PI / 2); break;
    case 2: e.set(0, 0, 0); break;
    case 5: e.set(Math.PI, 0, 0); break;
    case 3: e.set(-Math.PI / 2, 0, 0); break;
    case 4: e.set(Math.PI / 2, 0, 0); break;
    default: break;
  }
  return new THREE.Quaternion().setFromEuler(e);
}

export class Dice {
  root = new THREE.Group();
  mesh: THREE.Mesh;
  private pipMesh: THREE.Mesh;
  private size = 1.35;
  private baseY: number;
  private time = 0;
  private spin = new THREE.Euler(0, 0, 0);

  constructor(baseY = 5.0) {
    this.baseY = baseY;
    const s = this.size;
    // 圆角盒：真实骰子的倒角是质感的一半
    const geo = new RoundedBoxGeometry(s, s, s, 3, s * 0.13);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xfdfefe,
      roughness: 0.28,
      metalness: 0.02,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.1,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = false;
    this.root.add(this.mesh);

    // 点数：合并成一格网格 + 深色材质
    const pipGeo = new THREE.CylinderGeometry(s * 0.075, s * 0.075, s * 0.045, 14);
    const list: THREE.BufferGeometry[] = [];
    for (const face of FACE_NORMAL) {
      for (const [a, b] of PIP_LAYOUT[face.value]) {
        const g = pipGeo.clone();
        // 圆柱默认沿 +Y；先转到面法线方向
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(face.n[0], face.n[1], face.n[2]),
        );
        const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
        g.applyMatrix4(m);
        const offset = new THREE.Vector3(face.n[0], face.n[1], face.n[2]).multiplyScalar(s / 2 + s * 0.012);
        offset.addScaledVector(new THREE.Vector3(face.va[0], face.va[1], face.va[2]), a * s * 0.24);
        offset.addScaledVector(new THREE.Vector3(face.vb[0], face.vb[1], face.vb[2]), b * s * 0.24);
        g.translate(offset.x, offset.y, offset.z);
        list.push(g);
      }
    }
    pipGeo.dispose();
    const pipMat = new THREE.MeshStandardMaterial({ color: 0x2b3642, roughness: 0.35, metalness: 0.2 });
    const merged = mergeAll(list);
    this.pipMesh = new THREE.Mesh(merged, pipMat);
    this.root.add(this.pipMesh);

    this.root.position.set(0, baseY, 0);
  }

  /** 常驻：缓慢自转 + 上下浮动 */
  idle(dt: number) {
    this.time += dt;
    if (!this.root.userData.busy) {
      this.root.position.y = this.baseY + Math.sin(this.time * 1.4) * 0.16;
      this.root.rotation.y = this.time * 0.35;
      this.root.rotation.x = Math.sin(this.time * 0.8) * 0.08;
    }
  }

  /** 完整的一次掷骰演出 */
  async roll(value: number, anim: Animator, onImpact?: (k: number) => void): Promise<void> {
    this.root.userData.busy = true;
    const start = this.root.position.clone();
    this.spin.set(0, 0, 0);
    const peak = this.baseY + 3.0;

    // 1) 抛起
    await anim.wait(
      tween(0.42, (k) => {
        this.root.position.y = start.y + (peak - start.y) * k;
      }, easeOutCubic),
    );

    // 2) 空中翻滚
    let tumbleT = 0;
    await anim.wait({
      update: (dt) => {
        tumbleT += dt;
        const speed = 22 * Math.max(0.15, 1 - tumbleT / 0.5);
        this.spin.x += speed * dt * 0.55;
        this.spin.y += speed * dt * 0.9;
        this.spin.z += speed * dt * 0.42;
        this.root.rotation.set(this.spin.x, this.spin.y, this.spin.z);
        this.root.position.y = peak + Math.sin(tumbleT * 12) * 0.16;
        return tumbleT >= 0.5;
      },
    });

    // 3) 落定到指定点数
    const targetQ = orientationFor(value);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.random() * Math.PI * 2,
    );
    targetQ.premultiply(yawQ);
    const fromQ = this.root.quaternion.clone();
    const fromY = this.root.position.y;
    await anim.wait(
      tween(0.34, (k) => {
        this.root.quaternion.slerpQuaternions(fromQ, targetQ, k);
        this.root.position.y = fromY + (this.baseY - fromY) * k - Math.sin(k * Math.PI) * 0.1;
      }, (t) => 1 - Math.pow(1 - t, 3)),
    );

    // 4) 落桌回弹
    await anim.wait(
      tween(0.34, (k) => {
        const bounce = Math.sin(k * Math.PI * 1.6) * (1 - k) * 0.38;
        this.root.position.y = this.baseY + bounce;
        const sc = 1 + bounce * 0.14;
        this.mesh.scale.set(sc, 2 - sc, sc);
      }, (t) => t),
    );
    this.mesh.scale.set(1, 1, 1);
    onImpact?.(value);
    this.root.userData.busy = false;
  }

  position() {
    return this.root.position;
  }

  setBaseY(y: number) {
    this.baseY = y;
    this.root.position.y = y;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
  }
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = flat.reduce((s, g) => s + (g.getAttribute("position") as THREE.BufferAttribute).count, 0);
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let off = 0;
  for (const g of flat) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const n = g.getAttribute("normal") as THREE.BufferAttribute;
    const u = g.getAttribute("uv") as THREE.BufferAttribute;
    position.set(p.array as Float32Array, off * 3);
    normal.set(n.array as Float32Array, off * 3);
    if (u) uv.set(u.array as Float32Array, off * 2);
    off += p.count;
  }
  list.forEach((g) => g.dispose());
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

export { easeOutBack };
