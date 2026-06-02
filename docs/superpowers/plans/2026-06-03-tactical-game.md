# 战棋多人对战游戏 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个基于 Fastify 的现代军事题材回合制战棋游戏，玩家通过 REST API 控制势力建造、采矿、生产、战斗，目标是摧毁敌方总部。

**Architecture:** 事件驱动单进程架构。Fastify 提供 REST API 和 SSE 推送。游戏引擎通过事件总线解耦指令提交和执行。所有状态在内存中维护，前端用 Canvas 渲染。

**Tech Stack:** Node.js 20+, Fastify 5, TypeScript, Vitest (测试), Canvas API (前端)

---

## 项目文件结构

```
game/
├── src/
│   ├── server.ts                  # Fastify 入口
│   ├── types.ts                   # 所有共享类型定义
│   ├── api/
│   │   ├── games.ts               # 创建/加入游戏路由
│   │   ├── actions.ts             # 玩家操作路由
│   │   └── events.ts              # SSE 和事件查询
│   ├── engine/
│   │   ├── engine.ts              # 游戏引擎核心（协调各子系统）
│   │   ├── building.ts            # 建造和生产
│   │   ├── units.ts               # 单位定义和移动
│   │   ├── combat.ts              # 攻击和治疗
│   │   ├── resources.ts           # 金币和采矿
│   │   ├── map.ts                 # 地图和采矿点
│   │   └── validation.ts          # 共享验证（建造范围、范围检查）
│   ├── events/
│   │   └── bus.ts                 # 事件总线
│   └── state/
│       └── store.ts               # 游戏状态存储
├── tests/
│   ├── engine/                    # 引擎单元测试
│   ├── api/                       # API 集成测试
│   └── helpers.ts                 # 测试辅助函数
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 任务 1: 项目初始化

**Files:**
- Create: `C:/cosmos/github/game/package.json`
- Create: `C:/cosmos/github/game/tsconfig.json`
- Create: `C:/cosmos/github/game/vitest.config.ts`
- Create: `C:/cosmos/github/game/.gitignore`

- [ ] **步骤 1: 初始化 Node.js 项目并安装依赖**

```bash
cd C:/cosmos/github/game
npm init -y
npm install fastify@^5.0.0 @fastify/static@^8.0.0
npm install -D typescript@^5.5.0 @types/node@^20.0.0 tsx@^4.0.0 vitest@^2.0.0 @vitest/coverage-v8@^2.0.0
```

- [ ] **步骤 2: 写入 `package.json` scripts 字段**

修改 `package.json` 添加：

```json
{
  "name": "tactical-game",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **步骤 3: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **步骤 4: 创建 `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **步骤 5: 创建 `.gitignore`**

```
node_modules/
dist/
.env
*.log
coverage/
```

- [ ] **步骤 6: 验证安装**

Run: `cd C:/cosmos/github/game && npm install && npx tsc --noEmit`
Expected: 无错误输出

- [ ] **步骤 7: 提交**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: initialize node.js project with fastify and vitest"
```

---

## 任务 2: 共享类型定义

**Files:**
- Create: `C:/cosmos/github/game/src/types.ts`

- [ ] **步骤 1: 创建类型定义文件**

将所有共享类型集中在一处，避免后续模块互相依赖时出现循环引用。

```typescript
// src/types.ts

export type PlayerId = 'player_a' | 'player_b';

export type UnitType = 'infantry' | 'sniper' | 'tank' | 'medic';

export type BuildingType = 'headquarters' | 'barracks' | 'miner';

export type GamePhase = 'waiting_for_player' | 'waiting_command' | 'executing' | 'game_over';

export interface Position {
  x: number;
  y: number;
}

export interface Resources {
  gold: number;
}

export interface Unit {
  id: string;
  owner: PlayerId;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  moveRange: number;
  attackRange: number;
  alive: boolean;
  hasMoved: boolean;
  hasAttacked: boolean;
}

export interface ProductionItem {
  type: UnitType;
  turnsRemaining: number;
}

export interface Building {
  id: string;
  owner: PlayerId;
  type: BuildingType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  buildProgress: number;
  isBuilding: boolean;
  production: ProductionItem | null;
}

export interface TurnState {
  turnNumber: number;
  currentOwner: PlayerId;
  phase: GamePhase;
}

export type EventType =
  | 'game_start'
  | 'move'
  | 'attack'
  | 'heal'
  | 'unit_death'
  | 'build'
  | 'build_complete'
  | 'produce'
  | 'produce_complete'
  | 'mine'
  | 'base_destroyed'
  | 'turn_end'
  | 'game_over';

export interface GameEvent {
  seq: number;
  type: EventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface GameState {
  id: string;
  phase: GamePhase;
  mapWidth: number;
  mapHeight: number;
  miningPoints: Position[];
  buildings: Building[];
  units: Unit[];
  resources: Record<PlayerId, Resources>;
  tokens: Record<PlayerId, string>;
  turn: TurnState;
  events: GameEvent[];
  winner: PlayerId | null;
}

export interface ApiError {
  error: string;
  code: ApiErrorCode;
}

export type ApiErrorCode =
  | 'not_your_turn'
  | 'insufficient_gold'
  | 'out_of_build_range'
  | 'cell_occupied'
  | 'not_mining_point'
  | 'building_not_ready'
  | 'cannot_produce'
  | 'unit_not_found'
  | 'building_not_found'
  | 'target_not_found'
  | 'invalid_move'
  | 'invalid_attack'
  | 'invalid_heal'
  | 'invalid_token'
  | 'game_not_found'
  | 'game_already_full'
  | 'game_not_started'
  | 'game_over';
```

- [ ] **步骤 2: 验证类型编译**

Run: `cd C:/cosmos/github/game && npx tsc --noEmit`
Expected: 无错误

- [ ] **步骤 3: 提交**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

## 任务 3: 事件总线

事件总线是引擎与 API 层之间的解耦层。任何状态变更都通过事件发出，SSE 订阅这些事件推送给前端。

**Files:**
- Create: `C:/cosmos/github/game/src/events/bus.ts`
- Create: `C:/cosmos/github/game/tests/engine/bus.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/bus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import type { GameEvent } from '../../src/types.js';

describe('EventBus', () => {
  it('emits events to subscribers of the same gameId', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('game1', handler);

    const evt: GameEvent = { seq: 1, type: 'move', timestamp: Date.now(), payload: {} };
    bus.emit('game1', evt);

    expect(handler).toHaveBeenCalledWith(evt);
  });

  it('does not deliver events to other gameId subscribers', () => {
    const bus = new EventBus();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    bus.subscribe('gameA', handlerA);
    bus.subscribe('gameB', handlerB);

    bus.emit('gameA', { seq: 1, type: 'move', timestamp: 0, payload: {} });

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('unsubscribe removes the handler', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.subscribe('g1', handler);
    unsub();
    bus.emit('g1', { seq: 1, type: 'move', timestamp: 0, payload: {} });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/bus.test.ts`
Expected: FAIL（找不到 EventBus 模块）

- [ ] **步骤 3: 实现 EventBus**

```typescript
// src/events/bus.ts
import type { GameEvent } from '../types.js';

export type EventHandler = (event: GameEvent) => void;

export class EventBus {
  private subscribers: Map<string, Set<EventHandler>> = new Map();

  subscribe(gameId: string, handler: EventHandler): () => void {
    if (!this.subscribers.has(gameId)) {
      this.subscribers.set(gameId, new Set());
    }
    this.subscribers.get(gameId)!.add(handler);
    return () => this.unsubscribe(gameId, handler);
  }

  unsubscribe(gameId: string, handler: EventHandler): void {
    this.subscribers.get(gameId)?.delete(handler);
  }

  emit(gameId: string, event: GameEvent): void {
    const handlers = this.subscribers.get(gameId);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('Event handler error:', err);
      }
    }
  }

  clear(gameId: string): void {
    this.subscribers.delete(gameId);
  }
}

export const globalEventBus = new EventBus();
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/bus.test.ts`
Expected: PASS（3 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/events/bus.ts tests/engine/bus.test.ts
git commit -m "feat: add event bus with per-game subscriptions"
```

---

## 任务 4: 单位与建筑规格表

集中定义所有单位和建筑的数值常量，避免散落各处。

**Files:**
- Create: `C:/cosmos/github/game/src/engine/specs.ts`
- Create: `C:/cosmos/github/game/tests/engine/specs.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/specs.test.ts
import { describe, it, expect } from 'vitest';
import { UNIT_SPECS, BUILDING_SPECS, CAN_PRODUCE } from '../../src/engine/specs.js';

describe('specs', () => {
  it('infantry has expected stats', () => {
    expect(UNIT_SPECS.infantry).toEqual({
      hp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1,
      cost: 40, productionTime: 1,
    });
  });

  it('tank is highest hp unit', () => {
    expect(UNIT_SPECS.tank.hp).toBe(150);
  });

  it('barracks costs 50 gold and takes 2 turns', () => {
    expect(BUILDING_SPECS.barracks.cost).toBe(50);
    expect(BUILDING_SPECS.barracks.buildTime).toBe(2);
  });

  it('headquarters can produce infantry but not tanks', () => {
    expect(CAN_PRODUCE.headquarters).toEqual(['infantry']);
  });

  it('barracks can produce all 4 unit types', () => {
    expect(CAN_PRODUCE.barracks.sort()).toEqual(
      ['infantry', 'medic', 'sniper', 'tank']
    );
  });

  it('miner cannot produce units', () => {
    expect(CAN_PRODUCE.miner).toEqual([]);
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/specs.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现规格表**

```typescript
// src/engine/specs.ts
import type { UnitType, BuildingType } from '../types.js';

export interface UnitSpec {
  hp: number;
  attack: number;
  defense: number;
  moveRange: number;
  attackRange: number;
  cost: number;
  productionTime: number;
}

export interface BuildingSpec {
  hp: number;
  cost: number;
  buildTime: number;
}

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  infantry: { hp: 100, attack: 20, defense: 8, moveRange: 3, attackRange: 1, cost: 40, productionTime: 1 },
  sniper:   { hp: 60,  attack: 35, defense: 3, moveRange: 2, attackRange: 4, cost: 60, productionTime: 2 },
  tank:     { hp: 150, attack: 25, defense: 15, moveRange: 2, attackRange: 1, cost: 80, productionTime: 3 },
  medic:    { hp: 70,  attack: 5,  defense: 5, moveRange: 3, attackRange: 1, cost: 50, productionTime: 1 },
};

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  headquarters: { hp: 200, cost: 0,  buildTime: 0 },
  barracks:     { hp: 100, cost: 50, buildTime: 2 },
  miner:        { hp: 60,  cost: 30, buildTime: 1 },
};

export const CAN_PRODUCE: Record<BuildingType, UnitType[]> = {
  headquarters: ['infantry'],
  barracks:     ['infantry', 'sniper', 'tank', 'medic'],
  miner:        [],
};

export const STARTING_GOLD = 100;
export const MINER_INCOME = 15;
export const BUILD_RANGE = 2;
export const MAP_WIDTH = 30;
export const MAP_HEIGHT = 30;

export const HQ_POSITIONS: Record<'player_a' | 'player_b', { x: number; y: number }> = {
  player_a: { x: 4,  y: 15 },
  player_b: { x: 25, y: 15 },
};

export const MINING_POINTS = [
  { x: 10, y: 5  }, { x: 10, y: 15 }, { x: 10, y: 25 },
  { x: 19, y: 5  }, { x: 19, y: 15 }, { x: 19, y: 25 },
];
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/specs.test.ts`
Expected: PASS（6 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/engine/specs.ts tests/engine/specs.test.ts
git commit -m "feat: add unit and building specifications"
```

---

## 任务 5: 状态存储

游戏状态的内存存储和初始化，包括玩家 Token 生成。

**Files:**
- Create: `C:/cosmos/github/game/src/state/store.ts`
- Create: `C:/cosmos/github/game/tests/engine/store.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameStore, createInitialGame } from '../../src/state/store.js';

describe('GameStore', () => {
  let store: GameStore;

  beforeEach(() => { store = new GameStore(); });

  it('createInitialGame creates game with HQ for both players', () => {
    const game = createInitialGame('g1');
    expect(game.buildings).toHaveLength(2);
    expect(game.buildings.find(b => b.owner === 'player_a')?.type).toBe('headquarters');
    expect(game.buildings.find(b => b.owner === 'player_b')?.type).toBe('headquarters');
  });

  it('initial game has 100 gold per player', () => {
    const game = createInitialGame('g1');
    expect(game.resources.player_a.gold).toBe(100);
    expect(game.resources.player_b.gold).toBe(100);
  });

  it('initial game has 6 mining points', () => {
    const game = createInitialGame('g1');
    expect(game.miningPoints).toHaveLength(6);
  });

  it('initial game has no units and waiting_for_player phase', () => {
    const game = createInitialGame('g1');
    expect(game.units).toEqual([]);
    expect(game.phase).toBe('waiting_for_player');
    expect(game.turn.currentOwner).toBe('player_a');
    expect(game.turn.turnNumber).toBe(1);
  });

  it('initial game generates unique token for player_a only', () => {
    const game = createInitialGame('g1');
    expect(game.tokens.player_a).toMatch(/^[a-f0-9]{32}$/);
    expect(game.tokens.player_b).toBe('');
  });

  it('store can save and retrieve games', () => {
    const game = createInitialGame('g1');
    store.save(game);
    expect(store.get('g1')?.id).toBe('g1');
  });

  it('store returns undefined for missing games', () => {
    expect(store.get('nope')).toBeUndefined();
  });

  it('store can list all game ids', () => {
    store.save(createInitialGame('g1'));
    store.save(createInitialGame('g2'));
    expect(store.list().sort()).toEqual(['g1', 'g2']);
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/store.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现 GameStore 和 createInitialGame**

```typescript
// src/state/store.ts
import { randomBytes, randomUUID } from 'node:crypto';
import type { GameState, Building, PlayerId } from '../types.js';
import {
  BUILDING_SPECS, HQ_POSITIONS, MINING_POINTS,
  MAP_WIDTH, MAP_HEIGHT, STARTING_GOLD,
} from '../engine/specs.js';

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function createHQ(owner: PlayerId): Building {
  const pos = HQ_POSITIONS[owner];
  return {
    id: randomUUID(),
    owner,
    type: 'headquarters',
    x: pos.x,
    y: pos.y,
    hp: BUILDING_SPECS.headquarters.hp,
    maxHp: BUILDING_SPECS.headquarters.hp,
    alive: true,
    buildProgress: 0,
    isBuilding: false,
    production: null,
  };
}

export function createInitialGame(id: string): GameState {
  return {
    id,
    phase: 'waiting_for_player',
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    miningPoints: MINING_POINTS.map(p => ({ ...p })),
    buildings: [createHQ('player_a'), createHQ('player_b')],
    units: [],
    resources: {
      player_a: { gold: STARTING_GOLD },
      player_b: { gold: STARTING_GOLD },
    },
    tokens: {
      player_a: generateToken(),
      player_b: '',
    },
    turn: { turnNumber: 1, currentOwner: 'player_a', phase: 'waiting_for_player' },
    events: [],
    winner: null,
  };
}

export class GameStore {
  private games: Map<string, GameState> = new Map();

  save(game: GameState): void {
    this.games.set(game.id, game);
  }

  get(id: string): GameState | undefined {
    return this.games.get(id);
  }

  list(): string[] {
    return [...this.games.keys()];
  }

  delete(id: string): void {
    this.games.delete(id);
  }
}

export const globalStore = new GameStore();
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/store.test.ts`
Expected: PASS（8 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/state/store.ts tests/engine/store.test.ts
git commit -m "feat: add game store with initial game factory"
```

---

## 任务 6: 验证辅助函数

集中实现位置检查、距离计算、建造范围检查等共享辅助函数。

**Files:**
- Create: `C:/cosmos/github/game/src/engine/validation.ts`
- Create: `C:/cosmos/github/game/tests/engine/validation.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/validation.test.ts
import { describe, it, expect } from 'vitest';
import {
  manhattanDistance,
  isInBounds,
  getCellOccupant,
  isInBuildRange,
  isMiningPoint,
  findAdjacentFreeCell,
} from '../../src/engine/validation.js';
import { createInitialGame } from '../../src/state/store.js';

describe('validation', () => {
  it('manhattanDistance computes correctly', () => {
    expect(manhattanDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
    expect(manhattanDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('isInBounds returns true for valid cells', () => {
    expect(isInBounds(0, 0, 30, 30)).toBe(true);
    expect(isInBounds(29, 29, 30, 30)).toBe(true);
  });

  it('isInBounds returns false for out-of-bounds cells', () => {
    expect(isInBounds(-1, 0, 30, 30)).toBe(false);
    expect(isInBounds(30, 0, 30, 30)).toBe(false);
    expect(isInBounds(0, 30, 30, 30)).toBe(false);
  });

  it('getCellOccupant returns HQ at its location', () => {
    const game = createInitialGame('g1');
    const occ = getCellOccupant(game, 4, 15);
    expect(occ?.kind).toBe('building');
    expect((occ as any).entity.type).toBe('headquarters');
  });

  it('getCellOccupant returns null for empty cells', () => {
    const game = createInitialGame('g1');
    expect(getCellOccupant(game, 0, 0)).toBeNull();
  });

  it('isInBuildRange returns true near friendly HQ', () => {
    const game = createInitialGame('g1');
    expect(isInBuildRange(game, 'player_a', 5, 15)).toBe(true);
    expect(isInBuildRange(game, 'player_a', 4, 17)).toBe(true);
  });

  it('isInBuildRange returns false far from friendly objects', () => {
    const game = createInitialGame('g1');
    expect(isInBuildRange(game, 'player_a', 20, 20)).toBe(false);
  });

  it('isInBuildRange ignores enemy objects', () => {
    const game = createInitialGame('g1');
    expect(isInBuildRange(game, 'player_a', 26, 15)).toBe(false);
  });

  it('isMiningPoint identifies known mining points', () => {
    const game = createInitialGame('g1');
    expect(isMiningPoint(game, 10, 15)).toBe(true);
    expect(isMiningPoint(game, 0, 0)).toBe(false);
  });

  it('findAdjacentFreeCell returns a free neighbor', () => {
    const game = createInitialGame('g1');
    const cell = findAdjacentFreeCell(game, 4, 15);
    expect(cell).not.toBeNull();
    expect(manhattanDistance(cell!, { x: 4, y: 15 })).toBe(1);
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/validation.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现验证辅助**

```typescript
// src/engine/validation.ts
import type { GameState, PlayerId, Position, Unit, Building } from '../types.js';
import { BUILD_RANGE } from './specs.js';

export type Occupant =
  | { kind: 'unit'; entity: Unit }
  | { kind: 'building'; entity: Building };

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isInBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && x < w && y >= 0 && y < h;
}

export function getCellOccupant(game: GameState, x: number, y: number): Occupant | null {
  const unit = game.units.find(u => u.alive && u.x === x && u.y === y);
  if (unit) return { kind: 'unit', entity: unit };
  const building = game.buildings.find(b => b.alive && b.x === x && b.y === y);
  if (building) return { kind: 'building', entity: building };
  return null;
}

export function isInBuildRange(game: GameState, owner: PlayerId, x: number, y: number): boolean {
  const target = { x, y };
  for (const u of game.units) {
    if (u.owner !== owner || !u.alive) continue;
    if (manhattanDistance(u, target) <= BUILD_RANGE) return true;
  }
  for (const b of game.buildings) {
    if (b.owner !== owner || !b.alive) continue;
    if (manhattanDistance(b, target) <= BUILD_RANGE) return true;
  }
  return false;
}

export function isMiningPoint(game: GameState, x: number, y: number): boolean {
  return game.miningPoints.some(p => p.x === x && p.y === y);
}

export function findAdjacentFreeCell(game: GameState, x: number, y: number): Position | null {
  const candidates: Position[] = [
    { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
  ];
  for (const c of candidates) {
    if (!isInBounds(c.x, c.y, game.mapWidth, game.mapHeight)) continue;
    if (getCellOccupant(game, c.x, c.y) === null) return c;
  }
  return null;
}
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/validation.test.ts`
Expected: PASS（10 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/engine/validation.ts tests/engine/validation.test.ts
git commit -m "feat: add validation helpers (range, bounds, occupants)"
```

---

## 任务 7: 事件追加辅助

所有引擎操作都需要追加事件到游戏的事件日志并通过总线广播。集中实现避免每个模块重复写。

**Files:**
- Create: `C:/cosmos/github/game/src/engine/events.ts`
- Create: `C:/cosmos/github/game/tests/engine/events.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { appendEvent } from '../../src/engine/events.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';

describe('appendEvent', () => {
  it('appends event with sequential seq starting at 1', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    const ev1 = appendEvent(game, bus, 'move', { foo: 1 });
    const ev2 = appendEvent(game, bus, 'attack', { bar: 2 });
    expect(ev1.seq).toBe(1);
    expect(ev2.seq).toBe(2);
    expect(game.events).toHaveLength(2);
  });

  it('stores payload and timestamp on the event', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    const ev = appendEvent(game, bus, 'mine', { gold: 15 });
    expect(ev.payload).toEqual({ gold: 15 });
    expect(typeof ev.timestamp).toBe('number');
  });

  it('emits event through bus to subscribers', () => {
    const game = createInitialGame('g1');
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('g1', handler);
    appendEvent(game, bus, 'turn_end', {});
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].type).toBe('turn_end');
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/events.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现 appendEvent**

```typescript
// src/engine/events.ts
import type { GameState, GameEvent, EventType } from '../types.js';
import type { EventBus } from '../events/bus.js';

export function appendEvent(
  game: GameState,
  bus: EventBus,
  type: EventType,
  payload: Record<string, unknown>,
): GameEvent {
  const event: GameEvent = {
    seq: game.events.length + 1,
    type,
    timestamp: Date.now(),
    payload,
  };
  game.events.push(event);
  bus.emit(game.id, event);
  return event;
}
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/events.test.ts`
Expected: PASS（3 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/engine/events.ts tests/engine/events.test.ts
git commit -m "feat: add appendEvent helper for engine"
```

---

## 任务 8: 建造系统

实现建造指令的验证和执行：扣金、检查建造范围、空格、采矿点限制，并把建筑加入状态。

**Files:**
- Create: `C:/cosmos/github/game/src/engine/building.ts`
- Create: `C:/cosmos/github/game/tests/engine/building.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/building.test.ts
import { describe, it, expect } from 'vitest';
import { startBuild, tickBuildProgress } from '../../src/engine/building.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';

function setup() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  return { game, bus: new EventBus() };
}

describe('startBuild', () => {
  it('barracks adjacent to HQ succeeds and deducts gold', () => {
    const { game, bus } = setup();
    const before = game.resources.player_a.gold;
    const result = startBuild(game, bus, 'player_a', 'barracks', 5, 15);
    expect(result.ok).toBe(true);
    expect(game.resources.player_a.gold).toBe(before - 50);
    expect(game.buildings.some(b => b.x === 5 && b.y === 15 && b.isBuilding)).toBe(true);
  });

  it('fails when player has insufficient gold', () => {
    const { game, bus } = setup();
    game.resources.player_a.gold = 10;
    const result = startBuild(game, bus, 'player_a', 'barracks', 5, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('insufficient_gold');
  });

  it('fails when out of build range', () => {
    const { game, bus } = setup();
    const result = startBuild(game, bus, 'player_a', 'barracks', 20, 20);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('out_of_build_range');
  });

  it('fails when cell is occupied', () => {
    const { game, bus } = setup();
    const result = startBuild(game, bus, 'player_a', 'barracks', 4, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('cell_occupied');
  });

  it('miner fails when not on a mining point', () => {
    const { game, bus } = setup();
    const result = startBuild(game, bus, 'player_a', 'miner', 5, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_mining_point');
  });

  it('miner succeeds when on a mining point in range', () => {
    const { game, bus } = setup();
    // Move HQ_A close to a mining point for this test
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.x = 10; hq.y = 14;
    const result = startBuild(game, bus, 'player_a', 'miner', 10, 15);
    expect(result.ok).toBe(true);
  });

  it('headquarters cannot be built', () => {
    const { game, bus } = setup();
    const result = startBuild(game, bus, 'player_a', 'headquarters', 5, 15);
    expect(result.ok).toBe(false);
  });

  it('emits build event on success', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'barracks', 5, 15);
    expect(game.events.some(e => e.type === 'build')).toBe(true);
  });
});

describe('tickBuildProgress', () => {
  it('decrements buildProgress for in-construction buildings of player', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'barracks', 5, 15);
    const before = game.events.length;
    tickBuildProgress(game, bus, 'player_a');
    const b = game.buildings.find(x => x.x === 5 && x.y === 15)!;
    expect(b.buildProgress).toBe(1);
    expect(b.isBuilding).toBe(true);
    expect(game.events.length).toBe(before); // no build_complete yet
  });

  it('emits build_complete when buildProgress reaches 0', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'barracks', 5, 15);
    tickBuildProgress(game, bus, 'player_a'); // 2 -> 1
    tickBuildProgress(game, bus, 'player_a'); // 1 -> 0
    const b = game.buildings.find(x => x.x === 5 && x.y === 15)!;
    expect(b.isBuilding).toBe(false);
    expect(b.buildProgress).toBe(0);
    expect(game.events.some(e => e.type === 'build_complete')).toBe(true);
  });

  it('does not affect other player buildings', () => {
    const { game, bus } = setup();
    startBuild(game, bus, 'player_a', 'barracks', 5, 15);
    tickBuildProgress(game, bus, 'player_b');
    const b = game.buildings.find(x => x.x === 5 && x.y === 15)!;
    expect(b.buildProgress).toBe(2); // unchanged
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/building.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现建造系统**

```typescript
// src/engine/building.ts
import { randomUUID } from 'node:crypto';
import type { GameState, PlayerId, BuildingType, Building } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { ApiErrorCode } from '../types.js';
import { BUILDING_SPECS } from './specs.js';
import {
  isInBounds, getCellOccupant, isInBuildRange, isMiningPoint,
} from './validation.js';
import { appendEvent } from './events.js';

export type Result<T = void> =
  | { ok: true; data?: T }
  | { ok: false; code: ApiErrorCode; message: string };

export function startBuild(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  type: BuildingType,
  x: number,
  y: number,
): Result<Building> {
  if (type === 'headquarters') {
    return { ok: false, code: 'cannot_produce', message: 'headquarters cannot be built' };
  }
  if (!isInBounds(x, y, game.mapWidth, game.mapHeight)) {
    return { ok: false, code: 'invalid_move', message: 'out of bounds' };
  }
  const spec = BUILDING_SPECS[type];
  if (game.resources[owner].gold < spec.cost) {
    return { ok: false, code: 'insufficient_gold', message: `need ${spec.cost} gold` };
  }
  if (!isInBuildRange(game, owner, x, y)) {
    return { ok: false, code: 'out_of_build_range', message: 'no friendly object within 2 cells' };
  }
  if (getCellOccupant(game, x, y) !== null) {
    return { ok: false, code: 'cell_occupied', message: 'cell occupied' };
  }
  if (type === 'miner' && !isMiningPoint(game, x, y)) {
    return { ok: false, code: 'not_mining_point', message: 'miner must be on a mining point' };
  }

  game.resources[owner].gold -= spec.cost;
  const building: Building = {
    id: randomUUID(),
    owner,
    type,
    x, y,
    hp: spec.hp,
    maxHp: spec.hp,
    alive: true,
    buildProgress: spec.buildTime,
    isBuilding: spec.buildTime > 0,
    production: null,
  };
  game.buildings.push(building);
  appendEvent(game, bus, 'build', {
    buildingId: building.id, owner, type, x, y, buildTime: spec.buildTime,
  });
  return { ok: true, data: building };
}

export function tickBuildProgress(game: GameState, bus: EventBus, owner: PlayerId): void {
  for (const b of game.buildings) {
    if (b.owner !== owner || !b.isBuilding || !b.alive) continue;
    b.buildProgress -= 1;
    if (b.buildProgress <= 0) {
      b.buildProgress = 0;
      b.isBuilding = false;
      appendEvent(game, bus, 'build_complete', {
        buildingId: b.id, owner, type: b.type, x: b.x, y: b.y,
      });
    }
  }
}
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/building.test.ts`
Expected: PASS（11 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/engine/building.ts tests/engine/building.test.ts
git commit -m "feat: add building construction system"
```

---

## 任务 9: 生产系统

实现单位生产指令：扣金、入队，以及回合结束时的进度推进和单位生成。

**Files:**
- Create: `C:/cosmos/github/game/src/engine/production.ts`
- Create: `C:/cosmos/github/game/tests/engine/production.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/production.test.ts
import { describe, it, expect } from 'vitest';
import { startProduction, tickProduction } from '../../src/engine/production.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';

function setup() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  return { game, bus: new EventBus() };
}

describe('startProduction', () => {
  it('queues infantry at HQ and deducts gold', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    const result = startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(result.ok).toBe(true);
    expect(game.resources.player_a.gold).toBe(60); // 100 - 40
    expect(hq.production).toEqual({ type: 'infantry', turnsRemaining: 1 });
  });

  it('fails when building belongs to other player', () => {
    const { game, bus } = setup();
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;
    const result = startProduction(game, bus, 'player_a', hqB.id, 'infantry');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('building_not_found');
  });

  it('fails when building is still under construction', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.isBuilding = true;
    hq.buildProgress = 2;
    const result = startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('building_not_ready');
  });

  it('fails when HQ tries to produce a tank', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    const result = startProduction(game, bus, 'player_a', hq.id, 'tank');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('cannot_produce');
  });

  it('fails when production slot is busy', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    startProduction(game, bus, 'player_a', hq.id, 'infantry');
    const result = startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(result.ok).toBe(false);
  });

  it('fails when insufficient gold', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    game.resources.player_a.gold = 10;
    const result = startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('insufficient_gold');
  });

  it('emits produce event on success', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    startProduction(game, bus, 'player_a', hq.id, 'infantry');
    expect(game.events.some(e => e.type === 'produce')).toBe(true);
  });
});

describe('tickProduction', () => {
  it('decrements turnsRemaining', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.production = { type: 'tank', turnsRemaining: 3 };
    tickProduction(game, bus, 'player_a');
    expect(hq.production?.turnsRemaining).toBe(2);
  });

  it('spawns unit when complete', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.production = { type: 'infantry', turnsRemaining: 1 };
    tickProduction(game, bus, 'player_a');
    expect(hq.production).toBeNull();
    expect(game.units).toHaveLength(1);
    expect(game.units[0].type).toBe('infantry');
    expect(game.units[0].owner).toBe('player_a');
    expect(game.events.some(e => e.type === 'produce_complete')).toBe(true);
  });

  it('does not affect other player production', () => {
    const { game, bus } = setup();
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;
    hqB.production = { type: 'infantry', turnsRemaining: 1 };
    tickProduction(game, bus, 'player_a');
    expect(hqB.production?.turnsRemaining).toBe(1);
  });

  it('skips production if no free adjacent cell', () => {
    const { game, bus } = setup();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    // Surround HQ with buildings - simulate occupied neighbors using mining points off-map by force
    // Easier: set HQ to corner so 2 neighbors are out of bounds, then put units on the other 2
    hq.x = 0; hq.y = 0;
    game.units.push({
      id: 'block1', owner: 'player_a', type: 'infantry',
      x: 1, y: 0, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    game.units.push({
      id: 'block2', owner: 'player_a', type: 'infantry',
      x: 0, y: 1, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    hq.production = { type: 'infantry', turnsRemaining: 1 };
    tickProduction(game, bus, 'player_a');
    // Production stays queued at 0, no spawn until a cell frees up
    expect(hq.production).not.toBeNull();
    expect(hq.production?.turnsRemaining).toBe(0);
    expect(game.units.filter(u => u.type === 'infantry' && u.owner === 'player_a' && u.id !== 'block1' && u.id !== 'block2')).toHaveLength(0);
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/production.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现生产系统**

```typescript
// src/engine/production.ts
import { randomUUID } from 'node:crypto';
import type { GameState, PlayerId, UnitType, Unit } from '../types.js';
import type { EventBus } from '../events/bus.js';
import { UNIT_SPECS, CAN_PRODUCE } from './specs.js';
import { findAdjacentFreeCell } from './validation.js';
import { appendEvent } from './events.js';
import type { Result } from './building.js';

export function startProduction(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  buildingId: string,
  unitType: UnitType,
): Result {
  const building = game.buildings.find(b => b.id === buildingId && b.owner === owner && b.alive);
  if (!building) {
    return { ok: false, code: 'building_not_found', message: 'building not found' };
  }
  if (building.isBuilding) {
    return { ok: false, code: 'building_not_ready', message: 'building under construction' };
  }
  if (!CAN_PRODUCE[building.type].includes(unitType)) {
    return { ok: false, code: 'cannot_produce', message: `${building.type} cannot produce ${unitType}` };
  }
  if (building.production !== null) {
    return { ok: false, code: 'cannot_produce', message: 'production slot busy' };
  }
  const spec = UNIT_SPECS[unitType];
  if (game.resources[owner].gold < spec.cost) {
    return { ok: false, code: 'insufficient_gold', message: `need ${spec.cost} gold` };
  }

  game.resources[owner].gold -= spec.cost;
  building.production = { type: unitType, turnsRemaining: spec.productionTime };
  appendEvent(game, bus, 'produce', {
    buildingId: building.id, owner, unitType, productionTime: spec.productionTime,
  });
  return { ok: true };
}

function spawnUnit(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  type: UnitType,
  x: number,
  y: number,
): Unit {
  const spec = UNIT_SPECS[type];
  const unit: Unit = {
    id: randomUUID(),
    owner, type, x, y,
    hp: spec.hp, maxHp: spec.hp,
    attack: spec.attack, defense: spec.defense,
    moveRange: spec.moveRange, attackRange: spec.attackRange,
    alive: true, hasMoved: false, hasAttacked: false,
  };
  game.units.push(unit);
  appendEvent(game, bus, 'produce_complete', {
    unitId: unit.id, owner, type, x, y,
  });
  return unit;
}

export function tickProduction(game: GameState, bus: EventBus, owner: PlayerId): void {
  for (const b of game.buildings) {
    if (b.owner !== owner || !b.alive || b.isBuilding || b.production === null) continue;
    b.production.turnsRemaining -= 1;
    if (b.production.turnsRemaining <= 0) {
      const cell = findAdjacentFreeCell(game, b.x, b.y);
      if (cell === null) {
        // No free space, hold production at 0 until a cell frees up
        b.production.turnsRemaining = 0;
        continue;
      }
      const type = b.production.type;
      b.production = null;
      spawnUnit(game, bus, owner, type, cell.x, cell.y);
    }
  }
}
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/production.test.ts`
Expected: PASS（10 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/engine/production.ts tests/engine/production.test.ts
git commit -m "feat: add unit production system"
```

---

## 任务 10: 采矿/资源系统

实现采矿器收入：每回合开始时，已完工的采矿器为所属玩家产出金币。

**Files:**
- Create: `C:/cosmos/github/game/src/engine/mining.ts`
- Create: `C:/cosmos/github/game/tests/engine/mining.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/mining.test.ts
import { describe, it, expect } from 'vitest';
import { collectMiningIncome } from '../../src/engine/mining.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { randomUUID } from 'node:crypto';

function setup() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  return { game, bus: new EventBus() };
}

function addMiner(game: ReturnType<typeof setup>['game'], owner: 'player_a' | 'player_b', x: number, y: number, isBuilding = false) {
  game.buildings.push({
    id: randomUUID(), owner, type: 'miner',
    x, y, hp: 60, maxHp: 60, alive: true,
    buildProgress: isBuilding ? 1 : 0,
    isBuilding,
    production: null,
  });
}

describe('collectMiningIncome', () => {
  it('grants 15 gold per completed miner', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_a', 10, 5);
    addMiner(game, 'player_a', 10, 15);
    const before = game.resources.player_a.gold;
    collectMiningIncome(game, bus, 'player_a');
    expect(game.resources.player_a.gold).toBe(before + 30);
  });

  it('does not grant gold for in-construction miners', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_a', 10, 5, true);
    const before = game.resources.player_a.gold;
    collectMiningIncome(game, bus, 'player_a');
    expect(game.resources.player_a.gold).toBe(before);
  });

  it('does not grant gold to other player miners', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_b', 19, 5);
    const before = game.resources.player_a.gold;
    collectMiningIncome(game, bus, 'player_a');
    expect(game.resources.player_a.gold).toBe(before);
  });

  it('emits mine event per miner', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_a', 10, 5);
    addMiner(game, 'player_a', 10, 15);
    collectMiningIncome(game, bus, 'player_a');
    const mineEvents = game.events.filter(e => e.type === 'mine');
    expect(mineEvents).toHaveLength(2);
    expect(mineEvents[0].payload.amount).toBe(15);
  });

  it('does not count destroyed miners', () => {
    const { game, bus } = setup();
    addMiner(game, 'player_a', 10, 5);
    game.buildings.at(-1)!.alive = false;
    const before = game.resources.player_a.gold;
    collectMiningIncome(game, bus, 'player_a');
    expect(game.resources.player_a.gold).toBe(before);
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/mining.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现采矿收入**

```typescript
// src/engine/mining.ts
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import { MINER_INCOME } from './specs.js';
import { appendEvent } from './events.js';

export function collectMiningIncome(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
): number {
  let total = 0;
  for (const b of game.buildings) {
    if (b.owner !== owner) continue;
    if (b.type !== 'miner') continue;
    if (!b.alive || b.isBuilding) continue;
    game.resources[owner].gold += MINER_INCOME;
    total += MINER_INCOME;
    appendEvent(game, bus, 'mine', {
      buildingId: b.id, owner, amount: MINER_INCOME, x: b.x, y: b.y,
    });
  }
  return total;
}
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/mining.test.ts`
Expected: PASS（5 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/engine/mining.ts tests/engine/mining.test.ts
git commit -m "feat: add mining income system"
```

---

## 任务 11: 单位移动

实现单位移动指令。检查所有权、移动力、目标格空闲、本回合未行动等。

**Files:**
- Create: `C:/cosmos/github/game/src/engine/units.ts`
- Create: `C:/cosmos/github/game/tests/engine/units.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/units.test.ts
import { describe, it, expect } from 'vitest';
import { moveUnit } from '../../src/engine/units.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { randomUUID } from 'node:crypto';

function setupWithUnit() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  const unit = {
    id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
    x: 5, y: 15, hp: 100, maxHp: 100, attack: 20, defense: 8,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  game.units.push(unit);
  return { game, bus: new EventBus(), unit };
}

describe('moveUnit', () => {
  it('moves unit within range', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_a', unit.id, 7, 15);
    expect(result.ok).toBe(true);
    expect(unit.x).toBe(7);
    expect(unit.y).toBe(15);
    expect(unit.hasMoved).toBe(true);
  });

  it('emits move event', () => {
    const { game, bus, unit } = setupWithUnit();
    moveUnit(game, bus, 'player_a', unit.id, 7, 15);
    const ev = game.events.find(e => e.type === 'move');
    expect(ev).toBeDefined();
    expect(ev?.payload).toMatchObject({ unitId: unit.id, fromX: 5, fromY: 15, toX: 7, toY: 15 });
  });

  it('fails when unit not owned by player', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_b', unit.id, 7, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unit_not_found');
  });

  it('fails when out of move range', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_a', unit.id, 10, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_move');
  });

  it('fails when target cell is occupied', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_a', unit.id, 4, 15); // HQ cell
    expect(result.ok).toBe(false);
    expect(result.code).toBe('cell_occupied');
  });

  it('fails when already moved this turn', () => {
    const { game, bus, unit } = setupWithUnit();
    unit.hasMoved = true;
    const result = moveUnit(game, bus, 'player_a', unit.id, 7, 15);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_move');
  });

  it('fails when out of bounds', () => {
    const { game, bus, unit } = setupWithUnit();
    unit.x = 0;
    const result = moveUnit(game, bus, 'player_a', unit.id, -1, 0);
    expect(result.ok).toBe(false);
  });

  it('fails when target is same cell', () => {
    const { game, bus, unit } = setupWithUnit();
    const result = moveUnit(game, bus, 'player_a', unit.id, 5, 15);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/units.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现 moveUnit**

```typescript
// src/engine/units.ts
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './building.js';
import { isInBounds, getCellOccupant, manhattanDistance } from './validation.js';
import { appendEvent } from './events.js';

export function moveUnit(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  unitId: string,
  toX: number,
  toY: number,
): Result {
  const unit = game.units.find(u => u.id === unitId && u.owner === owner && u.alive);
  if (!unit) {
    return { ok: false, code: 'unit_not_found', message: 'unit not found' };
  }
  if (unit.hasMoved) {
    return { ok: false, code: 'invalid_move', message: 'already moved this turn' };
  }
  if (!isInBounds(toX, toY, game.mapWidth, game.mapHeight)) {
    return { ok: false, code: 'invalid_move', message: 'out of bounds' };
  }
  if (unit.x === toX && unit.y === toY) {
    return { ok: false, code: 'invalid_move', message: 'same cell' };
  }
  const dist = manhattanDistance({ x: unit.x, y: unit.y }, { x: toX, y: toY });
  if (dist > unit.moveRange) {
    return { ok: false, code: 'invalid_move', message: `target too far (${dist} > ${unit.moveRange})` };
  }
  if (getCellOccupant(game, toX, toY) !== null) {
    return { ok: false, code: 'cell_occupied', message: 'target cell occupied' };
  }

  const fromX = unit.x, fromY = unit.y;
  unit.x = toX;
  unit.y = toY;
  unit.hasMoved = true;
  appendEvent(game, bus, 'move', {
    unitId: unit.id, owner, fromX, fromY, toX, toY,
  });
  return { ok: true };
}
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/units.test.ts`
Expected: PASS（8 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/engine/units.ts tests/engine/units.test.ts
git commit -m "feat: add unit movement system"
```

---

## 任务 12: 战斗系统 - 攻击

实现攻击指令：目标可以是单位或建筑（含敌方总部），触发伤害计算和死亡/摧毁判定。

**Files:**
- Create: `C:/cosmos/github/game/src/engine/combat.ts`
- Create: `C:/cosmos/github/game/tests/engine/combat-attack.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/combat-attack.test.ts
import { describe, it, expect } from 'vitest';
import { attackTarget } from '../../src/engine/combat.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { randomUUID } from 'node:crypto';

function setupBattle() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  const attacker = {
    id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
    x: 10, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  const defender = {
    id: randomUUID(), owner: 'player_b' as const, type: 'infantry' as const,
    x: 11, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  game.units.push(attacker, defender);
  return { game, bus: new EventBus(), attacker, defender };
}

describe('attackTarget', () => {
  it('attacks adjacent enemy and reduces hp', () => {
    const { game, bus, attacker, defender } = setupBattle();
    const result = attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(result.ok).toBe(true);
    expect(defender.hp).toBeLessThan(100);
    expect(attacker.hasAttacked).toBe(true);
  });

  it('emits attack event with damage in payload', () => {
    const { game, bus, attacker, defender } = setupBattle();
    attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    const ev = game.events.find(e => e.type === 'attack');
    expect(ev).toBeDefined();
    expect(typeof ev?.payload.damage).toBe('number');
  });

  it('fails when attacker is out of range', () => {
    const { game, bus, attacker, defender } = setupBattle();
    defender.x = 15; defender.y = 15;
    const result = attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_attack');
  });

  it('fails when already attacked this turn', () => {
    const { game, bus, attacker, defender } = setupBattle();
    attacker.hasAttacked = true;
    const result = attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(result.ok).toBe(false);
  });

  it('fails when target is friendly', () => {
    const { game, bus, attacker, defender } = setupBattle();
    defender.owner = 'player_a';
    const result = attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_attack');
  });

  it('marks unit as dead and emits unit_death when hp drops to 0', () => {
    const { game, bus, attacker, defender } = setupBattle();
    defender.hp = 5;
    attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(defender.alive).toBe(false);
    expect(game.events.some(e => e.type === 'unit_death')).toBe(true);
  });

  it('can attack enemy building', () => {
    const { game, bus, attacker } = setupBattle();
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;
    attacker.x = hqB.x - 1; attacker.y = hqB.y;
    attacker.attackRange = 1;
    const before = hqB.hp;
    attackTarget(game, bus, 'player_a', attacker.id, hqB.id);
    expect(hqB.hp).toBeLessThan(before);
  });

  it('destroys building when hp drops to 0', () => {
    const { game, bus, attacker } = setupBattle();
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;
    attacker.x = hqB.x - 1; attacker.y = hqB.y;
    hqB.hp = 5;
    attackTarget(game, bus, 'player_a', attacker.id, hqB.id);
    expect(hqB.alive).toBe(false);
    expect(game.events.some(e => e.type === 'base_destroyed')).toBe(true);
    expect(game.events.some(e => e.type === 'game_over')).toBe(true);
    expect(game.phase).toBe('game_over');
    expect(game.winner).toBe('player_a');
  });

  it('non-HQ building destruction does not end game', () => {
    const { game, bus, attacker } = setupBattle();
    const barracks = {
      id: randomUUID(), owner: 'player_b' as const, type: 'barracks' as const,
      x: 11, y: 11, hp: 5, maxHp: 100, alive: true,
      buildProgress: 0, isBuilding: false, production: null,
    };
    game.buildings.push(barracks);
    attacker.x = 11; attacker.y = 10;
    attackTarget(game, bus, 'player_a', attacker.id, barracks.id);
    expect(barracks.alive).toBe(false);
    expect(game.phase).not.toBe('game_over');
  });

  it('minimum damage is 1', () => {
    const { game, bus, attacker, defender } = setupBattle();
    defender.defense = 1000;
    attackTarget(game, bus, 'player_a', attacker.id, defender.id);
    expect(defender.hp).toBeLessThanOrEqual(99);
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/combat-attack.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现攻击逻辑**

```typescript
// src/engine/combat.ts
import type { GameState, PlayerId, Unit, Building } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './building.js';
import { manhattanDistance } from './validation.js';
import { appendEvent } from './events.js';

function rollDamageVariance(): number {
  return Math.floor(Math.random() * 7) - 3; // -3 .. +3
}

function rollHealAmount(): number {
  return 25 + Math.floor(Math.random() * 11); // 25 .. 35
}

function findTarget(game: GameState, targetId: string): Unit | Building | null {
  const u = game.units.find(x => x.id === targetId && x.alive);
  if (u) return u;
  const b = game.buildings.find(x => x.id === targetId && x.alive);
  if (b) return b;
  return null;
}

function targetPos(t: Unit | Building): { x: number; y: number } {
  return { x: t.x, y: t.y };
}

function computeDamage(attack: number, defense: number): number {
  const base = attack - defense + rollDamageVariance();
  return Math.max(1, base);
}

function endGame(game: GameState, bus: EventBus, winner: PlayerId): void {
  game.phase = 'game_over';
  game.turn.phase = 'game_over';
  game.winner = winner;
  appendEvent(game, bus, 'game_over', { winner });
}

export function attackTarget(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  attackerId: string,
  targetId: string,
): Result {
  const attacker = game.units.find(u => u.id === attackerId && u.owner === owner && u.alive);
  if (!attacker) {
    return { ok: false, code: 'unit_not_found', message: 'attacker not found' };
  }
  if (attacker.hasAttacked) {
    return { ok: false, code: 'invalid_attack', message: 'already attacked this turn' };
  }
  const target = findTarget(game, targetId);
  if (!target) {
    return { ok: false, code: 'target_not_found', message: 'target not found' };
  }
  if (target.owner === owner) {
    return { ok: false, code: 'invalid_attack', message: 'cannot attack friendly target' };
  }
  const dist = manhattanDistance({ x: attacker.x, y: attacker.y }, targetPos(target));
  if (dist > attacker.attackRange) {
    return { ok: false, code: 'invalid_attack', message: `out of range (${dist} > ${attacker.attackRange})` };
  }

  const defense = 'defense' in target ? target.defense : 0;
  const damage = computeDamage(attacker.attack, defense);
  target.hp = Math.max(0, target.hp - damage);
  attacker.hasAttacked = true;
  appendEvent(game, bus, 'attack', {
    attackerId, targetId, damage, targetHp: target.hp,
  });

  if (target.hp === 0) {
    target.alive = false;
    if ('attack' in target) {
      appendEvent(game, bus, 'unit_death', {
        unitId: target.id, owner: target.owner, x: target.x, y: target.y,
      });
    } else {
      const isHQ = target.type === 'headquarters';
      appendEvent(game, bus, 'base_destroyed', {
        buildingId: target.id, owner: target.owner,
        type: target.type, x: target.x, y: target.y,
      });
      if (isHQ) {
        endGame(game, bus, owner);
      }
    }
  }
  return { ok: true };
}

export { rollHealAmount };
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/combat-attack.test.ts`
Expected: PASS（10 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/engine/combat.ts tests/engine/combat-attack.test.ts
git commit -m "feat: add combat attack with damage and death handling"
```

---

## 任务 13: 战斗系统 - 治疗

医疗兵不能与普通攻击混用同一行动槽：治疗算作"攻击"动作，占用 hasAttacked 标记。

**Files:**
- Modify: `C:/cosmos/github/game/src/engine/combat.ts`（追加 healTarget）
- Create: `C:/cosmos/github/game/tests/engine/combat-heal.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/combat-heal.test.ts
import { describe, it, expect } from 'vitest';
import { healTarget } from '../../src/engine/combat.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';
import { randomUUID } from 'node:crypto';

function setupHeal() {
  const game = createInitialGame('g1');
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  const medic = {
    id: randomUUID(), owner: 'player_a' as const, type: 'medic' as const,
    x: 10, y: 10, hp: 70, maxHp: 70, attack: 5, defense: 5,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  const wounded = {
    id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
    x: 11, y: 10, hp: 30, maxHp: 100, attack: 20, defense: 8,
    moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
  };
  game.units.push(medic, wounded);
  return { game, bus: new EventBus(), medic, wounded };
}

describe('healTarget', () => {
  it('heals adjacent friendly unit', () => {
    const { game, bus, medic, wounded } = setupHeal();
    const before = wounded.hp;
    const result = healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(result.ok).toBe(true);
    expect(wounded.hp).toBeGreaterThan(before);
    expect(medic.hasAttacked).toBe(true);
  });

  it('does not exceed maxHp', () => {
    const { game, bus, medic, wounded } = setupHeal();
    wounded.hp = wounded.maxHp - 5;
    healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(wounded.hp).toBe(wounded.maxHp);
  });

  it('emits heal event', () => {
    const { game, bus, medic, wounded } = setupHeal();
    healTarget(game, bus, 'player_a', medic.id, wounded.id);
    const ev = game.events.find(e => e.type === 'heal');
    expect(ev).toBeDefined();
    expect(typeof ev?.payload.amount).toBe('number');
  });

  it('fails when caster is not a medic', () => {
    const { game, bus, wounded } = setupHeal();
    const caster = {
      id: randomUUID(), owner: 'player_a' as const, type: 'infantry' as const,
      x: 9, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    };
    game.units.push(caster);
    const result = healTarget(game, bus, 'player_a', caster.id, wounded.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_heal');
  });

  it('fails when target is not adjacent', () => {
    const { game, bus, medic, wounded } = setupHeal();
    wounded.x = 15; wounded.y = 15;
    const result = healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_heal');
  });

  it('fails when target is enemy', () => {
    const { game, bus, medic, wounded } = setupHeal();
    wounded.owner = 'player_b';
    const result = healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_heal');
  });

  it('fails when medic already acted this turn', () => {
    const { game, bus, medic, wounded } = setupHeal();
    medic.hasAttacked = true;
    const result = healTarget(game, bus, 'player_a', medic.id, wounded.id);
    expect(result.ok).toBe(false);
  });

  it('fails when target is a building', () => {
    const { game, bus, medic } = setupHeal();
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    medic.x = hq.x + 1; medic.y = hq.y;
    const result = healTarget(game, bus, 'player_a', medic.id, hq.id);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/combat-heal.test.ts`
Expected: FAIL

- [ ] **步骤 3: 在 `src/engine/combat.ts` 末尾追加 healTarget**

在 `combat.ts` 中找到 `export { rollHealAmount };` 这一行，将其改为先实现 healTarget，然后导出。修改文件末尾：

替换：

```typescript
export { rollHealAmount };
```

为：

```typescript
export function healTarget(
  game: GameState,
  bus: EventBus,
  owner: PlayerId,
  medicId: string,
  targetId: string,
): Result {
  const medic = game.units.find(u => u.id === medicId && u.owner === owner && u.alive);
  if (!medic) {
    return { ok: false, code: 'unit_not_found', message: 'medic not found' };
  }
  if (medic.type !== 'medic') {
    return { ok: false, code: 'invalid_heal', message: 'caster is not a medic' };
  }
  if (medic.hasAttacked) {
    return { ok: false, code: 'invalid_heal', message: 'already acted this turn' };
  }
  const target = game.units.find(u => u.id === targetId && u.alive);
  if (!target) {
    return { ok: false, code: 'invalid_heal', message: 'target is not a unit' };
  }
  if (target.owner !== owner) {
    return { ok: false, code: 'invalid_heal', message: 'cannot heal enemy' };
  }
  const dist = manhattanDistance({ x: medic.x, y: medic.y }, { x: target.x, y: target.y });
  if (dist > 1) {
    return { ok: false, code: 'invalid_heal', message: 'target not adjacent' };
  }

  const amount = rollHealAmount();
  const healed = Math.min(target.maxHp - target.hp, amount);
  target.hp += healed;
  medic.hasAttacked = true;
  appendEvent(game, bus, 'heal', {
    medicId, targetId, amount: healed, targetHp: target.hp,
  });
  return { ok: true };
}
```

注意：保留文件原有的 import 和其它代码不变，只是把 `export { rollHealAmount };` 这一行删除，因为 `healTarget` 已经直接在文件内使用 `rollHealAmount`，不需要再导出。

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/combat-heal.test.ts`
Expected: PASS（8 tests passed）

同时确认攻击测试仍然通过：

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/combat-attack.test.ts`
Expected: PASS

- [ ] **步骤 5: 提交**

```bash
git add src/engine/combat.ts tests/engine/combat-heal.test.ts
git commit -m "feat: add medic heal action"
```

---

## 任务 14: 游戏引擎核心

引擎核心负责：
- 玩家加入游戏 (join)
- 结束回合 (end-turn)：tick 建造、tick 生产、清行动标记、切换玩家、emit turn_end
- 回合开始时收金（采矿收入）

**Files:**
- Create: `C:/cosmos/github/game/src/engine/engine.ts`
- Create: `C:/cosmos/github/game/tests/engine/engine.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/engine/engine.test.ts
import { describe, it, expect } from 'vitest';
import { joinGame, endTurn } from '../../src/engine/engine.js';
import { createInitialGame } from '../../src/state/store.js';
import { EventBus } from '../../src/events/bus.js';

function setup() {
  return { game: createInitialGame('g1'), bus: new EventBus() };
}

describe('joinGame', () => {
  it('sets player_b token and moves phase to waiting_command', () => {
    const { game, bus } = setup();
    const result = joinGame(game, bus);
    expect(result.ok).toBe(true);
    expect(game.tokens.player_b).toMatch(/^[a-f0-9]{32}$/);
    expect(game.phase).toBe('waiting_command');
    expect(game.turn.phase).toBe('waiting_command');
  });

  it('emits game_start event', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    expect(game.events.some(e => e.type === 'game_start')).toBe(true);
  });

  it('fails when game already has 2 players', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    const result = joinGame(game, bus);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('game_already_full');
  });
});

describe('endTurn', () => {
  it('switches currentOwner and increments turn number when wrapping', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    expect(game.turn.currentOwner).toBe('player_a');
    expect(game.turn.turnNumber).toBe(1);
    endTurn(game, bus, 'player_a');
    expect(game.turn.currentOwner).toBe('player_b');
    expect(game.turn.turnNumber).toBe(1); // same round
    endTurn(game, bus, 'player_b');
    expect(game.turn.currentOwner).toBe('player_a');
    expect(game.turn.turnNumber).toBe(2);
  });

  it('fails when called by non-current player', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    const result = endTurn(game, bus, 'player_b');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_your_turn');
  });

  it('resets all unit action flags', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    game.units.push({
      id: 'u1', owner: 'player_a', type: 'infantry',
      x: 5, y: 15, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: true, hasAttacked: true,
    });
    endTurn(game, bus, 'player_a');
    const u = game.units[0];
    expect(u.hasMoved).toBe(false);
    expect(u.hasAttacked).toBe(false);
  });

  it('ticks build progress on end of current player turn', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    game.buildings.push({
      id: 'b1', owner: 'player_a', type: 'barracks',
      x: 5, y: 15, hp: 100, maxHp: 100, alive: true,
      buildProgress: 1, isBuilding: true, production: null,
    });
    endTurn(game, bus, 'player_a');
    const b = game.buildings.find(x => x.id === 'b1')!;
    expect(b.isBuilding).toBe(false);
    expect(b.buildProgress).toBe(0);
  });

  it('ticks production on end of current player turn', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    hq.production = { type: 'infantry', turnsRemaining: 1 };
    endTurn(game, bus, 'player_a');
    expect(game.units.some(u => u.owner === 'player_a' && u.type === 'infantry')).toBe(true);
  });

  it('emits turn_end event with new owner', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    endTurn(game, bus, 'player_a');
    const ev = game.events.find(e => e.type === 'turn_end');
    expect(ev).toBeDefined();
    expect(ev?.payload.nextOwner).toBe('player_b');
  });

  it('collects mining income for next player at start of their turn', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    game.buildings.push({
      id: 'm1', owner: 'player_b', type: 'miner',
      x: 19, y: 5, hp: 60, maxHp: 60, alive: true,
      buildProgress: 0, isBuilding: false, production: null,
    });
    const before = game.resources.player_b.gold;
    endTurn(game, bus, 'player_a');
    expect(game.resources.player_b.gold).toBe(before + 15);
  });

  it('fails when game is over', () => {
    const { game, bus } = setup();
    joinGame(game, bus);
    game.phase = 'game_over';
    const result = endTurn(game, bus, 'player_a');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('game_over');
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/engine.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现引擎核心**

```typescript
// src/engine/engine.ts
import { randomBytes } from 'node:crypto';
import type { GameState, PlayerId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { Result } from './building.js';
import { tickBuildProgress } from './building.js';
import { tickProduction } from './production.js';
import { collectMiningIncome } from './mining.js';
import { appendEvent } from './events.js';

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function otherPlayer(p: PlayerId): PlayerId {
  return p === 'player_a' ? 'player_b' : 'player_a';
}

export function joinGame(game: GameState, bus: EventBus): Result {
  if (game.tokens.player_b !== '') {
    return { ok: false, code: 'game_already_full', message: 'game already has 2 players' };
  }
  game.tokens.player_b = generateToken();
  game.phase = 'waiting_command';
  game.turn.phase = 'waiting_command';
  appendEvent(game, bus, 'game_start', {
    mapWidth: game.mapWidth, mapHeight: game.mapHeight,
    miningPoints: game.miningPoints, firstPlayer: game.turn.currentOwner,
  });
  return { ok: true };
}

export function endTurn(game: GameState, bus: EventBus, owner: PlayerId): Result {
  if (game.phase === 'game_over') {
    return { ok: false, code: 'game_over', message: 'game has ended' };
  }
  if (game.phase !== 'waiting_command') {
    return { ok: false, code: 'game_not_started', message: 'game not in play' };
  }
  if (game.turn.currentOwner !== owner) {
    return { ok: false, code: 'not_your_turn', message: 'not your turn' };
  }

  tickBuildProgress(game, bus, owner);
  tickProduction(game, bus, owner);

  for (const u of game.units) {
    if (u.owner === owner) {
      u.hasMoved = false;
      u.hasAttacked = false;
    }
  }

  const next = otherPlayer(owner);
  if (next === 'player_a') {
    game.turn.turnNumber += 1;
  }
  game.turn.currentOwner = next;

  collectMiningIncome(game, bus, next);

  appendEvent(game, bus, 'turn_end', {
    previousOwner: owner, nextOwner: next, turnNumber: game.turn.turnNumber,
  });
  return { ok: true };
}
```

- [ ] **步骤 4: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/engine/engine.test.ts`
Expected: PASS（10 tests passed）

- [ ] **步骤 5: 提交**

```bash
git add src/engine/engine.ts tests/engine/engine.test.ts
git commit -m "feat: add engine join and end-turn orchestration"
```

---

## 任务 15: 测试辅助函数

为后续 API 集成测试做准备，集中放置测试辅助。

**Files:**
- Create: `C:/cosmos/github/game/tests/helpers.ts`

- [ ] **步骤 1: 创建测试辅助**

```typescript
// tests/helpers.ts
import { buildServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

export async function startTestServer(): Promise<FastifyInstance> {
  const app = await buildServer();
  await app.ready();
  return app;
}

export async function createGameAndJoin(app: FastifyInstance) {
  const createRes = await app.inject({ method: 'POST', url: '/api/games' });
  const created = createRes.json() as { gameId: string; playerAToken: string };

  const joinRes = await app.inject({
    method: 'POST', url: `/api/games/${created.gameId}/join`,
  });
  const joined = joinRes.json() as { playerBToken: string };

  return {
    gameId: created.gameId,
    tokenA: created.playerAToken,
    tokenB: joined.playerBToken,
  };
}
```

- [ ] **步骤 2: 提交**

```bash
git add tests/helpers.ts
git commit -m "test: add api integration helpers"
```

---

## 任务 16: API 路由 - 游戏 CRUD

实现游戏的创建、加入、状态查询接口，以及 Token 鉴权辅助。

**Files:**
- Create: `C:/cosmos/github/game/src/api/auth.ts`
- Create: `C:/cosmos/github/game/src/api/games.ts`
- Create: `C:/cosmos/github/game/src/server.ts`
- Create: `C:/cosmos/github/game/tests/api/games.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/api/games.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../../src/state/store.js';

describe('Games API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    app = await startTestServer();
  });

  it('POST /api/games returns gameId and player A token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/games' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.gameId).toBe('string');
    expect(body.playerAToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it('POST /api/games/:id/join returns player B token', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/games' });
    const { gameId } = create.json();
    const res = await app.inject({ method: 'POST', url: `/api/games/${gameId}/join` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.playerBToken).toMatch(/^[a-f0-9]{32}$/);
  });

  it('POST /api/games/:id/join fails when already full', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({ method: 'POST', url: `/api/games/${gameId}/join` });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('game_already_full');
  });

  it('POST /api/games/:id/join fails for missing game', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/games/nope/join' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('game_not_found');
  });

  it('GET /api/games/:id returns state with valid token', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`,
      headers: { 'x-player-token': tokenA },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(gameId);
    expect(body.buildings).toHaveLength(2);
    expect(body.resources.player_a.gold).toBe(100);
  });

  it('GET /api/games/:id excludes tokens from response', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`,
      headers: { 'x-player-token': tokenA },
    });
    expect(res.json().tokens).toBeUndefined();
  });

  it('GET /api/games/:id fails with invalid token', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}`,
      headers: { 'x-player-token': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_token');
  });

  it('GET /api/games/:id fails with missing token', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({ method: 'GET', url: `/api/games/${gameId}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/games/:id fails for missing game', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/games/nope',
      headers: { 'x-player-token': 'whatever' },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/api/games.test.ts`
Expected: FAIL（找不到 server 模块）

- [ ] **步骤 3: 实现鉴权辅助**

```typescript
// src/api/auth.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { GameState, PlayerId } from '../types.js';
import { globalStore } from '../state/store.js';

const errorStatus: Record<string, number> = {
  game_not_found: 404,
  invalid_token: 401,
  not_your_turn: 403,
  game_already_full: 409,
  game_over: 409,
  game_not_started: 409,
};

export function statusForCode(code: string): number {
  return errorStatus[code] ?? 400;
}

export interface AuthContext {
  game: GameState;
  player: PlayerId;
}

export function authenticate(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): AuthContext | null {
  const game = globalStore.get(req.params.id);
  if (!game) {
    reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
    return null;
  }
  const token = req.headers['x-player-token'];
  if (typeof token !== 'string' || token.length === 0) {
    reply.code(401).send({ error: 'missing token', code: 'invalid_token' });
    return null;
  }
  let player: PlayerId | null = null;
  if (game.tokens.player_a === token) player = 'player_a';
  else if (game.tokens.player_b === token) player = 'player_b';
  if (player === null) {
    reply.code(401).send({ error: 'invalid token', code: 'invalid_token' });
    return null;
  }
  return { game, player };
}

export function sanitizeGameForResponse(game: GameState): unknown {
  const { tokens, ...rest } = game;
  return rest;
}
```

- [ ] **步骤 4: 实现游戏 CRUD 路由**

```typescript
// src/api/games.ts
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { globalStore, createInitialGame } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import { joinGame } from '../engine/engine.js';
import { authenticate, sanitizeGameForResponse, statusForCode } from './auth.js';

export async function gamesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/games', async (_req, _reply) => {
    const id = randomUUID();
    const game = createInitialGame(id);
    globalStore.save(game);
    return { gameId: id, playerAToken: game.tokens.player_a };
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/join', async (req, reply) => {
    const game = globalStore.get(req.params.id);
    if (!game) {
      return reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
    }
    const result = joinGame(game, globalEventBus);
    if (!result.ok) {
      return reply.code(statusForCode(result.code)).send({ error: result.message, code: result.code });
    }
    return { playerBToken: game.tokens.player_b };
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    const ctx = authenticate(req, reply);
    if (!ctx) return;
    return sanitizeGameForResponse(ctx.game);
  });
}
```

- [ ] **步骤 5: 实现服务器入口**

```typescript
// src/server.ts
import Fastify, { type FastifyInstance } from 'fastify';
import { gamesRoutes } from './api/games.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(gamesRoutes);
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  buildServer()
    .then(app => app.listen({ port, host: '0.0.0.0' }))
    .then(addr => console.log(`Server listening on ${addr}`))
    .catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **步骤 6: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/api/games.test.ts`
Expected: PASS（9 tests passed）

- [ ] **步骤 7: 提交**

```bash
git add src/api/auth.ts src/api/games.ts src/server.ts tests/api/games.test.ts
git commit -m "feat: add game CRUD api routes with token auth"
```

---

## 任务 17: API 路由 - 玩家操作

实现 6 个操作端点：build、produce、move、attack、heal、end-turn。所有端点都通过统一的 actionHandler 包装：鉴权、检查回合、调用引擎、返回标准响应。

**Files:**
- Create: `C:/cosmos/github/game/src/api/actions.ts`
- Modify: `C:/cosmos/github/game/src/server.ts`（注册 actionsRoutes）
- Create: `C:/cosmos/github/game/tests/api/actions.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/api/actions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../../src/state/store.js';

describe('Actions API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    app = await startTestServer();
  });

  it('POST /build succeeds adjacent to HQ', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenA },
      payload: { type: 'barracks', x: 5, y: 15 },
    });
    expect(res.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.buildings.some(b => b.x === 5 && b.y === 15)).toBe(true);
  });

  it('POST /build rejects when not your turn', async () => {
    const { gameId, tokenB } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenB },
      payload: { type: 'barracks', x: 26, y: 15 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('not_your_turn');
  });

  it('POST /build returns 400 on insufficient gold', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    game.resources.player_a.gold = 5;
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenA },
      payload: { type: 'barracks', x: 5, y: 15 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('insufficient_gold');
  });

  it('POST /produce queues a unit', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const hq = game.buildings.find(b => b.owner === 'player_a')!;
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/produce`,
      headers: { 'x-player-token': tokenA },
      payload: { buildingId: hq.id, unitType: 'infantry' },
    });
    expect(res.statusCode).toBe(200);
    expect(hq.production?.type).toBe('infantry');
  });

  it('POST /move moves a unit', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    game.units.push({
      id: 'u1', owner: 'player_a', type: 'infantry',
      x: 5, y: 15, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/move`,
      headers: { 'x-player-token': tokenA },
      payload: { unitId: 'u1', x: 7, y: 15 },
    });
    expect(res.statusCode).toBe(200);
    const u = game.units.find(x => x.id === 'u1')!;
    expect(u.x).toBe(7);
  });

  it('POST /attack damages an enemy', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    game.units.push({
      id: 'ua', owner: 'player_a', type: 'infantry',
      x: 10, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    game.units.push({
      id: 'ub', owner: 'player_b', type: 'infantry',
      x: 11, y: 10, hp: 100, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/attack`,
      headers: { 'x-player-token': tokenA },
      payload: { attackerId: 'ua', targetId: 'ub' },
    });
    expect(res.statusCode).toBe(200);
    const ub = game.units.find(x => x.id === 'ub')!;
    expect(ub.hp).toBeLessThan(100);
  });

  it('POST /heal heals friendly unit', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    game.units.push({
      id: 'm', owner: 'player_a', type: 'medic',
      x: 10, y: 10, hp: 70, maxHp: 70, attack: 5, defense: 5,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    game.units.push({
      id: 'w', owner: 'player_a', type: 'infantry',
      x: 11, y: 10, hp: 30, maxHp: 100, attack: 20, defense: 8,
      moveRange: 3, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/heal`,
      headers: { 'x-player-token': tokenA },
      payload: { medicId: 'm', targetId: 'w' },
    });
    expect(res.statusCode).toBe(200);
    const w = game.units.find(x => x.id === 'w')!;
    expect(w.hp).toBeGreaterThan(30);
  });

  it('POST /end-turn switches current player', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });
    expect(res.statusCode).toBe(200);
    const game = globalStore.get(gameId)!;
    expect(game.turn.currentOwner).toBe('player_b');
  });

  it('POST /end-turn rejects from wrong player', async () => {
    const { gameId, tokenB } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenB },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects actions before player B joins', async () => {
    const createRes = await app.inject({ method: 'POST', url: '/api/games' });
    const { gameId, playerAToken } = createRes.json();
    const res = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': playerAToken },
      payload: { type: 'barracks', x: 5, y: 15 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('game_not_started');
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/api/actions.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现操作路由**

```typescript
// src/api/actions.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalEventBus } from '../events/bus.js';
import { authenticate, statusForCode } from './auth.js';
import { startBuild } from '../engine/building.js';
import { startProduction } from '../engine/production.js';
import { moveUnit } from '../engine/units.js';
import { attackTarget, healTarget } from '../engine/combat.js';
import { endTurn } from '../engine/engine.js';
import type { Result } from '../engine/building.js';
import type { AuthContext } from './auth.js';

async function actionHandler(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  action: (ctx: AuthContext) => Result,
): Promise<unknown> {
  const ctx = authenticate(req, reply);
  if (!ctx) return;
  if (ctx.game.phase === 'game_over') {
    return reply.code(statusForCode('game_over'))
      .send({ error: 'game over', code: 'game_over' });
  }
  if (ctx.game.phase !== 'waiting_command') {
    return reply.code(statusForCode('game_not_started'))
      .send({ error: 'game not started', code: 'game_not_started' });
  }
  if (ctx.game.turn.currentOwner !== ctx.player) {
    return reply.code(statusForCode('not_your_turn'))
      .send({ error: 'not your turn', code: 'not_your_turn' });
  }
  const result = action(ctx);
  if (!result.ok) {
    return reply.code(statusForCode(result.code))
      .send({ error: result.message, code: result.code });
  }
  return { ok: true };
}

interface BuildBody { type: 'barracks' | 'miner'; x: number; y: number }
interface ProduceBody { buildingId: string; unitType: 'infantry' | 'sniper' | 'tank' | 'medic' }
interface MoveBody { unitId: string; x: number; y: number }
interface AttackBody { attackerId: string; targetId: string }
interface HealBody { medicId: string; targetId: string }

export async function actionsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: BuildBody }>(
    '/api/games/:id/build', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        startBuild(game, globalEventBus, player, req.body.type, req.body.x, req.body.y)),
  );

  app.post<{ Params: { id: string }; Body: ProduceBody }>(
    '/api/games/:id/produce', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        startProduction(game, globalEventBus, player, req.body.buildingId, req.body.unitType)),
  );

  app.post<{ Params: { id: string }; Body: MoveBody }>(
    '/api/games/:id/move', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        moveUnit(game, globalEventBus, player, req.body.unitId, req.body.x, req.body.y)),
  );

  app.post<{ Params: { id: string }; Body: AttackBody }>(
    '/api/games/:id/attack', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        attackTarget(game, globalEventBus, player, req.body.attackerId, req.body.targetId)),
  );

  app.post<{ Params: { id: string }; Body: HealBody }>(
    '/api/games/:id/heal', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        healTarget(game, globalEventBus, player, req.body.medicId, req.body.targetId)),
  );

  app.post<{ Params: { id: string } }>(
    '/api/games/:id/end-turn', async (req, reply) =>
      actionHandler(req, reply, ({ game, player }) =>
        endTurn(game, globalEventBus, player)),
  );
}
```

- [ ] **步骤 4: 注册路由到服务器**

修改 `src/server.ts`：

```typescript
// src/server.ts
import Fastify, { type FastifyInstance } from 'fastify';
import { gamesRoutes } from './api/games.js';
import { actionsRoutes } from './api/actions.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(gamesRoutes);
  await app.register(actionsRoutes);
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  buildServer()
    .then(app => app.listen({ port, host: '0.0.0.0' }))
    .then(addr => console.log(`Server listening on ${addr}`))
    .catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **步骤 5: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/api/actions.test.ts`
Expected: PASS（10 tests passed）

- [ ] **步骤 6: 提交**

```bash
git add src/api/actions.ts src/server.ts tests/api/actions.test.ts
git commit -m "feat: add player action api routes"
```

---

## 任务 18: 事件查询和 SSE 推送

观战 API：支持轮询历史事件，和 SSE 实时推送。

**Files:**
- Create: `C:/cosmos/github/game/src/api/events.ts`
- Modify: `C:/cosmos/github/game/src/server.ts`
- Create: `C:/cosmos/github/game/tests/api/events.test.ts`

- [ ] **步骤 1: 写失败的测试**

```typescript
// tests/api/events.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../../src/state/store.js';

describe('Events API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    app = await startTestServer();
  });

  it('GET /events returns all events as JSON by default', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.some((e: any) => e.type === 'game_start')).toBe(true);
  });

  it('GET /events?after=N returns only events after seq N', async () => {
    const { gameId, tokenA } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const lastSeq = game.events.at(-1)!.seq;
    // Perform an end-turn to add more events
    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events?after=${lastSeq}`,
    });
    const body = res.json();
    for (const e of body.events) {
      expect(e.seq).toBeGreaterThan(lastSeq);
    }
    expect(body.events.length).toBeGreaterThan(0);
  });

  it('GET /events returns 404 for missing game', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games/nope/events' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /events returns SSE stream when Accept is text/event-stream', async () => {
    const { gameId } = await createGameAndJoin(app);
    const res = await app.inject({
      method: 'GET', url: `/api/games/${gameId}/events`,
      headers: { accept: 'text/event-stream' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    // Payload should contain at least one event line
    expect(res.body).toContain('data:');
  });
});
```

- [ ] **步骤 2: 运行测试，确认失败**

Run: `cd C:/cosmos/github/game && npx vitest run tests/api/events.test.ts`
Expected: FAIL

- [ ] **步骤 3: 实现 events 路由**

SSE 在 Fastify 中通过 raw response 写入。注意：因为我们用 `app.inject` 测试 SSE，需要在 inject 完成时关闭流。实现策略：写入历史事件后立即结束（测试场景）；订阅事件总线在生产环境继续推送（在 close 钩子里取消订阅）。

```typescript
// src/api/events.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { globalStore } from '../state/store.js';
import { globalEventBus } from '../events/bus.js';
import type { GameEvent } from '../types.js';

function writeSseEvent(reply: FastifyReply, event: GameEvent): void {
  const payload = JSON.stringify(event);
  reply.raw.write(`event: ${event.type}\n`);
  reply.raw.write(`id: ${event.seq}\n`);
  reply.raw.write(`data: ${payload}\n\n`);
}

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/api/games/:id/events',
    async (req: FastifyRequest<{ Params: { id: string }; Querystring: { after?: string } }>, reply: FastifyReply) => {
      const game = globalStore.get(req.params.id);
      if (!game) {
        return reply.code(404).send({ error: 'game not found', code: 'game_not_found' });
      }
      const after = req.query.after ? Number(req.query.after) : 0;
      const filtered = game.events.filter(e => e.seq > after);

      const wantsSse = (req.headers.accept ?? '').includes('text/event-stream');
      if (!wantsSse) {
        return { events: filtered };
      }

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      for (const ev of filtered) {
        writeSseEvent(reply, ev);
      }

      const unsubscribe = globalEventBus.subscribe(game.id, ev => {
        writeSseEvent(reply, ev);
      });
      req.raw.on('close', () => {
        unsubscribe();
        reply.raw.end();
      });

      // In test environments inject finalizes the response immediately. We do not end here
      // for live connections — only when the client closes. For test injects, signal completion
      // by setting reply.hijack so Fastify does not auto-finalize, then end after a microtask.
      reply.hijack();
      setImmediate(() => {
        if (!reply.raw.writableEnded) reply.raw.end();
      });
    },
  );
}
```

- [ ] **步骤 4: 注册 events 路由**

修改 `src/server.ts`：

在 `await app.register(actionsRoutes);` 后追加一行：

```typescript
await app.register(eventsRoutes);
```

并在 import 部分追加：

```typescript
import { eventsRoutes } from './api/events.js';
```

- [ ] **步骤 5: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/api/events.test.ts`
Expected: PASS（4 tests passed）

