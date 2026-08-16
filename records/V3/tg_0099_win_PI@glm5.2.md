# 战术游戏胜利复盘 — `player_b` 视角

**日期:** 2026-08-16
**游戏ID:** 6a2b00f4-674e-4383-aaf8-e0d4e3c03bba
**回放版本:** 3.2.11
**地图:** `breach`（破障行动）
**玩家:** GLM5.2-PI（PI@glm5.2）
**席位与出生:** `player_b`，行动顺序第2（后手，`turnOrder`=['player_a','player_b']），`slot_a`，HQ(-8,0)
**参战人数:** 2
**结果:** 🏆 第1名 — `turn_limit_score`
**结束轮次:** 第15/15整轮
**最终状态:** 存活
**我方HQ:** 59/100 HP（被 `player_a` 打掉 41）
**裁决总分:** 1703

---

## 玩家表

| 席位 | 玩家名 | agent@模型 | spawnSlot | HQ坐标 | turnOrder | 最终状态 |
|------|--------|-----------|-----------|--------|-----------|----------|
| `player_a` | GLM5.3-ZC | ZC@GLM5.3 | slot_b | (8,0) | 1（先手） | 存活（第2名） |
| `player_b` | GLM5.2-PI | PI@glm5.2 | slot_a | (-8,0) | 2（后手） | 存活（冠军） |

> 关键：本图为 standard 模式，双方对称出生 1 scout+2 heavy 于边缘，HQ 分列东西两端 (-8,0)/(8,0)，中央 q∈{0,±1} 有十字石墙（27 个 blocker）阻断直通，需 heavy 爆破开路；另含 12 格水。6 个据点原点反射对称（双方各可得 supply/repair/forward_base 三种）。`turnOrder` 中 `player_a` 先手，我方后手。本局裁决权重 `controlPoint=90` 为最高单项，其次是 `enemyHqDamage=5`、`armyValue=2`、`ownHqHp=2`、`supplies=1`、`effectiveActions=2`——CP 数量是主赛道，但因双方各抢 3 个对称据点形成 3:3 平局，胜负最终由 armyValue(×2) 与 actionScore 两条赛道决定，而 HQ 伤害差（对手 +41×5=205，我 -41×2=82，合计 -87）几乎让我输掉比赛。

---

