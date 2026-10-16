import * as THREE from "three";
import { makeRandom } from "./rng";
import { TILE_STYLE, type IconName, type TileKind } from "../game/theme";

/* ------------------------------------------------------------------ *
 *  画布工具
 * ------------------------------------------------------------------ */

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function finish(c: HTMLCanvasElement, repeat = false, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

/* ------------------------------------------------------------------ *
 *  图标（全部 canvas 路径手绘，无外部素材）
 * ------------------------------------------------------------------ */

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, n = 5) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? R : R * 0.44;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawIcon(ctx: CanvasRenderingContext2D, icon: IconName, cx: number, cy: number, s: number) {
  const w = s;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = w * 0.1;

  switch (icon) {
    case "arrow": {
      const h = w * 0.62;
      const sw = w * 0.19;
      ctx.beginPath();
      ctx.moveTo(0, -h);
      ctx.lineTo(h * 0.82, -h * 0.14);
      ctx.lineTo(sw, -h * 0.14);
      ctx.lineTo(sw, h);
      ctx.lineTo(-sw, h);
      ctx.lineTo(-sw, -h * 0.14);
      ctx.lineTo(-h * 0.82, -h * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "star": {
      starPath(ctx, 0, w * 0.02, w * 0.62);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "bolt": {
      ctx.beginPath();
      ctx.moveTo(w * 0.16, -w * 0.64);
      ctx.lineTo(-w * 0.44, w * 0.06);
      ctx.lineTo(-w * 0.03, w * 0.06);
      ctx.lineTo(-w * 0.2, w * 0.66);
      ctx.lineTo(w * 0.44, -w * 0.08);
      ctx.lineTo(w * 0.02, -w * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "gift": {
      const bw = w * 0.66;
      const bh = w * 0.5;
      roundRect(ctx, -bw / 2, -bh * 0.28, bw, bh, w * 0.07);
      ctx.fill();
      ctx.stroke();
      // 盒盖
      roundRect(ctx, -bw * 0.6, -bh * 0.72, bw * 1.2, bh * 0.42, w * 0.06);
      ctx.fill();
      ctx.stroke();
      // 缎带（用底色"挖"出来）
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillRect(-w * 0.055, -bh * 0.72, w * 0.11, bh * 1.5);
      ctx.globalCompositeOperation = "source-over";
      // 蝴蝶结
      ctx.beginPath();
      ctx.moveTo(0, -bh * 0.72);
      ctx.quadraticCurveTo(-w * 0.34, -w * 0.95, -w * 0.06, -bh * 0.62);
      ctx.quadraticCurveTo(w * 0.34, -w * 0.95, w * 0.06, -bh * 0.62);
      ctx.fill();
      break;
    }
    case "question": {
      ctx.font = `900 ${w * 1.32}px "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", 0, w * 0.06);
      break;
    }
    case "cone": {
      ctx.beginPath();
      ctx.moveTo(0, -w * 0.66);
      ctx.lineTo(w * 0.44, w * 0.42);
      ctx.lineTo(-w * 0.44, w * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillRect(-w * 0.3, -w * 0.02, w * 0.6, w * 0.13);
      ctx.globalCompositeOperation = "source-over";
      roundRect(ctx, -w * 0.62, w * 0.42, w * 1.24, w * 0.18, w * 0.08);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "snow": {
      ctx.lineWidth = w * 0.11;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * w * 0.66, Math.sin(a) * w * 0.66);
        ctx.stroke();
        for (const d of [0.42, 0.68]) {
          const bx = Math.cos(a) * w * 0.66 * d;
          const by = Math.sin(a) * w * 0.66 * d;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a + 0.9) * w * 0.2, by + Math.sin(a + 0.9) * w * 0.2);
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a - 0.9) * w * 0.2, by + Math.sin(a - 0.9) * w * 0.2);
          ctx.stroke();
        }
      }
      break;
    }
    case "swap": {
      const al = w * 0.6;
      const drawArrow = (dir: number, y: number) => {
        ctx.beginPath();
        ctx.moveTo(-al * dir, y);
        ctx.lineTo(al * 0.6 * dir, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(al * 0.92 * dir, y);
        ctx.lineTo(al * 0.42 * dir, y - w * 0.24);
        ctx.lineTo(al * 0.42 * dir, y + w * 0.24);
        ctx.closePath();
        ctx.fill();
      };
      drawArrow(1, -w * 0.26);
      drawArrow(-1, w * 0.26);
      break;
    }
    case "shield": {
      ctx.beginPath();
      ctx.moveTo(0, -w * 0.66);
      ctx.lineTo(w * 0.56, -w * 0.42);
      ctx.lineTo(w * 0.52, w * 0.14);
      ctx.quadraticCurveTo(w * 0.4, w * 0.58, 0, w * 0.7);
      ctx.quadraticCurveTo(-w * 0.4, w * 0.58, -w * 0.52, w * 0.14);
      ctx.lineTo(-w * 0.56, -w * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = w * 0.16;
      ctx.beginPath();
      ctx.moveTo(-w * 0.22, 0);
      ctx.lineTo(-w * 0.03, w * 0.2);
      ctx.lineTo(w * 0.26, -w * 0.22);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
      break;
    }
    case "rocket": {
      ctx.beginPath();
      ctx.moveTo(0, -w * 0.72);
      ctx.quadraticCurveTo(w * 0.36, -w * 0.3, w * 0.34, w * 0.3);
      ctx.lineTo(-w * 0.34, w * 0.3);
      ctx.quadraticCurveTo(-w * 0.36, -w * 0.3, 0, -w * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w * 0.34, w * 0.02);
      ctx.lineTo(-w * 0.68, w * 0.5);
      ctx.lineTo(-w * 0.32, w * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w * 0.34, w * 0.02);
      ctx.lineTo(w * 0.68, w * 0.5);
      ctx.lineTo(w * 0.32, w * 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(0, -w * 0.2, w * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      break;
    }
    case "flag": {
      // 旗杆用深色：登顶航道的格面是金色，白杆会整根糊掉
      ctx.strokeStyle = "#33404c";
      ctx.lineWidth = w * 0.14;
      ctx.beginPath();
      ctx.moveTo(-w * 0.4, -w * 0.74);
      ctx.lineTo(-w * 0.4, w * 0.74);
      ctx.stroke();
      // 旗面（内嵌方格：白色旗底上"挖"出黑格，看起来就是一面方格旗）
      ctx.strokeStyle = "#ffffff";
      const fw = w * 0.94;
      const fh = w * 0.62;
      ctx.beginPath();
      ctx.moveTo(-w * 0.4, -w * 0.72);
      ctx.lineTo(-w * 0.4 + fw, -w * 0.5);
      ctx.lineTo(-w * 0.4 + fw, -w * 0.5 + fh);
      ctx.lineTo(-w * 0.4, -w * 0.72 + fh);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const cell = fw / 6;
      const ch = fh / 3;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      for (let r = 0; r < 3; r++) {
        for (let c2 = 0; c2 < 6; c2++) {
          if ((r + c2) % 2 !== 0) continue;
          ctx.fillRect(-w * 0.4 + c2 * cell, -w * 0.72 + r * ch, cell, ch);
        }
      }
      ctx.restore();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 *  棋盘格面：上半张是格面（色块 + 图标），下半张是纯白（给盒子侧面用）
 * ------------------------------------------------------------------ */

const CELL = 256;

/**
 * 格面的两种表面处理：
 * - `chip`  —— 城市场景用的「白底板上的筹码」，四周一圈留白，色块是主角；
 * - `stone` —— 浮岛场景用的「石板路上的镶嵌」：底色是暖灰石板，
 *              彩色块缩进一圈嵌在石板里，plain 格干脆整块都是石板，于是环道看起来
 *              真的是一条石路，而不是一路彩色贴纸。
 */
export type TileSurface = "chip" | "stone";

export function createTileTexture(kind: TileKind, surface: TileSurface = "chip"): THREE.CanvasTexture {
  const style = TILE_STYLE[kind];
  const { c, ctx } = canvas(CELL, CELL * 2);
  const stone = surface === "stone";

  // ---- 下半张：盒子侧面 / 底面 ----
  // chip 刻意压成浅灰：格块是"摊在白色底板上的筹码"，
  // 白对白在轴测视角下会糊成一片，靠侧面的灰边才能把 48 块格分开。
  const sideGrad = ctx.createLinearGradient(0, CELL, 0, CELL * 2);
  if (stone) {
    sideGrad.addColorStop(0, "#ddd6c8");
    sideGrad.addColorStop(1, "#a89f8d");
  } else {
    sideGrad.addColorStop(0, "#e9edf0");
    sideGrad.addColorStop(1, "#c8d0d6");
  }
  ctx.fillStyle = sideGrad;
  ctx.fillRect(0, CELL, CELL, CELL);
  ctx.fillStyle = stone ? "rgba(74,66,52,.30)" : "rgba(96,110,124,.22)";
  ctx.fillRect(0, CELL * 2 - 7, CELL, 7);

  // ---- 上半张：格面 ----
  const pad = stone ? 13 : 15;

  if (stone) {
    // 石板面：暖灰底 + 细石粒 + 一圈略深的边
    ctx.fillStyle = "#e7e0d2";
    ctx.fillRect(0, 0, CELL, CELL);
    const rand = makeRandom(97 + (CELL & 7));
    for (let i = 0; i < 1500; i++) {
      const v = rand() > 0.5 ? 255 : 120;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rand() * 0.09})`;
      ctx.fillRect(rand() * CELL, rand() * CELL, 1 + rand() * 2.4, 1 + rand() * 2.4);
    }
    for (let i = 0; i < 5; i++) {
      const x = rand() * CELL;
      const y = rand() * CELL;
      const r = 20 + rand() * 44;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rand() > 0.5 ? "rgba(255,253,244,.5)" : "rgba(122,112,94,.16)");
      g.addColorStop(1, "rgba(150,140,120,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = "rgba(120,110,92,.35)";
    ctx.lineWidth = 4;
    roundRect(ctx, 3, 3, CELL - 6, CELL - 6, 26);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#eef2f4";
    ctx.fillRect(0, 0, CELL, CELL);
    // 内圈一圈更白的"卡面"，让格块内部仍保持干净的留白
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 7, 7, CELL - 14, CELL - 14, 30);
    ctx.fill();
  }

  const isStart = kind === "start";
  const bare = stone && kind === "plain"; // 石板路：裸石格不铺彩色块
  const bg = isStart ? "#2E9BD6" : style.color;

  if (!bare) {
    // 底部投影，让色块有一点"嵌进石板"的厚度
    ctx.save();
    ctx.globalAlpha = stone ? 0.2 : 0.14;
    ctx.fillStyle = stone ? "#5c5344" : "#2c3a46";
    const sh = stone ? 4 : 7;
    roundRect(ctx, pad, pad + sh, CELL - pad * 2, CELL - pad * 2, 26);
    ctx.fill();
    ctx.restore();

    const grad = ctx.createLinearGradient(0, pad, 0, CELL - pad);
    grad.addColorStop(0, lighten(bg, 0.06));
    grad.addColorStop(1, darken(bg, 0.05));
    ctx.fillStyle = grad;
    roundRect(ctx, pad, pad, CELL - pad * 2, CELL - pad * 2, 26);
    ctx.fill();

    // 顶部高光
    ctx.save();
    roundRect(ctx, pad, pad, CELL - pad * 2, CELL - pad * 2, 26);
    ctx.clip();
    const hi = ctx.createLinearGradient(0, pad, 0, pad + 84);
    hi.addColorStop(0, "rgba(255,255,255,.36)");
    hi.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hi;
    ctx.fillRect(pad, pad, CELL - pad * 2, 90);
    ctx.restore();

    // 描边
    ctx.strokeStyle = stone ? "rgba(255,255,255,.42)" : "rgba(255,255,255,.55)";
    ctx.lineWidth = 3;
    roundRect(ctx, pad + 1.5, pad + 1.5, CELL - pad * 2 - 3, CELL - pad * 2 - 3, 25);
    ctx.stroke();
  }

  if (isStart) {
    ctx.fillStyle = "#ffffff";
    ctx.font = '900 52px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("START", CELL / 2, CELL / 2 - 12);
    ctx.font = '700 20px "Helvetica Neue", Arial, sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText("起 点", CELL / 2, CELL / 2 + 32);
    ctx.globalAlpha = 1;
  } else if (bare) {
    // 裸石格：只刻一圈浅线，让它明显是"同一块石板"而不是忘了画
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = "#8f8672";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(CELL / 2, CELL / 2, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else if (style.icon !== "none") {
    drawIcon(ctx, style.icon, CELL / 2, CELL / 2, stone ? 112 : 118);
  } else {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(CELL / 2, CELL / 2, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  return finish(c, false, 16);
}

function lighten(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), amt);
  return `#${c.getHexString()}`;
}

function darken(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0x000000), amt);
  return `#${c.getHexString()}`;
}

export { darken };

/* ------------------------------------------------------------------ *
 *  表面细节贴图（近白噪声，真实颜色交给顶点色）
 * ------------------------------------------------------------------ */

export function createSurfaceNoise(seedBase: number, fine = 9000, blobs = 180, contrast = 1): THREE.Texture {
  const size = 512;
  const { c, ctx } = canvas(size, size);
  const rand = makeRandom(seedBase);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < blobs; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.02 + rand() * 0.15);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? "rgba(255,255,255,.06)" : "rgba(120,132,140,.07)");
    g.addColorStop(1, "rgba(150,160,168,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < fine; i++) {
    const v = rand() > 0.5 ? 255 : 150;
    ctx.fillStyle = `rgba(${v},${v},${v},${(0.02 + rand() * 0.07) * contrast})`;
    const s = 0.6 + rand() * 1.5;
    ctx.fillRect(rand() * size, rand() * size, s, s);
  }
  return finish(c, true, 8);
}

/** 沥青路面 */
export function createAsphalt(): THREE.Texture {
  const size = 512;
  const { c, ctx } = canvas(size, size);
  const rand = makeRandom(991);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26000; i++) {
    const v = rand() > 0.5 ? 255 : 120;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rand() * 0.13})`;
    const s = 1 + rand() * 2.6;
    ctx.fillRect(rand() * size, rand() * size, s, s);
  }
  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.03 + rand() * 0.13);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(90,96,104,.10)");
    g.addColorStop(1, "rgba(120,128,136,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return finish(c, true, 8);
}

/** 草地 */
export function createLawn(): THREE.Texture {
  const size = 512;
  const { c, ctx } = canvas(size, size);
  const rand = makeRandom(4242);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    ctx.strokeStyle = rand() > 0.5 ? "rgba(255,255,255,.16)" : "rgba(70,96,48,.18)";
    ctx.lineWidth = 0.8 + rand() * 1.6;
    const x = rand() * size;
    const y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 8, y + (rand() - 0.5) * 8);
    ctx.stroke();
  }
  for (let i = 0; i < 260; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.01 + rand() * 0.05);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? "rgba(255,248,190,.13)" : "rgba(52,78,36,.13)");
    g.addColorStop(1, "rgba(120,140,90,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return finish(c, true, 8);
}

/** 屋面砾石 */
export function createGravel(): THREE.Texture {
  const size = 256;
  const { c, ctx } = canvas(size, size);
  const rand = makeRandom(31337);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = 150 + Math.floor(rand() * 105);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + rand() * 0.4})`;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 0.8 + rand() * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c, true, 4);
}

