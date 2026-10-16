import * as THREE from "three";
import type { MaterialLibrary } from "../materials";
import type { TimeOfDay } from "../env";
import type { SceneDef } from "../../game/scenes/types";
import { Batch, box, toMesh } from "../batch";
import { sandR } from "../coast";
import { createSpark } from "../textures";
import { makeRandom, range } from "../rng";
import type { SurroundView } from "./types";

/**
 * 一条鱼的轨迹参数。
 * 位置由方位角决定（见 IslandSurround.fishAt）：a0/w 是绕岛的公转，
 * wa 是在方位角上叠的慢摆，base/amp/wr 是离岸距离的基准与快摆。
 * 几个频率互不相关，叠出来的路才不像在跑圈。
 */
interface Fish {
  a0: number;
  w: number;
  base: number;
  amp: number;
  wa: number;
  wr: number;
  pa: number;
  pr: number;
  bob: number;
  size: number;
}

/**
 * 鸟居小岛的位置（极坐标：方位角 + 离岛心距离）。
 *
 * 提到模块级是因为有四处要一起对齐：小岛本体与木桥（buildToriiIslet）、
 * 远处小岛的避让、睡莲的避让、岸边水草的避让。
 * 之前这四处各写了一遍 (24.8, −9.7)，改位置就得改四个地方，漏一个就穿模。
 *
 * 方位角取 −33°、距离 30：在轴测里 +x 朝右下、+z 朝左下，
 * 所以屏幕上的"往右"是"x 变大、z 变小"。−21.4°/−26.6 挪到 −33°/30 之后，
 * 小岛在屏幕上向右平移约 7 个单位（差不多岛宽的五分之一），木桥跟着一起走，
 * 桥因此从 4.7 拉长到 8.1 —— 从"小拱桥"变成"伸进潟湖的一段木栈桥"。
 */
const ISLET_A = (-33 * Math.PI) / 180;
const ISLET_L = 30;
const ISLET_X = Math.cos(ISLET_A) * ISLET_L; // 25.16
const ISLET_Z = Math.sin(ISLET_A) * ISLET_L; // −16.34

/**
 * 鸟居横梁的朝向（弧度，约 136.4°）。
 * 定这个数的目的是让横梁在轴测投影里读成"水平的一道门"——而水平与否只跟相机的方位有关，
 * 与小岛摆在哪里无关，所以它是常数。上一版按"顺着半径 + 偏 25°"算，
 * 小岛一挪门梁就跟着歪，这里改成不随位置变化的写法。
 */
const TORII_YAW = Math.PI / 2 + (21.4 * Math.PI) / 180 + (25 * Math.PI) / 180;

/**
 * 浮岛场景的「棋盘之外」：一整片碧海。
 *
 * 和城市那座会生长的都会不同，这里几乎不需要几何 —— 舞台全靠四件事撑起来：
 *   1. 一块极大的海面（1 个 draw call）。浅深不是靠另铺一层浅滩做到的
 *      （海面是不透明的，垫在下面根本看不见），而是把"离岸越远越深"直接烘进海面的顶点色，
 *      渐变沿着真实岸线走，所以浅滩是一圈有凹有凸的带子而不是同心圆；
 *   2. 一层点精灵当波光（参考图里水面那些闪点）；
 *   3. 三条贴着岛岸游弋的鱼 —— 水面是不透明平面，鱼沉下去的那半会被直接切掉，
 *      所以刻意让它们只露背脊、身侧再带一圈荡开的水纹，"在水里"这件事才读得出来；
 *   4. 岸线上一丛丛水草 + 远处的几座小岛 + 右侧一座鸟居小岛与木桥，
 *      把"海"的纵深拉出来，也把沙滩那条等宽的直边打断。
 *
 * 这些都不是棋盘的一部分（棋子不会踩上去），所以不进 BoardView，放这一层。
 */
export class IslandSurround implements SurroundView {
  group = new THREE.Group();

  private mats: MaterialLibrary;
  private sparkMat!: THREE.PointsMaterial;
  private sparkles!: THREE.Points;
  private lilyPad!: THREE.InstancedMesh;
  /** 波光基准亮度：白天/夜晚两档，update 里在它周围呼吸 */
  private sparkStrength = 0.55;

