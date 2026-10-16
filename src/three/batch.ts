import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface PlaceOpts {
  pos?: [number, number, number];
  rotY?: number;
  rotX?: number;
  rotZ?: number;
  scale?: [number, number, number] | number;
  color: string | THREE.Color;
  /** 世界单位 UV 缩放：把贴图密度对齐到「1 tile = 1 米」的契约 */
  uvScale?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * 顶点色合批器：同材质的几百个构件合并成一个 BufferGeometry，
 * 每种材质只留 1 个 draw call（这是 60FPS 的第一块基石）。
 */
export class Batch {
  private list: THREE.BufferGeometry[] = [];

  get count() {
    return this.list.length;
  }

  add(geo: THREE.BufferGeometry, opts: PlaceOpts) {
    // Extrude 出来的几何没有索引、Box/Cylinder 有 —— 混在一起 mergeGeometries 会直接失败。
    // 统一转成非索引几何，代价是顶点数略有增加，换来合批永远成功。
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    // UV 密度
    const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (uv) {
      const k = typeof opts.uvScale === "number" ? opts.uvScale : 1;
      if (k !== 1) {
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
      }
    }
    // 顶点色
    _c.set(opts.color);
    const n = g.getAttribute("position").count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    // 变换
    const p = opts.pos ?? [0, 0, 0];
    const r = opts.rotY ?? 0;
    const scale = opts.scale ?? 1;
    _e.set(opts.rotX ?? 0, r, opts.rotZ ?? 0, "YXZ");
    _q.setFromEuler(_e);
    _v.set(p[0], p[1], p[2]);
    if (typeof scale === "number") _s.set(scale, scale, scale);
    else _s.set(scale[0], scale[1], scale[2]);
    _m.compose(_v, _q, _s);
    g.applyMatrix4(_m);
    this.list.push(g);
    return this;
  }

  build(): THREE.BufferGeometry | null {
    if (!this.list.length) return null;
    const merged = mergeGeometries(this.list, false);
    this.list.forEach((g) => g.dispose());
    this.list = [];
    if (merged) {
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
    }
    return merged;
  }
}

export function toMesh(geo: THREE.BufferGeometry | null, mat: THREE.Material, name: string, cast = true, receive = true) {
  if (!geo) return null;
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/** 共享单位盒子，避免为每块构件 new 一个几何体 */
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export function box(
  batch: Batch,
  size: [number, number, number],
  pos: [number, number, number],
  color: string,
  extra: Partial<PlaceOpts> = {},
) {
  batch.add(UNIT_BOX, {
    ...extra,
    pos,
    scale: size,
    color,
    uvScale: extra.uvScale ?? 1,
  });
}

/** 圆角矩形路径（用于底板 / 广场的挤出体） */
export function roundedSquare(half: number, radius: number) {
  const p = new THREE.Path();
  const h = half;
  const r = Math.min(radius, h);
  p.moveTo(-h + r, -h);
  p.lineTo(h - r, -h);
  p.quadraticCurveTo(h, -h, h, -h + r);
  p.lineTo(h, h - r);
  p.quadraticCurveTo(h, h, h - r, h);
  p.lineTo(-h + r, h);
  p.quadraticCurveTo(-h, h, -h, h - r);
  p.lineTo(-h, -h + r);
  p.quadraticCurveTo(-h, -h, -h + r, -h);
  p.closePath();
  return p;
}

export function roundedSquareShape(half: number, radius: number) {
  const p = roundedSquare(half, radius);
  const shape = new THREE.Shape();
  shape.curves = p.curves;
  shape.currentPoint = p.currentPoint;
  return shape;
}

/** 水平放置的挤出体：底面落在 yBottom，顶面在 yBottom + height */
export function extrudeFlat(shape: THREE.Shape, height: number, yBottom: number) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 14,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, yBottom, 0);
  geo.computeVertexNormals();
  return geo;
}
