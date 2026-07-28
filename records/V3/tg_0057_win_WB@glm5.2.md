# 战术游戏胜利复盘 — `player_a` 视角

**日期:** 2026-07-28
**游戏ID:** b6ac1cc5-8c2c-4c0b-b00d-36b115033dc8
**回放版本:** 3.1.5
**地图:** `forge` / 熔炉重铸
**玩家:** glm5.2-WB（WB@glm5.2）
**席位与出生:** `player_a`，行动顺序第2（turnOrder=`[player_b, player_a]`，后手），HQ(5,-5)
**参战人数:** 2
**结果:** 🏆 第1名 — `turn_limit_score`
**结束轮次:** 第10/10整轮
**最终状态:** 存活
**最终补给:** 18
**我方HQ:** 100/100 HP
**裁决总分:** 1445

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| **1** | **`player_a`** | **glm5.2-WB（我）** | **存活** | **1445** | **—** | 军力价值 501（敌 472，+29×2=+58），补给 18 落后 26，净 +32 胜出 |
| 2 | `player_b` | LongCat2.0-PI（PI@longcat2.0） | 存活 | 1413 | −32 | 补给 44（我 18，+26）与单位数 12（我 10）占优，但残血单位拖累军力价值 |

> 裁决权重（本局 `config.balance.adjudicationWeights`）：`enemyHqDamage=7`、`ownHqHp=2`、`controlPoint=75`、`armyValue=2`、`supplies=1`。
> 双方 HQ 伤害均为 0（全程未攻击到对方 HQ），据点 3:3 完全打平（各 225 分），HQ HP 均满（各 200 分）。胜负由军力价值与补给两项决定：我军力 501×2=1002 比敌 472×2=944 多 +58，但补给 18 比敌 44 少 −26，净差 +32 → 我险胜。
> 关键：军力价值按当前 HP 比例计算（非满血全额），敌方 heavy 终局 56/140、ranger 16/68 严重残血，单位虽多但 armyValue 被大幅稀释。

---

## 游戏进程时间线

> 补给格式"行动前→行动后"：行动前=本回合收入后的补给，行动后=部署扣减后的补给。行动点为"已用/上限(4)"。事件 seq 取自 `tg_0057_20260728.json`。

