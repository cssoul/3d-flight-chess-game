import * as THREE from "three";
import { MaterialLibrary } from "./materials";
import { createSurround, type SurroundView } from "./surrounds";
import { createBoard, slotOffset, type BoardView } from "./boards";
import { Dice, Piece } from "./pieces";
import { Animator, Particles, ShockPool, easeInOutQuad, easeOutCubic, tween } from "./fx";
import { createSky, TIME_PRESETS, type TimeOfDay, type TimePreset } from "./env";
import { SCALE } from "../game/theme";
import { getScene } from "../game/scenes";
import type { SceneDef } from "../game/scenes/types";
import type { TileResolution } from "../game/types";
import { sfx } from "../game/sfx";

export type MoveStyle = "hop" | "boost" | "dash" | "retreat";

export interface SceneStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
}

/**
 * 相机里与棋盘无关的那部分。
 * 视高（frustum）不在这里 —— 它必须跟着棋盘走，见 SceneDef.view。
 */
const CAM = {
  distance: 240,
  defaultAzimuth: 45,
  // 仰角从 38 降到 35：地面在屏幕上的纵向拉伸系数是 sin(仰角)，
  // 仰角越小、近端的地块越往画面里收，地标楼才不会被下边缘切掉只露个顶。
  defaultElevation: 35,
};

interface PieceActor {
  piece: Piece;
  pos: number;
  hopping: boolean;
  finished: boolean;
}

/**
 * 场景总控：渲染器 / 轴测相机 / 灯光 / 棋盘外的世界 / 棋盘 / 棋子 / 骰子 / 特效。
 * 所有表演都是 `await` 得住的异步方法，导演层按回合顺序调用即可。
 *
 * 「场景」在这层是可替换的，而且是**两件事一起换**：
 *   - SceneDef + BoardView —— 规则与棋盘长什么样；
 *   - SurroundView       —— 棋盘之外那一圈世界（城市天际线 / 一整片碧海）。
 * 棋子、骰子、相机、灯光都不重建。
 */
export class SceneManager {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  anim = new Animator();
  particles = new Particles();
  shocks = new ShockPool(12);
  mats: MaterialLibrary;
  /** 棋盘之外那一层：城市是微缩都会，浮岛是碧海 */
  surround: SurroundView;
  board: BoardView;
  dice: Dice;
  pieces: PieceActor[] = [];

  /** 当前棋盘的场景定义 */
  def: SceneDef;
  /** 每个座位的起点环道索引 */
  private seats: number[] = [0];

  private container: HTMLElement;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private target = new THREE.Vector3(0, 0.9, 0);
  private focus = new THREE.Vector3(0, 0.9, 0);
  private azimuth = CAM.defaultAzimuth;
  private elevation = CAM.defaultElevation;
  private baseFrustum: number;
  private minFrustum: number;
  private zoom = 1;
  private zoomTarget = 1;
  private clockStart = 0;
  private lastFrame = 0;
  private raf = 0;
  private time = 0;
  private frameTimes: number[] = [];
  private adaptTimer = 0;
  private pixelRatio: number;
  private maxPixelRatio: number;
  private preset: TimePreset;
  private time_: TimeOfDay = "day";
  private envRT: THREE.WebGLRenderTarget | null = null;
  private skyTex: THREE.Texture | null = null;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private disposed = false;
  private activeIndex = 0;
  private playerColors: string[] = [];
  private fps = 60;
  /** 自动环绕（展陈用） */
  autoRotate = false;
  stats: SceneStats = { fps: 60, drawCalls: 0, triangles: 0, pixelRatio: 1 };

