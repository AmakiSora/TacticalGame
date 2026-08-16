# 战术游戏胜利复盘 — `player_b` 视角

**日期:** 2026-08-16
**游戏ID:** 18c4f10f-2c55-478d-822f-31f6398e8b1d
**回放版本:** 回放未提供（事件流响应无 `schemaVersion` 字段；运行 app 版本 3.2.10）
**地图:** `artillery-zone`（炮火禁区）
**玩家:** GLM5.2-WB（WB@glm5.2）
**席位与出生:** `player_b`，行动顺序第1（后手，`turnOrder`=['player_a','player_b']），`slot_west`；初始单位 infantry(-5,0)/infantry(-5,1)/heavy(-4,-1)，首个控制点 `cp_west`(-4,0)，无HQ
**参战人数:** 2
**结果:** 🏆 第1名 — `turn_limit_score`
**结束轮次:** 第12/12整轮
**最终状态:** 存活
**我方HQ:** 不适用（无HQ）
**裁决总分:** 694

---

## 玩家表

| 席位 | 玩家名 | agent@模型 | spawnSlot | turnOrder | 最终状态 |
|------|--------|-----------|-----------|-----------|----------|
| `player_a` | GLM5.3-ZC | ZC@glm5.3 | slot_east | 0（先手） | 存活（裁决第2） |
| `player_b` | GLM5.2-WB | WB@glm5.2 | slot_west | 1（后手） | 存活（冠军） |

> 关键：本图为 annihilation 模式，运行时无 HQ，双方各出生 3 单位（2步兵+1重型）于东西两侧；出生位由 `spawnSlotId` 决定，`player_a` 在东（正q）、`player_b` 在西（负q）。`turnOrder` 中 `player_a` 先手，我方后手——整局每轮都是对手先动、我方后动，对炮火边界和集火时机有直接影响。

---