/** 水面波纹（法线扰动用） */
export function createWaterBump(): THREE.Texture {
  const size = 256;
  const { c, ctx } = canvas(size, size);
  const rand = makeRandom(7331);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 700; i++) {
    const y = rand() * size;
    const v = 108 + Math.floor(rand() * 44);
    ctx.strokeStyle = `rgba(${v},${v},${v},.5)`;
    ctx.lineWidth = 0.6 + rand() * 1.7;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    ctx.bezierCurveTo(80, y + (rand() - 0.5) * 16, 170, y + (rand() - 0.5) * 16, size + 10, y);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 圆形柔和阴影（棋子/车辆用假阴影，换来静态阴影贴图只烘一次） */
export function createBlobShadow(): THREE.Texture {
  const { c, ctx } = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(28,40,52,.42)");
  g.addColorStop(0.5, "rgba(28,40,52,.24)");
  g.addColorStop(1, "rgba(28,40,52,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(c, false, 2);
}

/** 粒子精灵（圆形软点） */
export function createSpark(): THREE.Texture {
  const { c, ctx } = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return finish(c, false, 2);
}

/** 环形光环（扩散冲击波） */
export function createRingSprite(thickness = 0.16): THREE.Texture {
  const { c, ctx } = canvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  const inner = 1 - thickness;
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(inner * 0.72, "rgba(255,255,255,0)");
  g.addColorStop(inner * 0.94, "rgba(255,255,255,.95)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return finish(c, false, 2);
}

/** 终点方格旗 */
export function createCheckered(): THREE.Texture {
  const { c, ctx } = canvas(256, 64);
  const s = 32;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#ffffff" : "#22303c";
      ctx.fillRect(x * s, y * s, s, s);
    }
  }
  return finish(c, true, 8);
}

/** 篮球场 / 运动场地坪 */
export function createCourt(): THREE.Texture {
  const size = 512;
  const { c, ctx } = canvas(size, size);
  ctx.fillStyle = "#4f9e5e";
  ctx.fillRect(0, 0, size, size);
  const rand = makeRandom(5150);
  for (let i = 0; i < 9000; i++) {
    const v = rand() > 0.5 ? 255 : 40;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.02 + rand() * 0.05})`;
    ctx.fillRect(rand() * size, rand() * size, 2, 2);
  }
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.lineWidth = 6;
  ctx.strokeRect(22, 22, size - 44, size - 44);
  ctx.beginPath();
  ctx.moveTo(22, size / 2);
  ctx.lineTo(size - 22, size / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(size / 2 - 105, 22, 210, 110);
  ctx.strokeRect(size / 2 - 105, size - 132, 210, 110);
  return finish(c, false, 8);
}

/** 停车场（深色底 + 白色车位线） */
export function createParking(): THREE.Texture {
  const w = 512;
  const h = 256;
  const { c, ctx } = canvas(w, h);
  ctx.fillStyle = "#6f7880";
  ctx.fillRect(0, 0, w, h);
  const rand = makeRandom(616);
  for (let i = 0; i < 6000; i++) {
    const v = rand() > 0.5 ? 255 : 30;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.02 + rand() * 0.06})`;
    ctx.fillRect(rand() * w, rand() * h, 2, 2);
  }
  ctx.fillStyle = "rgba(255,255,255,.75)";
  for (let x = 24; x < w; x += 46) {
    ctx.fillRect(x, 14, 4, h - 28);
  }
  return finish(c, false, 8);
}