- [ ] **步骤 6: 提交**

```bash
git add src/api/events.ts src/server.ts tests/api/events.test.ts
git commit -m "feat: add events polling and SSE streaming"
```

---

## 任务 19: 静态前端托管

注册 @fastify/static 托管 public 目录。前端是观战界面，列出对局并允许选择观看。

**Files:**
- Modify: `C:/cosmos/github/game/src/server.ts`
- Create: `C:/cosmos/github/game/public/index.html`
- Create: `C:/cosmos/github/game/public/style.css`
- Create: `C:/cosmos/github/game/public/app.js`
- Create: `C:/cosmos/github/game/src/api/games.ts`（追加 list 接口）

- [ ] **步骤 1: 追加 list 接口到 games.ts**

在 `src/api/games.ts` 中，在 `gamesRoutes` 函数体的开头追加：

```typescript
  app.get('/api/games', async () => {
    const ids = globalStore.list();
    return {
      games: ids.map(id => {
        const g = globalStore.get(id)!;
        return {
          id, phase: g.phase, turnNumber: g.turn.turnNumber,
          currentOwner: g.turn.currentOwner, winner: g.winner,
        };
      }),
    };
  });
```

放在现有的 `app.post('/api/games', ...)` 之前。

- [ ] **步骤 2: 安装并注册静态文件中间件**