  constructor(container: HTMLElement, time: TimeOfDay = "day") {
    this.container = container;
    this.time_ = time;
    this.preset = TIME_PRESETS[time];
    // 棋盘定义要在相机之前拿到：正交视高完全由它决定，换了棋盘就得重算取景。
    this.def = getScene();
    this.baseFrustum = this.def.view.baseFrustum;
    this.minFrustum = this.def.view.minFrustum;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = this.preset.toneMapping;
    this.renderer.toneMappingExposure = this.preset.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 阴影只烘一次：场景是静态的，动态物体（棋子/车/骰子）走假阴影
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    const f = Math.max(this.minFrustum, this.baseFrustum / aspect);
    this.camera = new THREE.OrthographicCamera(
      (-f * aspect) / 2, (f * aspect) / 2, f / 2, -f / 2, 1, 900,
    );

    // ---- 灯光 ----
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    this.key = new THREE.DirectionalLight(0xffffff, 2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -62; sc.right = 62; sc.top = 62; sc.bottom = -62; sc.near = 1; sc.far = 320;
    this.key.shadow.bias = -0.0007;
    this.key.shadow.normalBias = 0.07;
    this.fill = new THREE.DirectionalLight(0xffffff, 0.5);
    this.rim = new THREE.DirectionalLight(0xffffff, 0.6);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(this.hemi, this.key, this.fill, this.rim, this.ambient, this.key.target);

    this.scene.add(this.particles.points, this.shocks.group);

    this.mats = new MaterialLibrary(this.renderer);
    this.surround = createSurround(this.def, this.mats);
    this.board = createBoard(this.def, this.mats);
    this.seats = this.def.starts(1);
    // 骰子悬停在棋盘正上方：城市场景的底座顶面约 4.15，抬到 6.9 才有明确的分层，
    // 否则落定时骰子和雕塑的环会糊在一起。浮岛的石台 + 风向鸟高约 2.9，同一高度同样清空。
    this.dice = new Dice(6.9);
    this.scene.add(this.surround.group, this.board.group, this.dice.root);

    this.applyTime(time);
    this.updateCamera();
    this.resize();

    window.addEventListener("resize", this.onResize);
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });

