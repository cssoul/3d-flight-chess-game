/**
 * 主题与全局常量 —— 自有 IP《云顶都会 · SKYLINE RALLY》
 *
 * 视觉基调参照 SASAKI 式轴测微缩城市：纯白纸模体量 + 浅灰铺装 + 玻璃带 + 柔和阴影，
 * 但配色体系是本项目自有的「青碧 + 珊瑚橙」主色，棋盘色板也独立设计，不照抄任何现成棋类。
 */

export const BRAND = {
  title: "SKYLINE RALLY",
  titleCn: "云顶都会",
  tagline: "3D 飞行棋 · 一座会发光的微缩都会",
  primary: "#1FA2B8",
  primaryDeep: "#0E6E80",
  accent: "#FF7A59",
  ink: "#22303C",
  inkSoft: "#5B6B78",
} as const;

/** 世界尺度：1 单位 ≈ 1 米。层高 3.4、行道树 7.5，全部按这个参照系派生。 */
export const SCALE = {
  groundY: 0,
  boardTop: 0.2,
  tileH: 0.16,
  tileTop: 0.36,
  floorH: 3.4,
} as const;

/**
 * 棋盘格的种类。这里是「全场景共用的词汇表」—— 每张棋盘自己决定用哪些格、
 * 怎么排（见 scenes/），但格子的行为只由 kind 决定，规则内核因此不需要认识任何一张具体棋盘。
 */

export type TileKind =
  | "start"
  | "plain"
  | "forward"
  | "boost"
  | "dash"
  | "gift"
  | "quiz"
  | "barrier"
  | "ice"
  | "swap"
  | "shield"
  | "portal"
  /** 登顶航道：只出现在带「冲进中央」规则的场景里，无事件 */
  | "home";

export type IconName =
  | "none"
  | "arrow"
  | "star"
  | "bolt"
  | "gift"
  | "question"
  | "cone"
  | "snow"
  | "swap"
  | "shield"
  | "rocket"
  | "flag";

export interface TileStyle {
  /** 棋盘面上的主色（自有色板） */
  color: string;
  /** 图标 */
  icon: IconName;
  /** HUD 里显示的名字 */
  label: string;
  /** HUD 里的一句话说明 */
  desc: string;
  /** 落地时特效的主色（用于粒子/光环） */
  fx: string;
}

export const TILE_STYLE: Record<TileKind, TileStyle> = {
  start: {
    color: "#2E9BD6",
    icon: "none",
    label: "起点",
    desc: "环线发车，跑满一圈冲线。",
    fx: "#2E9BD6",
  },
  plain: {
    color: "#F1F4F6",
    icon: "none",
    label: "城区路面",
    desc: "什么都没发生，继续前进。",
    fx: "#C9D4DB",
  },
  forward: {
    color: "#55C6D6",
    icon: "arrow",
    label: "磁悬浮滑道",
    desc: "被滑道带着往前推 2 格。",
    fx: "#55C6D6",
  },
  boost: {
    color: "#86D48A",
    icon: "star",
    label: "星轨加速",
    desc: "接入星轨，直接前进 3 格。",
    fx: "#86D48A",
  },
  dash: {
    color: "#A48CF0",
    icon: "bolt",
    label: "疾风跑道",
    desc: "充能完毕，前进 1 格并再掷一次。",
    fx: "#A48CF0",
  },
  gift: {
    color: "#FF8A6B",
    icon: "gift",
    label: "无人机空投",
    desc: "随机补给：加速 / 护盾 / 再掷一次。",
    fx: "#FF8A6B",
  },
  quiz: {
    color: "#F3C24E",
    icon: "question",
    label: "都会事件",
    desc: "随机事件，福祸自担。",
    fx: "#F3C24E",
  },
  barrier: {
    color: "#7C8794",
    icon: "cone",
    label: "施工路段",
    desc: "被围挡拦下，退回 2 格。",
    fx: "#E0685A",
  },
  ice: {
    color: "#6FC3E8",
    icon: "snow",
    label: "信号中断",
    desc: "路由被冻结，暂停一回合。",
    fx: "#8FD8F5",
  },
  swap: {
    color: "#B47BE0",
    icon: "swap",
    label: "换乘枢纽",
    desc: "与随机对手互换位置。",
    fx: "#B47BE0",
  },
  shield: {
    color: "#5FD0A8",
    icon: "shield",
    label: "防护罩",
    desc: "获得一层护盾，抵挡一次负面事件。",
    fx: "#5FD0A8",
  },
  portal: {
    color: "#6F7BF0",
    icon: "rocket",
    label: "环线跃迁",
    desc: "穿过跃迁门，直接前进 5 格。",
    fx: "#6F7BF0",
  },
  home: {
    color: "#F2C14E",
    icon: "flag",
    label: "登顶航道",
    desc: "最后一程，直通中央终点。",
    fx: "#F2C14E",
  },
};

/**
 * 48 格的事件编排（索引 0 为 START）。节奏原则：
 * 前段密集给正反馈建立手感，中段掺入负面制造波折，末段（临近起点）难度回落，
 * 相邻格尽量避免连续负面。
 *
 * 注意：这里只是「云顶都会」这一张棋盘的编排，住在 scenes/city.ts 里。
 */
export interface CharacterPreset {
  id: string;
  name: string;
  en: string;
  color: string;
  deep: string;
  tagline: string;
}

/** 玩家角色（自有设定） */
export const CHARACTERS: CharacterPreset[] = [
  { id: "aero", name: "青隼", en: "AERO", color: "#2FBFD4", deep: "#0F7C93", tagline: "气流操控者 · 起步最快" },
  { id: "ember", name: "赤霄", en: "EMBER", color: "#FF7A59", deep: "#B9401F", tagline: "热浪驱动 · 后程爆发" },
  { id: "volt", name: "紫电", en: "VOLT", color: "#9B7BF0", deep: "#5B3FB0", tagline: "电磁跃迁 · 擅长变线" },
  { id: "sol", name: "金穗", en: "SOL", color: "#F2C14E", deep: "#B08011", tagline: "稳定供能 · 抗风险" },
];

export const TILE_KIND_LIST: TileKind[] = [
  "start", "plain", "forward", "boost", "dash", "gift",
  "quiz", "barrier", "ice", "swap", "shield", "portal",
  "home",
];