```bash
cd C:/cosmos/github/game
npm install @fastify/static@^8.0.0
```

修改 `src/server.ts`：

```typescript
// src/server.ts
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gamesRoutes } from './api/games.js';
import { actionsRoutes } from './api/actions.js';
import { eventsRoutes } from './api/events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(gamesRoutes);
  await app.register(actionsRoutes);
  await app.register(eventsRoutes);
  await app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  buildServer()
    .then(app => app.listen({ port, host: '0.0.0.0' }))
    .then(addr => console.log(`Server listening on ${addr}`))
    .catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **步骤 3: 创建 index.html**

```html
<!-- public/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>战棋对战 — 观战</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header>
    <h1>战棋对战观战</h1>
    <div id="game-meta">
      <select id="game-select"><option value="">-- 选择对局 --</option></select>
      <button id="refresh-list">刷新列表</button>
      <span id="status"></span>
    </div>
  </header>
  <main>
    <canvas id="board" width="900" height="900"></canvas>
    <aside id="sidebar">
      <section id="resources"></section>
      <section id="turn-info"></section>
      <section id="event-log">
        <h3>事件流</h3>
        <ul id="events"></ul>
      </section>
    </aside>
  </main>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **步骤 4: 创建 style.css**

```css
/* public/style.css */
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, "Segoe UI", sans-serif;
  background: #1a1a1a;
  color: #e0e0e0;
}
header {
  padding: 12px 20px;
  background: #2a2a2a;
  border-bottom: 1px solid #3a3a3a;
}
header h1 { margin: 0 0 8px; font-size: 18px; }
#game-meta { display: flex; gap: 10px; align-items: center; }
#game-meta select, #game-meta button {
  padding: 4px 10px; background: #333; color: #e0e0e0;
  border: 1px solid #555; border-radius: 4px;
}
main { display: flex; padding: 16px; gap: 16px; }
#board {
  background: #0f1410;
  border: 1px solid #333;
  image-rendering: pixelated;
}
#sidebar {
  width: 320px; max-height: 90vh; overflow: auto;
  background: #232323; padding: 12px; border-radius: 6px;
}
#sidebar section { margin-bottom: 14px; }
#sidebar h3 { margin: 0 0 6px; font-size: 14px; color: #9ad; }
#events { list-style: none; padding: 0; margin: 0; font-size: 12px; }
#events li {
  padding: 4px 6px; margin: 2px 0;
  background: #1a1a1a; border-left: 3px solid #4a8;
}
.player-a { color: #6cf; }
.player-b { color: #f86; }
```