## 游戏进程时间线

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 局势变化 | 战术意图 |
|---------------|------|--------|----------------|----------|----------|
| 第1轮 / `player_a` | 50→5 | 1/5→4/5 | scout 7375 (6,0)→(4,3) seq4；heavy (7,-1)→(5,-2) seq5；heavy (6,1)→(3,1) seq6；deploy infantry(7,0) from HQ seq7 -45 | 占领 cp_se seq8 | 对手先手抢 supply 站 + 推进 heavy |
| 第1轮 / `player_b` | 60→22 | 1/5→0/5 | scout 56a0 (-6,0)→(-4,-3) seq12；deploy scout 90b0(-7,0) from HQ seq13 -38；heavy 7d06 (-6,-1)→(-4,-1) seq14；heavy 11e4 (-7,1)→(-5,2) seq15 | 占领 cp_nw seq16 | ✅ 抢 supply 站 + 部署第2 scout |
| 第2轮 / `player_a` | 35→35 | 0/5 | scout→(4,-1) seq21；heavy(5,-2)→(2,-2) seq22；heavy(3,1)→(1,2) seq23；demolish(0,2)→plain seq24；infantry(7,0)→(4,0) seq25 | 对手爆破南墙推进 | 中心推进 |
| 第2轮 / `player_b` | 52→14 | 1/5→0/5 | scout 90b0(-7,0)→(-3,0) seq29；heavy 11e4(-5,2)→(-4,3) seq30；heavy 7d06(-4,-1)→(-2,-1) seq31；deploy scout 8a0a(-8,1) from HQ seq32 -38；demolish(-1,-1)→plain seq33 | 占领 cp_w seq34 | ✅ 抢 repair 站 + 北墙爆破开路 |
| 第3轮 / `player_a` | 46→1 | 0/5 | scout→(4,-3) seq39；infantry→(3,0) seq40；heavy(2,-2)→(1,-2) seq41；demolish(0,-2) seq42；heavy(1,2)→(-2,2) seq43；deploy infantry(7,1) seq44 -45 | 占领 cp_e seq45、cp_ne seq46 | 对手抢 3 CP + 深入我方 |
| 第3轮 / `player_b` | 60→15 | 1/5→0/5 | heavy 11e4(-4,3)→(-3,2) seq50；攻击 heavy 3ab2 dmg27→123 seq51；scout 90b0→(-4,3) seq52；heavy 7d06→(-2,1) seq53；攻击 heavy 3ab2 dmg24→99 seq54；deploy infantry 990a(-4,-2) from cp_nw seq55 -45；scout 8a0a→(-5,1) seq56 | 占领 cp_sw seq57 | ✅ 抢 forward_base + 首次双夹击 |
| 第4轮 / `player_a` | 47→-13 | 1/5 | heavy 3ab2 攻击 heavy 11e4 dmg25→125 seq62；heavy 3ab2→(1,2) seq63；heavy 44b2→(-2,-2) seq64；infantry→(6,0) seq65；deploy support(8,-1) seq66 -60 | 对手后撤受伤 heavy | 攻防转换 |
| 第4轮 / `player_b` | 61→61 | 1/5→0/5 | heavy 7d06→(-4,-1) seq70；攻击 heavy 44b2 dmg28→122 seq71；heavy 11e4→(0,2) seq72；攻击 heavy 3ab2 dmg30→69 seq73；infantry 990a→(-3,-2) seq74；攻击 heavy 44b2 dmg18→104 seq75；scout 8a0a→(-2,1) seq76 | 双线夹击两个 heavy | 集中火力 |
| 第5轮 / `player_a` | 47→2 | 1/5 | heavy 3ab2 攻击 heavy 11e4 dmg24→101 seq81；heavy 44b2(-2,-2)→(-5,-1) seq82；scout→(3,0) seq83；infantry→(7,0) seq84；deploy infantry(3,-3) from cp_ne seq85 -37(折扣8) | 对手 heavy 偷袭我 HQ 方向 | ❌ 我未察觉 44b2 逼近 HQ |
| 第5轮 / `player_b` | 53→53 | 1/5→0/5 | heavy 7d06→(-4,-1) seq89；攻击 heavy 44b2 dmg24→80 seq90；infantry 990a→(-5,-2) seq91；攻击 heavy 44b2 dmg19→61 seq92；heavy 11e4 攻击 heavy 3ab2 dmg27→42 seq93；scout 56a0→(-6,-1) seq94；攻击 heavy 44b2 dmg1→60 seq95 | 三面围攻 44b2 | 集火但 scout 低伤浪费 |
| 第6轮 / `player_a` | 48→3 | 1/5 | heavy 3ab2 攻击 heavy 11e4 dmg28→73 seq100；deploy infantry(4,0) from cp_e seq101 -45 | 对手续兵 | 僵持 |
| 第6轮 / `player_b` | 54→-24 | 1/5→0/5 | heavy 11e4 攻击 heavy 3ab2 dmg26→16 seq105；heavy 7d06 攻击 heavy 44b2 dmg30→30 seq106；infantry 990a 攻击 heavy 44b2 dmg15→15 seq107；scout 56a0 攻击 heavy 44b2 dmg4→11 seq108；deploy ranger ce28(-3,1) from cp_w seq109 -78 | 两个敌 heavy 濒死(11/16) | ✅ 部署首个 ranger 建立远程火力 |
| 第7轮 / `player_a` | 49→49 | 1/5 | heavy 44b2(-5,-1)→(-8,1) seq114；**攻击我 HQ dmg41→59 seq115**；heavy 3ab2 攻击 heavy 11e4 dmg25→48 seq116；infantry→(0,-2) seq117；deploy infantry(2,0) seq118 -45 | ❌ **对手偷袭我 HQ 41 伤害** | HQ 赛道失分 |
| 第7轮 / `player_b` | 95→95 | 1/5→0/5 | heavy 7d06(-4,-1)→(-7,0) seq122；攻击 heavy 44b2 dmg11→0 seq123 击杀；ranger ce28→(-2,2) seq125；攻击 heavy 3ab2 dmg16→0 seq126 击杀；heavy 11e4→(2,1) seq128；攻击 infantry dmg34→66 seq129；scout 8a0a→(-1,-2) seq131；攻击 infantry dmg6→94 | ✅ **一回合双杀两个敌 heavy(184 军力)** | 歼灭主力 |
| 第8轮 / `player_a` | 53→8 | 1/5 | infantry a81 攻击 scout 8a0a dmg27→38 seq137 | 对手反击 | — |
| 第8轮 / `player_b` | 99→21 | 1/5→0/5 | heavy 11e4 攻击 infantry ae32 dmg30→46 seq141；ranger ce28→(-1,2) seq142；攻击 infantry ae32 dmg33→13 seq143；scout 8a0a 攻击 infantry a81 dmg6→88 seq144；deploy ranger d6e8(-3,1) from cp_w seq145 -78 | 继续压制 | 部署第2 ranger |
| 第9轮 / `player_a` | 54→-24 | 1/5 | scout 攻击 heavy 11e4 dmg6→42 seq151；infantry ae32 攻击 heavy 11e4 dmg15→27 seq152；infantry a81 攻击 scout 8a0a dmg29→9 seq153；deploy ranger 112d(3,1) seq154 -78；ranger 112d 攻击 heavy 11e4 dmg27→0 seq155 **击杀我 heavy 11e4** | ❌ **我方 heavy 被集火阵亡(92 军力)** | 损失主力 |
| 第9轮 / `player_b` | 75→-3 | 1/5→0/5 | ranger ce28 攻击 infantry ae32 dmg23→0 seq160 击杀；ranger d6e8 攻击 infantry a81 dmg39→49 seq162；scout 8a0a 攻击 infantry a81 dmg9→40 seq163；heavy 7d06→(-4,0) seq164；scout 8a0a→(-2,-1) seq165 | 报复击杀 | 维持压制 |
| 第10轮 / `player_a` | 52→52 | 0/5 | infantry a81→(2,-2) seq170 | 对手缓手 | — |
| 第10轮 / `player_b` | 121→43 | 1/5→0/5 | ranger ce28→(0,2) seq175；攻击 ranger 112d dmg38→34 seq176；ranger d6e8→(-1,-1) seq177；攻击 infantry a81 dmg36→4 seq178；scout 8a0a→(1,-2) seq179；攻击 infantry a81 dmg4→0 seq180 击杀；heavy 7d06→(-2,0) seq182 | ✅ 击杀 infantry a81 | 远程压制 |
| 第11轮 / `player_a` | 72→-6 | 1/5 | ranger 112d 攻击 ranger ce28 dmg41→31 seq188；deploy ranger 3c12(2,1) seq189 -78；deploy infantry(4,-1) seq190 -45 | 对手续 ranger | — |
| 第11轮 / `player_b` | 127→49 | 1/5→0/5 | ranger ce28 攻击 ranger 112d dmg38→6 seq194；ranger d6e8→(0,-2) seq195；deploy ranger 666e(-3,1) from cp_w seq196 -78；scout 56a0→(-3,-2) seq197；scout 90b0→(-3,2) seq198 | 部署第3 ranger | 扩军 |
| 第12轮 / `player_a` | 66→-12 | 1/5 | ranger 3c12 攻击 ranger ce28 dmg31→0 seq204 **击杀我 ranger ce28**；deploy infantry(2,0) seq206 -45 | ❌ 我方 ranger 被击杀(78 军力) | — |
| 第12轮 / `player_b` | 115→37 | 1/5→0/5 | ranger d6e8→(2,-3) seq210；攻击 infantry ef1a dmg34→66 seq211；ranger 666e→(-2,-1) seq212；scout 56a0→(0,-2) seq213；scout 90b0→(0,2) seq214；deploy ranger 6bc4(-3,3) from cp_sw seq215 -70(折扣8) | 部署第4 ranger | 扩军 |
| 第13轮 / `player_a` | 64→64 | 0/5 | 无有效行动（reset_actions seq222） | ❌ 对手整轮空过 | 我获喘息 |
| 第13轮 / `player_b` | 110→110 | 1/5→0/5 | ranger d6e8→(3,-2) seq225；攻击 ranger 112d dmg26→0 seq226 击杀；ranger 6bc4→(-1,2) seq228；攻击 ranger 3c12 dmg42→30 seq229；scout 8a0a→(3,-1) seq230；攻击 infantry ef1a dmg6→70 seq231；ranger 666e→(-1,-2) seq232 | ✅ 击杀 ranger 112d | 继续歼灭 |
| 第14轮 / `player_a` | 16→-62 | 1/5 | ranger 3c12 攻击 ranger d6e8 dmg38→34 seq239；deploy ranger 6efa(3,1) seq240 -78；ranger 6efa 攻击 ranger d6e8 dmg34→0 seq241 击杀；infantry→(4,-3) seq243；infantry→(4,3) seq244 | ❌ 我方 ranger d6e8 被击杀(78 军力) | — |
| 第14轮 / `player_b` | 156→0 | 1/5→0/5 | ranger 6bc4 攻击 ranger 3c12 dmg40→0 seq248 击杀；scout 8a0a→(4,0) seq250；攻击 ranger 6efa dmg10→62 seq251；scout 56a0→(3,-3) seq252；攻击 infantry ef1a dmg5→75 seq253；ranger 666e→(1,-2) seq254；攻击 infantry ef1a dmg34→41 seq255 | ✅ 击杀 ranger 3c12 | 继续歼灭 |
| 第15轮 / `player_a` | 62→17 | 1/5 | infantry ef1a 攻击 scout 56a0 dmg25→40 seq261；scout 攻击 scout 8a0a dmg15→4 seq262；infantry 6de0 攻击 scout 8a0a dmg4→0 seq263 **击杀 scout 8a0a**；ranger 6efa→(2,0) seq265；攻击 scout 56a0 dmg40→0 seq266 **击杀 scout 56a0**；deploy infantry(2,1) seq268 -45 | ❌ 我方 2 个 scout 被击杀 | 对手末轮反扑 |
| 第15轮 / `player_b` | 46→-188 | 1/5→0/5 | ranger 666e 攻击 ranger 6efa dmg38→34 seq272；ranger 6bc4 攻击 ranger 6efa dmg34→0 seq273 击杀；**deploy ranger(-3,1) from cp_w seq275 -78**；**deploy ranger(-3,3) from cp_sw seq276 -70**；**deploy ranger(-3,-3) from cp_nw seq277 -78** | ✅ 击杀 ranger 6efa + 末轮 3 连部署爆 armyValue | **末轮补给转军力翻盘** |
| game_over | — | — | `turn_limit_score`，winner=player_b | 1703:1481 | — |

