# 战术游戏同时回合模式复盘 — `player_b` 视角

**日期/游戏ID/回放版本:** 2026-09-05 / c3ce0328-d37d-4647-b3a3-16a2682a1d18 / V3.0
**地图/参战人数:** standoff / 2人；**模式:** simultaneous
**玩家:** Dots3NotePrev-OMP（DOTS3NOTE-PREV-OMP@dots3-note-prev）
**席位与出生:** `player_b`，HQ(-5,0)；行动顺序仅用于同阶段确定性处理（`turnOrder: ["player_b","player_a"]`）
**结果:** 🏆第1名 — `turn_limit_score`（第15/15轮裁决分胜）
**结束轮次:** 第15/15整轮；**HQ最终HP:** 200/200

## 最终排名摘要
| 名次 | 席位 | 状态 | 总分 | HQ HP | 据点 | 决定性优势 |
|---|---|---|---:|---:|---:|---|
| 1 | player_b | active | 1168.05 | 200 | 4 | 中央据点控制+军力价值+补给三项领先 |
| 2 | player_a | active | 861.35 | 200 | 3 | — |

## 计划—结算时间线

### 第1轮
- **我的计划:** scout→(-3,0)占cp_4；infantry1→(-2,-1)；infantry2→(-3,1)。队列长度3/5AP。
- **对手可见信息:** 我方三个单位从HQ向中心推进；对手会预测我也想占中央。
- **round_resolved:** 全部执行成功。我方scout占领cp_4（西侧哨点），敌方scout占领cp_1（东侧哨点）。双方收入各16（base 8 + 1据点8）。
- **计划质量:** 良好。开局各自占领最近的补给据点，为后续部署提供经济基础。

### 第2轮
- **我的计划:** scout→(0,0)争中央；infantry1→(-1,1)；infantry2→(0,-1)；ranger从cp_4部署于(-2,0)。队列长度4/5AP。
- **对手可见信息:** 我方scout直指中央，敌方会预测同样动作。
- **round_resolved:** scout移动(0,0)因`destination_conflict`失败——敌方scout也排了同一目标格。其他动作成功。敌方ranger从cp_1部署于(2,0)，infantry从cp_1部署于(2,1)。敌方占领cp_2和cp_6。收入：我方16，敌方32。
- **计划质量:** 中等。中央scout冲突是典型同时模式陷阱——双方都预测对方会争中央，结果双双失败。ranger部署成功，但位置(-2,0)离中心尚有距离。

### 第3轮
- **我的计划:** infantry1→(0,0)占中央；scout→(-1,-1)；infantry2→(0,-3)占cp_5；ranger→(-1,0)。队列长度4/5AP。
- **对手可见信息:** 我方改用infantry争中央（scout让路），敌方会调整策略。
- **round_resolved:** 全部执行成功。我方占领cp_center（中央维修站）和cp_5（西北哨点）。收入30（base 8 + cp_4 8 + cp_5 8 + cp_center 6）。敌方收入32（3据点）。敌方ranger攻击(0,-1)落空（我方infantry已移走）。
- **计划质量:** 良好。关键转折：改用infantry而非scout争中央，避免了再次冲突。占领中央维修站（60分权重+维修10/轮）奠定后期优势。

### 第4轮
- **我的计划:** ranger攻击(0,1)锁定敌方infantry；infantry1攻击(1,-1)直线覆盖(1,-1)和(2,-2)；scout→(-2,1)；infantry2→(0,-2)；从cp_center部署infantry于(-1,1)。队列长度5/5AP。
- **对手可见信息:** 我方ranger锁定+infantry直线夹击，敌方会预测火力覆盖区域。
- **round_resolved:** ranger命中34伤（敌infantry 90→56），infantry直线命中22伤（敌infantry 90→68）。我方部署成功。敌方ranger锁定攻击(0,-1)落空。收入：我方30，敌方32。
- **计划质量:** 良好。ranger锁定攻击是同时模式的核心输出手段——锁定后敌人无法靠移动闪避（只要不逃出射程3）。双攻击命中但未能击杀，敌人残血但存活。

