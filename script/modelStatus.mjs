/**
 * 模型状态名单：推荐（recommended）与作废（retired）。
 *
 * 作废模型不进排行榜：注册表跳过（也不进「未参评」区），历史对局不计分，只按计数留痕。
 * 名单镜像 rl/docs/MODELS_NOTES.md「模型状态总表」，两处需人工同步维护。
 *
 * 本文件是模型状态名单的唯一事实来源，JS 脚本（榜单/统计）与测试从这里读取；
 * 不要再在别处写死版本名单。
 */
export const MODEL_STATUS_BY_VERSION = {
  'v3.0.3': 'recommended',
  'v2.1.1': 'retired',
  'v2.1.4': 'retired',
  'v2.1.5': 'retired',
  'v2.1.6': 'retired',
  'v2.1.8': 'retired',
};

export const RETIRED_VERSIONS = new Set(
  Object.entries(MODEL_STATUS_BY_VERSION)
    .filter(([, status]) => status === 'retired')
    .map(([version]) => version),
);