  /** 鱼：一个实例网格搞定，逐帧只改矩阵 */
  private fish!: THREE.InstancedMesh;
  private fishMat!: THREE.MeshStandardMaterial;
  /** 鱼身周围荡开的水纹环（每条鱼两圈，错开半个周期） */
  private ripples!: THREE.InstancedMesh;
  private rippleMat!: THREE.MeshBasicMaterial;
  private shoal: Fish[] = [];
  /** 逐帧采样轨迹切向用的两个点，复用不新建 */
  private fp0 = new THREE.Vector2();
  private fp1 = new THREE.Vector2();
  /** 逐帧摆鱼用的复用体，免得每帧 new 一个 Object3D */
  private fishDummy = new THREE.Object3D();
  /** 逐帧写水纹颜色用的复用色 */
  private rippleCol = new THREE.Color();

  private t = 0;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  constructor(mats: MaterialLibrary, _def: SceneDef) {
    this.mats = mats;
    this.group.name = "surround";

    // 海面的渐变直接读 ../coast 那份岸线，不需要再传一个"岛半径"进来
    this.buildOcean();
    this.buildFarIslets();
    this.buildToriiIslet();
    this.buildLilyPads();
    this.buildShoreReeds();
    this.buildSparkles();
    this.buildFish();

    this.setTime("day");
  }

  /* ---------------- 海面 ---------------- */

  /**
   * 海面：一整块带顶点色的平面，靠"离岸越远越深"的渐变做出环礁浅滩。
   *
   * 三档颜色：贴着沙滩的泻湖几乎能看见沙底（近白），中段是最鲜的那片青，
   * 再往外压成深海。海面是不透明的，这三档颜色就是全部 —— 之前这里垫过一层
   * 单独的浅滩环形体，结果整个被不透明的海面挡在水下，一点都看不见。
   *
   * **渐变必须跟着岸线走，不能按"到原点的距离"划圈**。按半径划圈的话浅滩是一圈
   * 正圆，而岛是有凹湾的 —— 湾里的水会莫名其妙地比湾口的尖角还深。
   * 所以这里逐个顶点取它所在方位的岸线半径 sandR(a)，用"离岸距离"当参数；
   * 再给这个距离乘一个随方位起伏的系数 shelf，于是有的朝向拖着几米宽的浅滩、
   * 有的朝向水深直接压到岸边 —— 参考图里那片水就是这样一块深一块浅的。
   */
  private buildOcean() {
    const SEG = 132;
    const geo = new THREE.PlaneGeometry(460, 460, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const lagoon = new THREE.Color("#ddfaf2");
    const shoal = new THREE.Color("#5fd6dc");
    const deep = new THREE.Color("#1d8cb2");
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      // 离岸距离：负数表示这个顶点其实在岛上（会被岛盖住，颜色无所谓）
      const d = Math.hypot(x, z) - sandR(a);
      // 浅滩带的宽窄随方位变化（0.4 ~ 1.6 倍），深浅交界就不会是一圈同心圆
      const shelf = 1 + Math.sin(a * 3 + 1.9) * 0.4 + Math.sin(a * 5 + 4.1) * 0.2;
      const k1 = THREE.MathUtils.smoothstep(d, -0.5, 4.2 * shelf);
      const k2 = THREE.MathUtils.smoothstep(d, 1.8 * shelf, 24 * shelf);
      tmp.copy(lagoon).lerp(shoal, k1);
      tmp.lerp(deep, k2);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, this.mats.ocean);
    mesh.name = "ocean";
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.position.y = 0.01;
    this.disposables.push(geo);
    this.group.add(mesh);
  }

  /* ---------------- 远处的岛 ---------------- */

