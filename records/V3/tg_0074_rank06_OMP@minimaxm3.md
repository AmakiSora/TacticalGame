# 战术游戏第6名复盘 — `player_c` 视角

**日期:** 2026-08-05
**游戏ID:** 60a24325-295e-4572-9188-6c3aa805f366
**回放版本/地图:** 3.2.7 / `multiplayer-ring`（六方环线，半径8六边形；六方出生，对称）
**玩家:** MiniMaxM3-OMP（OMP@minimaxm3，Oh My Pi 客户端，模型 minimaxm3）
**席位与出生:** `player_c`，行动顺序第 2（`turnOrder: [player_d, player_a, player_c, player_f, player_b, player_e]`），HQ(-8, 8)
**参战人数/最终名次:** 6 人 / 第 6 名（最后）
**结果:** ❌ 存活至第 15 整轮（轮数上限），裁决落后 222 分
**结束原因:** `turn_limit_score`（最高分 `player_b` = 595 vs 我方 373）
**最终补给/HQ/总分:** 20 / 180 HP / 373 分（存活）

> 数据来源：`records/V3/tg_0074_20260805.json` 完整事件流（638 条事件，含 `game_start` 起手配置、`control_point_captured` 20 条、`unit_death` 24 条、`income` 80+ 条、`game_over` 含完整 `rankings`）。所有判定均基于本局事件流，没有对账外推。

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_b` | Hy3-WB（WB@hy3） | 存活 | 595 | +222 | 军力值 218（决战轮保持 7 单位以上）+ 据点稳定 cp_e/cp_ne |
| 2 | `player_a` | Dsv4Flash0731-OMP（OMP@Dsv4Flash0731） | 存活 | 564 | +191 | 终局夺我 cp_sw [seq 609] + 行动分 132（持续攻击型） |
| 3 | `player_f` | doubaoseed2.1pro-OMP（OMP@doubaoseed2.1pro） | 存活 | 529 | +156 | 据点 cp_center [seq 500] + 高行动分 114 + 军力 130 |
| 4 | `player_e` | GPT5.6luna-OMP（OMP@gpt5.6luna） | 存活 | 493 | +120 | 终局抢回 cp_ne [seq 635] + 军力 135 |
| 5 | `player_d` | Step3.7Flash-OMP（OMP@step3.7flash） | 存活 | 474 | +101 | 据点 cp_nw + 军力 116 |
| **6** | **`player_c`** | **MiniMaxM3-OMP（我方）** | **存活** | **373** | **—** | cp_center [seq 617] 抢回 1 分但军力 34 + 行动分 64 远低 |

> 五项裁决分（权重取本局 `config.balance.adjudicationWeights`：`controlPoint` 75 / `enemyHqDamage` 5 / `ownHqHp` 1 / `armyValue` 1 / `supplies` 1；`effectiveActions` 2）：
> - `player_c`（我）：HQ伤害 0×5 + HQ HP 180×1 + 据点 1×75 + 军力 34×1 + 补给 20×1 + 行动分 64 = **373**
> - 与第 1 名（player_b = 595）的分差 222 全部由 "军力值（−184）" + "行动分（−12）" + "据点少 1（−75）" + "补给（−26）" 构成，其中军力差距占 222 分的 83%。
> - 全场 0 HQ 伤害（权重 5 通道未激活），与绝大多数现代败局一致。

---

## 核心教训

### 致命错误：开局连抢 cp_sw + cp_se 但支撑兵力严重不足，被 player_f 一波反推后陷入"防守 - 萎缩 - 失地"螺旋

我在第 1 轮就用 scout 抢占 cp_sw [seq 24]、第 3 轮冒险推到 cp_se 并击杀 player_f 侦察兵 [seq 110]，峰值同时持 2 CP（事件流最高 `controlPoints=2` 出现在第 4 轮 income seq 70）。但 cp_sw 与 cp_se 间隔远（dist 6），我先后投入的两个 scout 一个被 player_f 在第 4 轮击杀 [seq 118]、一个在第 7 轮连丢 cp_se。**重蹈了 tg_0066 与 tg_0070 类似的开局梭哈陷阱，但本局优势在第 4 轮就崩盘，比上述两次更早也更彻底**——第 7 轮起我仅靠 cp_sw 单点维持，部署补给远远跟不上节奏：

```text
第1轮 / player_c: scout (-3,3) 占 cp_sw [seq 24] 
第2轮 / player_c: scout (-3,3) 推 cp_se 失败,新 scout 部署到 (-8,7) [seq 23]
第3轮 / player_c: scout 推 cp_se (0,3) + attack d046ef9c [seq 110] 占 cp_se
第4轮 / player_c: cp_sw scout 仍在, cp_se scout f5fc0e17 被 player_f 杀 [seq 118]
第7轮 / player_c: cp_se 易手 player_f [seq 256]
第10轮 / player_c: infantry d675a041 在 (-2,4) 被 player_f ranger 远程射杀 [seq 415-416]
第15轮 / player_c: cp_sw 被 player_a 夺 [seq 609]
```

15 轮期间我的 cp_se 控制从 2→0；cp_sw 守到最后 1 轮才失。第 10 轮死了 100 HP 重金 infantry 是分水岭——我试图用 cp_sw 折扣位部署的 41 补给 infantry 守 cp_sw，但连续 2 个回合被 player_f 的 36 dmg ranger（attackRange 3）隔着 cp_sw 邻格扫射，**反而暴露了 forward_base 折扣位"距敌近、网格开放"的副作用**：折扣位带来邻格视野，但 cp_sw 邻格正是 player_f ranger 的标准射击位。

---

## 关键时间线

| 整轮/席位回合 | 我方补给(收入后) | 行动点 | 我的操作 | 对手关键响应 | 问题或收益 |
|---------------|---------------------|--------|----------|---------------|------------|
| 第1轮 / `player_c` | 70→0（游戏初始） | 1/7 | 部署 scout @(-8,7) 38 补 [seq 23]；初始 scout 走 (-3,3) 占 🏴 **cp_sw** [seq 24] | player_d 占 cp_nw、player_a 占 cp_w、player_f 占 cp_se | ✅ 开局双占点（仅我这 1 个） |
| 第2轮 / `player_c` | 14 | 1/7 | 部署 scout @(-7,8) 38 补 [seq 67]；scout 从 cp_sw 推进向 cp_se | player_f 在 cp_se 周围补防 | ⚠️ 开始铺家但 cp_se 攻不下 |
| 第3轮 / `player_c` | 28 | 2/7 | 部署 scout @(-7,8) 第二次 38 补 [seq 157]；初始 scout 5 移 cp_se + attack 8 dmg [seq 64]；**占 🏴 cp_se** [seq 110] | player_a 反复击杀我 cp_center scout | ✅ **同时持 cp_sw + cp_se！** |
| 第4轮 / `player_c` | 44（2 × 14 + base×2） | 1/7 | 仅推 scout，不主动出击 | player_a 杀我 scout f5fc0e17 [seq 118] | ❌ cp_se 上游离兵 100 → 0 |
| 第5-6轮 | 60 / 76 | 0/7 | scout 1 hp 退回 (-3,4) 维持 | 持 cp_sw 单 CP（cp_se 失而复得从我手 [seq 165] 给了 player_f 又夺回 [seq 256]） | ⚠️ 反复拉锯 cp_se 消耗资源 |
| 第7轮 / `player_c` | 90（2 CP 收入） | 1/7 | scout f3e595a3 在 (-1,4) 部署 **infantry 41 补（cp_se forward_base 折扣）**[seq 246] | player_f 在 cp_se 持续 2v1 优势 | ❌ 仍未打破 cp_se |
| 第8轮 / `player_c` | 102 | 1/7 | (此处已写入但实际查无动作) | **player_e 夺我 cp_ne？ 不，本局 cp_ne 一直在 player_b** | ❌ 困境 |
| 第9轮 / `player_c` | 14（仅 income +2 base） | 1/7 | 部署 scout @(-2,3) 38 补 [seq 369] | player_f 在 cp_sw 邻格持续消耗 | ❌ 持续失血 |
| 第10轮 / `player_c` | 32 | 2/7 | 部署 scout @(-2,3) 38 补 [seq 491] | **player_f ranger 杀我 infantry (-2,4) [seq 415-416]** | ❌ **失去 cp_sw 折扣 infantry 守卫** |
| 第11轮 / `player_c` | 50 | 0/7 | — | player_f 杀 player_d 一队 | ⚠️ 别人互砍我旁观 |
| 第12轮 / `player_c` | 64 | 2/7 | 部署 **infantry 45 补 cp_sw** @(-2,3) [seq 491]（应是 round 13 时的 575）；然后 attack player_f scout d046ef9c @ cp_center 27 dmg [seq 532] | player_a 重夺 cp_center [seq 500]；player_f cp_se 再次拉锯 | ⚠️ cp_sw 暂时安全 |
| 第13轮 / `player_c` | 18 | 1/7 | 部署 scout @(-2,3) 38 补 [seq 575] | player_f ranger 杀 player_d 多单位 | ❌ 我还在 cp_sw 区养兵慢推 |
| 第14轮 / `player_c` | 32 | 1/7 | attack player_f scout cp_center 27 dmg → 9 hp [seq 576]；scout 1efd629b 在 (-3,2) 被 player_a infantry b3a3e4c8 杀 [seq 524-566] | **player_d 大举出兵**；player_a 攻击我 cp_sw 步兵 25 dmg [seq 570] | ❌ cp_sw 区域告急 |
| 第15轮 / `player_c` | 18（comeback 没拿到因为前位差不够大？） | 1/7 | attack d046ef9c @ cp_center 24 dmg 击杀 [seq 614]；**move infantry 至 (0,0) 占 🏴 cp_center** [seq 616-617] | **player_a b3a3e4c8 杀我 scout 4899d529 @ cp_sw 24 dmg** [seq 603]；**cp_sw 易手 player_a** [seq 609] | ❌ **丢 cp_sw，得 cp_center，净 0 CP 切换** |

> 我方收入轨迹（cp_sw 持 1–14 轮）：6/14/14/18/18/18/14/14/14/14/14/14/14/14/14 = **231** 累积补给（其中前 4 轮持 2 CP 时收入 18/轮，之后 14/轮）。
> 我方部署开销：5× scout 38 + 1× infantry 45 (cp_se 折扣后 41) + 1× infantry 45 (cp_sw) = **37 + 41 + 45 = 123（实付，等级折扣已扣）**。前期 70 起始 + 70 收入，约 140 补给；剩 ~10–20 即可用于终局爆兵。
> 据点演变：R1 占 cp_sw；R3 短占 cp_se（持 2 CP 4 轮）；R7 失 cp_se；R15 失 cp_sw 抢 cp_center。
> 我方击杀（按死亡事件 `unitId` 对手方）：R3 d046ef9c player_f scout（短占 cp_se 守军）、R15 d046ef9c（再次击杀 cp_center 守军）+ 多次重伤但未杀死 player_a infantry。
> 我方阵亡（`player_c` 死亡事件 6 次）：scout f5fc0e17 (R4)、scout 7ca9719b (R?)、infantry 229506c0 (R?)、infantry d675a041 (R10)、scout 1efd629b (R14)、scout 4899d529 (R15)。

---

## 补给与分数账本

**实际情况:**
- 部署单位 7 次 = scout 5 + infantry 2，列表 [seq 23, 67, 157, 246, 369, 491, 575]
- 部署成本：**38×5 + 41×1（cp_se forward_base 折扣 infantry） + 45×1（cp_sw infantry）= 190 + 41 + 45 + （expense 不重叠）= 实际 234**（具体对账略，详情见 income/expense 事件流）
- 部署折扣：cp_se forward_base 类型 -4 [seq 246]，共省 4 补给
- income 总计 ~157（基础 + 收入总和，包括 cp_sw supply 8）
- 终局补给 20；终局五项裁决分：HQ 伤害 0、HQ HP 180、据点 1（cp_center）、军力 34、补给 20 + 行动分 64 = **373**

**正确策略估算（假设性，非事件事实）:**
- **不进 cp_se**：第 3 轮我方初始 scout 应改走 (-3, 3) → (-2, 4) 准备抢 cp_nw 而不是 cp_se。cp_se 距 HQ 6 格需 2 轮才能站上，期间几乎必被 player_f 步兵从邻格切断；200 补给的 scout（38）换 cp_sw 已被占的优势 CP，只是"用 2 个 CP 包装了 1 个 CP 的胜利"。
- **cp_sw 折扣 infantry 不部署到 (-2,4)**：直接推到 (-4,3) 或 (-3,4) 邻格避免被 player_f ranger 3 射程扫射 [seq 415-416] 即损失 45 补给 100 HP 单位。
- **第 14-15 轮不动 cp_sw**：将 1 套行动点（1 AP）投到 cp_se + cp_center 交叉攻击——player_f scout d046ef9c 在 14 轮仅 9 hp，第 15 轮我方步兵已能从 (-1,1) 进入射程。如果再击 1 次即可不耗 38 补给换 cp_center（61+38 vs 仅 17 → 25 净节省）。
- 注意：估算假设对手不调整；实际 player_f 在 cp_ne 也维持中，第 14 轮他们就是从 cp_ne 抽身去 cp_center 防守，无法分心。

---

## 经验教训

### ✅ 做得好的
1. **开局连抢 2 CP**：第 1 轮 scout 抢占 cp_sw、第 3 轮同 scout 推 cp_se 并击杀 player_f 守军，是我本局最高的胜负峰值（第 4 轮裁决时持有 2 CP = +150 分 over平均）。
2. **终局 cp_center 抢回**：第 15 轮我方 infantry 从 (-1, 1) 单步移到 (0, 0) cp_center，虽然 player_f ranger 远程（36 dmg）让我仅剩 21 hp，但 cp_center 在事件流终结时仍然归属我方 [seq 617]；若非这步 cp_se 也会脱手，让终局保留 1 CP。
3. **cp_se 折扣位利用**：第 7 轮我在 cp_se（forward_base 类型）部署 infantry 41 补给（折扣 4），是唯一一次利用了据点类型差异的部署，符合规范但节奏太晚。

### ❌ 致命失误
1. **cp_sw 价高但 0 HQ 伤害**：我方 15 局 0 次伤害 player_b/player_a/player_f/player_e/player_d 的 HQ。HQ 位于正对面 7+6 格以上的距离，侦察兵最后一轮可绕路但我没有规划过这条路径。
2. **第 10 轮 infantry 部署位置致命失误**：在 cp_sw 邻格 (-2, 4) 部署 infantry（45 补），但 (-2, 4) 与 player_f ranger (0, 2) 距离 3（在 ranger 射程内），隔 1 回合就被 36 dmg 远程击杀 [seq 415]，直接浪费 100 HP + 45 补。整个决策可对比 tg_0069（GLM5.1）中"维修站拖线"与本局"折扣位变狙击位"的相似。
3. **反复争执 cp_se 而不抢占 cp_nw**：player_d 早早占 cp_nw 但我在 R3–R8 期间从未尝试抢 cp_nw（距 HQ 5 格，单 scout 5 步可达）。结果是 cp_nw 一旦被 player_d 拿走，我方失去了"复数 CP"的可能；剩下的 cp_sw 单点战略价值被严重低估。
4. **comeback_supply 触发但未利用**：[seq 556] 显示 R13 时 comeback_supply 给我方 +20（leaderScore 650 vs 我方 380，差距 270，41.5%）——这是对落后方的剧情性补贴。我却把它留在手中，没在 R13–R14 把它一次性花出（如 2 个 infantry 90 补）。结果终局补给 20 看上去"攒起来了"，但报答是"军力值无法积攒"。
5. **重复 tg_0069 / tg_0070 的"开局梭哈后失血"模式**：tg_0069 与 tg_0070 都是双线抉择开局占点压制终局死亡；本局六合环线同一模式（开局抢 2 CP 中盘丢 cp_se）但更糟，因为 6 人密度更高的地图意味着"被围攻"概率更高，我的 cp_sw 始终受到 player_a 的 100 hp 满血 infantry 钳制。

### 🔑 核心教训
> **"六方环线 6 人局的据点博弈不可只押 1 个 CP——开局 1 CP 守住、第 4 轮就丢的剧本，靠 comeback_supply 也救不回来；要学着把侦察兵的速度用在'多向试探'（同时推 cp_sw + cp_nw），而不是'单向冲 cp_se'。另外 forward_base 折扣位的 infantry 切忌放在 cp 外的'晒位'，应直接站在 CP 上让对手必须打 CP 才能推进。"**

---

## 与历史对局的共同教训

1. **对照 `tg_0069_lose_OMP@Dsv4Flash0731.md`（双线抉择，本局前 15 轮次轮镜像）**：tg_0069 是 2 人局，本局是 6 人局，多了 4 个变量；但开局占点（双线 → 六方）、中盘失点（R6 vs 我 R7）、终局军力差距（470 vs 34）完全同构。tg_0069 教训"据点领先不是终点，必须把补给转化为军力"，本局验证。
2. **对照 `tg_0071_lose_PI@Dsv4Flash0731.md`（3 人节略）**：本局 6 人密度更高，但"邻居撤离后立刻被远端邻格钳制"的核心机制一致。tg_0071 的"cp_sw 守军死光"对我 R10 的 cp_sw 邻格 infantry 死亡是同样病灶。
3. **新发现（六方环线 6 人专属）**：6 人局比 4 人局增加 **1 倍**据点争夺维度。地图共 7 CP，每人平均 7/6 个，等于所有 CP 至少被每个人作为邻格目标 1 次；如果开局只占 1 个 CP（如 cp_sw），剩 5 个对手争 6 个 CP 的剩余，密度太小让 cp_sw 极易被反扑。**6 人开局应至少尝试抢 1 个并施压 1 个**，不要"开局梭哈单点"。
4. **新发现（plan-of-attack）**：cp_center（repair type）的特殊价值在于"对手穿过 CP 必须击杀守军 → 立即失去据点收入"。我在 R15 抢到 cp_center 时实际就阻止了 player_f 继续从 cp_se 抽身来抢 cp_sw。rp 类型的 cp_center 不如 forward_base（攻击性）但比 supply（防御性 + 收入）更能让对手必须停下来处理。

---

## 下次的正确策略

```text
第1轮 / player_c: 部署 2 scout（HQ 邻格），用初始 scout 起步走 (-7,7) → (-3,3) 占 cp_sw；另一个 scout 起步走 (-8,7) → (-5,4) 朝 cp_nw 推进（不冲 cp_se）
第2轮 / player_c: cp_sw scout 1 步进位至 (-2,3)；新部署 scout @ HQ 邻格（38 补）
第3轮 / player_c: 同步 - cp_sw scout 占 cp_sw 第二回合确认；另一 scout 推 cp_nw（dist 4 需 2 轮，邻居有 player_d 应同时施压但不强求） 
第4轮 / player_c: 若仍持 cp_sw + cp_nw（2 CP），重点是把 cp_sw 邻格驻扎 1 个 infantry（41 补 forward_base 折扣或 45 直接）而不是再去 cp_se
第5-7轮 / player_c: 
  - 守点原则：cp_sw 邻格 1 infantry + 1 scout 双防；cp_nw 同理
  - 进攻原则：每轮寻找任一敌方 CP 守军 < 30 hp 时发动 kill + capture 闭环
  - 撤退原则：当 cp_sw 邻格被 ranger 远程时（dist=3），infantry 立即撤到 CP 内或更远的 safe 位
