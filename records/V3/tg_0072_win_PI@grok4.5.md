# 战术游戏胜利复盘 — `player_a` 视角

**日期:** 2026-08-04
**游戏ID:** 78ddc7ca-ac61-4228-98c1-ce0c34553473
**回放版本:** 3.2.7
**地图:** dual-lanes（双线抉择，半径8；中央 r≈0 有 blocker 墙 + 两侧 water，迫使上下两路；6 据点：上路偏经济 supply/repair，下路偏前线 forward_base/repair）
**玩家:** Grok4.5-PI（PI@grok4.5）
**席位与出生:** `player_a`，行动顺序第1（`turnOrder` 先手），HQ(-7,0)
**参战人数:** 2
**结果:** 🏆 第1名 — `turn_limit_score`
**结束轮次:** 第15/15整轮
**最终状态:** 存活
**最终补给:** 26
**我方HQ:** 180/180 HP
**裁决总分:** 1904

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_a` | Grok4.5-PI | 存活 | 1904 | — | **4 据点 ×90=360**；军力 480；行动分 198 |
| 2 | `player_b` | Dsv4Flash0731-PI | 存活 | 1392 | -512 | 仅 2 据点（NE+SE）；军力/行动分全面落后 |

> 五项裁决分（权重取本局 `game_start.config.balance.adjudicationWeights`：`enemyHqDamage` 4 / `ownHqHp` 2 / `controlPoint` **90** / `armyValue` 2 / `supplies` 1；`actionScore` 另计，`effectiveActions` 默认 2）：
> - `player_a`：HQ伤 0×4 + 己方HQ 180×2 + 据点 **4×90** + 军力 480×2 + 补给 26×1 + 行动分 **198** = 0+360+360+960+26+198 = **1904**
> - `player_b`：HQ伤 0×4 + 己方HQ 180×2 + 据点 **2×90** + 军力 350×2 + 补给 0×1 + 行动分 **152** = 0+360+180+700+0+152 = **1392**
> - 双方均未对 HQ 造成伤害；胜负完全由 **据点差 2（+180 分）+ 军力差 + 行动分差** 锁定。

---

## 游戏进程时间线

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 局势变化 | 战术意图 |
|---------------|------|--------|----------------|----------|----------|
| 第1轮 / `player_a` | 208→4 | 5/5 | HQ 部署 scout(-6,-1)、scout(-7,1)、inf(-6,0)、inf(-7,-1)、scout(-8,1) | 5 单位铺开，零占点 | 双线同时出兵，为 R2 抢 NW/SW 铺路 |
| 第1轮 / `player_b` | 208→≈14 | 5/5 | 对称部署 scout/inf 于东侧 HQ 邻格 | 镜像开局 | 对手同样全员部署 |
| 第2轮 / `player_a` | 14→14 | 5/5 | scout(-6,-1)→**(-2,-4)**；scout(-7,1)→**(-6,4)**；inf 前推；scout→(-5,3) | **CAP cp_nw + cp_sw** | 侦察 moveRange=5 一回合双点到手 |
| 第2轮 / `player_b` | — | — | scout→(6,-4)/(2,4) 等 | **B CAP cp_ne + cp_se** | 镜像抢东侧 supply+FB |
| 第3轮 / `player_a` | 44→14 | 5/5 | 从 cp_sw 部署 scout(-5,4) cost30(折8)；NW scout→(2,-4)；南 scout→(-2,4)；inf 占/护 NW | **CAP cp_nc + cp_sc**（4:2） | 中路维修站全拿，收入峰值 46 |
| 第3轮 / `player_b` | — | — | 推进与部署 | 仍 2 据点 | 未能同步抢中线 |
| 第4轮 / `player_a` | 60→15 | 5/5 | 从 cp_nc 部署 inf(3,-4)；多 scout 咬伤 B 侦察/步兵 | 4:2 维持，首次交火 | 用前出步兵巩固 NC |
| 第4轮 / `player_b` | — | — | 部队压中/南 | B 开始反夺中线 | 南线成主战场 |
| 第5轮 / `player_b` | — | — | 占 **cp_nc、cp_sc** | **据点 2:4 翻转** | 对手反打中线成功 |
| 第5轮 / `player_a` | 45→45 | 5/5 | 集火击杀 NC 上 B scout(2,-4)；inf(1,-3)→(2,-4) 夺回；南线压 SC 守军 | **夺回 cp_nc**，3:3 | 优先夺回高价值中线 |
| 第6轮 / `player_a` | 83→46 | 5/5 | 继续削 SC scout；从 cp_sw 部署 inf(-5,4) cost37 | 3:3，南线胶着 | FB 折扣扩军 |
| 第7轮 / `player_a` | 84→6 | 5/5 | 击杀 SC scout(-2,4)；scout 上点；**deploy ranger(1,-3) cost78**；ranger+scout 重创北线 B inf | **CAP cp_sc**，4:2；出现远程 | 远程补 DPS，再锁 4 点 |
| 第8轮 / `player_b` | — | — | 击杀我方 scout(-1,4)、(-1,3) | 南线侦察折损 | 对手清场换血 |
| 第8轮 / `player_a` | 52→7 | 5/5 | 击杀 B inf(3,-3)；从 cp_sc 部署 inf(-3,4)；ranger→(2,-2) | 4:2 保持 | 步兵替换残血侦察守点 |
| 第9轮 / `player_b` | — | — | 击杀我 SC 上 scout；**再夺 cp_sc** | 3:3 | SC 拉锯开始 |
| 第9轮 / `player_a` | 45→8 | 5/5 | 打残 SC 上 B inf；cp_sw 再出 inf；ranger 击伤东侧 scout | 3:3 | 不让 SC 免费 |
| 第10–12轮 / `player_a` | 波动 | 5/5 | 连续从 cp_sw 折价出 inf；ranger 击杀东侧 scout；多轮集火 SC 守军 | 3:3 对峙，军力滚雪球 | **用 FB 折扣把收入变步兵墙** |
| 第12轮 / `player_b` | — | — | 击杀我 inf(-3,4) | 南线换血 | 无法扭转据点结构 |
| 第13轮 / `player_a` | 49→49 | 5/5 | 击杀 SC 上 B inf(-2,4)；inf(-2,5)→**(-2,4)** | **三度 CAP cp_sc**，4:2 锁定 | 终局据点结构成型 |
| 第14轮 / `player_a` | 95→17 | 5/5 | 击杀 scout；打残周边；**deploy ranger(2,-3) cost78** | 4:2；军力/行动分拉满 | 终局前把补给换成军力+merit |
| 第15轮 / `player_a` | 63→26 | 5/5 | 击杀 B inf(-2,3)；再出 FB 步兵；ranger 微调站位 | 4:2 收官 | 不浪冲 HQ，保分 |
| 第15轮 / `player_b` | — | — | 末手行动后 `round_end`→`game_over` | 裁决结束 | — |

> 补给为事件推算的回合末近似值（部署扣费 + income 入账）；据点归属以 `control_point_captured` 为准。

---

## 核心胜利策略

### 1. 侦察 moveRange=5 的「一回合双点」

**关键决策:** 第1轮不占点、全员部署；第2轮用两名 scout 同时落到 `cp_nw(-2,-4)` 与 `cp_sw(-6,4)`。

```text
第1轮 / player_a: HQ 连出 3 scout + 2 inf（花费 38×3+45×2=204，剩 4）
第2轮 / player_a: scout (-6,-1)→(-2,-4) 距离4；scout (-7,1)→(-6,4) 距离4（均 ≤ moveRange 5）
回合结束: CAP cp_nw(supply+12) + cp_sw(forward_base+8, 部署折扣8)
```

**为什么有效:**
- 本图 scout **moveRange=5**（非默认印象中的 3），从 HQ 邻格可直达两侧近点
- 先手 `turnOrder` 保证 R2 结束时已是 2:0，对手镜像只能同步拿 NE/SE
- 据点权重 **90**，开局 2 点即 +180 裁决分基底

### 2. 第3轮一口气拿满中线维修站（4:2 峰值）

**关键决策:** R3 用已有 scout 覆盖 `cp_nc(2,-4)` 与 `cp_sc(-2,4)`，并用 NW 步兵回填 `cp_nw`。

```text
第3轮 / player_a: scout(-2,-4)→(2,-4)；scout(-5,3)→(-2,4)；inf→(-2,-4) 护 NW
同时: 从 cp_sw 折价部署 scout(-5,4) cost30
结果: CAP cp_nc + cp_sc → 4:2；下一整轮收入 46（base10+ctrl36）
```

**为什么有效:**
- 4 据点 ×90 = 360 分，对手若长期停在 2 点，仅据点项就落后 180
- repair 点提供 `repairAmount=10` 的被动修血（回放中 NC/SC 共触发多次 `control_point_repair`），降低换血损耗
- 对手 R3 未能同步抢中线，经济窗口被拉开

### 3. SC 拉锯中的「击杀→上点→FB 补兵」循环

**关键决策:** SC 在 R5 被夺、R7 夺回、R9 再丢、R13 三度夺回；每次都用步兵/侦察清守军后立刻 capturer 上点，并用 `cp_sw` 折扣持续补步兵。

```text
第5轮 / player_b: CAP cp_nc + cp_sc（2:4 翻转）
第5轮 / player_a: 击杀 NC scout → inf 上 (2,-4) 夺回 NC
第7轮 / player_a: 击杀 SC scout → scout 上 (-2,4) 夺回 SC；并出 ranger
第9轮 / player_b: 再夺 SC
第11轮 / player_a: 击杀 SC 上 inf(-2,4)
第13轮 / player_a: 再杀 SC 守军 → inf(-2,5)→(-2,4) 三度 CAP cp_sc
```

**为什么有效:**
- 不接受 3:3 僵持到终局；每丢 1 点 = 90 分 + 每轮 8 收入
- `forward_base` 折扣 8：本局从 cp_sw 多次部署步兵 **实际 cost=37**（45-8），累计折扣约 **48**（见部署统计）
- 步兵 canCapture + 更高生存，比纯侦察守点更抗集火（吸取了「前哨用 scout 被秒」类历史教训）

### 4. 高 controlPoint 权重下不斩首、不空转

**关键决策:** 全场 **HQ 伤害双方均为 0**；把 AP 花在占点、击杀守军、部署与有效攻击（actionMerit）上。

```text
终局: enemyHqDamage 0:0；controlPoints 4:2；armyValue 480:350；actionScore 198:152
第14–15轮: 仍部署 ranger/infantry，而不是空移动刷回合
```

**为什么有效:**
- `enemyHqDamage` 仅 4，打满 180 HQ 也只有 720 分且需多轮贴脸；而 **1 个据点=90 分**，2 点差=180 分且附带收入
- 中央 blocker/water 分割战场，绕路打 HQ 成本高于抢 SC
- 终局把 95 补给压到 17/26，军力项与行动分同步抬升（对照历史「囤补给不转军力」败因）

### 5. 远程兵作为「廉价据点保险」

**关键决策:** R7 出第一名 ranger(1,-3)，R14 再出第二名 ranger(2,-3)；主要用于清东侧 scout 与压血，而非自杀冲 HQ。

```text
第7轮: deploy ranger from cp_nc cost78
第10轮: ranger(4,-3) 击杀 scout(6,-3) dmg23
第12轮: ranger 击杀 scout(5,-4) dmg28
第14轮: ranger 击杀 scout(5,-3) dmg23；再 deploy 第二 ranger
```

**为什么有效:**
- attackRange=3 可在北线安全输出，保护 NC 侧
- 每次击杀减少对手军力分，并增加 actionMerit（`ceil(damage/20)`）
- 费用 78 偏高，但在 4 据点收入（38–46/轮）下可承受

---

## 关键转折详解

### 第2轮 / `player_a` 回合 — 双点开局

```text
操作: scout 9eb7393d (-6,-1)→(-2,-4)；scout 182df643 (-7,1)→(-6,4)
结果: control_point_captured cp_nw、cp_sw（previousOwner=null）
事件依据: move seq≈21+；capture 在 turn_end 结算
意义: 先手确立 2:0 经济与 180 分据点基底，定下「抢点局」而非「斩首局」基调
```

### 第3轮 / `player_a` 回合 — 4:2 峰值

```text
操作: scout→(2,-4)、scout→(-2,4)；inf 回填 (-2,-4)；cp_sw 折价出 scout
结果: CAP cp_nc + cp_sc；下轮 income amount=46
意义: 本局最大经济窗口；若能更稳守 SC，中盘拉锯可大幅缩短
```

### 第5轮 / `player_b`→`player_a` — 中线翻转与反夺

```text
操作: player_b 夺 cp_nc、cp_sc（2:4）；player_a 集火击杀 (2,-4) scout 并 inf 上点
结果: unit_death B scout(2,-4)；CAP cp_nc prev=player_b；据点回到 3:3
意义: 证明「丢点必须当回合内具备反打能力」；NC 有 repair，值得优先夺回
```

### 第7轮 / `player_a` 回合 — 首次稳定夺回 SC + 远程成型

```text
操作: 击杀 SC scout(-2,4)；scout 上点 CAP cp_sc；deploy ranger(1,-3) cost78
结果: 4:2；出现 attackRange=3 输出
意义: 将「纯步侦换血」升级为「远程+步兵」体系，东侧 scout 此后多次被点名击杀
```

### 第13轮 / `player_a` 回合 — 三度锁定 SC

```text
操作: 击杀 SC 守军 inf(-2,4)；inf 6892d9dd (-2,5)→(-2,4)
结果: CAP cp_sc prev=player_b；此后直至终局 4:2 未再翻转
意义: 终局前 2 整轮锁定据点结构，180 分差距成为不可逆优势
```

---

## 失误与改进

### 失误1: 第4轮 NC 有兵却让 R5 被轻易翻盘

**问题:** R4 已在 NC 区域部署 inf(3,-4) 并有 scout 交火，但 capturer 未稳定站在 `cp_nc`/`cp_sc` 上或形成 2 单位互保；R5 `player_b` 一波同时夺走 NC+SC，据点 4:2→2:4。  
**改进:** 4:2 时至少 1 步兵站在据点格上、1 单位邻格；SC/NC 被威胁时优先「站岗」而非追击残血。  
**预期收益:** 少丢 1–2 整轮的 90 分据点差与 8–16 收入，中盘无需三度打 SC。

### 失误2: 南线过度用 scout 换血，R8 连续损两名侦察

**问题:** R8 `player_b` 击杀我方 scout(-1,4)、(-1,3)；R9 又杀 SC 上 scout。侦察 canCapture 但防御仅 4，在 inf 堆里极易蒸发。  
**改进:** 占点用 scout 开路后，**守点必须换成 infantry**；残血 scout 应后撤到 repair 点吃 `control_point_repair`（本局 NC 上 scout 多次修到满，证明有效）。  
**预期收益:** 少损 2–3 侦察（军力约 76–114），SC 更不易被反抢。

### 失误3: 多轮「击杀守军却未在同回合上点」

**问题:** 例如 R11 击杀 SC 上 inf 后，上点单位因路径/已行动未能站上 (-2,4)，SC 归属仍是 B，直到 R13 才三度 CAP。  
**改进:** 规划 AP 时预留 1 次 capturer 移动；清场顺序改为「未行动 capturer 最后上点」或邻格待命。  
**预期收益:** 提前 1–2 整轮锁定 4:2，多拿 16–32 收入与 90–180 据点分窗口。

### 失误4: 从未威胁 NE/SE，终局接受 4:2 而非冲击 5:1/6:0

**问题:** 东侧 `cp_ne`/`cp_se` 全程归 B；我方 ranger 多用于清 scout，没有组织一次对 SE 的 capturer 突击。  
**改进:** 在 4:2 且南线稳定后，用 1 scout + 1 ranger 威胁 SE(2,4)，逼对手分兵。  
**预期收益:** 即使未拿下，也可降低对手在 SC 的兵力密度；若拿下 SE，据点项再 +90。

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 15 | `config.balance.maxTurns` |
| 每回合行动点 | 5 | `actionsPerTurn` |
| 初始/基础收入 | 208 / 10 | `startingSupplies` / `baseIncome` |
| 据点效果 | supply +12；FB +8 且部署折扣 8；repair +8 且修 10HP | `controlPointTypes` |
| 裁决权重 | HQ伤4 / 己方HQ2 / **据点90** / 军力2 / 补给1 | `adjudicationWeights` |
| 关键单位 | scout 移5 费38；inf 移3 费45；ranger 射3 费78 | `config.units` |
| 地形 | 中央 blocker 墙 + water 分隔上下路 | dual-lanes 强制双线抉择 |

---

## 数据统计

### 对 `player_b` 的交互

| 对手席位 | HQ伤害 | 击杀 | 被击杀 | 夺取其据点 | 关键影响 |
|----------|--------|------|--------|------------|----------|
| `player_b` | 0 | **9**（unit_death 归属 B） | **5**（我方单位死亡） | NC×1 反夺、SC×3 次 CAP（含对 B 的夺回） | 全程压制据点结构；总伤害 882:610 |

> 击杀明细（B 损失）: scout×5 + infantry×4。我方损失: scout×3 + infantry×2。

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| scout | 4 | 实付 144（含折扣合计 8） |
| infantry | 10 | 实付 402（折扣合计 **48**，多次 FB 出兵 cost37） |
| ranger | 2 | 实付 156 |
| 部署折扣 | FB 相关约 6 次量级 | 节省约 **56** 补给（scout8+inf48） |
| 基础+据点收入 | 多轮 10/30/38/46 | 回放 `income` 事件可加总；终局剩 **26** |
| 最终补给 | — | 26（几乎花光，符合高军力终局） |

### 最终五项裁决分账本

| 项 | 我方原始量 | ×权重 | 贡献 |
|----|------------|-------|------|
| headquartersDamage | 0 | ×4 | 0 |
| ownHqHp | 180 | ×2 | 360 |
| controlPoints | 4 | ×90 | **360** |
| armyValue | 480 | ×2 | 960 |
| supplies | 26 | ×1 | 26 |
| actionScore | 198 | （已含 effectiveActions） | **198** |
| **total** | — | — | **1904** |

---

## 与历史对局的对比

| 项目 | 历史局 | 本局 |
|------|--------|------|
| 人数/地图/出生位 | `tg_0069` dual-lanes 上 Dsv4Flash 败；`tg_0046` 多人对局 grok 第2；`tg_0055` grok 胜 | 2人 dual-lanes，`player_a` 西侧先手 |
| 名次与结束原因 | tg_0069 同图有「领先却囤补给」败因；tg_0071 breach 上据点碾压却被斩首 | **turn_limit_score 胜**，分差 512，双方 HQ 满血 |
| 关键据点控制 | 高 controlPoint 权重局必须 3+ 点 | 开局 2→峰值 4，中盘 3–4 拉锯，终局 **4:2** |
| HQ伤害/承伤 | tg_0071 强调 HQ 走廊 | 本图 HQ 权重低 + 中央墙阻隔，**正确选择不斩首** |
| 淘汰数 | 多局有 last_player_standing | 0 淘汰，纯裁决 |
| 裁决总分 | — | 1904 vs 1392 |

**结论:**
1. **验证** `tg_0046_rank02_PI@grok4.5.md`：`controlPoint` 极高时，主线必须是据点结构，与对手互砍若不改归属则无效——本局把 AP 锚定在 SC/NC 归属上，分差主要来自 4:2。
2. **修正** `tg_0069` / `tg_0071` 相关教训中的「领先后囤补给」：本局 R14 仍花 78 出 ranger、R15 继续 FB 出兵，终局补给仅 26，军力 480>350。
3. **部分重犯**「scout 守前哨被集火」（R8–R9 连损侦察）——已在中后期改为步兵守 SC，但切换偏晚。
4. **未重犯** breach 式 HQ 隧道失守：本图策略匹配权重，没有为了 HQ 伤去送军力。

---

## 总结

### 胜利关键因素
1. **先手 + scout 移5**：R2 同时锁定 NW supply 与 SW forward_base  
2. **R3 中线双占形成 4:2**，把据点权重 90 变成长期分差  
3. **SC 三度夺回 + FB 折扣步兵墙**，在拉锯中维持军力与归属优势  
4. **终局把补给打成军力/行动分**，不给对手靠 armyValue 翻盘的机会  

### 核心战术原则
> **“dual-lanes 上 controlPoint=90 时：先手双点（NW+SW）→ 第三轮锁中线 → 南线只用步兵守点并用 FB 折价补兵 → 丢点必须当轮具备反打上点的 capturer；能 4:2 就不要去赌 HQ 斩首。”**

### 一句话总结
**本局作为西侧先手，用侦察一回合双占经济/前线点、第三轮拿满中线维修站，并在南线维修站与 Dsv4Flash0731-PI 三度拉锯后于第13轮锁死 4:2 据点，最终以 1904:1392 的纯裁决分优势赢下双线抉择。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| HQ | `player_a` | (-7,0) | 西侧出生，先手 |
| HQ | `player_b` | (7,0) | 东侧出生 |
| cp_nw | supply | (-2,-4) | 开局必抢，+12 收入 |
| cp_nc | repair | (2,-4) | 中线北；R3 占、R5 丢、R5 夺回 |
| cp_ne | supply | (6,-4) | 对手经济点，本局未夺 |
| cp_sw | forward_base | (-6,4) | 折扣 8 的扩军核心 |
| cp_sc | repair | (-2,4) | 本局主战场，三度易手 |
| cp_se | forward_base | (2,4) | 对手前线，本局未夺 |
| 中央墙 | — | (q=-2..2, r=0) blocker + 邻格 water | 分割上下路，抑制中央斩首 |

---

*文档生成时间: 2026-08-04*
*回放格式版本: 3.2.7*
*AI模型: PI@grok4.5*