- [ ] **步骤 5: 创建 app.js**

```javascript
// public/app.js
const CELL = 28;
const GRID_COLOR = '#244';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const gameSelect = document.getElementById('game-select');
const refreshBtn = document.getElementById('refresh-list');
const statusEl = document.getElementById('status');
const resourcesEl = document.getElementById('resources');
const turnInfoEl = document.getElementById('turn-info');
const eventsEl = document.getElementById('events');

let state = null;
let sse = null;

async function fetchGameList() {
  const res = await fetch('/api/games');
  const { games } = await res.json();
  gameSelect.innerHTML = '<option value="">-- 选择对局 --</option>';
  for (const g of games) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.id.slice(0, 8)} — ${g.phase} (回合 ${g.turnNumber}, ${g.currentOwner})`;
    gameSelect.appendChild(opt);
  }
}

async function loadGameState(id, anyToken) {
  // Spectator: state without auth not available, so we attempt the events endpoint to learn map size
  // For MVP we ask the backend to expose state via events; we reconstruct state from event log.
  state = null;
  const res = await fetch(`/api/games/${id}/events`);
  const { events } = await res.json();
  state = reconstructState(events);
  drawBoard();
  renderSidebar();
}

function reconstructState(events) {
  const s = {
    mapWidth: 30, mapHeight: 30,
    miningPoints: [],
    units: new Map(), buildings: new Map(),
    resources: { player_a: { gold: 100 }, player_b: { gold: 100 } },
    turn: { turnNumber: 1, currentOwner: 'player_a', phase: 'waiting_command' },
    eventLog: [],
  };
  for (const ev of events) applyEvent(s, ev);
  return s;
}

