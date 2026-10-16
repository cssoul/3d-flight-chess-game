/**
 * 场景注册表。
 *
 * 这里是「有哪些棋盘」的唯一入口：UI 从 SCENE_LIST 渲染选择卡，
 * 引擎 / 渲染统一从 activeScene 取当前棋盘。新增一个场景 = 在 scenes/ 下加一个文件，
 * 然后挂进 SCENE_LIST，其它地方一行都不用改。
 */

import { shallowRef } from "vue";
import { cityScene } from "./city";
import { islandScene } from "./island";
import type { SceneDef, SceneId } from "./types";

export const SCENE_LIST: SceneDef[] = [cityScene, islandScene];

const BY_ID: Record<string, SceneDef> = Object.fromEntries(SCENE_LIST.map((s) => [s.id, s]));

const STORE_KEY = "sr.scene";

export function sceneById(id: string | null | undefined): SceneDef | undefined {
  return id ? BY_ID[id] : undefined;
}

function initial(): SceneDef {
  try {
    return sceneById(localStorage.getItem(STORE_KEY)) ?? SCENE_LIST[0];
  } catch {
    return SCENE_LIST[0];
  }
}

/** 当前棋盘。响应式，UI 直接读 activeScene.value 即可。 */
export const activeScene = shallowRef<SceneDef>(initial());

/**
 * 切换棋盘。persist = false 用于「跟着房间走」的场合（看客由房主决定棋盘，
 * 不该顺手把主人自己选的棋盘覆盖掉）；返回真正生效的那个场景。
 */
export function setScene(id: string | null | undefined, persist = true): SceneDef {
  const def = sceneById(id);
  if (def && def !== activeScene.value) activeScene.value = def;
  if (persist) {
    try {
      localStorage.setItem(STORE_KEY, activeScene.value.id);
    } catch {
      /* 隐私模式下写不进去，忽略 */
    }
  }
  return activeScene.value;
}

export function getScene(): SceneDef {
  return activeScene.value;
}

export type { SceneDef, SceneId };
