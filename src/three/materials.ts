import * as THREE from "three";
import {
  canvas,
  createAsphalt,
  createConcrete,
  createCourt,
  createFlagstone,
  createGravel,
  createLawn,
  createParking,
  createSand,
  createSurfaceNoise,
  createWaterBump,
  createGlassNoise,
  createWoodGrain,
  finish,
} from "./textures";
import { makeRandom } from "./rng";
import type { TimePreset } from "./env";

/** 夜景窗户自发光贴图：大部分暗，只有少量亮格 */
function createWindowMap(seed = 77): THREE.Texture {
  const W = 256;
  const H = 256;
  const { c, ctx } = canvas(W, H);
  const rand = makeRandom(seed);
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, W, H);
  const rows = 8;
  const cols = 8;
  const cw = W / cols;
  const ch = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      if (rand() > 0.46) continue;
      const bright = 0.55 + rand() * 0.45;
      const warm = rand() > 0.25;
      ctx.fillStyle = warm
        ? `rgba(255,214,160,${bright})`
        : `rgba(198,224,255,${bright * 0.85})`;
      ctx.fillRect(col * cw + cw * 0.14, r * ch + ch * 0.2, cw * 0.72, ch * 0.56);
    }
  }
  // 楼板线
  ctx.fillStyle = "rgba(0,0,0,.85)";
  for (let r = 0; r < rows; r++) ctx.fillRect(0, r * ch, W, 2);
  return finish(c, true, 4);
}

export interface MaterialSet {
  surface: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  road: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  glassClear: THREE.MeshPhysicalMaterial;
  roof: THREE.MeshStandardMaterial;
  lawn: THREE.MeshStandardMaterial;
  water: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshStandardMaterial;
  court: THREE.MeshStandardMaterial;
  parking: THREE.MeshStandardMaterial;
  lampGlow: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  /* --- 浮岛场景（自然材质） --- */
  ocean: THREE.MeshPhysicalMaterial;
  sand: THREE.MeshStandardMaterial;
  flagstone: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
}

/** 程序化材质库。所有贴图都由 canvas 现场画出，工程内零图片资源。 */
export class MaterialLibrary implements MaterialSet {
  surface!: THREE.MeshStandardMaterial;
  concrete!: THREE.MeshStandardMaterial;
  ground!: THREE.MeshStandardMaterial;
  road!: THREE.MeshStandardMaterial;
  glass!: THREE.MeshPhysicalMaterial;
  glassClear!: THREE.MeshPhysicalMaterial;
  roof!: THREE.MeshStandardMaterial;
  lawn!: THREE.MeshStandardMaterial;
  water!: THREE.MeshPhysicalMaterial;
  metal!: THREE.MeshStandardMaterial;
  court!: THREE.MeshStandardMaterial;
  parking!: THREE.MeshStandardMaterial;
  lampGlow!: THREE.MeshStandardMaterial;
  accent!: THREE.MeshStandardMaterial;
  ocean!: THREE.MeshPhysicalMaterial;
  sand!: THREE.MeshStandardMaterial;
  flagstone!: THREE.MeshStandardMaterial;
  wood!: THREE.MeshStandardMaterial;
  rock!: THREE.MeshStandardMaterial;

  private disposables: (THREE.Material | THREE.Texture)[] = [];
  private windowMap: THREE.Texture;
  private glassNoise: THREE.Texture;
  private waterBump: THREE.Texture;
  /** 海面单独一张波纹贴图：repeat 和城里那条河的尺度差了一个数量级 */
  private oceanBump: THREE.Texture;

