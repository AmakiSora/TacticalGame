# 战术游戏失败复盘 — Player B 视角

**日期:** 2026-06-24
**游戏ID:** 4e0982dc-f38e-49bd-97ce-cc28d7d60a79
**玩家名:** MiniMaxM3
**角色:** Player B (HQ位于(8,0)，右侧)
**结果:** ❌ **失败** — 第20回合达到 maxTurns 触发判定，2 CP 劣势(对方4 CP)
**对手:** {对手模型名}
**最终据点:** 我 cp_s + cp_b (2) / 对方 cp_a + cp_c + cp_n (3)

---

## 核心教训

### 致命错误: 中期僵持后第20轮被对方侦察 (0,-4)→cp_n 反超据点数,失去 income 优势

**发生了什么:**
我 T5-T19 一直维持 3:1 据点优势(我 cp_c/cp_b/cp_s,对方 cp_a),收入 55/turn vs 25/turn。但 T14 后 cp_c 反复易手、双方重装/弓手围绕 cp_c 绞杀。T20 对方侦察 (-2,-1) 跨 4 步强冲 (0,-4) cp_n,轮末占领。我 T20 仍陷 cp_c 围攻,无暇西顾 cp_n,最终回合结束时变为 2:3(我 cp_s/cp_b,对方 cp_a/cp_c/cp_n),按 adjudicate 评分 2×120=240 < 4×120=480,失败。

**为什么是致命的:**
- cp_n (0,-4) 是地图北方唯一中立 CP,T20 前一直被我忽略
- 我 T14-T19 集中火力围攻 cp_c,以为拿下 cp_c 就能 4:1 锁胜,但 cp_c 站的是 A 重装(145 HP) + 2 围兵,杀不完
- 对方 T20 孤注一掷用 scout 跨 4 步抢 cp_n,我 5 action 全部投入 cp_c 攻防,无余力应对
- maxTurns=20 的最后 1 轮,任何一方都能用 1 unit 跨多步抢 1 CP 翻盘

**正确做法:**
- T14-T16 期间,我就该派 1 个 scout 提前抢 cp_n(0,-4) —— cp_n 距我 cp_s (0,4) 4 步,距我 cp_b (4,0) 4 步,都在 scout moveRange 5 之内
- 抢下 cp_n 即 4:1 锁死据点数,后续 cp_c 攻防无意义
- 不要在 cp_c 这种高对抗点耗光 5 action —— 留 1-2 action 给"保险"操作(抢 cp_n / 杀临死目标)

---

## 回合时间线

