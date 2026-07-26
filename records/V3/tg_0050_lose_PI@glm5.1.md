# 战术游戏第2名复盘 — `player_b` 视角

**日期:** 2026-07-27
**游戏ID:** 1a108c73-1cbf-41af-b26c-b287b26b9f03
**回放版本:** 3.1.5
**地图:** `dual-lanes`（双线抉择，半径8六边形，上路偏经济、下路偏前线部署，中部障碍阻断直通）
**玩家:** GLM5.1-PI（PI@glm5.1）
**席位与出生:** `player_b`，行动顺序第1（`turnOrder=["player_b","player_a"]`），HQ(-7,0)
**参战人数/最终名次:** 2 / 第2名
**结果:** ❌ 存活至第15轮（轮数上限），裁决落后 408 分
**结束原因:** `turn_limit_score`
**最终补给/HQ/总分:** 50 / 180HP（未受伤）/ 1198 分

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_a` | doubaoseed2.1pro-PI | 存活 | 1606 | +408 | 控制点 4:2（权重90）、军力 418:304，据点+军力两项净赚 +388 |
| 2 | `player_b` | GLM5.1-PI（我） | 存活 | 1198 | — | — |

> 五项裁决分逐项对比：HQ伤害 0 vs 0；HQ HP 180×2=360 vs 180×2=360；据点 2×90=180 vs 4×90=360；军力 304×2=608 vs 418×2=836；补给 50×1=50 vs 50×1=50。总分 1198 vs 1606，净差 -408。最大单项劣势是**据点 -180**（2:4）与 **军力 -228**（304:418）。HQ 双方均未受伤（180HP），补给持平 50。胜负完全由据点数与军力价值决定，而据点数又直接驱动了军力差距（对手据点多→收入多→多部署）。

---

## 核心教训

### 致命错误1：开局把兵力全砸在侦察兵+重装上，未抢占经济据点，经济被对手反超

**问题:** 第1轮我方席位回合（seq4-7），我用 208 起始补给一次性部署 4 个单位：scout×3（38×3=114）+ heavy×1（92），共花费 **206 补给，剩余仅 2**。部署位置集中在 HQ(-7,0) 邻位 (-6,-1)(-6,0)(-7,1)(-8,1)。4 个单位全部 `hasMoved=true`（部署当轮不能移动），整轮无法抢占任何据点。

**对比对手第1轮（seq11-14）：** 对手 `player_a` 同样花光 5 个行动点，但只部署 4 个单位（scout×2 + heavy + infantry = 38+38+92+45=213，超出补给是因为我只剩 2 而对手剩 0，实际双方基本见底）。关键差异在第2轮：对手第2轮（seq27-30）用 scout 抢占 cp_ne(6,-4) supply 与 cp_se(2,4) forward_base，而我第2轮虽让 9eecf3d9 占了 cp_sw(-6,4)，但起步晚、据点位置分散。

**损失量化：**
- 对手从第2轮起稳定持有 cp_ne(supply,+12) + cp_se(forward_base,+8) = 每轮 +20 据点收入；我仅有 cp_sw(+8) = 每轮 +8。**据点收入差 -12/轮**。
- 对手 `forward_base` 的 deployDiscount=8 在第3-15轮共为其 8 次步兵部署（37×8）节省 8×8=64 补给。我没有任何 forward_base 折扣（cp_sw 虽是 forward_base 但我从未在其邻位部署过单位）。
- 到第3轮，对手补给 30/轮收入 vs 我 38/轮（我占 3 点：cp_nw supply+12、cp_sw fb+8、cp_sc repair+8 = +28 + 基础 10 = 38；对手 cp_ne+cp_nc+cp_se = +28 + 基础 10 = 38）。看似持平，但对手从第3轮起据点数始终 ≥ 我，且持续向前线 forward_base 增兵。

**正确做法:** 起始 208 补给不应一次性梭哈 4 个单位（2 scout + 1 heavy + 1 scout）。第1轮应保留至少 1 个行动点部署 1 个 scout 立即向 cp_nw(-2,-4) 或 cp_sw(-6,4) 推进；或部署更少单位（2 scout+1 infantry = 121，留 87 补给）以便第2轮快速补兵。**侦察兵每轮收入 12 的 supply 据点（cp_nw/cp_ne）是这张图的经济命脉，必须在第1-2轮抢占。**

### 致命错误2：中央 blocker 墙与水域完全锁死重装，heavy 全局未对敌 HQ 造成任何威胁

**问题:** dual-lanes 的中央地形是：q∈[-2,2] r=0 全部 blocker，q∈[-1,2] r=-1 与 q∈[-2,1] r=1 全部 water。这形成一道从 r=-1 到 r=1 的东西向屏障，只有 r≤-2 或 r≥2 能绕行。

我方 heavy `b7dbd16d`（HQ(-7,0) 出生）全程移动轨迹：R1 部署(-7,1)→R2 (-5,0)→R3 (-3,0)→R4 (-2,-1)→R5 (-3,1)→R6 (-3,2)→R7 (-1,2)→此后一直在 (-1,2) 与敌方 heavy 在 (0,2)/(1,2) 对峙到终局。**全程 0 次接近对手 HQ(7,0)，0 次 demolish（虽然本图 blocker 在 q=-2..2 r=0，heavy 理论上能炸开）**。

对手 heavy 同样被墙阻隔，但其 `forward_base` cp_se(2,4) 允许其在东半场持续部署步兵向前线施压，绕开了墙的问题。而我的 heavy 卡在西半场中部，只能与对手 heavy 互殴。

**为什么致命：**
- 终局裁决 HQ伤害 0:0，双方都未破 HQ。但对手通过据点+军力碾压取胜，我方 heavy 的 150HP 价值（×2=300 军力分）虽在，却**没有转化为 HQ 伤害分（权重4）**。
- 我在第4轮让 heavy 到 (-2,-1)（blocker (-2,0) 的邻位），本可以 demolish 炸开 (-2,0)，打通北路 r=-1 通道——但我选择了移动而非爆破，随后 heavy 被调入南路 (-3,1)→(-1,2)，北路机会永久丧失。

**正确做法:** 第4-5轮 heavy 在 (-2,-1) 时，用 demolish 炸开 (-2,0) blocker，配合 ranger 从 r=-2 北路东进威胁对手 HQ(7,0)。本图最大单格权重是 controlPoint(90)，但 HQ伤害权重 4 × 满血 180 = 720 潜在分，一旦破墙形成 HQ 威胁，收益远超原地与对手 heavy 对耗。

### 致命错误3：第12轮为追杀敌方残血 scout，主动撤离 cp_nw，导致终局据点从 3 降到 2

**问题:** 第12轮我方席位回合（seq216-217），我命令 cp_nw(-2,-4) 上的 scout `d8787234`（55HP）从 (-2,-4) 移动到 (-1,-4)，去攻击敌方残血 scout `56b58bb5`（当时 14HP，位于 (0,-4)，我造成 10 伤害使其降至 4HP，但**未能击杀**）。seq216 的这次移动让 cp_nw 在我回合结束时**失去占领单位**。

第13轮起 cp_nw 实际上仍显示 owner=player_b（因为据点归属在回合结束时按单位位置重算，而对手也没有单位立刻站上去），但我在第15轮（seq278）才把 scout 移回 (-2,-4)。然而对手在第15轮（seq284）让步兵 `3a2d7b4f` 从 (-1,4) 移动到 **(-2,4)** 占领了 cp_sc（seq289 `control_point_captured owner=player_a`），夺走了我的 cp_sc！

**最终据点归属（game_over 时）：**
- player_a: cp_nc(2,-4) + cp_ne(6,-4) + cp_se(2,4) + **cp_sc(-2,4) [第15轮夺取]** = 4 个
- player_b: cp_nw(-2,-4) + cp_sw(-6,4) = 2 个

**第15轮 cp_sc 的丢失才是真正的致命一击：** 我的 scout `3e0436f8` 在第14轮（seq264）被对手步兵 `3a2d7b4f` 打死在 (-2,4)，cp_sc 失去了守军；第15轮对手步兵直接站上 (-2,4) 占领。**我方 cp_sc 邻位从第14轮起就没有任何单位可以回防。**

**损失量化：** 据点差 4:2 = +180 对手优势（90/个 × 2 差）。若保住 cp_sc，比分将是 3:3，据点项持平，军力差距也会因我有据点收入而缩小，总分差距可从 -408 缩小到约 -200 以内。

**正确做法:**
1. 第12轮 scout 不应离开 cp_nw 去贪一个 14HP 的残血 scout（且还没杀掉）。cp_nw 是 supply 据点（+12/轮），守住它的价值（90 裁决分 + 12×剩余轮数收入）远超一个 scout 的人头。
2. 第14轮 scout `3e0436f8` 在 cp_sc(-2,4) 被打死时，应立即（第14轮当回合或第15轮）从 HQ 部署新单位回防 cp_sc 邻位，或在 cp_sc 上保留第二个占领单位。我部署了 ranger(08a24e62) 在 (-6,0) 和 infantry(e4aedee7) 在 (-8,0)，**都在远离 cp_sc 的后方**，完全无法回防。

---

## 关键时间线

| 整轮/席位回合 | 补给/行动点 | 我的操作 | 对手 `player_a` 响应 | 问题或收益 |
|---------------|-------------|----------|----------------------|------------|
| 第1轮 / `player_b` | 208→2 / 5 | deploy scout×2@(-6,-1)(-6,0)、heavy@(-7,1)、scout@(-8,1) | — | ❌ 梭哈4单位，全部 hasMoved 无法占点，留 2 补给无余地 |
| 第1轮 / `player_a` | 208→15 / 5 | — | deploy scout(7,-1)+heavy(7,1)+infantry(8,-1)+scout(6,1) | 对手同样梭哈，但 heavy+infantry 体系更均衡 |
| 第2轮 / `player_b` | 12→? / 5 | scout d8787234→(-3,-3)、9eecf3d9→(-6,4)占cp_sw、heavy→(-5,0)、993c53f2→(-4,2) | — | ✅ 占 cp_sw(forward_base)，但未利用 forward_base 部署折扣 |
| 第2轮 / `player_a` | — | — | scout 占 cp_ne(supply)、scout 占 cp_se(forward_base)、heavy→(5,1)、infantry→(6,-2) | ❌ 对手抢下 2 点含 1 supply，经济反超 |
| 第3轮 / `player_b` | 38 / 5 | 占 cp_nw(supply)+cp_sc(repair)，据点数 3:3 持平 | — | ✅ 本轮是据点最佳时刻，3:3 追平 |
| 第3轮 / `player_a` | 30 / 5 | — | deploy infantry@cp_se(3,4)(折扣后37)、scout→cp_nc(2,-4)、heavy→(3,1) | 对手据点达 3，并用 forward_base 折扣部署 |
| 第4-5轮 | — | scout 攻对手 scout、heavy 卡墙根、deploy infantry | 对手 heavy 推进至 (2,2)、infantry 围攻我 scout | ❌ 我方 scout 9eecf3d9 第5轮(seq83)阵亡，丢 cp_sw 方向前沿 |
| 第5轮 / `player_a` | — | — | deploy scout(3,3)(seq88)，开始多线施压 | 对手单位数 6 vs 我 5，据点收入持续投入前线 |
| 第7轮 / `player_b` | — | heavy (-1,2) 攻敌 heavy(0,2) 28伤、infantry(-1,3) 攻 heavy、scout(-2,-4) 攻敌 scout、heal heavy | — | ✅ 集火敌 heavy 是正确的，但 heavy 卡在墙前无法转进 |
| 第8轮 / `player_b` | — | heavy 攻敌 heavy 至 3HP、heal heavy、scout 攻敌 scout 至 27HP | — | ✅ 几乎击杀敌 heavy，战术执行不错 |
| 第9轮 / `player_a` | — | — | deploy ranger(2,3)、infantry 推进 | ❌ 对手 ranger 上线，我方 ranger 未就位 |
| 第10轮 / `player_b` | — | heavy 攻敌 heavy(3HP)→击杀前最后一击未到、heal、deploy heavy@HQ(-6,0) | — | ❌ 我新 heavy 部署在后方，需多轮才能上前 |
| 第11轮 / `player_b` | — | heavy 击杀敌 heavy(722730be, seq189)、ranger(-3,1) 部署、scout 攻敌 scout、deploy heavy | 对手 deploy heavy(0,2) 补位、ranger(0,3) 上线 | 击杀1 heavy 但对手立刻补 heavy+infantry，据点 3:3→我仍3 |
| 第11轮 / `player_a` | — | — | 新 heavy 攻我 heavy -25、ranger 攻我 infantry -35（seq199 死亡）、scout 推进 | ❌ 我 infantry(29dbcca1) 阵亡，cp_sc 守军丧失 |
| 第12轮 / `player_b` | — | **scout d8787234 离开 cp_nw 追杀残血[失误]**、ranger(-3,3) 击杀敌 scout a1a03e73(seq213)、heal heavy、heavy(-4,0)推进 | — | ❌ cp_nw 失守军；✅ 击杀敌 scout 是高光 |
| 第13轮 / `player_b` | — | ranger 攻敌 ranger(42伤)、heavy 攻敌 heavy、scout 攻敌 infantry、heal、heavy 推进(-2,-1) | — | 战术执行尚可，但 ranger 暴露 |
| 第13轮 / `player_a` | — | — | 敌 heavy 攻我 heavy、ranger 攻我 ranger -39(seq244 死亡)、infantry(-1,-2) 攻我 heavy、deploy infantry(5,-4) | ❌ 我 ranger c480ccac 阵亡，远程火力归零 |
| 第14轮 / `player_b` | — | heavy 攻敌 infantry、heavy 攻敌 heavy、scout 攻敌 infantry、heal、deploy ranger@HQ | — | 新 ranger 又在后方，前线少1人 |
| 第14轮 / `player_a` | — | — | 步兵 3a2d7b4f **打死我 cp_sc 守军 scout 3e0436f8**(seq264)、ranger 攻我 support -36、deploy infantry(1,5) | ❌ **cp_sc 守军阵亡，据点即将易主——决定性事件** |
| 第15轮 / `player_b` | — | heavy 击杀敌 ranger fe01d779(seq274)、heavy 攻敌 infantry、heal、deploy infantry@(-8,0)、scout 回 cp_nw | — | ✅ 击杀敌 ranger，但已无法挽回 cp_sc |
| 第15轮 / `player_a` | — | — | 步兵 3a2d7b4f (-1,4)→**(-2,4) 占领 cp_sc**(seq289)、scout→(-1,3) | ❌ **cp_sc 易主，据点 4:2 锁定败局** |

> **决定性事件链：** 第14轮 seq264 我 cp_sc 守军 scout 阵亡 → 第15轮 seq289 对手步兵站上 cp_sc。这一进一退让据点差从 3:3 变成 2:4，直接锁定 -180 的据点裁决差距。根源在于我第11轮失去 cp_sc 的第二守军 infantry 后，从未回补守军。

---

## 补给与分数账本

**实际情况:**
- 部署（11 个单位，回放统计）：scout×4（38×4=152）+ heavy×2（92×2=184）+ infantry×2（45×2=90）+ support×1（60）+ ranger×2（78×2=156）= **642 补给总花费**
- 据点收入（按各轮 income 事件累计）：基础 10×14 + 据点收入。从 income 事件看，R2 起 player_b 收入波动在 10→18→38，R3 后稳定 38（3 据点：cp_nw 12 + cp_sw 8 + cp_sc 8 = 28 + 基础 10 = 38）。14 轮约 (10+18+38×12) ≈ 484
- 初始 208 + 收入约 484 − 部署 642 = **50**（与 finalResult.supplies=50 一致 ✓）
- 最终五项裁决分：HQ伤害 0×4=0、HQ HP 180×2=360、据点 2×90=180、军力 304×2=608、补给 50×1=50，**总分 1198**
- 单位损失：5 个阵亡（scout×2、infantry×1、ranger×1、cp_sc 守军 scout×1）；对手阵亡 3 个（heavy 722730be、scout a1a03e73、ranger fe01d779）

**对手账本对比:**
- 部署（14 个单位）：scout×3 + heavy×2 + infantry×8 + ranger×1 = 38×3+92×2+45×8-8(折扣)+78×1... 对手大量利用 cp_se forward_base 折扣（deploy cost 37 for infantry）
- 最终五项：HQ伤害 0、HQ HP 360、据点 4×90=360、军力 418×2=836、补给 50，**总分 1606**
- 对手多部署 3 个单位（14 vs 11），infantry×8 的人海战术+forward_base 折扣是军力碾压的来源

**正确策略估算（假设性，非事件事实）:**
- 第1轮保留补给不全梭哈（deploy 2 scout+1 infantry=121，留 87）：第2轮可立即补 deploy+rush cp_nw，据点争夺更主动
- 第4-5轮 heavy 在 (-2,-1) 时 demolish (-2,0) blocker：打通北路，ranger 可东进威胁 HQ，HQ伤害项预期 +200~+400
- 第12轮不调离 cp_nw scout、第14轮回防 cp_sc：据点保 3:3，据点项 +90、军力收入差缩小预期 +60~+100
- **预期差距：** 据点 +90~180、HQ伤害 +200~400、军力 +60~100，总分差距可缩小至 -50 以内甚至反超。但以上为假设，对手 infantry 人海+forward_base 体系仍很强。

---

## 经验教训

### ✅ 做得好的

1. **第7-11轮的 heavy 集火战术**：连续多轮用 heavy + infantry + heal 集中攻击对手 heavy `722730be`，最终第11轮 seq189 将其击杀（对手 heavy 从 150→0，累计承受我方 heavy 28+28+24+22+23=125 + infantry 15+16+14=45 共 170 伤害）。这是本局最成功的战术执行。
2. **support + repair 据点的治疗体系**：support 949c0eec 配合 cp_sc repair 据点，让我方 heavy 在被对手 heavy+ranger 围攻下仍能持续回血（heal 事件 seq137/154/172/214/235/256/276 共 7 次），heavy `b7dbd16d` 从未阵亡（终局仍存活）。
3. **ranger 远程击杀**：第12轮 seq211-213，ranger c480ccac 从 (-3,3) 两格外击杀对手 scout a1a03e73（40 伤害一击），是高价值的远程补刀。
4. **侦察兵 rush 抢点**：第2-3轮快速用 scout 占领 cp_nw + cp_sw + cp_sc 三个据点，短暂追平 3:3。

### ❌ 致命失误

1. **第1轮梭哈 4 单位留 2 补给**——开局无经济余地，第2轮收入仅 12 几乎无法补兵。（seq4-7）
2. **全程 0 次 demolish**——heavy 多次在 blocker 邻位（(-2,-1) 邻 (-2,0)、(-3,0) 邻 (-2,0)）却从未开墙，ranger/heavy 被中央屏障困死西半场，全程 0 HQ 伤害。（整个回放无 terrain_demolished 事件）
3. **第12轮为追残血 scout 调离 cp_nw 守军**——贪一个 14HP 的人头（还没杀掉），丢了 supply 据点的守军，cp_nw 在终局前长期无单位。（seq216）
4. **第11轮 cp_sc 第二守军 infantry 阵亡后未回补**——29dbcca1 在 seq200 死亡后，cp_sc 只剩 scout 3e0436f8 单层防御；第14轮该 scout 被打死，cp_sc 无人回防被对手占领。（seq200→seq264→seq289）
5. **未利用 forward_base 部署折扣**——cp_sw(-6,4) 是 forward_base（deployDiscount=8），但我从未在其邻位部署过任何单位，11 次部署全部从 HQ(-7,0) 出发，白白浪费折扣。
6. **ranger 部署过晚且位置靠后**——2 个 ranger 分别在第9轮(-6,0)、第14轮(-6,0)部署，均远离前线，需 2-3 轮才能进入射程，实际有效输出仅第12-13轮的 2 次攻击。

### 🔑 核心教训
> **"据点是命根子，守军不贪人头；forward_base 要用来部署；重装该开墙时别犹豫。"**

---

## 与历史对局的共同教训

1. **与 tg_0048（PI@minimaxm3 败局）完全相同的"据点守军真空导致终局易主"教训：** tg_0048 中 PI 在 breach 地图因第14轮 cp_w 被远距离突袭（邻位长达6轮无巡逻单位）而丢180分输24分；**本局我在 dual-lanes 同样因 cp_sc 守军阵亡后未回补，第15轮被对手步兵直接占领**。两局的失败根因如出一辙：**占据据点后不设第二层防御，一旦守军阵亡据点立刻易主**。controlPoint 权重高达90（本局）/75（tg_0048），一个据点的得失就是 180/150 分的裁决差。本局失误更致命（权重90×2点差=180 vs tg_0048 的75×2=150）。

2. **与 tg_0049（PI@glm5.2 败局）相同的"全程 0 次 demolish"教训：** tg_0049 中 PI 在 forge 地图让 heavy 多次停在 blocker 邻位却从不爆破，被中央墙困死；**本局我在 dual-lanes 同样如此**——heavy 在 (-2,-1) 邻接 blocker (-2,0)，本可炸开通路却选择移动。两张有中央屏障的地图（forge 十字墙、dual-lanes 东西墙+水域），heavy 的 demolish 都是关键战术手段。连续两局犯同样的错，说明 PI 在"屏障地图"上的 heavy 决策模板缺失。

3. **与 tg_0049 的"开局梭哈"对比：** tg_0049 中 glm5.2 开局 deploy 4 单位（ranger×3+infantry）留少量补给；本局我开局 deploy 4 单位（scout×3+heavy）留 2 补给。两局都因开局不留补给导致第2轮经济窘迫。**开局应 deploy 2-3 单位并保留 60+ 补给应对第2轮补兵。**

4. **dual-lanes 地图的新发现：** 本图 6 个据点中，supply 据点（cp_nw 北、cp_ne 东北）提供 +12/轮 收入，是经济核心；forward_base（cp_sw 西南、cp_se 东南）提供部署折扣，是前线核心。**南北两线的抉择上，北路（r=-4 一线含 2 supply+1 repair）经济价值高于南路（r=4 一线含 2 forward_base+1 repair）**。我方（player_b，HQ 在西）应优先抢占北路 cp_nw + cp_nc，确保 supply 收入。本局我虽占了 cp_nw 但因追杀调离，cp_nc(2,-4) 始终被对手占据，北路 supply 我只拿到 1/2。

---

## 下次的正确策略

```text
第1轮 / player_b（HQ -7,0，先手）:
  - 初始 208 补给：deploy scout×2（-6,-1 向北、-6,0 中路）+ infantry×1（-7,1 向南）= 121 花费，留 87
  - 不梭哈，保留行动点：4 动作用满但留至少 2 个单位可在第2轮立即移动抢点
  - 目标据点优先级：cp_nw(-2,-4) supply > cp_sw(-6,4) forward_base > cp_sc(-2,4) repair

