(function initMapEditor(global) {
  const SQRT3 = Math.sqrt(3);
  const HEX_SIZE = 34;
  const PAD = 48;
  // 与观战/玩家棋盘（app.js）一致的地形与阵营配色
  const TERRAIN_COLORS = { plain: '#111923', water: '#183a55', blocker: '#393f46' };
  const SLOT_COLORS = ['#66ccff', '#ff9966', '#9fdf6f', '#d98cff', '#ffd166', '#72e0d1', '#f27a9a', '#a7b7ff'];
  const OWNER_COLORS = { player_a: SLOT_COLORS[0], player_b: SLOT_COLORS[1] };
  const UNIT_TYPES = ['infantry', 'scout', 'heavy', 'ranger', 'support'];
  const UNIT_NAMES = { infantry: '步兵', scout: '侦察兵', heavy: '重装', ranger: '远程兵', support: '支援兵' };
  const CONTROL_POINT_KINDS = ['supply', 'forward_base', 'repair'];
  const CONTROL_POINT_NAMES = { supply: '补给站', forward_base: '前线基地', repair: '维修站' };
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
    ['effectiveActions', '有效行动'],
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

  function playableCells(config) {
    return Array.isArray(config.playableCells) ? config.playableCells : allCells(config.radius);
  }

  function isPlayableCell(config, pos) {
    return playableCells(config).some(cell => cell.q === pos.q && cell.r === pos.r);
  }

  function materializePlayableCells(config) {
    if (!Array.isArray(config.playableCells)) config.playableCells = allCells(config.radius);
    return config.playableCells;
  }

  function arePlayableCellsConnected(cells) {
    if (!Array.isArray(cells) || cells.length === 0) return false;
    const remaining = new Set(cells.map(hexKey));
    const queue = [{ ...cells[0] }];
    remaining.delete(hexKey(cells[0]));
    const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    for (let index = 0; index < queue.length; index++) {
      for (const [dq, dr] of directions) {
        const next = { q: queue[index].q + dq, r: queue[index].r + dr };
        const key = hexKey(next);
        if (!remaining.delete(key)) continue;
        queue.push(next);
      }
    }
    return remaining.size === 0;
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
        effectiveActions: 2,
      },
      controlPointTypes: defaultControlPointTypes(),
    };
  }

  function defaultAnnihilation(radius = 8) {
    return {
      artillery: {
        startRound: 5,
        intervalRounds: 2,
        damage: 25,
        minimumSafeRadius: Math.min(2, Math.max(1, radius - 1)),
      },
    };
  }

  function createDefaultMapConfig() {
    return {
      mode: 'standard',
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

  function normalizeAnnihilation(input, radius) {
    const defaults = defaultAnnihilation(radius);
    const artillery = input && typeof input === 'object' && input.artillery && typeof input.artillery === 'object'
      ? input.artillery
      : {};
    return {
      artillery: {
        startRound: numberOrDefault(artillery.startRound, defaults.artillery.startRound),
        intervalRounds: numberOrDefault(artillery.intervalRounds, defaults.artillery.intervalRounds),
        damage: numberOrDefault(artillery.damage, defaults.artillery.damage),
        minimumSafeRadius: numberOrDefault(artillery.minimumSafeRadius, defaults.artillery.minimumSafeRadius),
      },
    };
  }

  function enableSpawnMode(target) {
    if (target.spawnMode && Array.isArray(target.spawnSlots)) return target;
    target.spawnMode = true;
    target.spawnSlots = ['player_a', 'player_b'].map(player => ({
      id: `slot_${player.slice(-1)}`,
      headquarters: { ...target.headquarters[player] },
      startingUnits: (target.startingUnits || [])
        .filter(unit => unit.owner === player)
        .map(({ owner: _owner, ...unit }) => ({ ...unit })),
    }));
    target.layouts = { 2: target.spawnSlots.map(slot => slot.id) };
    return target;
  }

  function configureMapMode(input, mode, annihilationDraft = null) {
    if (mode !== 'standard' && mode !== 'annihilation' && mode !== 'simultaneous') {
      throw new Error('玩法模式必须是 standard、annihilation 或 simultaneous');
    }
    const configured = deepClone(input);
    const previousMode = configured.mode === 'annihilation' ? 'annihilation' : 'standard';
    const previousDefaultWeight = previousMode === 'annihilation' ? 10 : 2;
    const nextDefaultWeight = mode === 'annihilation' ? 10 : 2;
    if (configured.balance?.adjudicationWeights?.effectiveActions === previousDefaultWeight) {
      configured.balance.adjudicationWeights.effectiveActions = nextDefaultWeight;
    }
    configured.mode = mode;
    if (mode === 'annihilation') {
      configured.radius = Math.max(2, configured.radius);
      configured.annihilation = normalizeAnnihilation(annihilationDraft || configured.annihilation, configured.radius);
      enableSpawnMode(configured);
    } else if (mode === 'simultaneous') {
      // simultaneous 地图也使用总部出生槽布局，但没有炮火配置或出生据点绑定。
      enableSpawnMode(configured);
    } else {
      delete configured.annihilation;
    }
    return configured;
  }

  function updateSpawnControlPointReferences(target, previousId, nextId = null) {
    for (const slot of target.spawnSlots || []) {
      if (slot.controlPointId !== previousId) continue;
      if (nextId) slot.controlPointId = nextId;
      else delete slot.controlPointId;
    }
    return target;
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
    // 同时模式兵种改造字段：编辑器暂不提供编辑 UI，但导入/导出必须保留，避免往返丢失。
    for (const key of ['attackShape', 'healShape']) {
      const shape = src[key];
      if (shape && typeof shape === 'object' && ['single', 'line', 'arc'].includes(shape.type)) {
        spec[key] = { type: shape.type };
        if (Number.isInteger(shape.length)) spec[key].length = shape.length;
      }
    }
    if (typeof src.attackLock === 'boolean') spec.attackLock = src.attackLock;
    return spec;
  }

  function normalizeImportedMap(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('地图 JSON 必须是对象');
    const defaults = createDefaultMapConfig();
    const cfg = deepClone(data);
    const mode = cfg.mode === 'annihilation' || cfg.mode === 'simultaneous' ? cfg.mode : 'standard';
    const radius = Number.isInteger(cfg.radius) && cfg.radius > 0 ? cfg.radius : defaults.radius;
    const normalized = {
      mode,
      name: typeof cfg.name === 'string' && cfg.name ? cfg.name : defaults.name,
      description: typeof cfg.description === 'string' ? cfg.description : defaults.description,
      grid: 'hex',
      orientation: 'pointy',
      radius,
      ...(Array.isArray(cfg.playableCells)
        ? { playableCells: cfg.playableCells.map(cell => ({ q: cell.q, r: cell.r })) }
        : {}),
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
      spawnMode: Array.isArray(cfg.spawnSlots),
      spawnSlots: [],
      layouts: {},
      ...(mode === 'annihilation' ? { annihilation: normalizeAnnihilation(cfg.annihilation, radius) } : {}),
    };

    if (normalized.spawnMode) {
      normalized.spawnSlots = cfg.spawnSlots.map((slot, index) => ({
        id: typeof slot.id === 'string' && slot.id ? slot.id : `slot_${index + 1}`,
        headquarters: slot.headquarters && typeof slot.headquarters.q === 'number' && typeof slot.headquarters.r === 'number'
          ? { q: slot.headquarters.q, r: slot.headquarters.r }
          : null,
        ...(typeof slot.controlPointId === 'string' ? { controlPointId: slot.controlPointId } : {}),
        startingUnits: Array.isArray(slot.startingUnits)
          ? slot.startingUnits.map(unit => ({ type: unit.type, q: unit.q, r: unit.r }))
          : [],
      }));
      normalized.layouts = cfg.layouts && typeof cfg.layouts === 'object' ? deepClone(cfg.layouts) : {};
      const first = normalized.spawnSlots[0];
      const second = normalized.spawnSlots[1] || first;
      if (first) {
        const hqA = first.headquarters || { q: -radius, r: 0 };
        const hqB = second.headquarters || { q: radius, r: 0 };
        normalized.headquarters = {
          player_a: { ...hqA },
          player_b: { ...hqB },
        };
        normalized.startingUnits = [
          ...first.startingUnits.map(unit => ({ ...unit, owner: 'player_a' })),
          ...second.startingUnits.map(unit => ({ ...unit, owner: 'player_b' })),
        ];
      }
    } else {
      normalized.spawnSlots = ['player_a', 'player_b'].map(player => ({
        id: `slot_${player.slice(-1)}`,
        headquarters: { ...normalized.headquarters[player] },
        startingUnits: normalized.startingUnits
          .filter(unit => unit.owner === player)
          .map(({ owner: _owner, ...unit }) => ({ ...unit })),
      }));
      normalized.layouts = { 2: normalized.spawnSlots.map(slot => slot.id) };
    }

    for (const type of UNIT_TYPES) normalized.units[type] = normalizeUnitSpec(type, cfg.units?.[type]);
    const sourceBalance = cfg.balance && typeof cfg.balance === 'object' ? cfg.balance : {};
    for (const [key] of BALANCE_KEYS) normalized.balance[key] = numberOrDefault(sourceBalance[key], defaults.balance[key]);
    normalized.balance.adjudicationWeights = {};
    for (const [key] of WEIGHT_KEYS) {
      const fallback = key === 'effectiveActions' && normalized.mode === 'annihilation'
        ? 10
        : defaults.balance.adjudicationWeights[key];
      const sourceValue = key === 'effectiveActions'
        ? sourceBalance.adjudicationWeights?.effectiveActions ?? sourceBalance.adjudicationWeights?.actionPoints
        : sourceBalance.adjudicationWeights?.[key];
      normalized.balance.adjudicationWeights[key] = numberOrDefault(sourceValue, fallback);
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
    if (sourceBalance.comebackSupply && typeof sourceBalance.comebackSupply === 'object') {
      normalized.balance.comebackSupply = {
        startRound: numberOrDefault(sourceBalance.comebackSupply.startRound, 3),
        scoreGapPercent: numberOrDefault(sourceBalance.comebackSupply.scoreGapPercent, 40),
        amountPerRound: numberOrDefault(sourceBalance.comebackSupply.amountPerRound, 20),
      };
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
    if (config.balance?.comebackSupply) {
      balance.comebackSupply = {
        startRound: Number(config.balance.comebackSupply.startRound),
        scoreGapPercent: Number(config.balance.comebackSupply.scoreGapPercent),
        amountPerRound: Number(config.balance.comebackSupply.amountPerRound),
      };
    }
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

    const serialized = {
      ...(config.mode !== 'standard' ? { mode: config.mode } : {}),
      name: String(config.name || ''),
      description: String(config.description || ''),
      grid: 'hex',
      orientation: 'pointy',
      radius: Number(config.radius),
      ...(Array.isArray(config.playableCells)
        ? { playableCells: sortPositions(config.playableCells.map(cell => ({ q: Number(cell.q), r: Number(cell.r) }))) }
        : {}),
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
      units,
      headquartersSpec: {
        hp: Number(config.headquartersSpec?.hp ?? 0),
        defense: Number(config.headquartersSpec?.defense ?? 0),
      },
      balance,
      ...(config.mode === 'annihilation' && config.annihilation ? { annihilation: deepClone(config.annihilation) } : {}),
    };
    if (config.spawnMode) {
      serialized.spawnSlots = (config.spawnSlots || []).map((slot, index) => ({
        id: String(slot.id || `slot_${index + 1}`),
        headquarters: { q: Number(slot.headquarters?.q), r: Number(slot.headquarters?.r) },
        ...(typeof slot.controlPointId === 'string' ? { controlPointId: slot.controlPointId } : {}),
        startingUnits: (slot.startingUnits || []).map(unit => ({
          type: unit.type,
          q: Number(unit.q),
          r: Number(unit.r),
        })),
      }));
      serialized.layouts = Object.fromEntries(Object.entries(config.layouts || {})
        .filter(([, slots]) => Array.isArray(slots))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([count, slots]) => [count, [...slots]]));
    } else {
      serialized.headquarters = {
        player_a: { q: Number(config.headquarters?.player_a?.q), r: Number(config.headquarters?.player_a?.r) },
        player_b: { q: Number(config.headquarters?.player_b?.q), r: Number(config.headquarters?.player_b?.r) },
      };
      serialized.startingUnits = (config.startingUnits || []).map(unit => ({
        owner: unit.owner,
        type: unit.type,
        q: Number(unit.q),
        r: Number(unit.r),
      }));
    }
    return serialized;
  }

  function validateMapConfig(config, id = 'map') {
    const errors = [];
    const c = config && typeof config === 'object' ? deepClone(config) : {};
    if (Array.isArray(c.spawnSlots)) {
      const first = c.spawnSlots[0];
      const second = c.spawnSlots[1] || first;
      c.headquarters = c.headquarters || {
        player_a: first?.headquarters,
        player_b: second?.headquarters,
      };
      c.startingUnits = c.startingUnits || [
        ...(first?.startingUnits || []).map(unit => ({ ...unit, owner: 'player_a' })),
        ...(second?.startingUnits || []).map(unit => ({ ...unit, owner: 'player_b' })),
      ];
    }
    const mapName = `Map "${id}"`;
    let playableKeys = null;
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
      else if (playableKeys && !playableKeys.has(`${q},${r}`)) errors.push(`${ctx} (${q},${r}) is outside playableCells`);
      return { q, r };
    }
    function claim(posValue, ctx) {
      const key = `${posValue.q},${posValue.r}`;
      if (occupied.has(key)) errors.push(`${ctx} overlaps another fixed map object at ${key}`);
      occupied.add(key);
    }

    const mode = c.mode === undefined ? 'standard' : c.mode;
    if (mode !== 'standard' && mode !== 'annihilation' && mode !== 'simultaneous') {
      errors.push(`${mapName}.mode must be standard, annihilation, or simultaneous`);
    }
    str(c, 'name', mapName);
    str(c, 'description', mapName);
    if (c.grid !== 'hex') errors.push(`${mapName} grid must be "hex"`);
    if (c.orientation !== 'pointy') errors.push(`${mapName} orientation must be "pointy"`);
    const radius = num(c, 'radius', mapName, 1);
    if (!Number.isInteger(radius)) errors.push(`${mapName} radius must be an integer`);

    if (mode === 'annihilation') {
      const annihilation = record(c.annihilation, `${mapName}.annihilation`);
      const artillery = record(annihilation.artillery, `${mapName}.annihilation.artillery`);
      for (const key of ['startRound', 'intervalRounds', 'damage', 'minimumSafeRadius']) {
        const value = num(artillery, key, `${mapName}.annihilation.artillery`, 1);
        if (!Number.isInteger(value)) errors.push(`${mapName}.annihilation.artillery.${key} must be an integer`);
      }
      if (artillery.minimumSafeRadius >= radius) {
        errors.push(`${mapName}.annihilation.artillery.minimumSafeRadius must be smaller than radius`);
      }
    } else if ('annihilation' in c) {
      errors.push(`${mapName}.annihilation is only valid in annihilation mode`);
    }

    const sourcePlayableCells = 'playableCells' in c ? c.playableCells : allCells(radius);
    if (!Array.isArray(sourcePlayableCells) || sourcePlayableCells.length === 0) {
      errors.push(`${mapName}.playableCells must be a non-empty array`);
      playableKeys = new Set();
    } else {
      playableKeys = new Set();
      sourcePlayableCells.forEach((cellValue, index) => {
        const cell = record(cellValue, `playableCells[${index}]`);
        const q = num(cell, 'q', `playableCells[${index}]`, -Infinity);
        const r = num(cell, 'r', `playableCells[${index}]`, -Infinity);
        if (!Number.isInteger(q) || !Number.isInteger(r)) errors.push(`playableCells[${index}] q/r must be integers`);
        else if (!isValidHex({ q, r }, radius)) errors.push(`playableCells[${index}] (${q},${r}) is outside radius ${radius}`);
        const key = `${q},${r}`;
        if (playableKeys.has(key)) errors.push(`playableCells[${index}] duplicates ${key}`);
        playableKeys.add(key);
      });
      if (!arePlayableCellsConnected(sourcePlayableCells)) errors.push(`${mapName}.playableCells must form one connected area`);
    }

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
    if ('comebackSupply' in balance) {
      const comeback = record(balance.comebackSupply, `${mapName}.balance.comebackSupply`);
      for (const key of ['startRound', 'scoreGapPercent', 'amountPerRound']) {
        const value = num(comeback, key, `${mapName}.balance.comebackSupply`, 1);
        if (!Number.isInteger(value)) errors.push(`${mapName}.balance.comebackSupply.${key} must be an integer`);
      }
      if (comeback.scoreGapPercent > 100) {
        errors.push(`${mapName}.balance.comebackSupply.scoreGapPercent must be <= 100`);
      }
      const maxTurns = balance.maxTurns;
      if (
        Number.isInteger(comeback.startRound)
        && typeof maxTurns === 'number'
        && Number.isInteger(maxTurns)
        && comeback.startRound > maxTurns
      ) {
        errors.push(`${mapName}.balance.comebackSupply.startRound must be <= balance.maxTurns`);
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

    if (Array.isArray(c.controlPoints)) {
      let typed = 0;
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

    if (mode === 'annihilation' && !Array.isArray(c.spawnSlots)) {
      errors.push(`${mapName}.spawnSlots must contain 2-8 slots`);
    }
    if (Array.isArray(c.spawnSlots)) {
      if (c.spawnSlots.length < 2 || c.spawnSlots.length > 8) errors.push(`${mapName}.spawnSlots must contain 2-8 slots`);
      const ids = new Set();
      const spawnControlPointIds = new Set();
      c.spawnSlots.forEach((slotValue, slotIndex) => {
        const slot = record(slotValue, `spawnSlots[${slotIndex}]`);
        str(slot, 'id', `spawnSlots[${slotIndex}]`);
        if (ids.has(slot.id)) errors.push(`spawnSlots[${slotIndex}].id must be unique`);
        ids.add(slot.id);
        if (mode === 'annihilation') {
          if (Array.isArray(c.controlPoints) && c.controlPoints.length > 0) {
            str(slot, 'controlPointId', `spawnSlots[${slotIndex}]`);
            if (
              typeof slot.controlPointId === 'string' && slot.controlPointId.length > 0
              && !c.controlPoints.some(point => point?.id === slot.controlPointId)
            ) {
              errors.push(`spawnSlots[${slotIndex}].controlPointId must reference a control point`);
            }
            if (typeof slot.controlPointId === 'string' && slot.controlPointId.length > 0 && spawnControlPointIds.has(slot.controlPointId)) {
              errors.push(`spawnSlots[${slotIndex}].controlPointId must be unique`);
            }
            if (typeof slot.controlPointId === 'string' && slot.controlPointId.length > 0) spawnControlPointIds.add(slot.controlPointId);
          }
        }
        pos(record(slot.headquarters, `spawnSlots[${slotIndex}].headquarters`), `spawnSlots[${slotIndex}].headquarters`, radius);
        if (!Array.isArray(slot.startingUnits)) errors.push(`spawnSlots[${slotIndex}].startingUnits must be an array`);
        else slot.startingUnits.forEach((unitValue, unitIndex) => {
          const unit = record(unitValue, `spawnSlots[${slotIndex}].startingUnits[${unitIndex}]`);
          if (!UNIT_TYPES.includes(String(unit.type))) errors.push(`spawnSlots[${slotIndex}].startingUnits[${unitIndex}].type invalid`);
          pos(unit, `spawnSlots[${slotIndex}].startingUnits[${unitIndex}]`, radius);
        });
      });
      const layouts = record(c.layouts, `${mapName}.layouts`);
      const impassable = new Set((c.terrainCells || [])
        .filter(cell => cell.terrain === 'water' || cell.terrain === 'blocker')
        .map(hexKey));
      const controlPositions = new Set((c.controlPoints || []).map(hexKey));
      for (const [countText, slotIds] of Object.entries(layouts)) {
        const count = Number(countText);
        if (!Number.isInteger(count) || count < 2 || count > 8 || !Array.isArray(slotIds) || slotIds.length !== count) {
          errors.push(`${mapName}.layouts.${countText} must contain exactly ${countText} slots`);
          continue;
        }
        if (new Set(slotIds).size !== slotIds.length || slotIds.some(slotId => typeof slotId !== 'string' || !ids.has(slotId))) {
          errors.push(`${mapName}.layouts.${countText} contains invalid slots`);
          continue;
        }
        const occupiedInLayout = new Set(controlPositions);
        for (const slotId of slotIds) {
          const slotIndex = c.spawnSlots.findIndex(slot => slot.id === slotId);
          const slot = c.spawnSlots[slotIndex];
          const objects = [
            { ...slot.headquarters, ctx: `spawnSlots[${slotIndex}].headquarters` },
            ...(slot.startingUnits || []).map((unit, unitIndex) => ({ ...unit, ctx: `spawnSlots[${slotIndex}].startingUnits[${unitIndex}]` })),
          ];
          for (const object of objects) {
            const key = hexKey(object);
            if (impassable.has(key)) errors.push(`${object.ctx} is on impassable terrain at ${key}`);
            if (occupiedInLayout.has(key)) errors.push(`${object.ctx} overlaps another fixed map object at ${key}`);
            occupiedInLayout.add(key);
          }
        }
      }
    }

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
      startRound: '开始轮次',
      scoreGapPercent: '分差百分比',
      amountPerRound: '每轮补给量',
      intervalRounds: '收缩间隔',
      damage: '炮火伤害',
      minimumSafeRadius: '最小安全半径',
      controlPointId: '绑定据点',
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
    if (text === 'balance.comebackSupply') return '追赶补给配置';
    if (text === 'annihilation') return '歼灭模式配置';
    if (text === 'annihilation.artillery') return '炮火配置';
    match = text.match(/^spawnSlots\[(\d+)\]$/);
    if (match) return `出生槽 ${Number(match[1]) + 1}`;
    match = text.match(/^spawnSlots\[(\d+)\]\.headquarters$/);
    if (match) return `出生槽 ${Number(match[1]) + 1} ${config.mode === 'annihilation' ? '出生点' : '总部'}`;
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
    match = error.match(/^(.+)\.(\w+) must be an integer$/);
    if (match) return `${humanContext(match[1])}的${humanField(match[2])}必须是整数。`;
    match = error.match(/^(.+)\.scoreGapPercent must be <= 100$/);
    if (match) return `${humanContext(match[1])}的分差百分比不能超过 100。`;
    match = error.match(/^(.+)\.startRound must be <= balance\.maxTurns$/);
    if (match) return `${humanContext(match[1])}的开始轮次不能大于最大回合。`;
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
    if (error.includes('.mode must be standard, annihilation, or simultaneous')) return '玩法模式必须是普通模式、歼灭模式或同时模式。';
    if (error.includes('.annihilation is only valid in annihilation mode')) return '只有歼灭模式可以配置炮火收缩。';
    if (error.includes('.minimumSafeRadius must be smaller than radius')) return '炮火最小安全半径必须小于地图半径。';
    if (error.includes('.controlPointId must reference a control point')) return `出生槽 ${itemNumber(error)} 绑定了不存在的据点。`;
    if (error.includes('.controlPointId must be unique')) return `出生槽 ${itemNumber(error)} 绑定的据点已被其他出生槽使用。`;
    if (error.includes('playableCells must be a non-empty array')) return '地图必须至少包含 1 个可用格子。';
    if (error.includes('playableCells must form one connected area')) return '所有可用格子必须六向连通。';
    if (error.includes('outside playableCells')) return error.replace('is outside playableCells', '不在可用地图边界内');
    if (error.includes('.spawnSlots must contain 2-8 slots')) return '多人地图必须配置 2–8 个出生槽。';
    if (error.includes('.layouts.') && error.includes('must contain exactly')) return '人数布局选择的出生槽数量不正确。';
    if (error.includes('.layouts.') && error.includes('contains invalid slots')) return '人数布局包含重复或不存在的出生槽。';
    if (error.includes('.canCapture must be boolean')) {
      const unit = error.match(/^units\.(\w+)/)?.[1];
      return `${humanUnit(unit)}规格的可占点必须是布尔值。`;
    }
    return error;
  }

  function resizeMapRadius(config, radius, confirmRemoval) {
    const minimumRadius = config.mode === 'annihilation' ? 2 : 1;
    const nextRadius = Math.max(minimumRadius, Math.floor(Number(radius) || minimumRadius));
    const copy = deepClone(config);
    const outside = [];
    const collect = (item, group) => {
      if (!isValidHex(item, nextRadius)) outside.push({ group, item });
    };
    (copy.terrainCells || []).forEach(item => collect(item, 'terrainCells'));
    (copy.controlPoints || []).forEach(item => collect(item, 'controlPoints'));
    (copy.startingUnits || []).forEach(item => collect(item, 'startingUnits'));
    for (const player of ['player_a', 'player_b']) collect(copy.headquarters[player], `headquarters.${player}`);
    if (Array.isArray(copy.playableCells)) copy.playableCells.forEach(item => collect(item, 'playableCells'));
    if (copy.spawnMode) {
      (copy.spawnSlots || []).forEach((slot, slotIndex) => {
        collect(slot.headquarters, `spawnSlots.${slotIndex}.headquarters`);
        (slot.startingUnits || []).forEach(item => collect(item, `spawnSlots.${slotIndex}.startingUnits`));
      });
    }
    if (outside.length && !confirmRemoval) return { config: copy, removed: outside.length, requiresConfirmation: true };
    copy.radius = nextRadius;
    copy.terrainCells = (copy.terrainCells || []).filter(item => isValidHex(item, nextRadius));
    copy.controlPoints = (copy.controlPoints || []).filter(item => isValidHex(item, nextRadius));
    copy.startingUnits = (copy.startingUnits || []).filter(item => isValidHex(item, nextRadius));
    if (Array.isArray(copy.playableCells)) copy.playableCells = copy.playableCells.filter(item => isValidHex(item, nextRadius));
    for (const player of ['player_a', 'player_b']) {
      if (!isValidHex(copy.headquarters[player], nextRadius)) copy.headquarters[player] = { q: player === 'player_a' ? -nextRadius : nextRadius, r: 0 };
    }
    if (copy.spawnMode) {
      const candidates = playableCells(copy);
      const occupied = new Set((copy.controlPoints || []).map(hexKey));
      (copy.spawnSlots || []).forEach(slot => {
        slot.startingUnits = (slot.startingUnits || []).filter(item => isValidHex(item, nextRadius) && isPlayableCell(copy, item));
        if (!isValidHex(slot.headquarters, nextRadius) || !isPlayableCell(copy, slot.headquarters)) {
          const replacement = candidates.find(cell => !occupied.has(hexKey(cell)));
          if (replacement) slot.headquarters = { ...replacement };
        }
        occupied.add(hexKey(slot.headquarters));
        slot.startingUnits.forEach(unit => occupied.add(hexKey(unit)));
      });
    }
    if (copy.mode === 'annihilation' && copy.annihilation?.artillery) {
      copy.annihilation.artillery.minimumSafeRadius = Math.min(copy.annihilation.artillery.minimumSafeRadius, nextRadius - 1);
    }
    return { config: copy, removed: outside.length, requiresConfirmation: false };
  }

  function createCellsFromConfig(config) {
    const terrain = new Map((config.terrainCells || []).map(cell => [hexKey(cell), cell.terrain]));
    return playableCells(config).map(cell => ({ ...cell, terrain: terrain.get(hexKey(cell)) || 'plain' }));
  }

  const core = {
    createDefaultMapConfig,
    configureMapMode,
    defaultAnnihilation,
    updateSpawnControlPointReferences,
    normalizeImportedMap,
    serializeMapConfig,
    validateMapConfig,
    resizeMapRadius,
    formatValidationError,
    isValidHex,
    isPlayableCell,
    arePlayableCellsConnected,
    createCellsFromConfig,
  };

  global.MapEditorCore = core;

  // 校验文案需要按玩法模式区分出生槽锚点称呼（歼灭=出生点）；在 DOM 初始化前声明，供无 DOM 环境安全读取
  let config = createDefaultMapConfig();

  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const els = {
    canvas: $('map-canvas'),
    badge: $('validation-badge'),
    validationCount: $('validation-count'),
    validationList: $('validation-list'),
    cellReadout: $('cell-readout'),
    importFile: $('import-file'),
    mapName: $('map-name'),
    mapDescription: $('map-description'),
    mapRadius: $('map-radius'),
    mapMode: $('map-mode'),
    annihilationPanel: $('annihilation-panel'),
    artilleryFields: $('artillery-fields'),
    toolOwner: $('tool-owner'),
    toolUnitType: $('tool-unit-type'),
    toolControlKind: $('tool-control-kind'),
    toolHint: $('tool-hint'),
    selectionTitle: $('selection-title'),
    selectionIcon: $('selection-icon'),
    selectionTitleText: $('selection-title-text'),
    selectionFields: $('selection-fields'),
    balanceFields: $('balance-fields'),
    unitSpecFields: $('unit-spec-fields'),
    controlTypeFields: $('control-type-fields'),
    spawnLayoutFields: $('spawn-layout-fields'),
  };

  function activateInspectorTab(tabId) {
    document.querySelectorAll('[data-inspector-tab]').forEach(tab => {
      const active = tab.dataset.inspectorTab === tabId;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-inspector-pane]').forEach(pane => {
      const active = pane.dataset.inspectorPane === tabId;
      pane.classList.toggle('active', active);
      pane.hidden = !active;
    });
  }

  const ctx = els.canvas.getContext('2d');
  let tool = 'select';
  let hoverCell = null;
  let selected = null;
  let zoom = 1;
  let layout = { minX: 0, minY: 0, width: 840, height: 840 };
  let annihilationDraft = null;

  function activateSpawnMode() {
    enableSpawnMode(config);
  }

  function slotColor(index) {
    return SLOT_COLORS[index % SLOT_COLORS.length];
  }

  // 歼灭模式下出生槽的 headquarters 只是出生锚点，不是总部；文案与图标按模式区分
  function hqTerm() {
    return config.mode === 'annihilation' ? '出生点' : '总部';
  }

  function selectedSlotIndex() {
    if (!config.spawnMode) return -1;
    return config.spawnSlots.findIndex(slot => slot.id === els.toolOwner.value);
  }

  function syncToolOwnerOptions() {
    const previous = els.toolOwner.value;
    const options = config.spawnMode
      ? config.spawnSlots.map(slot => ({ value: slot.id, label: slot.id }))
      : ['player_a', 'player_b'].map(player => ({ value: player, label: player }));
    els.toolOwner.innerHTML = options.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('');
    if (options.some(option => option.value === previous)) els.toolOwner.value = previous;
  }

  function toast(msg, type = 'info') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `show ${type}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.className = '', 2400);
  }

  function setStatus(message, type = 'info') {
    toast(message, type);
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
    if (!isPlayableCell(config, pos)) return '地图外';
    return (config.terrainCells || []).find(cell => cell.q === pos.q && cell.r === pos.r)?.terrain || 'plain';
  }

  function setTerrain(pos, terrain) {
    if (!isPlayableCell(config, pos)) return false;
    config.terrainCells = (config.terrainCells || []).filter(cell => !(cell.q === pos.q && cell.r === pos.r));
    if (terrain !== 'plain') config.terrainCells.push({ q: pos.q, r: pos.r, terrain });
    return true;
  }

  function objectAt(pos) {
    if (config.spawnMode) {
      for (let slotIndex = 0; slotIndex < config.spawnSlots.length; slotIndex++) {
        const slot = config.spawnSlots[slotIndex];
        if (slot.headquarters.q === pos.q && slot.headquarters.r === pos.r) {
          return { type: 'spawnHeadquarters', slotIndex, object: slot.headquarters };
        }
        const unitIndex = slot.startingUnits.findIndex(unit => unit.q === pos.q && unit.r === pos.r);
        if (unitIndex >= 0) return { type: 'spawnUnit', slotIndex, unitIndex, object: slot.startingUnits[unitIndex] };
      }
    }
    for (const player of ['player_a', 'player_b']) {
      if (config.spawnMode) break;
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
    return !(
      hit.type === ignore.type
      && hit.index === ignore.index
      && hit.player === ignore.player
      && hit.slotIndex === ignore.slotIndex
      && hit.unitIndex === ignore.unitIndex
    );
  }

  function canPlace(pos, ignore) {
    return isPlayableCell(config, pos) && !hasFixedObjectAt(pos, ignore);
  }

  function nextControlPointId() {
    let i = config.controlPoints.length + 1;
    const ids = new Set(config.controlPoints.map(point => point.id));
    while (ids.has(`cp_${i}`)) i += 1;
    return `cp_${i}`;
  }

  function selectObject(hit, pos) {
    selected = hit ? { ...hit } : { type: 'cell', object: { q: pos.q, r: pos.r } };
    activateInspectorTab('selection');
    renderSelection();
    drawBoard();
  }

  function placeAt(pos) {
    if (!isValidHex(pos, config.radius)) return;
    if (tool === 'add-cell') {
      const existed = isPlayableCell(config, pos);
      const cells = materializePlayableCells(config);
      if (!existed) {
        cells.push({ q: pos.q, r: pos.r });
        if (!arePlayableCellsConnected(cells)) {
          cells.pop();
          return setStatus('添加该地块后地图不连通，操作已取消', 'err');
        }
      }
      selected = { type: 'cell', object: { q: pos.q, r: pos.r } };
    } else if (tool === 'remove-cell') {
      removePlayableCell(pos);
    } else if (tool === 'plain' || tool === 'water' || tool === 'blocker') {
      if (!isPlayableCell(config, pos)) return setStatus('该位置不属于地图，请先添加地块', 'err');
      setTerrain(pos, tool);
      selected = { type: 'cell', object: { q: pos.q, r: pos.r } };
    } else if (tool === 'hq') {
      if (config.spawnMode) {
        const slotIndex = selectedSlotIndex();
        if (slotIndex < 0) return setStatus('请先选择出生槽', 'err');
        const ignore = { type: 'spawnHeadquarters', slotIndex };
        if (!canPlace(pos, ignore)) return setStatus(`该格已有固定对象，不能放置${hqTerm()}`, 'err');
        config.spawnSlots[slotIndex].headquarters = { q: pos.q, r: pos.r };
        selected = { type: 'spawnHeadquarters', slotIndex, object: config.spawnSlots[slotIndex].headquarters };
      } else {
        const player = els.toolOwner.value;
        const ignore = { type: 'headquarters', player };
        if (!canPlace(pos, ignore)) return setStatus(`该格已有固定对象，不能放置${hqTerm()}`, 'err');
        config.headquarters[player] = { q: pos.q, r: pos.r };
        selected = { type: 'headquarters', player, object: config.headquarters[player] };
      }
    } else if (tool === 'control') {
      if (!canPlace(pos)) return setStatus('该格已有固定对象，不能放置据点', 'err');
      const kind = els.toolControlKind.value;
      const point = { id: nextControlPointId(), name: `据点 ${config.controlPoints.length + 1}`, ...(kind ? { kind } : {}), q: pos.q, r: pos.r };
      config.controlPoints.push(point);
      selected = { type: 'controlPoint', index: config.controlPoints.length - 1, object: point };
    } else if (tool === 'unit') {
      if (!canPlace(pos)) return setStatus('该格已有固定对象，不能放置初始单位', 'err');
      if (config.spawnMode) {
        const slotIndex = selectedSlotIndex();
        if (slotIndex < 0) return setStatus('请先选择出生槽', 'err');
        const unit = { type: els.toolUnitType.value, q: pos.q, r: pos.r };
        config.spawnSlots[slotIndex].startingUnits.push(unit);
        selected = { type: 'spawnUnit', slotIndex, unitIndex: config.spawnSlots[slotIndex].startingUnits.length - 1, object: unit };
      } else {
        const unit = { owner: els.toolOwner.value, type: els.toolUnitType.value, q: pos.q, r: pos.r };
        config.startingUnits.push(unit);
        selected = { type: 'startingUnit', index: config.startingUnits.length - 1, object: unit };
      }
    } else if (tool === 'delete') {
      deleteAt(pos);
    } else {
      selectObject(objectAt(pos), pos);
    }
    if (['hq', 'control', 'unit'].includes(tool) && selected) activateInspectorTab('selection');
    syncAll();
  }

  function removePlayableCell(pos) {
    if (!isPlayableCell(config, pos)) return setStatus('该位置已经在地图外', 'err');
    if (objectAt(pos)) return setStatus('该格存在总部、据点或单位，不能移除地块', 'err');
    if (terrainAt(pos) !== 'plain') return setStatus('请先将该格地形恢复为平地，再移除地块', 'err');
    const next = playableCells(config).filter(cell => cell.q !== pos.q || cell.r !== pos.r);
    if (!arePlayableCellsConnected(next)) return setStatus('移除后会使地图断开，操作已取消', 'err');
    config.playableCells = next;
    selected = null;
  }

  function deleteAt(pos) {
    const hit = objectAt(pos);
    if (!hit) {
      setTerrain(pos, 'plain');
      selected = { type: 'cell', object: { q: pos.q, r: pos.r } };
      return;
    }
    if (hit.type === 'headquarters' || hit.type === 'spawnHeadquarters') return setStatus(`${hqTerm()}必须存在，可用${hqTerm()}工具移动位置`, 'err');
    if (hit.type === 'controlPoint') {
      const removedId = config.controlPoints[hit.index].id;
      config.controlPoints.splice(hit.index, 1);
      updateSpawnControlPointReferences(config, removedId);
    }
    if (hit.type === 'startingUnit') config.startingUnits.splice(hit.index, 1);
    if (hit.type === 'spawnUnit') config.spawnSlots[hit.slotIndex].startingUnits.splice(hit.unitIndex, 1);
    selected = null;
  }

  function drawBoard() {
    computeLayout();
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
    for (const cell of allCells(config.radius)) {
      pathHex(cell.q, cell.r, 1);
      const playable = isPlayableCell(config, cell);
      if (playable) {
        ctx.fillStyle = TERRAIN_COLORS[terrainAt(cell)] || TERRAIN_COLORS.plain;
        ctx.fill();
      }
      ctx.strokeStyle = playable ? '#20313d' : 'rgba(62,84,99,.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (hoverCell) {
      pathHex(hoverCell.q, hoverCell.r, 2);
      ctx.fillStyle = 'rgba(102,204,255,.13)';
      ctx.fill();
    }
    for (const point of config.controlPoints) drawControlPoint(point);
    if (config.spawnMode) {
      config.spawnSlots.forEach((slot, slotIndex) => {
        if (config.mode === 'annihilation') drawSpawnAnchor(slot.id, slot.headquarters, slotIndex);
        else drawHeadquarters(slot.id, slot.headquarters, slotIndex);
        slot.startingUnits.forEach(unit => drawUnit({ ...unit, owner: slot.id, slotIndex }));
      });
    } else {
      for (const player of ['player_a', 'player_b']) drawHeadquarters(player, config.headquarters[player]);
      for (const unit of config.startingUnits) drawUnit(unit);
    }
  }

  function drawUnitGlyph(type, x, y) {
    ctx.save();
    ctx.fillStyle = '#071016';
    ctx.strokeStyle = '#071016';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    switch (type) {
      case 'infantry': {
        ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
        ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y);
        ctx.stroke();
        break;
      }
      case 'scout': {
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x - 5, y + 4);
        ctx.lineTo(x + 5, y + 4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'heavy': {
        ctx.fillRect(x - 5, y - 5, 10, 10);
        break;
      }
      case 'ranger': {
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 4, y);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 4, y);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'support': {
        ctx.moveTo(x - 2, y - 5); ctx.lineTo(x + 2, y - 5);
        ctx.lineTo(x + 2, y - 2); ctx.lineTo(x + 5, y - 2);
        ctx.lineTo(x + 5, y + 2); ctx.lineTo(x + 2, y + 2);
        ctx.lineTo(x + 2, y + 5); ctx.lineTo(x - 2, y + 5);
        ctx.lineTo(x - 2, y + 2); ctx.lineTo(x - 5, y + 2);
        ctx.lineTo(x - 5, y - 2); ctx.lineTo(x - 2, y - 2);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  function drawControlPointGlyph(kind, x, y) {
    ctx.save();
    ctx.fillStyle = '#071016';
    ctx.strokeStyle = '#071016';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    switch (kind) {
      case 'supply': {
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'forward_base': {
        ctx.moveTo(x - 3, y + 6);
        ctx.lineTo(x - 3, y - 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 6);
        ctx.lineTo(x + 6, y - 2);
        ctx.lineTo(x - 3, y + 2);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'repair': {
        ctx.arc(x, y - 1, 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 3);
        ctx.lineTo(x + 6, y + 6);
        ctx.stroke();
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  // 出生锚点底色：槽位色半透明六边形，总部与出生点共用
  function drawAnchorBase(hq, color) {
    const p = hexToPixel(hq.q, hq.r);
    pathHex(hq.q, hq.r, 5);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.78;
    ctx.fill();
    ctx.globalAlpha = 1;
    return p;
  }

  function drawHeadquarters(player, hq, slotIndex = null) {
    const p = drawAnchorBase(hq, OWNER_COLORS[player] || slotColor(slotIndex || 0));
    ctx.save();
    ctx.fillStyle = '#071016';
    ctx.beginPath();
    ctx.fillRect(p.x - 6, p.y - 2, 12, 8);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 8);
    ctx.lineTo(p.x - 7, p.y - 2);
    ctx.lineTo(p.x + 7, p.y - 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 歼灭模式出生锚点：旗标造型（整体居中于格心），与总部房屋图标区分
  function drawSpawnAnchor(player, hq, slotIndex = null) {
    const p = drawAnchorBase(hq, OWNER_COLORS[player] || slotColor(slotIndex || 0));
    ctx.save();
    ctx.fillStyle = '#071016';
    // 旗杆：p.x-4..p.x-2，与旗面共同占据 p.x-4..p.x+4，格心居中
    ctx.fillRect(p.x - 4, p.y - 9, 2, 11);
    // 旗面
    ctx.beginPath();
    ctx.moveTo(p.x - 2, p.y - 9);
    ctx.lineTo(p.x + 4, p.y - 5);
    ctx.lineTo(p.x - 2, p.y - 1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawControlPoint(point) {
    const p = hexToPixel(point.q, point.r);
    pathHex(point.q, point.r, 6);
    ctx.strokeStyle = '#d6b34a';
    ctx.lineWidth = 2;
    ctx.stroke();
    drawControlPointGlyph(point.kind || 'supply', p.x, p.y);
  }

  function drawUnit(unit) {
    const p = hexToPixel(unit.q, unit.r);
    ctx.fillStyle = OWNER_COLORS[unit.owner] || (Number.isInteger(unit.slotIndex) ? slotColor(unit.slotIndex) : '#d8e0e8');
    ctx.beginPath();
    ctx.arc(p.x, p.y, HEX_SIZE * 0.42, 0, Math.PI * 2);
    ctx.fill();
    drawUnitGlyph(unit.type, p.x, p.y);
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
    els.mapRadius.min = config.mode === 'annihilation' ? '2' : '1';
    els.mapMode.querySelectorAll('[data-mode]').forEach(button => {
      const active = button.dataset.mode === config.mode;
      button.setAttribute('aria-pressed', String(active));
    });
  }

  // 总部/出生点工具按钮随玩法模式切换文案与图标
  function renderHQToolLabel() {
    const labelEl = $('hq-tool-label');
    if (!labelEl) return;
    const button = labelEl.closest('.tool-button');
    const iconEl = $('hq-tool-icon');
    const label = hqTerm();
    labelEl.textContent = label;
    button.title = `放置${label}`;
    if (iconEl) iconEl.className = `token-icon ${config.mode === 'annihilation' ? 'spawn-point' : 'headquarters'}`;
    // 当前激活工具是总部/出生点时同步提示条
    if (tool === 'hq') els.toolHint.textContent = label;
  }

  function renderAnnihilationFields() {
    const active = config.mode === 'annihilation';
    els.annihilationPanel.hidden = !active;
    if (!active) {
      els.artilleryFields.innerHTML = '';
      return;
    }
    if (!config.annihilation) config.annihilation = defaultAnnihilation(config.radius);
    const artillery = config.annihilation.artillery;
    els.artilleryFields.innerHTML = [
      fieldHtml('artillery:startRound', '开始轮次', artillery.startRound, 1),
      fieldHtml('artillery:intervalRounds', '收缩间隔', artillery.intervalRounds, 1),
      fieldHtml('artillery:damage', '炮火伤害', artillery.damage, 1),
      fieldHtml('artillery:minimumSafeRadius', '最小安全半径', artillery.minimumSafeRadius, 1, Math.max(1, config.radius - 1)),
    ].join('');
    els.artilleryFields.querySelectorAll('input[data-bind]').forEach(input => {
      input.addEventListener('change', () => {
        const [, key] = input.dataset.bind.split(':');
        config.annihilation.artillery[key] = clampBoundNumber(input.value, input.min, input.max);
        syncAll();
      });
    });
  }

  // 关闭追赶补给时暂存参数，重新启用时恢复，避免用户只是临时关掉开关就丢配置。
  let comebackSupplyDraft = null;

  function defaultComebackSupply() {
    return { startRound: 3, scoreGapPercent: 40, amountPerRound: 20 };
  }

  function clampBoundNumber(raw, min, max) {
    let value = Math.max(Number(min || 0), Number(raw) || 0);
    if (max !== '' && max != null && Number.isFinite(Number(max))) {
      value = Math.min(Number(max), value);
    }
    return value;
  }

  function renderBalanceFields() {
    const comeback = config.balance.comebackSupply;
    const draft = comeback || comebackSupplyDraft || defaultComebackSupply();
    els.balanceFields.innerHTML = [
      ...BALANCE_KEYS.map(([key, label, min]) => fieldHtml(`balance:${key}`, label, config.balance[key], min)),
      ...WEIGHT_KEYS.map(([key, label]) => fieldHtml(`weight:${key}`, `裁决 ${label}`, config.balance.adjudicationWeights[key], 0)),
      // 歼灭模式没有总部，总部规格仅作占位，隐藏避免误导
      ...(config.mode === 'annihilation'
        ? []
        : [
          fieldHtml('hq:hp', '总部 HP', config.headquartersSpec.hp, 1),
          fieldHtml('hq:defense', '总部防御', config.headquartersSpec.defense, 0),
        ]),
      `<label class="toggle-field">启用追赶补给 <input id="comeback-enabled" type="checkbox"${comeback ? ' checked' : ''} /></label>`,
      fieldHtml('comeback:startRound', '追赶开始轮次', draft.startRound ?? 3, 1, null, !comeback),
      fieldHtml('comeback:scoreGapPercent', '追赶分差百分比', draft.scoreGapPercent ?? 40, 1, 100, !comeback),
      fieldHtml('comeback:amountPerRound', '追赶每轮补给', draft.amountPerRound ?? 20, 1, null, !comeback),
    ].join('');
    els.balanceFields.querySelectorAll('input[data-bind]').forEach(input => {
      input.addEventListener('change', () => {
        const [group, key] = input.dataset.bind.split(':');
        const value = clampBoundNumber(input.value, input.min, input.max);
        if (group === 'balance') config.balance[key] = value;
        if (group === 'weight') config.balance.adjudicationWeights[key] = value;
        if (group === 'hq') config.headquartersSpec[key] = value;
        if (group === 'comeback' && config.balance.comebackSupply) config.balance.comebackSupply[key] = value;
        syncAll();
      });
    });
    document.getElementById('comeback-enabled').addEventListener('change', event => {
      if (event.target.checked) {
        config.balance.comebackSupply = {
          ...(comebackSupplyDraft || defaultComebackSupply()),
        };
        comebackSupplyDraft = null;
      } else if (config.balance.comebackSupply) {
        comebackSupplyDraft = { ...config.balance.comebackSupply };
        delete config.balance.comebackSupply;
      }
      syncAll();
    });
  }

  function fieldHtml(bind, label, value, min, max = null, disabled = false) {
    return `<label>${esc(label)} <input data-bind="${esc(bind)}" type="number" min="${min}"${max === null ? '' : ` max="${max}"`}${disabled ? ' disabled' : ''} value="${esc(value)}" /></label>`;
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

  function renderSpawnLayouts() {
    if (!config.spawnMode) {
      els.spawnLayoutFields.innerHTML = `<p class="outside-cell-hint">当前使用旧式双人出生配置。转换后可编辑 2–8 人出生槽和布局。</p>
        <button id="enable-spawn-mode" type="button">转换为多人出生布局</button>`;
      $('enable-spawn-mode').addEventListener('click', () => {
        activateSpawnMode();
        syncAll();
      });
      return;
    }

    const slotOptions = selectedId => config.spawnSlots.map(slot =>
      `<option value="${esc(slot.id)}"${slot.id === selectedId ? ' selected' : ''}>${esc(slot.id)}</option>`).join('');
    const controlPointOptions = (slotIndex, selectedId) => {
      const options = config.controlPoints.map(point => {
        const usedByAnother = config.spawnSlots.some((slot, index) => index !== slotIndex && slot.controlPointId === point.id);
        return `<option value="${esc(point.id)}"${point.id === selectedId ? ' selected' : ''}${usedByAnother ? ' disabled' : ''}>${esc(point.name)} (${esc(point.id)})</option>`;
      }).join('');
      return `<option value="">请选择据点</option>${options}`;
    };
    const slotRows = config.spawnSlots.map((slot, index) => `<div class="spawn-slot-row" data-slot-index="${index}">
      <span class="spawn-color" style="background:${slotColor(index)}"></span>
      <input class="spawn-slot-id" value="${esc(slot.id)}" aria-label="出生槽 ID" />
      <button class="spawn-select" type="button">选择</button>
      <button class="spawn-delete danger" type="button">删除</button>
      ${config.mode === 'annihilation' ? `<label class="spawn-control-point-field">绑定出生据点
        <select class="spawn-control-point">${controlPointOptions(index, slot.controlPointId)}</select>
      </label>` : ''}
    </div>`).join('');
    const layoutRows = Array.from({ length: 7 }, (_, offset) => offset + 2).map(count => {
      const selectedSlots = Array.isArray(config.layouts?.[count]) ? config.layouts[count] : null;
      const selects = selectedSlots
        ? Array.from({ length: count }, (_, index) => `<select class="layout-slot" data-position="${index}">${slotOptions(selectedSlots[index])}</select>`).join('')
        : '';
      return `<div class="layout-row" data-count="${count}">
        <label><input class="layout-enabled" type="checkbox"${selectedSlots ? ' checked' : ''} /> ${count} 人</label>
        ${selects}
      </div>`;
    }).join('');
    els.spawnLayoutFields.innerHTML = `<div class="spawn-toolbar"><button id="spawn-add" type="button">新增出生槽</button><span class="outside-cell-hint">${hqTerm()}工具和单位工具作用于当前选择槽</span></div>${slotRows}${layoutRows}`;

    $('spawn-add').addEventListener('click', () => {
      if (config.spawnSlots.length >= 8) return setStatus('出生槽最多 8 个', 'err');
      const preferred = selected?.type === 'cell' ? selected.object : null;
      const position = preferred && canPlace(preferred) ? preferred : playableCells(config).find(cell => canPlace(cell));
      if (!position) return setStatus(`没有可用于新${hqTerm()}的空格`, 'err');
      let number = config.spawnSlots.length + 1;
      const ids = new Set(config.spawnSlots.map(slot => slot.id));
      while (ids.has(`slot_${number}`)) number += 1;
      const usedControlPoints = new Set(config.spawnSlots.map(slot => slot.controlPointId).filter(Boolean));
      const availableControlPoint = config.controlPoints.find(point => !usedControlPoints.has(point.id));
      const slot = {
        id: `slot_${number}`,
        headquarters: { ...position },
        ...(config.mode === 'annihilation' && availableControlPoint ? { controlPointId: availableControlPoint.id } : {}),
        startingUnits: [],
      };
      config.spawnSlots.push(slot);
      selected = { type: 'spawnHeadquarters', slotIndex: config.spawnSlots.length - 1, object: slot.headquarters };
      syncAll();
      els.toolOwner.value = slot.id;
    });

    els.spawnLayoutFields.querySelectorAll('.spawn-slot-row').forEach(row => {
      const index = Number(row.dataset.slotIndex);
      row.querySelector('.spawn-slot-id').addEventListener('change', event => {
        const nextId = event.target.value.trim();
        const previousId = config.spawnSlots[index].id;
        if (!nextId || config.spawnSlots.some((slot, slotIndex) => slotIndex !== index && slot.id === nextId)) {
          setStatus('出生槽 ID 必须非空且唯一', 'err');
          return syncAll();
        }
        config.spawnSlots[index].id = nextId;
        for (const slots of Object.values(config.layouts || {})) {
          if (!Array.isArray(slots)) continue;
          for (let position = 0; position < slots.length; position++) if (slots[position] === previousId) slots[position] = nextId;
        }
        syncAll();
      });
      row.querySelector('.spawn-control-point')?.addEventListener('change', event => {
        const controlPointId = event.target.value;
        if (controlPointId) config.spawnSlots[index].controlPointId = controlPointId;
        else delete config.spawnSlots[index].controlPointId;
        syncAll();
      });
      row.querySelector('.spawn-select').addEventListener('click', () => {
        els.toolOwner.value = config.spawnSlots[index].id;
        selected = { type: 'spawnHeadquarters', slotIndex: index, object: config.spawnSlots[index].headquarters };
        activateInspectorTab('selection');
        renderSelection();
        drawBoard();
      });
      row.querySelector('.spawn-delete').addEventListener('click', () => {
        if (config.spawnSlots.length <= 2) return setStatus('至少保留 2 个出生槽', 'err');
        const removed = config.spawnSlots[index].id;
        if (!confirm(`删除出生槽 ${removed} 及其初始单位，并关闭引用它的人数布局，是否继续？`)) return;
        config.spawnSlots.splice(index, 1);
        for (const [count, slots] of Object.entries(config.layouts || {})) {
          if (Array.isArray(slots) && slots.includes(removed)) delete config.layouts[count];
        }
        selected = null;
        syncAll();
      });
    });

    els.spawnLayoutFields.querySelectorAll('.layout-row').forEach(row => {
      const count = Number(row.dataset.count);
      row.querySelector('.layout-enabled').addEventListener('change', event => {
        if (!event.target.checked) delete config.layouts[count];
        else if (config.spawnSlots.length < count) {
          setStatus(`${count} 人布局至少需要 ${count} 个出生槽`, 'err');
          delete config.layouts[count];
        } else config.layouts[count] = config.spawnSlots.slice(0, count).map(slot => slot.id);
        syncAll();
      });
      row.querySelectorAll('.layout-slot').forEach(select => {
        select.addEventListener('change', event => {
          config.layouts[count][Number(event.target.dataset.position)] = event.target.value;
          syncAll();
        });
      });
    });
  }

  function setSelectionIcon(cls, color) {
    els.selectionIcon.className = `token-icon ${cls}`;
    els.selectionIcon.style.color = color || '';
  }

  function hideSelectionIcon() {
    els.selectionIcon.className = 'token-icon hidden';
    els.selectionIcon.style.color = '';
  }

  function renderSelection() {
    if (!selected) {
      els.selectionTitleText.textContent = '未选择';
      hideSelectionIcon();
      els.selectionFields.className = 'selection-fields empty';
      els.selectionFields.textContent = '点击棋盘上的格子或对象进行编辑';
      return;
    }
    els.selectionFields.className = 'selection-fields';
    if (selected.type === 'cell') {
      const pos = selected.object;
      els.selectionTitleText.textContent = `格子 ${pos.q},${pos.r}`;
      hideSelectionIcon();
      if (!isPlayableCell(config, pos)) {
        els.selectionFields.innerHTML = '<p class="outside-cell-hint">该位置在地图边界外，可使用“添加地块”工具恢复。</p>';
        return;
      }
      els.selectionFields.innerHTML = `<div class="field-grid compact">
        <label>地形 <select id="sel-terrain"><option value="plain">平地</option><option value="water">水域</option><option value="blocker">阻挡</option></select></label>
      </div>`;
      $('sel-terrain').value = terrainAt(pos);
      $('sel-terrain').addEventListener('change', e => { setTerrain(pos, e.target.value); syncAll(); });
      return;
    }
    const obj = selected.type === 'headquarters'
      ? config.headquarters[selected.player]
      : selected.type === 'spawnHeadquarters'
        ? config.spawnSlots[selected.slotIndex].headquarters
        : selected.type === 'controlPoint'
          ? config.controlPoints[selected.index]
          : selected.type === 'spawnUnit'
            ? config.spawnSlots[selected.slotIndex].startingUnits[selected.unitIndex]
            : config.startingUnits[selected.index];
    selected.object = obj;
    if (selected.type === 'headquarters') {
      els.selectionTitleText.textContent = `总部 ${selected.player}`;
      setSelectionIcon('headquarters', OWNER_COLORS[selected.player]);
    } else if (selected.type === 'spawnHeadquarters') {
      const slot = config.spawnSlots[selected.slotIndex];
      els.selectionTitleText.textContent = `${hqTerm()} ${slot.id}`;
      setSelectionIcon(config.mode === 'annihilation' ? 'spawn-point' : 'headquarters', slotColor(selected.slotIndex));
    } else if (selected.type === 'controlPoint') {
      els.selectionTitleText.textContent = `据点 ${obj.id}`;
      setSelectionIcon(obj.kind || 'supply', '#d6b34a');
    } else if (selected.type === 'spawnUnit') {
      const slot = config.spawnSlots[selected.slotIndex];
      els.selectionTitleText.textContent = `${slot.id} ${UNIT_NAMES[obj.type]}`;
      setSelectionIcon(obj.type, slotColor(selected.slotIndex));
    } else {
      els.selectionTitleText.textContent = `${obj.owner} ${UNIT_NAMES[obj.type]}`;
      setSelectionIcon(obj.type, OWNER_COLORS[obj.owner]);
    }
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
        : selected.type === 'spawnUnit'
          ? `<div class="field-grid compact"><label>出生槽 <input value="${esc(config.spawnSlots[selected.slotIndex].id)}" disabled /></label>
            <label>单位 <select id="sel-type">${UNIT_TYPES.map(type => `<option value="${type}">${esc(UNIT_NAMES[type])}</option>`).join('')}</select></label></div>`
        : '';
    const canDelete = selected.type !== 'headquarters' && selected.type !== 'spawnHeadquarters';
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
      : selected.type === 'spawnHeadquarters'
        ? config.spawnSlots[selected.slotIndex].headquarters
        : selected.type === 'controlPoint'
          ? config.controlPoints[selected.index]
          : selected.type === 'spawnUnit'
            ? config.spawnSlots[selected.slotIndex].startingUnits[selected.unitIndex]
            : config.startingUnits[selected.index];
    const next = { q: Number($('sel-q').value), r: Number($('sel-r').value) };
    if (!canPlace(next, selected)) return setStatus('目标格越界或已有固定对象', 'err');
    obj.q = next.q;
    obj.r = next.r;
    if (selected.type === 'controlPoint') {
      const previousId = obj.id;
      obj.id = $('sel-id').value.trim() || obj.id;
      obj.name = $('sel-name').value.trim() || obj.name;
      const kind = $('sel-kind').value;
      if (kind) obj.kind = kind;
      else delete obj.kind;
      if (obj.id !== previousId) {
        updateSpawnControlPointReferences(config, previousId, obj.id);
      }
    }
    if (selected.type === 'startingUnit') {
      obj.owner = $('sel-owner').value;
      obj.type = $('sel-type').value;
    }
    if (selected.type === 'spawnUnit') obj.type = $('sel-type').value;
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
    syncToolOwnerOptions();
    renderHQToolLabel();
    renderGlobalFields();
    renderAnnihilationFields();
    renderBalanceFields();
    renderUnitSpecs();
    renderControlTypes();
    renderSpawnLayouts();
    renderSelection();
    renderValidation();
    drawBoard();
  }

  function exportJson() {
    const serialized = serializeMapConfig(config);
    const errors = validateMapConfig(serialized, 'export');
    if (errors.length) {
      setStatus('导出失败：请先修复校验问题', 'err');
      renderValidation();
      return;
    }
    downloadFile(`${serialized.name || 'map'}.json`, `${JSON.stringify(serialized, null, 2)}\n`, 'application/json');
    setStatus('地图 JSON 已导出', 'ok');
  }

  function copyJson() {
    const serialized = serializeMapConfig(config);
    const errors = validateMapConfig(serialized, 'copy');
    if (errors.length) return setStatus('复制失败：请先修复校验问题', 'err');
    const text = `${JSON.stringify(serialized, null, 2)}\n`;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => setStatus('地图 JSON 已复制', 'ok'));
    else setStatus('当前浏览器不支持剪贴板复制', 'err');
  }

  function importJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        config = normalizeImportedMap(JSON.parse(reader.result));
        comebackSupplyDraft = null;
        annihilationDraft = null;
        selected = null;
        activateInspectorTab('map');
        syncAll();
        setStatus(`已导入 ${file.name}`, 'ok');
      } catch (err) {
        setStatus(`导入失败：${err.message}`, 'err');
      } finally {
        els.importFile.value = '';
      }
    };
    reader.onerror = () => setStatus('读取文件失败', 'err');
    reader.readAsText(file);
  }

  document.querySelectorAll('.tool-button').forEach(button => {
    button.addEventListener('click', () => {
      tool = button.dataset.tool;
      document.querySelectorAll('.tool-button').forEach(btn => btn.classList.toggle('active', btn === button));
      els.toolHint.textContent = button.querySelector('span:last-child')?.textContent?.trim() || button.textContent.trim();
    });
  });
  document.querySelectorAll('[data-inspector-tab]').forEach(tab => {
    tab.addEventListener('click', () => activateInspectorTab(tab.dataset.inspectorTab));
  });
  document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(zoom + 0.1));
  document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(zoom - 0.1));
  document.getElementById('btn-zoom-reset').addEventListener('click', () => setZoom(1));

  els.mapName.addEventListener('input', () => { config.name = els.mapName.value; renderValidation(); });
  els.mapDescription.addEventListener('input', () => { config.description = els.mapDescription.value; renderValidation(); });
  els.mapMode.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      const nextMode = button.dataset.mode;
      if (nextMode === config.mode) return;
      if (config.mode === 'annihilation') annihilationDraft = deepClone(config.annihilation);
      config = configureMapMode(config, nextMode, annihilationDraft);
      selected = null;
      syncAll();
      if (nextMode === 'annihilation') activateInspectorTab('rules');
      setStatus(nextMode === 'annihilation' ? '已切换为歼灭模式，请配置出生据点与炮火参数' : '已切换为普通模式', 'ok');
    });
  });
  els.mapRadius.addEventListener('change', () => {
    const next = Number(els.mapRadius.value);
    const preview = resizeMapRadius(config, next, false);
    if (preview.requiresConfirmation && !confirm(`半径缩小会移除 ${preview.removed} 个半径外格子、对象或地形，是否继续？`)) {
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
    comebackSupplyDraft = null;
    annihilationDraft = null;
    selected = null;
    activateInspectorTab('map');
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