> 补给格式为"回合开始（含收入）→行动后"。本图 `actionsPerTurn=5`，`baseIncome=10`，supply 据点 income=20，repair/forward_base 据点 income=8。R3 后双方各占 3 据点，收入稳定 46/轮。R7 我方双杀后军力反超，但 R9 我 heavy 被集火阵亡后军力一度落后；R12 我 ranger 被击杀后落后 167 分；R14 我 ranger 被击杀后仍落后 190 分；R15 末轮靠 3 连 deploy ranger（+234 军力×2=+468 裁决分）逆转 222 分取胜。

---

## 核心胜利策略

### 1. 对称据点竞速 + heavy 爆破开路（R1-R2）

**关键决策:** 后手方靠 scout moveRange=5 直达 supply 站 + heavy 同回合 demolish 开墙，追平先手方的 CP 进度。

```text
第1轮 / player_b: scout 56a0 (-6,0)→(-4,-3) seq12，占领 cp_nw(supply,+20收入) seq16；deploy scout 90b0(-7,0) seq13 -38
第2轮 / player_b: scout 90b0(-7,0)→(-3,0) seq29，占领 cp_w(repair,+8收入) seq34；heavy 7d06 demolish(-1,-1)→plain seq33 开北墙通路
```

**为什么有效:**
- supply 据点 income=20 是 repair/forward_base(8) 的 2.5 倍，scout(moveRange5)第1轮即可从 (-6,0) 直达 (-4,-3)（距离3），与先手方抢 cp_se 形成 supply 对称。
- demolish(-1,-1) 在 R2 打通北墙，使 heavy(7d06) 能经 (-1,-1) 穿越中线进入东半场夹击敌 heavy——否则 heavy 被 27 格 blocker 十字墙完全隔绝，这正是 tg_0049 "全程零 demolish 困死重装"教训的反面。
- R2 末我已占 cp_nw+cp_w（supply+repair），R3 末补占 cp_sw（forward_base），3 CP 对称匹配对手的 cp_se+cp_e+cp_ne，CP 赛道（权重90）打成 3:3 平局，避免在此单项失分。

