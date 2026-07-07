# 战术游戏失败复盘 — Player A 视角

**日期:** 2026-06-23
**游戏ID:** d9ffa938-3ea0-4203-b82c-479c7c99e107
**玩家名:** MiniMaxM3
**角色:** Player A (HQ位于(-8,0)，左侧)
**结果:** ❌ **失败** — 第20回合达到 maxTurns 触发判定，server 因 bug 未输出 game_over 事件，按规则应判据点评定 (2:3 据点劣势)
**对手:** deepseekv4flash
**最终据点:** 我 cp_a + cp_n (2) / 对方 cp_b + cp_c + cp_s (3)

---

## 核心教训

### 致命错误: T3 派遣 scout 孤守 cp_c，被对方 3 单位协同集火秒杀

**发生了什么:**
T2 我用 scout 从 (-4,-1) 跨 5 步直插中央 (0,0) cp_c，把 cp_a 上的 infantry (-4,0) 推到 (-3,0) 作 1 hex 屏护。T3 我又把该 infantry 推到了 (-1,0) —— **离 cp_c 守军 2 hex 远，已无法救场**。对方 T3 末用 scout + 2 infantry 同时集火 cp_c 上的 scout，4 次攻击 (12+15+22+24=73 dmg) 把它打空。cp_c 在 T3 末易手。

**为什么是致命的:**
- cp_c 是地图正中央、5 个据点里价值最高的位置(120 分权重)
- 我用 1 个 scout 守 cp_c，又只给它 1 hex 远的 infantry 屏护，然后 T3 我自己把屏护拉走，等于主动放弃 cp_c
- 失去 cp_c 后对方立刻进入 2:1 据点优势，每回合多 15 金，从此经济滚雪球到我方

**正确做法:**
- T2 推 scout 抢 cp_c 后，T3 必须用 1 个 infantry 紧贴 cp_c(0,0) 邻接(比如 (-1,0) 或 (0,-1) 或 (1,0))做贴身肉盾
- 或者 T2 不抢 cp_c，改抢 cp_n(0,-4) —— 我后来在 T4 才发现这条更稳的路线
- 一旦发现 cp_c 守不住，及早撤守军保留战力，不要赔了夫人又折兵

---

## 回合时间线

| 回合 | 我的操作 | 问题 |
|------|----------|------|
| 1 | scout(-7,-1)→(-4,-1), infantry(-7,0)→(-4,0) cp_a, deploy scout(-7,0), deploy scout(-8,1) | 开局稳，抢 cp_a |
| 2 | scout(-4,-1)→(0,0) cp_c, infantry(-4,0)→(-3,0) 屏护, 4 unit 推进 | 跨 5 步强抢 cp_c 成功 |
| 3 | scout(0,0)→(0,0) 反击对方 scout(0,1) -11 dmg, **infantry(-3,0)→(-1,0) 推前(离开屏护)**, 其他推进 | **致命: 把屏护 infantry 拉走，scout(0,0) 被对方 3 单位集火 73 dmg 阵亡** |
| 4 | scout(-3,-1)→(0,-4) cp_n, heavy deploy at (-3,0) 90金 | 抢 cp_n 救场,但 cp_c 已失 |
| 5-7 | 推前反攻 cp_c,scout 抢回 cp_s, deploy heavy (-3,0), deploy infantry (-5,0) | 资源投入 265 金,经济开始承压 |
| 8 | deploy scout at (-3,-1) 40金, 调整屏护 | 资源 0,经济断流 |
| 9-10 | scout(0,-3) HP29 撤 cp_n, heavy(-2,1) attack infantry(-1,1) -28 | 转入战略防御 |
| 11 | heavy HP37 撤退, scout HP26 撤屏 cp_n | 关键单位开始残血 |
| 12 | infantry HP27 撤, heavy 推 (-3,1) 抗线 | 屏护继续崩 |
| 13 | heavy(-3,0)→(-3,1) 推前, infantry(-1,-4) HP27 移屏 cp_n | 残血单位不断后撤 |
| 14 | infantry HP27 死, cp_n 失屏护 | 关键节点: cp_n 暴露 |
| 15-16 | heavy HP34 撑, infantry HP4 挣扎 | 兵力耗尽 |
| 17 | heavy(-3,0)→(-3,1) 继续抗, deploy scout at (-5,0) | 仅剩 scout 群 |
| 18 | heavy HP34 死 (对方 heavy+infantry+ranger 集火 60 dmg) | 失去最后 heavy,纯 scout 战 |
| 19 | infantry(-3,0) HP4 撤 (-3,-1), 仍被对方 3 单位围 cp_a | 残血 unit 撤到角落 |
| 20 | deploy scout at (-3,-1) 40金, scout(-3,2) HP24 推前 | 满回合,server 因 bug 卡在 waiting_command 未触发 game_over |

