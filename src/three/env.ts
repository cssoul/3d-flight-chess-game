import * as THREE from "three";
import { makeRandom } from "./rng";

export type TimeOfDay = "day" | "night";

interface SkySpec {
  stops: [number, string][];
  glows: [number, number, number][];
  cloud: number;
  cloudTint: string;
  /** 地面半球的窗户亮度（地平线以下的城市灯光） */
  windowAlpha: number;
}

/**
 * 一天两时：白昼 / 夜晚。
 * 白昼走 SASAKI 的"高调纸模"路线——天空几乎全白，只有极浅的冷灰蓝；
 * 夜晚走"城市光晕"路线——天顶近黑，地平线一圈暖褐（#4A4038 的 G 落在 R 与 B 之间，
 * 这很关键：偏紫的地平线会把白色石材刷成品红）。
 */
const SKY: Record<TimeOfDay, SkySpec> = {
  day: {
    // 相机是 35° 俯角的轴测，可见 v 区间约 [0.27, 0.34]：zenith→horizon 的浅蓝到近白
    stops: [
      [0.0, "#9dc4e0"],
      [0.22, "#c3dcee"],
      [0.4, "#e8f1f6"],
      [0.485, "#fbfdfe"],
      [0.5, "#f6f9fa"],
      [0.58, "#e6ebee"],
      [1.0, "#dfe5e9"],
    ],
    glows: [[340, 200, 0.16], [820, 170, 0.12]],
    cloud: 0.42,
    cloudTint: "255,255,255",
    windowAlpha: 0.05,
  },
  night: {
    stops: [
      [0.0, "#04070f"],
      [0.2, "#081428"],
      [0.38, "#122a4a"],
      [0.472, "#1d3a5c"],
      [0.5, "#2b3145"],
      [0.515, "#4a4038"],
      [0.56, "#241f22"],
      [1.0, "#0b0e14"],
    ],
    glows: [[220, 260, 0.5], [640, 300, 0.42], [900, 220, 0.34]],
    cloud: 0.2,
    cloudTint: "150,175,215",
    windowAlpha: 1,
  },
};

export interface TimePreset {
  time: TimeOfDay;
  /** 环境光（天空/地面双色） */
  hemi: { sky: string; ground: string; intensity: number };
  key: { color: string; intensity: number; pos: [number, number, number] };
  fill: { color: string; intensity: number; pos: [number, number, number] };
  rim: { color: string; intensity: number; pos: [number, number, number] };
  ambient: { color: string; intensity: number };
  exposure: number;
  environmentIntensity: number;
  toneMapping: THREE.ToneMapping;
  /** 地面主色（白昼是纸白，夜晚压到深蓝灰） */
  groundTint: string;
  /** 建筑窗户内透强度 */
  windowEmit: number;
  /** 路灯亮度 */
  lampEmit: number;
  /** 棋盘格自发光 */
  tileEmit: number;
  /** 水面色 */
  waterTint: string;
}

export const TIME_PRESETS: Record<TimeOfDay, TimePreset> = {
  day: {
    time: "day",
    // 白昼的读法：一盏强暖阳 + 极低的棚光/环境光。
    // 关键不是"更亮"，而是"拉开层次"——正面朝光的面留白，背光面落到浅灰，
    // 这样 SASAKI 白模的体量感才立得起来。棚光压到 0.58 是为了给阴影留出下探空间。
    hemi: { sky: "#dceaf8", ground: "#cec7ba", intensity: 0.58 },
    key: { color: "#fff4e0", intensity: 2.6, pos: [-52, 80, 46] },
    fill: { color: "#dceaf8", intensity: 0.24, pos: [58, 30, -30] },
    rim: { color: "#ffffff", intensity: 0.4, pos: [26, 26, 70] },
    ambient: { color: "#e6f0fa", intensity: 0.12 },
    exposure: 1.0,
    environmentIntensity: 0.45,
    toneMapping: THREE.ACESFilmicToneMapping,
    groundTint: "#ffffff",
    windowEmit: 0,
    lampEmit: 0,
    tileEmit: 0,
    waterTint: "#9ad6e2",
  },
  night: {
    time: "night",
    hemi: { sky: "#22385c", ground: "#111a28", intensity: 0.95 },
    key: { color: "#a8c8ee", intensity: 1.15, pos: [-40, 70, 44] },
    fill: { color: "#4a7cba", intensity: 0.5, pos: [56, 26, -34] },
    rim: { color: "#ffb46a", intensity: 0.62, pos: [30, 20, 66] },
    ambient: { color: "#2b3f5e", intensity: 0.36 },
    exposure: 1.14,
    environmentIntensity: 0.66,
    toneMapping: THREE.ACESFilmicToneMapping,
    groundTint: "#33445c",
    windowEmit: 1.35,
    lampEmit: 2.1,
    tileEmit: 0.24,
    waterTint: "#173244",
  },
};

/** 程序化 equirect 天空：同时产出 environment（玻璃反射）与 background */
export function createSky(renderer: THREE.WebGLRenderer, time: TimeOfDay) {
  const spec = SKY[time];
  const W = 1024;
  const H = 512;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  for (const [v, color] of spec.stops) grad.addColorStop(v, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const rand = makeRandom(4242);

  // 地平线光晕：equirect 是 2:1，圆形渐变在竖直方向会被拉长 2 倍，必须显式压扁
  for (const [cx, spread, alpha] of spec.glows) {
    const warm = time === "night" ? "255,186,116" : "255,247,232";
    const pool = ctx.createRadialGradient(cx, 258, 0, cx, 258, spread);
    pool.addColorStop(0, `rgba(${warm},${alpha})`);
    pool.addColorStop(0.45, `rgba(${warm},${alpha * 0.4})`);
    pool.addColorStop(1, `rgba(${warm},0)`);
    ctx.save();
    ctx.translate(0, 258);
    ctx.scale(1, 0.2);
    ctx.translate(0, -258);
    ctx.fillStyle = pool;
    ctx.fillRect(0, 258 - spread * 0.2 - 4, W, spread * 0.4 + 8);
    ctx.restore();
  }

  if (spec.cloud > 0.01) {
    for (let i = 0; i < 26; i++) {
      const x = rand() * W;
      const y = 40 + rand() * 170;
      const w = 80 + rand() * 250;
      const h = 8 + rand() * 22;
      const a = (0.1 + rand() * 0.2) * spec.cloud;
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, w);
      cloud.addColorStop(0, `rgba(${spec.cloudTint},${a})`);
      cloud.addColorStop(1, `rgba(${spec.cloudTint},0)`);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, h / w);
      ctx.translate(-x, -y);
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.arc(x, y, w, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 地平线以下：对面街区的窗光
  for (let i = 0; i < 220; i++) {
    const x = rand() * W;
    const y = 272 + rand() * 110;
    ctx.fillStyle =
      rand() > 0.28
        ? `rgba(255,206,150,${(0.2 + rand() * 0.5) * spec.windowAlpha})`
        : `rgba(190,220,255,${(0.15 + rand() * 0.35) * spec.windowAlpha})`;
    ctx.fillRect(x, y, 1 + rand() * 2.5, 1 + rand() * 2.2);
  }

  const texture = new THREE.CanvasTexture(cv);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(texture);
  pmrem.dispose();

  return { environment, sky: texture };
}

/** 大地面：径向渐变，把"微缩沙盘"的边界柔和收掉 */
export function createGroundTexture(inner: string, outer: string): THREE.Texture {
  const S = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = outer;
  ctx.fillRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, inner);
  g.addColorStop(1, withAlpha(outer, 0.15));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function withAlpha(hex: string, a: number) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}