/** 建筑玻璃立面的细微分格（近白，靠顶点色上色） */
export function createGlassNoise(): THREE.Texture {
  const size = 256;
  const { c, ctx } = canvas(size, size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 32) {
    ctx.fillStyle = "rgba(120,140,160,.16)";
    ctx.fillRect(x, 0, 3, size);
  }
  for (let y = 0; y < size; y += 26) {
    ctx.fillStyle = "rgba(255,255,255,.22)";
    ctx.fillRect(0, y, size, 2);
  }
  const rand = makeRandom(2024);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.03 + rand() * 0.08})`;
    ctx.fillRect(rand() * size, rand() * size, 24 + rand() * 60, 10 + rand() * 26);
  }
  return finish(c, true, 4);
}

/** 清水混凝土板缝 + 拉杆孔（1 tile = 1 米） */
export function createConcrete(): THREE.Texture {
  const size = 512;
  const { c, ctx } = canvas(size, size);
  const rand = makeRandom(83);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const board = size / 2;
  for (let y = 0; y < size; y += board) {
    ctx.fillStyle = "rgba(58,55,50,.22)";
    ctx.fillRect(0, y, size, 2);
    ctx.fillStyle = "rgba(255,252,244,.16)";
    ctx.fillRect(0, y + 2, size, 1.5);
  }
  for (let y = board / 2; y < size; y += board) {
    for (let x = board / 2; x < size; x += board) {
      const r = size * 0.0065;
      ctx.fillStyle = "rgba(48,45,40,.30)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = rand() * size;
    const w = size * (0.004 + rand() * 0.016);
    const h = size * (0.1 + rand() * 0.45);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(74,78,70,.09)");
    g.addColorStop(1, "rgba(74,78,70,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, rand() * size * 0.4, w, h);
  }
  return finish(c, true, 8);
}

/* ------------------------------------------------------------------ *
 *  浮岛场景的表面：石板路 / 沙滩 / 木纹
 * ------------------------------------------------------------------ */

/**
 * 不规则石板（园林铺地）。
 * 3×3 的角点网格：**边界点严格落在网格线上**（贴图才能无缝重复），内部点随机抖动，
 * 于是每块石板都是四边形但大小不一，是"手工铺的"而不是瓷砖。
 */
export function createFlagstone(): THREE.Texture {
  const size = 512;
  const { c, ctx } = canvas(size, size);
  const rand = makeRandom(5150);
  const N = 3;
  const step = size / N;

  const grid: [number, number][][] = [];
  for (let j = 0; j <= N; j++) {
    const row: [number, number][] = [];
    for (let i = 0; i <= N; i++) {
      const edge = i === 0 || j === 0 || i === N || j === N;
      const k = edge ? 0 : 0.26;
      row.push([
        i * step + (rand() - 0.5) * step * k * 2,
        j * step + (rand() - 0.5) * step * k * 2,
      ]);
    }
    grid.push(row);
  }

  // 石缝底色
  ctx.fillStyle = "#8b8271";
  ctx.fillRect(0, 0, size, size);

  const shades: string[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = grid[j][i];
      const b = grid[j][i + 1];
      const d = grid[j + 1][i + 1];
      const e = grid[j + 1][i];
      const cx = (a[0] + b[0] + d[0] + e[0]) / 4;
      const cy = (a[1] + b[1] + d[1] + e[1]) / 4;
      const shrink = (p: [number, number]): [number, number] => [
        p[0] + (cx - p[0]) * 0.055,
        p[1] + (cy - p[1]) * 0.055,
      ];
      const pa = shrink(a);
      const pb = shrink(b);
      const pd = shrink(d);
      const pe = shrink(e);

      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.lineTo(pd[0], pd[1]);
      ctx.lineTo(pe[0], pe[1]);
      ctx.closePath();
      const g = ctx.createLinearGradient(pa[0], pa[1], pe[0], pe[1]);
      const base = 226 + Math.floor(rand() * 18);
      const tint = rand();
      g.addColorStop(0, `rgb(${base + 6},${base + 2},${base - 14})`);
      g.addColorStop(1, `rgb(${base - 26},${base - 30},${base - 44})`);
      ctx.fillStyle = g;
      ctx.fill();
      if (tint > 0.7) {
        // 少数石板偏青灰，铺地才不单调
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = "#7d8e8c";
        ctx.fill();
        ctx.restore();
      }
      shades.push("");
    }
  }

  // 石粒与磨损
  for (let i = 0; i < 9000; i++) {
    const v = rand() > 0.5 ? 255 : 90;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.02 + rand() * 0.07})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  for (let i = 0; i < 120; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 6 + rand() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? "rgba(255,252,242,.22)" : "rgba(96,90,76,.14)");
    g.addColorStop(1, "rgba(140,132,116,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  void shades;
  return finish(c, true, 8);
}

/** 沙滩 / 浅滩：暖米色细沙 + 少量卵石 */
export function createSand(): THREE.Texture {
  const size = 512;
  const { c, ctx } = canvas(size, size);
  const rand = makeRandom(7717);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26000; i++) {
    const v = rand() > 0.62 ? 255 : 170;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rand() * 0.12})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2.2, 1 + rand() * 2.2);
  }
  for (let i = 0; i < 220; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 2 + rand() * 5;
    ctx.fillStyle = `rgba(${120 + rand() * 60},${115 + rand() * 55},${104 + rand() * 46},${0.16 + rand() * 0.24})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.5), rand() * 3.1, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 220; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 14 + rand() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rand() > 0.5 ? "rgba(255,246,220,.36)" : "rgba(176,160,128,.2)");
    g.addColorStop(1, "rgba(200,186,156,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return finish(c, true, 8);
}

