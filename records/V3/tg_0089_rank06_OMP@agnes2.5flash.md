# 战术游戏第6名复盘 — `player_a` 视角

**日期:** 2026-08-12
**游戏ID:** 43eca9d3-33c5-4e4d-9efe-11d2e071b478
**回放版本/地图:** 3.2.10 / artillery-zone（炮火禁区）
**玩家:** agnes2.5flash-OMP（OMP@agnes2.5flash）
**席位与出生:** `player_a`，行动顺序第6，初始单位@(0,5),(1,4),(-1,5)，首个控制点cp_southeast(0,4)
**参战人数/最终名次:** 6人 / 第6名
**结果:** ❌ 存活至第11轮被炮火击杀最后单位，裁决落后
**结束原因:** `turn_limit_score`
**最终补给/军力/总分:** 167 / 0 / 230分

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_e` | Hy3-WB | 存活 | 792 | +562 | armyValue=146 + actionScore=500 |
| 2 | `player_d` | Step3.7Flash-OMP | 存活 | 746 | +516 | armyValue=88 + actionScore=570 |
| 3 | `player_c` | SenseNova6.8FLP-OMP | 存活 | 544 | +314 | actionScore=490 |
| 4 | `player_b` | MiniMaxM3-OMP | 存活 | 506 | +276 | actionScore=430 |
| 5 | `player_f` | LongCat2.0-CP | 存活 | 296 | +66 | supplies=232（囤积） |
| 6 | `player_a` | agnes2.5flash-OMP | 淘汰 | 230 | — | armyValue=0, actionScore=230 |

---

## 核心教训

### 致命错误: 未能及时占领第二个补给点，导致收入和部署能力严重不足

本局我始终只控制1个forward_base（cp_southeast, +4收入）+ 1个supply（supply_southeast, +8收入），收入20/轮。其他对手均控制2个据点，收入同样是20/轮，但对手部署了更多单位（包括heavy/ranger/support），而我方始终只有infantry。

**问题:** R1-R2我只用步兵占领supply_southeast，未能向supply_east(3,0)或supply_northeast(3,-3)推进。对手player_c在R2已占领supply_east，player_d占领supply_northeast。

**正确做法:** R1应派出一个步兵向supply_east(3,0)推进（距离2格，moveRange=3足够），R2占领后即可获得额外+8收入，R3-R4可部署heavy或ranger。

**预期收益:** 多一个supply点意味着R3-R11多获得9×8=72补给，足以部署1个heavy（92）+1个infantry（45）=137，或2个heavy=184。armyValue将从0提升至184×2=368分。

---

## 关键时间线

| 整轮/席位回合 | 补给/行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---------------|-------------|----------|----------|------------|
| R1 / player_a | 45→57, 4/4 | Infantry(0,5)→(0,3)；Infantry(1,4)→(2,2)；Heavy(-1,5)→(0,4) | player_b占领supply_northwest | ⚠️ 仅移动，未尝试占领supply_east |
| R2 / player_a | 57→77, 4/4 | Infantry(0,3)停留在supply_southeast（自动占领）；Infantry(2,2)→(2,1)；Heavy(0,4)→(1,3) | player_c占领supply_east；player_d占领supply_northeast | ❌ 错过占领supply_east的机会 |
| R3 / player_a | 77→97, 4/4 | Infantry(1,1)→(1,1)；Infantry(2,1)→(2,0)；Heavy(1,3)→(2,2) | player_e中心扩张；player_f扩张西南 | 推进中心，但未攻击低HP敌人 |
| R4 / player_a | 97→117, 4/4 | Infantry攻击player_c步兵；部署Infantry@(1,3)（cost=45） | player_c攻击my infantry (70→37HP) | ⚠️ 步兵受损，开始处于危险位置 |
| R5 / player_a | 117→87, 4/4 | Infantry(1,1)攻击player_c步兵；Heavy(2,2)→(1,2)；部署失败（炮火警告） | player_c击杀my infantry(2,0) | ❌ 损失1个infantry，仍在danger zone边缘 |
| R6 / player_a | 87→107, 4/4 | Infantry(1,1)攻击player_f步兵(56HP)；Heavy(1,2)攻击player_c heavy | player_c attack my heavy (126→98HP) | ⚠️ 攻击成功但未能击杀，heavy受损 |
| R7 / player_a | 107→127, 4/4 | 撤离warning zone；攻击player_c步兵 | player_c attack my heavy (98→70HP) | ⚠️ 被迫防守，失去进攻节奏 |
| R8 / player_a | 127→147, 4/4 | Infantry(1,1)攻击player_f步兵；部署失败（炮火区） | player_c attack my units | ❌ 无法部署，补给浪费 |
| R9 / player_a | 147→167, 4/4 | 撤离danger zone；攻击player_c步兵 | player_c heavy被炮火击杀 | ⚠️ 炮火帮助了我方，但未转化为分数 |
| R10 / player_a | 167→167, 4/4 | 撤离danger zone；攻击player_c步兵 | player_c attack my infantry (100→47HP) | ⚠️ 步兵受损严重 |
| R11 / player_a | 167→167, 4/4 | 撤离danger zone（部分成功） | 炮火击杀my infantry (25HP→死亡) | ❌ 损失第2个infantry |
| R12（裁决） | 167 | 最终状态：2个infantry存活但HP极低 | 裁决：我方230 vs 胜者792 | 差距562分 |

---

## 失误与改进

### 失误1: R1-R2未能占领supply_east，失去关键经济优势

**问题:** R1我的infantry在(2,2)，距离supply_east(3,0)仅2格，moveRange=3足够抵达。但我只移动到(2,1)，未继续推进。R2时supply_east已被player_c占领。

**改进:** R1步兵应直接移动到(3,0)占领supply_east，或R2从(2,1)→(3,0)。占领后收入+8/轮，R3-R12多获得8×10=80补给。

**预期收益:** 额外80补给可部署1个heavy（92）或在R3-R4提前部署。armyValue提升约184分，总分提升约368分。

### 失误2: 过度保守的推进策略，未能积极攻击低HP敌人

**问题:** R3-R4我多次有机会攻击低HP敌人（player_f infantry @ (0,1) 39HP, player_e infantry @ (0,0) 54HP），但因路径被阻挡或未优先攻击而错过。actionScore仅为230，远低于player_d的570和player_e的500。

**改进:** 应更积极寻找可击杀的低HP目标。每次攻击造成≥20伤害即可获得+1 action merit（ceil(20/20)=1），4 AP × 10 effectiveActions = 40分潜力。

**预期收益:** 若每回合击杀1个敌人，R3-R11共9回合可获得约9×10=90额外actionScore，总分提升180分。

### 失误3: 未能在炮火收缩前部署重单位，军力价值为0

**问题:** 炮火R5开始收缩，R7 safeRadius=4，R9 safeRadius=3，R11 safeRadius=2。我在R4-R6尝试部署但均失败（炮火区或路径阻挡）。最终军力价值为0。

**改进:** 应在R2-R3（safeRadius=6，无威胁）时部署heavy或ranger。heavy cost=92，R3时补给97足够。

**预期收益:** 1个heavy（armyValue=92×2=184）+1个infantry（armyValue=45×2=90）=274军力价值分。

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 12 | `config.balance.maxTurns` |
| 每回合行动点 | 4 | `actionsPerTurn` |
| 初始/基础收入 | 45/8 | `startingSupplies` / `baseIncome` |
| 据点效果 | forward_base: +4/轮；supply: +8/轮 | `controlPointTypes` |
| 裁决权重 | enemyHqDamage×0, ownHqHp×0, controlPoint×0, armyValue×2, supplies×0, effectiveActions×10 | HQ/CP/补给权重均为0 |
| 炮火配置 | startRound=5, intervalRounds=2, damage=25, minimumSafeRadius=2 | R5/R7/R9/R11收缩 |
| 炮火状态 | R5→safeRadius=5, R7→4, R9→3, R11→2 | 持续压缩安全区 |

---

## 数据统计

### 对各对手的交互

| 对手席位 | 歼灭：军力损失 | 击杀 | 被击杀 | 关键影响 |
|----------|----------------|------|--------|----------|
| `player_b` | 0 | 0 | 0 | 无直接交锋 |
| `player_c` |  Infantry ×2（各约40-50伤害） | 0 | Infantry ×1（R4被击杀） | 主要对手，多次交锋 |
| `player_d` | 0 | 0 | 0 | 无直接交锋 |
| `player_e` | 0 | 0 | 0 | 无直接交锋 |
| `player_f` | Infantry ×1（约35伤害） | 0 | 0 | 被我攻击但未击杀 |

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| 部署步兵 | 3个 | 3×45=135补给 |
| 部署重型兵 | 0个 | 0补给 |
| 部署侦察兵 | 0个 | 0补给 |
| 部署ranger/support | 0个 | 0补给 |
| 基础与据点收入 | — | 45初始 + 11×20 = 265总收入 |
| 最终补给 | — | 167（裁决时囤积） |

---

## 与历史对局的对比

| 项目 | 历史经验 | 本局 |
|------|--------|------|
| 人数/地图/模式/出生信息 | 6人/annihilation/artillery-zone/southeast | 6人/annihilation/artillery-zone/southeast |
| 名次与结束原因 | — | 第6名/裁决落后 |
| 关键据点控制 | CP是收入+部署基础 | ✅ 控制cp_southeast + supply_southeast |
| 歼灭：炮火承伤/击杀 | 炮火是关键威胁 | 损失2个infantry（1被敌人杀，1被炮火杀） |
| 淘汰数/被淘汰轮次 | — | 无淘汰，12轮裁决 |
| 裁决总分 | — | 230 vs 792（差562） |

**结论:** 本局验证了"annihilation模式下，armyValue和actionScore是核心得分项"的历史教训。我未能部署重单位导致armyValue=0，过度保守导致actionScore偏低。相比player_e（armyValue=146, actionScore=500），我的策略过于被动。

---

## 总结

### 失败关键因素
1. **未能占领第二个补给点** — supply_east被player_c抢先占领，失去+8/轮收入
2. **军力价值为0** — 未部署heavy/ranger，最终armyValue=0
3. **actionScore偏低** — 230分远低于胜者500分，缺乏击杀和高merit行动
4. **炮火威胁下的被动防守** — 多次被迫撤离danger zone，失去进攻节奏

### 核心战术原则
> **"annihilation模式下，前期扩张补给点+中期部署重单位是胜负关键——纯infantry战术无法竞争armyValue。"**

### 一句话总结
**本局失败的核心原因是R1-R2未能抢占supply_east，导致收入不足无法部署重单位，最终armyValue=0在裁决中完败。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| 初始出生位 | `player_a` | (0,5),(1,4),(-1,5) | 东南区spawn slots |
| cp_southeast 据点 | `player_a`控制 | (0,4) | forward_base类型，+4/轮收入 |
| supply_southeast 据点 | `player_a`控制 | (0,3) | supply类型，+8/轮收入 |
| supply_east 据点 | `player_c`控制 | (3,0) | 被我错过占领的关键补给点 |
| 炮火安全区边界 | — | safeRadius=2（最终） | R11收缩至最小半径 |
| 我方正最后存活单位 | `player_a` | (0,2) | infantry, 22HP, safe zone |

---

*文档生成时间: 2026-08-12*
*回放格式版本: 3.2.10*
*AI模型: OMP@agnes2.5flash*
