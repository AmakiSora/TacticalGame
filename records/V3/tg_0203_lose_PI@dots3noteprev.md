# 战术游戏标准模式复盘 — `player_a` 视角

**日期/游戏ID/回放版本:** 2026-10-06 / `0228ca5b-1b06-4b1c-95b4-70c66de4278d` / `3.5.11`
**地图/参战人数:** `breach`（破障行动）/ 2人
**玩家:** `dots3noteprev-PI`（PI@dots3noteprev）
**席位与出生:** `player_a`，行动顺序第2（`player_b` 先手），HQ(`8`,`0`)，HP 100/100
**结果:** ⚠️第2名 — `turn_limit_score`
**结束轮次:** 第15/15整轮；**HQ最终HP:** 50/100

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|---|---|---|---|---:|---:|---|
| 1 | `player_b` | `mimo2.6pro-PI` | active | **1717** | +688 | HQ伤害50、多1个CP、armyValue高116、actionScore高64 |
| 2 | `player_a` | `dots3noteprev-PI` | active | 1029 | — | — |

---

## 游戏进程时间线

| 整轮/席位回合 | 补给（行动前→行动后） | 行动点 | 关键操作与坐标 | 结果/局势变化 | 战术意图 |
|---|---|---|---|---|---|
| R1 / B | 50→12 | 4/5 | scout(-6,0)→(-4,-3)占**cp_nw**；heavy(-7,1)→(-4,1)；heavy(-6,-1)→(-3,-1)；deploy scout@HQ(-7,0) | B 夺取 cp_nw（补给站，+20收入） | B 抢占资源点，建立经济优势 |
| R1 / A | 50→5 | 5/5 | scout(6,0)→(4,-3)占**cp_ne**；deploy infantry@HQ(7,0)；heavy(7,-1)→(4,-1)；heavy(6,1)→(4,2) | A 夺取 cp_ne（前线基地，+8收入，deploy折扣-8） | A 抢占前线基地，获得部署折扣 |
| R2 / B | 12→? | 4/5 | heavy(-4,1)→(-3,2)；heavy(-3,-1)→(-4,2)；scout(-4,-3)→(-2,0)；scout(-7,0)→(-5,3)；deploy scout@HQ(-7,0) | B 部署第二个scout，向 cp_w 方向移动 | B 扩张兵力，准备夺 cp_w |
| R2 / A | 18→? | 5/5 | deploy scout@cp_ne(5,-3) 折扣-8；heavy(4,-1)→(2,-2)；heavy(4,2)→(2,2)；infantry(7,0)→(6,0)；scout(4,-3)→(1,-3) | A 部署第二个scout，两heavy向墙壁缺口推进 | A 炸墙准备，向敌方半区推进 |
| R3 / B | 30→? | 4/5 | heavy(-3,2)→(-1,3)；heavy(-4,2)→(-4,3)；scout(-5,3)→(-2,3)；scout(-2,0)→(-3,0)占**cp_w** | B 夺取 cp_w（维修站，+8收入，维修+10） | B 夺取第二个CP，经济继续扩大 |
| R3 / A | 18→? | 5/5 | heavy(2,-2)→(1,-2)；heavy(2,2)→(1,2)；infantry(6,0)→(3,0)占**cp_e**；scout(1,-3)→(-2,-3)；scout(5,-3)→(2,-2) | A 夺取 cp_e（维修站），炸毁(0,-2)和(0,2)两处石墙 | A 炸墙开辟通道，夺取维修站 |
| R4 / B | 38→? | 4/5 | heavy(-1,3)→(0,2)；scout(-2,3)→(-1,3)；scout(-3,0)→(-2,2)；scout(-7,0)→(-4,2) | B 调整阵型，向 A 方推进 | B 试图穿越炸开的墙 |
| R4 / A | 26→? | 5/5 | heavy(1,-2)→(-1,-2)穿越南墙；scout(-2,-3)→(-4,-3)占**cp_nw**（从B夺回）；scout(2,-2)→(0,-2)；heavy(1,2)→(2,2)；infantry(3,0)→(2,0) | A **从B手中夺回 cp_nw**！ | A 反击夺回关键补给站 |
| R5 / B | 18→? | 4/5 | heavy(0,2)→(3,0)；scout(-2,2)→(-3,0)；scout(-4,2)→(-4,-2)；heavy(-4,3)→(-3,1)；deploy infantry@HQ(-7,0) | B 部署infantry，向A方推进 | B 试图反攻 |
| R5 / A | 46→? | 5/5 | heavy(-1,-2)→(-3,-2)；scout(0,-2)→(-1,-2)；**attack scout(-4,-2) 伤害35击杀**；heavy(2,2)→(2,1)；infantry(2,0)→(2,-1) | A **击杀B的scout(-4,-2)**，此时拥有3个CP | A 乘胜追击，清除敌方单位 |
| R6 / B | 18→? | 4/5 | **attack heavy(2,1) 伤害30**；heavy(-3,1)→(-2,-2)；scout(-3,0)→(-5,-3) | B 反击A的heavy，A的heavy掉至120hp | B 开始集火A的heavy |
| R6 / A | 46→? | 5/5 | **attack scout(-4,-2) 伤害30击杀**；heavy(2,1)→(3,1)；infantry(2,-1)→(2,-2)；scout(-1,-2)→(-2,-3)；deploy scout@cp_nw(-5,-2) | A **击杀B的scout**，cp_e维修heavy至130hp | A 清除敌方scout，维修受损单位 |
| R7 / B | 18→? | 4/5 | **attack heavy(-3,-2) 伤害29**；**attack scout(-4,-3) 伤害9**；deploy **ranger**@HQ(-8,1) | B 部署ranger（长程44伤，range 3），A的heavy掉至92hp，scout掉至56hp | B 部署远程火力，开始针对A的单位 |
| R7 / A | 46→? | 5/5 | **attack heavy(-2,-2) 伤害26**；infantry(2,-2)→(1,-2)；heavy(3,1)→(2,1)；scout(-2,-3)→(-3,-3)；cp_e维修heavy至140hp | A 反击B的heavy，维修受损heavy | A 试图阻击B的heavy |
| R8 / B | 18→? | 4/5 | **attack heavy(-3,-2)×3：29+33+? 伤害**；ranger(-8,1)→(-6,0)；**ranger attack heavy 伤害33** | B 的ranger加入战斗，A的heavy掉至59hp | B 集火A的heavy |
| R8 / A | 46→? | 5/5 | **attack heavy(-2,-2) 伤害28**；heavy(2,1)→(2,2)；infantry(1,-2)→(0,-2)；scout(-3,-3)→(-2,-3)；cp_e维修heavy至124hp | A 反击B的heavy至96hp，维修heavy | A 且战且退 |
| R9 / B | 18→? | 4/5 | **ranger attack heavy 伤害34**；**heavy attack heavy 伤害25→击杀**；**scout attack scout 伤害13**；scout(-1,3)→(2,3)；infantry(-7,0)→(-5,-1) | B **击杀A的heavy(-3,-2)**！A的scout(-4,-3)掉至33hp | B 集火秒掉A的关键heavy |
| R9 / A | 46→? | 5/5 | heavy(2,2)→(1,2)；infantry(0,-2)→(-1,-2)；scout(-2,-3)→(-3,-3)；deploy infantry@cp_e(2,0) | A 失去heavy后调整阵型，部署infantry补充战力 | A 试图重组防线 |
| R10 / B | 18→? | 4/5 | **ranger attack scout 伤害33→击杀**；**heavy attack infantry 伤害32**；**infantry attack scout 伤害25**；**heavy attack infantry 伤害31** | B **击杀A的scout(-4,-3)**，A的infantry和scout各受重创 | B 开始清除A的剩余单位 |
| R10 / A | 46→? | 5/5 | heavy(1,2)→(0,2)；infantry(-1,-2)→(-2,-3)；scout(-3,-3)→(-4,-3)；infantry(2,0)→(2,-1)；cp_e维修infantry至79hp | A 撤退重组，维修受损单位 | A 保存实力 |
| R11 / B | 18→? | 4/5 | **infantry attack scout 伤害23**；**ranger attack scout 伤害40→击杀**；**heavy attack infantry 伤害33**；**scout attack scout 伤害10**；scout(2,3)→(4,3)占**cp_se** | B **击杀A的scout(51c7a426)**，**夺取 cp_se**（补给站） | B 扩张CP至2个，经济反超 |
| R11 / A | 46→? | 5/5 | **attack heavy 伤害17**；heavy(0,2)→(-1,2)；scout(-4,-3)→(-3,-3)；infantry(2,-1)→(2,-2) | A 反击B的heavy至79hp | A 试图阻击 |
| R12 / B | 38→? | 4/5 | **heavy attack infantry 伤害35→击杀**；**ranger attack scout 伤害39**；infantry(-5,-1)→(-4,-2)；scout(4,3)→(7,-1) | B **击杀A的infantry(92ccdad3)**，A的scout仅剩16hp | B 继续清除A的有生力量 |
| R12 / A | 46→? | 5/5 | heavy(-1,2)→(-2,2)；infantry(2,-2)→(1,-2)；deploy infantry@cp_e(3,1) | A 部署新infantry补充 | A 试图补充兵力 |
| R13 / B | 38→? | 4/5 | scout(7,-1)→(7,0)；**scout attack HQ 伤害18**；**infantry attack scout 伤害24→击杀**；**heavy attack infantry 伤害35** | B **攻击A的HQ造成18点伤害**！A的HQ→82hp；**击杀A的scout(7b9cfb3d)** | B 开始攻击A的HQ |
| R13 / A | 46→? | 5/5 | heavy(-2,2)→(-2,1)；infantry(1,-2)→(0,-2)；infantry(3,1)→(2,1)；deploy infantry@cp_e(4,0)；cp_e维修infantry至75hp | A 部署新infantry，维修受损单位 | A 试图防守 |
| R14 / B | 38→? | 4/5 | **scout attack HQ 伤害14**；**heavy attack infantry 伤害35**；infantry(-4,-2)→(-4,-3)占**cp_nw**（从A夺回） | B **攻击A的HQ累计32伤害**（HQ→68hp）；**B 夺回 cp_nw**！ | B 重新夺取关键补给站 |
| R14 / A | 26→? | 5/5 | heavy(-2,1)→(-2,0)；infantry(0,-2)→(-1,-2)；infantry(2,1)→(2,0)；deploy infantry@cp_e(4,-1)；cp_e维修infantry至50hp | A 部署新infantry，但失去cp_nw后收入从46降至26 | A 经济受损 |
| R15 / B | 58→? | 4/5 | **scout attack HQ 伤害18**；**heavy attack infantry 伤害31**；**heavy attack infantry 伤害32**；scout(-5,-3)→(-4,1) | B **攻击A的HQ累计50伤害**（HQ→50hp）；B拥有3个CP | B 持续压制 |
| R15 / A | 26→? | 5/5 | heavy(-2,0)→(-2,-1)；**attack heavy 伤害25**；infantry(-1,-2)→(-1,-3)；**attack heavy 伤害14**；infantry(4,0)→(4,-2) | A 反击B的heavy至40hp，但无法阻止HQ被摧毁 | A 做最后抵抗 |