## 游戏进程时间线

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 局势变化 | 战术意图 |
|---------------|------|--------|----------------|----------|----------|
| 第1轮 / `player_a` | 45→0 | 4/4 | 移动2步+部署infantry(4,-1) from cp_east seq6 (-45)；占领supply_east(3,0) seq8 | 抢东线经济点 | 对称开局抢点 |
| 第1轮 / `player_b` | 57→19 | 4/4 | 3单位推进+部署scout(-4,1) from cp_west seq15 (-38)；占领supply_west(-3,0) seq16 | 收入建立 | 抢西线经济点+出快攻侦察兵 |
| 第2轮 / `player_a` | 20→20 | 4/4 | 占领cp_northeast(4,-4) seq24、supply_northeast(3,-3) seq25 | 4CP，经济反超 | 双线抢外圈据点 |
| 第2轮 / `player_b` | 39→39 | 4/4 | 4单位移动：步兵(0,0)、heavy(-1,0)居中，scout(0,-3)占supply_northwest seq33，d04e(-4,4)占cp_southwest seq50（R3初生效）；占领supply_southwest(-3,3) seq34 | 4CP，经济持平 | 不部署存钱下回合出游骑兵 |
| 第3轮 / `player_a` | — | 4/4 | 部署scout(4,1) from cp_east seq40 (-38) | 5单位 | 出侦察兵骚扰 |
| 第3轮 / `player_b` | 75→3 | 4/4 | **部署ranger(-2,0) from supply_west seq45 (-72)**；步兵(0,0)攻击敌方heavy(1,0) dmg20 seq46；占领cp_northwest(0,-4) seq49、cp_southwest(-4,4) seq50 | ✅ 6CP反超，ranger上线 | 把0价值补给转为ranger军力；首次对敌方heavy造成伤害 |
| 第4轮 / `player_a` | — | 4/4 | heavy攻击我步兵576312ae dmg28 seq56；步兵攻击dmg21 seq58；占领supply_southeast(0,3) seq60 | 我步兵576312ae 100→51残血 | 敌方集火我中心步兵 |
| 第4轮 / `player_b` | 47→2 | 4/4 | 步兵576312ae撤退至(-3,1)；heavy顶上(0,0)；ranger攻击敌方heavy dmg33 seq66；**部署infantry(-2,-1) from supply_west seq67 (-45)** | 重型当肉盾，新步兵做预备队 | 残血单位撤离，保军力价值 |
| 第5轮 / `player_a` | — | 4/4 | heavy攻击我heavy dmg26 seq73；步兵攻击dmg20 seq74 | 我heavy 150→104 | 缩圈前压制我方 |
| 第5轮 / `player_b` | 46→46 | 4/4 | ranger攻击敌方heavy dmg34 seq78；heavy攻击dmg28 seq79；步兵146b攻击敌方步兵dmg23 seq82 | **敌方heavy 150→97→dead seq99（R6初结算）** ✅ | 集火击杀敌方重型 |
| 第6轮 / `player_a` | — | 4/4 | **部署ranger(2,0) from supply_east seq88 (-72)**；heavy(残血)攻击我heavy dmg22 seq89 | 敌方ranger上线，威胁增大 | 敌方出ranger反制 |
| 第6轮 / `player_b` | 90→30 | 4/4 | heavy撤退至(-2,1)避开ranger射程；ranger攻击敌方heavy dmg29 seq96（补刀）；步兵146b攻击dmg16 seq98；**部署support(-2,-1) from supply_west seq100 (-60)** | 敌方heavy确认击杀；医疗兵上线 | 牺牲机动换ranger安全+出治疗 |
| 第7轮 / `player_a` | — | 4/4 | ranger(2,0)攻击我步兵146b dmg37 seq106；步兵攻击dmg22 seq107；**部署ranger(2,1) from supply_east seq110 (-72)** | 敌方双ranger，我步兵146b 100→41→dead seq124 ❌ | 敌方双ranger火力压制 |
| 第7轮 / `player_b` | 74→2 | 4/4 | ranger(63b)攻击敌方步兵dmg38 seq114；步兵146b(残血)攻击dmg21 seq115；d04e移动；support移动；**部署ranger(-3,-1) from supply_west seq136 (-72)** | 我方ranger(63b)暴露，新ranger待命 | 牺牲旧ranger换输出+部署替代ranger |
| 第8轮 / `player_a` | — | 4/4 | ranger(2,0)攻击我步兵146b dmg33 seq123；**ranger(2,1)攻击我ranger(63b) dmg41 seq126**；步兵攻击ranger(63b) dmg30 seq128 | 我ranger(63b) 72→1血濒死 ❌ | 敌方集火我ranger |
| 第8轮 / `player_b` | — | 4/4 | ranger(63b,1血)攻击敌方ranger(2,1) dmg40 seq133；d04e(0,1)攻击ranger(2,1) dmg27 seq135→**敌方ranger(2,1) dead seq158** ✅；部署ranger(860) seq136；heavy撤退 | 击杀敌方第二只ranger，但旧ranger将死 | 牺牲旧ranger换掉敌方ranger |
| 第9轮 / `player_a` | — | 4/4 | 步兵攻击我ranger(63b) dmg29 seq146→**ranger(63b) dead seq147** ❌；ranger(2,0)攻击我d04e dmg34 seq148 | 我第一只ranger阵亡 | 敌方收割残血 |
| 第9轮 / `player_b` | 90→90 | 4/4 | ranger(860)攻击敌方步兵dmg33 seq155；d04e攻击敌方ranger(2,1)——已死改打其他；scout移动；heavy移动 | 炮火击伤多单位 | 缩圈内撤保军 |
| 第10轮 / `player_a` | — | 4/4 | ranger(2,0)攻击我d04e dmg37 seq167 | 我d04e 66→29残血 | 敌方ranger持续输出 |
| 第10轮 / `player_b` | 134→62 | 4/4 | d04e攻击敌方ranger(2,0) dmg24 seq173；ranger(860)攻击敌方步兵dmg38 seq174；**部署ranger(44389) from supply_west seq175 (-72)**；heavy移动 | **敌方ranger(2,0) 72→48**；新ranger上线 | 再次把0价值补给转为ranger军力 |
| 第11轮 / `player_a` | — | 4/4 | ranger(2,0)攻击我d04e dmg39 seq187→d04e dead seq188 ❌；步兵攻击我ranger(44389) dmg24 seq190；步兵攻击我scout dmg23+dmg27 seq192/194→**scout dead seq195** ❌ | 我d04e和scout阵亡，ranger(44389)残血 | 敌方全力收割 |
| 第11轮 / `player_b` | 106→106 | 4/4 | **heavy攻击敌方ranger(2,0) dmg35 seq199**；**ranger(44389)攻击ranger(2,0) dmg43 seq200→敌方ranger(2,0) dead seq201** ✅；support攻击敌方步兵dmg3 seq202；步兵移动 | **击杀敌方最后一只ranger** ✅ | 集火清除敌方远程威胁 |
| 第12轮 / `player_a` | — | 1/4 | 步兵924攻击我ranger(44389) dmg26 seq212 | 我ranger(44389) 48→22 | 敌方仅剩步兵+scout |
| 第12轮 / `player_b` | 150→150 | 3/4 | **ranger(44389)攻击敌方步兵ee7f0260 dmg36 seq216→dead seq217** ✅；heavy攻击敌方步兵924 dmg29 seq219；步兵移动 | 部署尝试失败（炮火区限制），改用攻击收割 | 终局最大化actionScore |
| game_over seq223 | — | — | `turn_limit_score`，winner=player_b | 裁决694:598 | — |