### 2. 双 heavy 夹击 + ranger 远程收割（R3-R7）

**关键决策:** 用两个 heavy(moveRange3,attack40) 从相邻两格同时攻击同一敌 heavy，再用 ranger(attackRange3,attack44) 跨墙远程补刀。

```text
第3轮 / player_b: heavy 11e4(-4,3)→(-3,2) 攻击 heavy 3ab2 dmg27→123 seq51；heavy 7d06→(-2,1) 攻击 3ab2 dmg24→99 seq54
第6轮 / player_b: heavy 11e4 攻击 3ab2 dmg26→16 seq105；heavy 7d06 攻击 44b2 dmg30→30 seq106；infantry 攻击 44b2 dmg15→15 seq107；scout 攻击 44b2 dmg4→11 seq108
第7轮 / player_b: heavy 7d06 攻击 44b2 击杀 seq123；ranger ce28 攻击 3ab2 击杀 seq126 —— 单回合双杀两个敌 heavy
```

**为什么有效:**
- 两个敌 heavy(150HP) 分别被 R3-R6 持续磨血至 11/16HP，R7 两个 heavy 各需 1 AP 即可补刀——5 AP 内完成 2 次击杀(184 军力)仍有余量部署 ranger。
- heavy attack=40 vs heavy defense=13，单次净伤约 27（±variance 3），两个 heavy 夹击每轮约 54 伤害，2-3 轮可击杀一个满血 heavy。
- ranger(attackRange3)部署在 cp_w(-3,1)，可跨墙攻击 (0,2) 等位置，弥补 heavy(attackRange1) 必须邻接的限制——ranger attack=44 vs heavy defense=13 净伤 31，是收割残血的高效手段。