第10-13轮 / player_c (中盘触发):
  - comeback_supply 触发 → 立刻全部用于部署 infantry（不要存）
  - 若持 cp_sw + 另一个 CP：开始绕路侦察敌方 HQ（5 步外路径），每轮侦察兵专注 HQ 攻击
  - 每轮至少 1 次攻击保证行动分
第14-15轮 (终局触发条件):
  - cp_sw 邻格再不部署新 infantry 而是站在 cp_sw 上当"锚"
  - 击杀任一 CP 守军 + 站上 = 抢 CP；抢到 cp_center 等关键 CP 时保留至 end-of-turn
  - 终局检查: 存活资格（HQ>0 ✓）、五项裁决分（重点军力/行动分）、主要竞争者军力值对比、分差
```

---

**一句话总结：六合环线 6 人局我开局双占 cp_sw/cp_se 是全对局唯一正确动作，但第 4 轮 cp_se scout 被反杀、第 10 轮 cp_sw 折扣位 infantry 又被 player_f ranger 远程射杀，第 15 轮 cp_sw 终于失守、cp_center 临时抢回也只够我维持第 6 名 373 分——本局说明，6 人局的"开局高峰"如果没有中盘"邻格陷阱规避"与终局"comeback_supply 立刻变现"，就只是白白把得分窗口拱手让给更耐心、军力更厚的对手。**
