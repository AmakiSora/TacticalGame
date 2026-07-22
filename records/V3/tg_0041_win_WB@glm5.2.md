# 战术游戏胜利复盘 — `player_b` 视角

**日期:** 2026-07-23
**游戏ID:** 834716f7-5dca-43dc-8f9a-f92d94b00c6a
**回放版本:** 3.0.1
**地图:** `danger-close`（危险距离）
**玩家:** glm5.2-WB（WB@glm5.2）
**席位与出生:** `player_b`，行动顺序第0（先手），使用 `slot_a`，HQ(-2,0)
**参战人数:** 2
**结果:** 🏆 第1名 — `last_player_standing`
**结束轮次:** 第12/30整轮
**最终状态:** 存活
**最终补给:** 116
**我方HQ:** 120/120 HP（全程满血）
**裁决总分:** 2640

---

## 玩家表

| 席位 | 玩家名 | agent@模型 | spawnSlot | HQ坐标 | turnOrder | 最终状态 |
|------|--------|-----------|-----------|--------|-----------|----------|
| `player_a` | Qwen3.8Max-QD | QD@qwen3.8max | slot_b | (2,0) | 1 | 淘汰（HQ归零） |
| `player_b` | glm5.2-WB | WB@glm5.2 | slot_a | (-2,0) | 0 | 存活（冠军） |

> 关键：`player_b` 被分配到 `slot_a`（左侧 HQ -2,0），而非按字母对应的右侧。出生位须以 `players.X.spawnSlotId` + `headquarters.X` 为准，不能凭 player 字母猜侧。

---

## 游戏进程时间线

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 局势变化 | 战术意图 |
|---------------|------|--------|----------------|----------|----------|
| 第1轮 / `player_b` | 20→20 | 1/1 | scout(-5,4)→(-3,1) seq=4 | 向cp_1推进 | 抢占经济点 |
| 第1轮 / `player_a` | 26→26 | 1/1 | scout(5,-4)→(4,-1) seq=8 | 向cp_2推进 | 对称抢点 |
| 第2轮 / `player_b` | 26→26 | 1/1 | scout(-3,1)→(-3,0) seq=13，占领cp_1 seq=14 | 收入6→14 | ✅ 经济领先建立 |
| 第2轮 / `player_a` | 32→32 | 1/1 | scout(4,-1)→(3,0) seq=18，占领cp_2 seq=19 | 收入6→14 | 双方经济持平 |
| 第3轮 / `player_b` | 40→40 | 1/1 | scout(-5,5)→(-3,3) seq=24 | 第二scout向中央靠拢 | 保留灵活性 |
| 第3轮 / `player_a` | 38→38 | 1/1 | scout(5,-5)→(3,-2) seq=28 | scout向中央靠拢 | 对称布局 |
| 第4轮 / `player_b` | 54→4 | 1/1 | **部署heavy至(-2,-1) -50** seq=33 | heavy上路起点 | ✅ 正确部署位 |
| 第4轮 / `player_a` | 52→2 | 1/1 | 部署heavy至(2,1) -50 seq=37 | heavy对称起点 | 双方同期出heavy |
| 第5轮 / `player_b` | 18→18 | 1/1 | heavy(-2,-1)→(-1,-2) seq=42 | 推进1步 | 向中央移动 |
| 第5轮 / `player_a` | 16→16 | 1/1 | heavy爆破(1,1)→plain seq=46 | 开右路通道 | ❌ 只demolish没move，低效 |
| 第6轮 / `player_b` | 32→32 | 1/1 | heavy爆破(0,-2)→plain seq=51 | 开上路通道 | ❌ 同样只demolish没move，低效 |
| 第6轮 / `player_a` | 30→30 | 1/1 | heavy(2,1)→(0,1) seq=55 | 推进2步 | 对手跟上 |
| 第7轮 / `player_b` | 46→46 | 1/1 | heavy(-1,-2)→(0,-1) seq=60 | 经(0,-2)推进 | 接近中央 |
| 第7轮 / `player_a` | 44→44 | 1/1 | heavy(0,1)→(0,0) seq=64，**攻击我heavy 150→124** seq=65 (dmg26) | 对手贴脸我heavy | ❌ 对手选攻击heavy而非demolish(-1,0) |
| 第8轮 / `player_b` | 60→60 | 1/1 | heavy(0,-1)→(1,-1) seq=70，**爆破(1,0)→plain** seq=71 | 打通攻HQ_a通道 | ✅ move+demolish同回合高效 |
| 第8轮 / `player_a` | 58→58 | 1/1 | heavy攻击我heavy 124→96 seq=75 (dmg28) | 继续削我heavy | ❌ 再次攻击heavy，(-1,0)仍堵 |
| 第9轮 / `player_b` | 74→74 | 1/1 | heavy(1,-1)→(1,0) seq=80，**攻击HQ_a 120→85** seq=81 (dmg35) | 首攻敌HQ | ✅ 先手首攻 |
| 第9轮 / `player_a` | 56→2 | 1/1 | **部署ranger至(2,1) -78** seq=85 | 远程单位上线 | ❌ 浪费关键行动部署，未攻我HQ |
| 第10轮 / `player_b` | 88→88 | 1/1 | 攻击HQ_a 85→52 seq=90 (dmg33) | HQ_a过半损 | 赛跑领先 |
| 第10轮 / `player_a` | 16→16 | 1/1 | ranger攻击我heavy 96→67 seq=94 (dmg29) | 削我heavy | ❌ 仍不demolish(-1,0) |
| 第11轮 / `player_b` | 102→102 | 1/1 | 攻击HQ_a 52→19 seq=99 (dmg33) | HQ_a濒死 | 一击必杀在即 |
| 第11轮 / `player_a` | 30→30 | 1/1 | heavy攻击我heavy 67→42 seq=103 (dmg25) | 我heavy残血 | ❌ 最后机会仍未攻我HQ |
| 第12轮 / `player_b` | 116→116 | 1/1 | **攻击HQ_a 19→0** seq=108 (dmg39) → HQ_a摧毁 seq=109 → player_a淘汰 seq=111 | 🏆 胜利 | 先手击杀 |