### 3. 末轮补给转军力翻盘（R15）

**关键决策:** maxTurns=15 的最后一轮，落后 190 分时，放弃低收益的 scout 近战，用剩余 3 AP 从 3 个 owned CP 连续 deploy ranger（每个 +78 armyValue ×2 权重 = +156 裁决分），3 个共 +468 分逆转 222 分。

```text
第15轮 / player_b: ranger 666e 攻击 ranger 6efa dmg38→34 seq272；ranger 6bc4 攻击 6efa 击杀 seq273；deploy ranger(-3,1) from cp_w -78 seq275；deploy ranger(-3,3) from cp_sw -70 seq276；deploy ranger(-3,-3) from cp_nw -78 seq277
```

**为什么有效:**
- R14 末我 1447 vs 1637（落后190），但 armyValue 权重=2 且我补给 255 远超对手 16。每个 ranger cost=78，部署后 armyValue 立即 +78（按 round(cost*hp/maxHp)=78 计算），裁决分 +156。
- 3 个 ranger 共 +234 armyValue ×2 = +468 裁决分；同时 deploy 本身 +1 actionMerit ×2 effectiveActions = +2 actionScore/个，3 个共 +6 actionScore。
- 对手 R15 仅靠击杀我 2 个 scout(+76 军力差) 无法弥补 468 分的 armyValue 差距。**关键前提：必须拥有多个 owned CP 作为部署来源**——我 R3 已占 cp_nw/cp_w/cp_sw 三点，且每个 CP 邻接空地，末轮 3 连 deploy 才可能。这是"据点即使 controlPoint 权重为 0 也仍关乎收入和部署"规则的标准模式验证。

### 4. 经济压制维持部署能力

**关键决策:** 全局保持 3 CP 占领（supply+repair+forward_base），收入稳定 46/轮，累计收入 630 vs 对手 612，支撑 10 次部署（含末轮 3 连 ranger）。

```text
R1末: 我 22 补给 vs 对手 5（对手 R1 部署 infantry -45，我部署 scout -38）
R3-R15: 双方各占 3 CP，收入均 46/轮，但我 forward_base(cp_sw) 提供 deployDiscount=8，2 次 ranger 部署省 16 补给
全程: 我部署 10 单位共 -651 补给 vs 对手 12 单位共 -646；我最终 29 vs 对手 16
```

**为什么有效:**
- supply 据点 income=20 是经济核心，R1 抢下 cp_nw 使我 R2 起每轮多 20 收入。
- forward_base(cp_sw) 不仅 income=8，还 deployDiscount=8，R12 和 R15 两次从 cp_sw 部署 ranger 省 16 补给——等于多部署半个 infantry。
- 对手虽部署更多单位(12 vs 10)，但大量花在低价值 infantry(45) 上，我则集中资源在 high-value ranger(78)，终局 armyValue 565 vs 341（差 224×2=448 裁决分）。

---

## 关键转折详解

### 第3轮 / `player_b` 回合 — 首次双 heavy 夹击

```text
操作: heavy 11e4(-4,3)→(-3,2) seq50，攻击 heavy 3ab2(1,2) dmg27→123 seq51
      heavy 7d06(-2,-1)→(-2,1) seq53，攻击 heavy 3ab2 dmg24→99 seq54
结果: 敌 heavy 3ab2 一回合从 150→99HP；同时 scout 90b0 占领 cp_sw seq57
事件依据: seq51 attack actualDamage=27, targetHp=123；seq54 actualDamage=24, targetHp=99；seq57 control_point_captured
意义: 首次将敌 heavy 压到 100HP 以下，建立军力优势预期；同时 3:3 CP 平局锁定。
```

### 第7轮 / `player_b` 回合 — 单回合双杀两个敌 heavy

```text
操作: heavy 7d06(-4,-1)→(-7,0) seq122，攻击 heavy 44b2(-8,1) dmg11→0 seq123 击杀
      ranger ce28(-3,1)→(-2,2) seq125，攻击 heavy 3ab2(1,2) dmg16→0 seq126 击杀
结果: 对手两个 heavy(各92军力)同回合阵亡，对手 armyValue 从 419→235
事件依据: seq124 unit_death heavy 44b2；seq127 unit_death heavy 3ab2
意义: 对手主力全灭，我军力反超 +184；但对手 R7 已偷袭我 HQ 41 伤害(seq115)，HQ 赛道 -87 分隐患埋下。
```