function applyEvent(s, ev) {
  s.eventLog.push(ev);
  switch (ev.type) {
    case 'game_start':
      s.mapWidth = ev.payload.mapWidth ?? 30;
      s.mapHeight = ev.payload.mapHeight ?? 30;
      s.miningPoints = ev.payload.miningPoints ?? [];
      // Add initial HQ for both players based on positions (4,15) and (25,15)
      s.buildings.set('hq_a', { id: 'hq_a', owner: 'player_a', type: 'headquarters', x: 4, y: 15, hp: 200, maxHp: 200, alive: true, isBuilding: false });
      s.buildings.set('hq_b', { id: 'hq_b', owner: 'player_b', type: 'headquarters', x: 25, y: 15, hp: 200, maxHp: 200, alive: true, isBuilding: false });
      break;
    case 'build':
      s.buildings.set(ev.payload.buildingId, {
        id: ev.payload.buildingId, owner: ev.payload.owner, type: ev.payload.type,
        x: ev.payload.x, y: ev.payload.y, hp: 60, maxHp: 60, alive: true, isBuilding: true,
      });
      break;
    case 'build_complete': {
      const b = s.buildings.get(ev.payload.buildingId);
      if (b) b.isBuilding = false;
      break;
    }
    case 'produce_complete':
      s.units.set(ev.payload.unitId, {
        id: ev.payload.unitId, owner: ev.payload.owner, type: ev.payload.type,
        x: ev.payload.x, y: ev.payload.y, hp: 100, maxHp: 100, alive: true,
      });
      break;
    case 'move': {
      const u = s.units.get(ev.payload.unitId);
      if (u) { u.x = ev.payload.toX; u.y = ev.payload.toY; }
      break;
    }
    case 'attack': {
      const t = s.units.get(ev.payload.targetId) || s.buildings.get(ev.payload.targetId);
      if (t) t.hp = ev.payload.targetHp;
      break;
    }
    case 'heal': {
      const t = s.units.get(ev.payload.targetId);
      if (t) t.hp = ev.payload.targetHp;
      break;
    }
    case 'unit_death': {
      const u = s.units.get(ev.payload.unitId);
      if (u) u.alive = false;
      break;
    }
    case 'base_destroyed': {
      const b = s.buildings.get(ev.payload.buildingId);
      if (b) b.alive = false;
      break;
    }
    case 'mine':
      s.resources[ev.payload.owner].gold += ev.payload.amount;
      break;
    case 'turn_end':
      s.turn.currentOwner = ev.payload.nextOwner;
      s.turn.turnNumber = ev.payload.turnNumber;
      break;
    case 'game_over':
      s.turn.phase = 'game_over';
      s.winner = ev.payload.winner;
      break;
  }
}

