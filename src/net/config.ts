/**
 * 云服务 publicConfig —— 开通云服务环境时由平台下发的四个公开值，原样搬进前端。
 *
 * 为什么是「搬进来」而不是运行时再取：这是个纯静态站点，浏览器里没有别的来源能拿到它。
 * 其中 publishableKey 只标识「这是哪个应用」、本身不带任何权限；真正的安全边界是
 * 服务端对请求 Origin 的精确匹配 —— 只有从下面这个 endpoint 域名打开页面才发得出去请求。
 * 所以 endpoint 必须原样使用：不能猜、不能从 location 推导、也不能换成别的域名，
 * 一旦换域名，云服务会直接拒绝，建房 / 加入 / 轮询会全部失败。
 *
 * 该域名与应用的 applicationId 绑定，重新发布时复用同一个 applicationId 就能保住它。
 */
export const PUBLIC_CONFIG = {
  resourceId: "wbcs_Y4kf6qcv7pfJ2Nx2XF2aGV",
  endpoint: "https://skyline-rally.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/genie-baas/oauth",
  publishableKey: "wbpk_N7hsr7ZHwrkFZCgOzB5pnR_Vm4aqrPjHIpkjxcvRtd927MbgEtWRr5Y",
} as const;