> 补给格式为"行动前→行动后"；行动点为"已用/每回合上限"。本图 `actionsPerTurn=1`。

---

## 核心胜利策略

### 1. 抢占supply据点建立经济优势

**关键决策:** 第1-2轮用scout两步抢占cp_1(-3,0)，比不占点早2整轮攒够heavy部署费。

```text
第1轮 / player_b: scout(-5,4)→(-3,1) 向cp_1推进
第2轮 / player_b: scout(-3,1)→(-3,0) 占领cp_1，收入6→14/轮
第4轮 / player_b: 攒到54补给，部署heavy（不占点要等到第6轮）
```

**为什么有效:**
- 占领cp_1后每轮多8补给，第3-12轮共多收入80补给
- 第4轮即可部署heavy（54≥50），比不占点路线（第6轮50补给）快2整轮
- 在1行动/回合的地图上，2整轮等于2个珍贵行动点

### 2. heavy部署到正确突破位(-2,-1)

**关键决策:** 第4轮从HQ(-2,0)部署heavy至(-2,-1)，此处有通往中央(0,0)的可行路线（经上方绕路）。

```text
第4轮 / player_b: deploy heavy at (-2,-1) 花费50
路线: (-2,-1)→(-1,-2)→[爆破(0,-2)]→(0,-1)→(1,-1)→[爆破(1,0)]→(1,0)→攻击HQ(2,0)
```

**为什么有效:**
- (-2,-1)是左路唯一能向中央推进的plain格（HQ其他plain邻居(-3,1)被下方墙封死）
- 该位置经上方绕路可达(0,-1)，再demolish(1,0)即可贴脸对手HQ
- 对比 tg_0038 我部署到(3,-1)被blocker墙封死全程零输出——本局位置选择正确

### 3. move+demolish同回合高效开路

**关键决策:** 第8轮 heavy先move到(1,-1)，同回合demolish(1,0)，一回合完成"移动+开墙"两个动作。