| 整轮/席位回合 | 补给 | 行动点 | 关键操作与坐标 | 局势变化 | 战术意图 |
|---|---|---|---|---|---|
| 第1轮 / `player_b` | 80→80 | 4/4 | scout(-4,5)→(-4,2)占supply_a[seq4,8]；infantry(-5,4)→(-4,3)；heavy(-5,6)→(-4,5)；ranger(-6,5)→(-5,4) | b占1点 | 对手全面抢占己方supply_a，三军压向中路 |
| 第1轮 / `player_a` | 90→90 | 4/4 | infantry(5,-4)→(4,-2)占supply_b[seq12,16]；scout(4,-5)→(-1,-3)；heavy(5,-6)→(3,-4)；ranger(6,-5)→(4,-4) | 我1 / b1 | 抢占己方supply_b，scout直插中央卡位 |
| 第2轮 / `player_b` | 102→60 | 4/4 | scout(-4,2)→(-2,-3)占repair_a[seq21,25]；infantry→(-3,2)；**部署infantry(42)**至(-6,5)从HQ[seq23]；heavy→(-3,4) | b2 / 我1 | 对手占repair_a获修理，并首 deploy 增兵 |
| 第2轮 / `player_a` | 112→112 | 4/4 | scout(-1,-3)→(-2,-2)占fb_a[seq29,34]；**attack敌scout dmg12 hp46**[seq30]；infantry(4,-2)→(2,1)；heavy→(1,-3)；ranger→(2,-4) | 我2 / b2 | 占fb_a扳平，scout占领后顺带攻击敌scout |
| 第3轮 / `player_b` | 90→48 | 4/4 | **敌scout attack我scout dmg11 hp47**[seq40]；scout→(-3,-3)；heavy→(-2,2)；infantry→(-3,1)；**部署infantry(42)**至(-3,2)从cp_supply_a[seq44] | b2 / 我2 | 对手持续增兵，scout后撤规避 |
| 第3轮 / `player_a` | 142→100 | 4/4 | ranger(2,-4)→(0,-3)[seq48]；**attack敌scout dmg34 hp22**[seq49]；infantry(2,1)→(2,2)占fb_b[seq50,53]；heavy→(0,-4)；**部署infantry(42)**至(4,-4)从HQ[seq52] | 我3 / b2 | **ranger移至(0,-3)重创敌scout**，infantry占fb_b据点反超，首次deploy增兵 |
| 第4轮 / `player_b` | 78→36 | 4/4 | **heavy爆破(-2,1)blocker→plain**[seq59]；heavy(-2,2)→(-2,0)；infantry→(-2,-1)；**attack我scout dmg25 hp22**[seq62]；部署infantry(42)至(-4,5)；ranger→(-3,3) | b2 / 我3；**中央墙被破** | **对手heavy爆破中央墙开路**（与tg_0043我方操作同位），infantry贴脸打我scout |
| 第4轮 / `player_a` | 138→138 | 4/4 | scout(-2,-2)→(3,-2)撤退[seq68]；heavy(0,-4)→(-2,-2)堵fb_a[seq69]；infantry(2,2)→(2,3)占repair_b[seq70,73]；**ranger attack敌scout dmg35 hp0 击杀**[seq71] | 我4 / b2；**敌scout阵亡** | scout保命撤退，heavy堵住fb_a防御，ranger击杀敌scout，占repair_b达4点峰值 |
| 第5轮 / `player_b` | 66→24 | 4/4 | infantry attack我heavy dmg16 hp124[seq78]；heavy→(-3,-1)；heavy attack dmg27 hp97[seq80]；ranger→(-2,1)；ranger attack dmg29 hp68[seq82]；部署infantry(42)至(-5,6) | 我heavy 140→68；**对手三集火重创我heavy** | 对手集中3单位围攻我堵点heavy，但heavy(140HP,def12)扛住 |
| 第5轮 / `player_a` | 184→24 | 4/4 | **部署heavy(80)**至(2,1)从cp_fb_b[seq87]；**部署heavy(80)**至(3,2)从cp_fb_b[seq88]；ranger attack敌heavy dmg28 hp112[seq89]；我heavy attack敌heavy dmg26 hp86[seq90] | 我4 / b2；**双heavy部署+反击** | **关键：从forward_base折扣部署2个heavy(各省8补给)**，armyValue暴涨，同时反击敌heavy |
| 第5轮末 | — | — | **comeback player_b +12 (gap19.5%)**[seq93] | 对手获翻盘补给 | 我领先过大触发对手comeback机制 |
| 第6轮 / `player_b` | 54→54 | 4/4 | infantry attack我heavy dmg16 hp52[seq96]；heavy attack dmg26 hp26[seq97]；ranger attack dmg25 hp1[seq98]；infantry→(-2,0) | 我heavy 68→1 濒死 | 对手再三集火，我堵点heavy仅剩1HP |
| 第6轮 / `player_a` | 70→36 | 4/4 | ranger attack敌heavy dmg30 hp56[seq103]；部署infantry(34)至(1,2)[seq104]；heavy(2,1)→(2,0)；heavy(3,2)→(3,1) | 敌heavy 86→56 | ranger继续削敌heavy，部署+推进heavy |
| 第6轮末 | — | — | **comeback player_b +12 (gap20%)**[seq109] | 对手再获翻盘补给 | 连续2轮comeback，对手累计+24补给 |
| 第7轮 / `player_b` | 42→42 | 4/4 | **infantry attack我heavy dmg17 hp0 击杀**[seq112]；infantry(-2,-1)→(-2,-2)占fb_a[seq114,119]；ranger→(-3,0)；**ranger attack我ranger dmg37 hp31**[seq116]；heavy→(-1,-2)；部署infantry(42)至(-3,-2) | **我heavy阵亡+fb_a失守**；我ranger 68→31 | **对手击杀我堵点heavy并夺回fb_a**，据点扳平3:3，ranger重创我ranger |
| 第7轮 / `player_a` | 74→6 | 4/4 | ranger(0,-3)→(2,-4)撤退[seq123]；部署infantry(34)至(2,1)[seq124]；部署infantry(34)至(3,2)[seq125] | 我3 / b3；ranger保命 | ranger撤出敌ranger射程，连续部署2步兵增armyValue |
| 第8轮 / `player_b` | 80→12 | 4/4 | ranger(-3,0)→(-1,-1)[seq130]；**ranger attack我ranger dmg34 hp0 击杀**[seq131]；部署infantry(34)至(-2,-1)从cp_fb_a[seq133]；infantry→(-1,-3)；部署infantry(34)至(-2,-3)从cp_fb_a[seq135] | **我ranger阵亡**；对手跨墙深入我方半场 | **对手ranger越墙击杀我ranger**，并从fb_a折扣部署2步兵，单位数达12 |
| 第8轮 / `player_a` | 44→10 | 4/4 | 部署infantry(34)至(1,3)[seq139]；heavy(2,0)→(3,0)[seq140]；infantry(1,2)→(0,3)[seq141]；infantry(4,-4)→(3,-3)[seq142] | 我3 / b3；单位后撤规避 | 撤出敌ranger射程保命，继续部署增兵 |
| 第9轮 / `player_b` | 50→50 | 4/4 | ranger(-1,-1)→(0,-2)[seq147]；**ranger attack我scout dmg37 hp0 击杀**[seq148]；infantry→(1,-3)；heavy→(0,-3)；infantry→(-3,-3) | **我scout阵亡**；对手ranger深入(0,-2) | **对手ranger再杀我scout**，我已损失3主力(heavy/ranger/scout) |
| 第9轮 / `player_a` | 48→14 | 4/4 | infantry(3,-3)→(1,-2)[seq156]；**attack敌ranger dmg26 hp42**[seq157]；部署infantry(34)至(1,2)[seq158]；heavy(3,0)→(2,0)；heavy(3,1)→(2,2) | 敌ranger 68→42 | **infantry移至(1,-2)贴脸反击敌ranger**（敌ranger def3低），同时推进heavy占fb_b |
| 第10轮 / `player_b` | 88→20 | 4/4 | infantry attack我infantry dmg23 hp67[seq165]；部署infantry(34)至(-1,-2)[seq166]；部署infantry(34)至(-3,-2)[seq167]；heavy(0,-3)→(-1,-4) | 我infantry 90→67 | 对手继续折扣部署增兵，heavy后撤 |
| 第10轮 / `player_a` | 52→18 | 2/4 | **infantry attack敌ranger dmg26 hp16**[seq172]；部署infantry(34)至(3,1)[seq173] | 敌ranger 42→16 濒死 | **末轮攻击敌ranger(高价值软目标)削其armyValue**，再部署1步兵 |
| 第10轮末 | — | — | **game_over winner=player_a turn_limit_score**[seq176] | 裁决结算 | 我1445 vs 敌1413，**险胜32分** |