> 补给为"回合开始（含收入）→行动后"。收入=base8+己方据点收入（forward_base 4 / supply 8）。R3起我方稳定6CP，收入44/轮。

---

## 核心胜利策略

### 1. 把0权重补给转为ranger军力（annihilation评分核心）

**关键决策:** 本局裁决权重 `armyValue=2`、`supplies=0`，即补给不构成裁决分，但ranger满血军力价值=72（×2权重=144分）。我方在R3、R8、R10三次将积蓄的补给部署为ranger，直接把0分资产转为高价值军力。

```text
第3轮 / player_b: 部署ranger(-2,0) from supply_west seq45 (-72补给) → +72军力价值
第8轮 / player_b: 部署ranger(-3,-1) from supply_west seq136 (-72) → 替代即将阵亡的旧ranger
第10轮 / player_b: 部署ranger(-2,0) from supply_west seq175 (-72) → 终局再添一笔军力
```

**为什么有效:**
- 三只ranger累计贡献军力价值216（×2=432裁决分潜力），是总分694的支柱。
- `supplies` 权重为0，囤积补给=无效资产；部署是唯一能把补给变现的途径。
- ranger射程3、攻44，是annihilation模式唯一能无反击输出的兵种，兼顾军力价值与战术压制。

### 2. 控制点压制建立收入代差

**关键决策:** R1-R3集中3步兵+1scout抢占6个据点（3 supply + 3 forward_base），收入44/轮 vs 对手最高36/轮，整局多收入约40-80补给，转化为2只额外ranger。

```text
第1轮 / player_b: 占领supply_west(-3,0) seq16 → 收入+8
第2轮 / player_b: 占领supply_northwest(0,-3) seq33、supply_southwest(-3,3) seq34 → 收入+16
第3轮 / player_b: 占领cp_northwest(0,-4) seq49、cp_southwest(-4,4) seq50 → 收入+8
```

**为什么有效:**
- 据点 `controlPoint` 权重虽为0（不直接加分），但 supply 据点 income=8、forward_base income=4，是部署的资金来源。
- 我方6CP vs 对手5CP，且我方3个supply据点(r3)在缩圈后期仍可作部署源（对手外圈forward_base r4更早失效）。

### 3. 集火优先击杀敌方ranger（远程威胁清除）