```text
第8轮 / player_b: move heavy (0,-1)→(1,-1) [激活，花1行动点]
第8轮 / player_b: demolish (1,0) [已激活单位剩余动作，免费]
结果: (1,0)变plain，下回合可直接move到(1,0)攻击HQ_a
```

**为什么有效:**
- 规则：单位首次激活（move/deploy/attack/demolish）花1行动点，之后该单位的剩余合法动作免费
- demolish后该单位"acted"，不能再attack，但move可在demolish前或后执行
- 一回合完成2个动作，比"move一回合+demolish一回合"快1整轮——在赛跑局中是生死差距

### 4. 始终以攻对手HQ为唯一目标，不被对手"打兵"节奏带偏

**关键决策:** 第9-12轮连续4次attack对手HQ，无视对手反复攻击我heavy。

```text
第9轮 / player_b: attack HQ_a 120→85
第10轮 / player_b: attack HQ_a 85→52（对手同期ranger打我heavy 96→67）
第11轮 / player_b: attack HQ_a 52→19（对手heavy打我heavy 67→42）
第12轮 / player_b: attack HQ_a 19→0 击杀
```

**为什么有效:**
- 我HQ全程120满血：对手从未demolish(-1,0)，物理上无法触及我HQ
- 对手把4个行动点用在攻击我heavy（150→42），却没对我HQ造成1点伤害
- heavy attack=40对HQ defense=4，每轮约35伤害，4轮即可击杀120HP的HQ
- 即使heavy被打到42HP，attack伤害不随HP降低，输出不变

---

## 关键转折详解

### 第7轮 / `player_a` 回合 — 对手选择攻击我heavy而非demolish(-1,0)

```text
操作: 对手heavy(0,1)→(0,0) seq=64，攻击我heavy seq=65 (dmg26, 我150→124)
结果: 我heavy受伤，但(-1,0)仍为blocker，对手无法攻我HQ
事件依据: seq=64 move, seq=65 attack
意义: 对手把"开路攻城"误判为"打兵消耗"。若对手改为move(0,0)+demolish(-1,0)，
      第8轮即可move(-1,0)+attack我HQ，形成对攻——本局胜负在此刻已经倾斜。
```

### 第8轮 / `player_b` 回合 — move+demolish同回合打通攻城路

```text
操作: heavy(0,-1)→(1,-1) seq=70，demolish(1,0) seq=71
结果: (1,0)变plain，heavy位于(1,1)邻格，下回合可move(1,0)+attack HQ_a(2,0)
事件依据: seq=70 move, seq=71 demolish
意义: 这是本局最高效的一回合——完成移动+开墙两个动作。对手同期只用attack打我heavy，
      我在"开路进度"上反超对手1整轮。
```

### 第9轮 / `player_b` 回合 — 先手首攻对手HQ

```text
操作: heavy(1,-1)→(1,0) seq=80，attack HQ_a 120→85 seq=81 (dmg35)
结果: 对手HQ首次受损，我建立赛跑领先
事件依据: seq=80 move, seq=81 attack
意义: 先手(turnOrder 0)的优势在此兑现——双方同时具备攻城能力时，我先攻击。
      对手第9轮却选择deploy ranger(2,1)花费78补给和一个行动点，完全没攻我。
```

### 第12轮 / `player_b` 回合 — 击杀对手HQ

```text
操作: attack HQ_a 19→0 seq=108 (dmg39)
结果: HQ_a摧毁 seq=109，player_a淘汰 seq=111，game_over seq=112
事件依据: seq=108-112
意义: 先手优势决定胜负——若对手R11后轮到我R12，我先动击杀。即使对手R11攻我heavy(67→42)，
      我HQ仍120满血，对手无力回天。
```

---

## 失误与改进

### 失误1: 第6轮 demolish(0,-2)只做一个动作，未同回合move

**问题:** 第6轮我只demolish(0,-2)→plain seq=51，heavy留在(-1,-2)没move。浪费了"激活后move免费"的机制。
**改进:** 应该 demolish(0,-2) [激活] + move(-1,-2)→(0,-2) [免费]，一回合完成开墙+推进。
**预期收益:** heavy提前1整轮抵达(0,-1)，整体攻城节奏快1整轮，R11即可击杀而非R12。