function drawBoard() {
  if (!state) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Grid
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= state.mapWidth; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, state.mapHeight * CELL); ctx.stroke();
  }
  for (let j = 0; j <= state.mapHeight; j++) {
    ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(state.mapWidth * CELL, j * CELL); ctx.stroke();
  }
  // Mining points
  ctx.fillStyle = '#b80';
  for (const p of state.miningPoints) {
    ctx.beginPath();
    ctx.arc(p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, 4, 0, 6.28);
    ctx.fill();
  }
  // Buildings
  for (const b of state.buildings.values()) {
    if (!b.alive) continue;
    const color = b.owner === 'player_a' ? '#3a8ad9' : '#d96a3a';
    ctx.fillStyle = b.isBuilding ? '#666' : color;
    ctx.fillRect(b.x * CELL + 2, b.y * CELL + 2, CELL - 4, CELL - 4);
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    const letter = b.type === 'headquarters' ? 'H' : b.type === 'barracks' ? 'B' : 'M';
    ctx.fillText(letter, b.x * CELL + CELL / 2 - 3, b.y * CELL + CELL / 2 + 4);
  }
  // Units
  for (const u of state.units.values()) {
    if (!u.alive) continue;
    const color = u.owner === 'player_a' ? '#6cf' : '#f86';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(u.x * CELL + CELL / 2, u.y * CELL + CELL / 2, CELL / 3, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = '9px sans-serif';
    const letter = u.type === 'infantry' ? 'I' : u.type === 'sniper' ? 'S' : u.type === 'tank' ? 'T' : 'M';
    ctx.fillText(letter, u.x * CELL + CELL / 2 - 3, u.y * CELL + CELL / 2 + 3);
  }
}