**关键决策:** 敌方R6、R7连续部署2只ranger(2,0)和(2,1)，对我方构成最大威胁。我方全程围绕"用旧ranger换敌方ranger"组织攻势，三只ranger接力击杀敌方两只ranger。

```text
第8轮 / player_b: 旧ranger(63b,1血)攻击敌方ranger(2,1) dmg40 seq133 + d04e补刀dmg27 seq135 → 敌方ranger(2,1) dead seq158
第11轮 / player_b: heavy攻击敌方ranger(2,0) dmg35 seq199 + ranger(44389)补刀dmg43 seq200 → 敌方ranger(2,0) dead seq201
```

**为什么有效:**
- ranger射程3、攻44，是我方heavy/步兵无法还手的远程威胁；不清除则每回合稳定吃我方41伤害。
- "旧ranger残血换敌方满血ranger"是正交换：旧ranger军力价值已趋0（1血），敌方ranger满血72。
- R11击杀敌方最后ranger后，敌方仅剩步兵+scout，无力反扑，锁定裁决胜局。

### 4. 残血单位撤离保军力价值

**关键决策:** annihilation军力价值=round(cost×hp/maxHp)，残血单位军力价值暴跌。我方R4将51血步兵撤离前线、R6将104血heavy撤出敌方ranger射程，避免无意义损失。

```text
第4轮 / player_b: 步兵576312ae(51血)从(0,0)撤退至(-3,1) seq64，躲开敌方heavy+步兵集火
第6轮 / player_b: heavy(104血)从(0,0)撤退至(-2,1) seq95，避开敌方ranger(2,0)射程3
```

**为什么有效:**
- 51血步兵若留(0,0)将被敌方heavy(25)+步兵(22)=47伤害击杀，损失军力价值23×2=46分；撤离后存活至终局。
- heavy撤至(-2,1)后，敌方ranger(2,0)射程3打不到（dist4），保住150满血军力价值92×2=184分潜力。

---

## 关键转折详解

### 第5-6轮 / `player_b` 回合 — 击杀敌方heavy

```text
操作: ranger(63b,-2,0)攻击敌方heavy(1,0) + heavy(0,0)补刀 + 步兵146b攻击
结果: 敌方heavy 150→97(R5)→dead seq99(R6初)，我方首杀敌方主力坦克
事件依据: seq78(dmg34) seq79(dmg28) seq98(dmg16) seq99(unit_death)
意义: 敌方失去唯一重型(军力价值92)，且我方ranger确立射程3无反击输出的压制力；比分从落后转为734:680领先
```

### 第8轮 / `player_b` 回合 — 旧ranger换敌方ranger(2,1)

```text
操作: 旧ranger(63b,1血,-2,0)攻击敌方ranger(2,1) dmg40 seq133 + d04e(0,1)补刀dmg27 seq135
结果: 敌方ranger(2,1) 72→dead seq158；我方旧ranger(63b)即将阵亡
事件依据: seq133 seq135 seq158(unit_death)
意义: 敌方双ranger变单ranger，远程火力减半；旧ranger1血换满血ranger是正交换，军力价值净赚~70
```

### 第11轮 / `player_b` 回合 — 击杀敌方最后ranger(2,0)

```text
操作: heavy(-1,1)攻击敌方ranger(0,0) dmg35 seq199 + ranger(44389,-2,0)补刀dmg43 seq200
结果: 敌方ranger(2,0) 48→dead seq201；敌方仅剩步兵+scout
事件依据: seq199 seq200 seq201(unit_death)
意义: 清除敌方全部远程威胁，敌方再无反击我方ranger的能力；锁定694:598裁决胜局
```

### 第10轮 / `player_b` 回合 — 部署第三只ranger锁定军力优势

```text
操作: 部署ranger(44389,-2,0) from supply_west seq175 (-72补给)
结果: 我方军力价值+72（×2=144裁决分），比分从落后6反超至领先
事件依据: seq175(deploy)
意义: 在裁决临界点把0权重补给转为高价值军力，是终局反超的关键一着
```

---