> 第10轮 `player_b` 回合在 `player_a` 之前；对手行动后进入我方第10轮回合，结束触发 `turn_limit_score` 裁决。

---

## 核心胜利策略

### 1. 末轮精准狙击敌方高价值残血单位

**关键决策:** 第10轮用仅存的步兵(1,-2)攻击敌方残血ranger(42HP,def3)，而非攻击满血单位

```text
第10轮 / player_a: infantry(1,-2) attack 敌ranger(0,-2) [dmg26 hp42→16, seq172]
                   deploy infantry(34) at(3,1) from cp_fb_b [seq173]
```

**为什么有效:**
- 敌ranger基础价值72、def仅3，是全场"每HP裁决分"最高的目标：72/68×2 = 2.12分/HP，远高于heavy(88/140×2=1.26)和infantry(42/90×2=0.93)
- 26伤害使ranger 42→16HP，armyValue从 (42/68)×72=44.5 降至 (16/68)×72=16.9，减少27.6×2=**55分敌裁决分**
- 配合部署(+50净分)，末轮单回合摆动+105分，从落后72反超至领先32
- 关键认知：**armyValue按当前HP比例计算，残血单位分值大幅缩水**——削血比杀兵更具性价比（杀兵需消耗大量AP，削血1次攻击即可）

### 2. forward_base持续折扣部署撑起armyValue

**关键决策:** 占领cp_fb_b(2,2)后，从R5到R10持续利用其部署折扣8部署7个单位