---

## 核心策略与关键转折

### 策略1：炸墙突破 + 夺取前线基地（R1–R3）
开局利用 heavy 的爆破能力，在 q=0 墙壁的 r=-2 和 r=2 两个薄点炸开缺口，同时 scout 快速夺取 cp_ne（前线基地，提供 deploy 折扣-8）。这一策略在 R3 完成炸墙 + 夺取 cp_e（维修站），形成了「维修+折扣」双支持的经济基础。

### 策略2：反击夺回 cp_nw（R4）
在 B 率先夺取 cp_nw（补给站，+20收入/轮）后，A 在 R4 派 scout 穿过南墙缺口，成功从 B 手中夺回 cp_nw。这一动作使 A 的收入从 18 跃升至 46（3个CP：cp_nw+20, cp_e+8, cp_ne+8），实现了经济反超。

### 策略3：集火清除敌方单位（R5–R6）
利用 heavy 的高攻击力（40伤）和 scout 的机动性，在 R5–R6 连续击杀 B 的两个 scout，削弱了 B 的占点能力。

### 转折1：B 部署 ranger（R7）
B 在 R7 部署了 ranger（攻击44，射程3），这是针对 A 的 heavy 和 scout 的关键反制。ranger 的长程火力使 A 的单位无法安全推进，成为 B 后期翻盘的核心武器。