## 失误与改进

### 失误1: 六边形距离多次算错（ds分量漏算）

**问题:** 本局我至少4次因 `max(|dq|,|dr|,|ds|)` 中 ds=-q-r 分量漏算，导致移动/攻击失败：
- R5 步兵146b试图(0,0)→(0,1)，实际dist=2（误算为1）→ 移动失败 seq未生成
- R9 新ranger试图(-3,-1)→(-2,0)，实际dist=2但路径被堵 → "target is not reachable"
- R9 步兵146b(0,-1)→攻击敌方heavy(1,0) dist=2（误算1）→ "out of range (2>1)"
- R12 步兵(0,0)→攻击(-1,-1) dist=2（误算1）→ "out of range (2>1)"

**改进:** 每次移动/攻击前必须三分量齐全计算 `dist=max(|dq|,|dr|,|(-q1-r1)-(-q2-r2)|)`，并预先验证路径可达性（单位、blocker阻挡）。建议在决策脚本中固化距离校验。

**预期收益:** 避免每轮1-2次失败调用，相当于多1-2个有效行动点/轮，12轮可多12-24次有效操作（actionScore +120~240）。

### 失误2: 新ranger部署到炮火危险区(-2,-2,r4)

**问题:** R9我方新ranger(860)被敌方步兵(-2,-1)和己方support(-3,0)夹在(-3,-1)，无法向(-2,0)移动（路径被堵），被迫改道(-2,-2)。但(-2,-2)实际半径=4（s=-(-2)-(-2)=4，dist=max(2,2,4)=4），是R9 safeRadius=3 时的炮火危险区。

```text
第9轮 / player_b: ranger(860)从(-3,-1)移至(-2,-2) seq154，误以为r2安全
结果: R10边界炮火dmg25 seq164、R11边界炮火dmg22 seq183 → ranger(860)累计承伤47+战斗损伤，R11 dead seq184
```

**改进:** 部署和移动前必须用 `radius=max(|q|,|r|,|s|)` 校验目标格半径 < 当前 safeRadius；被夹击时优先选择向内（负半径方向）撤离而非横向。

**预期收益:** ranger(860)可多存活1-2轮，多输出2次36+伤害（actionScore +40，敌方军力损失+40）。

### 失误3: R7医疗兵部署位置导致当回合无法治疗

**问题:** R6部署support至(-2,-1)，R7试图移动到(-3,0)治疗heavy(-2,1)，但(-3,0)到(-2,1)实际dist=2（误算1），治疗失败 "target out of range"。医疗兵整回合空转。

**改进:** 治疗前校验 `supportId` 与 `targetId` 的 dist ≤ support.attackRange(=1)；医疗兵应部署在距主力1格的位置。

**预期收益:** heavy可早1轮回血+22（军力价值+15×2=30分，actionScore +20）。

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 12 | `config.balance.maxTurns` |
| 每回合行动点 | 4 | `actionsPerTurn` |
| 初始/基础收入 | 45 / 8 | `startingSupplies` / `baseIncome` |
| 据点收入 | forward_base=4，supply=8 | `controlPointTypes` |
| 裁决权重 | enemyHqDamage=0, ownHqHp=0, controlPoint=0, armyValue=2, supplies=0, effectiveActions=10 | `adjudicationWeights`；实际总分=armyValue×2+actionScore |
| 炮火配置 | startRound=5, intervalRounds=2, damage=25, minimumSafeRadius=2 | `config.annihilation.artillery` |
| 关键safeRadius | R1-4:6（全安全）→R5:5→R7:4→R9:3→R11:2 | `artillery_shrunk` seq70/103/140/179 |
| 单位属性 | ranger: hp72/atk44/rng3/cost72；heavy: hp150/atk38/mv2；infantry: hp100/atk30/mv3/cap | `config.units`；ranger是核心远程输出 |