```text
第5轮 / player_a: 部署heavy×2 从cp_fb_b (各cost80, 省8×2=16) [seq87,88]
第6-10轮 / player_a: 部署infantry×6 从cp_fb_b (各cost34, 省8×6=48) [seq104,124,125,139,158,173]
```

**为什么有效:**
- forward_base部署折扣8使infantry成本从42降至34（省19%），heavy从88降至80（省9%）
- 7次折扣部署共节省56补给，相当于多部署1.6个infantry
- 我方最终10个存活单位中8个来自部署（仅2个初始单位存活），armyValue 501全靠持续部署撑起
- 对手虽也用cp_fb_a折扣部署4次，但其单位多为残血（heavy 56/140、ranger 16/68），armyValue被稀释至472

### 3. 第4轮"撤退-堵点-占点-击杀"组合拳

**关键决策:** 第4轮面对敌方破墙进攻，执行4步连贯防御：scout撤退保命、heavy堵fb_a、infantry占repair_b、ranger击杀敌scout

```text
第4轮 / player_a: scout(-2,-2)→(3,-2) 撤退保命[seq68]
                   heavy(0,-4)→(-2,-2) 堵住fb_a防御[seq69]
                   infantry(2,2)→(2,3) 占领repair_b[seq70,73]
                   ranger attack 敌scout dmg35 击杀[seq71]
```

**为什么有效:**
- scout仅22HP留在fb_a必死，撤退至(3,-2)保住35军力价值（后续仍被击杀，但延后2轮）
- heavy(140HP,def12)站上fb_a堵住敌方capture单位，敌方需消耗3轮集火才击杀（R5-R7）
- 占领repair_b使我据点数达4:2峰值，收入升至46/轮
- ranger击杀敌scout（seq71）移除敌方唯一capture单位中的高机动单位，且ranger本身无伤

### 4. R7-R8残血单位规避敌方ranger射程

**关键决策:** 敌方ranger(范围3)连杀我scout/ranger后，将剩余高价值单位撤出其射程

```text
第7轮 / player_a: ranger(0,-3)→(2,-4) 撤出敌ranger(范围3)覆盖[seq123]
第8轮 / player_a: heavy(2,0)→(3,0) 规避；infantry(1,2)→(0,3) 规避[seq140,141]
```

**为什么有效:**
- 敌ranger atk40范围3，对我heavy(40-12=28dmg)和infantry(40-7=33dmg)威胁极大
- 计算敌ranger坐标(-1,-1)的3格覆盖圈，将范围内单位全部撤至dist≥4的安全格
- 虽然损失了scout和ranger，但保住了2个满血heavy(各140HP,价值88×2=176)和6个infantry，为末轮反扑保留核心军力

---

## 关键转折详解

### 第4轮 / `player_b` 回合 — 敌方heavy爆破中央墙

```text
操作: heavy f4fc2d5f demolish (-2,1) blocker→plain [seq59]
结果: (-2,1) 变为plain，中央十字墙西侧缺口打开
事件依据: seq59 demolish 事件，fromTerrain=blocker, toTerrain=plain
意义: 这是全局最关键的对手操作。爆破前双方被blocker墙隔开无法交战；
      爆破后敌方ranger经(-2,1)通道深入我方半场，R8-R9连续击杀我ranger和scout。
      我方全程未爆破任何blocker，导致heavy无法穿越中央墙支援西线——
      这重复了 tg_0038 中"heavy被blocker墙封死"的致命错误。
```

### 第4轮 / `player_a` 回合 — ranger击杀敌方scout + 占领第4据点

```text
操作: ranger(2,-4)→(0,-3) [seq48] + attack敌scout(af92d51e) dmg35 hp0 击杀 [seq71]；
      infantry(2,2)→(2,3) 占领repair_b [seq70,73]
结果: 敌scout阵亡（军力价值35）；据点数 我4(supply_b+fb_a+fb_b+repair_b) / b2
事件依据: seq49 attack dmg34 hp22（R3已先削过）；seq71 attack dmg35 hp0 击杀；seq73 capture
意义: 我方唯一一次击杀。ranger移至(0,-3)是精确计算射程3覆盖(-2,-2)的结果。
      据点4:2达到峰值，裁决分一度领先+254。但后续因heavy被集火+fb_a失守，优势被蚕食。
```

