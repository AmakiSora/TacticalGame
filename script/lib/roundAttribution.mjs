/**
 * 回合归属重建工具 —— 兼容存量回放（修复 C3/C5）。
 *
 * 背景：标准/歼灭模式的历史回放中，行动事件（attack / move / deploy / heal /
 * demolish / income / unit_death 等）的 payload 不携带 roundNumber，导致任何
 * "按回合"聚合都会把无法归属的事件堆到 R0（实测 V2 全部 1827 次攻击落 R0）。
 *
 * 引擎侧已根治（appendEvent 自动注入 roundNumber），但存量回放仍需重建。
 * 本模块提供三级归属策略：
 *   1. payload.roundNumber 存在 → 直接采用（新回放 & simultaneous 老回放）
 *   2. round_end 事件为锚 → 其 roundNumber 即刚结束的回合，之后事件归入下一回合
 *   3. 其余事件 → 顺推当前回合计数器
 *
 * 用法：
 *   import { attributeRounds } from './lib/roundAttribution.mjs';
 *   const attributed = attributeRounds(replay.events);
 *   // attributed[i].round 即该事件所属回合（1-based），null 表示无法归属
 */

/**
 * @typedef {Object} AttributedEvent
 * @property {number} seq - 原始事件序号
 * @property {string} type - 事件类型
 * @property {number|null} round - 归属回合（1-based），null 表示无法归属
 * @property {'payload'|'anchor'|'carry'|'none'} source - 归属来源
 * @property {Object} payload - 原始 payload
 */

/**
 * 对事件流逐条重建回合归属。
 *
 * @param {Array<{seq?: number, type: string, payload?: Object}>} events
 * @returns {AttributedEvent[]}
 */
export function attributeRounds(events) {
  if (!Array.isArray(events)) return [];

  /** @type {AttributedEvent[]} */
  const result = [];
  let currentRound = 1;
  let anchored = false; // 是否已经遇到过至少一个 round_end / round_start 锚点

  for (const ev of events) {
    const type = ev?.type;
    const payload = ev?.payload || {};
    const rn = typeof payload.roundNumber === 'number' && Number.isFinite(payload.roundNumber)
      ? payload.roundNumber
      : undefined;

    /** @type {number|null} */
    let attributedRound;
    /** @type {'payload'|'anchor'|'carry'|'none'} */
    let source;

    if (type === 'round_end') {
      // round_end 携带的是"刚结束"的回合号；事件本身归该回合，之后计数器 +1。
      attributedRound = rn ?? currentRound;
      source = rn !== undefined ? 'payload' : (anchored ? 'carry' : 'none');
      currentRound = attributedRound + 1;
      anchored = true;
    } else if (type === 'round_start') {
      // round_start 携带的是"新开始"的回合号。
      attributedRound = rn ?? currentRound;
      source = rn !== undefined ? 'payload' : (anchored ? 'carry' : 'none');
      currentRound = attributedRound;
      anchored = true;
    } else if (rn !== undefined) {
      // payload 显式携带 roundNumber：直接采用，但不回退 currentRound
      // （防止 round_resolved / comeback_supply 等携带旧回合号的事件把计数器拉回去）。
      attributedRound = rn;
      source = 'payload';
      if (rn >= currentRound) currentRound = rn;
    } else if (anchored) {
      // 无 roundNumber 但已有锚点：顺推当前回合。
      attributedRound = currentRound;
      source = 'carry';
    } else {
      // 无 roundNumber 且无任何锚点（理论上只出现在 game_start 之前）：归入 R1。
      attributedRound = currentRound;
      source = 'none';
    }

    result.push({
      seq: typeof ev?.seq === 'number' ? ev.seq : result.length + 1,
      type,
      round: attributedRound,
      source,
      payload,
    });
  }

  return result;
}

/**
 * 按回合聚合事件计数。返回 Map<round, {total, byType: Map<type, count>}>。
 *
 * @param {Array<{seq?: number, type: string, payload?: Object}>} events
 * @returns {Map<number, {total: number, byType: Map<string, number>}>}
 */
export function tallyByRound(events) {
  const attributed = attributeRounds(events);
  /** @type {Map<number, {total: number, byType: Map<string, number>}>} */
  const buckets = new Map();
  for (const ev of attributed) {
    if (ev.round == null) continue;
    if (!buckets.has(ev.round)) buckets.set(ev.round, { total: 0, byType: new Map() });
    const bucket = buckets.get(ev.round);
    bucket.total += 1;
    bucket.byType.set(ev.type, (bucket.byType.get(ev.type) || 0) + 1);
  }
  return buckets;
}

/**
 * 统计无法归属（source === 'none'）的事件占比，用于页面标注数据可信度。
 *
 * @param {Array<{seq?: number, type: string, payload?: Object}>} events
 * @returns {{total: number, unattributed: number, ratio: number}}
 */
export function attributionCoverage(events) {
  const attributed = attributeRounds(events);
  const unattributed = attributed.filter(e => e.source === 'none').length;
  return {
    total: attributed.length,
    unattributed,
    ratio: attributed.length > 0 ? unattributed / attributed.length : 0,
  };
}
