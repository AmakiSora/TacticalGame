// public/random-map-ui.js
// 随机地图创建面板：桌面端与移动端共用。参数支持「随机区间 / 固定值 / 留空用服务端默认」三种填法。
import './error-text.js';

(function () {
  'use strict';

  const RANDOM_MAP_ID = 'random';

  // 模式相关的参数适配：条目不带 modes 字段＝全模式适用。
  // 歼灭系（annihilation/royale）不建总部（src/state/store.ts 按 isAnnihilationMode 分支），
  // 故总部参数无意义；炮火（annihilation.artillery）只在歼灭系注入，故其余模式无此参数。
  const ARTILLERY_MODES = ['annihilation', 'royale'];
  const HEADQUARTERS_MODES = ['standard', 'simultaneous'];

  // min/max = 服务端硬边界（src/config/randomMap.ts 的 PARAM_BOUNDS，数字输入量程），
  // defMin/defMax = 留空时服务端使用的默认区间（仅作提示与"默认态"回显；兵种权重默认是
  // 标量 2/2/1/1、战斗波动默认固定 3/6、兵种属性默认围绕基准值抖动，这些行 defMin=defMax
  // 或不完全等于抖动区间，均只作提示）。两份数值由 tests/public/random-map-ui.test.ts 对齐校验，避免前后端漂移。
  const PARAMS = [
    { key: 'radius', label: '地图半径', step: 1, min: 4, max: 12, defMin: 5, defMax: 10, group: 'map' },
    { key: 'waterDensity', label: '水域密度', step: 0.01, min: 0, max: 0.4, defMin: 0.01, defMax: 0.07, group: 'map' },
    { key: 'wallDensity', label: '阻挡密度', step: 0.01, min: 0, max: 0.4, defMin: 0.01, defMax: 0.05, group: 'map' },
    { key: 'controlPointCount', label: '据点数量', step: 1, min: 1, max: 24, defMin: 2, defMax: 6, group: 'map' },
    { key: 'maxTurns', label: '最大回合数', step: 1, min: 1, max: 99, defMin: 10, defMax: 30, group: 'economy' },
    { key: 'actionsPerTurn', label: '每回合行动点', step: 1, min: 1, max: 20, defMin: 1, defMax: 8, group: 'economy' },
    { key: 'startingSupplies', label: '初始补给', step: 5, min: 0, max: 9999, defMin: 20, defMax: 220, group: 'economy' },
    { key: 'baseIncome', label: '基础收入', step: 1, min: 0, max: 999, defMin: 6, defMax: 14, group: 'economy' },
    // 经济：三类据点的每回合收入（前哨部署折扣 8、维修站修复量 10 仍固定，不开放）。
    { key: 'supplyIncome', label: '补给站收入', step: 1, min: 0, max: 40, defMin: 8, defMax: 20, group: 'economy' },
    { key: 'forwardBaseIncome', label: '前哨基地收入', step: 1, min: 0, max: 20, defMin: 0, defMax: 8, group: 'economy' },
    { key: 'repairIncome', label: '维修站收入', step: 1, min: 0, max: 20, defMin: 0, defMax: 8, group: 'economy' },
    // 部署与修复的经济旋钮：留空＝旧基准（前哨折扣 8、维修量 10）。
    { key: 'forwardBaseDeployDiscount', label: '前哨部署折扣', step: 1, min: 0, max: 20, defMin: 8, defMax: 8, group: 'economy', defaultMode: 'fixed' },
    { key: 'repairPointRepairAmount', label: '维修站修复量', step: 1, min: 0, max: 50, defMin: 10, defMax: 10, group: 'economy', defaultMode: 'fixed' },
    // 追赶补给：落后头名 ≥分差比例 的玩家每回合 +补给量；三项都给默认值时整块才注入。
    { key: 'comebackStartRound', label: '追赶起始轮', step: 1, min: 1, max: 20, defMin: 4, defMax: 4, group: 'economy' },
    { key: 'comebackScoreGapPercent', label: '追赶分差%', step: 1, min: 0, max: 100, defMin: 30, defMax: 30, group: 'economy' },
    { key: 'comebackAmountPerRound', label: '追赶补给量', step: 1, min: 1, max: 100, defMin: 14, defMax: 14, group: 'economy' },
    { key: 'startingUnitCount', label: '初始单位数', step: 1, min: 0, max: 6, defMin: 0, defMax: 4, group: 'army' },
    // 初始兵种权重（相对权重，0-10；留空＝默认 2/2/1/1；全 0 回退旧均匀池）。support 不设权重。
    { key: 'startingWeightInfantry', label: '步兵权重', step: 0.5, min: 0, max: 10, defMin: 2, defMax: 2, group: 'army', defaultMode: 'fixed' },
    { key: 'startingWeightScout', label: '侦察兵权重', step: 0.5, min: 0, max: 10, defMin: 2, defMax: 2, group: 'army', defaultMode: 'fixed' },
    { key: 'startingWeightHeavy', label: '重装权重', step: 0.5, min: 0, max: 10, defMin: 1, defMax: 1, group: 'army', defaultMode: 'fixed' },
    { key: 'startingWeightRanger', label: '远程兵权重', step: 0.5, min: 0, max: 10, defMin: 1, defMax: 1, group: 'army', defaultMode: 'fixed' },
    // 兵种属性（按兵种覆盖）：标量＝精确值、区间＝区间内随机；留空＝围绕基准值按兵种数值浮动抖动。
    // 两方共用同一套数值，改动对双方同时生效。组内按兵种分小标题。
    { key: 'unitStatVariation', label: '兵种数值浮动', step: 0.05, min: 0, max: 0.5, defMin: 0, defMax: 0.25, group: 'stats' },
    { key: 'infantryHp', label: '步兵血量', step: 1, min: 10, max: 999, defMin: 100, defMax: 100, group: 'stats', subgroup: '步兵' },
    { key: 'infantryAttack', label: '步兵攻击', step: 1, min: 1, max: 200, defMin: 30, defMax: 30, group: 'stats', subgroup: '步兵' },
    { key: 'infantryDefense', label: '步兵防御', step: 1, min: 0, max: 99, defMin: 8, defMax: 8, group: 'stats', subgroup: '步兵' },
    { key: 'infantryMoveRange', label: '步兵移动力', step: 1, min: 1, max: 10, defMin: 3, defMax: 3, group: 'stats', subgroup: '步兵' },
    { key: 'infantryAttackRange', label: '步兵射程', step: 1, min: 1, max: 10, defMin: 1, defMax: 1, group: 'stats', subgroup: '步兵' },
    { key: 'infantryCost', label: '步兵造价', step: 1, min: 5, max: 999, defMin: 45, defMax: 45, group: 'stats', subgroup: '步兵' },
    { key: 'scoutHp', label: '侦察兵血量', step: 1, min: 10, max: 999, defMin: 65, defMax: 65, group: 'stats', subgroup: '侦察兵' },
    { key: 'scoutAttack', label: '侦察兵攻击', step: 1, min: 1, max: 200, defMin: 16, defMax: 16, group: 'stats', subgroup: '侦察兵' },
    { key: 'scoutDefense', label: '侦察兵防御', step: 1, min: 0, max: 99, defMin: 4, defMax: 4, group: 'stats', subgroup: '侦察兵' },
    { key: 'scoutMoveRange', label: '侦察兵移动力', step: 1, min: 1, max: 10, defMin: 5, defMax: 5, group: 'stats', subgroup: '侦察兵' },
    { key: 'scoutAttackRange', label: '侦察兵射程', step: 1, min: 1, max: 10, defMin: 1, defMax: 1, group: 'stats', subgroup: '侦察兵' },
    { key: 'scoutCost', label: '侦察兵造价', step: 1, min: 5, max: 999, defMin: 38, defMax: 38, group: 'stats', subgroup: '侦察兵' },
    { key: 'heavyHp', label: '重装血量', step: 1, min: 10, max: 999, defMin: 150, defMax: 150, group: 'stats', subgroup: '重装' },
    { key: 'heavyAttack', label: '重装攻击', step: 1, min: 1, max: 200, defMin: 38, defMax: 38, group: 'stats', subgroup: '重装' },
    { key: 'heavyDefense', label: '重装防御', step: 1, min: 0, max: 99, defMin: 13, defMax: 13, group: 'stats', subgroup: '重装' },
    { key: 'heavyMoveRange', label: '重装移动力', step: 1, min: 1, max: 10, defMin: 2, defMax: 2, group: 'stats', subgroup: '重装' },
    { key: 'heavyAttackRange', label: '重装射程', step: 1, min: 1, max: 10, defMin: 1, defMax: 1, group: 'stats', subgroup: '重装' },
    { key: 'heavyCost', label: '重装造价', step: 1, min: 5, max: 999, defMin: 92, defMax: 92, group: 'stats', subgroup: '重装' },
    { key: 'rangerHp', label: '远程兵血量', step: 1, min: 10, max: 999, defMin: 72, defMax: 72, group: 'stats', subgroup: '远程兵' },
    { key: 'rangerAttack', label: '远程兵攻击', step: 1, min: 1, max: 200, defMin: 44, defMax: 44, group: 'stats', subgroup: '远程兵' },
    { key: 'rangerDefense', label: '远程兵防御', step: 1, min: 0, max: 99, defMin: 3, defMax: 3, group: 'stats', subgroup: '远程兵' },
    { key: 'rangerMoveRange', label: '远程兵移动力', step: 1, min: 1, max: 10, defMin: 2, defMax: 2, group: 'stats', subgroup: '远程兵' },
    { key: 'rangerAttackRange', label: '远程兵射程', step: 1, min: 1, max: 10, defMin: 3, defMax: 3, group: 'stats', subgroup: '远程兵' },
    { key: 'rangerCost', label: '远程兵造价', step: 1, min: 5, max: 999, defMin: 78, defMax: 78, group: 'stats', subgroup: '远程兵' },
    { key: 'supportHp', label: '辅助血量', step: 1, min: 10, max: 999, defMin: 82, defMax: 82, group: 'stats', subgroup: '辅助' },
    { key: 'supportAttack', label: '辅助攻击', step: 1, min: 1, max: 200, defMin: 10, defMax: 10, group: 'stats', subgroup: '辅助' },
    { key: 'supportDefense', label: '辅助防御', step: 1, min: 0, max: 99, defMin: 5, defMax: 5, group: 'stats', subgroup: '辅助' },
    { key: 'supportMoveRange', label: '辅助移动力', step: 1, min: 1, max: 10, defMin: 3, defMax: 3, group: 'stats', subgroup: '辅助' },
    { key: 'supportAttackRange', label: '辅助射程', step: 1, min: 1, max: 10, defMin: 1, defMax: 1, group: 'stats', subgroup: '辅助' },
    { key: 'supportCost', label: '辅助造价', step: 1, min: 5, max: 999, defMin: 60, defMax: 60, group: 'stats', subgroup: '辅助' },
    { key: 'supportHealPower', label: '辅助治疗量', step: 1, min: 0, max: 99, defMin: 22, defMax: 22, group: 'stats', subgroup: '辅助' },
    { key: 'supportHealRange', label: '辅助治疗射程', step: 1, min: 1, max: 10, defMin: 1, defMax: 1, group: 'stats', subgroup: '辅助' },
    // 战斗波动（省略＝固定 3/6）与裁决计分（只开放军队价值权重，补给恒 0）。
    { key: 'damageVarianceRange', label: '伤害波动幅度', step: 1, min: 0, max: 8, defMin: 3, defMax: 3, group: 'combat', defaultMode: 'fixed', warnRandom: '随机区间会盖过兵种攻击差，建议保持固定' },
    { key: 'healVarianceRange', label: '治疗波动幅度', step: 1, min: 0, max: 10, defMin: 6, defMax: 6, group: 'combat', defaultMode: 'fixed', warnRandom: '随机区间会放大治疗波动，建议保持固定' },
    { key: 'minimumDamage', label: '最低伤害', step: 1, min: 0, max: 3, defMin: 1, defMax: 1, group: 'combat', defaultMode: 'fixed', warnRandom: '随机区间会抹平兵种攻击差，建议保持固定' },
    { key: 'adjudicationArmyValue', label: '裁决军队分权重', step: 1, min: 0, max: 10, defMin: 1, defMax: 2, group: 'combat' },
    { key: 'adjudicationKillValue', label: '裁决击杀权重', step: 0.05, min: 0, max: 2, defMin: 0.25, defMax: 0.5, group: 'combat' },
    { key: 'adjudicationControlPointFlowRatio', label: '据点流量占比', step: 0.05, min: 0, max: 1, defMin: 0.7, defMax: 0.7, group: 'combat' },
    { key: 'headquartersHp', label: '总部血量', step: 10, min: 1, max: 9999, defMin: 80, defMax: 240, group: 'headquarters', modes: HEADQUARTERS_MODES },
    { key: 'headquartersDefense', label: '总部防御', step: 1, min: 0, max: 99, defMin: 3, defMax: 10, group: 'headquarters', modes: HEADQUARTERS_MODES },
    { key: 'artilleryStartRound', label: '炮击开始回合', step: 1, min: 1, max: 10, defMin: 3, defMax: 8, group: 'artillery', modes: ARTILLERY_MODES },
    { key: 'artilleryIntervalRounds', label: '炮击间隔', step: 1, min: 1, max: 3, defMin: 1, defMax: 2, group: 'artillery', modes: ARTILLERY_MODES },
    { key: 'artilleryDamage', label: '炮击伤害', step: 1, min: 5, max: 30, defMin: 10, defMax: 25, group: 'artillery', modes: ARTILLERY_MODES },
    { key: 'artilleryMinimumSafeRadius', label: '安全区最小半径', step: 1, min: 0, max: 3, defMin: 0, defMax: 1, group: 'artillery', modes: ARTILLERY_MODES },
  ];

  // 折叠块分组：顺序即面板显示顺序；组与参数的 modes 同源（整组随参数自动显隐，不留空标题）。
  // defaultOpen 只决定首屏展开态——32 项的「兵种属性」默认收起，其余常用组展开。
  // 折叠只是视图状态：收起组里的参数照常提交，不影响预览与建局。
  const GROUPS = [
    { key: 'map', label: '地图与据点', defaultOpen: true },
    { key: 'economy', label: '对局与经济', defaultOpen: true },
    { key: 'army', label: '初始军队', defaultOpen: true },
    { key: 'stats', label: '兵种属性', defaultOpen: false },
    { key: 'combat', label: '战斗与裁决', defaultOpen: true },
    { key: 'headquarters', label: '总部', defaultOpen: true },
    { key: 'artillery', label: '炮火', defaultOpen: true },
  ];

  /** 某分组下的参数（顺序与 PARAMS 一致）。 */
  function groupParams(groupKey) {
    return PARAMS.filter(param => param.group === groupKey);
  }

  // 布尔开关（非数字参数）：与数字参数同卡片样式，单独一行渲染；collect 只在偏离默认值时提交。
  const TOGGLES = [
    {
      key: 'deployFromHq', label: '允许总部部署', group: 'economy', default: true,
      hint: '关闭后只能从已占领的据点出兵',
    },
    {
      key: 'supplyCanDeploy', label: '补给站可部署', group: 'economy', default: true,
      hint: '关闭后补给站不能作为部署起点',
    },
    {
      key: 'forwardBaseCanDeploy', label: '前哨可部署', group: 'economy', default: true,
      hint: '关闭后前哨基地不能作为部署起点',
    },
    {
      key: 'repairCanDeploy', label: '维修站可部署', group: 'economy', default: true,
      hint: '关闭后维修站不能作为部署起点',
    },
    {
      key: 'noTurnLimit', label: '无回合上限', group: 'economy', default: false,
      hint: '开启后忽略最大回合数，靠淘汰或强制裁决收尾',
    },
  ];

  function groupToggles(groupKey) {
    return TOGGLES.filter(toggle => toggle.group === groupKey);
  }

  function toggleRowHtml(toggle) {
    const label = esc(toggle.label);
    return `<div class="rmo-param rmo-param-toggle" data-key="${esc(toggle.key)}">
      <label class="rmo-toggle-row" title="${esc(toggle.hint)}">
        <span class="rmo-param-label">${label}</span>
        <span class="rmo-toggle-hint">${esc(toggle.hint)}</span>
        <span class="switch">
          <input type="checkbox" ${toggle.default ? 'checked' : ''} data-toggle="${esc(toggle.key)}" data-default="${toggle.default ? 'true' : 'false'}" aria-label="${label}" />
          <span class="switch-slider"></span>
        </span>
      </label>
    </div>`;
  }

  // 模式取值与后端 GameMode 一一对应：每个模式只出现一次，不再保留「空值＝服务端默认标准」
  // 的第二条标准项——两个选项指向同一模式会让用户以为有什么区别。
  const GAME_MODES = [
    { value: 'standard', label: '标准' },
    { value: 'annihilation', label: '歼灭（炮火缩圈）' },
    { value: 'simultaneous', label: '同时回合' },
    { value: 'royale', label: '大逃杀（同时×缩圈）' },
  ];

  const MODE_HINTS = {
    standard: '标准：逐人轮流，摧毁总部或按裁决分收尾；无炮火参数。',
    annihilation: '歼灭：不建总部（无总部参数），出生即据点，炮火逐轮缩圈，打光即淘汰。',
    simultaneous: '同时回合：全员并行下达指令、统一结算；无炮火参数。',
    royale: '大逃杀：同时回合 + 歼灭缩圈（无总部参数），打光即淘汰。',
  };

  /** 模式下拉缺失（元素不存在）时回落到标准模式；正常路径下取值已是四个模式之一。 */
  function effectiveMode(value) {
    return value ? String(value) : 'standard';
  }

  /** 参数在给定模式下是否适用（无 modes 字段＝全模式适用）。 */
  function paramAppliesToMode(param, mode) {
    return !Array.isArray(param.modes) || param.modes.indexOf(mode) !== -1;
  }

  /** 某模式下应当显示并提交的参数键。 */
  function paramsForMode(mode) {
    const resolved = effectiveMode(mode);
    return PARAMS.filter(param => paramAppliesToMode(param, resolved)).map(param => param.key);
  }

  /** 与服务端 sanitizeParam 同口径：先钳到硬边界，整数参数再取整。 */
  function clampToBounds(value, param) {
    const clamped = Math.min(param.max, Math.max(param.min, value));
    return param.step >= 1 ? Math.round(clamped) : Number(clamped.toFixed(4));
  }

  function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * 参数值的显示口径：整数取整，小数保留四位小数——与服务端生成/钳位同精度，
   * 所以参数行里显示的数、锁进固定框的数、地图实际用的数三者完全一致（不做额外取整）。
   * null 是服务端明确表示本图没有这一项：无回合上限＝∞，未注入的参数＝未启用。
   */
  function formatValue(param, value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      if (param.key === 'maxTurns') return '∞';
      if (param.key.indexOf('comeback') === 0 || param.group === 'artillery') return '未启用';
      return '—';
    }
    const number = Number(value);
    return param.step >= 1 ? String(Math.round(number)) : String(Number(number.toFixed(4)));
  }

  /** 数字输入共用的量程/步长属性（量程＝服务端硬边界）。 */
  function boundsAttrs(param) {
    return `min="${param.min}" max="${param.max}" step="${param.step}"`;
  }

  function paramRowHtml(param) {
    const label = esc(param.label);
    const bounds = boundsAttrs(param);
    const hint = `可选 ${param.min}–${param.max}；留空＝服务端默认 ${param.defMin}–${param.defMax}`;
    // 可选上下限直接写进输入框的灰字（placeholder）：不再单占一列「范围 x–y」，
    // 参数行因此保持单行，行高与列宽都更紧凑。悬停仍给出「可选 / 默认」完整提示。
    const minHint = esc(`≥${param.min}`);
    const maxHint = esc(`≤${param.max}`);
    // 固定挡只有一个输入框：灰字直接给出整段可选范围。
    const fixedHint = esc(`范围 ${param.min}–${param.max}`);
    // 默认固定挡：首屏落在「固定」挡（留空＝服务端默认、不提交），用户切到随机才提交区间。
    const fixed = param.defaultMode === 'fixed';
    const warn = param.warnRandom
      ? `<span class="rmo-warn${fixed ? ' hidden' : ''}">${esc(param.warnRandom)}</span>`
      : '';
    return `<div class="rmo-param" data-key="${esc(param.key)}" data-default-mode="${fixed ? 'fixed' : 'random'}">
      <div class="rmo-param-head">
        <span class="rmo-param-label" title="${esc(hint)}"><span class="rmo-param-name">${label}</span><span class="rmo-param-value" data-param-value hidden></span></span>
        <span class="rmo-mode-toggle" data-value="${fixed ? 'fixed' : 'random'}" role="switch" aria-checked="${fixed ? 'true' : 'false'}" tabindex="0" aria-label="${label}取值方式">
          <span class="rmo-mode-option${fixed ? '' : ' is-active'}" data-value="random">随机</span>
          <span class="rmo-mode-option${fixed ? ' is-active' : ''}" data-value="fixed">固定</span>
          <span class="rmo-mode-thumb" aria-hidden="true"></span>
        </span>
        <span class="rmo-range-inputs${fixed ? ' hidden' : ''}">
          <input class="rmo-min" type="number" ${bounds} placeholder="${minHint}" title="${esc(hint)}" aria-label="${label}最小值（可选 ${param.min}–${param.max}）" />
          <span class="rmo-sep">–</span>
          <input class="rmo-max" type="number" ${bounds} placeholder="${maxHint}" title="${esc(hint)}" aria-label="${label}最大值（可选 ${param.min}–${param.max}）" />
        </span>
        <span class="rmo-fixed-input${fixed ? '' : ' hidden'}">
          <input class="rmo-value" type="number" ${bounds} placeholder="${fixedHint}" title="${esc(hint)}" aria-label="${label}固定值（可选 ${param.min}–${param.max}）" />
        </span>
      </div>
      ${warn}
    </div>`;
  }

  /** 组内参数行；带 subgroup 的参数在兵种切换处插入一条小标题。 */
  function groupRowsHtml(groupKey) {
    const params = groupParams(groupKey);
    return params.map((param, index) => {
      const previous = params[index - 1];
      const label = param.subgroup && param.subgroup !== (previous && previous.subgroup)
        ? `<div class="rmo-subgroup-label" data-subgroup="${esc(param.subgroup)}">${esc(param.subgroup)}</div>`
        : '';
      return label + paramRowHtml(param);
    }).join('');
  }

  /** 一个折叠块：标题行（按钮，可点）＋ 组体（沿用 .rmo-grid 的列规则）。 */
  function groupSectionHtml(group) {
    const expanded = group.defaultOpen !== false;
    const count = groupParams(group.key).length + groupToggles(group.key).length;
    return `<section class="rmo-group" data-group="${esc(group.key)}">
      <button type="button" class="rmo-group-head" aria-expanded="${expanded}" aria-controls="rmo-group-${esc(group.key)}">
        <span class="rmo-group-title">${esc(group.label)}</span>
        <span class="rmo-group-count">${count} 项</span>
        <span class="rmo-group-chevron" aria-hidden="true"></span>
      </button>
      <div class="rmo-group-body rmo-grid${expanded ? '' : ' hidden'}" id="rmo-group-${esc(group.key)}">
        ${groupRowsHtml(group.key)}${groupToggles(group.key).map(toggleRowHtml).join('')}
      </div>
    </section>`;
  }

  function panelHtml() {
    return `
      <div class="rmo-head">
        <span class="rmo-title">随机地图参数</span>
        <span class="rmo-hint">留空项由服务端在默认范围内随机</span>
        <button type="button" id="rmo-groups-toggle" class="rmo-groups-toggle">全部展开</button>
        <button type="button" id="rmo-reset" class="rmo-reset" title="清空所有参数输入并恢复默认取值方式与服务模式（种子保留，可再点「换一张」）">重置</button>
      </div>
      <div class="rmo-row">
        <label class="field checkbox-field rmo-symmetric-field">
          <span title="2/3/4/6/8 人按 360/n 的最大六边形可用旋转对称（180°/120°/180°/60°/180°）；5/7 人无对称解，自动降级为非对称">对称公平</span>
          <span class="switch">
            <input id="rmo-symmetric" type="checkbox" checked />
            <span class="switch-slider"></span>
          </span>
        </label>
        <div class="field rmo-mode-field">
          <label for="rmo-game-mode">游戏模式</label>
          <select id="rmo-game-mode">
            ${GAME_MODES.map((mode, index) => `<option value="${mode.value}"${index === 0 ? ' selected' : ''}>${mode.label}</option>`).join('')}
          </select>
        </div>
        <div class="field rmo-seed-field">
          <label for="rmo-seed">种子（留空每次随机）</label>
          <div class="rmo-seed-row">
            <input id="rmo-seed" maxlength="64" placeholder="相同种子生成相同地图" autocomplete="off" />
            <button type="button" id="rmo-seed-lock" class="rmo-seed-lock" aria-pressed="false" title="锁定种子：锁定后「换一张」不再改变这张图">锁定</button>
          </div>
        </div>
      </div>
      <div class="rmo-mode-hint" id="rmo-mode-hint"></div>
      <div class="rmo-groups">
        ${GROUPS.map(groupSectionHtml).join('')}
      </div>
      <div class="rmo-preview">
        <div class="rmo-preview-head">
          <span class="rmo-preview-title">地图预览</span>
          <button type="button" id="rmo-preview-refresh" class="rmo-preview-refresh" title="重新随机一张预览">&#10227; 换一张</button>
        </div>
        <div id="rmo-preview-canvas" class="rmo-preview-canvas">生成预览中…</div>
      </div>`;
  }

  function renderRandomMapCard(isSelected) {
    return `<button type="button" class="map-card map-card-random ${isSelected ? 'selected-map' : ''}" data-map-id="${RANDOM_MAP_ID}" role="radio" aria-checked="${isSelected}" aria-label="随机地图 (random)">
      <div class="map-preview empty" aria-hidden="true">?</div>
      <span class="map-card-copy">
        <span class="map-card-name"><span class="map-card-name-zh">随机地图</span><span class="map-card-name-en">random</span></span>
        <span class="map-card-meta">
          <span class="meta-tag" data-label="地形与出生点">⊘ 随机</span>
          <span class="meta-tag" data-label="玩家数">⚑ 2-8</span>
          <span class="meta-tag" data-label="回合/行动点">⏱ 随机</span>
          <span class="meta-tag" data-label="游戏模式">四种可选</span>
        </span>
      </span>
      <span class="map-card-tooltip" role="tooltip">
        <span class="tooltip-name">随机地图 <span class="tooltip-id">random</span></span>
        <span class="tooltip-desc">支持标准/歼灭/同时回合/大逃杀四种模式，随机生成地形、复活点、回合数、行动点与兵种数值；参数可固定、可用种子复现</span>
      </span>
    </button>`;
  }

  function parseNumber(input) {
    if (!input) return null;
    const raw = String(input.value).trim();
    if (raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  // 已初始化过的面板容器：防重复 init（模块尾自动 boot 与外部显式调用撞车时，
  // 会给同一批控件挂两份监听）。
  const initializedPanels = new WeakSet();

  const RandomMapUI = {
    RANDOM_MAP_ID,
    PARAMS,
    GROUPS,
    TOGGLES,
    GAME_MODES,
    renderRandomMapCard,
    paramsForMode,
    /**
     * 保留的兼容入口：滑块已移除，参数行只有数字输入，无需额外同步。
     * 外部调用无副作用（测试与旧调用方可能仍引用此名字）。
     */
    refreshSliders() {},

    /** 展开/收起单个分组（折叠只是视图状态，收起组里的参数仍照常提交）。 */
    setGroupExpanded(section, expanded) {
      if (!section) return;
      const head = section.querySelector('.rmo-group-head');
      const body = section.querySelector('.rmo-group-body');
      if (head) head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (body) body.classList.toggle('hidden', !expanded);
    },

    /** 同步「全部展开/收起」按钮文案：还有收起的分组时显示「全部展开」。 */
    syncGroupsToggle(container) {
      const button = document.getElementById('rmo-groups-toggle');
      if (!button) return;
      const heads = container ? container.querySelectorAll('.rmo-group-head') : [];
      const anyCollapsed = Array.from(heads).some(head => head.getAttribute('aria-expanded') === 'false');
      button.textContent = anyCollapsed ? '全部展开' : '全部收起';
    },

    previewRenderer: null,
    previewToken: 0,
    previewTimer: null,
    suppressAutoPreview: false,
    /** 最近一次生成的预览、种子与每个参数的实际取值：大厅摘要、弹层预览与参数行回显共用。 */
    lastPreview: null,
    lastSeed: '',
    lastValues: null,
    /** 上一轮的实际取值：用于「换一张」后让变化过的数值闪一下。 */
    previousValues: null,
    /** 种子锁：锁住后「换一张」不再清空种子，这张图仍可复现、可继续微调。 */
    seedLocked: false,
    /** 预览刷新后的外部钩子（play.js / play-m.js 用来更新弹层事实区）。 */
    onPreview: null,

    /** 注入页面的地图预览渲染函数（与静态地图卡片同一套 SVG 渲染）。 */
    setPreviewRenderer(renderer) {
      RandomMapUI.previewRenderer = renderer;
    },

    /**
     * 把服务端回传的「现值」写进每个参数行：掷出来的数值就在参数名下面，
     * 不用再靠看地图形状猜。换一张后变化过的值闪一下，便于看清这一轮换掉了什么。
     */
    applyPreviewValues(values) {
      const map = values && typeof values === 'object' ? values : {};
      const previous = RandomMapUI.previousValues || {};
      const has = (source, key) => Object.prototype.hasOwnProperty.call(source, key);
      const rows = typeof document !== 'undefined' && document.querySelectorAll
        ? document.querySelectorAll('.rmo-param')
        : [];
      Array.from(rows).forEach(row => {
        const key = row?.dataset?.key;
        const param = PARAMS.find(item => item.key === key);
        const slot = row?.querySelector?.('[data-param-value]');
        if (!param || !slot) return;
        if (!has(map, key)) {
          slot.hidden = true;
          slot.textContent = '';
          return;
        }
        const text = `现值 ${formatValue(param, map[key])}`;
        const changed = has(previous, key) && text !== `现值 ${formatValue(param, previous[key])}`;
        slot.hidden = false;
        slot.textContent = text;
        slot.title = `${param.label}：${text}`;
        slot.classList.toggle('is-changed', changed);
        // 闪烁只做一次：定时清掉类名，避免下一次换一张时残留。
        if (changed) {
          clearTimeout(slot.__flashTimer);
          slot.__flashTimer = setTimeout(() => slot.classList.remove('is-changed'), 1400);
        }
      });
      RandomMapUI.previousValues = map;
      RandomMapUI.lastValues = map;
    },

    /**
     * 重置：清空所有参数输入、恢复各自的默认取值方式与开关状态、模式回到标准、对称公平回到开启；
     * 种子保留（想换图点「换一张」），随后按默认参数重跑一次预览。
     */
    resetOptions() {
      const root = document.getElementById('random-map-options');
      if (!root) return false;
      root.querySelectorAll('.rmo-param').forEach(row => {
        const fixed = row.dataset.defaultMode === 'fixed';
        ['.rmo-min', '.rmo-max', '.rmo-value'].forEach(selector => {
          const input = row.querySelector(selector);
          if (input) input.value = '';
        });
        const toggle = row.querySelector('.rmo-mode-toggle');
        if (toggle) {
          toggle.dataset.value = fixed ? 'fixed' : 'random';
          toggle.setAttribute('aria-checked', fixed ? 'true' : 'false');
          toggle.querySelectorAll('.rmo-mode-option').forEach(option => {
            option.classList.toggle('is-active', option.dataset.value === toggle.dataset.value);
          });
          row.querySelector('.rmo-range-inputs')?.classList.toggle('hidden', fixed);
          row.querySelector('.rmo-fixed-input')?.classList.toggle('hidden', !fixed);
          // 「建议固定」参数在默认固定挡下不显示护栏提示。
          row.querySelector('.rmo-warn')?.classList.toggle('hidden', fixed);
        }
        // 现值回显一并收起：参数都清空了，不把上一张图的数字留在这一张上。
        const slot = row.querySelector('[data-param-value]');
        if (slot) {
          slot.textContent = '';
          slot.hidden = true;
          slot.classList.remove('is-changed');
        }
      });
      document.querySelectorAll('input[data-toggle]').forEach(input => {
        input.checked = input.dataset.default === 'true';
      });
      const symmetric = document.getElementById('rmo-symmetric');
      if (symmetric) symmetric.checked = true;
      const modeSelect = document.getElementById('rmo-game-mode');
      if (modeSelect) {
        modeSelect.value = 'standard';
        RandomMapUI.applyModeVisibility(root);
      }
      // 清掉上一轮的取值快照：重置后的第一帧不该整片闪烁。
      RandomMapUI.previousValues = null;
      RandomMapUI.refreshPreview(true);
      return true;
    },

    /** 换一张：清掉种子重新抽（种子锁定时不生效，先解锁）。 */
    reroll(force = false) {
      if (RandomMapUI.seedLocked) return false;
      const seed = document.getElementById('rmo-seed');
      if (seed) seed.value = '';
      RandomMapUI.refreshPreview(force);
      return true;
    },

    /**
     * 从「随机」切到「固定」时，把这一行当前的现值填进固定输入框（与参数行显示的数字完全一致）。
     * 不填的话这一行等于「留空＝服务端默认」，换一张照样重掷——看起来就是根本没锁住。
     * 用户已经填过的值不覆盖；本图没有这一项（∞ / 未启用）时留空。
     */
    fillFixedFromPreview(row) {
      const key = row?.dataset?.key;
      const param = PARAMS.find(item => item.key === key);
      const input = row?.querySelector?.('.rmo-value');
      if (!param || !input) return false;
      if (String(input.value).trim() !== '') return false;
      const values = RandomMapUI.lastValues;
      if (!values || !Object.prototype.hasOwnProperty.call(values, key)) return false;
      const raw = values[key];
      if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return false;
      input.value = formatValue(param, Number(raw));
      return true;
    },

    /**
     * 随机挡只填了一端时，把另一端按默认范围补上（并写进输入框）：
     * 只填下限就用默认上界，只填上限就用默认下界——这一行仍是随机区间，
     * 不会因为另一端空着就悄悄变成固定值。
     */
    fillRangeSibling(row, input) {
      const key = row?.dataset?.key;
      const param = PARAMS.find(item => item.key === key);
      if (!param || !input) return false;
      const toggle = row.querySelector('.rmo-mode-toggle');
      if (toggle && toggle.dataset.value === 'fixed') return false;
      const raw = String(input.value).trim();
      if (raw === '' || !Number.isFinite(Number(raw))) return false;
      const value = Number(raw);
      const isMin = input.classList.contains('rmo-min');
      const sibling = row.querySelector(isMin ? '.rmo-max' : '.rmo-min');
      if (!sibling || String(sibling.value).trim() !== '') return false;
      const filled = isMin ? Math.max(value, param.defMax) : Math.min(value, param.defMin);
      sibling.value = String(filled);
      return true;
    },

    toggleSeedLock() {
      RandomMapUI.setSeedLocked(!RandomMapUI.seedLocked);
    },

    /** 锁定种子：优先用输入框里已有的值，其次用最近一次预览代抽的种子。 */
    setSeedLocked(locked) {
      const seedInput = document.getElementById('rmo-seed');
      if (locked) {
        const current = seedInput ? seedInput.value.trim() : '';
        const seed = current || RandomMapUI.lastSeed || '';
        // 还没生成过预览时没有可锁的种子，保持未锁定（按钮此时也打不开）。
        if (!seed) return;
        if (seedInput && !current) seedInput.value = seed;
      }
      RandomMapUI.seedLocked = !!locked;
      RandomMapUI.syncSeedLockState();
    },

    /** 同步种子锁的外观：输入框只读、锁按钮文案/状态、「换一张」按钮禁用。 */
    syncSeedLockState() {
      const locked = RandomMapUI.seedLocked;
      const seedInput = document.getElementById('rmo-seed');
      if (seedInput) {
        seedInput.readOnly = locked;
        seedInput.title = locked ? '种子已锁定：解开锁定后才会重新抽取' : '';
      }
      const lockButton = document.getElementById('rmo-seed-lock');
      if (lockButton) {
        const hasSeed = !!(seedInput && seedInput.value.trim()) || !!RandomMapUI.lastSeed;
        lockButton.textContent = locked ? '已锁定' : '锁定';
        lockButton.setAttribute('aria-pressed', locked ? 'true' : 'false');
        lockButton.disabled = !locked && !hasSeed;
        lockButton.classList.toggle('is-locked', locked);
        lockButton.title = locked
          ? '种子已锁定：换一张不会改变这张图；点这里解锁'
          : hasSeed
            ? '锁定种子：锁定后「换一张」不再改变这张图'
            : '先生成预览，再锁定种子';
      }
      const rerollTitle = locked ? '种子已锁定，解锁后才能换一张' : '重新随机一张预览';
      const panelRefresh = document.getElementById('rmo-preview-refresh');
      if (panelRefresh) {
        panelRefresh.disabled = locked;
        panelRefresh.title = rerollTitle;
      }
      // 地图库弹层右侧的「换一张」在页面侧渲染，模块不持有引用：按 data 标记统一同步。
      if (typeof document !== 'undefined' && document.querySelectorAll) {
        document.querySelectorAll('[data-random-refresh]').forEach(button => {
          button.disabled = locked;
          button.title = rerollTitle;
        });
      }
    },

    /** 将配置面板渲染进容器（各页面在 #random-map-options 容器上调用一次）。 */
    init(container) {
      if (!container) return;
      // 面板只初始化一次：模块尾部的自动 boot 与外部显式调用可能撞在一起，
      // 重复 init 会把同一批开关/输入挂上两份监听（滑动开关连翻两次等于没翻）。
      if (initializedPanels.has(container)) return;
      initializedPanels.add(container);
      container.innerHTML = panelHtml();
      RandomMapUI.applyModeVisibility(container);
      // 折叠块接线：组标题按钮切换本组展开态，「全部展开/收起」统一切换所有组。
      container.querySelectorAll('.rmo-group').forEach(section => {
        const head = section.querySelector('.rmo-group-head');
        head?.addEventListener('click', () => {
          const expanded = head.getAttribute('aria-expanded') !== 'false';
          RandomMapUI.setGroupExpanded(section, !expanded);
          RandomMapUI.syncGroupsToggle(container);
        });
      });
      document.getElementById('rmo-groups-toggle')?.addEventListener('click', () => {
        const sections = Array.from(container.querySelectorAll('.rmo-group'));
        const anyCollapsed = sections.some(section =>
          section.querySelector('.rmo-group-head')?.getAttribute('aria-expanded') === 'false');
        sections.forEach(section => RandomMapUI.setGroupExpanded(section, anyCollapsed));
        RandomMapUI.syncGroupsToggle(container);
      });
      RandomMapUI.syncGroupsToggle(container);
      document.getElementById('rmo-game-mode')?.addEventListener('change', () => {
        RandomMapUI.applyModeVisibility(container);
        RandomMapUI.schedulePreview();
      });
      container.querySelectorAll('.rmo-param').forEach(row => {
        const toggle = row.querySelector('.rmo-mode-toggle');
        if (!toggle) return;
        const rangeInputs = row.querySelector('.rmo-range-inputs');
        const fixedInput = row.querySelector('.rmo-fixed-input');
        const warn = row.querySelector('.rmo-warn');
        // 左右滑动开关：点开关任意处即切换到另一档，随机↔固定。
        const applyMode = fixed => {
          toggle.dataset.value = fixed ? 'fixed' : 'random';
          toggle.setAttribute('aria-checked', fixed ? 'true' : 'false');
          toggle.querySelectorAll('.rmo-mode-option').forEach(option => {
            option.classList.toggle('is-active', option.dataset.value === toggle.dataset.value);
          });
          rangeInputs?.classList.toggle('hidden', fixed);
          fixedInput?.classList.toggle('hidden', !fixed);
          // 切到「固定」＝锁定这一行：先把本图当前取值填进输入框。
          // 空着不填等于「留空＝服务端默认」，换一张仍会重掷，锁不住。
          if (fixed) RandomMapUI.fillFixedFromPreview(row);
          // 「建议固定」参数切到随机挡时亮出护栏提示。
          warn?.classList.toggle('hidden', fixed);
          RandomMapUI.schedulePreview();
        };
        toggle.addEventListener('click', () => applyMode(toggle.dataset.value !== 'fixed'));
        toggle.addEventListener('keydown', event => {
          if (event && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault?.();
            applyMode(toggle.dataset.value !== 'fixed');
          }
        });
      });
      container.querySelectorAll('input, select').forEach(input => {
        input.addEventListener('change', () => RandomMapUI.schedulePreview());
        if (input.tagName === 'INPUT' && input.type === 'number') {
          input.addEventListener('input', () => RandomMapUI.schedulePreview());
          // 只填一端时把另一端按默认范围补上，让这一行保持「区间」而不是变成固定值。
          input.addEventListener('change', () => {
            const row = input.closest ? input.closest('.rmo-param') : null;
            if (row && RandomMapUI.fillRangeSibling(row, input)) RandomMapUI.schedulePreview();
          });
        }
      });
      document.getElementById('rmo-preview-refresh')?.addEventListener('click', () => {
        // 换一张：清掉种子重新抽一张（种子锁定时不生效），新种子随之回填保证预览即所得。
        RandomMapUI.reroll();
      });
      // 种子锁：锁住后「换一张」不再清空种子，输入框转只读——这张图仍可复现、可继续微调。
      document.getElementById('rmo-seed-lock')?.addEventListener('click', () => RandomMapUI.toggleSeedLock());
      document.getElementById('rmo-seed')?.addEventListener('input', () => RandomMapUI.syncSeedLockState());
      // 重置：一键清空所有参数输入、回到默认值。
      document.getElementById('rmo-reset')?.addEventListener('click', () => RandomMapUI.resetOptions());
      RandomMapUI.syncSeedLockState();
      // 人数影响出生位数量；面板外的下拉也要联动预览。
      document.getElementById('max-players')?.addEventListener('change', () => RandomMapUI.schedulePreview());
    },

    /**
     * 按当前游戏模式显隐参数行：标准 / 同时回合无炮火参数，歼灭 / 大逃杀无总部参数
     * （歼灭系不建总部）。同时更新模式说明，让「参数为什么少了」有解释。
     */
    applyModeVisibility(container) {
      const root = container || document.getElementById('random-map-options');
      if (!root) return;
      const mode = effectiveMode(document.getElementById('rmo-game-mode')?.value);
      // 组级显隐：整组参数都不适用于当前模式时收起整块，避免只剩一个空标题
      // （例如标准模式没有炮火组）。组与行共用同一份 modes 判断，不会两份口径漂移。
      root.querySelectorAll('.rmo-group').forEach(section => {
        const group = GROUPS.find(item => item.key === section.dataset.group);
        const applicable = group
          ? groupParams(group.key).some(param => paramAppliesToMode(param, mode))
          : true;
        section.classList.toggle('hidden', !applicable);
      });
      root.querySelectorAll('.rmo-param').forEach(row => {
        const param = PARAMS.find(item => item.key === row.dataset.key);
        if (!param) return;
        row.classList.toggle('hidden', !paramAppliesToMode(param, mode));
      });
      const hint = document.getElementById('rmo-mode-hint');
      if (hint) hint.textContent = MODE_HINTS[mode] || '';
    },

    setSelected(mapId) {
      const panel = document.getElementById('random-map-options');
      // 地图库弹层里由页签控制显隐，不能再被"当前选中地图"覆盖；只处理旧的内联面板。
      if (panel && !panel.closest('.map-dialog')) {
        panel.classList.toggle('hidden', mapId !== RANDOM_MAP_ID);
      }
      if (mapId === RANDOM_MAP_ID) RandomMapUI.refreshPreview();
    },

    isSelected() {
      const select = document.getElementById('map-select');
      return !!select && select.value === RANDOM_MAP_ID;
    },

    schedulePreview() {
      if (!RandomMapUI.isSelected() || RandomMapUI.suppressAutoPreview) return;
      clearTimeout(RandomMapUI.previewTimer);
      RandomMapUI.previewTimer = setTimeout(() => RandomMapUI.refreshPreview(), 500);
    },

    /** 按当前面板参数请求服务端生成预览；未填种子时回填服务端代抽的种子。 */
    async refreshPreview(force = false) {
      if (!force && !RandomMapUI.isSelected()) return;
      const canvas = document.getElementById('rmo-preview-canvas');
      if (!canvas) return;
      const token = ++RandomMapUI.previewToken;
      const maxPlayers = Number(document.getElementById('max-players')?.value || 2);
      const options = RandomMapUI.collectRandomOptions();
      canvas.classList.remove('rmo-preview-error');
      canvas.innerHTML = '<span class="rmo-preview-loading">生成预览中…</span>';
      try {
        const res = await fetch('/api/maps/random/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxPlayers, random: options }),
        });
        const data = await res.json();
        if (token !== RandomMapUI.previewToken) return;
        if (!res.ok) throw new Error(data.error || '生成预览失败');
        const seedInput = document.getElementById('rmo-seed');
        if (seedInput && !seedInput.value.trim() && data.seed) {
          RandomMapUI.suppressAutoPreview = true;
          seedInput.value = data.seed;
          RandomMapUI.suppressAutoPreview = false;
        }
        RandomMapUI.lastSeed = data.seed || '';
        RandomMapUI.syncSeedLockState();
        RandomMapUI.renderPreview(data.preview, data.values);
      } catch (err) {
        if (token !== RandomMapUI.previewToken) return;
        // 预览失败时收起所有「本图 X」：宁可空着，也不把上一张图的数值留在这一张上。
        RandomMapUI.applyPreviewValues(null);
        canvas.classList.add('rmo-preview-error');
        canvas.textContent = `预览失败：${window.ErrorText.describe(err, '网络错误')}`;
        document.querySelectorAll('[data-random-preview]').forEach(el => {
          el.classList.add('rmo-preview-error');
          el.textContent = `预览失败：${window.ErrorText.describe(err, '网络错误')}`;
        });
      }
    },

    renderPreview(preview, values) {
      const canvas = document.getElementById('rmo-preview-canvas');
      if (!canvas || !RandomMapUI.previewRenderer) return;
      const rendered = RandomMapUI.previewRenderer(preview);
      RandomMapUI.lastPreview = preview || null;
      // 参数行内的「本图 X」与地图预览同源：一次响应里一起更新。
      RandomMapUI.applyPreviewValues(values);
      canvas.innerHTML = rendered;
      // 大厅摘要缩略图与弹层右侧大预览共用同一份渲染结果。
      document.querySelectorAll('[data-random-preview]').forEach(el => {
        el.innerHTML = rendered;
      });
      document.querySelectorAll('[data-random-map-preview]').forEach(el => {
        el.innerHTML = rendered;
      });
      // 同步更新地图选择器里随机卡片的小预览。
      const cardPreview = document.querySelector('.map-card-random .map-preview');
      if (cardPreview) {
        cardPreview.outerHTML = rendered;
      }
      try {
        RandomMapUI.onPreview?.(preview);
      } catch {
        // 外部钩子只负责刷新说明文字，失败不应影响预览本身。
      }
    },

    /** 读取面板输入，组装 POST /api/games 的 random 字段。 */
    collectRandomOptions() {
      const options = {};
      const symmetric = document.getElementById('rmo-symmetric');
      if (symmetric && !symmetric.checked) options.symmetric = false;
      const seed = document.getElementById('rmo-seed');
      const seedText = seed ? seed.value.trim() : '';
      if (seedText) options.seed = seedText;

      const gameMode = document.getElementById('rmo-game-mode');
      const modeValue = gameMode ? gameMode.value : '';
      const mode = effectiveMode(modeValue);
      if (modeValue) options.mode = modeValue;

      document.querySelectorAll('.rmo-param').forEach(row => {
        const key = row.dataset.key;
        if (!key) return;
        // 与当前模式无关的参数（如标准模式的炮火、歼灭模式的总部）不提交，
        // 避免服务端收到用不上的字段、也避免隐藏后仍被误带出去。
        const param = PARAMS.find(item => item.key === key);
        if (param && !paramAppliesToMode(param, mode)) return;
        // 与服务端 sanitizeParam 同口径地钳位：前端先钳，用户填的越界值不会「看着生效、
        // 实际被服务端悄悄改掉」，提交内容与服务端结果始终一致。
        const bound = value => (param ? clampToBounds(value, param) : value);
        const fill = row.querySelector('.rmo-mode-toggle')?.dataset.value || 'random';
        if (fill === 'fixed') {
          const value = parseNumber(row.querySelector('.rmo-value'));
          if (value !== null) options[key] = bound(value);
          return;
        }
        const min = parseNumber(row.querySelector('.rmo-min'));
        const max = parseNumber(row.querySelector('.rmo-max'));
        if (min === null && max === null) return;
        if (min !== null && max !== null) {
          // 上下限都填就保持区间形态（lo===hi 也是）。
          options[key] = [bound(Math.min(min, max)), bound(Math.max(min, max))];
        } else if (param) {
          // 只填一端：另一端按默认范围补上，仍然是随机区间——不会悄悄变成固定值。
          options[key] = min !== null
            ? [bound(min), bound(Math.max(min, param.defMax))]
            : [bound(Math.min(max, param.defMin)), bound(max)];
        } else {
          options[key] = min !== null ? min : max;
        }
      });
      // 布尔开关：只有偏离默认值时才写进 random 字段（默认态不提交，服务端行为不变）。
      document.querySelectorAll('input[data-toggle]').forEach(input => {
        const key = input.dataset.toggle;
        if (!key) return;
        if (input.checked !== (input.dataset.default === 'true')) options[key] = input.checked;
      });
      return options;
    },
  };

  window.RandomMapUI = RandomMapUI;

  if (typeof document !== 'undefined' && document.getElementById) {
    const boot = () => RandomMapUI.init(document.getElementById('random-map-options'));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