  constructor(renderer: THREE.WebGLRenderer) {
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const noiseA = createSurfaceNoise(101, 9000, 180, 1);
    const noiseB = createSurfaceNoise(202, 14000, 120, 0.7);
    const concreteTex = createConcrete();
    const asphalt = createAsphalt();
    const lawnTex = createLawn();
    const gravel = createGravel();
    const courtTex = createCourt();
    const parkingTex = createParking();
    this.windowMap = createWindowMap();
    this.glassNoise = createGlassNoise();
    this.waterBump = createWaterBump();
    this.oceanBump = createWaterBump();
    // 海面很大（四百多个单位的平板），波纹要密到看起来像一层微起伏才不像塑料板
    this.oceanBump.repeat.set(110, 110);
    const flagstoneTex = createFlagstone();
    const sandTex = createSand();
    const woodTex = createWoodGrain();
    for (const t of [noiseA, noiseB, concreteTex, asphalt, lawnTex, gravel, courtTex, parkingTex, this.windowMap, this.glassNoise, this.waterBump, this.oceanBump, flagstoneTex, sandTex, woodTex]) {
      t.anisotropy = aniso;
    }

    this.surface = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: noiseA,
      roughness: 0.92,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.32,
    });

    this.concrete = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: concreteTex,
      roughness: 0.93,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.3,
    });

    this.ground = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: noiseB,
      roughness: 0.96,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.22,
    });

    this.road = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphalt,
      roughness: 0.94,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.24,
    });

    // 不透明镜面玻璃：建筑尺度上这才是"镀膜玻璃"的正确读法，
    // 同时彻底绕开几百块玻璃扇的透明排序问题（见 skill 的 material-system）。
    this.glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.86,
      roughness: 0.065,
      envMapIntensity: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      vertexColors: true,
      emissive: new THREE.Color("#ffd8a4"),
      emissiveMap: this.windowMap,
      emissiveIntensity: 0,
    });

    // 大堂通透玻璃：数量很少，留着让室内暖光透出来
    this.glassClear = new THREE.MeshPhysicalMaterial({
      color: 0xdff0f6,
      metalness: 0.05,
      roughness: 0.05,
      transparent: true,
      opacity: 0.42,
      envMapIntensity: 1.3,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      vertexColors: true,
    });

    this.roof = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: gravel,
      roughness: 0.95,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.25,
    });

    this.lawn = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: lawnTex,
      roughness: 0.95,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.2,
    });

    this.water = new THREE.MeshPhysicalMaterial({
      color: 0x9ad6e2,
      roughness: 0.09,
      metalness: 0.14,
      envMapIntensity: 0.75,
      bumpMap: this.waterBump,
      bumpScale: 0.035,
      vertexColors: true,
    });

    this.metal = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.34,
      metalness: 0.8,
      vertexColors: true,
      envMapIntensity: 1.0,
    });

    this.court = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: courtTex,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.25,
    });

    this.parking = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: parkingTex,
      roughness: 0.93,
      metalness: 0,
      envMapIntensity: 0.25,
    });

    this.lampGlow = new THREE.MeshStandardMaterial({
      color: 0x8a8478,
      roughness: 0.5,
      metalness: 0,
      emissive: new THREE.Color("#ffdca8"),
      emissiveIntensity: 0,
    });

    this.accent = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.1,
      vertexColors: true,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 0,
      envMapIntensity: 0.7,
    });

    /* ---------- 浮岛场景的自然材质 ---------- */

    // 海面：比城里的人工水更清透，靠环境反射出天光
    this.ocean = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.075,
      metalness: 0.12,
      envMapIntensity: 0.95,
      bumpMap: this.oceanBump,
      bumpScale: 0.02,
      vertexColors: true,
    });

    this.sand = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: sandTex,
      roughness: 0.95,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.2,
    });

    // 石板路 / 石台 / 石灯笼：园林铺地的骨料
    this.flagstone = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: flagstoneTex,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.26,
    });

    this.wood = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: woodTex,
      roughness: 0.82,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.24,
    });

    this.rock = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: noiseB,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.24,
    });

    this.disposables = [
      noiseA, noiseB, concreteTex, asphalt, lawnTex, gravel, courtTex, parkingTex,
      this.surface, this.concrete, this.ground, this.road, this.glass, this.glassClear,
      this.roof, this.lawn, this.water, this.metal, this.court, this.parking,
      this.lampGlow, this.accent,
      this.ocean, this.sand, this.flagstone, this.wood, this.rock,
    ];
  }

  /** 切换时辰：只改标量与贴图色，不重建任何几何 */
  apply(preset: TimePreset) {
    const night = preset.time === "night";
    this.glass.emissiveIntensity = preset.windowEmit;
    this.glass.envMapIntensity = night ? 0.85 : 1.5;
    this.lampGlow.emissiveIntensity = preset.lampEmit;
    this.water.color.set(preset.waterTint);
    this.ground.color.set(night ? "#8b9db4" : "#ffffff");
    this.court.color.set(night ? "#5a6a72" : "#ffffff");
    this.parking.color.set(night ? "#7a8492" : "#ffffff");
    this.lawn.color.set(night ? "#5c6f7a" : "#ffffff");

    // 海面：浅滩→浅水→深海的三段色相渐变已经烘在海面的顶点色里了（见 islandSurround），
    // 所以材质色这里只负责"整体明暗"—— 白天几乎放白，让渐变全权决定水色；
    // 夜里往 preset 的水色压下去，免得夜海泛荧光。
    this.ocean.color.set(preset.waterTint).lerp(new THREE.Color("#ffffff"), night ? 0.32 : 0.86);
    this.ocean.envMapIntensity = night ? 0.34 : 0.6;
    this.sand.color.set(night ? "#9c9aa4" : "#ffffff");
    this.flagstone.color.set(night ? "#9aa2ab" : "#ffffff");
    this.wood.color.set(night ? "#8f8a90" : "#ffffff");
    this.rock.color.set(night ? "#8b9db4" : "#ffffff");
    // 铺石只用在浮岛（石板小路、湖沿、丘陵土坎、中央石台）。夜里石材没有一丝自发光，
    // 中央那座"登顶"石台会整个陷进黑里 —— 给一层月光返照，路和台面才留着轮廓。
    // 强度取地块(0.2)的一半：石头该有轮廓，但不该像灯箱一样亮。
    this.flagstone.emissive.set(night ? "#4a4e56" : "#000000");
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.windowMap.dispose();
    this.glassNoise.dispose();
    this.waterBump.dispose();
    this.oceanBump.dispose();
  }
}