---

## 物资账本

**总收支(19 个 income 事件):**
- 总收入: 745 物资(40 金/回合初始，2 据点后 55 金/回合)
- 总支出: 825 物资(18 次 deploy)
- **净收入: -80 物资**

**deploy 明细(共 18 次):**
| 单位 | 次数 | 单价 | 总花费 |
|------|------|------|--------|
| scout | 15 | 40 | 600 |
| heavy | 2 | 90 | 180 |
| infantry | 1 | 45 | 45 |
| **合计** | **18** | — | **825** |

**对比 deepseekv4flash:**
- 总收入: 935 物资(20 income 事件，平均 46.75/回合)
- 总支出: 340 物资(5 次 deploy: 1 scout + 2 ranger + 1 support + 1 heavy)
- **净收入: +595 物资**(终局 675 资源)

**经济对比的教训:**
- 我 deploy 18 次 = "以战养战"模式，但 15 个 scout 太便宜(40 金)单战力太低
- 对方 5 次 deploy 全是核心单位(2 ranger 远程 + 1 support 治疗 + 1 heavy 抗线 + 1 scout)，**每个都是改变战局的关键棋子**
- 我把资源零散投入到 15 个便宜单位，结果被对方 5 个高价值单位逐个击破

---

## 经验教训

### ✅ 做得好的
1. **T1-T2 开局抢 cp_a 顺利** — 3 步操作拿下西据点，1 deploy 80 物资换 15 物资/回合长期收益
2. **T4 抢 cp_n 救场** — scout 跨 5 步到 (0,-4) 占领北方据点，把局势从 1:1 拉回 2:1
3. **T7 抢 cp_s** — 1 步 move 夺下南方据点，3:2 反超
4. **T8 部署双 heavy(180 金) 重塑西线抗线** — 把对方 heavy(5,0) 推进节奏压下来

### ❌ 致命失误
1. **T3 infantry(-3,0) 推 (-1,0) 主动离开屏护位** — 这是整局最大错误，让对方 3 单位协同集火成功
2. **资源分配失衡** — 15 个 scout(600 金) vs 2 heavy(180 金) + 1 infantry(45 金),前排战力严重不足
3. **T8 末资源耗光 (0/135)** — 6 次 deploy 在 T4-T8 一波砸光，后续 12 回合无力反击
4. **T11-T15 重装 heavy 残血拖延阵亡** — 145 HP heavy 5 回合内被磨到 34 HP 死，没能物尽其用
5. **T13 后失去所有 heavy**，纯 scout 群无法与对方 2 heavy + 1 ranger + 1 support 对抗

### 🔑 核心教训
> **"少而精的部署 > 多而廉的消耗；据点守军必须有贴身肉盾，不能裸奔"**

- 部署单位时优先选 ranger(75金)/heavy(90金) 等高价值棋子，少量产 scout 屏护即可
- 抢下据点后立刻用 1-2 步行动把 infantry/heavy 推到 cp 邻接做贴身保护
- 资源不要一波砸光，留 30-50 金应急(受伤时治疗/反 deploy)
- T3 那种"scout 孤守 cp_c"是送命题 —— 一定带 infantry 邻接屏护

---

## 与历史对局的共同教训

1. **重复犯错: 派出侦察兵深入敌后没屏护**
   - 第 1/2 局(早期对局)也出现过 scout 远推据点后没屏护被反杀
   - 这次 T2-T3 同样剧本，只是换了地图(从方格到 hex)
   - **下次开局: scout 抢 cp 后必须留 1 个 infantry 在 cp 邻接**