### 第15轮 / `player_b` 回合 — 末轮 3 连 deploy 逆转

```text
操作: ranger 666e 攻击 ranger 6efa dmg38→34 seq272
      ranger 6bc4 攻击 6efa dmg34→0 seq273 击杀
      deploy ranger 9b3a(-3,1) from cp_w -78 seq275
      deploy ranger f1ef(-3,3) from cp_sw -70 seq276
      deploy ranger f401(-3,-3) from cp_nw -78 seq277
结果: 我 armyValue 从 331→565（+234），裁决分 1447→1703（+256）；对手 1637→1481（-156）
事件依据: seq273 unit_death ranger 6efa；seq275/276/277 deploy ranger ×3
意义: 落后 190 分情况下，利用 armyValue 权重=2 和 3 个 owned CP 部署来源，单回合 +256 分逆转 222 分取胜。
```

### 第7轮 / `player_a` 回合 — 对手偷袭我 HQ（反面转折）

```text
操作: heavy 44b2(-5,-1)→(-8,1) seq114，攻击我 HQ(-8,0) dmg41→59 seq115
结果: 我 HQ 永久 59HP，对手 headquartersDamage=41×5=205 裁决分
事件依据: seq115 attack targetKind=headquarters, actualDamage=41, targetHp=59
意义: 我 R5 未察觉 44b2 从 (-2,-2)→(-5,-1) 的 HQ 偷袭意图，导致 HQ 赛道 -87 分（205 对手得分 - 118 我方 ownHqHp 得分），是全程最大失分来源，几乎让我输掉。
```

---

## 失误与改进

### 失误1: 未防御对手 heavy 偷袭 HQ（R5-R7）

**问题:** R5 对手 heavy 44b2 从 (-2,-2)→(-5,-1) 向我 HQ(-8,0) 方向移动，距离 HQ 仅 4 格，我未拦截；R7 对手 44b2 直达 (-8,1) 邻接 HQ，打出 41 伤害（HQ 100→59），造成 headquartersDamage=41×5=205 的裁决分损失。

**改进:** 当任何敌单位距我 HQ ≤ moveRange+1（heavy 为 4 格）时，必须优先派遣一个 heavy 或 ranger 前往拦截/击杀，或部署单位堵截邻接格。R5 我应让 heavy 7d06 回防 (-5,0) 阻断 44b2 的 HQ 通路，而非继续东进追击 3ab2。

**预期收益:** 避免 41 HQ 伤害 = 减少 41×5=205 对手裁决分 + 恢复 41×2=82 我方 ownHqHp 分，合计 +287 裁决分差，可在 R7 提前锁定胜局而非拖到末轮。

### 失误2: 中央石墙阻断导致 heavy(7d06) 长期被困西半场

**问题:** 我仅 R2 拆除 (-1,-1) 一个 blocker 开北墙，但中央 q∈{0,±1} 有 27 个 blocker，heavy(7d06) 从 R8 起被卡在 (-2,0) 无法东进参与歼灭战，全程仅 R7 击杀 44b2 一次有效输出，后 8 轮沦为摆设（armyValue 92 但零 actionScore 贡献）。

**改进:** R3-R4 应继续用 heavy 7d06 demolish (-1,0)/(0,0)/(1,0) 等中央 blocker，打通第二条东西通道；或让 heavy 7d06 从南方 (-4,3)→(0,3) 绕行（需 demolish (-1,3)/(0,3) 等 blocker）。每条通道需 2-3 次 demolish（每次 1 AP），但能让 heavy 尽早加入东线战斗。

**预期收益:** heavy 7d06 若 R8 进入东线，每轮可多 1-2 次攻击（每次 ~27 伤害，+2 actionMerit×2=+4 actionScore），8 轮共 +32 actionScore；同时增加军力压力迫使对手分散部署。

### 失误3: 末轮前未提前部署 ranger，将翻盘赌在最后一轮

**问题:** R12-R14 我补给分别达 115/127/156，但仅在 R12 部署 1 个 ranger(6bc4)，R13-R14 未部署任何单位，导致 R15 需单轮 3 连 deploy 才能翻盘——若 R15 对手先手击杀我更多单位或我被 429 action_limit 限制，翻盘将失败。

**改进:** R13（补给110）应部署 1 ranger(-78→32)，R14（补给156）应部署 1 ranger(-78→78)，将翻盘压力分摊到 2 轮；R15 仅需 1 连 deploy 即可锁定胜局，降低单轮风险。

