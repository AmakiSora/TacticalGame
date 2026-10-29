# 算法 AI 版本发布记录

> 本文档记录算法 AI 侧的版本变化：新增算法、算法版本升级、同时回合镜像适配、算法接口/工具链与相关地图/计分规则变化。
>
> **权威口径**：主项目完整发布说明以根 `RELEASE_NOTES.md` 为准；本文件只保留算法相关条目。2026-10-23 起补录 3.5.0–3.8.7 的算法里程碑，未列出的版本表示没有算法侧变化（3.6.1–3.6.5 只涉及前端构建、持久化、统计与大厅交互，没有算法实现或评估口径变化，故不单列）。算法强度数据必须带引擎版本、地图池、harness、局数与日期；不同 harness/规则版本的数字不可直接相减。
>
> **当前算法版本**：`random-sim` v2、`dest-prob` v2、`kriegspiel` v2、`matrix-eq` v2、`prism` v1、`tempo` v1、`tempo-weave` v1、`horizon` v1、`shrinkroll` v1、`vortex` v1、`echelon` v1、`apex` v1、`crucible` v1、`sovereign` v1、`ark` v1；标准模式算法（greedy / random / mcts / threat / field / verdict / parallax）与 3.8.10 新增的 `random-annihilation` / `random-royale` 均为 v1。

## 3.8.19（2026-10-29）— ark 方舟算法 v1

### 新增功能

- 新增仅支持 `royale` 的 `ark` v1（方舟算法），从引擎规则独立编写，单文件零导入，不复用既有算法或策略工具；现有算法仅作为黑盒对战对手。注册为 `algo_ark` / `algo_ark@v1`，大厅、HTTP runner 与评估控制台由注册表接入。原理、参数、约束与逐项限制见 [单算法档案](algorithms/ark.md)。
- 将友军与可用落脚格建成二分图，以最小费用匹配分配不同避难位置；代价包括地形行军距离、最终安全半径、未来炮火和接敌风险，满图时允许保留原位。随后比较移动、攻击、治疗、爆破及两动作组合的行动点收益，每入队一步重新计算，不缓存跨局状态。
- 投影自己的计划前缀，计入部署补给、已占目的格、连续移动、爆破地形、攻击次数和预期伤疗；不把预计击杀当成已经腾空。部署按射程、机动、兵力容量和缩圈疏散负担计价，零兵力时优先部署；地形、兵种和炮火节奏均取本局配置及公开状态，不按地图名或对手身份分支。
- 边界：安全格匹配与两动作估值不是完整同时结算搜索，敌方命中率和威胁是启发式估计，不能保证避开隐藏计划的到达冲突；没有保证战胜全部现有或未来对手，也未实现有限回合裁决的专门末轮搜索。

### 测试与验证

- 新增 **44 项**独立规则回归和 **1 项**注册测试：包含冻结公开快照、秘密字段拒读、己方队列两种接口、零兵力首步部署、据点禁用/折扣/补给预留、投影移动/治疗/爆破、攻次限制、预计击杀避免重复开火、零攻击配置、超大与非整数伤害方差，以及两图 2 人和雪花 3/6 人真实引擎短局。另以枚举分布对闭式伤害计算做 **336 组**差分检查；超出浮点精确整数范围的方差采用连续均匀分布极限近似。
- `npm run build`、`npm test`、`npm run check-version` 及新增测试严格 TypeScript 检查通过，全量 **145 文件 / 1652 用例通过**。
- 浏览器确认评估控制台大逃杀可选方舟、标准模式不出现、单算法禁启动而选择对手可启动；真实 HTTP bot runner 完成狭路对随机算法接入局，方舟第 12 轮获胜、无 `bot_failed`。存在规则允许的到达占位/冲突及失败连锁，不将它们误记为非法入队；观战页显示和 Canvas 渲染正常，未启动写入正式榜单的跑批。

### 固定实现黑盒评估

引擎 **3.8.19**，日期 **2026-10-29**，使用未修改的公共真实引擎 harness `scripts/horizon-arena.mts`；方舟及三个对手均为 **v1**。仅统计最终固定实现的 **71 局**，开发调参批次和 HTTP 接入局不计入。下表均从方舟视角列 **胜 / 负 / 平**，多人局为一席方舟对其余同种对手的自由混战，不是组队赛。

| 黑盒对手 | 狭路 2 人（8 局） | 雪花 2 人（8 局） | 雪花 3 人（3 局） | 雪花 6 人 | 合计 |
| --- | --- | --- | --- | --- | --- |
| `random-royale` | 8 / 0 / 0 | 8 / 0 / 0 | 3 / 0 / 0 | 6 / 0 / 0（6 局） | 25 / 0 / 0 |
| `echelon` | 8 / 0 / 0 | 8 / 0 / 0 | 3 / 0 / 0 | 6 / 0 / 0（6 局） | 25 / 0 / 0 |
| `apex` | 4 / 0 / 4 | 2 / 6 / 0 | 0 / 3 / 0 | 1 / 0 / 1（2 局） | 7 / 9 / 5 |

- 总计 **57 胜 / 9 负 / 5 平**，66 局 `last_player_standing`、5 局 `mutual_annihilation`；双方非法入队均为 **0**，`round_guard` 截断 **0**。方舟结算期仍出现占位失败 130 次、前序失败连锁 117 次、单位已消失 78 次和到达冲突 37 次；这些是隐藏计划统一结算后的动态失败，不代表策略已经能规避碰撞。
- 双人引擎种子基数 `291903`，多人 `391903`；实际种子为基数加 `floor(index / 2) * 7919`。双人成对换座，多人按席位轮转；对 `apex` 的六人局仅覆盖前两席，不能当作完整座位覆盖。狭路对 `apex` 四组均为 A 席胜、B 席同归于尽，重复轨迹不是四份独立证据；雪花双人和三人对 `apex` 的败局表明对强对手仍有明显短板。
- harness 在同一进程调用各席位，限制 60 轮并只给公开投影；固定的是引擎种子，不保证黑盒对手内部随机源也被播种。未测试未见地图、混合对手阵容或独立留出集，不由本批次推断泛化胜率。计时与其他评估、全量测试并发，方舟所记录最大单次决策 110.6 ms、最大单轮决策累计 425.7 ms，仅为本批次观测，不作严格性能基准。
- 原始报告位于本地 gitignored `temp/ark-arena/final-*.jsonl`（12 个文件），未写入正式 `arena/matches.jsonl`。固定源码 SHA-256：`algorithms/builtin/ark.mjs` 为 `3dd2caf62dd81feb287b939072aa7ad12eb54b2240a9f1867ad0109044ff1246`；harness 为 `1478c236ae5f33d08e1e7a69423cbc1717181e0e914602e87869164fba1c23b7`。

复跑相同评估矩阵（使用新目录，避免 harness 追加写导致重复计数；不保证黑盒随机轨迹逐局一致）：

```bash
out="temp/ark-recheck-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
for opponent in random-royale echelon apex; do
  for map in narrow-road snowflake; do
    node --import tsx scripts/horizon-arena.mts --a ark --b "$opponent" \
      --map "$map" --players 2 --games 8 --seed-base 291903 \
      --out "$out/${map}-2-${opponent}.jsonl"
  done
  node --import tsx scripts/horizon-arena.mts --a ark --b "$opponent" \
    --map snowflake --players 3 --games 3 --seed-base 391903 \
    --out "$out/snowflake-3-${opponent}.jsonl"
  games=6
  if [ "$opponent" = apex ]; then games=2; fi
  node --import tsx scripts/horizon-arena.mts --a ark --b "$opponent" \
    --map snowflake --players 6 --games "$games" --seed-base 391903 \
    --out "$out/snowflake-6-${opponent}.jsonl"
done
```

## 3.8.18（2026-10-29）— parallax 视差算法 v1

### 新增功能

- 新增仅支持 `standard` 的 `parallax` v1（视差算法），从规则与可见状态独立实现，不导入既有算法或其策略工具；现有标准算法仅作为黑盒测试对手。原理、参数、约束与逐项限制见 [单算法档案](algorithms/parallax.md)。
- 以单位完整行动组合搜索整回合，覆盖移动后攻击、攻击后撤、治疗、部署后攻击、击杀后进入腾空格及重装爆破开路；多首步候选分别接受反击情景检验，每个真实动作后重新规划，不预测或读取引擎随机状态。
- 按本局配置计算地形路径、兵种价值、据点收入/折扣/维修与裁决期限；总部防守同时考虑即时伤害与后续接敌，反击场景包含偏重攻城的假想对手。无限回合的远目标不按有限期限截断；末轮最后席位在候选排序与剪枝前先模拟占点、持有统计与裁决，不扣除不存在的下一轮反击，不硬编码地图或对手身份。
- 新增 `scripts/parallax-arena.mts`：完整公开投影、每席位独立 worker、固定随机种子与成对换座，支持多人自由混战及改变尺寸、轮廓、障碍、兵种和经济参数的随机挑战图；无限图达到评估上限时单列截断，不把强制裁决混入正常胜率，输出限制在 `temp/`。

### 测试与验证

- 新增 **67 项**规则差分与决策回归：公开状态不可变、秘密字段/随机状态不可读、行动点复用、部署折扣和免费攻击、治疗范围、地形覆盖与空洞、爆破开路、结束回合占点、维修/收入/持有统计、总部淘汰及裁决；包含无限回合 30 格远目标推进、末轮冒险占点立即获胜、浮点军力舍入顺序、多人末轮停手保平局和真实引擎短局。
- 浏览器确认评估控制台标准目录可选、歼灭目录不出现；本地 HTTP 创建视差对贪心对局并由真实 runner 完成，视差第 8 轮获胜，无 `bot_failed` / `action_failed`，观战显示正常、控制台无错误。该局仅作接入验证，不计入强度样本。
- `npm run build`、`npm test`、`npm run check-version` 通过，全量 **144 文件 / 1607 用例通过**；新增测试及评估脚本的严格 TypeScript 检查通过。

### 固定实现评估

引擎 **3.8.18**，日期 **2026-10-29**，harness 为 `scripts/parallax-arena.mts`，参评标准算法均为 **v1**。仅统计最后一次规则修正后的固定实现；开发与中断批次不计入，重复种子作回归验证、不视为独立留出集。同种子成对换座，正常胜负、截断和错误分别计数；计时含并行任务竞争，不作为严格单线程性能基准。

冻结源码 SHA-256：`parallax.mjs` 为 `d9e3576b219afc90175a9d37d705aef7bede45f7ee79dceb463ca41e6f18ffbc`；评估脚本为 `6e4db874d73982ae0b6018785d4d7b16f3fe61d56bb8965d44e1420bb6bada56`。

六个标准对手指 `greedy / random / mcts / threat / field / verdict`。下表按视差所在席位统计正常胜:负:平，截断另列，不折算成胜率。

| 地图 / 人数 | 对手 | 正常胜:负:平 | 截断 |
|---|---|---:|---:|
| default / 2 人 | 六个标准对手 | 12:0:0 | 0 |
| breach / 2 人 | 六个标准对手 | 10:2:0 | 0 |
| dual-lanes / 2 人 | 六个标准对手 | 11:1:0 | 0 |
| danger-close / 2 人 | 六个标准对手 | 12:0:0 | 0 |
| multiplayer-ring / 2 人 | verdict、threat | 2:2:0 | 0 |
| whirlpool / 2 人 | verdict、threat | 2:0:0 | 2 |
| random challenge / 2 人 | verdict、threat | 8:0:0 | 0 |
| multiplayer-ring / 3 人 | 2 个独立 verdict | 0:2:0 | 0 |
| multiplayer-ring / 6 人 | 5 个独立 verdict | 0:2:0 | 0 |
| random / 8 人 | 7 个独立 verdict | 1:1:0 | 0 |
| **合计** | | **58:10:0** | **2** |