2. **新发现: hex 地图的 (-2,0) blocker 把 cp_a 与 cp_c 直接隔开**
   - 整个 T2-T6 我都没意识到 cp_a 邻接 cp_c 的最短路径被 (-2,0) blocker 切断
   - 这导致我从 cp_a 推 infantry 到 cp_c 邻接得绕 (-1,0) 或 (0,-1)，多走 1-2 步
   - **下次: 画地图时先用 ast_grep 找 blocker 坐标，规划路线**

3. **新发现: support 单位价值被严重低估**
   - 对方 1 个 support 持续 heal 4 个单位(8 次治疗事件)，等效多 1 队兵力
   - 我方完全没有 support 部署，是被对方拉开持续战耐久的根本原因
   - **下次 T5-T8 资源充裕时考虑 deploy support(60金) 到 cp_a 旁**

4. **新发现: 5 AP 行动点限制下，deploy 越频繁越亏**
   - 5 AP 意味着每回合最多 5 次激活(deploy/move 激活)
   - 我方 T4-T8 共 6 次 deploy 占满 AP，无 move 余地
   - 对方 T4-T8 仅 3 次 deploy(2 ranger 1 support)，剩余 AP 全 move 推前
   - **下次: deploy 控制在 2-3 次/回合，留 2-3 AP 给 move**

---

## 正确的开局策略（下次应该用）

```
Turn 1: scout(-7,-1)→(-4,-1) 屏护, infantry(-7,0)→(-4,0) cp_a, deploy scout(-7,0)
        物资 80→40,占领 cp_a
Turn 2: **scout(-4,-1)→(0,-4) cp_n(更稳,不挨 3 单位集火)**, infantry(-4,0) 不动屏护 cp_a
        deploy ranger(-8,0)→(-7,-1) 远程骚扰
Turn 3: infantry 推 cp_n 邻接做肉盾, ranger 推 (5,-3) 射程 3 攻击对方 cp_b 守军
        deploy heavy(-8,0)→(-7,0) 准备推前
Turn 4-5: heavy 推 (5,0) cp_b 旁, 争取 2:1 据点优势
Turn 6-8: 集中 deploy ranger(75) + support(60) 增强持续战能力
Turn 10+: 推 cp_c 用 heavy + infantry 强攻
```

**关键变化:**
1. **T2 不抢 cp_c 改抢 cp_n** —— cp_n 距离我 HQ 仅 5 步，敌方打到 (0,-4) 要绕远
2. **T2-T3 不再 deploy 便宜 scout,改 deploy ranger(75)** —— 远程火力压制对方
3. **T3-T4 必带 infantry 屏护据点守军** —— 1 步 move 推到邻接位
4. **资源保留 30-50 应急** —— 不一波砸光 deploy

---

## 游戏机制深度理解

### 1. 行动点 (actionsPerTurn=5)
- 1 AP = 激活 1 单位(可 1 move + 1 attack/heal free)
- deploy 永远耗 1 AP
- 5 AP 限制下，deploy 越多 move 越少
- **关键: deploy 控制在 2-3/回合**

### 2. 据点控制 (CP weight=120)
- cp_c(0,0) 中央 120 分最高，cp_a/b 东西 120 分，cp_n/s 南北 120 分
- 占领需单位站在 cp 上且回合末仍在
- 1 据点 +15 物资/回合,**2 据点差距 = 30 物资/回合滚雪球**

### 3. 集火机制
- 攻击无距离限制(只看 hex 距离)
- 1 个单位被多个邻接敌同时打，**没有反击分摊机制**
- 4 次攻击同 1 单位 = 必死(scout 70HP)
- **关键: 守军必须有邻接肉盾,不能 1 unit 裸占**

### 4. 地形阻挡
- (-2,0)(2,0) blocker,(-1,±2)(0,±2)(1,±2) water 把 cp_a 与 cp_c 隔开
- cp_c 中央是战略要冲但易被三面围攻
- **关键: 抢占 cp_n(0,-4) 比 cp_c 更稳**

### 5. 行动点 vs 距离
- 1 move API = 1 步到 moveRange 内任意位置(不限具体步数,API 走 A* 寻路)
- 1 步邻接可以 1 move API 走 5+ hex(scout moveRange 5)
- 但路径会被 blocker/water/单位阻挡,实际可达 ≠ 直线距离

---

## 关键战斗回合详解

### Turn 3 — 整局最大转折(丢掉 cp_c)