| 回合 | supplies | 关键操作 | 战术意图 |
|------|----------|----------|----------|
| 1 | 80→15 | scout(7,1)→(4,0) cp_b, infantry(7,0)→(4,1), infantry(7,-1)→(4,-1), deploy ranger HQ→(8,-1) | 4 操作抢 cp_b 北/南布兵,1 备用 |
| 2 | 15→40 | infantry(4,1)→(1,1), infantry(4,-1)→(1,-1), ranger(8,-1)→(6,-1), scout(4,0)→(3,0) | 沿中线北/南推进,弓手后撤 |
| 3 | 40→0 | infantry(1,0) attack A scout(0,0) -22, scout(3,0)→(3,1), deploy infantry cp_b→(5,0) | 杀对方侦察 -22,中线步兵前进,部署新兵 |
| 4 | 0→25 | infantry(1,-1) attack A scout(0,0) -27 (杀), ranger(6,-1)→(4,-1), scout(3,1)→(4,0), deploy infantry cp_b→(4,-1) | **杀 A scout 夺 cp_c**(3 CP),弓手/新兵布北线 |
| 5 | 25→50 | ranger(4,-1)→(3,-1), infantry(1,0)→(0,0) cp_c, deploy infantry cp_b→(4,-1) | 重占 cp_c,弓手前推 |
| 6 | 50→75 | attack A scout(0,0) -18, ranger(3,-1)→(1,-1), infantry(1,0)→(1,1) | 围 cp_c,弓手 1 步近 |
| 7 | 75→100 | ranger(1,-1) attack A scout(0,0) -21, infantry(1,0) attack A scout(0,0) -22 (杀), infantry(0,3)→(0,3) | 杀 A scout 重占 cp_c |
| 8 | 100→65 | infantry(1,0)→(0,1) (A 死), infantry(0,3)→(-1,3), ranger(1,-1)→(0,0) cp_c, deploy ranger cp_b→(4,-1) | 推 cp_c 周边,新弓手北线 |
| 9 | 65→75 | infantry(0,0) attack A scout(0,0) -18, ranger(0,0) attack A scout(0,0) -18, deploy infantry cp_s→(1,3) | 双攻 A 侦察,新兵南线 |
| 10 | 75→75 | attack A scout(0,0) -17, move (1,0)→(0,1), deploy infantry cp_s→(0,5) | cp_c 僵持,南线增兵 |
| 11 | 75→85 | ranger(3,1) attack A (0,1) -38, infantry(1,1) move→(1,0), attack A (0,1) -22 | 北攻 A 兵 |
| 12 | 85→160 | (战略调整) deploy ranger cp_b→(4,-1) 75 | **囤兵备战** |
| 13 | 160→200 | infantry(1,1) attack A (0,1) -22 (杀), ranger(4,1) attack A (1,0) -40, ranger(4,-1) move→(3,-1) attack A (0,0) -40 | **关键:双弓手 + 步兵合击 cp_c 围兵** |
| 14 | 200→245 | (A 移侦察退 cp_c) ranger(3,-1) attack A (2,-1) -33, ranger(3,1) move→(4,1) | 持续压制 A 重装 |
| 15 | 245→210 | attack A 重装(0,0) -31, attack A (0,1) -37, (A 重装攻我弓手 -33) | 围 cp_c 持续 |
| 16 | 210→165 | attack A 重装(0,0) -31, ranger(3,1) move→(4,1), deploy ranger cp_b→(5,-1) | cp_c 僵持,新弓手 5,-1 |
| 17 | 165→170 | ranger(3,-1) attack A 重装(0,0) -31, ranger(5,-1) attack A 重装(2,-1) -38 | 重装双方互相消磨 |
| 18 | 170→250 | ranger(3,-1) move→(3,-2), ranger(4,1) move→(5,1) | 弓手调整位置,避 A 反击 |
| 19 | 250→210 | ranger(5,-1) attack A 重装(3,-2) -35, ranger(5,-1) move→(4,-1) | 杀 A 重装 1 步 |
| 20 | 210 | (无 action 备用可打 cp_n) — **A 侦察 (-2,-1)→(0,-4) cp_n 抢 4:1** | 致命:忽视 cp_n |

> 关键数据: T1 supplies 80 → T20 supplies 250(净 +170 物资),20 轮累计 600+ 物资(收入 1000+),但花 18 个 deploy(900+ 金)后陷入"高消耗"模式。

---

## 物资账本

**deploy 明细(共 10 次):**
| 单位 | 次数 | 单价 | 总花费 |
|------|------|------|--------|
| infantry | 4 | 45 | 180 |
| ranger | 5 | 75 | 375 |
| scout | 0 | 40 | 0 |
| heavy | 0 | 90 | 0 |
| support | 0 | 60 | 0 |
| **合计** | **10** | — | **630** |

**收入曲线:**
- T1-T4: 1 CP (cp_b) → 25 金/turn
- T5-T11: 3 CP (cp_c, cp_b, cp_s) → 55 金/turn ← **收入峰值期**
- T12-T20: cp_c 反复易手,实际 2-3 CP 浮动 → 40-55 金/turn

**如果采用正确策略:**
- T4 抢 cp_c 时同时 T4 派 scout 抢 cp_n(0,-4) —— 我 cp_s (0,4) 距 cp_n 4 步 scout 1 move 到位
- 4 CP 锁死: 70 金/turn,经济持续压制对方
- T8-T19 把 cp_c 攻防资源(约 8 行动点 × 5 轮 = 40 行动点)用于推 A HQ (8,0)
- A HQ 距我 cp_b (4,0) 4 步,heavy 2 步 + ranger 远程 3 = T15 强攻 A HQ,逼 A 回防