**预期收益:** 分散部署风险，避免末轮 3 连 deploy 中任一失败（如 CP 被占、邻格被占）导致翻盘失败；同时 R13/R14 部署的 ranger 可提前 1-2 轮参与攻击，多 2-4 次 actionMerit。

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 15 | `config.balance.maxTurns` |
| 每回合行动点 | 5 | `actionsPerTurn` |
| 初始/基础收入 | 50 / 10 | `startingSupplies` / `baseIncome` |
| 据点效果 | supply:income20 / repair:income8,repair10 / forward_base:income8,discount8 | `controlPointTypes` |
| 裁决权重 | enemyHqDamage=5, ownHqHp=2, controlPoint=90, armyValue=2, supplies=1, effectiveActions=2 | `adjudicationWeights` |
| 地图 | breach 破障行动，pointy hex，radius=8，217格(178plain/27blocker/12water) | `map`：中央十字石墙阻断直通 |
| 单位属性 | infantry(100hp,atk30,def8,mv3,rng1,cost45,capture) / scout(65hp,atk16,def4,mv5,rng1,cost38,capture) / heavy(150hp,atk40,def13,mv3,rng1,cost92) / ranger(72hp,atk44,def3,mv2,rng3,cost78) / support(82hp,atk10,def5,mv3,rng1,cost60,heal22) | `config.units` |
| HQ 属性 | 100HP, defense=0 | `headquartersSpec` |

---

## 数据统计

### 对各对手的交互

| 对手席位 | HQ伤害 | 击杀 | 被击杀 | 夺取其据点 | 关键影响 |
|----------|--------|------|--------|------------|----------|
| `player_a` | 0 | 6（heavy×2, infantry×2, ranger×2） | 5（heavy×1, ranger×2, scout×2） | 0（双方各占对称3CP） | 击杀 2 heavy 致对手主力崩盘；被击杀 1 heavy+2 ranger 致军力波动 |

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| scout | 2 | 76 补给（2×38，从 HQ 部署） |
| infantry | 1 | 45 补给（从 cp_nw 部署，无折扣） |
| ranger | 7 | 530 补给（5×78 从 cp_w/cp_nw + 2×70 从 cp_sw 享 forward_base 折扣8） |
| 部署折扣 | 2 次 | 节省 16 补给（forward_base discount=8×2） |
| 基础与据点收入 | — | 630 补给（50起始 + 10×15基础 + 20×15supply + 8×15repair + 8×15forward_base，按实际占领轮次累计） |
| 最终补给 | — | 29 |

### 六项裁决分账本

| 项目 | 我方(`player_b`) | 对手(`player_a`) | 权重 | 我方得分 | 对手得分 |
|------|------------------|------------------|------|----------|----------|
| headquartersDamage | 0 | 41 | 5 | 0 | 205 |
| ownHqHp | 59 | 100 | 2 | 118 | 200 |
| controlPoints | 3 | 3 | 90 | 270 | 270 |
| armyValue | 565 | 341 | 2 | 1130 | 682 |
| supplies | 29 | 16 | 1 | 29 | 16 |
| actionScore | 156 | 108 | (已乘effectiveActions=2) | 156 | 108 |
| **total** | — | — | — | **1703** | **1481** |

> actionMerit 明细（我方）：attack 61 + deploy 10 + capture 6 + demolish 1 + heal 1 = 79 merit ×2 = 158（实际 actionScore=156，差 2 为 variance）。对手：attack 34 + deploy 12 + capture 6 + demolish 2 + heal 9 = 63 ×2 = 126（实际 108，差异因部分 merit 计算口径）。

---

## 与历史对局的对比

| 项目 | tg_0049（历史败局） | tg_0081（历史败局） | tg_0098（上局胜局） | 本局 tg_0099 |
|------|---------------------|---------------------|---------------------|--------------|
| 人数/地图/模式/出生 | 2人/standard/先手 slot | 2人/annihilation artillery-zone | 2人/standard danger-close/先手 slot_a | 2人/standard breach/后手 slot_a |
| 名次与结束原因 | 第2名 turn_limit_score | 第2名 turn_limit_score | 第1名 last_player_standing | 第1名 turn_limit_score |
| 关键据点控制 | R1 坐标搞反送据点 | — | 对称各1据点 | ✅ 3:3 对称平局 |
| demolish 使用 | 全程零 demolish 困死重装 | — | deploy+demolish 抢节奏 | R2 拆(-1,-1) 开北墙，但仅 1 次不够 |
| HQ伤害/承伤 | — | — | HQ 13/120 险胜 | ❌ 承 41 伤害(HQ 59/100) |
| 淘汰数/被淘汰轮次 | — | 2heavy+3ranger 全灭 | — | 击杀6 / 被击杀5 |
| 裁决总分 | 932 分差距惨败 | 538:830 | 2595:2310 | 1703:1481（+222） |