### 失误2: 第6轮hex距离计算错误，2次move API失败

**问题:** 尝试move heavy (-1,-2)→(0,0) 和 (-1,-2)→(1,-1)，均返回 `target is not reachable`。
实际hex距离：(-1,-2)→(0,0)=max(1,2,3)=3，(-1,-2)→(1,-1)=max(2,1,3)=3，都超过heavy moveRange=2。
**改进:** 每次move/attack前用 `max(|dq|,|dr|,|dq+dr|)` 验证距离≤moveRange/attackRange再调用API。
**预期收益:** 避免无效API调用浪费时间，降低被服务器限流风险。

### 失误3: 第8轮尝试attack对手heavy失败（"already acted"）

**问题:** 第8轮 move+demolish后尝试attack对手heavy(0,0)，返回 `already acted this turn`。
demolish会标记单位"acted"，之后不能再attack（只能move）。
**改进:** 记住动作顺序规则：demolish是"终结动作"，若要attack须在demolish之前；或move+attack一回合（不demolish），move+demolish一回合（不attack）。
**预期收益:** 避免无效API调用，正确规划每回合动作组合。

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 30 | `config.balance.maxTurns` |
| 每回合行动点 | 1 | `actionsPerTurn` — 每个行动极其珍贵 |
| 初始/基础收入 | 20 / 6 | `startingSupplies` / `baseIncome` |
| 据点效果 | supply +8/轮 | `controlPointTypes.supply.income` |
| 裁决权重 | enemyHqDamage×20, ownHqHp×1, controlPoint×30, armyValue×1, supplies×0 | `adjudicationWeights` |
| HQ规格 | 120HP, defense 4 | `headquartersSpec` |
| heavy | 150HP, atk40, def13, move2, range1, cost50 | `units.heavy` |
| ranger | 72HP, atk44, def3, move2, range3, cost78 | `units.ranger` |

**动作组合规则（本局验证）:**
- move+attack 同回合：✅ 可以（move激活，attack免费）
- move+demolish 同回合：✅ 可以（move激活，demolish免费）
- demolish+move 同回合：✅ 可以（demolish激活，move免费）
- demolish+attack 同回合：❌ 不行（demolish后"already acted"）
- demolish+move+attack 三连：❌ 不行（demolish阻断attack）

---

## 数据统计

### 对各对手的交互

| 对手席位 | HQ伤害 | 击杀 | 被击杀 | 夺取其据点 | 关键影响 |
|----------|--------|------|--------|------------|----------|
| `player_a` | 120 | 0单位（击毁HQ淘汰） | 0 | 0 | 先手4连击HQ，对手从未触及我HQ |

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| heavy × 1 | 1 | 50补给（部署至(-2,-1)） |
| scout/scout/infantry等 | 0 | 起始2scout未额外部署 |
| 基础收入 | 11轮 | 6×1(R2) + 6×1... 见下 |
| 据点收入(cp_1) | 10轮 | 8×10 = 80补给 |
| 最终补给 | — | 116 |

**补给账本:**
- 起始：20
- 收入：R2(+6) + R3-R12(+14×10) = 6+140 = 146
- 支出：deploy heavy 50
- 最终：20+146-50 = 116 ✓

**对手 `player_a` 账本:**
- 起始：20
- 收入：R1-R3(+6×3) + R4-R12(+14×9)... 实际从income事件：6+6+6+14×8 = 130
- 支出：deploy heavy 50 + deploy ranger 78 = 128
- 最终：20+130-128 = 22（game_over显示30，差异可能来自cp收入延迟结算，回放无法完全可靠统计）

### 裁决五项分