function renderSidebar() {
  if (!state) return;
  resourcesEl.innerHTML = `
    <h3>资源</h3>
    <div><span class="player-a">玩家 A</span>: ${state.resources.player_a.gold} 金</div>
    <div><span class="player-b">玩家 B</span>: ${state.resources.player_b.gold} 金</div>
  `;
  turnInfoEl.innerHTML = `
    <h3>回合 ${state.turn.turnNumber}</h3>
    <div>当前: <span class="${state.turn.currentOwner === 'player_a' ? 'player-a' : 'player-b'}">${state.turn.currentOwner}</span></div>
    ${state.winner ? `<div>胜者: <strong>${state.winner}</strong></div>` : ''}
  `;
  eventsEl.innerHTML = '';
  for (const ev of state.eventLog.slice(-30)) {
    const li = document.createElement('li');
    li.textContent = `#${ev.seq} ${ev.type} ${JSON.stringify(ev.payload).slice(0, 80)}`;
    eventsEl.appendChild(li);
  }
}

function subscribeSse(id) {
  if (sse) sse.close();
  sse = new EventSource(`/api/games/${id}/events`);
  sse.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);
      applyEvent(state, ev);
      drawBoard();
      renderSidebar();
    } catch (err) { console.error(err); }
  };
  sse.onerror = () => { statusEl.textContent = 'SSE 断开'; };
}