### 第5轮 / `player_a` 回合 — 双heavy折扣部署+反击

```text
操作: deploy heavy(80) at(2,1) from cp_fb_b [seq87]；deploy heavy(80) at(3,2) from cp_fb_b [seq88]；
      ranger attack敌heavy dmg28 hp112 [seq89]；heavy attack敌heavy dmg26 hp86 [seq90]
结果: 我方armyValue瞬间+176（2×88），补给184→24
事件依据: seq87,88 deploy cost=80（折扣8）；seq89,90 attack
意义: 全局最大单轮得分操作。利用forward_base折扣部署2个heavy，
      使armyValue从约300跃升至470+，建立裁决分领先。
      但补给骤降至24，后续无力再部署heavy，只能靠infantry(34)维持。
```

### 第7轮 / `player_b` 回合 — 击杀我heavy + 夺回fb_a（局势逆转）

```text
操作: infantry attack我heavy(fda06dbe) dmg17 hp0 击杀 [seq112]；
      infantry(-2,-1)→(-2,-2) 占领fb_a [seq114,119]；
      ranger attack我ranger dmg37 hp31 [seq116]
结果: 我heavy阵亡（价值88，按1HP计≈0.6）；fb_a失守，据点扳平3:3；我ranger重创68→31
事件依据: seq112 attack hp0；seq119 capture prev=player_a
意义: 全局最大逆转。我方从领先+254跌至落后。heavy阵亡后fb_a无防御，
      敌方capture单位直接占领。加上R8-R9敌方ranger连杀我ranger/scout，
      我方3主力阵亡，军力价值骤降。末轮靠削减敌方ranger才惊险翻盘。
```

### 第10轮 / `player_a` 回合 — 末轮狙击敌方ranger翻盘

```text
操作: infantry(1,-2) attack敌ranger(ac27aeaa) dmg26 hp42→16 [seq172]；
      deploy infantry(34) at(3,1) from cp_fb_b [seq173]
结果: 敌ranger 42→16HP，armyValue 44.5→16.9（-27.6×2=-55分）；我方+50净分
事件依据: seq172 attack hp16；seq173 deploy
意义: 末轮决定性操作。敌方ranger是全场最高价值软目标（72cost/68HP/def3），
      26伤害削去55裁决分。配合部署+50，单轮摆动+105，从落后72反超至领先32。
      验证"残血高价值单位是末轮首选目标"原则。
```

---

## 失误与改进

### 失误1: 全程未爆破中央blocker墙，重蹈tg_0038覆辙

**问题:** 全局10轮我方heavy未执行任何demolish，而对手R4即爆破(-2,1)开路。我方heavy被墙隔绝在西线之外，无法支援fb_a防御，也无法追击敌方深入我半场的ranger。敌方ranger经(-2,1)缺口R8-R9连杀我ranger和scout，我方无法拦截。

**改进:** 我方HQ在(5,-5)东侧，对应爆破点应为(2,-1)或(1,0)。第4-5轮heavy推进至(2,0)时，应demolish相邻的(2,-1)blocker开路，使heavy能穿越中央支援fb_a(-2,-2)。或第6轮heavy在(0,-4)时demolish(0,-1)开第二条通道。

**预期收益:** heavy能及时回防fb_a（避免阵亡+88军力价值），并能拦截敌方ranger（避免ranger/scout阵亡，保住72+35=107军力价值），合计可能多保留195×2=390裁决分。

### 失误2: hex距离计算错误导致10+次API失败

**问题:** 全局因距离或路径计算错误导致API失败至少10次：
- R3: scout attack失败（敌scout在(-3,-3) dist2>range1，误算为1）
- R6: heavy→(-1,-3)、(0,-2) 移动失败（路径被己方ranger阻挡）
- R8: heavy→(0,-2)、(1,-1) 移动失败（blocker墙+距离误算）
- R9: heavy(3,0)→(1,-1) 失败（dist3>move2，误算为2）；heavy(3,1)→(1,-2) 失败（dist5）；infantry→(0,-4) 失败（dist4>move3）；deploy(3,3)失败（dist2非相邻）
- R10: 第二次attack失败（每单位每回合仅1次攻击）