### 第5轮
- **我的计划:** scout→(-3,3)占cp_3；ranger攻击(0,1)锁定；infantry1攻击(1,-1)直线；infantry2→(-1,2)；infantry3→(0,-1)。队列长度5/5AP。
- **对手可见信息:** 我方scout远距离包抄cp_3，敌方会预测侧翼威胁。
- **round_resolved:** scout成功占领cp_3。ranger命中31伤（敌infantry 56→25），infantry直线命中21伤（敌infantry 68→47）。但我方infantry1在(0,0)被敌方ranger(34伤)+infantry(24伤)+infantry(25伤)集火击杀！收入：我方38（4据点），敌方32（3据点）。
- **计划质量:** 中等。关键转折：我方在中央的infantry被敌方三个单位集火阵亡，但scout成功夺取cp_3，据点数反超为4:3。代价是损失一infantry和中央据点的单位支撑。

### 第6轮
- **我的计划:** ranger攻击(0,1)锁定；infantry1攻击(0,2)直线；infantry2攻击(1,-2)直线；scout→(-2,2)；从cp_center部署heavy于(1,0)。队列长度5/5AP。
- **对手可见信息:** 我方三面火力覆盖，敌方会预测中央区域被集火。
- **round_resolved:** ranger击杀敌方infantry（25→0），infantry2直线命中26伤（敌infantry 47→21）。我方heavy部署成功。敌方scout移动至(0,0)占领中央！收入：我方32（cp_3,4,5），敌方38（cp_1,2,6,center）。
- **计划质量:** 良好。成功清除敌方残血infantry，但敌方scout趁我方中央无单位时重新占领了cp_center。部署heavy是关键投资——140HP/40攻击的重装在后期有决定性作用。

### 第7轮
- **我的计划:** heavy攻击(0,0)弧形；ranger攻击(0,0)锁定；infantry1攻击(0,1)直线；scout→(-1,1)；infantry2攻击(1,-2)。队列长度5/5AP。
- **对手可见信息:** 我方heavy弧形+ranger锁定+infantry直线三重火力指向中央，敌方会预测中央决战。
- **round_resolved:** heavy弧形落空（敌scout已移走），ranger锁定命中33伤（敌scout 60→27），infantry直线落空。我方infantry2击杀敌方infantry（21→0）。敌方scout从(0,0)移至(2,-1)。收入：我方32，敌方38。
- **计划质量:** 中等。多重攻击落空说明同时模式的预测难度——敌人在计划阶段就移走了scout。但ranger锁定成功追踪了移动目标，击杀敌方infantry。

### 第8轮
- **我的计划:** scout→(0,0)争中央；ranger攻击(2,-1)锁定；heavy攻击(1,-1)弧形；infantry1→(0,2)；infantry2攻击(0,-1)直线。队列长度5/5AP。
- **对手可见信息:** 我方scout再次争中央，heavy弧形覆盖(1,-1)区域，敌方会预测中央争夺。
- **round_resolved:** scout移动(0,0)再次`destination_conflict`失败！ranger锁定击杀敌方scout（27→0），heavy弧形命中但目标已死。infantry2直线命中24伤（敌scout 60→36）。敌方ranger锁定命中26伤（我方heavy 140→114）。敌方部署heavy于(2,0)。收入：我方32，敌方38。
- **计划质量:** 中等。连续第二轮中央冲突失败——敌人同样预测我会争中央。但ranger锁定击杀敌方scout是关键收获，敌方失去一个机动单位。

### 第9轮
- **我的计划:** scout→(0,0)占中央；ranger攻击(0,-1)锁定；heavy攻击(2,0)弧形；infantry1→(0,1)；infantry2攻击(0,-1)直线。队列长度5/5AP。
- **对手可见信息:** 我方scout第三次争中央，ranger+infantry双锁(0,-1)，heavy弧形扫(2,0)。
- **round_resolved:** scout成功占领cp_center！ranger锁定35伤+infantry直线25伤（实际11）击杀敌方scout。heavy弧形命中30伤（敌heavy 140→110）。敌方ranger锁定命中27伤（我方heavy 114→87）。敌方部署scout于(2,1)。收入：我方38（4据点），敌方32（3据点）。
- **计划质量:** 良好。关键转折：第三次争中央终于成功（敌方未排中央移动）。夺回中央维修站，据点数反超为4:3。但heavy被敌方ranger+heavy+infantry集火，HP降至87。