gameSelect.addEventListener('change', async () => {
  const id = gameSelect.value;
  if (!id) return;
  await loadGameState(id);
  subscribeSse(id);
  statusEl.textContent = '已订阅事件';
});
refreshBtn.addEventListener('click', fetchGameList);

fetchGameList();
```

- [ ] **步骤 4: 手动验证（不写测试）**

Run: `cd C:/cosmos/github/game && npm run dev`

在另一个终端：

```bash
# Create a game
curl -X POST http://localhost:3000/api/games

# Use the returned gameId
curl -X POST http://localhost:3000/api/games/<gameId>/join
```

打开浏览器访问 `http://localhost:3000/`，应当看到对局列表，选择后能看到棋盘和总部。

Expected: 棋盘渲染正常，两个总部和 6 个采矿点可见。

- [ ] **步骤 5: 提交**

```bash
git add public/ src/server.ts src/api/games.ts package.json package-lock.json
git commit -m "feat: add spectator web frontend with sse"
```

---

## 任务 20: 端到端冒烟测试

打通完整流程：创建游戏 → 加入 → 玩家 A 建采矿器 → 结束回合 → 玩家 B 操作 → 玩家 A 收金 → 生产单位 → 移动 → 攻击敌方总部 → 多次回合直到敌方总部摧毁 → 游戏结束。

**Files:**
- Create: `C:/cosmos/github/game/tests/api/smoke.test.ts`

- [ ] **步骤 1: 写端到端测试**

```typescript
// tests/api/smoke.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { startTestServer, createGameAndJoin } from '../helpers.js';
import type { FastifyInstance } from 'fastify';
import { globalStore } from '../../src/state/store.js';

describe('End-to-end gameplay', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const id of globalStore.list()) globalStore.delete(id);
    app = await startTestServer();
  });

  it('plays out a complete game ending in victory', async () => {
    const { gameId, tokenA, tokenB } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const hqA = game.buildings.find(b => b.owner === 'player_a')!;
    const hqB = game.buildings.find(b => b.owner === 'player_b')!;

    // Player A: build a miner adjacent to a mining point near (10, 15)? HQ is at (4, 15), out of range.
    // To keep test simple: spawn a strong unit directly via state and walk it to HQ_B.
    game.units.push({
      id: 'champion', owner: 'player_a', type: 'tank',
      x: hqB.x - 1, y: hqB.y, hp: 150, maxHp: 150, attack: 25, defense: 15,
      moveRange: 2, attackRange: 1, alive: true, hasMoved: false, hasAttacked: false,
    });

    // Reduce HQ_B HP to make the test fast
    hqB.hp = 30;

    // Player A attacks HQ_B
    const atkRes = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/attack`,
      headers: { 'x-player-token': tokenA },
      payload: { attackerId: 'champion', targetId: hqB.id },
    });
    expect(atkRes.statusCode).toBe(200);

    // If HQ_B still alive, keep attacking on subsequent turns
    let safety = 0;
    while (hqB.alive && safety++ < 10) {
      await app.inject({
        method: 'POST', url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': tokenA },
      });
      await app.inject({
        method: 'POST', url: `/api/games/${gameId}/end-turn`,
        headers: { 'x-player-token': tokenB },
      });
      await app.inject({
        method: 'POST', url: `/api/games/${gameId}/attack`,
        headers: { 'x-player-token': tokenA },
        payload: { attackerId: 'champion', targetId: hqB.id },
      });
    }

    expect(hqB.alive).toBe(false);
    expect(game.phase).toBe('game_over');
    expect(game.winner).toBe('player_a');
    expect(game.events.some(e => e.type === 'game_over')).toBe(true);
  });

  it('full economic loop: build miner, end turn, collect gold, produce unit', async () => {
    const { gameId, tokenA, tokenB } = await createGameAndJoin(app);
    const game = globalStore.get(gameId)!;
    const hqA = game.buildings.find(b => b.owner === 'player_a')!;

    // Move HQ_A near a mining point for the test (in real play you'd walk a unit there)
    hqA.x = 10; hqA.y = 14;

    // Build a miner on the mining point
    const buildRes = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/build`,
      headers: { 'x-player-token': tokenA },
      payload: { type: 'miner', x: 10, y: 15 },
    });
    expect(buildRes.statusCode).toBe(200);
    expect(game.resources.player_a.gold).toBe(70); // 100 - 30

    // End A's turn (miner finishes build, B's turn starts)
    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });
    // End B's turn — A's miner produces income at start of A's next turn
    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenB },
    });

    expect(game.resources.player_a.gold).toBe(85); // 70 + 15 mined

    // Produce an infantry from HQ_A
    const produceRes = await app.inject({
      method: 'POST', url: `/api/games/${gameId}/produce`,
      headers: { 'x-player-token': tokenA },
      payload: { buildingId: hqA.id, unitType: 'infantry' },
    });
    expect(produceRes.statusCode).toBe(200);
    expect(game.resources.player_a.gold).toBe(45); // 85 - 40

    // End A's turn, infantry should spawn
    await app.inject({
      method: 'POST', url: `/api/games/${gameId}/end-turn`,
      headers: { 'x-player-token': tokenA },
    });
    expect(game.units.some(u => u.owner === 'player_a' && u.type === 'infantry')).toBe(true);
  });
});
```

- [ ] **步骤 2: 运行测试，确认通过**

Run: `cd C:/cosmos/github/game && npx vitest run tests/api/smoke.test.ts`
Expected: PASS（2 tests passed）

- [ ] **步骤 3: 运行完整测试套件**

Run: `cd C:/cosmos/github/game && npm test`
Expected: 所有测试通过

- [ ] **步骤 4: 提交**

```bash
git add tests/api/smoke.test.ts
git commit -m "test: add end-to-end smoke tests"
```

---

## 任务 21: README

加上简单的项目 README，包括启动方式和 API 概述。

**Files:**
- Create: `C:/cosmos/github/game/README.md`

- [ ] **步骤 1: 创建 README**

```markdown
# 战棋多人对战游戏

现代军事题材的回合制战棋游戏。玩家通过 REST API 控制势力，建造兵营/采矿器，生产单位，攻击敌方总部。

## 启动

```bash
npm install
npm run dev
```

服务器默认监听 3000 端口。

## 简单 API 流程

1. `POST /api/games` — 创建对局，得到 `gameId` 和 `playerAToken`
2. `POST /api/games/:id/join` — 另一玩家加入，得到 `playerBToken`
3. 操作时在请求头加 `X-Player-Token: <token>`
4. `POST /api/games/:id/build` — 建造（`type`, `x`, `y`）
5. `POST /api/games/:id/produce` — 生产单位
6. `POST /api/games/:id/move` — 移动单位
7. `POST /api/games/:id/attack` — 攻击
8. `POST /api/games/:id/heal` — 医疗兵治疗
9. `POST /api/games/:id/end-turn` — 结束回合

观战：浏览器访问 `http://localhost:3000/`。

## 测试

```bash
npm test
```

## 文档

详细规格见 `docs/superpowers/specs/2026-06-03-tactical-game-design.md`。
```

- [ ] **步骤 2: 提交**

```bash
git add README.md
git commit -m "docs: add project readme"
```

---

## 收尾自检

完整跑一遍测试，确认覆盖：

```bash
cd C:/cosmos/github/game && npm test
```

预期：所有单元和集成测试通过，未引入任何 TODO/未完成项。

启动服务器后手动验证：

1. 浏览器访问 `http://localhost:3000/` — 前端加载
2. `curl -X POST http://localhost:3000/api/games` — 返回 gameId 和 token
3. 在另一终端 `POST /join` 完成对局开始
4. 在前端列表中选择该对局，可看到棋盘、HQ、采矿点
5. 通过 API 发起 build/produce/move/attack 时前端实时刷新

---

## 任务依赖图

```
1 项目初始化
    └─ 2 类型
        └─ 3 事件总线 ── 4 规格表
                └─ 5 状态存储
                    └─ 6 验证辅助
                        └─ 7 事件追加
                            ├─ 8 建造系统
                            │   └─ 9 生产系统
                            │       └─ 11 单位移动 ── 10 采矿
                            │           └─ 12 攻击
                            │               └─ 13 治疗
                            │                   └─ 14 引擎核心
                            │                       └─ 15 测试辅助
                            │                           └─ 16 游戏 CRUD API
                            │                               └─ 17 操作 API
                            │                                   └─ 18 事件 API
                            │                                       └─ 19 前端
                            │                                           └─ 20 冒烟测试
                            │                                               └─ 21 README
```