| 项目 | 我方(player_b) | 对手(player_a) |
|------|----------------|----------------|
| HQ伤害 ×20 | 120×20=2400 | 0×20=0 |
| 己方HQ HP ×1 | 120×1=120 | 0×1=0 |
| 据点 ×30 | 1×30=30 | 0×30=0 |
| 军力 ×1 | 90×1=90 | 0×1=0 |
| 补给 ×0 | 116×0=0 | 30×0=0 |
| **总分** | **2640** | **0** |

> 军力90 = heavy(150HP剩余42，按价值折算约90). 对手淘汰后单位全部移除，军力0。

---

## 与历史对局的对比

| 项目 | tg_0038（历史局） | 本局 tg_0041 |
|------|-------------------|--------------|
| 人数/地图/出生位 | 2人/danger-close/HQ(2,0)右侧 | 2人/danger-close/HQ(-2,0)左侧 |
| 名次与结束原因 | 第2名，R11被淘汰 | 第1名，R12淘汰对手 |
| heavy部署位 | (3,-1) ❌被墙封死 | (-2,-1) ✅正确突破位 |
| heavy是否参战 | 全程零输出 | 4连击HQ共140伤害 |
| HQ伤害/承伤 | 造成23 / 承受120 | 造成120 / 承受0 |
| 关键据点控制 | 占cp_2 | 占cp_1 |
| 裁决总分 | 460 | 2640 |
| hex距离计算错误 | 2次attack失败 | 2次move失败（R6） |

**结论:**
1. **tg_0038的"部署前验证pathfinding"教训得到改进**——本局heavy部署到(-2,-1)正确位置，全程参战并完成击杀。
2. **tg_0038的"hex距离验证"教训部分重复**——R6仍犯2次move距离错误，但未消耗行动点（API失败不扣action），影响小于tg_0038的2次attack失败。
3. **本局新发现：demolish+move可同回合**——tg_0038未利用此机制，本局R8首次运用move+demolish同回合，效率提升明显。
4. **本局新发现：对手"打兵不攻城"是致命失误**——对手4次攻击我heavy却从不demolish(-1,0)开路攻我HQ，我HQ全程满血。攻城优先于打兵，尤其在1行动/回合地图。

---

## 总结

### 胜利关键因素
1. **先手优势（turnOrder 0）**：双方赛跑攻HQ时，我先手4连击，R12先动击杀对手。
2. **对手战略失误**：对手R7-R11共4次攻击我heavy，从未demolish(-1,0)攻我HQ，我HQ全程120满血。
3. **正确部署位+高效开路**：heavy部署(-2,-1)，R8 move+demolish同回合打通攻城路。
4. **抢占cp_1建立经济**：早2整轮部署heavy，占据节奏主动。

### 核心战术原则
> **"攻城优先于打兵——在1行动/回合的图上，每个行动点都要服务于摧毁对手HQ这个唯一目标；demolish开路+move可同回合，别浪费demolish-only的整轮。"**

### 一句话总结
**本局凭借先手优势+正确heavy突破路线+对手反复打兵不攻城的致命失误，全程保住HQ满血并以4连击于R12击杀对手HQ——胜负在第7轮对手选择attack我heavy而非demolish(-1,0)时已定。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| HQ | `player_b`（我） | (-2,0) | 左侧出生位，全程120满血 |
| HQ | `player_a`（对手） | (2,0) | 右侧出生位，R12归零 |
| cp_1 | supply | (-3,0) | 我方据点，R2占领，+8/轮 |
| cp_2 | supply | (3,0) | 对手据点，R2占领 |
| 关键墙(-1,0) | 中墙 | (-1,0) | 对手全程未爆破，无法攻我HQ |
| 关键墙(1,0) | 中墙 | (1,0) | 我R8爆破，打通攻对手HQ路 |
| 关键墙(0,-2) | 上墙 | (0,-2) | 我R6爆破，开左路上方通道 |
| 关键墙(1,1) | 右墙 | (1,1) | 对手R5爆破，开右路通道 |
| heavy突破位 | 我方 | (-2,-1) | heavy部署起点 |
| heavy突破位 | 对手 | (2,1) | heavy部署起点 |

---

*文档生成时间: 2026-07-23*
*回放格式版本: 3.0.1*
*AI模型: WB@glm5.2*
