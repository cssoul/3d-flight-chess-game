import type { SceneDef } from "../../game/scenes/types";
import type { MaterialLibrary } from "../materials";
import { City } from "../city";
import { IslandSurround } from "./islandSurround";
import type { SurroundView } from "./types";

export type { SurroundView } from "./types";

/**
 * 按场景造「棋盘之外那一层」。
 * 城市外面是微缩都会（City 本身就满足 SurroundView，不用包装），浮岛外面是一整片海。
 */
export function createSurround(def: SceneDef, mats: MaterialLibrary): SurroundView {
  switch (def.id) {
    case "island":
      return new IslandSurround(mats, def);
    case "city":
    default:
      return new City(mats);
  }
}