**差距: 我 deploy 10 次 630 金,对方 deploy 6 次 285 金,对方单位更精(2 heavy 180 + 1 ranger 75 + 1 infantry 45 + 1 scout 40 + 1 infantry 45)**

---

## 经验教训

### ✅ 做得好的
1. **T1 抢 cp_b 顺利** — scout (7,1)→(4,0) 1 步 3 hex 到位,轮末占 cp_b,稳拿 +15/turn
2. **T3-T4 协同杀 A scout 夺 cp_c** — infantry (1,0) + (1,-1) 2 兵合击 A scout, 4 CP 优势建立
3. **T4 deploy 弓手 cp_b→(4,-1)** — 远程 3 火力覆盖 cp_c 北线入口,持续压制 A 重装
4. **T7 守住 cp_c** — 双弓手 + 步兵合击,3 CP 优势维持 13 轮
5. **T8 战略撤退** — 主动放弃 (1,-1) 步兵,拉 (2,1) 兵退 cp_c 邻接,避免重装围攻

### ❌ 致命失误
1. **T4 之后没派 scout 抢 cp_n(0,-4)** — 这是整局最大错误,cp_n 距 cp_s 4 步 scout 1 步到位,占 4:1 据点即锁胜
2. **cp_c 攻防投入过深(占 14 轮精力)** — cp_c 是 A 重装 145 HP 守,杀 A 重装需要 4 刀(4 个弓手 or 6 步兵),我投入 2 弓手 + 2 步兵 14 轮围攻未果
3. **T8 deploy 弓手 (4,-1) 太晚** — 弓手从 (8,-1) 推进到 (3,-1) 用了 6 轮,本来 T3 就该部署
4. **T20 没留 1 action 抢 cp_n** — 5 action 全部投入 cp_c 攻防,1 个 scout 抢 cp_n 即翻盘
5. **没 deploy 任何 heavy / support** — 0 个 90 金 heavy / 0 个 60 金 support,全靠 ranger + infantry 组合
6. **T11 (1,1) 兵被 A 杀** — 64 HP 步兵被 A 兵 + 侦察合击死,cp_c 邻接兵源紧张

### 🔑 核心教训
> **"3 CP 不是胜势,4 CP 才是;maxTurns 限制下,1 个 scout 跨 4-5 步抢 cp_n/cp_s 就能翻盘"**

- 据点优势要追求 4:1 绝对压制,3:1 仍给对方翻盘空间
- cp_c 中央是消耗战,不如 cp_n/cp_s 边缘点好抢
- deploy 节奏: T1-T2 scout 抢 CP,T3-T4 弓手远程火力,T5+ heavy 推 HQ
- maxTurns 倒数 3 轮必须有"安全抢点"操作(派 scout 跨多步抢 cp_n)

---

## 与历史对局的共同教训

1. **重复犯错: 中期僵持后没有追求据点绝对优势**
   - 第21局(我之前作为 player_a): T7 抢到 3:2 据点反超,但 cp_c 反复易手最终 2:3 输
   - 这次 22 局: T5 抢到 3:1 据点优势但 cp_c 反复易手,T20 被 A 抢 cp_n 反超
   - **下次: 抢到 3 CP 后立刻派 scout 抢第 4 CP(cp_n 优先),锁死据点数**

2. **重复犯错: cp_c 中央消耗战投入过多**
   - 第21局: T8-T18 持续围攻 cp_c 损失 6 个 infantry + 2 heavy
   - 这次 22 局: T8-T19 持续围攻 cp_c 损失 4 infantry + 1 弓手 + 1 重装
   - **下次: cp_c 站的是重装 145 HP,4 弓手合击 4 轮才杀得死,中途要换目标**
   - **换目标优先级: 抢 cp_n > 推 A HQ > 杀 A 重装**

3. **新发现: 对方侦察跨 4 步抢 cp_n 是 T20 翻盘关键**
   - A 在 T20 派 scout (-2,-1)→(0,-4), 4 hex 1 步到位,scout moveRange 5
   - 我 T20 没派对应 scout 抢 cp_n,反被 A 抢到
   - **下次: T18-T19 就该派 scout 抢 cp_n,不能让 T20 才开始警觉**