第2轮 / player_b:
  - scout d8787234 全力冲 cp_nw（-6,-1→-3,-3→-2,-4 两轮到位）
  - scout 9eecf3d9 冲 cp_sw（-6,0→-6,4，move 5 可达）
  - 在 cp_sw forward_base 邻位（如 -6,3 或 -5,4）部署步兵享受 -8 折扣

中盘触发条件:
  - heavy 到达 blocker 邻位（(-2,-1) 邻 (-2,0)、(-3,0) 邻 (-2,0)）且对手在墙后 → 立即 demolish (-2,0) 开北路通道
  - 任何据点守军 HP < 30 → 立即从 HQ 部署新单位回防，或召回邻近单位；据点邻位常驻第二层防御
  - 补给 >100 且据点 ≤2 → 优先出 heavy(92)+support(60)，利用 forward_base 折扣出 infantry(37)
  - 侦察兵绝不离开已占领的 supply 据点去追杀人头（除非确认能一击必杀且当轮回位）

终局检查（最后2轮）:
  - 逐一确认每个己方据点上有单位驻守，且邻位有第二层防御
  - 五项裁决分：据点差×90 是最大权重，宁可不攻击也要保据点
  - ranger/heavy 必须移动到能命中对手 HQ 的位置（本图需绕行 r≤-2 或 r≥2，提前 2 轮机动）
  - 若 HQ 双方均未受伤，HQ伤害项为0，胜负完全靠据点+军力，据点数必须 ≥ 对手
```

---

**一句话总结：开局梭哈留2补给、全程不破墙困死重装、为追残血丢 cp_nw、cp_sc 守军阵亡后不回补被终局占领——据点2:4与军力304:418的双重溃败，408分差距是开局经济与终局据点防守的双重失败。**
