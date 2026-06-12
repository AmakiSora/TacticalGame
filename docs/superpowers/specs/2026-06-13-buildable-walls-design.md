# 可建造墙壁 — 设计规格

## 概述

新增 `wall` 建筑类型，玩家可建造可攻击摧毁的墙壁。墙壁是纯障碍物（无攻击、无收入），用于封锁通道、保护资源、引导敌人走向火力范围。

## 动机

当前游戏中地图地形是静态的，玩家无法改变战场格局。可建造墙壁引入"地形塑造"策略维度，让 AI 对局更有战术深度：
- 绕后突袭——破墙开新路线
- 封锁防守——用墙保护关键建筑
- 围城战术——封锁敌方 HQ 出口
- 资源权衡——花钱造墙 vs 造兵 vs 造矿场

## 墙壁属性

| 属性 | 值 | 理由 |
|------|-----|------|
| HP | 50 | 比矿场(60)脆，1-2次攻击可摧毁 |
| 建造费用 | 20 gold | 便宜，纯防御无收入 |
| 建造时间 | 1 turn | 快速部署 |
| 建造范围 | 4（曼哈顿距离） | 普通建筑为2，墙壁可远距离封锁 |
| 防御力 | 5 | 略微减伤，不是免费肉盾 |
| 攻击 | 无 | 纯障碍物 |
| 攻击次数 | 无 | 不能攻击 |
| 可生产 | 无 | 不能生产单位 |
| 出售退款 | 16 gold（80%） | 与其他建筑一致 |

### 与现有建筑对比

| 建筑 | 费用 | HP | 建造时间 | 收入 | 攻击 |
|------|------|-----|---------|------|------|
| 矿场 | 30 | 60 | 1 | +15/turn | 无 |
| 兵营 | 50 | 100 | 2 | 无 | 无（产兵） |
| 碉堡 | 70 | 120 | 2 | 无 | 24 ATK × 2次 |
| **墙壁** | **20** | **50** | **1** | **无** | **无** |

## 类型改动

```typescript
// src/types.ts
type BuildingType = 'headquarters' | 'barracks' | 'miner' | 'bunker' | 'wall';
```

无需新增事件类型或 API 端点——墙壁复用现有的 `build`、`attack`、`sell`、`base_destroyed` 等事件。

## API 行为

### 建造墙壁

```
POST /api/games/:id/build
Body: { "type": "wall", "x": 10, "y": 5 }
```

- 建造范围使用 `wallBuildRange`（4），非普通 `buildRange`（2）
- 墙壁不能建在水上（terrain=2），但可以建在空地和永久墙壁旁边
- 墙壁不能建在已有单位/建筑/永久墙壁的格子上

### 攻击墙壁

```
POST /api/games/:id/attack
Body: { "attackerId": "<unit_id>", "targetId": "<wall_id>" }
```

- 墙壁有 5 点防御力，参与伤害计算
- 墙壁被摧毁后：`alive = false`，格子恢复为空地
- 摧毁墙壁不算摧毁 HQ，不触发游戏结束

### 出售墙壁

```
POST /api/games/:id/sell
Body: { "buildingId": "<wall_id>" }
```

- 退款 16 gold（80% × 20）
- 建造中的墙壁不能出售（与其他建筑一致）
- 墙壁被移除后格子恢复为空地

## 地图配置

```json
{
  "buildings": {
    "wall": {
      "hp": 50,
      "cost": 20,
      "buildTime": 1,
      "defense": 5
    }
  },
  "map": {
    "buildRange": 2,
    "wallBuildRange": 4
  }
}
```

墙壁在 `buildings` 中没有 `attack`/`attackRange`/`attacksPerTurn` 字段，因为不能攻击。`defense` 单独声明（不需要 attack 的配对字段）。

## 配置验证

`config/loader.ts` 的验证逻辑需要调整：
- 墙壁的 `defense` 字段可单独存在（不需要配对的 attack/attackRange/attacksPerTurn）
- 当前验证要求 attack 四字段全有或全无，需要支持"仅 defense"模式

## 引擎改动

### building.ts

`startBuild` 中：
- 墙壁使用 `config.map.wallBuildRange` 而非 `config.map.buildRange`
- 墙壁不初始化 `attack`/`attackRange`/`attacksLeft` 字段（Building 接口已可选）

### combat.ts

`attackTarget` 中：
- 墙壁作为 Building 类型的目标自然被 `findTarget` 找到（已经查找 buildings）
- 墙壁的 `defense` 字段参与伤害计算（已支持）

### validation.ts

无需改动——`getCellOccupant` 已经返回建筑占用信息。

## AI 适配

### SKILL.md 更新

Phase 4（战斗）新增破墙判断：
- 如果单位无法攻击到敌人，检查邻近墙壁
- 破墙价值判断：如果破墙后能创造更短路径到敌方 HQ，破墙
- 目标优先级调整：敌方 HQ > 低血量单位 > **挡路墙壁** > 高血量单位 > 其他建筑

Phase 1（经济）新增造墙场景：
- 如果在关键隘口（两侧是永久墙壁/水），考虑建墙封锁
- 如果矿场受到威胁，在矿场和敌人之间建墙
- 如果有闲置 gold（>80）且没有更好的消费，建墙推进前线

### ai-player.mjs 更新

- `executeTurn` Phase 4 中：在"无可攻击目标"和"移动"之间插入破墙检查
- 新增 Phase：造墙（在 Phase 1 和 Phase 2 之间），判断是否值得在关键位置建墙

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `src/types.ts` | BuildingType 加 `'wall'` |
| `src/config/loader.ts` | 放宽 building defense 验证（允许仅 defense 无 attack），MapConfig.map 加 `wallBuildRange` |
| `src/engine/building.ts` | startBuild 中 wall 使用 wallBuildRange |
| `maps/default.json` | buildings 加 wall spec，map 加 wallBuildRange: 4 |
| `maps/desert.json` | 同步更新 |
| `skill/SKILL.md` | AI 策略加造墙/破墙逻辑 |
| `skill/ai-player.mjs` | JS AI 加造墙/破墙判断 |
| `tests/` | 新增墙壁相关测试 |

预计代码量：~120行（不含测试和 AI 更新）

## 测试要点

1. 建造墙壁在范围内成功，超出 wallBuildRange=4 失败
2. 攻击墙壁，HP 正确减少，摧毁后格子可通行
3. 出售墙壁退款 16 gold，格子恢复
4. 墙壁建造中不能攻击（hasAttacked 相关逻辑）
5. 墙壁不能建在水上、已有单位/建筑上
6. 墙壁 defense=5 正确参与伤害计算