- 共 **70 局**，零非法动作、异常或未完成局；两个截断局均为 whirlpool 对 threat，完成 60 轮后强制裁决均落后，单列而不混入正常胜负。
- 四张常规双人图合计 **45:3（93.75%）**：对 verdict 为 6:2，对 threat 为 7:1，其余四个对手各 8:0。随机挑战为两张不同参数/轮廓的配置（clipped-hex、notched-hex），每图分别对两个对手换座，不能把 8 局当作 8 张独立地图。
- 决策成本高于轻量启发式算法：默认图 p50/p95 为 **299/560 ms**，破障图 **475/970 ms**，随机挑战 **237/548 ms**；6 人环形图 **1008/2573 ms**，全样本最大 **3744 ms**。包含并行任务竞争，固定种子也不能消除按墙钟时间限额的黑盒对手在不同负载下的变化。
- 原始报告仅在本地 `temp/parallax-arena/release-*.json`，包含配置、种子、座位、逐局结果与耗时；没有写入正式竞技场战绩。

复现命令（项目根目录；`--games` 为每图每对手局数，偶数代表成对换座）：

```bash
for map in default breach dual-lanes danger-close; do
  npx tsx scripts/parallax-arena.mts --opponents verdict,greedy,random,mcts,threat,field --maps "$map" --games 2 --seed-base 920731 --out "temp/parallax-arena/release-$map.json"
done
npx tsx scripts/parallax-arena.mts --opponents verdict,threat --maps multiplayer-ring,whirlpool --games 2 --seed-base 720149 --max-rounds 60 --out temp/parallax-arena/release-extended.json
npx tsx scripts/parallax-arena.mts --opponents verdict,threat --maps random --games 4 --seed-base 510947 --random-preset challenge --out temp/parallax-arena/release-challenge.json
npx tsx scripts/parallax-arena.mts --opponents verdict --maps multiplayer-ring --players 3 --games 2 --seed-base 731017 --out temp/parallax-arena/release-ffa3.json
npx tsx scripts/parallax-arena.mts --opponents verdict --maps multiplayer-ring --players 6 --games 2 --seed-base 731019 --out temp/parallax-arena/release-ffa6.json
npx tsx scripts/parallax-arena.mts --opponents verdict --maps random --players 8 --games 2 --seed-base 731023 --out temp/parallax-arena/release-ffa8.json
```

### 强度边界

- 有限宽度的搜索和假想反击不能保证全局最优，也不能保证战胜未来算法或任意新增地图；地图适配以现有标准模式规则及公开配置契约不变为前提。
- 多人自由混战验证仅 **1 胜 5 负**，其中环形图 3/6 人均未获胜；不能将双人优势外推到多人，也未达到标准模式全部地图与人数下的全面压制。
- 开发阶段对默认图、破障、双线和单行动点地图的黑盒对抗均出现过败局；调参局与后续固定实现的验证局分别记录，不以开发小样本声称全面压制。

## 3.8.17（2026-10-29）— sovereign 统御算法 v1

### 新增功能

- **`sovereign`（统御算法）**：仅参与歼灭，依据权威规则独立设计，单文件零导入，不使用其他算法实现或策略工具；现有算法只作为不透明对手运行。注册为 `algo_sovereign` / `algo_sovereign@v1`，大厅、runner 与评估控制台由注册表接入，歼灭算法池扩至 5 个。档案见 [algorithms/sovereign.md](algorithms/sovereign.md)。
- **概率激活竞价**：枚举移动与攻击、治疗、爆破的组合，按精确离散伤害分布卷积评估至多 4 单位的齐射，计入行动点、目标格冲突和击杀后的反击减免；已激活单位及新部署单位可利用零剩余行动点下的免费后续动作。
- **多轮生存与协作**：最多前瞻 6 轮炮火，以地形路径上的最小累计炮伤估计逃逸成本；向最终安全区让出通道，重装可先移动再爆破。兵种数值、据点收益、部署折扣、行动点、裁决权重与缩圈节奏读取本局配置，不按地图名、对手名或单位 ID 分支。
- **本地评估工具**：[`scripts/sovereign-arena.mts`](../../scripts/sovereign-arena.mts) 用真实引擎黑盒对战，成对共享战斗种子并换座，支持 2–8 人与额外随机图；只向算法提供公开状态，非法动作、异常或未完成对局均以非零状态退出。报告与可选行动轨迹仅可新建于 `temp/`，不写竞技场历史或正式排行榜。

### 测试与验证

- 新增 **58 项**规则与战术回归，覆盖离散伤害全取值、不可变公共快照、名称无关性、行动点与免费后续动作、治疗范围、地形覆盖及路径阻塞、据点部署折扣、移动后爆破、隔墙让行、连续炮火撤退、增援生存估值，以及三套改变兵种/计分/炮火参数的配置和静态歼灭图全部支持人数的真实引擎短局自博弈。
- `npm run build`、`npm run check-version`、新增脚本与测试的严格类型检查通过；全量 `npm test` **143 文件 / 1540 用例通过**，评估 API **34 项**回归通过；评估 CLI 参数、输出路径边界与 2–8 人换座不变量检查通过。
- **冻结策略后的独立评估**：引擎 **3.8.17**、随机图生成器 **v1**、所有参评算法 **v1**，harness 为上述 `sovereign-arena.mts`，日期 **2026-10-29**。下表均为 sovereign 胜:负；双人静态图每图每对手 20 局，10 张随机新图每图每对手 2 局，多人组只用 `artillery-zone`、每对手 6 局，其余席位各自运行同一对手算法。

| 对手 | artillery-zone 双人 | trench-run 双人 | 10 张随机新图双人 | 三人局 | 六人局 |
|---|---:|---:|---:|---:|---:|
| random-annihilation | 20:0 | 20:0 | 20:0 | 6:0 | 6:0 |
| shrinkroll | 20:0 | 17:3 | 18:2 | 3:3 | 0:6 |
| vortex | 20:0 | 20:0 | 18:2 | 6:0 | 5:1 |
| crucible | 16:4 | 14:6 | 8:12 | 3:3 | 0:6 |
| 合计 | 76:4 | 71:9 | 64:16 | 18:6 | 11:13 |

- 种子与复现命令如下；随机图批次还包含默认两张静态图的 16 局（14 胜 2 负），这些局未重复计入表中静态组。全部最终独立批次共 **304 局，254 胜 50 负、0 平局、0 未完成、所有算法 0 非法动作及运行异常**；调参集及最后一次战术回归修正前的战绩均不混入这组评估。

```bash
node --import tsx scripts/sovereign-arena.mts --games 20 --seed 215501
node --import tsx scripts/sovereign-arena.mts --games 2 --random-maps 10 --seed 832041
node --import tsx scripts/sovereign-arena.mts --players 3 --games 6 --seed 312901
node --import tsx scripts/sovereign-arena.mts --players 6 --games 6 --seed 610101
```

- sovereign 单次决策 p95：静态双人 **9.94 ms**、随机图批次 **8.80 ms**、三人 **18.59 ms**、六人 **18.98 ms**，四组最大值 **100.16 ms**；为本机并行跑批观测值，不是实时延迟保证。浏览器确认歼灭目录显示统御、单算法不能启动、选择第二算法可启动，标准模式不显示统御，控制台无警告或错误；未启动写入竞技场历史的 UI 跑批。
- **强度边界**：静态双人对 crucible 为 **30:10**，随机新图为 **8:12**；六人局对 shrinkroll、crucible 各 **0:6**，并未全面压制现有算法，多人混战胜率也不能与双人胜率直接比较。齐射只执行首动作后重算，反击概率、协同收益和忽略未来单位占位的逃逸路径均为估计，不是完整对抗搜索，不承诺战胜未知未来算法或地图。

## 3.8.16（2026-10-29）— echelon 雁阵算法 v1

### 新增功能