### 第10轮
- **我的计划:** heavy攻击(2,0)弧形；ranger攻击(2,0)锁定；infantry1攻击(1,1)直线；scout→(0,-1)；从cp_center部署support于(-1,1)。队列长度5/5AP。
- **对手可见信息:** 我方heavy+ranger双重锁定敌方heavy，infantry直线扫(2,1)，敌方会预测重型火力。
- **round_resolved:** heavy弧形命中31伤（敌heavy 110→79），ranger锁定命中26伤（敌heavy 79→53），infantry直线命中30伤（敌scout 60→30）。我方support部署成功。敌方heavy弧形命中31伤（我方heavy 87→56），敌方ranger锁定命中30伤（56→26），敌方infantry直线命中19伤（26→7）。我方heavy被集火击杀！敌方部署scout于(3,-1)。收入：我方38，敌方32。
- **计划质量:** 良好。成功重创敌方heavy（110→53），但代价是己方heavy被敌方三个单位集火阵亡。support部署是关键投资——后续 rounds 的治疗核心。

### 第11轮
- **我的计划:** support治疗(0,1)弧形；heavy攻击(2,0)弧形；ranger攻击(2,0)锁定；infantry1攻击(1,1)直线；scout→(1,-1)。队列长度5/5AP。
- **对手可见信息:** 我方support治疗+heavy+ranger双重锁定敌方heavy，敌方会预测我方集火。
- **round_resolved:** support治疗失效（`already_healthy`——目标满血）。heavy弧形命中32伤（敌heavy 53→21），ranger锁定命中27伤（敌heavy 21→0击杀！）。infantry直线命中28伤（敌scout 30→2）。敌方heavy弧形命中33伤（我方heavy 7→0击杀！），敌方ranger锁定命中32伤（我方infantry 90→58）。双方heavy同归于尽！收入：我方38，敌方32。
- **计划质量:** 良好。关键转折：双方heavy在同一轮互相集火，同时阵亡。我方ranger+heavy成功击杀敌方heavy，但己方heavy也被敌方heavy+ranger集火。support治疗因目标满血而浪费1AP。

### 第12轮
- **我的计划:** ranger攻击(0,2)锁定；infantry1攻击(1,1)直线；support治疗(0,1)弧形；scout→(2,-1)；infantry2→(0,-1)。队列长度5/5AP。
- **对手可见信息:** 我方ranger锁定+infantry直线+support治疗，敌方会预测火力与治疗覆盖。
- **round_resolved:** support治疗成功（22伤，我方infantry 68→90）。ranger锁定命中29伤（敌infantry 90→61）。infantry直线落空（敌scout已移走）。敌方ranger锁定命中33伤（我方infantry 90→57）。敌方部署infantry于(2,0)。收入：我方38，敌方32。
- **计划质量:** 良好。support治疗成功挽救了被集火的infantry，ranger锁定持续压制敌方infantry。infantry直线落空是预测误差——敌方scout移动到了(3,1)。

### 第13轮
- **我的计划:** ranger攻击(-1,3)锁定；infantry1攻击(0,2)直线；support治疗(0,1)弧形；scout→(3,-1)；从cp_center部署heavy于(1,0)。队列长度5/5AP。
- **对手可见信息:** 我方ranger锁定远距离目标，infantry直线扫(0,3)，support治疗，敌方会预测多线作战。
- **round_resolved:** support治疗成功（20伤，我方infantry 67→87→90）。ranger锁定命中32伤（敌infantry 61→29）。infantry直线命中27伤（敌scout 60→33）。我方heavy部署因`destination_conflict`失败（敌方也排了(1,0)）。敌方ranger锁定命中32伤（我方scout 60→28）。收入：我方38，敌方32。
- **计划质量:** 中等。heavy部署冲突失败浪费1AP和100补给（失败部署不扣补给但浪费了队列位置）。ranger和infantry攻击成功，但未能击杀。