**改进:** 每次移动/攻击前严格用 `max(|dq|,|dr|,|ds|)`（s=-q-r）验证：移动验证 dist≤moveRange且路径无阻挡；攻击验证 dist≤attackRange；部署验证 dist(fromCP)=1。这是 tg_0038(2次)、tg_0043(3次) 已暴露的问题，本局达10+次，虽4AP/轮容错未致命，但严重浪费决策精力。

**预期收益:** R9若2次heavy移动成功，可多造成2次有效攻击（约50+伤害），armyValue差距可能扩大至+100以上，末轮无需惊险翻盘。

### 失误3: R5过度消耗补给部署2 heavy，后续补给枯竭

**问题:** R5一次性部署2个heavy(160补给)，补给从184骤降至24。后续R6-R10虽有收入(38-46/轮)，但仅够每次部署1个infantry(34)，无法再部署heavy/ranger等高价值单位。终局补给仅18，补给项裁决分落后对手26分。

**改进:** R5部署1个heavy(80)保留104补给，R6再部署第2个heavy(80)保留24补给。分散部署不影响总armyValue，但保留中段灵活性（可应对突发战况deploy额外单位）。或R5部署1 heavy + 1 ranger(64)，ranger射程3可提前压制敌方ranger。

**预期收益:** 补给项可能多保留20-30分，终局领先扩大至50+分，降低翻盘风险。

### 失误4: 暴露高价值单位在敌方ranger射程内

**问题:** R7我ranger(68HP)留在(0,-3)，处于敌方ranger(-1,-1)射程3内（dist3），被R8敌方ranger移动后击杀。R9我scout(22HP)在(3,-2)，同样被敌方ranger(0,-2)射程3覆盖（dist3）击杀。两个高价值单位(ranger 72 + scout 35 = 107军力价值)因站位暴露而阵亡。

**改进:** 每回合结束前检查所有己方单位与敌方ranger的距离，将dist≤3的高价值单位撤至dist≥4。R7应将ranger撤至(2,-4)（dist4）而非留在(0,-3)；R9应将scout撤至(5,-2)（dist5）。

**预期收益:** 保住ranger(72×2=144分)+scout(35×2=70分)=214裁决分，分差可能扩大至+200以上。

---

## 本局机制与配置

| 项目 | 本局值 | 来源/影响 |
|------|--------|-----------|
| 最大整轮数 | 10 | `config.balance.maxTurns` — 节奏紧凑 |
| 每回合行动点 | 4 | `actionsPerTurn` — 比默认5少1，API失败代价高 |
| 初始/基础收入 | 80 / 10 | `startingSupplies` / `baseIncome` |
| 据点效果 | supply:+12；forward_base:+8,部署折扣8；repair:+8,修理10HP | `controlPointTypes` |
| 裁决权重 | enemyHqDamage×7, ownHqHp×2, controlPoint×75, armyValue×2, supplies×1 | `adjudicationWeights` — 据点75仍最高，但armyValue×2在多兵局影响巨大 |
| comeback补给 | R4起，落后15%+每轮+12 | `comebackSupply` — 对手R5-R6各获+12，累计+24缩小差距 |
| 中央墙 | 7格blocker十字 | 需heavy爆破开路，未爆破方机动严重受限 |
| armyValue计算 | 按当前HP/满HP比例 × 单位cost | 残血单位分值大幅缩水，削血≈杀兵的性价比 |

> 与 tg_0043（同地图）配置差异：本局 `controlPoint=75`（tg_0043为100）、`enemyHqDamage=7`（tg_0043为4）。据点权重下降使armyValue相对更重要，本局armyValue×2=1002占总分69%，是制胜主项。

---

## 数据统计

### 对各对手的交互

| 对手席位 | HQ伤害 | 击杀 | 被击杀 | 夺取其据点 | 关键影响 |
|----------|--------|------|--------|------------|----------|
| `player_b` (LongCat2.0-PI) | 0 | 1 (scout, seq71 R4) | 3 (heavy R7、ranger R8、scout R9) | 0 (我4据点中fb_a被夺回) | 击杀少于被杀(1:3)，但持续削血敌heavy(140→56)和ranger(68→16)使其armyValue缩水，靠HP比例机制反超 |

### 补给与部署

