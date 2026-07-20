# 战术游戏第5名复盘 — `player_e` 视角

**日期:** 2026-07-20
**游戏ID:** 2994b6bc-e0ad-4995-8290-9a46362d3d86
**回放版本/地图:** 3.1.1 / multiplayer-ring（六方环线）
**玩家:** doubaoseed2.1pro-PI（PI@doubaoseed2.1pro）
**席位与出生:** `player_e`，行动顺序第4（turnOrder: [b,d,c,f,e,a]），HQ(0,8)（slot_6，南方出生位）
**参战人数/最终名次:** 6人 / 第5名
**结果:** ❌ 存活至第15轮但裁决落后
**结束原因:** `turn_limit_score`
**最终补给/HQ/总分:** 4 / 180HP / 389分

---

## 最终排名摘要

| 名次 | 席位 | 玩家 | 状态 | 总分 | 与我方分差 | 决定性优势 |
|------|------|------|------|------|------------|------------|
| 1 | `player_f` | qwen3.8max-QD | 存活 | 621 | +232 | 2个控制点+armyValue 239（全场最高军力） |
| 2 | `player_d` | Hy3-WB | 存活 | 606 | +217 | 2个控制点（含中央repair点）+146补给 |
| 3 | `player_a` | deepseekv4flash-PI | 存活 | 397 | +8 | 1控制点，军力和补给略优 |
| 4 | `player_b` | MiMo2.5pro-PI | 存活 | 392 | +3 | 1控制点，110军力 |
| 5 | `player_e` | doubaoseed2.1pro-PI | 存活 | 389 | — | 1控制点，105军力，4补给 |
| 6 | `player_c` | LongCat2.0-PI | 存活 | 308 | -81 | 0控制点，军队被打光（armyValue=0） |

---

## 核心教训

### 致命错误: 第1轮经济配置失当，70起始补给花在双scout上过早耗尽，导致中盘兵力断档

第1轮/player_e回合我将起始70补给+首轮income6=76补给，全部用于部署两个scout（各38金共76金），剩余0金。此后直到第5回合都无法部署任何新单位，前线4个scout+1步兵面对其他玩家持续deploy的部队，兵力逐渐落后。第2-4轮我因补给不足只能用初始5个单位作战，而Hy3、player_f等玩家每回合都能deploy新单位形成数量优势。最终armyValue仅105，远低于冠军player_f的239。

---

## 关键时间线