/**
 * 木纹（近白，颜色交给顶点色）。
 * 桥、栅栏、起点木门、长椅共用这一张 —— 木质构件多，但只有 1 个 draw call。
 */
export function createWoodGrain(): THREE.Texture {
  const size = 256;
  const { c, ctx } = canvas(size, size);
  const rand = makeRandom(2718);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = rand() * size;
    const w = 1 + rand() * 4;
    const dark = 0.05 + rand() * 0.16;
    ctx.strokeStyle = rand() > 0.72 ? `rgba(70,44,26,${dark})` : `rgba(255,248,236,${dark})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, -6);
    let px = x;
    for (let y = 0; y <= size + 6; y += 26) {
      px += (rand() - 0.5) * 7;
      ctx.lineTo(px, y);
    }
    ctx.stroke();
  }
  // 木节
  for (let i = 0; i < 7; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 4 + rand() * 8;
    ctx.strokeStyle = `rgba(64,40,22,${0.12 + rand() * 0.16})`;
    ctx.lineWidth = 1.6 + rand() * 1.6;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 1.7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = `rgba(120,86,54,${0.02 + rand() * 0.05})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 1.6, 1 + rand() * 4);
  }
  return finish(c, true, 8);
}

/** 文字贴片（起点/终点横幅等） */
export function createLabel(text: string, sub: string, color: string, w = 512, h = 160): THREE.CanvasTexture {
  const { c, ctx } = canvas(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  roundRect(ctx, 6, 6, w - 12, h - 12, 22);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.22)";
  roundRect(ctx, 6, 6, w - 12, h * 0.48, 22);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${h * 0.42}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(text, w / 2, h * (sub ? 0.4 : 0.5));
  if (sub) {
    ctx.font = `700 ${h * 0.2}px "Helvetica Neue", Arial, sans-serif`;
    ctx.globalAlpha = 0.9;
    ctx.fillText(sub, w / 2, h * 0.75);
    ctx.globalAlpha = 1;
  }
  const t = finish(c, false, 8);
  return t;
}

export { roundRect, canvas, finish, darken as shadeDown };