| 项目 | 数量 | 实际花费/收入 |
|------|------|---------------|
| 部署heavy ×2 | 160补给 | R5从cp_fb_b部署(各80,折扣8) |
| 部署infantry ×6(折扣) | 204补给 | R6-R10从cp_fb_b部署(各34,折扣8) |
| 部署infantry ×1(无折扣) | 42补给 | R3从HQ部署 |
| 部署折扣 | 7次 | 节省56补给 |
| 基础收入 | 10轮 | 100补给 |
| 据点收入(supply_b) | 9轮 | 108补给 |
| 据点收入(fb_a) | 4轮(R3-R6) | 32补给 |
| 据点收入(fb_b) | 7轮(R4-R10) | 56补给 |
| 据点收入(repair_b) | 6轮(R5-R10) | 48补给 |
| comeback补给 | 0次 | 全程领先未触发 |
| **总收入** | — | **344补给** |
| **总支出** | — | **406补给**（8次部署） |
| **最终补给** | — | **18**（80起始+344收入−406支出=18 ✓） |

### 军力价值终局

| 单位 | 所属 | HP/MaxHP | 基础价值 | 实际armyValue(按HP比例) |
|------|------|----------|----------|------------------------|
| heavy | player_a | 140/140 | 88 | 88 |
| heavy | player_a | 140/140 | 88 | 88 |
| ranger | player_a | — | 72 | 0（R8阵亡） |
| infantry | player_a | 67/90 | 42 | 31 |
| infantry ×6 | player_a | 均90/90 | 42×6 | 42×6=252 |
| scout | player_a | — | 35 | 0（R9阵亡） |
| infantry(R3部署) | player_a | 90/90 | 42 | 42 |
| **我方合计** | | | | **501** |
| heavy | player_b | 56/140 | 88 | 35 |
| ranger | player_b | 16/68 | 72 | 17 |
| infantry ×8 | player_b | 多数90/90 | 42×8 | 约336(部分受伤) |
| scout | player_b | — | 35 | 0（R4阵亡） |
| infantry ×2 | player_b | 90/90 | 42×2 | 84 |
| **敌方合计** | | | | **472** |

> 我方armyValue 501 vs 敌方472，差+29×2=+58裁决分。敌方单位数(12)多于我方(10)，但heavy(56/140)和ranger(16/68)严重残血，armyValue被HP比例机制大幅稀释。**这是本局制胜的核心：通过持续削血敌方高价值单位，使其armyValue缩水。**

---

## 与历史对局的对比

| 项目 | tg_0038 (WB@glm5.2 败) | tg_0043 (WB@glm5.2 胜) | 本局 tg_0057 |
|------|------------------------|------------------------|--------------|
| 人数/地图/出生位 | 2人 / danger-close / player_a先手 | 2人 / forge / player_b后手 | 2人 / forge / player_a后手 |
| 名次与结束原因 | 第2 / last_player_standing(HQ毁) | 第1 / turn_limit_score | **第1 / turn_limit_score** |
| 关键据点控制 | 1个supply | 3个(与对手打平) | 4→3个(R4峰值4，终局3打平) |
| HQ伤害/承伤 | 23 / 120(HQ毁) | 0 / 0 | 0 / 0 |
| 击杀/被击杀 | 0杀 / 第11轮被淘汰 | 3杀 / 2被杀 | 1杀 / 3被杀 |
| 裁决总分 | 460 | 1298 | **1445** |
| 裁决权重controlPoint | — | 100 | 75 |
| 是否爆破中央墙 | 否(致命) | 是(R3破(-2,1)) | **否(失误)** |

**结论:**

1. **tg_0038"heavy被blocker墙封死"的教训未彻底修正**：tg_0043中我方成功爆破(-2,1)开路制胜，但本局我方(player_a东侧)全程未爆破任何blocker，导致heavy无法穿越中央支援西线。差异在于：tg_0043我是player_b(西侧，(-2,1)邻我方区域易于爆破)；本局我是player_a(东侧)，对应爆破点(2,-1)/(1,0)距我heavy较远且路径被己方单位阻塞。**改进方向：东侧出生时需更早规划(2,-1)的爆破路径。**

