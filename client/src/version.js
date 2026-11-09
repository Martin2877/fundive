// 版本信息：构建期由 vite.config.js 注入（根 package.json version + channel + git sha）。
// channel: 'stable' | 'preview' | 'dev'。stableUrl/previewUrl 是两套部署的互跳地址，
// 未配置时通道切换按钮禁用（本地 dev 永远不跳）。
export const VERSION = {
  ver: import.meta.env.VITE_APP_VERSION || '0.0.0',
  channel: import.meta.env.VITE_CHANNEL || 'dev',
  sha: import.meta.env.VITE_COMMIT || '',
  stableUrl: (import.meta.env.VITE_STABLE_URL || '').replace(/\/$/, ''),
  previewUrl: (import.meta.env.VITE_PREVIEW_URL || '').replace(/\/$/, ''),
};

export const channelKey = () => (VERSION.channel === 'preview' ? '预览版' : VERSION.channel === 'stable' ? '稳定版' : '开发版');
export const versionLabel = () => `v${VERSION.ver}${VERSION.channel === 'preview' ? '-preview' : ''}`;

// 通道偏好 -> 目标部署地址；本机 dev / 目标未配 / 已在正确通道时返回 null。
export function channelUrl(want) {
  if (VERSION.channel === 'dev') return null;
  const url = want === 'preview' ? VERSION.previewUrl : VERSION.stableUrl;
  return (url && url !== location.origin) ? url : null;
}