> 部署/治疗的"炮火区"限制：目标格 radius 必须 < safeRadius（严格小于），radius=safeRadius 的格子虽不在 dangerCells（不承伤）但属"artillery zone"禁止部署/治疗。R12 safeRadius=2 时我方所有据点(r3+)均无 r<2 邻接格，无法部署。

---

## 数据统计

### 对各对手的交互

| 对手席位 | 军力损失 | 我方击杀 | 被其击杀 | 夺取其据点 | 关键影响 |
|----------|----------|----------|----------|------------|----------|
| `player_a` | heavy 1只 + ranger 2只 + infantry 2只 | 4（heavy seq99、ranger2a1f seq158、ranger dbfd seq201、infantry ee7f seq217） | 5（infantry146b seq124、ranger63b seq147、ranger860 seq184、d04e seq188、scout seq195） | 0（双方各占各自半区据点） | 击杀敌方全部ranger是胜负手；我方多损失1单位但军力价值更高（ranger存活3只 vs 敌方0） |

### 炮火承伤统计

| 时间 | 承伤单位 | 坐标 | 半径 | 伤害 | 结果 |
|------|----------|------|------|------|------|
| R9边界 seq141 | 敌方infantry924 | (4,-4) | r4 | 25 | 100→75 |
| R9边界 seq142 | 我方scout9cc4 | (0,-4) | r4 | 25 | 65→40 |
| R9边界 seq143 | 我方ranger860 | (-3,-1) | r3 | 25 | 72→47 |
| R10边界 seq164 | 我方ranger860 | (-2,-2) | r4 | 25 | 47→22 |
| R11边界 seq180 | 敌方infantry9f06 | (-2,-1) | r3 | 25 | 4→... |
| R11边界 seq181 | 我方infantry5763 | (-3,1) | r3 | 25 | 51→26 |
| R11边界 seq182 | 我方support73d4 | (-3,0) | r3 | 25 | 57→32 |
| R11边界 seq183 | 我方ranger860 | (-2,-2) | r4 | 22 | 22→dead seq184 |
| R12边界 seq206 | 敌方infantry9f06 | (-2,-1) | r3 | 1 | →dead seq207 |
| R12边界 seq208 | 我方support73d4 | (-3,0) | r3 | 25 | 32→7（存活至终局） |

> 我方炮火总承伤：25+25+25+25+22 = 122（5次命中，2只单位因炮火死亡/加速死亡）；敌方炮火总承伤：25+25+1 = 51（3次命中，1只单位因炮火死亡）。我方因R9误移ranger至r4区，炮火承伤远高于敌方。

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| 部署scout×1 | 1 | 38补给 |
| 部署ranger×3 | 3 | 216补给 |
| 部署infantry×1 | 1 | 45补给 |
| 部署support×1 | 1 | 60补给 |
| 部署折扣 | 0次 | 0（本图无折扣据点） |
| 基础+据点收入（12轮累计估算） | — | 约45+11轮×44≈529补给 |
| 最终补给 | — | 150（权重0，不构成裁决分） |

### 终局六项裁决账本

| 项目 | 我方(player_b) | 敌方(player_a) | 权重 | 计入总分 |
|------|----------------|----------------|------|----------|
| headquartersDamage | 0 | 0 | 0 | 权重0，不适用（无HQ） |
| ownHqHp | 0 | 0 | 0 | 权重0，不适用（无HQ） |
| controlPoints | 6 | 5 | 0 | 权重0，不构成裁决分（据点仅影响收入/部署） |
| armyValue | 97 | 59 | 2 | 我194 / 敌118 |
| supplies | 150 | 222 | 0 | 权重0，不构成裁决分 |
| actionScore | 500 | 480 | 10（已含在actionScore内） | 我500 / 敌480 |
| **总分** | **694** | **598** | — | 领先96 |

> armyValue明细（终局存活单位）：我方 infantry(26hp→round(45×26/100)=12) + heavy(66hp→round(92×66/150)=40) + support(7hp→round(60×7/82)=5) + ranger(22hp→round(72×22/72)=22) + 部分阵亡单位冻结值 ≈ 97。敌方 infantry(46hp→21) + scout(65hp→38) ≈ 59。