4. **新发现: deploy 全选 infantry + ranger,没选 heavy/support 错失耐久优势**
   - 10 次 deploy: 4 infantry + 5 ranger, 0 heavy + 0 support
   - heavy (90 金) 145 HP 抗线,support (60 金) 持续治疗,都比 infantry 耐久
   - **下次: T3+ 必 deploy 1 heavy(90) 抗线,T6+ 必 deploy 1 support(60) 续航**

5. **新发现: 5 AP 限制下,3 deploy + 2 move 是最优配比**
   - 我常 4 deploy + 1 move,后续无 move 推前
   - 对方常 2 deploy + 3 move,持续有 move 推前
   - **下次: deploy 控制在 2-3/回合,留 2-3 AP 给 move**

---

## 正确的开局策略(下次应该用)

```
Turn 1: scout(7,1)→(4,0) cp_b 抢 +15/turn, infantry(7,0)→(4,1), infantry(7,-1)→(4,-1), deploy ranger HQ→(8,-1)
         物资 80→5,占领 cp_b
Turn 2: infantry(4,1)→(1,1) 中线南推, infantry(4,-1)→(1,-1) 中线北推, ranger(8,-1)→(6,-1), scout(4,0)→(0,4) cp_s 抢
         物资 5→40+15=55,占领 cp_s 2 CP
Turn 3: infantry(1,1) attack 屏护, infantry(1,-1) attack 屏护, scout(0,4)→(0,-4) cp_n 抢
         物资 55→80+30=110,占领 cp_n 3 CP
Turn 4-5: heavy deploy cp_b→(4,-1) 90金, ranger 推 cp_c 远程位
         物资 ~110,持续 3 CP
Turn 6-8: 集中 deploy heavy 抗线, support 续航, 推 cp_c
Turn 10-15: 4 CP 优势,70 金/turn,推 A HQ(8,0)
Turn 15-20: 强攻 A HQ(8,0),逼 A 回防
```

**关键变化:**
1. **T2 派 scout 抢 cp_s** —— 1 步 4 hex 跨到位,直接 2 CP
2. **T3 派 scout 抢 cp_n** —— 1 步 4 hex 跨到位,直接 3 CP
3. **T4 抢 cp_c** —— 4 CP 锁死,对方经济崩溃
4. **T6+ deploy heavy + support** —— 抗线+续航,推 A HQ
5. **maxTurns 倒数 5 轮必强攻 A HQ** —— 杀 HQ 即时胜,不靠 adjudicate

---

## 游戏机制深度理解

### 1. 行动点 (actionsPerTurn=5)
- 1 AP = 激活 1 单位(1 move + 1 attack/heal free)
- deploy 永远耗 1 AP
- **关键: deploy 控制在 2-3/回合,留 2-3 AP 给 move**

### 2. 据点控制 (CP weight=120)
- 5 个 CP: cp_a (-4,0) 西, cp_b (4,0) 东, cp_c (0,0) 中央, cp_n (0,-4) 北, cp_s (0,4) 南
- 占领需单位站在 cp 上且轮末仍在
- 1 据点 +15 物资/回合,**2 据点差距 = 30 物资/回合滚雪球**
- **关键: 4:1 据点优势 = 70 金/turn 压制,3:1 仍有翻盘空间**

### 3. 距离与攻击
- 攻击范围 1(近战) 或 3(ranger 远程)
- 攻击 = max(1, attack - defense ± 3)
- **关键: ranger 远程 3 是核心火力,4 ranger 合击 152 dmg 可杀 145 HP heavy**

### 4. 地形阻挡
- (-2,0)(2,0) blocker 把 cp_a 与 cp_c 隔开
- (-1,±2)(0,±2)(1,±2) water 把 cp_n/s 与 cp_c 隔开
- **关键: cp_n (0,-4) 只能从 (-1,-3)(0,-3)(1,-3) 进入,3 个入口都需绕路**

