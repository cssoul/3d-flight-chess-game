import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/*
 * 发布环境会把端口通过 PORT 注入，而且访问是从反向代理的域名进来的。
 * 这里不引 @types/node，所以从 globalThis 上取 process.env（类型上收成可选），
 * 拿不到就回落本地开发用的 5288。
 */
const injected = Number(
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.PORT,
);
const port = Number.isFinite(injected) && injected > 0 ? injected : 5288;

export default defineConfig({
  plugins: [vue()],
  server: {
    port,
    // 必须绑 0.0.0.0 并放行反向代理的 Host，否则 Vite 会以
    // "Blocked request. This host is not allowed." 拒掉线上访问
    host: "0.0.0.0",
    allowedHosts: true,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/three")) return "three";
          return undefined;
        },
      },
    },
  },
});