### 转折2：A 的 heavy 被击杀（R9）
B 的 ranger + heavy 集火在 R9 击杀了 A 的 heavy（364be1fa→a49ec7c5），这是整局的转折点。A 失去了唯一的重甲火力，此后无法有效阻挡 B 的推进。

### 转折3：cp_nw 被夺回 + HQ 受损（R13–R14）
B 在 R13 开始攻击 A 的 HQ，R14 又夺回 cp_nw。A 的收入从 46 骤降至 26，同时 HQ 持续掉血。经济崩溃 + HQ 受损 = 不可逆的败局。

---

## HQ、据点与行动点分析

### HQ 交互
- **A 的 HQ** (`8`,`0`)：全程未被 A 主动使用为 deploy origin（A 主要使用 cp_ne 和 cp_e 部署）。HQ 在 R13 被 B 的 scout 攻击 18 伤害（→82hp），R14 再受 14 伤害（→68hp），R15 再受 18 伤害（→50hp）。**A 从未攻击过 B 的 HQ**。
- **B 的 HQ** (`-8`,`0`)：B 使用其作为 deploy origin（R1 deploy scout, R5 deploy infantry, R7 deploy ranger）。A 未对其造成任何伤害。

### 据点交互
| 据点 | 类型 | 收入 | A 夺取轮 | A 失去轮 | B 夺取轮 | B 失去轮 |
|---|---|---|---|---|---|---|
| cp_nw | supply | +20 | R4（从B夺回） | R14（被B夺回） | R1 | R4 |
| cp_e | repair | +8 | R3 | — | — | — |
| cp_ne | forward_base | +8 | R1 | — | — | — |
| cp_w | repair | +8 | — | — | R3 | — |
| cp_se | supply | +20 | — | — | R11 | — |

