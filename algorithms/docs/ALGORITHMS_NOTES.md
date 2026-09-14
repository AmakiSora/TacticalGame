# 算法 AI 开发笔记

> 本文档记录所有算法 AI 的设计、实现和性能变化。

算法 AI 是基于规则、搜索和启发式的 JavaScript 决策模块，无需训练模型即可运行。与强化学习模型相比，算法 AI 的优势在于开发迅速、可解释性强、无需 GPU，但性能上限受限于人工设计的策略质量。

## 目录结构

```
algorithms/
├── builtin/           # 内置算法实现
│   ├── greedy.mjs    # 贪心算法
│   ├── random.mjs    # 随机算法
│   ├── mcts.mjs      # 蒙特卡洛树搜索
│   └── README.md     # 算法开发指南
├── lib/              # 共享工具库
│   ├── api-client.mjs    # REST API 客户端
│   ├── game-utils.mjs    # 游戏工具函数
│   └── interfaces.mjs    # 算法接口适配器
├── docs/             # 算法文档
│   ├── ALGORITHMS_NOTES.md   # 本文件
│   ├── RELEASE_NOTES.md      # 版本发布记录
│   └── algorithms/           # 单算法详细档案
│       ├── greedy.md
│       ├── random.md
│       └── mcts.md
├── registry.mjs      # 算法注册表
└── runner.mjs        # 通用运行器
```

## 算法接口

所有算法必须实现以下两种接口之一：

### 策略接口（推荐）

适合简单算法，每次返回一个动作：

```javascript
export default {
  name: 'algorithm_name',
  description: '算法描述',
  
  async decide(gameState, utils) {
    // gameState: 完整游戏状态
    // utils: 工具函数集合
    // 返回 { type: 'attack', payload: {...} } 或 null（结束回合）
  }
}
```

### 完整控制接口

适合需要全局规划的复杂算法：

```javascript
export default {
  name: 'algorithm_name',
  description: '算法描述',
  
  async playTurn(gameState, apiClient, utils) {
    // apiClient: REST API 调用封装
    // 自己负责整个回合的所有动作
  }
}
```

## 工具函数（utils）

`game-utils.mjs` 提供以下核心函数：

| 函数 | 功能 |
|---|---|
| `hexDistance(a, b)` | 六边形距离计算 |
| `neighbors(pos)` | 相邻六格 |
| `reachableCells(game, unit)` | 单位可移动范围 |
| `livingUnits(game, owner)` | 存活单位列表 |
| `enemyTargets(game, owner)` | 敌方目标（单位 + 总部） |
| `scoreTarget(target)` | 目标优先级评分 |
| `bestAttackTarget(game, owner, unit)` | 最佳攻击目标 |
| `movementGoal(game, owner, unit)` | 移动目标位置 |

## 算法清单

| 算法 | 类型 | 复杂度 | 性能 | 用途 |
|---|---|---|---|---|
| **random** | 随机 | O(n) | 极弱 | 基准对照、测试 |
| **greedy** | 启发式 | O(n²) | 中（作为基准线） | 快速决策、演示 |
| **mcts** | 搜索 | O(b^d · k) | 弱（vs greedy 20 局 3:17） | 战术推演、对比实验 |
| **threat** | 效用/影响图 | O(单位×格子) | **2 人局最强**（vs greedy 7 图 280 局 70.6%，vs mcts 14:6）；3-4 人局未标定 | 走位稳健的对战、教学 |

> b = 分支因子（~20），d = 搜索深度（8），k = 模拟次数（100）

## 性能对比

实测方法（自 3.5.1 threat 标定起统一）：**headless 自博弈** —— 直接驱动 `src/engine/`，不走 HTTP、不限速，每图 40 局、逐局交替先手，种子固定可复现（参考实现 `temp/threat-bench.mts`）。

### vs greedy（各图 40 局）

| 地图 | threat | 初版 threat | 备注 |
|---|---:|---:|---|
| default | **38:2** | 16:24 | 主图 |
| dual-lanes | **38:2** | 30:10 | |
| breach | **35:5** | **0:40** | 初版因拆墙判据一局未赢 |
| forge | **31:8** | 16:24 | 1 平 | 
| desert | **28:12** | 24:16 | |
| multiplayer-ring | 20:20 | 22:18 | 每回合 7 行动点 |
| danger-close | 7:33 | 7:33 | 每回合 1 行动点，已知短板 |
| **合计** | **197:82（70.6%）** | 115:165（41.1%） | |
| random 地图 | 17:15（53%），32 局 | — | 回合数与裁定权重随机生成，优势被摊薄 |

### 其他对局