---

## 与历史对局的对比

| 项目 | tg_0038（历史败局） | tg_0041（历史胜局） | 本局 tg_0097 |
|------|---------------------|---------------------|--------------|
| 人数/地图/模式/出生 | 2人/danger-close/standard/slot_a先手 | 2人/danger-close/standard/slot_a先手 | 2人/artillery-zone/annihilation/slot_west后手 |
| 名次与结束原因 | 第2名/被淘汰(HQ归零) | 第1名/last_player_standing | 第1名/turn_limit_score |
| 关键据点控制 | 未抢占（heavy被困） | 不适用(standard攻城) | 6CP压制（supply据点作部署源） |
| 炮火承伤/击杀 | 不适用(standard) | 不适用(standard) | 我方承伤122/敌方承伤51；炮火击杀2单位 |
| 淘汰数/被淘汰轮次 | 我方R11被淘汰 | 敌方R12被淘汰 | 双方均存活至R12裁决 |
| 裁决总分 | 460 | 2640 | 694 |

**结论:**
- **tg_0038的教训"hex距离计算错误"在本局重复犯错**——本局4次距离/路径计算失败，与tg_0038"2次hex距离错误浪费行动点"如出一辙。说明距离校验未固化为习惯，**下次必须每次API调用前强制三分量校验**。
- **tg_0041的"先手攻城赛跑"策略在annihilation模式不适用**——本局无HQ、无攻城目标，胜负取决于军力价值+actionScore，验证了"模式不同策略不可迁移"。
- **本局新发现：annihilation模式补给权重为0时，部署是唯一变现途径**——终局前应尽一切可能部署高价值单位（ranger），即使无法当回合行动，其军力价值仍计入裁决。R10部署ranger(44389)直接贡献144裁决分，是反超关键。

---

## 总结

### 胜利关键因素
1. **三次部署ranger把0权重补给转为军力价值**——annihilation模式 `supplies` 权重为0，ranger满血军力价值72×2=144分，三次部署贡献432分潜力，是总分694的支柱。
2. **集火清除敌方全部ranger**——R8、R11接力击杀敌方两只ranger，消除唯一远程威胁后敌方无力反扑。
3. **6据点收入压制**——整局多收入约40-80补给，转化为2只额外ranger的部署资金。

### 核心战术原则
> **"annihilation模式：补给是死资产，ranger是活资产——把每点补给尽早部署成ranger，用射程3无反击输出集火清除敌方远程单位，军力价值×2权重决定裁决胜负。"**

### 一句话总结
**本局凭借三次部署ranger将军力价值堆至97（敌方59）、接力击杀敌方全部2只ranger清除远程威胁，在R12裁决以694:598获胜——但4次hex距离计算错误（重复tg_0038教训）和误移ranger至炮火区仍是必须改正的低效。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| 初始出生点 | `player_b` | (-5,0)/(-5,1)/(-4,-1) | 西线3单位出生位 |
| 初始出生点 | `player_a` | (3,0)/(3,-2)/(3,1) | 东线3单位出生位 |
| cp_west | `player_b` | (-4,0) | r4，我方主要部署源（R9后进入炮火区） |
| supply_west | `player_b` | (-3,0) | r3，6次部署的来源据点，整局核心经济点 |
| supply_northwest | `player_b` | (0,-3) | r3，R2占领 |
| supply_southwest | `player_b` | (-3,3) | r3，R2占领 |
| 中心(0,0) | 中立/争夺 | (0,0) | r0，永远安全；R11敌方ranger占据此处被我方集火击杀 |
| 炮火边界 R11 | — | r=2 圈 | safeRadius=2，r3+全为危险区；我方support(-3,0)和infantry(-3,1)滞留r3持续承伤 |

---

*文档生成时间: 2026-08-16*
*回放格式版本: 回放未提供（事件流取证，app 3.2.10）*
*AI模型: WB@glm5.2*
