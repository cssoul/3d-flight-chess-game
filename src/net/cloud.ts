import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import { PUBLIC_CONFIG } from "./config";

/**
 * 全局唯一的云服务客户端。四个模块（auth / database / storage / llm）共用这一个实例，
 * 不要再 createWorkBuddyCloud 第二次，也不要手写 fetch 去打 /.cloud/**。
 *
 * endpoint 显式传入（而不是依赖 SDK 的「同源回落」）：本地 dev server 跑在 :5288、
 * 数据面在发布域名上，两者不同源；显式传入是本地联调和线上发布都成立的那一种写法。
 */
export const cloud = createWorkBuddyCloud({
  endpoint: PUBLIC_CONFIG.endpoint,
  oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
  publishableKey: PUBLIC_CONFIG.publishableKey,
});

export interface Envelope<T> {
  data: T;
  error: unknown;
}

/**
 * `cloud.database.rpc()` 返回的是 PostgREST 的链式构造器（thenable，不是 Promise），
 * 这里统一收成一个可 await 的形状，调用点就不用每处都断言了。
 */
export function rpc<T>(fn: string, args?: Record<string, unknown>): PromiseLike<Envelope<T>> {
  return (cloud.database as unknown as {
    rpc: (f: string, a?: Record<string, unknown>) => PromiseLike<Envelope<T>>;
  }).rpc(fn, args);
}