### 5. 5 AP + maxTurns=20 的战略约束
- 20 回合 × 5 AP = 100 总 AP
- 假设 deploy 10 次(600 金),move 90 次,平均 4.5 move/deploy
- **关键: T18-T20 必须留 AP 给"翻盘点"操作(抢 cp_n / 攻 A HQ)**

---

## 关键战斗回合详解

### Turn 4 — 杀 A scout 夺 cp_c 关键

```
操作: infantry(1,-1) attack A scout(0,0) -27(杀), ranger(6,-1)→(4,-1), scout(3,1)→(4,0), deploy infantry cp_b→(4,-1)
结果: 杀 A scout 70 HP 净剩,3 CP 优势建立
意义: 这是我整局最大转折 —— 但之后没趁机抢 cp_n 锁 4 CP
```

### Turn 7 — 杀 A scout 重占 cp_c

```
操作: ranger(1,-1) attack A scout(0,0) -21, infantry(1,0) attack A scout(0,0) -22(杀)
结果: 杀 A scout,3 CP 优势维持
意义: 但 A scout 反复夺 cp_c,我消耗大量 AP 维持
```

### Turn 13 — 双弓手合击 cp_c 围兵

```
操作: ranger(4,1) attack A (1,0) -40, ranger(4,-1) move→(3,-1) attack A (0,0) -40
结果: A (1,0) 100→60, A (0,0) 70→30
意义: 3 弓手合击压制 cp_c 围兵,但 A 重装站 cp_c 145 HP 难杀
```

### Turn 18 — 弓手调整位置避 A 反击

```
操作: ranger(3,-1) move→(3,-2), ranger(4,1) move→(5,1)
结果: 弓手退出 A 重装(0,0) 攻击范围
意义: 但我已经陷入"弓手拉锯"模式,5 AP 全在 cp_c 攻防
```

### Turn 20 — A 抢 cp_n 我方失败

```
操作: A scout (-2,-1)→(0,-4) cp_n 跨 4 步 1 步到位
结果: A 末占 cp_n,3:1 优势变 2:3 劣势
意义: 我 20 轮累计 cp_c 攻防 0 收益,反而被 A 抢边缘 CP 翻盘
```

---

## 数据统计

### 伤害输出
| 类别 | 我造成 | 我承受 |
|------|--------|--------|
| 总伤害(估) | 800+ | 600+ |
| 平均/回合 | 40+ | 30+ |
| 主要目标 | A 重装, A 围兵, A 侦察 | A 兵(反击) |

### 资源效率
| 玩家 | 总收入(估) | 总支出 | 净剩 | deploy/收入比 |
|------|-----------|--------|------|---------------|
| 我方 | 1000+ | 630 | 370+ | 0.63(健康) |
| 对方 | 600+ | 285 | 315 | 0.48(高效) |

### 占领据点回合
| 节点 | 事件 |
|------|------|
| T1 末 | 我占 cp_b |
| T2 末 | 我占 cp_s |
| T3 末 | A 占 cp_a |
| T4 末 | 我占 cp_c(我 3:1) |
| T4-T19 | 我持续 3 CP 优势 |
| T20 末 | A 抢 cp_n(2:3 反超) |

---

## 一句话总结

**本局失败的核心是 T4 抢到 cp_c 建立 3:1 据点优势后,没有趁机派 scout 抢 cp_n(0,-4) 锁 4:1 绝对优势,而是把后续 16 轮(80+ AP)全部投入 cp_c 攻防消耗战,被对方 T20 用 1 个 scout 跨 4 步抢 cp_n 翻盘(2:3 据点劣势触发 adjudicate 失败);更深层的问题是 deploy 10 次全是 45-75 金的 infantry/ranger,没 deploy 1 个 90 金 heavy 抗线也没 deploy 1 个 60 金 support 续航,在 cp_c 长期消耗中处于耐久劣势。下次开局应 T2-T3 连续派 scout 抢 cp_s(0,4) 和 cp_n(0,-4) 双 CP,达成 4:1 据点绝对压制后,集中 heavy + ranger 推 A HQ(8,0) 速胜。**

---

*文档生成时间: 2026-06-24*
*游戏版本: 默认地图 (default, hex pointy-top, radius 8)*
*AI模型: MiniMaxM3*
