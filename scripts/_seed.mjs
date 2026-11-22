// 探针/截图共用的账号种子：递进解锁上线后，难度≥4 的图要前置通关或课系 6 星。
// 给测试浏览器档案预置三系课程各 6 星 → 全图解锁。只写 localStorage，不碰真实账号。
export async function seedUnlock(ctx) {
  await ctx.addInitScript(() => {
    try {
      const d = JSON.parse(localStorage.getItem('fundive.v1') || '{}');
      d.courses = { ...(d.courses || {}), aow: { _s: { stars: 6 } }, ocn: { _s: { stars: 6 } }, mil: { _s: { stars: 6 } } };
      localStorage.setItem('fundive.v1', JSON.stringify(d));
    } catch { }
  });
}