| 对局 | 胜率 | 备注 |
|---|---|---|
| threat vs 初版 threat | **78% (31:9)**，40 局 | default；修复的直接效果 |
| threat vs mcts | 70% (14:6)，20 局 | default。mcts 的模拟用未播种随机数，批次间会飘（另一批 18:2）；要定序需 40 局以上 |
| threat vs random | 100% (24:0)，24 局 | default |
| mcts vs greedy | 25% (5:15)，20 局 | 两个算法都已修正行动点门控；历史记录 26.7%（30 局 8:22）是双方都带 bug 时测的；同样受 mcts 未播种随机影响 |
| greedy vs random | 100% (24:0)，24 局 | 修正后重测；旧记录 96.9%（31:1），32 局 |

> 行动点预算门控原本是**四个内置算法共有的陷阱**：动作失败会让 runner 直接 break 掉整个回合、作废剩余行动点。greedy / mcts / random 已同步修正（攻击/治疗/爆破/移动），headless 自博弈下三者零非法动作。MCTS 含随机模拟，胜负方差较大。

## 算法 vs RL 模型

算法 AI 与强化学习模型在 random 地图对战（各 48 局配对换座）：

| 对局 | 胜率 | 先手/后手 | 备注 |
|---|---|---|---|
| greedy vs v2.7.0 | 18.8% (9:39) | 6:18 / 3:21 | RL 模型碾压 |

> 数据来源：`rl/test-output/stats/algo_vs_rl_random.jsonl`

**结论**：算法 AI 与训练良好的 RL 模型仍有显著差距。算法 AI 的价值在于无需训练、可快速迭代、易于调试，适合作为开发期对手和教学演示。MCTS 对 RL 模型的同口径实测尚未进行。

## 历史里程碑

| 时间 | 版本 | 事件 |
|---|---|---|
| 2026-09-13 | 3.5.0 | 算法 AI 系统上线：greedy、random |
| 2026-09-13 | 3.5.1 | 新增 MCTS（目标导向采样、据点占领、入口部署决策）；实测 vs greedy 30 局 8:22 |
| 2026-09-14 | 3.5.1 | 新增 threat 威胁感知效用算法：初版实测 vs greedy 仅 41.1%（7 图 ×40 局），breach 图 0 胜 |
| 2026-09-14 | 3.5.1 | threat 标定与修复：行动点预算门控、结束回合门槛（与 PROGRESS_SCALE 碰磁）、威胁惩罚按 `actionsPerTurn` 截断、据点收入按 kind 取实际值、部署参与同尺度比较、拆墙判据放宽 → **vs greedy 70.6%**；greedy 同步修正行动点门控；新增自博弈合法性回归测试 |

## 未来方向

1. **Minimax + Alpha-Beta 剪枝**：经典对抗搜索
2. **规则增强**：针对特定地图的专家系统
3. **混合架构**：MCTS + 学习评估函数
4. **多线程并行**：利用 Worker 加速搜索
5. **算法锦标赛**：已起步为 `scripts/algorithm-arena.mjs`（headless 自博弈、交替席位、非法动作审计、决策耗时分位、`--strict` 可进 CI）；还缺多算法轮转与自动排行落盘
6. **多席位标定**：现有权重全部在 2 人对局上调出，3-4 人图上 threat 不再优于 greedy（见 `algorithms/threat.md` 已知限制 7）
6. **部署决策继续收敛**：`threat` 与 `mcts` 的逐字重复拷贝已提到 `game-utils.deployDecision()` 共用；还剩 `greedy`（按距离+费用排序的另一份）与 `scripts/auto-standard-game.mjs` 两份变体未合并

## 贡献指南

新算法提交清单：

- [ ] 实现文件 `algorithms/builtin/<name>.mjs`
- [ ] 在 `registry.mjs` 注册
- [ ] 在 `src/api/bots.ts` 添加 `algo_<name>` 配置
- [ ] 前端下拉菜单添加选项（`play.html` 和 `play-m.html`）
- [ ] 编写算法文档 `algorithms/docs/algorithms/<name>.md`（性能表**不得留“待填”进入仓库**）
- [ ] 更新本文档的算法清单
- [ ] 合法性回归：headless 跑完整对局，断言返回的动作零被引擎拒绝（参 `tests/algorithms/threat-selfplay.test.ts`）
- [ ] 强度口径：至少 3 张图 × 30 局、交替先手；**6 局的胜负不构成结论**
- [ ] 提交前通过 `npm run build`、`npm test` 与冒烟脚本验证（服务器运行时执行 `node scripts/test-algorithm-bots.mjs algo_<name> algo_random`）

详细开发指南见 `algorithms/builtin/README.md`。