```
操作: scout(0,0) cp_c 反击对方 scout(0,1) -11 dmg(自己 58→47)
操作: infantry(-3,0)→(-1,0) 推前 1 步
结果: T3 末对方 scout(2,1)→(0,1) attack -15, infantry(3,0)→(1,0) attack -22, infantry(3,-1)→(1,-1) attack -24
      我 scout(0,0) HP47-15-22-24 = -14 阵亡,cp_c 易手
意义: 失去 cp_c → 对方 2:1 据点优势 → 经济滚雪球 → 整局胜负已定
```

### Turn 4 — 抢 cp_n 救场

```
操作: scout(-3,-1)→(0,-4) cp_n 跨 5 步 1 步到位
操作: deploy heavy at (-3,0) [90 物资] 抗线
结果: 抢回 2:1 均势
意义: 唯一翻盘机会 —— 之后对方没给机会
```

### Turn 7 — 抢 cp_s 三据点反超

```
操作: scout(-2,3)→(0,4) cp_s 跨 5 步到位
操作: heavy(-2,1) attack infantry(-1,1) -28 dmg
结果: 3:2 据点反超
意义: 短暂反超,但没保持住
```

### Turn 11 — 防线开始崩盘

```
操作: heavy(-3,1) HP37 撤退到 (-2,1) — 失去 (-3,1) 抗线位
结果: 对方 heavy(0,1) 推 (-1,0) 进一步逼近 cp_a
意义: 失去反击能力,转入纯防御
```

### Turn 18 — 失去最后 heavy

```
操作: 对方 heavy(-2,1) + infantry(-1,1) + ranger(0,1) 集火我 heavy(-3,1) HP34
结果: heavy 阵亡
意义: 失去所有 high-value 单位,纯 scout 群无法对抗对方 2 heavy
```

### Turn 20 — 满回合

```
操作: deploy scout at (-3,-1), scout(-3,2) HP24 推前
结果: server 因 maybeAdjudicate bug 未触发 game_over,卡在 waiting_command
意义: 实际应为 turn_limit_score 判定,2:3 据点我方失败
```

---

## 数据统计

### 伤害输出
| 类别 | 我造成 | 我承受 |
|------|--------|--------|
| 总伤害 | 211 | 1136 |
| 平均/回合 | 11.1 | 59.8 |
| 比例 | 1 | 5.4 |

### 部署 vs 击杀对比
| 玩家 | 部署数 | 单位死亡 | 击杀比 |
|------|--------|----------|--------|
| 我方 | 18 | 10 | 0.56 (亏损) |
| 对方 | 5 | 0? | 10+ (压制) |

### 资源效率
| 玩家 | 总收入 | 总支出 | 净剩 | deploy/收入比 |
|------|--------|--------|------|---------------|
| 我方 | 745 | 825 | -80 | 1.11(过度 deploy) |
| 对方 | 935 | 340 | +595 | 0.36(高效率) |

### 占领据点回合
| 节点 | 事件 |
|------|------|
| T1 末 | 我占 cp_a |
| T1 末 | 对方占 cp_b |
| T2 末 | 我占 cp_c |
| T3 末 | 对方夺 cp_c |
| T4 末 | 我占 cp_n |
| T5 末 | 对方占 cp_s(对方 3:1 峰值) |
| T7 末 | 我夺 cp_s(我 3:2 反超) |
| T8 末 | 对方夺 cp_s(对方 3:2 持续) |
| T20 末 | 维持 2:3,触发判定 |

---

## 一句话总结

**本局失败的核心是 T3 派出 scout 孤守 cp_c 后又主动拉走 infantry 屏护，让对方 3 单位协同集火得手，从此失去 cp_c 让对方进入 2:1 据点经济滚雪球；更深层的问题是 18 次 deploy 全部选了 40 金的便宜 scout 而非 75-90 金的高价值单位(heavy/ranger/support)，导致资源全部变成低战力单位被对方 5 个高价值单位逐个击破。下次开局应 T2 改抢 cp_n(0,-4) 而非 cp_c(0,0)，并保证每个据点守军有 infantry 邻接贴身肉盾。**

---

*文档生成时间: 2026-06-23*
*游戏版本: 默认地图 (default, hex pointy-top, radius 8)*
*AI模型: MiniMaxM3*