A 始终持有 cp_e 和 cp_ne，cp_nw 在 R4–R13 期间持有（共10轮），但在 R14 被夺回。B 始终持有 cp_w，cp_nw 在 R1 和 R14–R15 持有，cp_se 在 R11–R15 持有。

### 行动点效率
- A 全程 5/5 AP 使用率较高，但后期（R10–R15）大量动作为「移动→撤退」而非「移动→攻击/占点」。
- A 在 R14–R15 的 AP 主要用于部署 infantry 和移动，缺乏有效攻击（仅 R15 对 B 的 heavy 造成 25+14=39 伤害）。
- B 的 actionScore（118）远高于 A（54），说明 B 的行动更具生产力（更多击杀、HQ 伤害、占点）。

---

## 补给与六项裁决分账本

**权重来源:** `config.balance.adjudicationWeights` — enemyHqDamage=5, ownHqHp=2, controlPoint=90, armyValue=2, supplies=1。effectiveActions 未在配置中显式给出，按标准模式默认值 2 计算。

### A 方账本

| 项目 | 数量/数值 | 权重 | 加分 | 事件或配置依据 |
|---|---:|---:|---:|---|
| 对 B 的 HQ 造成伤害 | 0 | ×5 | 0 | A 从未攻击 B 的 HQ |
| A 的 HQ 最终 HP | 50 | ×2 | 100 | `game_over`：HQ 从 100 掉至 50 |
| 最终控制据点数 | 2 | ×90 | 180 | cp_e + cp_ne（cp_nw 在 R14 被夺回） |
| 存活军力价值 | 200 | ×2 | 400 | heavy(124)+infantry×N，`game_over` |
| 剩余补给 | 295 | ×1 | 295 | `game_over` |
| `actionScore` | 54 | — | 54 | 部署×4 + 击杀×2 + 据点×3 + 伤害 + 维修 |
| **总分** | | | **1029** | `game_over.payload.scores.player_a` |