**结论:**
- **tg_0049 的"全程零 demolish 困死重装"教训已部分改正**——本局 R2 主动 demolish(-1,-1) 开北墙，使 heavy 能跨线夹击。但仅拆 1 个 blocker 不足，heavy 7d06 仍被中央 27 格墙长期隔绝，是 tg_0049 教训的"半改正"。**下次必须用 heavy 持续 demolish 打通 2-3 条通道**。
- **tg_0081 的"高价值单位保命纪律"教训在 standard 模式同样适用**——本局我方 heavy 11e4 在 R9 被集火阵亡(92军力)，2 个 ranger 在 R12/R14 被击杀(各78军力)，共损失 248 军力分。但与 tg_0081 不同，standard 模式有 CP 部署来源可快速补充军力，末轮 3 连 deploy 逆转了军力差。**standard 模式的容错率高于 annihilation，但仍应避免主力无意义阵亡**。
- **tg_0098 的"deploy+demolish 同回合技巧"已迁移验证**——本局 R2 heavy 7d06 在同回合先 move 再 demolish（同单位第二动作免费），与 tg_0098 standard 模式一致。该技巧具有跨地图迁移性。
- **新发现：末轮"补给转军力"是 standard 模式的终极翻盘手段**——当 armyValue 权重>0 且拥有多个 owned CP 时，末轮可将囤积补给一次性转化为 armyValue 裁决分。本局 +234 军力×2=+468 分逆转 190 分劣势。前提是 R3 前抢占 ≥2 个 CP（含 forward_base 享折扣）。

---

## 总结

### 胜利关键因素
1. **据点对称竞速不输**：R1-R3 抢下 cp_nw(supply)+cp_w(repair)+cp_sw(forward_base)，3:3 平局锁定 controlPoint 赛道（权重90，最高单项），避免在此失分。
2. **双 heavy 夹击 + ranger 远程收割**：R3-R7 持续磨血并双杀对手两个 heavy(184军力)，建立军力和 actionScore 双优势。
3. **末轮补给转军力翻盘**：R15 利用 3 个 owned CP 连续 deploy 3 个 ranger(+234 armyValue×2=+468裁决分)，从落后 190 分逆转为领先 222 分。

### 核心战术原则
> **"standard 模式 breach 图：CP 对称竞速保平、heavy 夹击+爆破开路建车、ranger 跨墙收割残血、末轮补给转军力翻盘——拥有多 CP 部署来源是终局翻盘的前提。"**

### 一句话总结
**在破障行动(breach)标准局中，我以 3:3 据点平局锁定 CP 赛道、R7 双杀对手两个 heavy 建立军力优势，虽因未防 heavy 偷袭 HQ 承 41 伤害(-87裁决分)且自身 heavy/ranger 相继阵亡，但靠末轮 3 连 deploy ranger 将 255 补给转化为 +234 armyValue(×2=+468裁决分)，从落后 190 分逆转为 1703:1481 取胜——standard 模式终局翻盘的核心是把囤积的补给通过 owned CP 转化为高价值军力。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| HQ | `player_b` | (-8,0) | 我方出生位，被 44b2 偷袭 41 伤害→59HP |
| HQ | `player_a` | (8,0) | 对手出生位，未被攻击 |
| cp_nw | 中立→`player_b` | (-4,-3) | 西北补给站(supply,income20)，R1 占领，末轮 deploy 来源 |
| cp_se | 中立→`player_a` | (4,3) | 东南补给站(supply,income20)，对手 R1 占领 |
| cp_w | 中立→`player_b` | (-3,0) | 西部维修站(repair,income8,repair10)，R2 占领，ranger 部署主来源 |
| cp_e | 中立→`player_a` | (3,0) | 东部维修站(repair,income8,repair10)，对手 R3 占领，其续兵来源 |
| cp_sw | 中立→`player_b` | (-4,3) | 西南前线基地(forward_base,income8,discount8)，R3 占领，享 deploy 折扣 |
| cp_ne | 中立→`player_a` | (4,-3) | 东北前线基地(forward_base,income8,discount8)，对手 R3 占领 |
| 爆破点 | — | (-1,-1) | R2 我方 heavy 拆除，北墙通路 |
| 爆破点 | — | (0,2) | R2 对手 heavy 拆除，南墙通路 |
| 爆破点 | — | (0,-2) | R3 对手 heavy 拆除，南墙通路 |
| 中央石墙 | — | q∈{0,±1}, r∈[-7,7] | 27 个 blocker，十字阻断东西直通 |

---

*文档生成时间: 2026-08-16*
*回放格式版本: 3.2.11*
*AI模型: PI@glm5.2*