- **`echelon`（雁阵算法）**：仅参与大逃杀（royale），效用 AI 单步决策。五个信息结构：①敌军落点扩散预报（停留 + 一跳/双跳 BFS 扩散，按"危险中疏散 / 接火原地开火 / 上轮移过的躲避者逃离威胁"三个可观察事实分档修正）；②精确战斗算术（均匀方差解析击杀概率、attackLock 逃逸面建模、前缀期望伤害累计进有效血量的集火、按击杀进度计价的单次命中价值、斩杀最后一单位一票支配）；③炮火圈生存调度（本轮边界挨炮格 = 危险格 ∪ 预警格，疏散效用压倒性；部署/治疗/落点全镜像引擎危险区口径；驻屯半径按全军机动能力前瞻未来安全圈）；④爆破距离场开路（以圈心为源的 Dijkstra 把"共享 blocker 邻居的 plain 格对"连成爆破传送边，牵引全军穿墙、重装拆"显著缩短场值"的墙，对任何地图形状成立）；⑤编成缺口与兵力上限（角色全部从 config.units 推导、在途部署计入缺口、兵力上限 = 行动点 +1、凹地拥挤门防堵塞）。被拒动作靠模块内「轮次 + 队列长度 + 上次发射指纹」记忆轮换次优候选。不参考仓库内其他强度算法实现、不读地图名或对手隐藏信息；设计与校准过程见 [开发笔记](ALGORITHMS_NOTES.md#echelon雁阵算法)，档案见 [algorithms/echelon.md](algorithms/echelon.md)。
- **注册与评估**：`algo_echelon` / `algo_echelon@v1`，`modes: ['royale']`；大厅、runner 与评估控制台由注册表自动接入。大逃杀模式自此有两个算法条目（`random-royale` + `echelon`）可组批跑榜。

### 变更

- **`scripts/horizon-arena.mts` 模式校验泛化**：从写死 `simultaneous` 改为按 `maps/<id>.json` 的 `mode` 字段校验算法注册模式，royale 地图（snowflake / narrow-road）可直接用于 headless 对拍标定；对既有 simultaneous 用法无行为变化。
- **评估控制台地图池按 `maps/` 自动生成**：控制台目录不再是手写清单，改为读取 `maps/*.json` 的 `name` 与 `mode`，四种模式共 13 张静态地图 + 「随机图」全部可选（此前漏了歼灭 `trench-run`、标准 `multiplayer-ring` / `whirlpool`，新图在界面上还露出英文 mapId）。榜单与玩法统计的地图中文名同步改为取自 `GET /api/maps`，不再各维护一份对照表。

### 测试与验证

- 新增 `tests/algorithms/echelon.test.ts`（20 例：决策门卫、零兵力部署、前缀感知的幽灵重复入队回归、锁定射击、击杀进度集火、治疗危险区镜像、预警格疏散、链式撤离、爆破开路、确定性、真实 snowflake 整轮入队校验）与 `tests/algorithms/echelon-selfplay.test.ts`（两图整局自博弈 0 非法动作、狭路断言终局）；`tests/algorithms/registry.test.ts` 补 echelon 元数据断言。
- 强度标定（真实引擎 headless 对拍 `scripts/horizon-arena.mts`，2026-10-29，逐局交换座位）：vs `random-royale` snowflake **30:0**、narrow-road **19:1**、snowflake 3P 1v2 **6:0**；镜像自博弈 snowflake 3:5/4 平（平局为规则允许的规避对峙、round_guard 兜底）、narrow-road 6:6 全部正常终局；全部对局 echelon 席位 **0 非法动作**；决策耗时单轮 p50 2.4–15.8ms、max 39.9ms。
- **新图开箱即用验证**：临时合成一张全新 royale 地图（开阔盘 + 花心十字墙、attacksPerUnit 2、不同炮火节奏与兵种数值，验证后删除）跑整局自博弈与对拍，echelon 零改动 0 非法；该图暴露并修复了算法地形解析优先级 bug（地形覆盖层"后者优先"语义未对齐引擎 gameIndex）。
- `npm run build` 通过；`npm test` 全量 **142 文件 / 1482 例全绿**（已含合入的 3.8.14 / 3.8.15 用例）。

## 3.8.15（2026-10-29）— crucible 熔炉算法 v1

### 新增功能

- **`crucible`（熔炉算法）**：仅参与歼灭，整回合束搜索（束宽 7、深度 ≤8）在即时执行镜像上排激活序列（让路/集火/部署免费补刀），叶值用本局 `adjudicationWeights` 计价军力差与击杀分，扣对手下回合贪心集火回推损失与逐单位缩圈时间线逃逸推演的不可避免圈伤，再加我方威慑折算与据点安全收入。独立设计、单文件零依赖，不参考/不调用其他算法，不读地图名或对手隐藏信息；一切参数取自本局 config，随机新图（含零初始单位、非零占领权重、`minimumSafeRadius: 0` 消耗战）自动适配。档案 `algorithms/docs/algorithms/crucible.md`，设计与评估见 [开发笔记](ALGORITHMS_NOTES.md#crucible熔炉算法)。
- **注册与评估**：`algo_crucible` / `algo_crucible@v1`，`modes: ['annihilation']`，大厅、runner 与评估控制台由注册表自动接入；歼灭算法池扩至 4 个（random-annihilation / shrinkroll / vortex / crucible）。本地换座标定 harness `scripts/crucible-arena.mts`（真实引擎进程内，成对换座、随机新图、零拒绝审计），不写竞技场历史。

### 测试与验证

- 新增 `tests/algorithms/crucible.test.ts`（9 例：模式隔离、双图双座位整局零拒绝、零初始单位随机图首回合部署回归、集火斩杀记账、危险区疏散、部署补刀真实 id 解析、独立实例确定性）；`tests/api/arena-eval.test.ts` 歼灭注册算法数同步为 4。
- 3.8.15 真实引擎本地标定（`scripts/crucible-arena.mts`，成对换座，2026-10-29）：固定两图对 vortex **80:0**、对 shrinkroll **75:5**（5 负全在 trench-run 消耗战残局）、对 random-annihilation **120:0**；随机新图 10 张对 vortex **21:1**、对 shrinkroll **20:2**、对 random-annihilation **22:0**；合计 **346 局 338 胜 8 负、零非法动作**，不写竞技场历史。种子、调参回退记录与已知限制见 [开发笔记](ALGORITHMS_NOTES.md#crucible熔炉算法)，不作未来必胜承诺。
- `npm run build`、`npm run check-version` 通过，全量 **140 文件 / 1459 用例通过**；竞技场评估 API 套件（33 例，含合并参与者目录）通过。

## 3.8.14（2026-10-29）— apex 绝境算法 v1

### 新增功能

- **`apex`（绝境算法）**：仅参与大逃杀，按地图数值与地形推导缩圈撤离、连续爆破开路、射程/机动/支援价值与可用行动点下的兵力规模；多情境逐步束搜索后用双人针对性回应检验计划。不调用其他策略、不读地图名称或对手隐藏队列；档案 `algorithms/docs/algorithms/apex.md`，设计与评估见 [开发笔记](ALGORITHMS_NOTES.md#apex绝境算法)。
- **注册与评估**：`algo_apex` / `algo_apex@v1`，`modes: ['royale']`，大厅与评估控制台由注册表自动接入；大逃杀可与 `random-royale` 组批。新增真实引擎本地评估脚本，支持成对换座、随机新图、独立启发式压力对手和多人自博弈，未结束局单列、不写竞技场历史。

### 测试与验证

- 35 项规则模型对拍与 19 项策略回归覆盖分步结算、炮火轮界、小数波动、信息隔离、队列缓存、残兵估值、连续障碍及重复碰撞；大厅与评估 API、桌面/移动端算法清单同步回归。
- 3.8.14 真实引擎本地标定：固定两图对随机/独立启发式各 60 胜，新随机 15 图对随机 30 胜、对启发式 29 胜 1 平，均零非法入队；六人自博弈 2 局完赛，三人 3 局到 80 轮仍未结束。种子、预算、耗时与已知败局见 [开发笔记](ALGORITHMS_NOTES.md#apex绝境算法)，不作未来必胜承诺。
- `npm run build`、`npm run check-version` 与新增脚本/测试的严格类型检查通过，全量 139 文件 / 1450 用例通过；浏览器大厅及评估选择验证通过，真实 HTTP + runner 对局绝境获胜、双方零拒绝/运行错误，未写竞技场历史。

## 3.8.13（2026-10-29）— vortex 旋涡算法 v1

### 新增功能

- **`vortex`（旋涡算法）**：仅参与歼灭，效用 AI 单步决策。按引擎公式预判 round+1 炮火安全圈，疏散出圈计正收益、进圈重罚，`hp ≤ 炮伤` 且无法撤离的"注定单位"转为免费输出；敌方 immediate/future 威胁图支撑稳杀集火与走位风筝，补给不计分口径下激进补员。不调用其他算法、不读地图名称或对手隐藏信息；设计与评估见 [开发笔记](ALGORITHMS_NOTES.md#vortex旋涡算法)，档案见 [algorithms/vortex.md](algorithms/vortex.md)。
- **注册与评估**：`algo_vortex` / `algo_vortex@v1`，`modes: ['annihilation']`，大厅、runner 与评估控制台由注册表自动接入；歼灭模式可与 `random-annihilation` 组批。

### 修复

- **评估 harness 快照缺 `game.artillery`**：headless `scripts/algorithm-arena.mjs` 的 `snapshot()` 未透出炮火区字段（线上 `sanitizeGameForResponse` 是透传的），`utils.inArtilleryDanger` 在竞技场对拍中恒为 false。已按线上口径补齐 `artillery` 与 `map.radius`；修复前 strict 审计报 119 次非法动作均源于此，算法侧镜像无误，修复后两算法均 0 非法。

### 测试与验证

- strict headless 对拍 `scripts/algorithm-arena.mjs --strict`：artillery-zone 与 trench-run 各 20 局 vs `random-annihilation` 全胜（均分 1161 / 953），vortex 席位 0 非法动作（两图合计 4816 次决策全部被引擎接受）。决策耗时 p50 0.08–0.12ms、p95 ≤ 2.03ms、max 8.4ms；战绩、耗时与已知限制详见 [开发笔记](ALGORITHMS_NOTES.md#vortex旋涡算法)。
- 竞技场 API 套件 `npx vitest run tests/api/arena-eval.test.ts`（33 场景）通过；`npm run build` 与全量 `npm test` 通过。竞技场榜单歼灭模式 vortex rating 1882 ±59（可见窗口 40W/0L）；全史口径 440W/0L（含清理前的镜像标定对局）。

## 3.8.12（2026-10-29）— 缩圈推演算法 shrinkroll v1

### 新增功能

- **`shrinkroll`（缩圈推演算法）**：歼灭模式的搜索型内置算法（shrink + rollout：按炮火缩圈时间线做回合内推演）。回合内束搜索（束宽阶梯 2 → 6 → 8、深度 4/6/8，确定性节点预算：两人局 260–700、多人局 320–620），叶值用本局 `adjudicationWeights` 的裁决分差（我方 − 最强对手，多人局次席按 `ACE_FFA_RIVAL=0.5` 折算），再扣炮火期望损失、对手一个回合内的击杀风险（`multiHitKillProbability`，多对手按 `1−Π(1−p)` 合成，两人/多人分档 `ACE_BETA` / `ACE_BETA_FFA`）与空过罚项；两人局对决赛圈做对手贪心 rollout。另含两处终局建模：炮火前瞻投影未来 K 轮安全半径（仅 `minimumSafeRadius <= 0`、即最终收满全图的图启用，权重 0.4），以及轮界裁决建模（据点流量累加 + `maxTurns` 判定，离上限不足 `ACE_ADJ_H` 轮时按趋势投影）。镜像与 `src/engine/{validation,units,combat,deployment,demolition,engine,artillery}.ts` 逐条对拍。
- **注册与档案**：注册名 `shrinkroll`（大厅 bot type `algo_shrinkroll`，竞技场参与者 id `algo_shrinkroll@v1`），`version: 'v1'`、`modes: ['annihilation']`；档案 `algorithms/docs/algorithms/shrinkroll.md`。这里的 `v1` 是对外注册版本，档案正文的 v1/v2/v3 为实现迭代编号，不改变参与者 id。
- **标定（开发期，真实引擎进程内 harness `temp/arena/bench.ts`，`--swap` 交换座位，2026-10-29）**：对 `random-annihilation` 两图各 240 局 **240/240 全胜**；对评测贪婪基线（`temp/arena/opponents/greedy-annihilation.mjs`，非仓库内算法）**100%（160/160）/ 98.75%（158/160）**；自我镜像 **50.0% / 49.7%**（各 160 局 ×2 座位）；3 人局（+2 贪婪）第一名 **90.0%（108/120）**、（+2 随机）**100%（120/120）**；未见过的随机歼灭图 **97.9%（47/48）**、改参数变体 **48/48**、6 人混战 **32/32**；全部对局零非法动作。
- **接口与耗时**：只实现 `decide`（不实现 `playTurn`），非 `annihilation` 或非 `active` 一律返回 `null`；单次决策 **4.91–10.85ms**（bench 串行）；真实 REST 服务端 + runner 子进程在 trench-run 与 artillery-zone 各跑一局均正常收场（shrinkroll 胜）。

### 测试与验证

- 新增 `tests/algorithms/shrinkroll-mirror.test.ts`（17 例：可达集、移动、攻击与击杀、单刀与多刀击杀概率、AP、部署/治疗/爆破、回合结束、轮界炮火、淘汰、`controlHold` 逐值、集火宏开关、炮火前瞻门控与 `maxTurns` 夹取）、`shrinkroll-determinism.test.ts`（6 例）、`shrinkroll-selfplay.test.ts`（5 例）；`tests/algorithms/registry.test.ts`、`tests/api/arena-eval.test.ts` 同步。
- `npm run build` 通过；`npm test` 全量 137 文件 / 1393 例全绿（数字见根 `RELEASE_NOTES.md` 3.8.12）。

## 3.8.10（2026-10-28）— 歼灭与大逃杀随机基线

### 新增功能

- **`random-annihilation`（歼灭随机算法）**：歼灭模式的随机基线，逐人轮流语义。与标准 `random` 共用轮流枚举（`algorithms/lib/random-turn.mjs`），并按引擎口径过滤炮火危险区——危险区内的部署（起点/落点）与治疗（支援兵/目标）不进候选，走进危险区仍合法。`modes: ['annihilation']`、`version: 'v1'`、参与者 id `algo_random-annihilation@v1`；档案 `algorithms/docs/algorithms/random-annihilation.md`。
- **`random-royale`（大逃杀随机算法）**：大逃杀模式的随机基线，同时回合计划队列。枚举层与 `random-sim` 共用 `algorithms/lib/random-plan.mjs`（形状瞄准、队列前缀投影、地形寻路、`attacksPerUnit`、炮火过滤）。`modes: ['royale']`、`version: 'v1'`、参与者 id `algo_random-royale@v1`；档案 `algorithms/docs/algorithms/random-royale.md`。

### 变更

- **三个随机基线改用独立条目**：标准 `random` 回归 `modes: ['standard']`，与两个新模式条目的注册名、展示名、版本、参与者 id 全部分开；历史 `algo_random@v1` 的战绩归属不变。
- **共享枚举**：轮流枚举抽到 `algorithms/lib/random-turn.mjs`，计划枚举抽到 `algorithms/lib/random-plan.mjs`；`random-sim` 改为薄入口，行为不变。
- **竞技场榜单**：`generateArenaLeaderboard` 只输出有对局的模式，声明了模式但零局的新条目不生成 0 局空榜。
- **评估链路接入歼灭/大逃杀**：`round_robin.py` 的 `SUPPORTED_EVAL_MODES` 扩为四种模式，`local-worker` 支持四种模式的进程内跑批（歼灭逐动作 + 轮界炮火、大逃杀计划队列），评估控制台两个模式改为可启动；非标准模式仍需至少 2 个该模式算法，当前各只有 1 个随机基线，启动会被拦下并说明还缺第二个算法。

### 测试与验证

- 新增 `tests/algorithms/random.test.ts`（12 例）：三个条目的载荷形态与短路、炮火区部署/治疗过滤（含「走进危险区仍合法」对照）；`artillery-zone`（歼灭）整局零非法并正常完赛、`snowflake`（大逃杀）跑满 6 轮零入队拒绝且炮火圈收缩。
- `tests/api/bots.test.ts` 补三个条目的准入/拒绝与目录回归；`tests/algorithms/registry.test.ts`、`tests/algorithms/game-utils.test.ts`、`tests/public/algorithm-picker.test.ts` 同步。
- `npm run build` 通过；`npm test` 全量通过（数字见根 `RELEASE_NOTES.md` 3.8.10）。

## 3.8.7（2026-10-27）— horizon 视界算法 v1

### 新增功能

- **horizon v1**：同时回合模式的第八个内置算法。把单轮分步结算后的棋盘投影到终局估胜率：据点到达时间模型、两轮攻城压力、下一轮威胁场与歼灭风险共同给出胜率；对手用同构贪心 / 静态开火 / 扰动贪心 / 斩首变体四套场景建模，逐行动点束搜索后再用对抗探针校验首选计划。分步结算镜像与 `src/engine/simultaneousResolve.ts` 逐点对拍零偏差；零依赖、不读地图 ID、不使用对手隐藏队列与事件史。
- **注册与档案**：注册名 `horizon`（大厅 bot type `algo_horizon`，竞技场参与者 id `algo_horizon@v1`），`modes: ['simultaneous']`，`version: 'v1'`；档案 `algorithms/docs/algorithms/horizon.md`。
- **标定与竞技场**：3.8.2 真实引擎（`scripts/horizon-arena.mts`，standoff / molten-throne ×4 对手 ×30 局，种子基 20261026）合计 **236:4（98.3%）**、零非法；HTTP + runner 23 局零被拒；竞技场首批归档 504 局 **297W/206L/1D（58.9%）**、评分 **1614**（2026-10-27 榜单快照）。molten-throne 对 matrix-eq 的 27:3 为斩首取胜、据点流量低于对手，属已知取舍。

### 测试与验证

- 新增 `tests/algorithms/horizon.test.ts`（24 例）与 `tests/algorithms/horizon-selfplay.test.ts`（4 例）：接口短路、缓存对账、计划期合法性镜像、分步结算逐点对拍、3.8 分步语义（跨步移动后攻击、`attacksPerUnit`、失败连锁、`wait`）、治疗镜像、多席位与通用性自查；双人两图与 3/6 人抽样整局零非法。
- `npm run build` 通过；`npm test` 118 文件 / 1087 例全绿。

## 3.8.6（2026-10-25）— mistpine 与竞技场工具链

### 新增功能

- **mistpine 进入同时回合算法池**：新增 34v34、零经济、总部禁部署、每轮 12 行动点的同时回合地图；同时回合评估与竞技场地图池扩至 standoff / molten-throne / mistpine。
- **竞技场平均决策耗时**：模式评分榜与参与者画像新增该列，跑批逐动作记录决策墙钟耗时（含被拒重选与计划提交）。
- **评估控制台清空旧局**：可按模式 / 地图 / 参与者筛选并 dry-run 预览后删除 `arena/matches.jsonl` 中的命中对局，跑批进行中拒绝。

### 测试与验证

- 新增 mistpine 地图加载与开局回归、决策耗时聚合回归与清空旧局接口回归；`npm run build` 通过，`npm test` 116 文件 / 1056 例通过，`tests/rl` pytest 73 通过。

## 3.8.5（2026-10-24）— tempo-weave 经纬算法 v1

### 新增功能

- **tempo-weave v1**：同时回合模式的第七个内置算法。以「哪个单位完成什么任务、需要几个行动点、结束后能否存活」为决策单位——先生成变长任务（直接射击、区域治疗、占点、跨步接敌后射击、脱离火力圈、攻城接近、开路），再在共享行动点预算内按收益/成本竞价排程（按已用行动点分桶的有限宽度搜索，650ms 软预算），并用独立实现的分步结算镜像做己方队列的静止参照投影；三席及以上按逐敌方席位的火力包络与己方 HQ 剩余 HP 提高回防紧迫度。实现零导入、不读取地图 ID、不使用对手隐藏队列。
- **注册与档案**：注册名 `tempo-weave`（大厅 bot type `algo_tempo-weave`，竞技场参与者 id `algo_tempo-weave@v1`），`modes: ['simultaneous']`，`version: 'v1'`；档案 `algorithms/docs/algorithms/tempo-weave.md`。
- **竞技场跑批**：新增 528 局（11 个对阵 ×2 图 ×24 局），`arena/matches.jsonl` 36,480 → **37,008** 局；同时回合分区 480 → **1,008 局**、参与者 5 → **7**。tempo-weave 首战 **288:0**、Bradley-Terry 评分 **2355** 第一；tempo 288 局 **134W/154L**、评分 **1444**；prism 扩至 288 局 **229W/59L**、评分 **1839**（3.8.3 首战 192 局 181:11 / 1977，转为历史快照）。标准榜 36,000 局不变。

### 测试与验证

- 新增 `tests/algorithms/tempo-weave.test.ts`（74 例）：接口与席位短路、信息隔离、前缀缓存与撤回/重排/外部插入 wait 的失效、随机合法计划与镜像对拍、规则边界回归。
- 新增 `tests/algorithms/tempo-weave-selfplay.test.ts`（5 例）：standoff / molten-throne 双人整局、standoff 三人与六人整局零 API 拒绝并正常完赛；坐标平移、异形缺格、数值与行动点扰动后仍能完赛。
- 3.8.5 集成复验：新增回归 79 项全部通过；真实引擎抽样两图 × kriegspiel / dest-prob × 各 2 局换座 **8:0**、API 拒绝 0；真实 HTTP 链路 3 局全部正常完赛、动作拒绝 0。
- `npm run build` 通过；`npm test` 116 文件 / 1040 例全绿。

## 3.8.4（2026-10-24）— tempo 时序掌控算法 v1

### 新增功能

- **tempo v1**：同时回合模式的第六个内置算法。把队列位置（结算拍）当成决策变量：先为每个敌军推一条最可能的行为剧本（抢点 / 原地开火 / 残血撤退 / 推进）并逐拍投影位置；再把敌方预测射击与可及火力区叠成「第 k 拍 × 格子」的威胁时间线，移动候选按落地拍起的累计暴露计价；最后读 `adjudication` 分差与剩余轮数调节攻守（领先收敛避险、落后加压求变、末轮把补给换单位），按价值把动作排进具体拍——斩杀与锁定射击抢早拍，占点到达与治疗压末拍，部署抢先当墙。全部数值读 `config` / `adjudication`，无 `mapId` 分支，同一实现覆盖 `standoff` / `molten-throne`。
- **注册与档案**：注册名 `tempo`（大厅 bot type `algo_tempo`，竞技场参与者 id `algo_tempo@v1`），`modes: ['simultaneous']`，`version: 'v1'`；档案 `algorithms/docs/algorithms/tempo.md`。首发前修复同一单位反复折返的排程问题。

### 测试与验证

- 新增 `tests/algorithms/tempo.test.ts`（11 例）：无座位 / 已提交 / 行动点用尽短路、锁定射击瞄敌人当前格、移动后按投影站位取瞄准格、支援兵治疗受伤友军、侦察兵抢可达据点、被拒动作重排、反折返，以及真实 `standoff` 双方整轮计划逐条通过引擎入队校验并连续 5 轮零非法。
- 新增 `scripts/tempo_benchmark.mjs`：真实引擎进程内跑批，投影口径与 `rl/training/local-worker.ts` 的 decide 通道一致，支持算法名或 `.mjs` 路径对打。
- 2026-10-24 标定（每对 60 局 = standoff 40 + molten-throne 20，双方零非法动作）：对 random-sim **100%**、dest-prob **55.0%**、kriegspiel **50.0%**、matrix-eq **43.3%**；按图 molten-throne 85–90%、standoff 32–40%（40/20 局样本的置信区间约 ±15 个点）。
- `npm run build` 通过；`npm test` 114 文件 / 961 例全绿。

## 3.8.3（2026-10-24）— prism 棱镜算法 v1

### 新增功能

- **prism v1**：同时回合模式的第五个内置算法，路线为**整轮联合队列束搜索**——每层扩展一个行动点的移动/攻击/治疗/部署/爆破/待命候选，对 `press` / `mobile` / `objective` / `hold` 四种对手行为假设分别运行同步结算镜像，再按本局裁决权重和“加权均值 + 最差情境惩罚”保留完整计划。镜像覆盖队列前缀投影、地形 BFS、同一步到达冲突与腾格依赖、部署/移动、形状攻击、`attackLock`、治疗、`attacksPerUnit`、级联失败、同步死亡与总部淘汰；本回合新部署单位可被攻击但不会在同轮获得后续动作。
- **通用性约束**：不依赖或路由任何现有算法；不读取 `mapId`、不按地图名分支；仅使用公开快照与己方 `myQueue`。地图差异全部来自 `config` 的兵种、形状、部署、据点、裁决权重与炮火危险区。
- **注册与档案**：注册名 `prism`（大厅 bot type `algo_prism`，竞技场参与者 id `algo_prism@v1`），`modes: ['simultaneous']`，`version: 'v1'`；档案 `algorithms/docs/algorithms/prism.md`，README / 开发指南 / 算法总览同步。
- **竞技场跑批**：prism 对 4 个同时算法 ×2 图 × 每对阵 24 局，8 批共 192 局全部入库；**181:11**（standoff 96:0、molten-throne 85:11；对 random-sim 48:0、dest-prob 46:2、kriegspiel 46:2、matrix-eq 41:7），同时榜 Bradley-Terry 评分 **1977** 暂居第一；样本为双人、两图、固定算法池。

### 测试与验证

- `tests/algorithms/prism.test.ts` 2 例：接口短路与整轮计划缓存续吐。
- `tests/algorithms/prism-selfplay.test.ts` 3 例：standoff / molten-throne 双人整局、standoff 三人前四轮，零非法动作。
- 真实引擎换座冒烟（3.8.3、`evaluate_cross.py`、每对阵每图 2 局）：horizon 8:0、matrix-eq 4:0、kriegspiel 2:0，合计 14:0；仅 7 组 ×2 局，不作稳定优势结论。
- `npm run build` 通过；`npm test` 113 文件 / 950 例全绿。

## 3.8.2（2026-10-23）— 同时回合评估链路

### 新增功能

- **评估控制台支持同时回合**：`/api/arena/eval/start` 按地图 `mode` 接受 `simultaneous` 批次（standoff / molten-throne）并拒绝混模式，地图、算法与模型清单随模式联动；`round_robin.py` 新增 `--mode`。
- **进程内评估链路适配同时回合**：`rl/training/local-worker.ts` 支持队列动作与按座位脱敏，`evaluate_cross.py` 支持逐轮入队、提交与统一结算。
- **同时回合首轮榜单**：288 局跑批全部入库，新增 4 名参与者各 144 局；榜首矩阵均衡 1730、兵棋推演 1692、落点概率 1676、同时随机 903（2026-10-23 快照）。

### 测试与验证

- `npm run build` 通过；`npm test` 111 文件 / 944 例、`npm run test:rl` 73 例通过；288 局跑批 0 失败。

## 3.8.1（2026-10-23）— 同时回合算法 v2：3.8.0 分步引擎适配

### 变更

- **random-sim 升级到 v2**：移除“一单位一轮一动作”保守枚举，同一单位可跨行动点连续行动；攻击/治疗/移动按队列前缀的投影站位计算，移动改为只按地形 BFS（单位/总部不挡路），部署/移动按投影后空位判断，并遵守 `balance.attacksPerUnit`（默认 1）。仍保持均匀随机策略，不引入启发式。
- **kriegspiel 升级到 v2**：镜像对象从旧 `resolveRound` 换成 `simultaneousResolve.ts:resolveRoundSteps`——级联失败、到达判定与依赖传播、同一步腾格/交换、`attackLock` 按计划时刻锁定、逐步死亡、终局轮跳过占点；计划校验改为队列前缀投影，候选生成逐行动点重算，新增 `wait` 与 `demolish`，搜索邻域扩展为换步/删步/插 `wait`/交换相邻步/追加，敌方计划改为有序采样。
- **matrix-eq 升级到 v2**：重写分步结算镜像、投影站位/地形寻路校验与组合动作生成（move→attack、attack→move、两连移、移动+治疗）；新增自适应利用混合（γ = min(0.45, 0.12×实证轮数)）与池内精修（≤8 个有界变异）；`round_resolved` 按步序重建敌方计划。
- **dest-prob 升级到 v2**：按 3.8 分步引擎重写候选生成——队列前缀投影站位、同一单位跨行动点连续行动、地形寻路（单位/总部不挡路）、`attacksPerUnit` 攻击上限、投影空位部署与重装爆破；治疗按投影站位并去重。保留解析式对手落点模型，不做整轮模拟。同 harness 对 v1 50/60（83.3%）、对 random-sim 60/60。
- **算法 runner 支持 `wait`**：`algorithms/lib/api-client.mjs` 新增 `wait()`，`algorithms/lib/interfaces.mjs` 的 `decide` 分发新增 `case 'wait'`，算法可主动把关键动作对齐到更晚行动点。

### 修复

- random-sim 修复 3.8.0 规则下行动点用不满、枚举口径与引擎不一致的问题。
- kriegspiel v2 修复旧镜像的整轮单发语义；但 `destination_occupied` 候选未排除敌军当前占位，实测 17.1–23.1 次结算失败/局，已记录为已知短板，待 v3 修复（详见 `algorithms/kriegspiel.md`「已知限制 #2」）。

### 测试与验证

- `random-sim`：18 个单测（形状瞄准、治疗瞄格、AP、同单位多动作、`attacksPerUnit`、投影站位、目的格去重、部署预算、炮火过滤、真实 standoff 整轮合法性）。
- `kriegspiel`：真实引擎逐点对拍 40 个局面零偏差；standoff / molten-throne 各 30 局 ×3 对手共 180 局零非法；对 random-sim 60:0、对 dest-prob 52:8（86.7%）、对 matrix-eq v2 29:31（standoff 27:3、molten-throne 2:28 为已知斩首短板）；v1 同 harness 基线对 dest-prob 43.3%、对 matrix-eq 31.7%，适配价值 +43.4pp / +16.6pp，v1↔v2 直接对打 35:25（p=0.245）未达显著。
- `matrix-eq`：镜像裁判（2026-10-23 修复后复跑，standoff 30 局、交替座位）v2 vs v1 **24:6（80.0%）**、vs kriegspiel v1 11:19、vs dest-prob v1 14:16、vs random-sim 30:0；对当前 v2 kriegspiel / dest-prob 各 7:23。v1 对照 120 局零非法；单次 decide 2.3–3.2ms；冒烟 107 动作零非法、单轮最大 47ms。
- `dest-prob`：14 个单测覆盖落点分布/冲突规避/预测射击/arc 治疗/部署/原地占点/同单位多动作/队列投影攻击/地形寻路/`attacksPerUnit`/真实两图整轮入队；整局自博弈两图零非法。真实引擎同 harness 30 局/图：对 random-sim 60/60，对 v1 50/60（83.3%），对 kriegspiel v2 21/60、对 matrix-eq v2 23/60（抽样）。
- `npm run build` 通过；`npm test` 111 文件 / 939 例全绿（dest-prob v2 加入后单测数见主项目测试记录）；四份算法档案新增/补齐 `v1 → v2` 五段式版本说明。

## 3.8.0（2026-10-22）— 同时回合改为按行动点分步结算

### 变更

- **队列位置就是行动点**：所有玩家的第 k 条动作同时结算完再结算第 k+1 条；同一单位可跨行动点连续行动，每个行动点每人仍只能执行一条动作；`round_resolved.results` 与动作事件新增 `step`，`round_resolved` 新增 `steps`。
- **新增 `wait`**：消耗 1 行动点、不做任何事，用于对齐关键动作；`POST /api/games/:id/plan/wait`。
- **每单位每轮攻击上限**：地图 `balance.attacksPerUnit`（默认 1），入队/重排/撤回/结算四层校验，超出 `attack_limit_reached`。
- **到达与失败语义**：同一步先移出再移入，允许交换/链式腾格；硬失败级联作废该单位本轮后续动作（`previous_action_failed`），攻击落空/治疗无人不触发级联；占用/地形判定延迟到结算，计划期只做结构性校验。
- **计划操作**：新增 `POST /plan/reorder` 原子重排；`plan/revoke` 撤回后按新顺序重放校验，依赖被撤动作的撤回会被拒绝。

### 算法影响

- 所有同时回合算法的旧镜像进入适配期：random-sim、kriegspiel、matrix-eq 在 3.8.1 升 v2；`dest-prob` 在 3.8.0 时仍按旧“一单位一动作”口径运行，3.8.1 已升 v2（见上），3.7 的 100:0 等数据只代表旧规则。
- 算法档案新增规则镜像章节，明确计划期投影、地形寻路、`attacksPerUnit` 与失败连锁语义。

### 测试与验证

- 新增 `tests/engine/simultaneous-steps.test.ts`，覆盖逐点推进、移动到总部失败、跨步腾格、敌方腾格后进入、移动失败连锁、同步交换/链式腾格、`wait` 对齐、部署填格、爆破后移动、阵亡单位后续动作与提前终局。
- `npm run build` 通过；`npm test` 110 文件 / 927 例全绿。

## 3.7.5（2026-10-22）— matrix-eq 矩阵均衡算法 v1

### 新增功能

- **matrix-eq v1**：把每轮升维成「计划组合 × 计划组合」矩阵博弈——我方 10 个候选整轮计划（6 种策略人格 + 4 个随机权重）与敌方镜像计划（含 `round_resolved` 事件史重建的真实计划）逐组合跑镜像结算器算支付，用 CFR 自我对弈求均衡混合，再按 ε=0.15 与“对实证分布的纯最优响应”混合后抽样；`decide` 每轮首次调用求解并缓存整轮计划，之后逐动作吐出。
- 注册键 `algo_matrix-eq`，`modes: ['simultaneous']`；大厅算法下拉与 `/api/algorithms` 由注册表自动带出；档案 `algorithms/docs/algorithms/matrix-eq.md`。

### 测试与验证

- `tests/algorithms/matrix-eq-selfplay.test.ts`：standoff / molten-throne 两人局与 standoff 三人局，整局零非法并正常完赛。
- 无服务器脚本：`scripts/matrix_eq_smoke.mjs`（116 动作零非法、无 NaN、同局同轮可复现、单轮最大 61ms）与 `scripts/matrix_eq_benchmark.mjs`（镜像裁判、真随机掷骰 + 引擎回合生命周期）。
- standoff 2 人局各 30 局（交替座位）：matrix-eq 对 random-sim 30:0、对 dest-prob 14:16（顺序对照合计 25:35，p≈0.20）、对 kriegspiel 8:22；150 局零非法，单轮求解最大 173ms。
- 真实服务器端到端：standoff 双 matrix-eq bot 完成 15 回合裁定（149 个动作、30 次提交，零 `action_failed` / `bot_failed`）；`npm test` 109 文件 / 902 例全绿。

## 3.7.4（2026-10-22）— 竞技场按玩法模式分榜

### 变更

- Arena 榜单数据改为 `modes[]`，按地图 `mode` 拆成独立评分池；页面新增模式切换条，地图池、参评者、对位矩阵、KPI 与玩法统计跟随模式。
- 算法按 `ALGORITHM_META.modes` 只进入支持的模式；`/api/arena/participants` 返回算法 modes；评估控制台按模式分组，但进程内跑批仍只支持 standard。

### 测试与验证

- 新增 `tests/public/arena-mode.test.ts`，扩展 `generateArenaLeaderboard` / `generateArenaStats` 的模式分组、算法隔离与档案评分测试；`npm test` 108 文件 / 898 例全绿。

## 3.7.3（2026-10-22）— kriegspiel 兵棋推演算法 v1

### 新增功能

- **kriegspiel v1**：把整份计划放入镜像 `resolveRound` 的 JS 单轮结算器真实结算，按 `objective` / `aggressive` / `random` 三种对手性格做蒙特卡洛 rollout，以「均值 − λ·标准差」风险调整分选择计划并爬山精修；复用 dest-prob 的 `computeAim` / `enumerateAims` 与落点模型。
- 注册键 `algo_kriegspiel`，`modes: ['simultaneous']`；档案 `algorithms/docs/algorithms/kriegspiel.md`。

### 测试与验证

- `tests/algorithms/kriegspiel-selfplay.test.ts`：真实 standoff / molten-throne 对局中每个 `decide` 输出均可入队，零非法动作。
- headless 标定（交替先手，各 30 局 ×2 地图 ×2 对手）：对 random-sim 60/60、对 dest-prob 34/60（56.7%），240 局零非法；单轮搜索约 20ms、缓存命中时 `decide` 约 2–3ms。
- `npm test` 107 文件 / 888 例全绿。

## 3.7.2（2026-10-22）— Destination Probability 落点概率算法

### 新增功能

1. **落点概率算法（dest-prob）**：同时回合模式的第二个内置算法 `algorithms/builtin/dest-prob.mjs`（注册键 `algo_dest-prob`，`modes: ['simultaneous']`）。它把同时回合的隐藏计划当成分布问题：先为每个敌军建立"原地 + 可达格"的落点概率（占点引力、火力机会、我方威胁、支援锚点、原地惯性，softmax 归一化），再据此计算预测射击（覆盖格上的出现概率 × 伤害）、目的格冲突风险（同一格被多人声明会一起失败）与每个候选落点的期望承伤。据点按裁定流量权重 × 预计持有回合 + 收入计价，因此开局会优先铺开占点。与 threat/field 的静态威胁表不同，dest-prob 的核心输入是"敌人下一步会站哪"；与 mcts 不同，它不做整局模拟，单步毫秒级。
2. **注册与入口**：注册表 `ALGORITHM_META` 新增 dest-prob 展示元数据；大厅算法下拉、`/api/algorithms` 与 bot 接口由注册表自动带出，无需另立清单。

### 测试与验证

- 新增 `tests/algorithms/dest-prob.test.ts` 9 例：敌军落点分布把可占据点排在原地之前、冲突规避、预测射击空格、arc 治疗、部署、原地占点、提交/无座位/AP 短路，以及真实 standoff / molten-throne 的整轮入队校验。
- 新增 `tests/algorithms/dest-prob-selfplay.test.ts` 2 例：standoff 与 molten-throne 整局互相对弈，零非法动作并正常完赛。
- `tests/algorithms/registry.test.ts` 与 `tests/api/bots.test.ts` 补 dest-prob 的 modes、展示名、版本与大厅添加断言；dest-prob 测试补同单位多动作、队列投影攻击、地形寻路、`attacksPerUnit` 与整局自博弈。
- headless 自博弈（`temp/dest-prob-100.mts`，逐局交替先手、种子基 1000）：vs random-sim 在 standoff / molten-throne 各 100 局 **100:0**、零非法动作；两图场均击杀 3.10 / 0.96（random-sim 0.23 / 0.01），场均裁定分 1105.10 : 280.13 / 3503.22 : 671.14；种子基 5000 复测各 100 局同样 100:0；3 人 standoff 10:0、6 人 standoff 5:0（零非法冒烟）。

## 3.7.1（2026-10-21）— 取消过期模型机制

### 变更

- **模型参评口径**：`v2.3.2@340K`、`v2.5.0@2M`、`v2.6.0@3.6M` 不再有独立过期状态，`rl/models/` 下 19 个可加载模型全部恢复参评；`GET /api/rl/models` 不再过滤，`round_robin.py` 自动发现不再排除过期模型（单图 300 批 / 7,200 局）。
- **竞技场与统计**：页面移除「显示已过期」开关与归档表，榜单/统计 JSON 移除 `expired` 系列字段与 `payload.expired` 段；`arena/model-status.json`、`script/expireArenaModels.mjs`、`npm run arena-expire` 及对应测试删除，模型状态只保留推荐 / 历史 / 作废。

### 测试与验证

- 删除 expired 相关测试与脚本；`rl/docs/MODELS_NOTES.md` 与 Docker 打包同步。

## 3.7.0（2026-10-20）— 算法客户端幂等与长轮询

### 变更

- 所有玩法写接口支持可选 `Idempotency-Key`，同键同 body 回放首次响应，同键不同 body 返回 409；算法客户端与 RL 环境为每个逻辑动作生成并复用键。
- 新增 AI 长轮询等待端点 `GET /api/games/:id/wait`；`wait-turn.mjs`、算法 runner 与 RL runner 改为优先长轮询、旧服务器回退轮询。
- bot 子进程监管与凭证传递：token 改环境变量，异常退出退避重启，最多 3 次后写 `bot_failed` 事件。

### 测试与验证

- 新增幂等回放/冲突/降级、wait 超时/唤醒/鉴权、状态投影/304、生命周期归档等 12 例；`npm test` 103 文件 / 869 例全绿。

## 3.6.0（2026-10-10）— 裁决分重构与 verdict 同步

### 变更

- 裁决分改为「对总部伤害 + 己方总部生命 + 据点流量 + 军力价值 + 补给 + 击杀价值」，移除行动功绩分；补给权重归零，新增击杀价值权重；同时回合按 turnOrder 归属致命一击，环境击杀无归属。
- **verdict** 同步新口径：局势评估加入击杀项与据点流量混合，lethal 打击按目标造价 × 击杀权重加分；竞技场与自动对局统计列由 `merit` 改为 `kills`。
- 3.5.x 的标准算法胜率全部变成旧计分口径；引用历史数据时必须标注，不可与 3.6.0 之后数据直接比较。

### 测试与验证

- `npm test` 729 例全绿；新增 11 例覆盖击杀归属、过量击杀、炮火击杀无归属、据点流量混合、旧回放口径边界等。

## 3.5.12（2026-10-06）— 算法按模式注册隔离 + 同时随机算法

### 新增功能

1. **同时随机算法（random-sim）**：首个同时回合（simultaneous）模式算法 `algorithms/builtin/random-sim.mjs`。与标准 random 同宗的随机基线：每轮从所有合法**计划动作**中随机入队，返回 null 即提交。适配同时模式的核心语义——攻/治按 `attackShape`/`healShape` 瞄准格子（single/line/arc）、一单位一轮一动作、队列长度即行动点、部署预算扣减已排队花费、己方目的格认领去重；座位经 `ctx.owner` 传入（同时模式没有 `turn.currentPlayerId`）。所有枚举镜像 `planning.ts` 入队校验（形状瞄准、一单位一动作、目的格认领、部署预算扣减、炮火危险区）——被拒动作会让 runner 空耗重问配额与请求往返，故按镜像直接过滤，不依赖服务器拒绝来发现非法动作。

2. **算法按对局模式注册，不同模式不能混用**：注册表 `ALGORITHM_META` 新增 `modes` 字段（缺省 `['standard']`，存量 6 个算法显式标注），是全链路的唯一口径：
   - 大厅 bot 接口 `POST /api/games/:id/bots/algorithm` 按算法 modes 校验对局模式，不匹配返回 400 `bot_not_supported`（文案列出算法支持的模式与当前模式）；
   - `algorithms/runner.mjs` 启动时按注册表 modes 校验（替代原硬编码 standard-only），并支持同时模式的行动等待（`phase === 'active' && !plan.committed.includes(side)`）；
   - `rl/training/local-worker.ts` 的 decide 通道拒绝模式不匹配的算法（`reset` 的 standard-only 保留——apply 通道只实现标准语义）；
   - `rl/evaluation/round_robin.py` 的算法发现只取支持 standard 的算法（评估地图池全是标准图）；`/api/arena/participants` 同步过滤；
   - 前端「算法类型」下拉（play.html / play-m.html）由写死的静态清单改为打开对话框时拉取 `/api/algorithms` 并按当前对局模式过滤——消除了注册表之外的第三份算法清单。

3. **接口适配**：`runAlgorithm` 新增第五参 `ctx`（透传为 decide 第三参，存量算法签名不变）；`GameApiClient` 新增 `attackCell` / `healCell`（攻/治瞄格变体，与按目标 id 的原方法并存，interfaces 按 payload 形态自动分发）；`game-utils.deployOrigins` 排除 `canDeploy: false` 类型的据点（与引擎 `deployOriginFor` 同口径，molten-throne 仅前线基地可部署）。同时回合模式下动作被服务器拒绝（非 429）不再跳出循环提前提交计划——记住被拒动作、刷新状态让 decide 重选（同一被拒动作不重复请求服务器），重问与被拒合计 20 次即带已排计划提交兜底；逐人轮流模式保持「失败即结束回合」行为不变。

### 测试

- 新增 `tests/algorithms/random-sim.test.ts`（16 用例：line/arc/single 瞄准合法性、arc 治疗瞄格、AP 门控、已提交短路、无 ctx.owner 短路、一单位一动作、目的格认领、部署预算扣减、炮火危险区过滤四用例（部署出生点 / 落点、治疗施放者 / arc 覆盖扇形，均先用引擎入队校验交叉证实拒绝场景真实存在），以及真实 standoff 对局上「枚举动作全被引擎入队校验接受 + 双座提交后正常结算进下一轮」的整轮回归）；新增 `tests/algorithms/registry.test.ts`（注册算法 modes 完整性）与 `tests/algorithms/interfaces.test.ts`（5 用例：同时模式动作被拒后继续决策入队且最终只提交一次、同一被拒动作按上限重问且不重复请求服务器、连续多个动作被拒有上限兜底、轮流模式失败即断行为不变、429 原样抛出不提交）；`tests/api/bots.test.ts` 补模式隔离三用例与 `/api/algorithms` modes 断言；`tests/api/arena-eval.test.ts` 断言参评清单不含 `algo_random-sim`；`tests/rl/local-worker.test.ts` 补 decide 通道模式混用拒绝用例。

## 3.5.11（2026-10-06）— forge→molten-throne：同时回合地图池变化

### 变更

- 标准图 `forge` 下线并替换为同时回合图 `molten-throne`；旧 `forge` 上的标准算法对拍（含 verdict vs threat 10:20）失效，不能作为当前强度依据。
- 同时回合地图池定型为 `standoff` / `molten-throne`；后续同时算法（random-sim、dest-prob、kriegspiel、matrix-eq）均按这两张图标定。

## 3.5.4（2026-09-18）— Verdict 裁决线算法

### 新增功能

1. **Verdict 裁决线算法**：新增反向规划（backward induction）AI `algorithms/builtin/verdict.mjs`，算法 AI 从 5 个扩展到 6 个。与既有四个算法的根本区别是**前向打分 → 反向规划**：不评估"这一步好不好"，而是先选"这局我用哪条线赢"，再从那个终局倒推出本回合每个单位的任务与期限。
   - **裁决账本（所有动作的共同货币）**：引擎终局裁决分是可解析的（`src/engine/engine.ts` `scorePlayer`），算法把每个动作折算成"能改变多少裁决分"。权重随地图走（`default` 5/2/90/2/1，`danger-close` 20/1/30/1/0），于是"打总部远比打单位值""拿一个据点 = 击杀一个满血步兵""部署一个步兵净赚 45 分"这些结论是**读出来的，不是配出来的**，换图自动改变。
   - **三条裁决线**：斩首 `decap`（总部归零 = 立即获胜，价值拉满）/ 磨平 `wear`（打不光就换总分，总部伤害是裁决里权重最高的可累积项）/ 裁定 `hold`（守住分差到期末）。
   - **反向排程（核心）**：`siegeTimeline()` 从"敌方总部归零"逐回合倒推一个微缩攻城战——每回合行动点先供赶路单位移动、剩下的给已到位单位开火（单发伤害高的先吃行动点）——直到累计伤害 ≥ 总部剩余血，得到 `killRound`。`slack = 剩余回合 − killRound` 就是 tempo 预算，直接决定风险姿态：≥3 储备 / 0–2 压上 / 打不光 磨平换分 / 敌方排程 ≤3 回合先拿下我方总部 → **全线回防**。同一条排程反过来跑敌方 = 敌人的斩首线（四个既有算法都只看"我这步赚不赚"，没有这一步）。
   - **排程按抵达概率折损**：每单位按"路上要穿过几格敌方打击区"折算 `STEP_SURVIVAL^危险步数`（下限 0.1）。不折损的排程会对着永远打不到的终点无限乐观。
   - **tempo 量纲（`ALGORITHMS_NOTES` 点名的共同短板）**：行动点预算第一次被显式建进排程（赶路与开火争抢同一份行动点），交换阈值也不再是手工配的常数——"打击分 − 原地承伤 × 姿态系数"，进攻姿态把风险折到 0.65（够本就不怕死）、储备姿态折到 1.35（宁可绕路也不换命）。
   - 决策 p50 0.13–0.61ms / p99 2.1–6.6ms（与 threat / field 同量级，无搜索无模拟）。实测（`scripts/algorithm-arena.mjs`，逐局交替先手）：**vs greedy 7 图 ×30 局 201:9（95.7%）**，两套种子基给出完全相同的合计；vs threat 161:49（76.7%）、vs field 186:24（88.6%）、vs random 24:0。**补上了两个老短板的另一半**：`danger-close`（1 行动点/回合）24:6 / 21:9（80%/70%，threat 同口径 18%）、`multiplayer-ring`（7 行动点）30:0（100%，field 同口径 7%）；已知短板是 `forge` 对上 threat 只有 10:20、以及 4 人局未标定（four-corners 20 局 2/20 席位局）。
   - 注册链路：`registry.mjs`（`verdict` + v1 展示元数据）、前端 `play.html` / `play-m.html` 下拉（`algo_verdict`；后端 `ALGORITHM_BOTS` 由注册表自动生成）；档案 `algorithms/docs/algorithms/verdict.md`。
   - 测试：`tests/algorithms/verdict.test.ts`（12 场景：裁决账本优先级、稳杀集火、斩首收束、排程单位一步只推进一格也不提前交回合、磨平线交换裁决、紧急回防、治疗、部署、被全歼仍补员、行动点门控、已移动单位不得再移动、拆墙正反例）与 `tests/algorithms/verdict-selfplay.test.ts`（default/breach/desert/dual-lanes/danger-close/multiplayer-ring/随机图整局零非法动作）。

### 开发过程记录（十处结构性约束，其中四条各值 20 个以上百分点）

1. **结束回合门槛必须极小**：`decide` 返回 `null` 的语义是"结束整个回合"，门槛一旦接近 `PACE_POINTS`，只能再走一格时会被直接掐掉回合（与 threat/field 同源）。
2. **所有耗行动点的动作必须过 `canAct` 门控**：runner 遇错会 `break` 掉整个回合、作废剩余行动点。
3. **部署判定必须排在"无事可做就结束回合"之前**：否则部队被全歼或全员已行动完时 `options` 为空会直接 `endTurn`，退化成"兵力只减不增"。
4. **"已经到位"（剩余步数 0）那一档的推进梯度必须归零**：用 `到位收益 ÷ 剩余步数` 会在剩余步数 0 时报出"再进一格 = 整个到位收益"，远程兵于是继续贴脸，甚至放下已经够到的打击去走一格挣这份假梯度（实测：游侠放着 **111 分**的总部打击不打，去走一格挣 **133 分**）。
5. **不能顺手把推进梯度改成调和衰减**：看着更"正确"（边际递减），但远处梯度会衰减到几乎与 `PACE_POINTS` 同量级，长图上部队走不动——breach 100%→57%、dual-lanes 93%→57%。**已被数据否决的方向。**
6. **打击选项必须扣"原地承伤"**：开火意味着这个回合就停在原地、承担敌方下一轮全部火力。不扣这一项，算法会在隘口把整支军队换光——打一炮的成本被当成 0，而撤退的收益仍在，于是"反正躲不掉，不如打"退化成"主动走进躲不掉的位置"：dual-lanes **60%→93%**。
7. **打击选项必须另加"暴露下降"差分**：打死的人下回合不再开枪，这一炮确实让自己更安全。没有它，"集火斩杀"就只是多打掉几十点血，永远打不过"撤到安全格"（46.8 分 < 56.4 分）。注意是差分 `before − after`，不是再扣一次完整风险（第 6 条已经扣过）。
8. **攻城排程必须按抵达概率折损**：不折损的排程对着永远打不到的终点无限乐观——dual-lanes（双路夹墙、走廊被对面火力全覆盖）上排程恒报"3 回合可破"，整局往绞肉机里填人，胜率 **53%→83%**（再配合第 6 条到 93%）。
9. **回防目标必须有自己的到位收益**：只给 `PACE_POINTS` 的话，"回家"就是一个 5 分/步的平坡，任何一点路过的风险都能把单位推离自家总部——守成线变成"绕着老家兜圈子"（实测：紧急回防时单位反而退了 3 格）。
10. **守成/回防姿态下必须压低接战倾向**（`POSTURE_OFFENSE`）：否则单位为了挪到"好火力位"会放弃任务（实测紧急回防的步兵为了挪到敌方总部隔壁、赚 90 分的机会火力，而不回家）。

另有一条标定：`STEP_SURVIVAL` 一维扫描 0.72 / 0.62 / 0.55 / 0.45 / 0.35 → 89.0% / 92.4% / **95.7%** / 回落（multiplayer-ring 100%→60%）/ 进一步回落（default 73%）。再往下排程过度悲观、斩首线永不触发，全军落到磨平线上硬换。

### 性能测试

vs greedy（各图 30 局，逐局交替先手；两套种子基）：

| 地图 | 种子基 1000 | 种子基 3000 | threat 同口径 | field 同口径 |
|---|---:|---:|---:|---:|
| default | 29:1（97%） | 30:0（100%） | 95% | 60% |
| breach | 30:0（100%） | 30:0（100%） | 88% | 57% |
| desert | 30:0（100%） | 30:0（100%） | 70% | 87% |
| dual-lanes | 28:2（93%） | 30:0（100%） | 95% | 83% |
| forge | 30:0（100%） | 30:0（100%） | 80% | 60% |
| danger-close | 24:6（80%） | 21:9（70%） | 18% | 97% |
| multiplayer-ring | 30:0（100%） | 30:0（100%） | 50% | 7% |
| **合计** | **201:9（95.7%）** | **201:9（95.7%）** | 197:82（70.6%） | 135:75（64.3%） |
| random 地图 | 18:12（60%） | — | 53% | 40% |

vs 其他算法（各 7 图 ×30 局）：

| 对手 | 战绩 | 逐图（default/breach/desert/dual-lanes/forge/danger-close/ring） |
|---|---:|---|
| threat | 161:49（76.7%） | 24 / 30 / 27 / 18 / **10** / 30 / 22 |
| field | 186:24（88.6%） | 28 / 30 / 28 / 16 / 30 / 30 / 24 |
| random | 24:0（100%），24 局 | default |

## 3.5.3（2026-09-16）— Field 势场算法

### 新增功能

1. **Field 势场算法**：新增人工势场（Artificial Potential Field）AI `algorithms/builtin/field.mjs`，算法 AI 从 4 个扩展到 5 个。
   - **斥力井（敌方火力）**：每敌军以"BFS 可达格 ∪ 原地"为核心、按射程环展开，核心外再外扩 N 环按 `0.5^环距` 衰减，半径外势为 0；每格承伤按 `actionsPerTurn` 截断，**且按敌军去重**（每格每敌只记最强一档，对应"每个单位每回合只能开火一次"）。
   - **引力井（阵地）**：据点井深 `70 + 收入 × min(剩余回合, 8)`（敌方据点 ×1.5），井形 `深度/(1+距离)`；**周围 2 格内每多一个己方 canCapture 友军，井深 ×0.6**（认领衰减 → 多单位自动分头抢点）；己方据点另有驻军轻锚（敌人回收前必须先吃掉守军）。
   - **推进缓坡**：从目标点 BFS 出**波前距离场**（真实绕行步距）作为推进势，直接消掉 APF 的经典局部极小值（纯直线梯度会把单位顶在墙根，breach 图实测 37% vs 57%）。
   - **风筝走位（涌现）**：落点收益 = 势能 − 0.75×该落点本回合可打出的最优火力，贴脸格势高、外围格无火力，平衡点自发落在射程外沿（实测游侠对重装：距 5 格→落到距 3 格；打完则撤出敌方打击范围）。
   - **尺度自适应**：小图（六边形半径 ≤ 6）斥力外圈 1 环、据点井 4 格；大图 2 环 / 5 格。
   - 决策 p50 0.1–0.2ms / p99 3–4ms（与 threat 同量级）。实测（`scripts/algorithm-arena.mjs`，逐局交替先手）：**vs greedy 7 图 ×30 局 135:75（64.3%）**、vs random 24:0、vs threat 12:18（default 30 局）。**性能曲线由行动点预算决定**：danger-close（每回合 1 行动点）29:1（97%，threat 同口径仅 18%）、multiplayer-ring（7 行动点）2:28（7%，已知短板，304 回合里 280 次带着剩余行动点交回合）。
   - 注册链路：`registry.mjs`（`field` + 展示元数据）、前端 `play.html` / `play-m.html` 下拉（`algo_field`；后端 `ALGORITHM_BOTS` 由注册表自动生成，无需改 `bots.ts`）；档案 `algorithms/docs/algorithms/field.md`。
   - 测试：`tests/algorithms/field.test.ts`（19 场景，含风筝走位/风筝回撤/分头抢点/火力上限截断与四条行动点-回合收尾回归）与 `tests/algorithms/field-selfplay.test.ts`（default/breach/desert/dual-lanes/随机图整局零非法动作）。

### 开发过程记录（三处结构性 bug，均被单元测试或对拍定位）

1. **反击风险量纲错乱**：攻击的致命判定把"势能值"（潜在承伤 ×0.8 × 疲劳，且封顶 0.85×单位价值）与血量直接比较，斥力势普遍压过血量阈值 → 单位被贴脸也从不还手，初版 **30 局 0 胜**。改为用原始伤害量纲与血量比较。
2. **机会火力选完落点才补减**：先按裸势选最优格再扣除火力折扣，安全的外围格永远赢过"贴脸可开火"格 → 单位长期停在射程外（攻击 6.4 次/局 vs greedy 35.7）。改为火力参与逐格比较。
3. **孤军 cohesion 为 Infinity**：无友军时"最近友军距离"为 `Infinity`，代入后所有落点势都是 `Infinity`、增量为 `NaN` → 场上只剩一个单位时一个移动动作都不生成。加 `Number.isFinite` 门控。
   另有一处计费去重：射程 3 的游侠其射程环会从多个核心格重复覆盖同一格，逐条累积等于把同一敌人算成 5 次齐射（41 点承伤放大到 205），改为按敌军去重。

### 性能测试

vs greedy（各图 30 局，逐局交替先手）：

| 地图 | field | threat 同图对照 |
|---|---:|---:|
| default | 18:12（60%） | 95% |
| dual-lanes | 25:5（83%） | 95% |
| breach | 17:13（57%） | 88% |
| desert | 26:4（87%） | 70% |
| forge | 18:12（60%，另一套种子 14:16） | 80% |
| multiplayer-ring | 2:28（7%） | 50% |
| danger-close | 29:1（97%） | 18% |
| **合计** | **135:75（64.3%）** | 197:82（70.6%） |
| random 地图 | 12:18（40%） | 53% |

其他对局：vs random 24:0（24 局 default）、vs threat 12:18（30 局 default）。
**非传递结果**：danger-close 上 field 打 greedy 97%、threat 打 field 60%、threat 打 greedy 仅 18%——三方相克，单图胜率不可外推。

## 3.5.1（2026-09-13/14）— MCTS、Threat 算法与文档体系

### 新增功能

1. **MCTS 算法**：新增蒙特卡洛树搜索 `algorithms/builtin/mcts.mjs`，UCB1 选择（探索常数 1.414）、每决策 100 次模拟、最大深度 8、目标导向动作采样（移动取最贴近 `movementGoal` 的可达格；`canCapture` 单位对可达范围内的中立/敌方据点生成显式占领动作，优先级 1.2；采样未覆盖到可动单位时回退贪心移动）。部署（deploy）不在 MCTS 动作空间内，由 decide 入口按补给/兵力状况先行决策（触发条件与 greedy 一致）。
   - **评估函数**：我方单位价值总和；敌方存活单位价值作负资产扣分（击杀即收益，规模随人数自适应）；我方总部存活按血量 ×2 计分、阵亡 -10000；敌方总部按已受伤害 ×3 计分、阵亡 +10000。
   - **动作优先级**：攻击总部 > 击杀低血单位 > 治疗 > 移动。
2. **Threat 威胁感知算法**：新增效用 AI `algorithms/builtin/threat.mjs`。
   - **威胁图**：每敌军两级格子集合（原地射程环 `immediate` 权重 0.85、机动后覆盖 `future` 权重 0.45），落点潜在承伤按 `actionsPerTurn` 截断求和——只算敌方本回合真能开火的次数，避免火力密度随军队规模线性高估。
   - **攻击**：期望伤害 + 斩杀奖励（稳杀全额 / 大概率 ×0.6）− 反击风险（稳杀目标从威胁图扣除）。
   - **移动**：与原地比较取增量，含抢点（收入按据点 kind 取实际值 + 终局裁定分）、走位火力投射、连续化威胁惩罚 `min(0.8×单位价值, 威胁×0.8×(2−hp/maxHp)))、推进项、扎堆扣分、残血贴治疗。
   - **部署**：与战斗动作同一尺度比较（`DEPLOY_UTILITY` 250），且必须排在"无事可做"判定之前，否则部队被全歼后再也不补员。
   - 单步决策 p50 0.25ms / p95 2.0ms / p99 3.6ms。实测（`scripts/algorithm-arena.mjs`，逐局交替席位）：vs greedy 7 图 ×40 局 **197:82（70.6%）**、vs 初版 threat 31:9、vs mcts 14:6、vs random 24:0、随机地图 17:15；短板：danger-close（每回合 1 行动点）7:33、3-4 人席位未标定。
   - 同期修正 greedy / mcts / random 的行动点预算门控（同一个 bug 家族，动作失败会让 runner 作废整回合），修正后三方零非法动作；mcts vs greedy 的历史基线由 8:22 重测为 5:15。
   - 测试：`tests/algorithms/threat.test.ts`（15 场景，含"行动点耗尽不得返回需耗点动作""只能推进一格不得提前交回合""被全歼后仍要补员"三条回归）与 `tests/algorithms/threat-selfplay.test.ts`（跑完整对局断言零非法动作）。
   - **初版标定教训**：初版（`THREAT_SCALE=2.2` + 结束回合门槛 4 + 无预算门控）在同口径下只有 41.1%，breach 图 0 胜 40 局；6 局样本的"3:3"结论被 280 局推翻。

3. **算法注册与前端集成**：`registry.mjs` 注册 `mcts`、`threat`；`src/api/bots.ts` 新增 `algo_mcts`、`algo_threat` 配置；`play.html` / `play-m.html` 下拉菜单新增对应选项。算法 AI 从 2 个扩展到 4 个（greedy / random / mcts / threat）。添加弹窗支持自定义玩家名（默认预填所选算法的中文名，类型切换时刷新；服务端接受可选 `name`，缺省用算法中文名），移动端 `play-m.html` 同步完整支持算法页签。
4. **算法文档体系**：新建 `algorithms/docs/`（`ALGORITHMS_NOTES.md` 开发笔记、`RELEASE_NOTES.md` 发布记录、`algorithms/*.md` 单算法档案），模板与 `rl/docs/models/*.md` 对齐。
5. **冒烟测试脚本**：新增 `scripts/test-algorithm-bots.mjs`，本地起服后一键验证算法 bot 对局推进（默认 mcts vs random，可传参指定任意两个 `algo_*` 组合）。

### 性能测试

#### vs 其他算法（default 地图）

| 对局 | 胜率 | 备注 |
|---|---|---|
| mcts vs random | 100% (12:0) | 终局评分约 3200 vs 500，评分碾压为主 |
| mcts vs greedy | 26.7% (8:22) → 修正后 25% (5:15) | 旧值是双方都带行动点预算 bug 时测的；两者修正后重测仍同一量级（mcts 未播种，批次间波动大） |
| threat vs random | 100% (6:0) | 8-13 回合速胜 |
| threat vs greedy | 50% (3:3) | 12-15 回合；威胁感知走位 + 稳杀集火，高于 mcts 但样本仅 6 局待扩 |

> 上表 mcts/threat 的 6 局小样本已被推翻：3.5.1 发布前用新工具 `scripts/algorithm-arena.mjs` 重测（每图 40 局、逐局交替席位、并审计非法动作），完整口径见 `ALGORITHMS_NOTES.md` 与 `algorithms/threat.md`：threat vs greedy **197:82（70.6%）**、vs 初版 31:9、vs mcts 14:6。对 RL 模型的同口径实测仍未做；mcts 的模拟用未播种随机数，批次间会飘。

### 已知限制

1. MCTS 模拟为单边推演，不建模对手回应；不爆破障碍单位。
2. MCTS 战斗效率低于 greedy（不主动集火），单位交换比吃亏。
3. MCTS 决策含随机模拟，胜负方差大；算法强度对比需 30+ 局的正式锦标赛（见未来方向）。
4. Threat 为单步效用贪心，不推演对手回应链；落点承伤已按敌方 `actionsPerTurn` 截断（不再线性高估火力密度），但仍假设每个敌军都选择打我；权重全部在 2 人对局上标定，**3-4 人席位实测不优于 greedy**；`danger-close`（每回合 1 行动点）7:33 是已知短板。

### 提交记录

- `<hash>` — feat(algorithms): 实现 MCTS 算法并注册到算法 AI
- `<hash>` — feat(ui): 算法 AI 自定义玩家名与移动端算法页签
- `<hash>` — docs(algorithms): 算法文档体系

---

## 3.5.0（2026-09-13）— 算法 AI 系统首次发布

### 新增功能

1. **算法 AI 基础设施**
   - 通用算法运行器 `algorithms/runner.mjs`
   - 算法注册表 `algorithms/registry.mjs`
   - REST API 客户端封装 `algorithms/lib/api-client.mjs`
   - 游戏工具函数库 `algorithms/lib/game-utils.mjs`
   - 接口适配器 `algorithms/lib/interfaces.mjs`

2. **服务器集成**
   - `src/api/bots.ts` 新增 `/api/games/:id/bots/algorithm` 端点
   - 房主可通过 API 添加算法 AI 到大厅
   - 服务器自动 spawn Node.js 子进程运行算法
   - 进程生命周期管理（启动、监控、清理）

3. **前端集成**
   - `play.html` 和 `play-m.html` 的"添加 AI"对话框新增"算法脚本"标签
   - 下拉菜单选择算法类型
   - 与强化学习模型统一的 UI 交互

4. **两个内置算法**
   - **random**（随机算法）：从所有合法动作中随机选择
   - **greedy**（贪心算法）：攻击 > 治疗 > 爆破 > 部署 > 移动

### 算法实现细节

#### random（随机算法）

- **决策逻辑**：收集所有合法动作，随机选择一个执行
- **复杂度**：O(n)，n 为合法动作数
- **用途**：基准对照、测试工具
- **性能**：极弱，仅作为最低基准

#### greedy（贪心算法）

- **决策优先级**：
  1. 攻击可击杀目标（优先总部 > 低血单位）
  2. 治疗受伤友军（优先低血、高价值单位）
  3. 重装爆破障碍物（开辟通路）
  4. 从总部/据点部署单位（资源允许时）
  5. 移动单位向目标推进（抢占据点/接近敌方总部）
- **复杂度**：O(n²)，n 为单位数
- **特点**：无全局规划，局部最优，快速决策
- **性能**：中等，适合快速对战和演示

### 性能测试

#### 算法间对战（default 地图，各 32 局）

| 对局 | 胜率 | 先手胜/后手胜 | 平均回合数 |
|---|---|---|---|
| greedy vs random | 96.9% (31:1) | 16:0 / 15:1 | 42 |

**结论**：greedy >> random

#### 算法 vs RL 模型（random 地图，48 局配对换座）

| 对局 | 胜率 | 先手胜/后手胜 | 备注 |
|---|---|---|---|
| greedy vs v2.7.0 | 18.8% (9:39) | 6:18 / 3:21 | RL 碾压 |

**结论**：算法 AI 与训练良好的 RL 模型有显著差距。

### 技术要点

1. **双接口设计**：策略接口（`decide`）适合简单算法，完整控制接口（`playTurn`）适合复杂算法
2. **工具函数复用**：从 `scripts/auto-standard-game.mjs` 提取并重构通用游戏逻辑
3. **进程隔离**：每个算法 AI 运行在独立 Node.js 子进程，崩溃不影响服务器
4. **统一管理**：算法 AI 与 RL 模型使用相同的进程管理机制
5. **仅支持标准模式**：当前版本算法 AI 不支持歼灭模式和同时回合模式

### 文档

- `algorithms/builtin/README.md` — 算法开发指南
- `algorithms/docs/ALGORITHMS_NOTES.md` — 算法开发笔记
- `algorithms/docs/RELEASE_NOTES.md` — 本文件
- `algorithms/docs/algorithms/*.md` — 单算法详细档案

### 已知限制

1. **仅支持标准模式**：歼灭模式和同时回合模式需要额外适配
2. **性能上限**：算法 AI 无法与训练良好的 RL 模型竞争
3. **计算开销**：MCTS 每个决策需要 100 次模拟，耗时约 0.5-1 秒
4. **状态模拟简化**：MCTS 的状态模拟是简化版，不完全等价于真实游戏规则

### 未来方向

1. 支持歼灭模式和同时回合模式
2. 实现 Minimax + Alpha-Beta 剪枝算法
3. MCTS 参数可配置化（迭代次数、探索常数等）
4. 多线程并行搜索（Worker Threads）
5. 算法性能自动化测试和排行榜
6. Python 算法支持（跨语言互通）

### 提交记录

- `658231c` — chore(data): 重算统计数据
- `<hash>` — feat(algorithms): 算法 AI 系统首次发布
- `<hash>` — feat(algorithms): 实现 MCTS 算法
- `<hash>` — docs(algorithms): 算法文档和开发指南

---

## 附：3.5.5–3.5.8 规则/地图变更对算法口径的影响

| 版本 | 变更 | 对算法的影响 |
|---|---|---|
| 3.5.5 | 新增 `balance.deployFromHq` 总部部署开关 | `algorithms/lib/game-utils.mjs` 的 `deployOrigins()` 同步过滤总部；六个标准算法不再在禁总部图浪费部署试探 |
| 3.5.7 | `four-corners` 下线 | 4 人局旧标定（verdict 2/20）不再可复现 |
| 3.5.8 | `desert` 下线 | 含 desert 的 7 图合计转为历史口径，不能作为当前强度依据 |

## 版本号说明

算法 AI 系统随主项目版本发布；算法实现自 3.8.1 起在 `algorithms/registry.mjs` 的 `ALGORITHM_META.version` 标注 `vN`，竞技场参与者 id 使用 `algo_<name>@vN`，历史对局仍归属旧版本 id。3.5–3.7 的算法实现未严格版本化，本文中的 v1 为回溯标注，具体变更以文件修改时间和 git 提交记录追溯。当前同时回合算法：`random-sim` v2、`dest-prob` v2、`kriegspiel` v2、`matrix-eq` v2、`prism` v1、`tempo` v1、`tempo-weave` v1、`horizon` v1。