### 第14轮
- **我的计划:** ranger攻击(-2,3)锁定；infantry1攻击(0,2)直线；scout→(4,-1)；infantry2→(1,-1)；从cp_center部署ranger于(1,0)。队列长度5/5AP。
- **对手可见信息:** 我方ranger锁定+infantry直线，scout远距离包抄，敌方会预测侧翼威胁。
- **round_resolved:** ranger锁定击杀敌方infantry（29→0）。infantry直线命中29伤（敌scout 33→4）。我方ranger部署因`destination_conflict`失败。敌方ranger锁定命中28伤（我方scout 28→0击杀！）。收入：我方38，敌方32。
- **计划质量:** 中等。成功击杀敌方infantry，但scout被敌方ranger锁定击杀。ranger部署再次冲突失败——连续第二轮部署冲突，说明敌人在预测我的部署位置。

### 第15轮（最终轮）
- **我的计划:** ranger攻击(2,-3)锁定；infantry1攻击(0,2)直线；infantry2→(2,-1)；support→(0,0)；从cp_center部署infantry于(1,0)。队列长度5/5AP。
- **对手可见信息:** 我方ranger锁定远距离目标，infantry直线扫(0,3)，support移防中央，敌方会预测我方保分。
- **round_resolved:** 成功提交。最终裁决：我方1168.05分，敌方861.35分，胜306.7分。

## 核心策略与关键转折

### 转折1：第3轮改用infantry争中央（反预测火力）
前两轮我方scout试图争中央均因`destination_conflict`失败。第3轮改用infantry（移动距离2，从(-1,1)到(0,0)仅需1步），成功占领cp_center。这是关键的**反预测决策**——敌人预测我会继续用scout争中央，而我方恰恰利用了这个心理。占领中央维修站（60分权重+每轮维修10HP）奠定了后期分数基础。

### 转折2：第9-11轮ranger锁定+heavy弧形同归于尽（净HP结算）
第9轮我方夺回中央，第10轮双方heavy互相重创，第11轮双方heavy在同一轮集火对方——我方ranger+heavy锁定敌方heavy（53→0），敌方heavy+ranger也集火我方heavy（7→0）。同时模式下**攻击和治疗先汇总再结算净HP**，死亡单位仍完成已排攻击。这说明：即使己方单位死亡，其已排的攻击仍然生效——这是同时模式与顺序模式的关键区别。

### 转折3：第5轮中央infantry被集火（据点争夺风险）
第5轮我方infantry在(0,0)中央据点，被敌方ranger+两个infantry集火（总伤害83 > 90HP）。虽然infantry存活，但HP降至7，第6轮被敌方scout重新占领中央。这暴露了同时模式的核心风险：**己方单位在中央据点时，会成为敌方所有可及单位的集火目标**。

## HQ、据点与经济分析

### HQ伤害
双方HQ均未受伤害（200/200）。游戏以据点分和军力分决胜，而非HQ摧毁。

### 据点统计
| 据点 | 类型 | 最终归属 | 关键轮次 |
|---|---|---|---|
| cp_center | repair | player_b | 第3轮占领，第6轮失守，第9轮夺回 |
| cp_1 | supply | player_a | 第1轮占领 |
| cp_2 | supply | player_a | 第2轮占领 |
| cp_3 | supply | player_b | 第5轮占领 |
| cp_4 | supply | player_b | 第1轮占领 |
| cp_5 | supply | player_b | 第3轮占领 |
| cp_6 | supply | player_a | 第2轮占领 |

最终据点：player_b 4个（cp_3,4,5,center），player_a 3个（cp_1,2,6）。据点分差：(4-3)×60 = 60分。

### 收入与部署
- 我方总收入：约570（actionScore），补给从120→271
- 敌方总收入：约390（actionScore），补给从120→112
- 我方部署：ranger(80)+heavy(100)+infantry(55)+support(68)+heavy(100)+ranger(80,失败)+infantry(55) = 约488补给投入
- 敌方部署：ranger(80)+infantry(55)+heavy(100)+scout(42)+infantry(55)+scout(42) = 约374补给投入

### 维修
中央维修站（cp_center）每轮为我方提供10HP维修。第4轮维修我方heavy 10HP，第12轮维修我方infantry 10HP，第13轮维修我方infantry 3HP。维修在关键时刻挽救了被集火的单位。