2. **hex距离计算错误持续恶化**：tg_0038(2次)→tg_0043(3次)→本局(10+次)。虽4AP/轮容错率使本局未致命，但这是最需根除的系统性问题。本局多次误将dist 3算作dist 2（忽略ds分量），需严格用max(|dq|,|dr|,|ds|)三轴验证。

3. **"残血削血优于强杀"的新发现**：本局验证了armyValue按HP比例计算的机制——敌方heavy 56/140和ranger 16/68虽存活，但armyValue分别缩水60%和76%。末轮攻击敌ranger(26伤害)削减55裁决分，比尝试强杀(需多次AP)更高效。这是对tg_0043"集火击杀"策略的补充：**当AP不足以击杀时，削血高价值软目标同样有效。**

4. **forward_base折扣部署的战术价值再验证**：tg_0043中forward_base主要用于部署折扣，本局进一步验证其作为"armyValue泵"的价值——7次折扣部署撑起我方80%的armyValue。结合本局`armyValue×2`权重较高(controlPoint从100降至75)，forward_base的战略地位进一步提升。

5. **comeback机制的双刃剑**：本局我方R5领先过大(+254)触发对手comeback(+12×2轮=+24)，缩小差距。tg_0043中我方也曾触发对手comeback但影响较小。**新认知：大比分领先时需评估是否"过度领先"触发对手comeback，可在临界点(15%)附近控制分差。**

---

## 总结

### 胜利关键因素

1. **末轮精准狙击**：第10轮攻击敌方残血ranger(高价值软目标)，单次攻击削减55裁决分，配合部署完成翻盘
2. **forward_base持续折扣部署**：7次折扣部署撑起armyValue 501，占总分69%，是本局制胜主项
3. **持续削血敌方高价值单位**：敌方heavy(140→56)和ranger(68→16)严重残血，armyValue被HP比例机制稀释
4. **残血单位规避**：R7-R8将高价值单位撤出敌方ranger射程，保留2个满血heavy为末轮反扑奠定军力基础

### 核心战术原则

> **"forward_base是armyValue泵，残血高价值单位是末轮首选目标——削血比强杀更具性价比"**

### 一句话总结

**在熔炉重铸地图上，虽因未爆破中央墙导致3主力阵亡、一度落后72分，但凭借forward_base持续折扣部署撑起armyValue、末轮精准狙击敌方残血ranger(削55分)+部署(增50分)完成翻盘，以1445:1413险胜——armyValue按HP比例计算的机制使削血成为比击杀更高效的裁决分获取手段。**

---

## 附录：关键坐标

| 实体 | 所属席位 | 坐标 | 说明 |
|------|----------|------|------|
| HQ | `player_a` | (5,-5) | 我方出生位，东南区域 |
| HQ | `player_b` | (-5,5) | 对手出生位，西北区域 |
| cp_supply_b | — | (4,-2) | 东麓矿场，我方R1占领，收入+12/轮 |
| cp_supply_a | — | (-4,2) | 西麓矿场，对手R1占领 |
| cp_fb_a | — | (-2,-2) | 北岭前哨，我方R2占领→R7被夺回，forward_base |
| cp_fb_b | — | (2,2) | 南岭前哨，我方R3占领，**核心部署折扣点(7次折扣部署)** |
| cp_repair_b | — | (2,3) | 东熔炉维修站，我方R4占领，收入+8/轮 |
| cp_repair_a | — | (-2,-3) | 西熔炉维修站，对手R2占领，修理敌方单位 |
| 爆破点 | — | (-2,1) | 原blocker，**对手R4 heavy爆破→plain**，中央通道关键缺口（我方未爆破对应东侧(2,-1)） |
| 中央墙 | — | (-1,0),(0,0),(1,0),(0,-1),(0,1),(2,-1) | 十字形blocker群（(-2,1)被爆破后其余仍阻断），本局我方未开路 |
| ranger狙击点 | — | (0,-3) | 我方ranger R3移至此攻击敌scout(射程3覆盖(-2,-2)) |
| 末轮翻盘点 | — | (1,-2) | 我方infantry R9移至此，R10贴脸攻击敌ranger(0,-2) |

---

*文档生成时间: 2026-07-28*
*回放格式版本: 3.1.5*
*AI模型: WB@glm5.2*
