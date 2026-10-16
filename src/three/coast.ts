import * as THREE from "three";

/**
 * 浮岛的地形轮廓 —— 棋盘和「棋盘之外」共用的唯一一份岸线定义。
 *
 * 之前草地 / 泥土 / 沙滩是同一个半径函数乘三个系数，得到的三条曲线严格同心：
 * 滩肩与土坎的宽度绕着岛处处一样，看起来就像给一块绿盘子描了两圈等宽的边。
 * 这里改成
 *   草地外缘 = 起伏的岸线
 *   泥土外缘 = 草地外缘 + 变化的土坎宽
 *   沙滩外缘 = 泥土外缘 + 变化的滩肩宽
 * 用"往外加宽度"而不是"乘系数"，滩肩自然就有了宽窄 —— 有的朝向是一大片亮沙滩，
 * 有的朝向草几乎一直长到水边。
 */

/**
 * 岸线的起伏。3/5/7/11 次谐波，总幅度 18%，低频为主 ——
 * 出的是大瓣的圆唇（参考图里那种被啃过的岛形），而不是一圈锯齿。
 *
 * 下限 0.86 是硬约束，不是审美选择：十字环道石板带最远的那个角在 16.3，
 * 草地上任何一个朝向都必须还包得住它。振幅再大一点，某个凹湾就会咬进环道，
 * 表现是"棋盘有一段悬在土坎上"。
 */
function wobble(theta: number) {
  const w = (
    1
    + Math.sin(theta * 3 + 0.7) * 0.085
    + Math.sin(theta * 5 + 2.1) * 0.05
    + Math.sin(theta * 7 + 4.3) * 0.032
    + Math.sin(theta * 11 + 1.2) * 0.012
  );
  return Math.max(0.86, w);
}

/**
 * 草地外缘的基准半径。
 * 下限是有约束的：十字环道石板带最远的那个角在 16.3 附近，
 * 草地半径最窄的朝向（20.6 × 0.86 ≈ 17.7）必须还包得住它，否则会露出土坎。
 */
const GRASS = 20.6;

/** 草地外缘半径 */
export function grassR(theta: number) {
  return GRASS * wobble(theta);
}

/**
 * 泥土层（草地与沙滩之间那圈棕色立壁）的外缘半径。
 * 宽度 0.20 ~ 0.88：有的朝向草几乎直接压到滩上，有的朝向留出一圈厚土坎。
 */
export function soilR(theta: number) {
  const w = 0.52 + Math.sin(theta * 3 + 2.8) * 0.26 + Math.sin(theta * 8 + 0.6) * 0.1;
  return grassR(theta) + Math.max(0.2, w);
}

/**
 * 沙滩外缘半径 —— 也就是岛在海面上的那条岸线。
 *
 * **这是"沙滩不真实"的处方**，两个要点：
 *   1. 宽度取 0.16 ~ 1.6，跨度十倍。绕着岛走一圈会依次经过：一小片亮沙滩
 *      → 草和土一直铺到水边（几乎没有滩）→ 又一个一米多宽的沙湾。等宽的沙环
 *      才是"给绿盘子描了一圈边"的元凶。
 *   2. 整体要**窄**。参考图里其实是看不到几米宽的沙滩的 —— 沙大部分没在水下，
 *      露在岸上的只是一条窄边，剩下的靠近岸那片发白的浅水去读。
 *      之前把滩做到两米多宽，岛看上去就像摆在盘子里。
 * 四个谐波（2/4/9/17）叠在一起，宽窄的变化不会读出周期感。
 */
export function sandR(theta: number) {
  const w = (
    0.62
    + Math.sin(theta * 2 + 5.4) * 0.22
    + Math.sin(theta * 4 + 1.1) * 0.42
    + Math.sin(theta * 9 + 2.2) * 0.24
    + Math.sin(theta * 17 + 0.9) * 0.12
  );
  return soilR(theta) + Math.max(0.16, w);
}

/** 沙滩外缘的最大值：远景布置（睡莲带、木桥、小岛）拿它当"别压到岛上"的下限 */
export const SAND_MAX = (() => {
  let m = 0;
  for (let i = 0; i < 720; i++) m = Math.max(m, sandR((i / 720) * Math.PI * 2));
  return m;
})();

/**
 * 用半径函数采样出一条闭合轮廓。
 * 注意 shape 空间是 u = 世界 x、v = −世界 z，所以用世界角推进时 v 要取负；
 * 这里直接在 shape 空间里等角采样，得到的是一条与它镜像等价的闭合曲线，
 * 对"长草地"这种用途没有差别，但要用 wedge 之类做定向拼合时得留神。
 */
export function coastShape(radius: (theta: number) => number, seg = 180): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const r = radius(a);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return new THREE.Shape().setFromPoints(pts);
}

/**
 * 圆心在世界坐标 (wx, wz)、半径带一点起伏的圆形路径。
 * 专门给挤出体挖洞用 —— ExtrudeGeometry 的洞必须和外形处在同一套 shape 坐标里，
 * 所以挖湖的洞不能像丘陵那样靠 Batch 的 pos 平移，得自己带上中心偏移。
 *
 * **坑**：extrudeFlat 会把 shape 的 +v 轴翻到世界 −z 上（u 才对应世界 x），
 * 所以这里必须取 v = −wz。忘了翻不会报错，只是把洞挖到镜像的那个象限去 ——
 * 表现是"湖不见了、草地上却多了一个坑"。
 */
export function wobblyHole(wx: number, wz: number, r: number, seg = 48): THREE.Path {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const rr = r * (1 + Math.sin(a * 4 + 1.1) * 0.09 + Math.sin(a * 7 + 3.3) * 0.045);
    pts.push(new THREE.Vector2(wx + Math.cos(a) * rr, -wz + Math.sin(a) * rr));
  }
  const p = new THREE.Path();
  p.setFromPoints(pts);
  p.closePath();
  return p;
}
