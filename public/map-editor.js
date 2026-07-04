(function initMapEditor(global) {
  const SQRT3 = Math.sqrt(3);
  const HEX_SIZE = 34;
  const PAD = 48;
  const TERRAIN_COLORS = { plain: '#111923', water: '#183a55', blocker: '#393f46' };
  const OWNER_COLORS = { player_a: '#66ccff', player_b: '#ff9966' };
  const UNIT_TYPES = ['infantry', 'scout', 'heavy', 'ranger', 'support'];
  const UNIT_NAMES = { infantry: '步兵', scout: '侦察兵', heavy: '重装', ranger: '远程兵', support: '支援兵' };
  const UNIT_LABELS = { infantry: 'INF', scout: 'SCT', heavy: 'HVY', ranger: 'RNG', support: 'SUP' };
  const CONTROL_POINT_KINDS = ['supply', 'forward_base', 'repair'];
  const CONTROL_POINT_NAMES = { supply: '补给站', forward_base: '前线基地', repair: '维修站' };
  const CONTROL_POINT_LABELS = { supply: 'SUP', forward_base: 'FWD', repair: 'REP' };
  const BALANCE_KEYS = [
    ['startingSupplies', '初始金币', 0],
    ['baseIncome', '每回合基础收入', 0],
    ['controlPointIncome', '普通据点收入', 0],
    ['damageVarianceRange', '伤害浮动', 0],
    ['minimumDamage', '最低伤害', 0],
    ['healVarianceRange', '治疗浮动', 0],
    ['actionsPerTurn', '每回合行动点', 1],
    ['maxTurns', '最大回合', 1],
  ];
  const WEIGHT_KEYS = [
    ['enemyHqDamage', '敌 HQ 伤害'],
    ['ownHqHp', '己方 HQ 血量'],
    ['controlPoint', '据点数量'],
    ['armyValue', '兵力价值'],
    ['supplies', '金币'],
  ];

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isValidHex(pos, radius) {
    return Number.isInteger(pos.q) && Number.isInteger(pos.r)
      && Math.max(Math.abs(pos.q), Math.abs(pos.r), Math.abs(-pos.q - pos.r)) <= radius;
  }

  function hexKey(pos) {
    return `${pos.q},${pos.r}`;
  }

  function allCells(radius) {
    const cells = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        if (isValidHex({ q, r }, radius)) cells.push({ q, r });
      }
    }
    return cells;
  }

  function defaultUnits() {
    return {
      infantry: { hp: 100, attack: 30, defense: 8, moveRange: 3, attackRange: 1, cost: 45, canCapture: true },
      scout: { hp: 65, attack: 16, defense: 4, moveRange: 5, attackRange: 1, cost: 38, canCapture: true },
      heavy: { hp: 150, attack: 38, defense: 13, moveRange: 2, attackRange: 1, cost: 92, canCapture: false },
      ranger: { hp: 72, attack: 44, defense: 3, moveRange: 2, attackRange: 3, cost: 78, canCapture: false },
      support: { hp: 82, attack: 10, defense: 5, moveRange: 3, attackRange: 1, cost: 60, canCapture: false, healPower: 22 },
    };
  }

  function defaultControlPointTypes() {
    return {
      supply: { income: 12, deployDiscount: 0, repairAmount: 0 },
      forward_base: { income: 8, deployDiscount: 8, repairAmount: 0 },
      repair: { income: 8, deployDiscount: 0, repairAmount: 10 },
    };
  }

  function defaultBalance() {
    return {
      startingSupplies: 80,
      baseIncome: 10,
      controlPointIncome: 12,
      damageVarianceRange: 3,
      minimumDamage: 1,
      healVarianceRange: 6,
      actionsPerTurn: 5,
      maxTurns: 15,
      adjudicationWeights: {
        enemyHqDamage: 4,
        ownHqHp: 2,
        controlPoint: 120,
        armyValue: 2,
        supplies: 1,
      },
      controlPointTypes: defaultControlPointTypes(),
    };
  }

  function createDefaultMapConfig() {
    return {
      name: '新地图',
      description: '半径8的尖顶六边形战场',
      grid: 'hex',
      orientation: 'pointy',
      radius: 8,
      terrainCells: [],
      controlPoints: [],
      headquarters: {
        player_a: { q: -8, r: 0 },
        player_b: { q: 8, r: 0 },
      },
      startingUnits: [],
      units: defaultUnits(),
      headquartersSpec: { hp: 180, defense: 6 },
      balance: defaultBalance(),
    };
  }

  function numberOrDefault(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function normalizeUnitSpec(type, input) {
    const fallback = defaultUnits()[type];
    const src = input && typeof input === 'object' ? input : {};
    const spec = {};
    for (const key of ['hp', 'attack', 'defense', 'moveRange', 'attackRange', 'cost']) {
      spec[key] = numberOrDefault(src[key], fallback[key]);
    }
    spec.canCapture = typeof src.canCapture === 'boolean' ? src.canCapture : fallback.canCapture;
    if (type === 'support' || 'healPower' in src) spec.healPower = numberOrDefault(src.healPower, fallback.healPower || 0);
    return spec;
  }

  function normalizeImportedMap(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('地图 JSON 必须是对象');
    const defaults = createDefaultMapConfig();
    const cfg = deepClone(data);
    const normalized = {
      name: typeof cfg.name === 'string' && cfg.name ? cfg.name : defaults.name,
      description: typeof cfg.description === 'string' ? cfg.description : defaults.description,
      grid: 'hex',
      orientation: 'pointy',
      radius: Number.isInteger(cfg.radius) && cfg.radius > 0 ? cfg.radius : defaults.radius,
      terrainCells: Array.isArray(cfg.terrainCells) ? cfg.terrainCells.map(c => ({ q: c.q, r: c.r, terrain: c.terrain || 'plain' })) : [],
      controlPoints: Array.isArray(cfg.controlPoints)
        ? cfg.controlPoints.map((p, i) => ({ id: p.id || `cp_${i + 1}`, name: p.name || `据点 ${i + 1}`, ...(p.kind ? { kind: p.kind } : {}), q: p.q, r: p.r }))
        : [],
      headquarters: {
        player_a: { ...(cfg.headquarters?.player_a || defaults.headquarters.player_a) },
        player_b: { ...(cfg.headquarters?.player_b || defaults.headquarters.player_b) },
      },
      startingUnits: Array.isArray(cfg.startingUnits)
        ? cfg.startingUnits.map(u => ({ owner: u.owner, type: u.type, q: u.q, r: u.r }))
        : [],
      units: {},
      headquartersSpec: {
        hp: numberOrDefault(cfg.headquartersSpec?.hp, defaults.headquartersSpec.hp),
        defense: numberOrDefault(cfg.headquartersSpec?.defense, defaults.headquartersSpec.defense),
      },
      balance: deepClone(defaults.balance),
    };

    for (const type of UNIT_TYPES) normalized.units[type] = normalizeUnitSpec(type, cfg.units?.[type]);
    const sourceBalance = cfg.balance && typeof cfg.balance === 'object' ? cfg.balance : {};
    for (const [key] of BALANCE_KEYS) normalized.balance[key] = numberOrDefault(sourceBalance[key], defaults.balance[key]);
    normalized.balance.adjudicationWeights = {};
    for (const [key] of WEIGHT_KEYS) {
      normalized.balance.adjudicationWeights[key] = numberOrDefault(sourceBalance.adjudicationWeights?.[key], defaults.balance.adjudicationWeights[key]);
    }
    if (sourceBalance.controlPointTypes && typeof sourceBalance.controlPointTypes === 'object') {
      normalized.balance.controlPointTypes = {};
      for (const kind of CONTROL_POINT_KINDS) {
        normalized.balance.controlPointTypes[kind] = {
          income: numberOrDefault(sourceBalance.controlPointTypes[kind]?.income, defaults.balance.controlPointTypes[kind].income),
          deployDiscount: numberOrDefault(sourceBalance.controlPointTypes[kind]?.deployDiscount, defaults.balance.controlPointTypes[kind].deployDiscount),
          repairAmount: numberOrDefault(sourceBalance.controlPointTypes[kind]?.repairAmount, defaults.balance.controlPointTypes[kind].repairAmount),
        };
      }
    }
    return normalized;
  }

  function sortPositions(list) {
    return [...list].sort((a, b) => a.q - b.q || a.r - b.r);
  }

  function serializeMapConfig(config) {
    const typed = (config.controlPoints || []).some(point => !!point.kind);
    const balance = {};
    for (const [key] of BALANCE_KEYS) balance[key] = Number(config.balance?.[key] ?? 0);
    balance.adjudicationWeights = {};
    for (const [key] of WEIGHT_KEYS) balance.adjudicationWeights[key] = Number(config.balance?.adjudicationWeights?.[key] ?? 0);
    if (typed) {
      balance.controlPointTypes = {};
      const types = config.balance?.controlPointTypes || defaultControlPointTypes();
      for (const kind of CONTROL_POINT_KINDS) {
        balance.controlPointTypes[kind] = {
          income: Number(types[kind]?.income ?? 0),
          deployDiscount: Number(types[kind]?.deployDiscount ?? 0),
          repairAmount: Number(types[kind]?.repairAmount ?? 0),
        };
      }
    }

    const units = {};
    for (const type of UNIT_TYPES) {
      const src = config.units?.[type] || {};
      units[type] = normalizeUnitSpec(type, src);
    }

    return {
      name: String(config.name || ''),
      description: String(config.description || ''),
      grid: 'hex',
      orientation: 'pointy',
      radius: Number(config.radius),
      terrainCells: sortPositions((config.terrainCells || [])
        .filter(cell => cell.terrain === 'water' || cell.terrain === 'blocker')
        .map(cell => ({ q: Number(cell.q), r: Number(cell.r), terrain: cell.terrain }))),
      controlPoints: (config.controlPoints || []).map((point, i) => ({
        id: String(point.id || `cp_${i + 1}`),
        name: String(point.name || `据点 ${i + 1}`),
        ...(typed ? { kind: point.kind || 'supply' } : {}),
        q: Number(point.q),
        r: Number(point.r),
      })),
      headquarters: {
        player_a: { q: Number(config.headquarters?.player_a?.q), r: Number(config.headquarters?.player_a?.r) },
        player_b: { q: Number(config.headquarters?.player_b?.q), r: Number(config.headquarters?.player_b?.r) },
      },
      startingUnits: (config.startingUnits || []).map(unit => ({
        owner: unit.owner,
        type: unit.type,
        q: Number(unit.q),
        r: Number(unit.r),
      })),
      units,
      headquartersSpec: {
        hp: Number(config.headquartersSpec?.hp ?? 0),
        defense: Number(config.headquartersSpec?.defense ?? 0),
      },
      balance,
    };
  }

  function validateMapConfig(config, id = 'map') {
    const errors = [];
    const c = config && typeof config === 'object' ? config : {};
    const mapName = `Map "${id}"`;
    function record(value, ctx) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${ctx} must be an object`);
        return {};
      }
      return value;
    }
    function str(obj, key, ctx) {
      if (typeof obj[key] !== 'string' || obj[key].length === 0) errors.push(`${ctx}.${key} must be a non-empty string`);
    }
    function num(obj, key, ctx, min = 0) {
      const value = obj[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min) errors.push(`${ctx}.${key} must be a number >= ${min}`);
      return value;
    }
    function pos(obj, ctx, radius) {
      const q = num(obj, 'q', ctx, -Infinity);
      const r = num(obj, 'r', ctx, -Infinity);
      if (!Number.isInteger(q) || !Number.isInteger(r)) errors.push(`${ctx} q/r must be integers`);
      else if (!isValidHex({ q, r }, radius)) errors.push(`${ctx} (${q},${r}) is outside radius ${radius}`);
      return { q, r };
    }
    function claim(posValue, ctx) {
      const key = `${posValue.q},${posValue.r}`;
      if (occupied.has(key)) errors.push(`${ctx} overlaps another fixed map object at ${key}`);
      occupied.add(key);
    }

    str(c, 'name', mapName);
    str(c, 'description', mapName);
    if (c.grid !== 'hex') errors.push(`${mapName} grid must be "hex"`);
    if (c.orientation !== 'pointy') errors.push(`${mapName} orientation must be "pointy"`);
    const radius = num(c, 'radius', mapName, 1);
    if (!Number.isInteger(radius)) errors.push(`${mapName} radius must be an integer`);

    const units = record(c.units, `${mapName}.units`);
    for (const type of UNIT_TYPES) {
      const spec = record(units[type], `units.${type}`);
      for (const key of ['hp', 'attack', 'defense', 'moveRange', 'attackRange', 'cost']) num(spec, key, `units.${type}`, 0);
      if (typeof spec.canCapture !== 'boolean') errors.push(`units.${type}.canCapture must be boolean`);
      if ('healPower' in spec) num(spec, 'healPower', `units.${type}`, 0);
    }

    const hqSpec = record(c.headquartersSpec, `${mapName}.headquartersSpec`);
    num(hqSpec, 'hp', `${mapName}.headquartersSpec`, 1);
    num(hqSpec, 'defense', `${mapName}.headquartersSpec`, 0);

    const balance = record(c.balance, `${mapName}.balance`);
    for (const [key, , min] of BALANCE_KEYS) {
      if ((key === 'actionsPerTurn' || key === 'maxTurns') && !(key in balance)) errors.push(`${mapName}.balance.${key} is required`);
      num(balance, key, `${mapName}.balance`, min);
    }
    if (!('adjudicationWeights' in balance)) errors.push(`${mapName}.balance.adjudicationWeights is required`);
    const weights = record(balance.adjudicationWeights, `${mapName}.balance.adjudicationWeights`);
    for (const [key] of WEIGHT_KEYS) num(weights, key, `${mapName}.balance.adjudicationWeights`, 0);
    const controlPointTypes = balance.controlPointTypes && typeof balance.controlPointTypes === 'object' ? balance.controlPointTypes : null;
    if (controlPointTypes) {
      for (const kind of CONTROL_POINT_KINDS) {
        const spec = record(controlPointTypes[kind], `${mapName}.balance.controlPointTypes.${kind}`);
        num(spec, 'income', `${mapName}.balance.controlPointTypes.${kind}`, 0);
        num(spec, 'deployDiscount', `${mapName}.balance.controlPointTypes.${kind}`, 0);
        num(spec, 'repairAmount', `${mapName}.balance.controlPointTypes.${kind}`, 0);
      }
    }

    const hq = record(c.headquarters, `${mapName}.headquarters`);
    const occupied = new Set();
    for (const player of ['player_a', 'player_b']) {
      const p = pos(record(hq[player], `headquarters.${player}`), `headquarters.${player}`, radius);
      claim(p, `headquarters.${player}`);
    }

    if (!Array.isArray(c.terrainCells)) errors.push(`${mapName}.terrainCells must be an array`);
    else c.terrainCells.forEach((cellValue, i) => {
      const cell = record(cellValue, `terrainCells[${i}]`);
      pos(cell, `terrainCells[${i}]`, radius);
      if (!['plain', 'water', 'blocker'].includes(cell.terrain)) errors.push(`terrainCells[${i}].terrain must be plain, water, or blocker`);
    });

    if (!Array.isArray(c.controlPoints) || c.controlPoints.length === 0) errors.push(`${mapName}.controlPoints must be a non-empty array`);
    let typed = 0;
    if (Array.isArray(c.controlPoints)) {
      c.controlPoints.forEach((pointValue, i) => {
        const point = record(pointValue, `controlPoints[${i}]`);
        str(point, 'id', `controlPoints[${i}]`);
        str(point, 'name', `controlPoints[${i}]`);
        if ('kind' in point) {
          if (!CONTROL_POINT_KINDS.includes(point.kind)) errors.push(`controlPoints[${i}].kind must be supply, forward_base, or repair`);
          typed += 1;
        }
        claim(pos(point, `controlPoints[${i}]`, radius), `controlPoints[${i}]`);
      });
      if (typed > 0) {
        if (!controlPointTypes) errors.push(`${mapName}.balance.controlPointTypes is required when control points use kind`);
        if (typed !== c.controlPoints.length) errors.push(`${mapName}.controlPoints must all define kind when any control point is typed`);
      }
    }

    if (!Array.isArray(c.startingUnits)) errors.push(`${mapName}.startingUnits must be an array`);
    else c.startingUnits.forEach((unitValue, i) => {
      const unit = record(unitValue, `startingUnits[${i}]`);
      if (unit.owner !== 'player_a' && unit.owner !== 'player_b') errors.push(`startingUnits[${i}].owner invalid`);
      if (!UNIT_TYPES.includes(String(unit.type))) errors.push(`startingUnits[${i}].type invalid`);
      claim(pos(unit, `startingUnits[${i}]`, radius), `startingUnits[${i}]`);
    });

    return errors;
  }

  function itemNumber(text) {
    const match = text.match(/\[(\d+)\]/);
    return match ? Number(match[1]) + 1 : '';
  }

  function humanUnit(type) {
    return UNIT_NAMES[type] || type;
  }

  function humanKind(kind) {
    return CONTROL_POINT_NAMES[kind] || kind;
  }

  function humanField(key) {
    const names = {
      name: '名称',
      description: '描述',
      radius: '半径',
      q: 'q 坐标',
      r: 'r 坐标',
      terrain: '地形',
      id: 'ID',
      kind: '类型',
      owner: '归属玩家',
      type: '单位类型',
      hp: '生命值',
      attack: '攻击',
      defense: '防御',
      moveRange: '移动范围',
      attackRange: '攻击范围',
      cost: '费用',
      canCapture: '可占点',
      healPower: '治疗量',
      startingSupplies: '初始金币',
      baseIncome: '每回合基础收入',
      controlPointIncome: '普通据点收入',
      damageVarianceRange: '伤害浮动',
      minimumDamage: '最低伤害',
      healVarianceRange: '治疗浮动',
      actionsPerTurn: '每回合行动点',
      maxTurns: '最大回合',
      enemyHqDamage: '敌方总部伤害权重',
      ownHqHp: '己方总部血量权重',
      controlPoint: '据点数量权重',
      armyValue: '兵力价值权重',
      supplies: '金币权重',
      income: '收入',
      deployDiscount: '部署折扣',
      repairAmount: '维修量',
    };
    return names[key] || key;
  }

  function humanContext(ctx) {
    let text = String(ctx).replace(/^Map "[^"]+"\.?/, '');
    if (!text) return '地图';
    let match = text.match(/^units\.(\w+)$/);
    if (match) return `${humanUnit(match[1])}规格`;
    match = text.match(/^headquarters\.(player_[ab])$/);
    if (match) return `${match[1] === 'player_a' ? '玩家 A' : '玩家 B'} 总部`;
    match = text.match(/^terrainCells\[(\d+)\]$/);
    if (match) return `地形格 ${Number(match[1]) + 1}`;
    match = text.match(/^controlPoints\[(\d+)\]$/);
    if (match) return `据点 ${Number(match[1]) + 1}`;
    match = text.match(/^startingUnits\[(\d+)\]$/);
    if (match) return `初始单位 ${Number(match[1]) + 1}`;
    match = text.match(/^balance\.controlPointTypes\.(\w+)$/);
    if (match) return `${humanKind(match[1])}据点类型`;
    if (text === 'units') return '单位规格';
    if (text === 'headquarters') return '总部配置';
    if (text === 'headquartersSpec') return '总部规格';
    if (text === 'balance') return '平衡设置';
    if (text === 'balance.adjudicationWeights') return '裁决权重';
    if (text === 'balance.controlPointTypes') return '据点类型配置';
    return text;
  }

  function formatValidationError(error) {
    let match = error.match(/^(.+) must be an object$/);
    if (match) return `${humanContext(match[1])}必须是对象。`;
    match = error.match(/^(.+)\.(\w+) must be a non-empty string$/);
    if (match) return `${humanContext(match[1])}的${humanField(match[2])}不能为空。`;
    match = error.match(/^(.+)\.(\w+) must be a number >= (-?Infinity|\d+)$/);
    if (match) return `${humanContext(match[1])}的${humanField(match[2])}必须是大于等于 ${match[3]} 的数字。`;
    match = error.match(/^(.+) q\/r must be integers$/);
    if (match) return `${humanContext(match[1])} 的 q/r 坐标必须是整数。`;
    match = error.match(/^(.+) \((-?\d+),(-?\d+)\) is outside radius (\d+)$/);
    if (match) return `${humanContext(match[1])} 的坐标 (${match[2]},${match[3]}) 超出地图半径 ${match[4]}。`;
    match = error.match(/^(.+) overlaps another fixed map object at (-?\d+),(-?\d+)$/);
    if (match) return `${humanContext(match[1])} 与另一个固定对象重叠，位置为 ${match[2]},${match[3]}。`;
    match = error.match(/^(.+)\.(actionsPerTurn|maxTurns|adjudicationWeights) is required$/);
    if (match) return `${humanContext(match[1])}缺少${humanField(match[2])}。`;
    match = error.match(/^(.+)\.terrainCells must be an array$/);
    if (match) return '地形格列表必须是数组。';
    match = error.match(/^terrainCells\[(\d+)\]\.terrain must be plain, water, or blocker$/);
    if (match) return `地形格 ${Number(match[1]) + 1} 的地形必须是平地、水域或阻挡。`;
    match = error.match(/^(.+)\.controlPoints must be a non-empty array$/);
    if (match) return '地图必须至少有 1 个据点。';
    match = error.match(/^controlPoints\[(\d+)\]\.kind must be supply, forward_base, or repair$/);
    if (match) return `据点 ${Number(match[1]) + 1} 的类型必须是补给站、前线基地或维修站。`;
    match = error.match(/^(.+)\.balance\.controlPointTypes is required when control points use kind$/);
    if (match) return '据点使用类型时，必须配置三种据点类型的效果。';
    match = error.match(/^(.+)\.controlPoints must all define kind when any control point is typed$/);
    if (match) return '如果任意据点设置了类型，所有据点都必须设置类型。';
    match = error.match(/^(.+)\.startingUnits must be an array$/);
    if (match) return '初始单位列表必须是数组。';
    match = error.match(/^startingUnits\[(\d+)\]\.owner invalid$/);
    if (match) return `初始单位 ${Number(match[1]) + 1} 的归属玩家无效。`;
    match = error.match(/^startingUnits\[(\d+)\]\.type invalid$/);
    if (match) return `初始单位 ${Number(match[1]) + 1} 的单位类型无效。`;
    if (error.includes('grid must be "hex"')) return '地图网格必须是 hex。';
    if (error.includes('orientation must be "pointy"')) return '地图方向必须是 pointy。';
    if (error.includes('radius must be an integer')) return '地图半径必须是整数。';
    if (error.includes('.canCapture must be boolean')) {
      const unit = error.match(/^units\.(\w+)/)?.[1];
      return `${humanUnit(unit)}规格的可占点必须是布尔值。`;
    }
    return error;
  }

  function resizeMapRadius(config, radius, confirmRemoval) {
    const nextRadius = Math.max(1, Math.floor(Number(radius) || 1));
    const copy = deepClone(config);
    const outside = [];
    const collect = (item, group) => {
      if (!isValidHex(item, nextRadius)) outside.push({ group, item });
    };
    (copy.terrainCells || []).forEach(item => collect(item, 'terrainCells'));
    (copy.controlPoints || []).forEach(item => collect(item, 'controlPoints'));
    (copy.startingUnits || []).forEach(item => collect(item, 'startingUnits'));
    for (const player of ['player_a', 'player_b']) collect(copy.headquarters[player], `headquarters.${player}`);
    if (outside.length && !confirmRemoval) return { config: copy, removed: outside.length, requiresConfirmation: true };
    copy.radius = nextRadius;
    copy.terrainCells = (copy.terrainCells || []).filter(item => isValidHex(item, nextRadius));
    copy.controlPoints = (copy.controlPoints || []).filter(item => isValidHex(item, nextRadius));
    copy.startingUnits = (copy.startingUnits || []).filter(item => isValidHex(item, nextRadius));
    for (const player of ['player_a', 'player_b']) {
      if (!isValidHex(copy.headquarters[player], nextRadius)) copy.headquarters[player] = { q: player === 'player_a' ? -nextRadius : nextRadius, r: 0 };
    }
    return { config: copy, removed: outside.length, requiresConfirmation: false };
  }

  function createCellsFromConfig(config) {
    const terrain = new Map((config.terrainCells || []).map(cell => [hexKey(cell), cell.terrain]));
    return allCells(config.radius).map(cell => ({ ...cell, terrain: terrain.get(hexKey(cell)) || 'plain' }));
  }

  const core = {
    createDefaultMapConfig,
    normalizeImportedMap,
    serializeMapConfig,
    validateMapConfig,
    resizeMapRadius,
    formatValidationError,
    isValidHex,
    createCellsFromConfig,
  };

  global.MapEditorCore = core;

  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const els = {
    canvas: $('map-canvas'),
    status: $('status-text'),
    badge: $('validation-badge'),
    validationCount: $('validation-count'),
    validationList: $('validation-list'),
    cellReadout: $('cell-readout'),
    importFile: $('import-file'),
    mapName: $('map-name'),
    mapDescription: $('map-description'),
    mapRadius: $('map-radius'),
    toolOwner: $('tool-owner'),
    toolUnitType: $('tool-unit-type'),
    toolControlKind: $('tool-control-kind'),
    toolHint: $('tool-hint'),
    selectionTitle: $('selection-title'),
    selectionFields: $('selection-fields'),
    balanceFields: $('balance-fields'),
    unitSpecFields: $('unit-spec-fields'),
    controlTypeFields: $('control-type-fields'),
  };
  const ctx = els.canvas.getContext('2d');
  let config = createDefaultMapConfig();
  let tool = 'select';
  let hoverCell = null;
  let selected = null;
  let zoom = 1;
  let layout = { minX: 0, minY: 0, width: 840, height: 840 };

  function setStatus(message) {
    els.status.textContent = message;
  }

  function applyZoom() {
    els.canvas.style.width = `${Math.round(els.canvas.width * zoom)}px`;
    els.canvas.style.height = `${Math.round(els.canvas.height * zoom)}px`;
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setZoom(nextZoom) {
    zoom = Math.min(2.5, Math.max(0.4, Math.round(nextZoom * 100) / 100));
    applyZoom();
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function hexToRaw(q, r) {
    return { x: HEX_SIZE * SQRT3 * (q + r / 2), y: HEX_SIZE * 1.5 * r };
  }

  function hexCornersRaw(q, r) {
    const c = hexToRaw(q, r);
    return Array.from({ length: 6 }, (_, i) => {
      const angle = Math.PI / 180 * (60 * i - 30);
      return { x: c.x + HEX_SIZE * Math.cos(angle), y: c.y + HEX_SIZE * Math.sin(angle) };
    });
  }

  function computeLayout() {
    const pts = allCells(config.radius).flatMap(cell => hexCornersRaw(cell.q, cell.r));
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    layout = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      width: Math.ceil(Math.max(...xs) - Math.min(...xs) + PAD * 2),
      height: Math.ceil(Math.max(...ys) - Math.min(...ys) + PAD * 2),
    };
    els.canvas.width = layout.width;
    els.canvas.height = layout.height;
    applyZoom();
  }

  function hexToPixel(q, r) {
    const raw = hexToRaw(q, r);
    return { x: raw.x - layout.minX + PAD, y: raw.y - layout.minY + PAD };
  }

  function cubeRound(q, r) {
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const xd = Math.abs(rx - x), yd = Math.abs(ry - y), zd = Math.abs(rz - z);
    if (xd > yd && xd > zd) rx = -ry - rz;
    else if (yd > zd) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
  }

  function pixelToHex(px, py) {
    const x = px + layout.minX - PAD;
    const y = py + layout.minY - PAD;
    return cubeRound((SQRT3 / 3 * x - y / 3) / HEX_SIZE, (2 * y / 3) / HEX_SIZE);
  }

  function eventPoint(e) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (els.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (els.canvas.height / rect.height),
    };
  }

  function pathHex(q, r, inset = 0) {
    const c = hexToPixel(q, r);
    const size = HEX_SIZE - inset;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i - 30);
      const x = c.x + size * Math.cos(angle);
      const y = c.y + size * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function terrainAt(pos) {
    return (config.terrainCells || []).find(cell => cell.q === pos.q && cell.r === pos.r)?.terrain || 'plain';
  }

  function setTerrain(pos, terrain) {
    if (!isValidHex(pos, config.radius)) return false;
    config.terrainCells = (config.terrainCells || []).filter(cell => !(cell.q === pos.q && cell.r === pos.r));
    if (terrain !== 'plain') config.terrainCells.push({ q: pos.q, r: pos.r, terrain });
    return true;
  }

  function objectAt(pos) {
    for (const player of ['player_a', 'player_b']) {
      const hq = config.headquarters[player];
      if (hq.q === pos.q && hq.r === pos.r) return { type: 'headquarters', player, object: hq };
    }
    const cpIndex = config.controlPoints.findIndex(point => point.q === pos.q && point.r === pos.r);
    if (cpIndex >= 0) return { type: 'controlPoint', index: cpIndex, object: config.controlPoints[cpIndex] };
    const unitIndex = config.startingUnits.findIndex(unit => unit.q === pos.q && unit.r === pos.r);
    if (unitIndex >= 0) return { type: 'startingUnit', index: unitIndex, object: config.startingUnits[unitIndex] };
    return null;
  }

  function hasFixedObjectAt(pos, ignore) {
    const hit = objectAt(pos);
    if (!hit) return false;
    if (!ignore) return true;
    return !(hit.type === ignore.type && hit.index === ignore.index && hit.player === ignore.player);
  }

  function canPlace(pos, ignore) {
    return isValidHex(pos, config.radius) && !hasFixedObjectAt(pos, ignore);
  }

  function nextControlPointId() {
    let i = config.controlPoints.length + 1;
    const ids = new Set(config.controlPoints.map(point => point.id));
    while (ids.has(`cp_${i}`)) i += 1;
    return `cp_${i}`;
  }

  function selectObject(hit, pos) {
    selected = hit ? { ...hit } : { type: 'cell', object: { q: pos.q, r: pos.r } };
    renderSelection();
    drawBoard();
  }

  function placeAt(pos) {
    if (!isValidHex(pos, config.radius)) return;
    if (tool === 'plain' || tool === 'water' || tool === 'blocker') {
      setTerrain(pos, tool);
      selected = { type: 'cell', object: { q: pos.q, r: pos.r } };
    } else if (tool === 'hq') {
      const player = els.toolOwner.value;
      const ignore = { type: 'headquarters', player };
      if (!canPlace(pos, ignore)) return setStatus('该格已有固定对象，不能放置总部');
      config.headquarters[player] = { q: pos.q, r: pos.r };
      selected = { type: 'headquarters', player, object: config.headquarters[player] };
    } else if (tool === 'control') {
      if (!canPlace(pos)) return setStatus('该格已有固定对象，不能放置据点');
      const kind = els.toolControlKind.value;
      const point = { id: nextControlPointId(), name: `据点 ${config.controlPoints.length + 1}`, ...(kind ? { kind } : {}), q: pos.q, r: pos.r };
      config.controlPoints.push(point);
      selected = { type: 'controlPoint', index: config.controlPoints.length - 1, object: point };
    } else if (tool === 'unit') {
      if (!canPlace(pos)) return setStatus('该格已有固定对象，不能放置初始单位');
      const unit = { owner: els.toolOwner.value, type: els.toolUnitType.value, q: pos.q, r: pos.r };
      config.startingUnits.push(unit);
      selected = { type: 'startingUnit', index: config.startingUnits.length - 1, object: unit };
    } else if (tool === 'delete') {
      deleteAt(pos);
    } else {
      selectObject(objectAt(pos), pos);
    }
    syncAll();
  }

  function deleteAt(pos) {
    const hit = objectAt(pos);
    if (!hit) {
      setTerrain(pos, 'plain');
      selected = { type: 'cell', object: { q: pos.q, r: pos.r } };
      return;
    }
    if (hit.type === 'headquarters') return setStatus('双方总部必须存在，可用总部工具移动位置');
    if (hit.type === 'controlPoint') config.controlPoints.splice(hit.index, 1);
    if (hit.type === 'startingUnit') config.startingUnits.splice(hit.index, 1);
    selected = null;
  }

  function drawBoard() {
    computeLayout();
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
    for (const cell of allCells(config.radius)) {
      pathHex(cell.q, cell.r, 1);
      ctx.fillStyle = TERRAIN_COLORS[terrainAt(cell)] || TERRAIN_COLORS.plain;
      ctx.fill();
      ctx.strokeStyle = '#20313d';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (hoverCell) {
      pathHex(hoverCell.q, hoverCell.r, 2);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fill();
    }
    for (const point of config.controlPoints) drawControlPoint(point);
    for (const player of ['player_a', 'player_b']) drawHeadquarters(player, config.headquarters[player]);
    for (const unit of config.startingUnits) drawUnit(unit);
  }

  function drawToken(pos, fill, label, stroke = '#071016') {
    const p = hexToPixel(pos.q, pos.r);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#071016';
    ctx.font = 'bold 10px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x, p.y);
  }

  function drawHeadquarters(player, hq) {
    const p = hexToPixel(hq.q, hq.r);
    ctx.fillStyle = OWNER_COLORS[player];
    ctx.strokeStyle = '#071016';
    ctx.lineWidth = 2;
    ctx.fillRect(p.x - 14, p.y - 14, 28, 28);
    ctx.strokeRect(p.x - 14, p.y - 14, 28, 28);
    ctx.fillStyle = '#071016';
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player === 'player_a' ? 'A HQ' : 'B HQ', p.x, p.y);
  }

  function drawControlPoint(point) {
    drawToken(point, '#d6b34a', CONTROL_POINT_LABELS[point.kind] || 'CP');
  }

  function drawUnit(unit) {
    drawToken(unit, OWNER_COLORS[unit.owner] || '#d8e0e8', UNIT_LABELS[unit.type] || 'U');
  }

  function bindNumberInput(input, getValue, setValue, min = 0) {
    input.value = getValue();
    input.addEventListener('change', () => {
      const value = Number(input.value);
      setValue(Number.isFinite(value) ? Math.max(min, value) : min);
      syncAll();
    });
  }

  function renderGlobalFields() {
    els.mapName.value = config.name;
    els.mapDescription.value = config.description;
    els.mapRadius.value = config.radius;
  }

  function renderBalanceFields() {
    els.balanceFields.innerHTML = [
      ...BALANCE_KEYS.map(([key, label, min]) => fieldHtml(`balance:${key}`, label, config.balance[key], min)),
      ...WEIGHT_KEYS.map(([key, label]) => fieldHtml(`weight:${key}`, `裁决 ${label}`, config.balance.adjudicationWeights[key], 0)),
      fieldHtml('hq:hp', '总部 HP', config.headquartersSpec.hp, 1),
      fieldHtml('hq:defense', '总部防御', config.headquartersSpec.defense, 0),
    ].join('');
    els.balanceFields.querySelectorAll('input[data-bind]').forEach(input => {
      input.addEventListener('change', () => {
        const [group, key] = input.dataset.bind.split(':');
        const value = Math.max(Number(input.min || 0), Number(input.value) || 0);
        if (group === 'balance') config.balance[key] = value;
        if (group === 'weight') config.balance.adjudicationWeights[key] = value;
        if (group === 'hq') config.headquartersSpec[key] = value;
        syncAll();
      });
    });
  }

  function fieldHtml(bind, label, value, min) {
    return `<label>${esc(label)} <input data-bind="${esc(bind)}" type="number" min="${min}" value="${esc(value)}" /></label>`;
  }

  function renderUnitSpecs() {
    els.unitSpecFields.innerHTML = UNIT_TYPES.map(type => {
      const spec = config.units[type];
      const fields = ['hp', 'attack', 'defense', 'moveRange', 'attackRange', 'cost', 'healPower']
        .filter(key => key !== 'healPower' || type === 'support' || key in spec)
        .map(key => fieldHtml(`unit:${type}:${key}`, key, spec[key] ?? 0, 0)).join('');
      return `<div class="spec-card"><h3>${esc(UNIT_NAMES[type])}</h3><div class="field-grid compact">${fields}
        <label>可占点 <select data-bind="unit:${esc(type)}:canCapture"><option value="true"${spec.canCapture ? ' selected' : ''}>是</option><option value="false"${!spec.canCapture ? ' selected' : ''}>否</option></select></label>
      </div></div>`;
    }).join('');
    els.unitSpecFields.querySelectorAll('[data-bind]').forEach(input => {
      input.addEventListener('change', () => {
        const [, type, key] = input.dataset.bind.split(':');
        config.units[type][key] = key === 'canCapture' ? input.value === 'true' : Math.max(0, Number(input.value) || 0);
        syncAll();
      });
    });
  }

  function renderControlTypes() {
    if (!config.balance.controlPointTypes) config.balance.controlPointTypes = defaultControlPointTypes();
    els.controlTypeFields.innerHTML = CONTROL_POINT_KINDS.map(kind => {
      const spec = config.balance.controlPointTypes[kind];
      return `<div class="spec-card"><h3>${esc(CONTROL_POINT_NAMES[kind])}</h3><div class="field-grid compact">
        ${fieldHtml(`cpType:${kind}:income`, '收入', spec.income, 0)}
        ${fieldHtml(`cpType:${kind}:deployDiscount`, '部署折扣', spec.deployDiscount, 0)}
        ${fieldHtml(`cpType:${kind}:repairAmount`, '维修量', spec.repairAmount, 0)}
      </div></div>`;
    }).join('');
    els.controlTypeFields.querySelectorAll('input[data-bind]').forEach(input => {
      input.addEventListener('change', () => {
        const [, kind, key] = input.dataset.bind.split(':');
        config.balance.controlPointTypes[kind][key] = Math.max(0, Number(input.value) || 0);
        syncAll();
      });
    });
  }

  function renderSelection() {
    if (!selected) {
      els.selectionTitle.textContent = '未选择';
      els.selectionFields.className = 'selection-fields empty';
      els.selectionFields.textContent = '点击棋盘上的格子或对象进行编辑';
      return;
    }
    els.selectionFields.className = 'selection-fields';
    if (selected.type === 'cell') {
      const pos = selected.object;
      els.selectionTitle.textContent = `格子 ${pos.q},${pos.r}`;
      els.selectionFields.innerHTML = `<div class="field-grid compact">
        <label>地形 <select id="sel-terrain"><option value="plain">平地</option><option value="water">水域</option><option value="blocker">阻挡</option></select></label>
      </div>`;
      $('sel-terrain').value = terrainAt(pos);
      $('sel-terrain').addEventListener('change', e => { setTerrain(pos, e.target.value); syncAll(); });
      return;
    }
    const obj = selected.type === 'headquarters'
      ? config.headquarters[selected.player]
      : selected.type === 'controlPoint'
        ? config.controlPoints[selected.index]
        : config.startingUnits[selected.index];
    selected.object = obj;
    els.selectionTitle.textContent = selected.type === 'headquarters' ? `总部 ${selected.player}` : selected.type === 'controlPoint' ? `据点 ${obj.id}` : `${obj.owner} ${UNIT_NAMES[obj.type]}`;
    const base = `<div class="field-grid compact">
      <label>q <input id="sel-q" type="number" value="${esc(obj.q)}" /></label>
      <label>r <input id="sel-r" type="number" value="${esc(obj.r)}" /></label>
    </div>`;
    const detail = selected.type === 'controlPoint'
      ? `<label>ID <input id="sel-id" value="${esc(obj.id)}" /></label><label>名称 <input id="sel-name" value="${esc(obj.name)}" /></label>
        <label>类型 <select id="sel-kind"><option value="">普通据点</option>${CONTROL_POINT_KINDS.map(k => `<option value="${k}">${esc(CONTROL_POINT_NAMES[k])}</option>`).join('')}</select></label>`
      : selected.type === 'startingUnit'
        ? `<div class="field-grid compact"><label>玩家 <select id="sel-owner"><option value="player_a">player_a</option><option value="player_b">player_b</option></select></label>
          <label>单位 <select id="sel-type">${UNIT_TYPES.map(type => `<option value="${type}">${esc(UNIT_NAMES[type])}</option>`).join('')}</select></label></div>`
        : '';
    const canDelete = selected.type !== 'headquarters';
    els.selectionFields.innerHTML = `${detail}${base}<div class="selection-actions"><button id="sel-apply" type="button">应用</button>${canDelete ? '<button id="sel-delete" class="danger" type="button">删除</button>' : ''}</div>`;
    if ($('sel-kind')) $('sel-kind').value = obj.kind || '';
    if ($('sel-owner')) $('sel-owner').value = obj.owner;
    if ($('sel-type')) $('sel-type').value = obj.type;
    $('sel-apply').addEventListener('click', () => applySelectionEdit());
    if ($('sel-delete')) $('sel-delete').addEventListener('click', () => { deleteAt(obj); syncAll(); });
  }

  function applySelectionEdit() {
    if (!selected) return;
    const obj = selected.type === 'headquarters'
      ? config.headquarters[selected.player]
      : selected.type === 'controlPoint'
        ? config.controlPoints[selected.index]
        : config.startingUnits[selected.index];
    const next = { q: Number($('sel-q').value), r: Number($('sel-r').value) };
    if (!canPlace(next, selected)) return setStatus('目标格越界或已有固定对象');
    obj.q = next.q;
    obj.r = next.r;
    if (selected.type === 'controlPoint') {
      obj.id = $('sel-id').value.trim() || obj.id;
      obj.name = $('sel-name').value.trim() || obj.name;
      const kind = $('sel-kind').value;
      if (kind) obj.kind = kind;
      else delete obj.kind;
    }
    if (selected.type === 'startingUnit') {
      obj.owner = $('sel-owner').value;
      obj.type = $('sel-type').value;
    }
    syncAll();
  }

  function renderValidation() {
    const serialized = serializeMapConfig(config);
    const errors = validateMapConfig(serialized, 'editor');
    els.badge.textContent = errors.length ? `${errors.length} 个问题` : '可导出';
    els.badge.className = `status-badge ${errors.length ? 'invalid' : 'valid'}`;
    els.validationCount.textContent = `${errors.length} 个问题`;
    els.validationList.innerHTML = errors.length ? errors.map(error => `<li>${esc(formatValidationError(error))}</li>`).join('') : '<li>地图配置有效</li>';
    return errors;
  }

  function syncAll() {
    renderGlobalFields();
    renderBalanceFields();
    renderUnitSpecs();
    renderControlTypes();
    renderSelection();
    renderValidation();
    drawBoard();
  }

  function exportJson() {
    const serialized = serializeMapConfig(config);
    const errors = validateMapConfig(serialized, 'export');
    if (errors.length) {
      setStatus('导出失败：请先修复校验问题');
      renderValidation();
      return;
    }
    downloadFile(`${serialized.name || 'map'}.json`, `${JSON.stringify(serialized, null, 2)}\n`, 'application/json');
    setStatus('地图 JSON 已导出');
  }

  function copyJson() {
    const serialized = serializeMapConfig(config);
    const errors = validateMapConfig(serialized, 'copy');
    if (errors.length) return setStatus('复制失败：请先修复校验问题');
    const text = `${JSON.stringify(serialized, null, 2)}\n`;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => setStatus('地图 JSON 已复制'));
    else setStatus('当前浏览器不支持剪贴板复制');
  }

  function importJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        config = normalizeImportedMap(JSON.parse(reader.result));
        selected = null;
        syncAll();
        setStatus(`已导入 ${file.name}`);
      } catch (err) {
        setStatus(`导入失败：${err.message}`);
      } finally {
        els.importFile.value = '';
      }
    };
    reader.onerror = () => setStatus('读取文件失败');
    reader.readAsText(file);
  }

  document.querySelectorAll('.tool-button').forEach(button => {
    button.addEventListener('click', () => {
      tool = button.dataset.tool;
      document.querySelectorAll('.tool-button').forEach(btn => btn.classList.toggle('active', btn === button));
      els.toolHint.textContent = button.textContent;
    });
  });
  document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(zoom + 0.1));
  document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(zoom - 0.1));
  document.getElementById('btn-zoom-reset').addEventListener('click', () => setZoom(1));

  els.mapName.addEventListener('input', () => { config.name = els.mapName.value; renderValidation(); });
  els.mapDescription.addEventListener('input', () => { config.description = els.mapDescription.value; renderValidation(); });
  els.mapRadius.addEventListener('change', () => {
    const next = Number(els.mapRadius.value);
    const preview = resizeMapRadius(config, next, false);
    if (preview.requiresConfirmation && !confirm(`半径缩小会移除 ${preview.removed} 个半径外对象或地形，是否继续？`)) {
      els.mapRadius.value = config.radius;
      return;
    }
    config = resizeMapRadius(config, next, true).config;
    selected = null;
    syncAll();
  });
  $('btn-new').addEventListener('click', () => {
    if (!confirm('新建会清空当前编辑内容，是否继续？')) return;
    config = createDefaultMapConfig();
    selected = null;
    syncAll();
    setStatus('已新建地图');
  });
  $('btn-import').addEventListener('click', () => els.importFile.click());
  $('btn-export').addEventListener('click', exportJson);
  $('btn-copy-json').addEventListener('click', copyJson);
  els.importFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importJsonFile(file);
  });
  els.canvas.addEventListener('mousemove', e => {
    const point = eventPoint(e);
    const cell = pixelToHex(point.x, point.y);
    hoverCell = isValidHex(cell, config.radius) ? cell : null;
    els.cellReadout.textContent = hoverCell ? `坐标 ${hoverCell.q}, ${hoverCell.r} · ${terrainAt(hoverCell)}` : '坐标 -';
    drawBoard();
  });
  els.canvas.addEventListener('mouseleave', () => {
    hoverCell = null;
    els.cellReadout.textContent = '坐标 -';
    drawBoard();
  });
  els.canvas.addEventListener('click', e => {
    const point = eventPoint(e);
    const cell = pixelToHex(point.x, point.y);
    placeAt(cell);
  });

  syncAll();
})(typeof globalThis !== 'undefined' ? globalThis : window);
