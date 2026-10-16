import type { SceneDef } from "../../game/scenes/types";
import type { MaterialLibrary } from "../materials";
import { CityBoard } from "./cityBoard";
import { IslandBoard } from "./islandBoard";
import type { BoardView } from "./types";

export type { BoardView } from "./types";
export { collectCells, slotOffset, pawnProfile, TileLayer } from "./shared";

/**
 * 按场景造棋盘视图。
 * 新增场景时在这里加一条分支即可 —— 场景总控（SceneManager）永远只拿到一个 BoardView。
 */
export function createBoard(def: SceneDef, mats: MaterialLibrary): BoardView {
  switch (def.id) {
    case "island":
      return new IslandBoard(mats, def);
    case "city":
    default:
      return new CityBoard(mats, def);
  }
}
