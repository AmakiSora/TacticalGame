# 战术游戏第2名复盘 — `player_b` 视角

**日期:** 2026-08-07
**游戏ID:** a0e89ba7-14d8-4bb4-b792-07e4a8186888
**回放版本/地图:** 3.2.7 / artillery-zone（炮火禁区）
**玩家:** DeepseekV4FlashPreview-OMP（OMP@DeepseekV4FlashPreview）
**席位与出生:** `player_b`，行动顺序第2，annihilation：初始单位在西部（infantry×2 在(-5,0)/(-5,1)，heavy 在(-4,-1)），首个控制点 `cp_west`(-4,0)，无HQ
**参战人数/最终名次:** 2人 / 第2名
**结果:** ❌ 存活至第12整轮，但裁决分数落后
**结束原因:** `turn_limit_score`
**最终补给/HQ/总分:** 108 / 不适用（无HQ） / 522分

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_a` | Dsv4Flash0731-OMP | 存活 | 824 | +302 | 控制8据点，军力价值82，行动分660 |
| 2 | `player_b` | DeepseekV4FlashPreview-OMP（我） | 存活 | 522 | — | 行动分460较高，但仅3据点，军力价值31 |

**裁决分结构（本局权重）：**
- `armyValue` 权重 2，`effectiveActions` 权重 10
- `controlPoint`、`supplies`、`enemyHqDamage`、`ownHqHp` 权重均为 0
- 我方：31×2 + 460 = 522
- player_a：82×2 + 660 = 824

---

## 核心教训

### 致命错误: 前期经济失控，导致中后期无法有效扩军

**问题:** 第1-2轮双方各抢占相邻CP，但 player_a 在第3-4轮迅速扩张至6个CP（我方始终只有3个：cp_west、supply_west、supply_northwest）。第4轮时 player_a 收入已达 40/轮（含8基础+32据点），而我方仅 28/轮。到第7轮，player_a 累计收入差距足以多部署一个 heavy（92）或 ranger（72），直接用数量优势压制了我方的兵力。

**具体战例：**
- 第3轮：player_a 部署 scout 占领 `supply_southeast`(0,3)，又移动 infantry 占领 `cp_northeast`(4,-4)。此时我方仅3个CP，而 player_a 已有5个CP。
- 第5轮：player_a 部署 ranger 于 `(4,-1)`，第6轮该 ranger 长途奔袭至 `(1,-1)`，从3格外狙杀了我方 ranger（34→0 HP）。此时我方已失去远程火力。
- 第7轮：player_a 部署新 heavy 于 `(0,2)`，直接卡住我方中心推进路线。

**改进:** 
- 歼灭模式前4轮（炮火收缩前）是经济窗口期，应优先分兵抢占更多 supply 型 CP，而非仅满足于3个CP的防守配置。
- 第3轮我方 infantry 在 `(0,-3)` 应继续向 `supply_northeast`(3,-3) 推进阻截，而非直接向中心汇合。错过了提前争夺外围 CP 的机会。
- 当确认对手经济优势不可逆时，应在炮火收缩前（R5前）集中兵力打一波决战，而非分散防守。

**预期收益:** 若前期控制5个CP，收入可达 44/轮，足以在第5轮前多部署 1-2 个单位，在中心决战中占据兵力优势。

### 失误2: 重装/支援单位保护不足

**问题:** 我方 heavy 在中心战斗中多次被反复攻击，第7轮 support 才部署到位，仅完成一次 22 点治疗，第9轮即被敌方 ranger 狙杀（46→4→0 HP）。heavy 最终在第10轮被敌方 heavy + ranger 集火击杀（46→21→0 HP）。

**改进:** 支援应在 heavy 进入交战前就部署并前移，而非等 heavy 已经残血了才部署。第6轮收入 117 时就应该部署 support（60）并前移到 center，这样第7轮就可以开始治疗。

**预期收益:** 若 support 早2轮到位，heavy 可多承受 2-3 次攻击，至少多存活 3-4 轮，增加 army value 和 action merit。

---

## 关键时间线

| 整轮/席位回合 | 补给/行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---------------|-------------|----------|----------|------------|
| 第1轮 / player_b | 57→57 | 3/4 | 移动 infantry×2 占领 `supply_west`(-3,0) 和 `cp_west`(-4,0)；移动 heavy 至 `(-2,-1)` | player_a 占领 `supply_east`(3,0) | ✅ 站稳西部 |
| 第2轮 / player_b | 77→77 | 4/4 | 部署 ranger(72) 于 `(-2,0)`；移动 infantry 占领 `supply_northwest`(0,-3)；移动 heavy 至 `(-1,0)` | player_a 部署 scout；占领 `supply_northeast`(3,-3) | ⚠️ 对手开始扩张东侧 |
| 第3轮 / player_b | 33→33 | 4/4 | ranger 攻击 enemy heavy（34dmg, 150→116）；heavy 攻击 enemy heavy（26dmg, 116→90）；移动 infantry 前推 | player_a 部署 infantry；占领 `cp_northeast`(4,-4) 和 `supply_southeast`(0,3) | ❌ 对手已5个CP，经济优势建立 |
| 第4轮 / player_b | 61→61 | 4/4 | heavy+ranger 集火 enemy heavy（58dmg, 90→32）；移动 infantry 至 `(0,-1)`、`(-1,0)` | enemy heavy 反击我方 heavy（26dmg, 150→124）；enemy infantry 补刀（19dmg, 124→105） | ⚠️ 重创对手 heavy 但未击杀 |
| 第5轮 / player_b | 89→89 | 4/4 | ranger 攻击 enemy heavy（30dmg, 32→2）；infantry 补刀击杀 heavy（18dmg, 2→0）；移动 infantry 至 `(1,0)`、`(0,1)` | 对手 ranger 击杀我方 ranger（34→0 HP）；部署新 heavy 于 `(0,2)` | ⚠️ 击杀重装但付出游侠代价 |
| 第6轮 / player_b | 117→57 | 4/4 | 部署 support(60) 于 `(-2,0)`；infantry 攻击 enemy ranger（24dmg）；heavy 攻击 enemy infantry（33dmg）；移动 infantry 至 `(0,0)` | enemy ranger 狙杀我方 support（46→4→0 HP）；enemy heavy 攻击我方 heavy（28dmg）；enemy infantry 攻击我方 infantry（21dmg） | ❌ 支援刚部署就被狙杀 |
| 第7轮 / player_b | 85→85 | 4/4 | 部署 ranger 于 `(-2,0)`；heavy 攻击 enemy ranger（38dmg, 72→34）；infantry 攻击 enemy heavy（14dmg）；移动 infantry 至 `(0,0)` | enemy heavy+ranger 集火击杀我方 heavy（46→0 HP）；enemy ranger 攻击我方 infantry（36dmg, 63→27） | ❌ 重装阵亡，军力崩盘 |
| 第8轮 / player_b | 97→52 | 4/4 | support 治疗 heavy（22→71→74 HP）；heavy 攻击 enemy heavy（23dmg）；infantry 攻击 enemy heavy（20dmg）；移动 infantry 至 `(1,-1)` | enemy heavy 攻击我方 heavy（25dmg, 74→46）；enemy infantry 攻击我方 infantry（21dmg, 57→36） | ⚠️ 持续消耗，军力持续下降 |
| 第9轮 / player_b | 80→80 | 3/4 | 部署 infantry(45) 于 `(-2,0)`；ranger 攻击 enemy heavy（28dmg, 68→40）；infantry 攻击 enemy infantry（23dmg, 76→53）；移动 infantry 至 `(0,1)` | enemy infantry 击杀我方 ranger（1→0 HP）；enemy infantry 攻击我方 infantry（21dmg, 100→79）；enemy scout 攻击我方 infantry（9dmg, 79→70） | ❌ 游侠阵亡，仅剩1单位 |
| 第10轮 / player_b | 80→80 | 1/4 | 最后 infantry 攻击 enemy heavy（15dmg, 40→25）；移动至 `(-1,0)` | enemy 4单位围剿 | ❌ 孤军奋战，无法改变结局 |

**终局检查:**
- 存活资格：✅ 我方仍有 1 单位存活
- 六项裁决分：armyValue 31（权重2）、actionScore 460（权重10已乘）、其他权重项均为 0
- 主要竞争者：player_a armyValue 82，控制8据点
- 分差：302 分

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 12 | `config.balance.maxTurns` |
| 每回合行动点 | 4 | `config.balance.actionsPerTurn` |
| 初始/基础收入 | 45 / 8 | `startingSupplies` / `baseIncome` |
| 据点效果 | supply 收入8/轮，forward_base 收入4/轮 | `controlPointTypes` |
| 裁决权重 | armyValue=2, effectiveActions=10, 其余为0 | `adjudicationWeights` |
| 炮火配置 | startRound=5, intervalRounds=2, damage=25, minimumSafeRadius=2 | `config.annihilation.artillery` |
| 安全半径变化 | R5:6→5, R7:5→4, R9:4→3, R11:3→2（最小） | artillery_shrunk 事件 |

---

## 数据统计

### 对手交互

| 对手席位 | 军力损失（歼灭） | 击杀 | 被击杀 | 关键影响 |
|----------|------------------|------|--------|----------|
| `player_a` | 1（heavy x1） | 1 | 4（ranger x1, heavy x1, support x1, infantry x1） | 对手虽损失1个 heavy 但快速补充，经济优势使其始终能部署新单位 |

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| 单位部署 | 4（ranger x2=144, support x1=60, infantry x1=45） | 249 补给 |
| 基础与据点收入 | — | 累计约 436 补给（3个CP，28/轮×12轮+起始45） |
| 最终补给 | — | 108（权重0，未转化为分数） |

---

## 与历史对局的对比

| 项目 | 历史局 | 本局 |
|------|--------|------|
| 人数/地图/模式 | 第69局 2人/炮火禁区/歼灭（DeepseekV4FlashPreview胜） | 第78局 2人/炮火禁区/歼灭 |
| 名次与结束原因 | 第1名/`last_player_standing` | 第2名/`turn_limit_score` |
| 关键据点控制 | 控制内圈supply，快速扩张 | 全程仅3个CP，未成功扩张 |
| 炮火承伤/击杀 | 安全撤离，零炮击伤亡 | 安全撤离，零炮击伤亡 |
| 裁决总分 | 直接淘汰对手 | 522:824 裁决落后 |

**结论:** 第69局取胜的关键是前期快速抢夺5+个CP建立经济优势，本局在CP争夺上严重不足，重复了"满足于3个CP防守"的被动策略。第69局的经验教训是"歼灭模式必须抢占经济，经济就是兵力"，本局未执行到位。

---

## 总结

### 失败关键因素
1. **经济失控** — 全程仅3个CP vs 对手8个CP，收入差距（28/轮 vs 56/轮）导致对手可多部署2-3个单位
2. **支援保护滞后** — support 在第7轮才部署并第8轮完成首次治疗，此时 heavy 已残血，无法扭转战局
3. **中心决战过早消耗** — 第3-5轮兵力集中在中心与对手主力换血，未能分兵抢占外围CP

### 核心战术原则
> **"歼灭模式前期不抢CP等于慢性死亡；经济即兵力，兵力即裁决分。"**

### 一句话总结
**我全程仅控制3个CP，经济差（28/轮 vs 56/轮）导致对手始终拥有兵力优势，最终以522:824裁决落败。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| 初始步兵 | `player_b` | `(-5,0)` / `(-5,1)` | 西部出生位 |
| 初始重装 | `player_b` | `(-4,-1)` | 西部出生位 |
| 西部集结点 | `player_b` | `(-4,0)` | `cp_west`，初始控制 |
| 西部补给点 | `player_b` | `(-3,0)` | `supply_west`，R1占领 |
| 西北补给点 | `player_b` | `(0,-3)` | `supply_northwest`，R2占领 |
| 中心交战区 | — | `(0,0)` / `(0,1)` / `(1,0)` | R3-R12 主要交战区域 |
| 对手重装击杀 | `player_b`→`player_a` | `(-2,1)` | R5 击杀 |
| 我方重装阵亡 | `player_a`→`player_b` | `(0,1)` | R10 阵亡 |
| 我方游侠阵亡 | `player_a`→`player_b` | `(0,-1)` | R12 阵亡 |
| 炮火最终安全半径 | — | radius=2 | R11 后无收缩 |

*文档生成时间: 2026-08-07*
*回放格式版本: 3.2.7*
*AI模型: OMP@DeepseekV4FlashPreview*