    this.clockStart = performance.now();
    this.lastFrame = this.clockStart;
    this.loop();
  }

  /* ---------------- 时辰 ---------------- */
  applyTime(time: TimeOfDay) {
    this.time_ = time;
    const p = TIME_PRESETS[time];
    this.preset = p;
    const { environment, sky } = createSky(this.renderer, time);
    const oldRT = this.envRT;
    const oldTex = this.skyTex;
    this.envRT = environment;
    this.skyTex = sky;
    this.scene.environment = environment.texture;
    this.scene.background = sky;
    this.scene.environmentIntensity = p.environmentIntensity;
    if (oldRT) oldRT.dispose();
    if (oldTex) oldTex.dispose();

    this.renderer.toneMapping = p.toneMapping;
    this.renderer.toneMappingExposure = p.exposure;
    this.hemi.color.set(p.hemi.sky);
    this.hemi.groundColor.set(p.hemi.ground);
    this.hemi.intensity = p.hemi.intensity;
    this.key.color.set(p.key.color);
    this.key.intensity = p.key.intensity;
    this.key.position.set(...p.key.pos);
    this.key.target.position.set(0, 0, 0);
    this.fill.color.set(p.fill.color);
    this.fill.intensity = p.fill.intensity;
    this.fill.position.set(...p.fill.pos);
    this.rim.color.set(p.rim.color);
    this.rim.intensity = p.rim.intensity;
    this.rim.position.set(...p.rim.pos);
    this.ambient.color.set(p.ambient.color);
    this.ambient.intensity = p.ambient.intensity;
    this.mats.apply(p);
    this.surround.setTime(time);
    this.board.setTime(time);
    this.renderer.shadowMap.needsUpdate = true;
  }

  get timeOfDay() {
    return this.time_;
  }

  /* ---------------- 换棋盘 ---------------- */

  /**
   * 切到另一个场景：棋盘视图与「棋盘之外那一层」一起换，取景与座位起点同步更新。
   * 棋子 / 骰子 / 灯光全部保留，手里已有的棋子会按新棋盘的坐标重新落位。
   */
  applyScene(def: SceneDef) {
    if (def === this.def) return;

    const oldBoard = this.board;
    this.scene.remove(oldBoard.group);
    oldBoard.dispose();
    const oldSurround = this.surround;
    this.scene.remove(oldSurround.group);
    oldSurround.dispose();

    this.def = def;
    this.baseFrustum = def.view.baseFrustum;
    this.minFrustum = def.view.minFrustum;
    this.board = createBoard(def, this.mats);
    this.surround = createSurround(def, this.mats);
    this.scene.add(this.board.group);
    this.scene.add(this.surround.group);
    this.board.setTime(this.time_);
    this.surround.setTime(this.time_);

    this.seats = def.starts(Math.max(1, this.pieces.length));
    this.board.setSeatColors(this.playerColors);
    this.pieces.forEach((p, i) => {
      void this.teleport(i, p.pos);
    });
    this.showHighlight(this.seats[this.activeIndex] ?? 0, this.pieces[this.activeIndex]?.pos ?? null);

    this.resize();
    this.renderer.shadowMap.needsUpdate = true;
  }

  get sceneId() {
    return this.def.id;
  }

  /* ---------------- 玩家棋子 ---------------- */
  setPlayers(players: { color: string; deep: string }[]) {
    this.pieces.forEach((p) => {
      this.scene.remove(p.piece.root);
      p.piece.dispose();
    });
    this.playerColors = players.map((p) => p.color);
    this.seats = this.def.starts(Math.max(1, players.length));
    // 座位 → 起点是场景说了算的（四方起点场景里每人站一条臂），棋盘视图照着涂色
    this.board.setSeatColors(this.playerColors);
    this.pieces = players.map((pl) => {
      const piece = new Piece({ color: pl.color, deep: pl.deep });
      this.scene.add(piece.root);
      return { piece, pos: 0, hopping: false, finished: false };
    });
    this.reflowInstant();
  }

  /** 棋子按「同一格」分组：同格的要错开摆放，否则四个小人会叠成一个 */
  private groupByCell() {
    const groups = new Map<string, { start: number; pos: number; ids: number[] }>();
    this.pieces.forEach((p, i) => {
      const start = this.seats[i] ?? 0;
      const key = this.def.cellKey(start, p.pos);
      const g = groups.get(key);
      if (g) g.ids.push(i);
      else groups.set(key, { start, pos: p.pos, ids: [i] });
    });
    return groups;
  }

  private worldFor(start: number, pos: number, slot: number, total: number) {
    const t = this.def.node(start, pos);
    const off = slotOffset(slot, total, t);
    return { x: t.x + off.x, z: t.z + off.z, tile: t };
  }

  private reflowInstant() {
    for (const [, g] of this.groupByCell()) {
      g.ids.forEach((id, slot) => {
        const w = this.worldFor(g.start, g.pos, slot, g.ids.length);
        this.pieces[id].piece.setPosition(w.x, SCALE.tileTop, w.z);
      });
    }
  }

  private reflow(dt: number) {
    for (const [, g] of this.groupByCell()) {
      g.ids.forEach((id, slot) => {
        const a = this.pieces[id];
        if (a.hopping) return;
        const w = this.worldFor(g.start, g.pos, slot, g.ids.length);
        const k = Math.min(1, dt * 8);
        const r = a.piece.root.position;
        const nx = r.x + (w.x - r.x) * k;
        const nz = r.z + (w.z - r.z) * k;
        a.piece.setPosition(nx, SCALE.tileTop, nz);
      });
    }
  }

  setActivePlayer(index: number) {
    this.activeIndex = index;
  }

  showHighlight(start: number, pos: number | null) {
    this.board.focusAt(start, pos);
    const c = this.playerColors[this.activeIndex];
    if (c) this.board.setHighlightColor(c);
  }

  setShield(index: number, on: boolean) {
    this.pieces[index]?.piece.setShield(on);
  }

  setFrozen(index: number, on: boolean) {
    this.pieces[index]?.piece.setFrozen(on);
  }

  setFinished(index: number, on: boolean) {
    if (this.pieces[index]) this.pieces[index].finished = on;
  }

  /* ---------------- 移动 ---------------- */
  private hopTo(index: number, pos: number, style: MoveStyle): Promise<void> {
    const a = this.pieces[index];
    const start = this.seats[index] ?? 0;
    a.hopping = true;
    const from = a.piece.root.position.clone();
    const t = this.def.node(start, pos);
    const to = { x: t.x, z: t.z };
    const fast = style === "boost" || style === "dash";
    const dur = fast ? 0.15 : style === "retreat" ? 0.28 : 0.24;
    const height = fast ? 1.25 : 0.95;
    a.pos = pos;

    const col = fast ? (this.def.kind(start, pos) === "portal" ? "#6F7BF0" : "#86D48A") : "#ffffff";
    return this.anim
      .wait(
        tween(
          dur,
          (k, raw) => {
            const x = from.x + (to.x - from.x) * k;
            const z = from.z + (to.z - from.z) * k;
            const lift = Math.sin(raw * Math.PI) * height;
            a.piece.setPosition(x, SCALE.tileTop, z);
            a.piece.setAirborne(lift);
          },
          easeInOutQuad,
        ),
      )
      .then(() => {
        a.hopping = false;
        a.piece.squash(fast ? 1.25 : 1);
        sfx.hop(pos);
        this.board.pulse(start, pos, 1);
        const w = a.piece.root.position;
        this.shocks.spawn(w.x, SCALE.tileTop + 0.05, w.z, 0.3, 1.9,
          fast ? col : "#e8f2f6", 0.45);
        if (fast) {
          this.particles.emit(w.x, SCALE.tileTop + 0.3, w.z, 14, {
            color: col, speed: 3.2, size: 0.13, life: 0.5, grav: -5, up: 0.7, spread: 1.2,
          });
        } else {
          this.particles.emit(w.x, SCALE.tileTop + 0.12, w.z, 5, {
            color: "#eef4f8", speed: 1.6, size: 0.1, life: 0.35, grav: -6, up: 0.6,
          });
        }
      });
  }

  /** 沿环道逐格跳到目标位置 */
  async moveTo(index: number, from: number, to: number, style: MoveStyle = "hop") {
    const dir = to >= from ? 1 : -1;
    let cur = from;
    let guard = 0;
    while (cur !== to && guard < 80) {
      cur += dir;
      await this.hopTo(index, cur, style);
      guard++;
    }
    if (style === "hop") sfx.land();
    this.reflowInstant();
  }

  /** 直接落位（换位/初始化用） */
  async teleport(index: number, pos: number, arc = false) {
    const a = this.pieces[index];
    a.pos = pos;
    const t = this.def.node(this.seats[index] ?? 0, pos);
    if (!arc) {
      a.piece.setPosition(t.x, SCALE.tileTop, t.z);
      this.reflowInstant();
      return;
    }
    const from = a.piece.root.position.clone();
    a.hopping = true;
    await this.anim.wait(
      tween(0.5, (k, raw) => {
        const lift = Math.sin(raw * Math.PI) * 3.0;
        a.piece.setPosition(
          from.x + (t.x - from.x) * k,
          SCALE.tileTop,
          from.z + (t.z - from.z) * k,
        );
        a.piece.setAirborne(lift);
      }, easeInOutQuad),
    );
    a.hopping = false;
    a.piece.squash(1);
    this.shocks.spawn(t.x, SCALE.tileTop + 0.05, t.z, 0.4, 2.6, "#a48cf0", 0.6);
    this.reflowInstant();
  }

  /* ---------------- 骰子 ---------------- */
  async rollDice(value: number) {
    sfx.roll();
    await this.dice.roll(value, this.anim, () => {
      sfx.settle();
      const p = this.dice.position();
      // 只留一道又紧又快的青色脉冲 + 少量粒子：
      // 骰子自带的柔光盘会跟着骰子飞起来（就是那道"移动的白色光影"，已删），
      // 而加性混合的浅色大环铺在浅色广场上同样会读成一片白光，所以环必须收紧。
      const gy = SCALE.boardTop + 0.36;
      this.shocks.spawn(p.x, gy, p.z, 0.4, 3.0, "#1fa6cc", 0.4);
      this.particles.emit(p.x, gy + 0.2, p.z, 14, {
        color: "#8fdcf5", speed: 4.6, size: 0.13, life: 0.6, grav: -4, up: 0.5,
      });
    });
  }

  /* ---------------- 事件特效 ---------------- */
  async playEffect(index: number, res: TileResolution) {
    const a = this.pieces[index];
    if (!a) return;
    const w = a.piece.root.position.clone();
    const color = tileColorOf(res);

    switch (res.effect.t) {
      case "shield": {
        this.setShield(index, true);
        sfx.good();
        for (let i = 0; i < 3; i++) {
          this.shocks.spawn(w.x, SCALE.tileTop + 0.1, w.z, 0.4 + i * 0.5, 2.6 + i * 0.6, "#5FD0A8", 0.6 + i * 0.12);
        }
        this.particles.emit(w.x, SCALE.tileTop + 0.7, w.z, 22, {
          color: "#5FD0A8", speed: 2.6, size: 0.13, life: 0.8, grav: -3, up: 0.5,
        });
        await this.anim.delay(0.35);
        break;
      }
      case "skip": {
        this.setFrozen(index, true);
        sfx.freeze();
        this.particles.emit(w.x, SCALE.tileTop + 0.6, w.z, 26, {
          color: "#8FD8F5", speed: 2.4, size: 0.14, life: 0.9, grav: -2, up: 0.4,
        });
        this.shocks.spawn(w.x, SCALE.tileTop + 0.05, w.z, 0.5, 2.8, "#8FD8F5", 0.7);
        await this.anim.delay(0.7);
        break;
      }
      case "blocked": {
        this.setShield(index, false);
        sfx.good();
        a.piece.tint("#ffffff");
        await this.anim.wait(tween(0.3, (k) => {
          this.shocks.spawn(w.x, SCALE.tileTop + 0.4, w.z, 0.5, 2.2 + k * 1.2, "#ffffff", 0.35);
        }, (t) => t));
        a.piece.clearTint();
        this.particles.emit(w.x, SCALE.tileTop + 0.6, w.z, 20, {
          color: "#5FD0A8", speed: 3.2, size: 0.12, life: 0.5, grav: -6, up: 0.6,
        });
        break;
      }
      case "advance":
      case "retreat": {
        sfx[res.effect.t === "advance" ? "good" : "bad"]();
        this.particles.emit(w.x, SCALE.tileTop + 0.5, w.z, 18, {
          color, speed: 3, size: 0.13, life: 0.6, grav: -5, up: 0.6, spread: 1.1,
        });
        for (let i = 0; i < 4; i++) {
          await this.anim.delay(0.045);
          this.shocks.spawn(w.x, SCALE.tileTop + 0.05 + i * 0.3, w.z, 0.3, 2.4, color, 0.45);
        }
        break;
      }
      case "again": {
        sfx.good();
        this.particles.emit(w.x, SCALE.tileTop + 0.6, w.z, 18, {
          color: "#A48CF0", speed: 3, size: 0.13, life: 0.6, grav: -4, up: 0.6,
        });
        await this.anim.delay(0.3);
        break;
      }
      case "swap": {
        await this.anim.delay(0.05);
        break;
      }
      default:
        break;
    }
  }

  /** 两者换位：两道抛物线交叉飞过 */
  async swapPieces(a: number, b: number) {
    sfx.whoosh();
    const pa = this.pieces[a];
    const pb = this.pieces[b];
    const pa0 = pa.piece.root.position.clone();
    const pb0 = pb.piece.root.position.clone();
    const posA = pa.pos;
    const posB = pb.pos;
    pa.hopping = true;
    pb.hopping = true;
    await this.anim.wait(
      tween(0.72, (k, raw) => {
        const lift = Math.sin(raw * Math.PI) * 4.2;
        pa.piece.setPosition(pa0.x + (pb0.x - pa0.x) * k, SCALE.tileTop, pa0.z + (pb0.z - pa0.z) * k);
        pb.piece.setPosition(pb0.x + (pa0.x - pb0.x) * k, SCALE.tileTop, pb0.z + (pa0.z - pb0.z) * k);
        pa.piece.setAirborne(lift);
        pb.piece.setAirborne(lift);
        if (Math.random() > 0.4) {
          this.particles.emit(pa.piece.root.position.x, SCALE.tileTop + lift + 0.3, pa.piece.root.position.z, 2, {
            color: "#B47BE0", speed: 0.8, size: 0.11, life: 0.5, grav: -2,
          });
          this.particles.emit(pb.piece.root.position.x, SCALE.tileTop + lift + 0.3, pb.piece.root.position.z, 2, {
            color: "#B47BE0", speed: 0.8, size: 0.11, life: 0.5, grav: -2,
          });
        }
      }, easeInOutQuad),
    );
    pa.hopping = false;
    pb.hopping = false;
    pa.pos = posB;
    pb.pos = posA;
    pa.piece.squash(1);
    pb.piece.squash(1);
    sfx.land();
    this.reflowInstant();
    this.shocks.spawn(pb0.x, SCALE.tileTop + 0.05, pb0.z, 0.4, 2.8, "#B47BE0", 0.6);
    this.shocks.spawn(pa0.x, SCALE.tileTop + 0.05, pa0.z, 0.4, 2.8, "#B47BE0", 0.6);
  }

  /* ---------------- 落地事件（格型提示） ---------------- */
  async landing(index: number, pos: number, color: string) {
    const a = this.pieces[index];
    if (!a) return;
    const w = a.piece.root.position.clone();
    this.board.pulse(this.seats[index] ?? 0, pos, 1.4);
    this.shocks.spawn(w.x, SCALE.tileTop + 0.06, w.z, 0.4, 3.4, color, 0.66);
    this.shocks.spawn(w.x, SCALE.tileTop + 0.06, w.z, 0.2, 2.2, "#ffffff", 0.36);
    this.particles.emit(w.x, SCALE.tileTop + 0.25, w.z, 24, {
      color, speed: 3.6, size: 0.15, life: 0.85, grav: -7, up: 0.8, spread: 1.1,
    });
    await this.anim.delay(0.18);
  }

  /** 冲线：礼花 + 镜头推近 */
  async celebrate(index: number) {
    sfx.win();
    const a = this.pieces[index];
    const start = a.piece.root.position.clone();
    const end = new THREE.Vector3(this.def.finish.x, SCALE.tileTop, this.def.finish.z);
    a.hopping = true;
    this.focus.set(0, 0.9, 0);
    this.zoomTarget = 1.55;
    await this.anim.wait(
      tween(1.0, (k, raw) => {
        const lift = Math.sin(raw * Math.PI) * 5.5;
        a.piece.setPosition(
          start.x + (end.x - start.x) * k,
          SCALE.tileTop,
          start.z + (end.z - start.z) * k,
        );
        a.piece.setAirborne(lift);
      }, easeInOutQuad),
    );
    a.hopping = false;
    a.piece.squash(1.4);
    const colors = ["#2FBFD4", "#FF7A59", "#9B7BF0", "#F2C14E", "#5FD0A8", "#ffffff"];
    for (let burst = 0; burst < 7; burst++) {
      const bx = (Math.random() - 0.5) * 18;
      const bz = -10 + Math.random() * 20;
      const by = 4 + Math.random() * 6;
      this.shocks.spawn(bx, 3.2, bz, 0.6, 7, colors[burst % colors.length], 1.0);
      this.particles.emit(bx, by, bz, 60, {
        color: colors[burst % colors.length],
        speed: 7,
        size: 0.18,
        life: 1.6,
        grav: -7,
        up: 0.9,
        spread: 1.3,
        drag: 0.9,
      });
      await this.anim.delay(0.14);
    }
    // 持续飘落
    for (let i = 0; i < 12; i++) {
      this.particles.emit(
        (Math.random() - 0.5) * 30, 14 + Math.random() * 6, (Math.random() - 0.5) * 30,
        16,
        { color: colors[i % colors.length], speed: 1.2, size: 0.15, life: 3.2, grav: -2.4, drag: 0.5, up: -0.1 },
      );
      await this.anim.delay(0.09);
    }
  }

  /* ---------------- 相机 ---------------- */
  setView(azimuth: number, elevation: number) {
    this.azimuth = azimuth;
    this.elevation = elevation;
  }

  setZoom(z: number) {
    this.zoomTarget = z;
  }

  private onResize = () => this.resize();

  private resize() {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.left = (-this.frustum() * aspect) / 2;
    this.camera.right = (this.frustum() * aspect) / 2;
    this.camera.top = this.frustum() / 2;
    this.camera.bottom = -this.frustum() / 2;
    this.camera.updateProjectionMatrix();
    this.particles.setPixelScale(h / this.frustum());
  }

  private frustum() {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const base = Math.max(this.minFrustum, this.baseFrustum / aspect);
    return base / this.zoom;
  }

  private updateCamera() {
    const ae = (this.elevation * Math.PI) / 180;
    const aa = (this.azimuth * Math.PI) / 180;
    const dir = new THREE.Vector3(
      Math.cos(ae) * Math.cos(aa),
      Math.sin(ae),
      Math.cos(ae) * Math.sin(aa),
    );
    this.camera.position.copy(this.target).addScaledVector(dir, CAM.distance);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private onPointerDown = (e: PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragging = true;
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinchDist > 0) {
        const ratio = d / this.pinchDist;
        this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * ratio, 0.55, 2.6);
      }
      this.pinchDist = d;
      return;
    }
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.azimuth += dx * 0.22;
    this.elevation = THREE.MathUtils.clamp(this.elevation + dy * 0.16, 12, 76);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pinchDist = 0;
    if (this.pointers.size === 0) this.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0012);
    this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * k, 0.55, 2.6);
  };

  /* ---------------- 主循环 ---------------- */
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.time += dt;
    if (this.autoRotate) this.azimuth += dt * 3.4;

    this.anim.update(dt);
    this.surround.update(dt);
    this.board.update(dt);
    this.dice.idle(dt);
    this.particles.update(dt);
    this.shocks.update(dt);
    this.pieces.forEach((p, i) => {
      p.piece.update(dt, this.time, i === this.activeIndex && !p.finished, p.piece.cryo.visible);
    });
    this.reflow(dt);

    // 相机：缩放 / 焦点缓动
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 3.4);
    const w = this.pieces[this.activeIndex];
    if (w && !w.finished) {
      const t = this.def.node(this.seats[this.activeIndex] ?? 0, w.pos);
      // 只做很轻微的构图跟随，避免整个沙盘在画面里乱飘
      this.focus.set(t.x * 0.1, 0.9, t.z * 0.1);
    }
    this.target.lerp(this.focus, Math.min(1, dt * 1.6));
    this.updateCamera();
    this.resizeIfZoomChanged();

    this.renderer.render(this.scene, this.camera);
    this.adapt(dt);
  };

  private lastFrustum = 0;
  private resizeIfZoomChanged() {
    const f = this.frustum();
    if (Math.abs(f - this.lastFrustum) > 1e-4) {
      this.lastFrustum = f;
      const w = this.container.clientWidth;
      const h = Math.max(1, this.container.clientHeight);
      const aspect = w / h;
      this.camera.left = (-f * aspect) / 2;
      this.camera.right = (f * aspect) / 2;
      this.camera.top = f / 2;
      this.camera.bottom = -f / 2;
      this.camera.updateProjectionMatrix();
      this.particles.setPixelScale(h / f);
    }
  }

  private adapt(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 45) this.frameTimes.shift();
    this.adaptTimer += dt;
    if (this.adaptTimer < 2.0) return;
    this.adaptTimer = 0;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = 1 / avg;
    const info = this.renderer.info.render;
    this.stats = {
      fps: Math.round(this.fps),
      drawCalls: info.calls,
      triangles: info.triangles,
      pixelRatio: this.pixelRatio,
    };
    // 自适应分辨率：掉帧就降，稳了就回
    if (this.fps < 50 && this.pixelRatio > 1.0) {
      this.pixelRatio = Math.max(1.0, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
    } else if (this.fps > 58 && this.pixelRatio < this.maxPixelRatio) {
      this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
    }
  }

  /** 开场：镜头从远处推入 */
  async playIntro() {
    // 起手仰角比默认高 20°，收尾落回 CAM.defaultElevation —— 别再写死 38，
    // 否则改了默认仰角会被开场动画悄悄覆盖回去。
    const from = CAM.defaultElevation + 20;
    this.zoom = 0.45;
    this.zoomTarget = 0.45;
    this.elevation = from;
    await this.anim.delay(0.3);
    this.zoomTarget = 1.0;
    this.focus.set(0, 0.9, 0);
    await this.anim.wait(tween(1.5, (k) => {
      this.elevation = from - 20 * k;
    }, easeOutCubic));
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("wheel", this.onWheel);
    this.anim.clear();
    this.surround.dispose();
    this.board.dispose();
    this.dice.dispose();
    this.pieces.forEach((p) => p.piece.dispose());
    this.particles.dispose();
    this.shocks.dispose();
    this.mats.dispose();
    this.envRT?.dispose();
    this.skyTex?.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

function tileColorOf(res: TileResolution) {
  const map: Record<string, string> = {
    advance: "#86D48A",
    retreat: "#FF8A6B",
    skip: "#8FD8F5",
    swap: "#B47BE0",
    shield: "#5FD0A8",
    again: "#A48CF0",
    blocked: "#ffffff",
    none: "#C9D4DB",
  };
  return map[res.effect.t] ?? "#ffffff";
}

