import { GameEngine } from "../game/engine";
import { COLOR_MAP } from "../game/director";
import { CHARACTERS } from "../game/theme";
import type { SceneDef } from "../game/scenes/types";
import type { PlayerSetup } from "../game/types";
import type { GameDoc, RoomRow } from "./types";

export const MAX_SEATS = 4;

/**
 * 把房间座位翻译成开局阵容。
 * 在线对局固定满 4 人：座位不够的位置由电脑补上，否则两个人开局的话
 * 大半张棋盘会空着，事件格互相碰不到，玩起来就不像飞行棋了。
 */
export function setupsFromSeats(room: RoomRow): PlayerSetup[] {
  // 角色必须互斥：两个人顶着同一个颜色在盘上跑，谁是谁根本分不清。
  // 座位自选优先，撞车就顺延到还没人拿的角色。
  const used = new Set<string>();
  const take = (want: string, i: number): string => {
    if (want && !used.has(want)) {
      used.add(want);
      return want;
    }
    const free = CHARACTERS.find((c) => !used.has(c.id));
    const id = free ? free.id : CHARACTERS[i % CHARACTERS.length].id;
    used.add(id);
    return id;
  };

  const setups: PlayerSetup[] = room.seats.slice(0, MAX_SEATS).map((s, i) => ({
    id: i,
    name: s.name || `玩家${i + 1}`,
    charId: take(s.charId, i),
    isAI: false,
  }));

  for (let i = setups.length; i < MAX_SEATS; i++) {
    const c = CHARACTERS.find((x) => !used.has(x.id)) ?? CHARACTERS[i % CHARACTERS.length];
    used.add(c.id);
    setups.push({ id: i, name: `${c.name} AI`, charId: c.id, isAI: true });
  }
  return setups;
}

/** 房主开局时写进房间的初始棋局 */
export function newGameDoc(setups: PlayerSetup[], scene: SceneDef): GameDoc {
  const engine = new GameEngine(setups, COLOR_MAP, scene);
  return {
    setups,
    scene: scene.id,
    turn: 0,
    round: 1,
    plays: 0,
    phase: "playing",
    players: engine.players.map((p) => ({ ...p })),
    winner: -1,
    hist: [],
  };
}