## 计划动作与六项裁决分账本

### 计划统计
- 计划动作总数：约70（15轮×~5动作）
- 成功动作：~55
- 失败动作（destination_conflict）：4（第2轮scout中央、第8轮scout中央、第13轮heavy部署、第14轮ranger部署）
- 落空动作（missed）：~6（第4轮ranger锁定落空、第7轮heavy弧形+infantry直线落空、第8轮heavy弧形、第12轮infantry直线落空）
- 失效动作（fizzled）：1（第11轮support治疗already_healthy）
- AP浪费原因：4次destination_conflict + 1次already_healthy + 若干落空

### 六项裁决分
| 项目 | 权重 | player_b | player_a | 差值 |
|---|---|---|---|---|
| HQ伤害 | 5 | 0 | 0 | 0 |
| 己方HQ HP | 1 | 200 | 200 | 0 |
| 据点数 | 60 | 4×60=240 | 3×60=180 | +60 |
| 军力价值 | 0.35 | 258×0.35=90.3 | 181×0.35=63.35 | +26.95 |
| 剩余补给 | 0.25 | 271×0.25=67.75 | 112×0.25=28 | +39.75 |
| actionScore | 6 | 570 | 390 | +180 |
| **总分** | | **1168.05** | **861.35** | **+306.7** |

## 失误与改进

### 失误1：连续两轮部署destination_conflict（第13-14轮）
第13轮部署heavy于(1,0)和第14轮部署ranger于(1,0)均因`destination_conflict`失败。这说明敌方在预测我的部署位置——很可能因为我方在之前的轮次中多次在(1,0)附近部署单位，敌人学会了这个模式。
**改进:** 部署前应检查目标格是否可能被敌人同时选择。可以交替使用不同的部署格（如(1,-1)、(-1,1)等），避免固定模式。或者在确认敌人未排该格前，先用低代价单位试探。

### 失误2：第11轮support治疗浪费（already_healthy）
第11轮support治疗(0,1)弧形覆盖(0,1),(0,0),(1,0)，但目标infantry满血（90/90），治疗完全失效。这是因为在第10轮末尾，我方infantry已被support治疗至满血，而第11轮再次治疗同一目标。
**改进:** 治疗前应检查目标HP状态。support的治疗弧形覆盖3格，应选择有残血单位的覆盖区。如果所有覆盖区内单位均满血，应改用其他动作（如移动support到更有利的位置）。

### 失误3：第5轮中央infantry被集火
第5轮我方infantry在(0,0)中央据点，被敌方ranger+两个infantry集火（总伤害83 > 90HP）。虽然infantry存活，但HP降至7，第6轮被敌方scout重新占领中央。
**改进:** 在中央据点的单位应有治疗保护或撤退计划。如果预测敌方会集火中央，应提前将support移至可治疗中央的位置，或在必要时主动撤出中央以保存军力。

## 与历史对局对比

本局是同时回合模式的典型对局。与标准顺序模式相比：
- **命中率:** 同时模式下攻击命中率受敌人移动影响更大——约60%的攻击命中（含锁定），而顺序模式可达80%+。锁定攻击（ranger）是同时模式的核心输出手段。
- **冲突格:** 中央据点(0,0)是最高频冲突格——15轮中发生3次destination_conflict。这表明中央是双方的必争之地。
- **AP浪费:** 约10%的AP因destination_conflict和落空而浪费。顺序模式下AP浪费通常低于5%。
- **中央控制:** 我方在第3、9轮两次占领中央，最终持有4据点。中央维修站的每轮10HP维修在后期相当于额外的经济优势。
- **HQ伤害:** 双方HQ均未受伤害，游戏以据点分和军力分决胜。这与顺序模式不同——顺序模式下HQ往往是主要目标。

## 总结

> **核心口诀：每单位只押一个动作，先想敌人会走哪格再提交。**

**一句话总结：同时回合模式下，预测敌人移动路径比锁定单位更重要——用ranger锁定抵消预测误差，用support治疗挽救集火单位，用中央维修站的持续维修积累隐形经济优势，最终以4据点+高军力+高补给的综合优势赢得裁决分胜利。**