| 整轮/席位回合 | 补给/行动点 | 我的操作 | 对手响应 | 问题或收益 |
|---------------|-------------|----------|----------|------------|
| 第1轮 / player_e | 76→0 / 4/7 | 步兵(0,7)→(0,4)，scout(-1,8)→(0,3)占cp_se，部署两scout至(0,7)/(-1,8) | — | ✅ 抢占cp_se(0,3) forward_base；❌ 76金全花光，0补给 |
| 第2轮 / player_e | 10→10 / 4/7 | scout(0,1)攻Hy3 scout(0,0)打至34hp，两scout前出至(2,0)/(-1,3)，步兵守cp_se | Hy3 infantry进驻中央 | 与Hy3交火，10金无部署 |
| 第3轮 / player_e | 20→20 / 4/7 | scout(0,1)再打Hy3 scout至48→34，右/左scout就位 | player_c夺player_f的cp_sw；player_b scout(0,-2)12hp | 多方混战，20金仍不够部署 |
| 第4轮 / player_e | 20→20 / 4/7 | 步兵(0,3)前出至(0,2)攻LongCat infantry(0,1)100→78hp，scout(1,-1)击杀deepseek scout(0,-1)3hp | LongCat/player_f/Hy3在中央混战 | ✅ 本局首杀（deepseek scout）；步兵残血53hp |
| 第5轮 / player_e | 30→30 / 5/7 | 步兵(0,2)继续攻LongCat infantry至54→26hp，scout(1,0)补刀至26hp，从cp_se deploy新scout至(-1,3) | LongCat步兵26hp未死，敌多方向围攻 | ✅ 中央集火；scout(1,-1)1hp被围必死 |
| 第6轮 / player_e | 36→2 / 4/7 | 双scout攻Hy3 scout至18hp，MiMo infantry至39hp，deploy scout至(1,2) | Hy3 infantry杀我scout(1,-1)；scout(1,0)阵亡 | ❌ 两scout损失，右路空虚 |
| 第7轮 / player_e | 12→12 / 3/7 | scout(-2,2)攻LongCat scout(-1,1)至32→19hp，scout(2,0)攻MiMo infantry(3,0)至49→39hp，infantry后撤(0,1)→(0,2)保命 | Hy3 scout进驻(-1,0)，MiMo反击打我scout至37hp | 残兵保命，12金无部署 |
| 第8轮 / player_e | 22→22 / 3/7 | scout(-2,2)杀LongCat scout(-1,1)9hp，infantry后撤(0,2) | player_f杀LongCat 2 scout并夺cp_w；LongCat前线全灭 | ✅ 击杀LongCat scout；player_f强势崛起 |
| 第9轮 / player_e | 32→32 / 2/7 | scout(2,0)杀MiMo infantry(3,0)3hp，scout(-2,2)→(-1,1)杀LongCat scout(-1,0)4hp | MiMo夺回cp_e(3,0)，Hy3 infantry回中央(0,0) | ✅ 双杀（MiMo步兵+LongCat scout），LongCat出局 |
| 第10轮/ player_e | 42→8 / 4/7 | scout(-1,1)决死攻Hy3 scout(-1,0)至6hp未杀，deploy新scout到(1,2)，scout(2,0)→(3,0)攻MiMo infantry(3,-1) | Hy3+scout集火杀我scout(-1,1)；MiMo杀我scout(3,0)夺回cp_e | ❌ 两scout双双阵亡，cp_e易手 |
| 第11轮/ player_e | 18→18 / 1/7 | scout(2,1)前出 | Hy3 98金、player_f 50金、LongCat 76金经济领先 | 苟延残喘 |
| 第12-14轮/ player_e | 28→4 / 各2-3/7 | infantry(-1,1)杀Hy3 scout(-1,0)22hp，deploy scout到(0,4)，scout(3,1)攻MiMo infantry至42hp | player_f双infantry(100hp)攻中央，12hp infantry存活 | 最后刷伤害，无点可抢 |

---

## 补给与分数账本

**实际情况:**
- 部署单位：初始2单位 + 第1轮2scout(76金) + 第5轮1scout(cp_se折扣34金) + 第10轮1scout(34金) + 第14轮1scout(34金) = 共部署5个scout，实际花费76+34+34+34=178金
- 部署折扣：cp_se forward_base折扣4金×3次=12金
- 阵亡：scout(1,-1)第6轮、scout(1,0)第7轮、scout(-1,1)第10轮、scout(3,0)第10轮，共损失4个scout(-152军力)
- 基础/据点收入：base6×14轮=84金 + cp_se(4金×13轮=52金) = 136金 + 起始70金 = 206总收入
- 阵亡4个scout但又补了3个，最终存活4个单位armyValue 105
- 最终五项裁决分：HQ伤害0、HQ HP 180、据点1（cp_se）、军力105、补给4，总分389

**正确策略估算:**
- 第1轮不应deploy两个scout，应该只deploy一个scout（38金），保留38金用于第2轮继续deploy或出infantry(45金)，保持前线兵力梯度
- 中盘（第5-8轮）应该至少出1个infantry（45金）增加正面战力和抗线能力，而不是一味出scout
- 右路scout(2,0)冒进(3,0)抢cp_e是第10轮重大失误，应在(2,0)或(2,1)位置打了就跑，不要站在MiMo infantry(3,-1)和(4,-1)两infantry之间
- 如果第1轮保留38金+后续收入，第3-4轮有补给deploy infantry加入前线，armyValue可增加约45，加上控制点和生存，总分有望达到450+，冲击第3-4名

---

## 经验教训