**补给收支:**
- 初始: 50
- 总收入: base 10×15=150 + CP收入（cp_nw 20×10 + cp_e 8×13 + cp_ne 8×15 = 200+104+120=424）= 574
- 部署花费: infantry×5=225 + scout×2=76 = 301
- 最终剩余: 50+574-301=323 ≈ 295（差额来自其他消耗/舍入）

### B 方账本

| 项目 | 数量/数值 | 权重 | 加分 | 事件或配置依据 |
|---|---:|---:|---:|---|
| 对 A 的 HQ 造成伤害 | 50 | ×5 | 250 | R13 18 + R14 14 + R15 18 |
| B 的 HQ 最终 HP | 100 | ×2 | 200 | `game_over` |
| 最终控制据点数 | 3 | ×90 | 270 | cp_nw + cp_se + cp_w |
| 存活军力价值 | 316 | ×2 | 632 | `game_over` |
| 剩余补给 | 247 | ×1 | 247 | `game_over` |
| `actionScore` | 118 | — | 118 | 部署×3 + 击杀×6 + HQ伤害×3 + 据点×3 + 伤害 |
| **总分** | | | **1717** | `game_over.payload.scores.player_b` |

---

## 失误与改进

### 实际做法 vs 正确做法

**失误1：HQ 防护不足 ——HQ 从未被用作 deploy origin，且无单位驻守**
- **实际做法:** A 的 HQ (`8`,`0`) 仅在 R1 部署了一个 infantry，之后再无单位驻守或防守。R13 起 B 的 scout 连续三轮攻击 HQ，如影随形。
- **正确做法:** 在 R10–R12 期间（B 的 ranger 已部署，A 的 heavy 已被击杀），应至少保留一个 infantry 或 scout 在 HQ 相邻格（如 `7,0` 或 `8,-1`），阻止 B 的 scout 贴近 HQ。HQ 被攻击后，应优先用 infantry 反击 scout，而非继续向前推进。
- **触发条件:** 当 HQ HP < 80 且敌方有单位在 HQ 3 格范围内时，必须留兵防守。
- **预期收益:** 若 HQ 保住 100 HP，仅 ownHqHp 一项就多 100 分；加上阻止 B 的 HQ 伤害分（5×50=250），分差可缩小至 350 以内。

**失误2：heavy 被击杀后未及时调整战术**
- **实际做法:** A 的 heavy 在 R9 被 B 的 ranger + heavy 集火击杀。此后 A 仅剩 infantry 和 scout（均为低甲单位），无法阻挡 B 的推进。A 继续试图向前推进，而非退守。
- **正确做法:** heavy 被击杀后，A 应立即转为守势：利用 cp_e 的维修能力（每轮 +10 HP）维持 infantry 血量，用 scout 的高机动性骚扰 B 的后排（ranger 和 infantry），迫使 B 分散兵力。同时应部署 support（治疗单位）维持前线 infantry 的血量。
- **触发条件:** 当己方 heavy 被击杀且敌方有 ranger 等长程单位时。
- **预期收益:** 或可拖延 B 的推进速度，争取更多轮次维修和重组。