  /**
   * 远处的小岛：压扁的球体。
   * 高度都是"顶面高度反推球心"算出来的 —— 直接给球心会得到一座把草地埋掉的沙丘
   * （球心太深时，草皮穹顶的顶面反而低于沙面）。远景不需要细节，
   * 所以三层球就够读出"岛"：水下暗影 → 沙滩 → 草坡。
   */
  private buildFarIslets() {
    const rand = makeRandom(6060);
    const b = new Batch();
    const dome = new THREE.SphereGeometry(1, 16, 10);
    this.disposables.push(dome);
    const BEACH_TOP = 0.38;
    const GRASS_TOP = 0.74;

    const spots: { x: number; z: number; r: number }[] = [];
    // 只留七座，而且推远到 36~88、放大到 2~6.5：参考图里远处其实是空海，
    // 撒一片大小差不多的近岛反而像水面上摆了一圈薄荷糖
    for (let i = 0; i < 26 && spots.length < 7; i++) {
      const a = range(rand, 0, Math.PI * 2);
      const r = range(rand, 36, 88);
      const size = range(rand, 2.0, 6.5);
      // 别压到主岛的沙滩上（主岛岸线是有起伏的，只能按角度逐个判）
      if (r - size < sandR(a) + 1.5) continue;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 70)) continue;
      if ((x - ISLET_X) ** 2 + (z - ISLET_Z) ** 2 < 150) continue; // 别跟右侧的鸟居小岛撞上
      spots.push({ x, z, r: size });
    }
    for (const s of spots) {
      const r = s.r;
      const shy = r * 0.4;
      const ghy = r * 0.45;
      b.add(dome, { pos: [s.x, -shy * 1.6, s.z], scale: [r * 1.25, shy, r * 1.25], color: "#2f8ea6" });
      b.add(dome, { pos: [s.x, BEACH_TOP - shy, s.z], scale: [r, shy, r], color: "#eadfbc" });
      b.add(dome, { pos: [s.x, GRASS_TOP - ghy, s.z], scale: [r * 0.9, ghy, r * 0.9], color: "#84c85c" });
      // 岛上的小树：比草坡矮得多才像树，不像又一座穹顶
      for (let k = 0; k < 5; k++) {
        const aa = rand() * 6.28;
        const rr = r * range(rand, 0.1, 0.55);
        const ts = r * range(rand, 0.07, 0.12);
        b.add(dome, {
          pos: [s.x + Math.cos(aa) * rr, GRASS_TOP + ts * 1.5, s.z + Math.sin(aa) * rr],
          scale: [ts, ts * 1.6, ts],
          color: k % 3 === 0 ? "#3f7f3c" : "#56973f",
        });
      }
    }
    const mesh = toMesh(b.build(), this.mats.rock, "far-islets", true, true);
    if (mesh) this.group.add(mesh);
  }

  /**
   * 右侧的鸟居小岛与木桥 —— 参考图里最有辨识度的一笔。
   *
   * 位置由模块顶上的 ISLET_A / ISLET_L 决定（改位置只改那两个数，
   * 桥、睡莲、水草、远处小岛的避让都会跟着走）。
   *
   * 岛形是平顶浅滩（圆台沙滩 + 压扁的草丘），它的可站人半径是 1.26R，
   * 所以只要让"小岛沙滩的内缘"落在主岛岸线之外，中间就会留出一条能划船的窄水道。
   * 球顶岛做不到这一点 —— 球顶的岸线一路往下收，
   * 桥面无论定在哪个高度都只能在中段接住它，末端必然悬在水面上。
   */
  private buildToriiIslet() {
    const cx = ISLET_X;
    const cz = ISLET_Z;
    const R = 3.1; // 沙滩平顶半径
    const BEACH_TOP = 0.3;
    const GRASS_TOP = 0.5;

    const b = new Batch();
    // 共用的圆台（下宽 1.26 倍）与球，前者做滩肩、后者做草丘
    const cone = new THREE.CylinderGeometry(1, 1.26, 1, 30);
    cone.translate(0, 0.5, 0); // 底面落到 y=0，方便直接按高度缩放
    const disc = new THREE.CylinderGeometry(1, 1, 1, 20);
    disc.translate(0, 0.5, 0);
    const dome = new THREE.SphereGeometry(1, 20, 12);
    this.disposables.push(cone, disc, dome);

    // 水下裙边：海面已是不透明的平面，这圈只为防止从低角度看出岛是浮着的
    b.add(disc, { pos: [cx, -0.55, cz], scale: [R * 1.3, 0.55, R * 1.3], color: "#2f8ea6" });
    b.add(cone, { pos: [cx, 0, cz], scale: [R, BEACH_TOP, R], color: "#eadfbc" });
    // 草丘：垂直半径 0.4 的扁球，顶面 0.50，在滩面高度处已经铺到 0.95R ——
    // 露在外面的浅色滩肩只剩窄窄一圈，跟参考图一致（太宽会变成一张白盘子）
    b.add(dome, { pos: [cx, GRASS_TOP - 0.4, cz], scale: [R * 1.1, 0.4, R * 1.1], color: "#84c85c" });
    const mesh = toMesh(b.build(), this.mats.rock, "torii-islet", true, true);
    if (mesh) this.group.add(mesh);

    // 岛上的草木：绕成一圈，把中间让给鸟居，别让灌木把门柱埋了
    const green = new Batch();
    const rand = makeRandom(9091);
    for (let i = 0; i < 7; i++) {
      const a = rand() * 6.28;
      const r = R * range(rand, 0.5, 0.86);
      const s = range(rand, 0.34, 0.68);
      green.add(dome, {
        pos: [cx + Math.cos(a) * r, GRASS_TOP + s * 0.34, cz + Math.sin(a) * r],
        scale: [s * 0.82, s, s * 0.82],
        color: i % 3 === 0 ? "#4f9147" : "#6fbe4e",
      });
    }
    const gm = toMesh(green.build(), this.mats.lawn, "torii-plants", true, true);
    if (gm) this.group.add(gm);

    /* 鸟居：两根立柱 + 两道横梁，朱漆红 */
    const red = new THREE.MeshStandardMaterial({ color: 0xc0503a, roughness: 0.66, metalness: 0.04 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x6b3a2c, roughness: 0.6, metalness: 0.1 });
    this.disposables.push(red, dark);
    const torii = new THREE.Group();
    torii.position.set(cx, GRASS_TOP - 0.05, cz);
    const postGeo = new THREE.CylinderGeometry(0.1, 0.14, 2.5, 10);
    postGeo.translate(0, 1.25, 0);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(postGeo, red);
      m.position.set(0, 0, s * 1.15);
      m.castShadow = true;
      torii.add(m);
    }
    // 横梁出挑只留 13%：出挑太多就不是鸟居、成了门框上的挑檐
    const topGeo = new THREE.BoxGeometry(0.3, 0.24, 2.9);
    const top = new THREE.Mesh(topGeo, red);
    top.position.y = 2.42;
    top.castShadow = true;
    torii.add(top);
    const beamGeo = new THREE.BoxGeometry(0.2, 0.16, 2.6);
    const beam = new THREE.Mesh(beamGeo, red);
    beam.position.y = 2.05;
    torii.add(beam);
    const capGeo = new THREE.BoxGeometry(0.46, 0.16, 3.14);
    const cap = new THREE.Mesh(capGeo, dark);
    cap.position.y = 2.62;
    torii.add(cap);
    /*
     * 横梁（局部 +Z）的朝向。
     *
     * 一条横梁在屏幕上是不是水平的，只取决于相机的方位 —— 和鸟居站在哪儿没关系。
     * 所以这里必须是**常数**，不能写成"顺着半径方向 + 补偿角"：那个写法里
     * −atan2(cz, cx) 会让横梁跟着小岛的位置转，小岛往右挪 11.6°，门梁在屏幕上就斜 11.6°。
     * 这个数是上一版在方位角 −21.4° 时调好的（当时 π/2 + 21.4° + 25°），保留下来即可。
     */
    torii.rotation.y = TORII_YAW;
    this.group.add(torii);
    this.disposables.push(postGeo, topGeo, beamGeo, capGeo);

    /* 木桥：从主岛岸边接到小岛 */
    const bx = new Batch();
    const dirX = Math.cos(ISLET_A);
    const dirZ = Math.sin(ISLET_A);
    const from = 18.6; // 起点落进主岛草地内缘，桥头才不是悬在土坡上
    const to = ISLET_L - R * 1.05; // 末端正好压在草丘外面那一圈浅色滩肩上
    const len = to - from;
    const mid = (from + to) / 2;
    const yaw = Math.atan2(dirX, dirZ);
    const deckTop = 0.28; // 比小岛滩面(0.30)略低、比主岛草地(0.20)略高 —— 两头都踩得住
    box(bx, [1.25, 0.12, len], [dirX * mid, deckTop - 0.06, dirZ * mid], "#c79a62", { rotY: yaw });
    // 桥面铺板：密排，缝只有几厘米 —— 稀排会变成一架梯子
    const planks = Math.max(10, Math.round(len / 0.28));
    for (let i = 0; i < planks; i++) {
      const t = from + ((i + 0.5) / planks) * len;
      box(bx, [1.3, 0.09, 0.24], [dirX * t, deckTop - 0.005, dirZ * t], "#a87a48", { rotY: yaw });
    }
    for (const s of [-1, 1]) {
      const ox = -dirZ * s * 0.58;
      const oz = dirX * s * 0.58;
      box(bx, [0.08, 0.4, len], [dirX * mid + ox, deckTop + 0.2, dirZ * mid + oz], "#a87a48", { rotY: yaw });
      for (const t of [from + 0.35, mid, to - 0.35]) {
        box(bx, [0.07, 0.44, 0.07], [dirX * t + ox, deckTop + 0.22, dirZ * t + oz], "#8b6238", { rotY: yaw });
      }
      for (const e of [from + 0.2, mid, to - 0.2]) {
        // 桥墩：一头扎进水里，桥才不是浮着的。桥拉长到 8 米之后中间必须补一根，
        // 否则 7.7 米的净跨只剩两头支撑，看着就是一根悬空的木条
        box(bx, [0.16, 1.3, 0.16], [dirX * e + ox, deckTop - 0.68, dirZ * e + oz], "#8b6238");
      }
    }
    const bmesh = toMesh(bx.build(), this.mats.wood, "torii-bridge", true, true);
    if (bmesh) this.group.add(bmesh);
  }

  /* ---------------- 睡莲 / 波光 ---------------- */

  /** 睡莲：沿着真实岸线往外漂一圈，于是它离滩肩的距离处处一致 */
  private buildLilyPads() {
    const padGeo = new THREE.CircleGeometry(0.42, 12);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 });
    this.disposables.push(padGeo, padMat);
    const rand = makeRandom(3131);
    const N = 22;
    this.lilyPad = new THREE.InstancedMesh(padGeo, padMat, N);
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    const islet = new THREE.Vector2(ISLET_X, ISLET_Z);
    for (let i = 0; i < N; i++) {
      const a = rand() * Math.PI * 2;
      const r = sandR(a) + range(rand, 0.7, 4.6);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // 别把水草漂到鸟居小岛的旱地上
      if (new THREE.Vector2(x, z).distanceTo(islet) < 5.6) continue;
      d.position.set(x, 0.015, z);
      d.rotation.set(0, rand() * 6.28, 0);
      d.scale.setScalar(range(rand, 0.45, 0.95));
      d.updateMatrix();
      this.lilyPad.setMatrixAt(i, d.matrix);
      c.setHSL(0.29, 0.46, 0.34 + rand() * 0.16);
      this.lilyPad.setColorAt(i, c);
    }
    this.lilyPad.instanceMatrix.needsUpdate = true;
    if (this.lilyPad.instanceColor) this.lilyPad.instanceColor.needsUpdate = true;
    this.group.add(this.lilyPad);
  }

  /** 波光：参考图里水面上那些一亮一亮的白点。近岸密、远处疏 */
  private buildSparkles() {
    const rand = makeRandom(1717);
    const M = 340;
    const pos = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      const a = rand() * Math.PI * 2;
      // 六成贴着岛岸撒，四成铺到远海 —— 全按面积均匀撒的话近岸会太空
      const r = rand() < 0.6
        ? sandR(a) + range(rand, 1.5, 14)
        : range(rand, 34, 200);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = range(rand, 0.02, 0.12);
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sparkTex = createSpark();
    this.sparkMat = new THREE.PointsMaterial({
      color: 0xffffff, map: sparkTex, size: 1.5, sizeAttenuation: true,
      transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.sparkles = new THREE.Points(sgeo, this.sparkMat);
    this.sparkles.frustumCulled = false;
    this.disposables.push(sgeo, sparkTex, this.sparkMat);
    this.group.add(this.sparkles);
  }

  /* ---------------- 岸边的水草 ---------------- */

  /**
   * 沿着岸线撒一圈水草（参考图里滩涂上那一丛丛细草）。
   *
   * 它有两个作用：一是"沙滩太均匀"的解药 —— 等宽的沙环只要被一丛丛草打断，
   * 立刻就不再像描边；二是给水陆交界一条过渡带，不然沙滩到水面是一条刀切的直线。
   * 草根埋在水面以下、草尖露出水面，一簇三根错开角度，才不会读成一排牙签。
   */
  private buildShoreReeds() {
    // 一簇 = 五根短草，朝四周散开；整簇做成一份几何，再拿 InstancedMesh 复制。
    // 单根细高的话远看就是水面上插了一排针，簇要矮、要散、要有两三根倒伏的。
    const blade = new THREE.CylinderGeometry(0.026, 0.05, 0.62, 4);
    blade.translate(0, 0.31, 0);
    const tuft = new Batch();
    const tilts: [number, number][] = [[0, 0.04], [1.3, 0.3], [2.6, 0.22], [4.1, 0.5], [5.3, 0.42]];
    for (const [yaw, tilt] of tilts) {
      tuft.add(blade, {
        pos: [Math.cos(yaw) * 0.05, 0, Math.sin(yaw) * 0.05],
        rotY: yaw, rotZ: tilt,
        color: tilt > 0.35 ? "#c6d477" : tilt > 0.15 ? "#a8c463" : "#8fbb52",
      });
    }
    const geo = tuft.build()!;
    this.disposables.push(blade, geo);

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
    this.disposables.push(mat);

    const rand = makeRandom(9911);
    const N = 190;
    /** 鸟居木桥要横穿岸线，那一段不许长草，不然草会从桥面里穿出来 */
    const spots: { x: number; z: number; s: number; rot: number }[] = [];
    for (let i = 0; i < N * 4 && spots.length < N; i++) {
      const a = rand() * Math.PI * 2;
      // 密度按方位起伏：留出几段光滩 —— 沿着岸均匀铺满一圈，看着就像给岛镶了条绿边
      if (rand() > 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(a * 5 + 1.2))) continue;
      // 大部分长在沙滩上的干地一侧，少量直接泡在水里 —— 水陆交界才不是一条直线
      const r = sandR(a) + range(rand, -1.3, 0.7);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      let da = Math.abs(a - ISLET_A);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.16 && r < 33) continue;
      if ((x - ISLET_X) ** 2 + (z - ISLET_Z) ** 2 < 25) continue; // 别长到鸟居小岛上
      if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 0.9)) continue;
      spots.push({ x, z, s: range(rand, 0.6, 1.35), rot: rand() * 6.28 });
    }

    const reeds = new THREE.InstancedMesh(geo, mat, spots.length);
    // 投影开着：水草没有影子就会像贴在水面上的贴纸，一圈投影才把它们钉回地面
    reeds.castShadow = true;
    reeds.receiveShadow = false;
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    spots.forEach((s, i) => {
      d.position.set(s.x, -0.1, s.z);
      d.rotation.set(0, s.rot, 0);
      d.scale.set(s.s, s.s * range(rand, 0.85, 1.3), s.s);
      d.updateMatrix();
      reeds.setMatrixAt(i, d.matrix);
      c.setHSL(0.21 + rand() * 0.06, 0.4 + rand() * 0.16, 0.3 + rand() * 0.16);
      reeds.setColorAt(i, c);
    });
    reeds.instanceMatrix.needsUpdate = true;
    if (reeds.instanceColor) reeds.instanceColor.needsUpdate = true;
    this.group.add(reeds);
  }

  /* ---------------- 鱼 ---------------- */

  /**
   * 海里的鱼：只有三条，各自贴着岛岸游。
   *
   * **形状**上踩过一次坑：身子原本就是"一个球压扁"，而球两头都是圆的 ——
   * 从上看下去就是一个橄榄球，不管怎么调长宽都显胖。现在拆成
   *   前段椭球（头）+ 后段圆锥（收成尾柄）+ 后掠的三角尾鳍 + 背鳍 + 一对胸鳍，
   * 长宽比 4:1、而且尾端是收尖的，剪影才是一条鱼。
   *
   * **"在水里"**是特意做的。俯视的时候，鱼沉到水面以下的那一半被不透明海面切掉，
   * 从上方根本看不出区别 —— 所以光靠"沉下去"没用，得给两个水面线索：
   *   1. 只露出背脊 —— 基准高度压到 −0.08×size，六成身子在水面以下；
   *   2. 身侧一圈圈荡开的水纹环，跟着鱼走、由亮到暗循环。
   * 水纹是"这里有一层水面"最直接的证据，比影子管用得多。
   *
   * 轨迹以离岸距离为参数：每个时刻取自己的方位角，查这个方位上的岸线半径 sandR(a)，
   * 再加一段忽远忽近的偏移 —— 鱼永远贴着岛的外围转，不会游到取景框外面去。
   */
  private buildFish() {
    const N = 3;
    const rand = makeRandom(4757);

    /* --- 几何：细长纺锤 --- */
    const head = new THREE.SphereGeometry(0.5, 14, 10);
    const taper = new THREE.ConeGeometry(0.5, 1.0, 10);
    taper.rotateX(-Math.PI / 2); // 尖端朝 −Z（尾）
    const tail = new THREE.ConeGeometry(0.34, 0.5, 3);
    tail.rotateX(Math.PI / 2); // 扇面朝后，尖端插进尾柄
    const dorsal = new THREE.ConeGeometry(0.22, 0.42, 3);
    const pect = new THREE.ConeGeometry(0.16, 0.3, 3);
    const b = new Batch();
    b.add(head, { pos: [0, 0, 0.1], scale: [0.44, 0.62, 1.1], color: "#ffffff" });
    b.add(taper, { pos: [0, 0, -0.55], scale: [0.44, 0.62, 1.1], color: "#ffffff" });
    b.add(tail, { pos: [0, 0, -1.15], scale: [0.2, 1.15, 1], color: "#ffffff" });
    b.add(dorsal, { pos: [0, 0.3, -0.22], scale: [0.1, 1, 1.3], color: "#ffffff" });
    for (const s of [-1, 1]) {
      b.add(pect, { pos: [0.18 * s, -0.04, 0.12], rotZ: -1.75 * s, scale: [0.6, 1, 0.7], color: "#ffffff" });
    }
    const geo = b.build()!;
    this.disposables.push(head, taper, tail, dorsal, pect, geo);

    this.fishMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.62, metalness: 0.02,
      emissive: new THREE.Color("#ffd9a0"), emissiveIntensity: 0,
    });
    this.disposables.push(this.fishMat);
    this.fish = new THREE.InstancedMesh(geo, this.fishMat, N);
    this.fish.castShadow = false;
    this.fish.receiveShadow = false;
    this.fish.frustumCulled = false;
    this.group.add(this.fish);

    /* --- 水纹环：一圈细环贴着水面，加色混合，靠 instanceColor 做由亮到暗 --- */
    const ringGeo = new THREE.RingGeometry(0.82, 0.87, 30);
    ringGeo.rotateX(-Math.PI / 2);
    this.rippleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    });
    this.disposables.push(ringGeo, this.rippleMat);
    this.ripples = new THREE.InstancedMesh(ringGeo, this.rippleMat, N * 2);
    this.ripples.frustumCulled = false;
    this.ripples.renderOrder = 2;
    this.group.add(this.ripples);

    const palette = ["#ff8f4a", "#5c9ee0", "#ffc85c"];
    /** 鱼的配色往水色里拉一点：隔着水看过去饱和度会掉，纯色贴在水面上就像贴纸 */
    const wet = new THREE.Color("#7fd8dc");
    const colr = new THREE.Color();
    for (let i = 0; i < N; i++) {
      this.shoal.push({
        a0: (i / N) * Math.PI * 2 + rand() * 0.5,
        // 三条鱼角速度各不同，游一会儿自然就散开了
        w: (rand() < 0.5 ? -1 : 1) * range(rand, 0.04, 0.075),
        base: range(rand, 2.0, 4.4), // 离岸基准距离
        amp: range(rand, 0.6, 1.4), // 忽远忽近的幅度
        wa: range(rand, 0.1, 0.24), // 方位角上的慢摆
        wr: range(rand, 0.18, 0.4), // 径向的快摆
        pa: rand() * 6.28,
        pr: rand() * 6.28,
        bob: rand() * 6.28,
        size: range(rand, 0.85, 1.2),
      });
      colr.set(palette[i % palette.length]).lerp(wet, 0.22);
      this.fish.setColorAt(i, colr);
      for (let j = 0; j < 2; j++) this.ripples.setColorAt(i * 2 + j, colr.set("#000000"));
    }
    if (this.fish.instanceColor) this.fish.instanceColor.needsUpdate = true;
    if (this.ripples.instanceColor) this.ripples.instanceColor.needsUpdate = true;
  }

  /**
   * 一条鱼在 t 时刻的位置。
   * 参数化成"方位角 → 岸线半径 + 偏移"，所以它必然贴着岛游。
   * out 是 Vector2，x/y 分别对应世界 x/z。
   */
  private fishAt(f: Fish, tt: number, out: THREE.Vector2) {
    const a = f.a0 + tt * f.w + Math.sin(tt * f.wa + f.pa) * 0.45;
    const r = sandR(a) + f.base + Math.sin(tt * f.wr + f.pr) * f.amp;
    out.set(Math.cos(a) * r, Math.sin(a) * r);
  }

  /* ---------------- 时辰 / 帧循环 ---------------- */

  setTime(time: TimeOfDay) {
    // 白天的波光很亮，夜里只留一点点星火般的反光
    this.sparkStrength = time === "night" ? 0.2 : 0.55;
    // 夜里给鱼一点自发光：深海一片漆黑，不这么做就完全看不见它们
    if (this.fishMat) this.fishMat.emissiveIntensity = time === "night" ? 0.5 : 0;
    // 水纹是加色的，夜里不压一压就会变成一圈圈发光环
    if (this.rippleMat) this.rippleMat.opacity = time === "night" ? 0.45 : 1;
  }

  update(dt: number) {
    this.t += dt;
    // 海面波纹缓慢平移：这是"水在动"的最便宜做法（只改贴图 offset，不重建几何）
    const bump = this.mats.ocean.bumpMap;
    if (bump) {
      bump.offset.x = (bump.offset.x + dt * 0.004) % 1;
      bump.offset.y = (bump.offset.y + dt * 0.0021) % 1;
    }
    // 波光整体呼吸：不逐点算，整片一起明暗，够用且几乎免费
    this.sparkMat.opacity = this.sparkStrength * (0.8 + Math.sin(this.t * 1.3) * 0.2);
    this.sparkles.position.y = Math.sin(this.t * 0.4) * 0.03;
    // 睡莲随水微微起伏
    this.lilyPad.position.y = Math.sin(this.t * 0.9) * 0.012;

    /* 鱼群：沿着岛岸游，位置由方位角决定 */
    const dummy = this.fishDummy;
    for (let i = 0; i < this.shoal.length; i++) {
      const f = this.shoal[i];
      this.fishAt(f, this.t, this.fp0);
      // 往前采一个点，两点连线就是航向 —— 比手推导数短、也不会在换向时翻车
      this.fishAt(f, this.t + 0.08, this.fp1);
      const dx = this.fp1.x - this.fp0.x;
      const dz = this.fp1.y - this.fp0.y;
      const yaw = Math.atan2(dx, dz) + Math.sin(this.t * 7 + f.pa) * 0.16;
      // 只露背脊：中心压到水面以下几厘米，大半身子被不透明海面切掉
      dummy.position.set(
        this.fp0.x,
        0.01 - 0.062 * f.size + Math.sin(this.t * 1.4 + f.bob) * 0.012,
        this.fp0.y,
      );
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(f.size);
      dummy.updateMatrix();
      this.fish.setMatrixAt(i, dummy.matrix);

      // 水纹：拖在鱼身后荡开。若把环套在鱼身正中，几圈同心圆读出来就是一个靶子；
      // 挪到后方、并且让两圈前后错开，才像鱼游过去留下的一串尾迹。
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      for (let j = 0; j < 2; j++) {
        const ph = (this.t * 0.42 + j * 0.5 + f.bob) % 1;
        const back = f.size * (0.9 + j * 1.4);
        dummy.position.set(this.fp0.x - ux * back, 0.014, this.fp0.y - uz * back);
        // 顺着航向摆正，再横向拉长成椭圆 —— 正圆读起来像印章，横着荡开的椭圆才像尾迹
        dummy.rotation.set(0, yaw, 0);
        const s = f.size * (0.5 + ph * 0.85);
        dummy.scale.set(s * 1.4, 1, s * 0.85);
        dummy.updateMatrix();
        this.ripples.setMatrixAt(i * 2 + j, dummy.matrix);
        // 加色混合下"黑"就是不画，于是不用逐实例透明也能淡入淡出。
        // 颜色压得很浅：水纹是"这里有一层水面"的提示，不是主角，
        // 亮一点就变成一圈发光的圈，比鱼本身还抢眼。
        const a = 0.11 * Math.sin(Math.PI * ph);
        this.rippleCol.setRGB(a * 0.88, a * 0.98, a);
        this.ripples.setColorAt(i * 2 + j, this.rippleCol);
      }
    }
    this.fish.instanceMatrix.needsUpdate = true;
    this.ripples.instanceMatrix.needsUpdate = true;
    if (this.ripples.instanceColor) this.ripples.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