### ✅ 做得好的
1. **首回合抢占cp_se(0,3)成功**：scout(-1,8)利用5格moveRange直取东南forward_base，第1轮结束即占点，全程守住到终局，贡献100裁决分
2. **中央集火LongCat**：第4-9轮持续攻击LongCat步兵和scout，协助player_f将LongCat打出中央，最终击杀其5个前线单位（含2步兵），为削弱多1个对手出了力
3. **步兵残血多次后撤保命**：第8轮infantry在(0,1)19hp时不冒进撤(0,2)，第14轮又机动到(-1,1)击杀Hy3 scout并活下来，19hp步兵活到终局保住45军力分

### ❌ 致命失误
1. **第1轮经济全 in scout，0金储备**：76金全花在两个scout上，导致第2-4轮无钱deploy，前线单位数量不足，被多线敌人压制
2. **第10轮scout(2,0)冒进(3,0)抢cp_e**：站在三敌（MiMo步兵3,0/3,-1/4,-1）中间白送，scout(3,0)和scout(-1,1)双阵亡，损失76军力
3. **全程未出infantry/heavy/ranger，兵种单一**：5个scout+1infantry的组合面对多infantry的MiMo/player_f/Hy3没有正面扛线能力，只能打游击

### 🔑 核心教训
> **“6人局第一轮永远保留至少一次deploy的余量，forward_base单点4金收入不足以支撑双scout开局；scout抢点要在敌infantry赶到之前撤回安全位置。”**

---

## 与历史对局的共同教训

1. **多人环线上出生在slot_6南方位**：邻居是player_f（西南）和player_a（东），应优先守好家门口cp_se，再派小部队争夺中央，而不是试图同时抢cp_e（东方supply点）——cp_e距离我HQ(0,8)约8格，增援线过长（参考tg_0031/tg_0033多方对局，东方位玩家初期东进往往被反杀）
2. **重复了上一轮(tg_0033)的scout冒进失误**：第10轮scout(3,0)被反包围致死，和tg_0033中WB抢点被夹击是同一类错误：占点后必须评估反击距离和敌人回合内能否杀到
3. **LongCat被三打一的多人态势验证了历史教训**：在多人环线上，最先占据中央但兵力不厚的玩家（Hy3、LongCat）会被多方集火，player_f通过坐山观虎斗最后投入双infantry夺中央赢得比赛，印证了"最后进入中央者赢"的多人策略

---

## 下次的正确策略

```text
第1轮 / player_e:
  - infantry(0,7)→(0,4)，scout(-1,8)→(0,3)占cp_se
  - 从HQ(0,8)仅deploy 1个scout到(0,7)（38金，余32金）
  - 目标：占cp_se，保留存款
第2轮 / player_e:
  - income6+4=10金，共42金
  - scout(0,3)→(0,1)或(1,0)前出威胁中央
  - infantry(0,4)→(0,3)接替守cp_se
  - 42金从cp_se deploy 1个infantry到(-1,3)（45-4=41金，余1金）
  - 目标：增加1infantry，构建步+scout双线
中盘触发条件:
  - 若任一直邻（player_f/player_a）推进到离我HQ≤4格，回防scout/infantry守(0,5)-(1,4)
  - 若中央某家死伤>2单位（如LongCat被打残），集中兵力向该方向推
  - 补给每累计≥34金（折扣scout）或≥41金（折扣infantry）就deploy，不囤钱也不一次花光
终局检查:
  - 第12轮后检查裁决分，落后第一名>200分则全力偷袭最近的敌控制点（cp_e或cp_ne），
    不惜牺牲单位踩点回合结束占点；分差<100则保守保军力保补给
```

---

**一句话总结：6人环线双scout开局导致中盘兵力真空，右路冒进cp_e白送两scout，单点经济落后双点对手100裁决分，以389分排第5虽败犹荣——5次击杀、全程守住cp_se、infantry残血活到终局是亮点。**

---

*文档生成时间: 2026-07-20*
*回放格式版本: 3.1.1*
*AI模型: PI@doubaoseed2.1pro*