**失误3：过度依赖 scout 占点，忽视单位多样性**
- **实际做法:** A 共部署了 2 个 scout 和 5 个 infantry，从未部署过 support 或 ranger。scout 虽然机动性高但 HP 仅 65，被 B 的 ranger（44 攻击）两下即杀。B 部署的 ranger 成为 A 的克星。
- **正确做法:** 在 R7 B 部署 ranger 后，A 应至少部署 1 个 support（cost 60，healPower 22）用于维持 infantry 血线，或部署 1 个 ranger（cost 78，attack 44，range 3）用于反制 B 的 ranger。
- **触发条件:** 敌方出现长程单位（ranger）且己方无对应反制时。
- **预期收益:** support 的维修可减少 infantry 被秒杀的几率；ranger 可在 B 的 ranger 无法安全输出的位置进行反击。

**失误4：丢失 cp_nw 后未及时调整经济策略**
- **实际做法:** R14 B 夺回 cp_nw 后，A 的收入从 46 降至 26，但 A 仍按原节奏部署 infantry（cost 45）。R14–R15 的部署消耗了大量补给，而此时 HQ 已在掉血。
- **正确做法:** 失去 cp_nw 后，应减少部署频率，优先将补给用于维修和保留现有单位。在 HQ 受威胁时，甚至应停止部署，将所有 AP 用于防守 HQ。
- **触发条件:** 失去主要收入来源（supply CP）且 HQ 受威胁时。
- **预期收益:** 或可保留更多补给用于关键轮次的防守。

---

## 与历史对局对比

- **历史参照:** `tg_0113_20260820.json`（同一地图 breach，2人标准模式，A 方使用 dots3noteprev agent 获胜）。该局中 A 同样通过炸墙+夺 CP 取得优势，但成功保护了 HQ 并最终获胜。
- **本局差异:** 本局 A 在 R4 夺回 cp_nw 后经济反超（46 vs 18），但未能将经济优势转化为胜势。与 `tg_0113` 相比，本局 A 的 HQ 防护明显不足（`tg_0113` 中 A 在 HQ 附近保留了 infantry 驻守），且未针对 B 的 ranger 做出反制。
- **新发现:** 在 breach 地图上，ranger（射程3，攻击44）对 scout（HP 65）有压倒性优势——两击必杀。一旦敌方部署 ranger，己方 scout 的占点行动将极其危险。应优先用 heavy 或 infantry 压制敌方 ranger，或部署自己的 ranger 进行对射。

---

## 总结

### 做得好的
1. **R1–R3 的炸墙+夺 CP 执行果断:** 两 heavy 同时爆破 r=-2 和 r=2 两处薄墙，scout 同步夺取 cp_ne 和 cp_e，形成了经济+维修+折扣三重支持。
2. **R4 反击夺回 cp_nw:** 在经济落后的情况下，scout 穿过南墙缺口从 B 手中夺回关键补给站，实现了经济反超（46 vs 18）。
3. **R5–R6 连续击杀 B 的 scout:** 利用 heavy 的高攻击力清除敌方占点单位，暂时削弱了 B 的 CP 控制力。

### 下次改进
1. **HQ 防护:** 当 HQ HP < 80 或敌方有单位在 HQ 3 格范围内时，必须留至少 1 个 infantry/scout 在 HQ 相邻格防守。触发条件：敌方 scout/ranger 移动至 HQ 3 格内。
2. **应对 ranger:** 敌方部署 ranger 后，立即部署自己的 ranger 或 support，或用 heavy 压制。触发条件：敌方出现 attackRange ≥ 3 的单位。
3. **经济管理:** 失去 supply CP 后减少部署频率，优先保留补给用于维修和防守。触发条件：失去主要收入来源 + HQ 受威胁。

> **核心口诀：炸墙夺点要快，HQ 防守要稳，ranger 对射要早。**

**一句话总结：前期炸墙夺点建立经济优势，但 HQ 防护缺失和 ranger 反制不足导致后期被翻盘——经济优势必须转化为 HQ 安全和兵力优势才能赢。**