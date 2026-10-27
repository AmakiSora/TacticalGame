# TacticalGame

尖顶六边形、轴坐标 `q/r` 的回合制多人战棋。支持 2-8 名玩家自由混战，玩家争夺地图据点获取补给，在总部或己方据点部署单位，摧毁其他玩家总部并成为最后存活者。除逐人轮流的经典模式与歼灭模式外，`standoff`、`molten-throne`、`mistpine` 等地图提供**同时回合模式**：全员秘密下达指令，服务器统一同时结算，无先手优势、多人无需排队等待；`snowflake`（雪花）与 `narrow-road`（狭路相逢）地图则提供**大逃杀模式（royale）**——同时回合的指令方式叠加歼灭缩圈规则。

当前版本：`3.8.7`。完整版本变更见 [`RELEASE_NOTES.md`](RELEASE_NOTES.md)（编写规范见 [`docs/RELEASE_NOTES_SPEC.md`](docs/RELEASE_NOTES_SPEC.md)）。

## 技术栈

- 后端：Node.js + TypeScript + Fastify
- 前端：原生 HTML/CSS/JS + Canvas
- 数据：内存状态 + 本地持久化文件，服务器重启后恢复对局
- 地图：`maps/*.json` V2 hex 配置
- 对战记录：`records/` 保存导出的回放 JSON、复盘 Markdown 和 AI 日志

## 启动

```bash
npm install
```
```bash
npm run dev
```
默认监听 `0.0.0.0:3100`。页面：

| 路径 | 说明 |
|---|---|
| `http://localhost:3100/` | 首页：模式介绍、单位速览与功能入口 |
| `http://localhost:3100/play.html` | 创建/加入并手动操作（窄屏自动进入手机版） |
| `http://localhost:3100/play-m.html` | 玩家手机版：大厅、触控棋盘与操作抽屉 |
| `http://localhost:3100/spectator.html` | 观战、导入回放、导出 JSON/HTML（窄屏自动进入手机版） |
| `http://localhost:3100/spectator-m.html` | 观战手机版：触控棋盘、回放栏与信息抽屉 |
| `http://localhost:3100/stats.html` | 对局统计看板（模型排行、对位、地图与对局列表） |
| `http://localhost:3100/arena.html` | AI 竞技场：按玩法模式分榜的 RL 模型 × 内置算法榜单、对位矩阵、玩法统计与评估控制台 |
| `http://localhost:3100/entertainment.html` | 娱乐数据看板（回合节奏曲线、战斗群像、势头学、名场面与纪录柜） |
| `http://localhost:3100/map-editor.html` | 本地导入、可视化编辑并导出地图 JSON |

### 统计数据

统计页和娱乐数据页都是纯静态页面，分别读取 `public/data/stats.json` 与 `public/data/fun-stats.json`，不访问对局 API。数据由脚本扫描 `records/V2` 与 `records/V3` 回放生成：

```bash
npm run stats
# 等价于 node script/generateStats.mjs

npm run fun-stats
# 等价于 node script/generateFunStats.mjs

npm run stats-all
# 依次刷新回放统计两份 + 竞技场榜单与玩法统计
```

新增或更新回放后运行 `npm run stats-all` 即可同时刷新两个看板。竞技场数据独立成链：对战记录在 `arena/matches.jsonl`（由 `rl/evaluation/round_robin.py` 累积，页面内评估控制台可网页发起跑批——标准模式跑模型与算法混合循环赛，同时回合模式跑该模式注册的算法，跑批依赖仓库里的 `round_robin.py`、`script/generateArena*.mjs` 与本地模型，属本地开发功能，Docker 镜像不携带，
线上相关写接口返回 `501 arena_eval_unavailable`），
榜单与统计由 `npm run arena-leaderboard` / `npm run arena-stats` 生成（详见 `rl/README.md`「AI 竞技场」节）。

性能基线可用 `npm run bench` 重跑，覆盖持久化全量写、状态响应、引擎可达格、随机地图与回放解析；结果写入 `temp/perf/latest.json`（`temp/` 不入库）。

远程使用删除对局、强制裁决、管理员改名等管理接口时建议设置：

```bash
AUTO_CONTROL_TOKEN=<your-token> npm run dev
```

未设置 `AUTO_CONTROL_TOKEN` 时，这些管理接口只允许本机访问。

### Agent 简写对照

对战记录文件名与玩家名中的 Agent 简写（如 `tg_0155_rank01_QD@qwen3.8Flash.md` 里的 `QD`）按表对照全名；唯一来源是 `script/generateStats.mjs` 的 `AGENT_NAMES`，新增 Agent 时同步补那里即可：

| 简写 | 全名 | 简写 | 全名 |
|---|---|---|---|
| `PI` | pi | `CP` | CatPaw |
| `OMP` | oh my pi | `WB` | workbuddy |
| `DSH` | DeepSeek Harness | `ZC` | zcode |
| `QD` | qoder | `CC` | ClaudeCode |
| `QW` | QoderWork | `CX` | codex |
| `TW` | TraeWork | | |
| `TC` | TraeCode | | |

## 对局持久化

服务会把每个对局写到 `runtime/store/<gameId>.json`（临时文件 + `fsync` + 原子替换），启动时自动恢复；`runtime/games.json` 是旧版单文件格式，只在首次升级时导入、创建/删除/退出时导出。`runtime/` 已在 `.gitignore` 中，不会上传 git。

需要回滚或迁移到旧格式时：

```bash
npm run export-state
```

`TACTICAL_GAME_STATE_FILE` 仍可改状态根文件位置；快照目录会放在同一目录的 `store/` 下。测试环境默认不启用持久化，除非显式设置 `TACTICAL_GAME_STATE_FILE`。

## 核心规则

规则唯一规范源是仓库根 `skill/`（服务器经 `GET /api/skill/files/:name` 下发同一份内容）；对局数值一律以本局 `config` 与 `GET /api/games/:id` 的实时状态为准。本节只做速览，不再复写细则：

| 模式 | 内置地图 | 核心机制 | 规范文件 |
|---|---|---|---|
| `standard` 逐人轮流 | `default`、`breach`、`danger-close`、`dual-lanes`、`multiplayer-ring`、`whirlpool` | 有总部、有行动顺序；总部归零淘汰；达到 `maxTurns` 按裁决分定胜负 | [skill/standard.md](skill/standard.md) |
| `annihilation` 歼灭 | `artillery-zone` | 无总部；炮火预告后逐轮向中心收缩；危险区禁部署/治疗/维修；最后存活者获胜 | [skill/annihilation.md](skill/annihilation.md) |
| `simultaneous` 同时回合 | `standoff`、`molten-throne`、`mistpine` | 无行动顺序：先秘密排队，再按行动点分步同时结算；攻击/治疗瞄准格子或方向 | [skill/simultaneous.md](skill/simultaneous.md) |
| `royale` 大逃杀 | `snowflake`、`narrow-road` | 同时回合结算 + 歼灭规则（无总部、炮火收缩、打光即淘汰） | [skill/royale.md](skill/royale.md) |

所有模式共享的速览：

- 尖顶六边形，坐标 `{ q, r }`；`game.cells` 是实际可用格集合（`map.radius` 不等于可走圆盘）；地形只有 `plain` 可通行/部署，`water` 与未爆破的 `blocker` 不可通行。
- 行动点按**单位激活**计：首次部署/移动/攻击/治疗/爆破耗 1 点，同一单位本回合后续合法动作免费，上限 `config.balance.actionsPerTurn`。
- 部署来源、占领限制、治疗与爆破的角色限制、收入与维修规则按模式与地图配置，见对应 skill 文件。
- 裁决公式的权威定义见 [skill/SKILL.md](skill/SKILL.md)「Adjudication score」，实时分数直接读 `GET /api/games/:id` 的 `adjudication`，不要自行重算。
- 歼灭计分、同时回合的分步结算/失败连锁/攻击形状、大逃杀炮火节奏等模式细则只维护在对应 skill 文件。地图清单与逐图数值以 `maps/*.json` 为准（文件名即 mapId）。

## 单位

单位与总部数值**按地图配置**，不要跨图套用：同一兵种在不同地图上数值不同（例如 `mistpine` 步兵 68 血，`default` 为 100；`default` 总部 180 血）。每局读 `game.config.units`、`game.units[]` 的实例字段（`hp` / `attack` / `defense` / `moveRange` / `attackRange` / `cost` / `canCapture` / `healPower`）与 `config.headquartersSpec`；读取口径与战斗掷骰公式见 [skill/SKILL.md](skill/SKILL.md)「Units」，逐图数值与经济配置见 `maps/*.json`。

## REST API

完整接口参考见 [docs/API.md](docs/API.md)。玩家操作带 `X-Player-Token`，房主管理带 `X-Host-Token`；删除对局、强制裁决、管理员改名与竞技场跑批等控制接口使用 `AUTO_CONTROL_TOKEN`（未设置时仅本机可调用）。

常用入口：

| 用途 | 接口 |
|---|---|
| 对局状态 | `GET /api/games/:id`（支持 `include` 投影与 ETag） |
| 等待轮次/事件 | `GET /api/games/:id/wait?afterSeq=<seq>&timeout=<seconds>` |
| 事件流 | `GET /api/games/:id/events`（`Accept: text/event-stream` 时建立 SSE） |
| 玩法动作 | `POST /api/games/:id/{deploy,move,attack,heal,demolish,end-turn}` |
| Agent 技能 | `GET /api/skill`、`/api/skill/manifest`、`/api/skill/files/:name` |
| 健康与指标 | `GET /healthz`、`GET /readyz`、`GET /metrics` |

失败响应统一为 `{ error, code }`；玩法动作支持 `Idempotency-Key` 幂等重试。事件类型与回放格式、AI 机器人、回放库与竞技场评估接口见 [docs/API.md](docs/API.md)。

## 地图格式

地图位于 `maps/`，文件名就是 `mapId`（例如 `default.json` 对应 `mapId: "default"`）。服务启动时会加载并校验地图配置，`GET /api/maps` 返回可选地图：

浏览器地图编辑器位于 `http://localhost:3100/map-editor.html`。它只做本地导入、可视化编辑和导出 JSON；导出的文件需要手动放入 `maps/`，再重启服务或重新加载配置后使用。

```json
{
  "grid": "hex",
  "orientation": "pointy",
  "radius": 8,
  "terrainCells": [{ "q": 0, "r": 1, "terrain": "water" }],
  "controlPoints": [{ "id": "cp_c", "name": "中央阵地", "q": 0, "r": 0, "kind": "supply" }],
  "headquarters": {
    "player_a": { "q": -8, "r": 0 },
    "player_b": { "q": 8, "r": 0 }
  },
  "startingUnits": [{ "owner": "player_a", "type": "infantry", "q": -7, "r": 0 }],
  "units": {},
  "headquartersSpec": { "hp": 180, "defense": 6 },
  "balance": {
    "startingSupplies": 80,
    "baseIncome": 10,
    "controlPointTypes": {
      "supply": { "income": 12, "deployDiscount": 0, "repairAmount": 0 },
      "forward_base": { "income": 8, "deployDiscount": 8, "repairAmount": 0 },
      "repair": { "income": 8, "deployDiscount": 0, "repairAmount": 10 }
    },
    "damageVarianceRange": 3,
    "minimumDamage": 1,
    "healVarianceRange": 6,
    "actionsPerTurn": 5,
    "maxTurns": 15,
    "adjudicationWeights": { "enemyHqDamage": 5, "ownHqHp": 2, "controlPoint": 90, "armyValue": 2, "supplies": 1 }
  }
}
```

异形地图可另外声明 `"playableCells": [{ "q": 0, "r": 0 }, { "q": 1, "r": 0 }]`。该字段可选；省略时，加载器按 `max(abs(q), abs(r), abs(-q-r)) <= radius` 展开完整六边形。声明时可组成任意凹形、凸形、带孔洞边界，也允许断开成多座互不相连的岛（地图编辑器同样支持开裂），但每个坐标仍须位于 `radius` 包络内，岛间格子天然无法互相移动。加载后所有地图都会得到完整权威格子列表，移动、部署、爆破、寻路和绘图都以该列表为准。`GET /api/maps` 的 `preview.cells` 也始终返回已经解析并带地形的预览格子。

`balance.maxTurns` 接受 `>= 1` 的有限数字，或写成 `null` 表示**无回合上限**：引擎不会在回合边界做轮数裁决，对局仅由一方全灭、总部/军力被毁或房主 `POST /api/games/:id/force-adjudicate` 结束。前端回合角标此时显示 `当前轮/∞`，地图卡片显示 `⏱∞`，地图编辑器可用「无回合上限」开关切换。

歼灭模式地图另外声明 `mode: "annihilation"`、`annihilation.artillery`，并让每个 `spawnSlots[]` 通过 `controlPointId` 关联一个唯一出生据点；大逃杀模式地图声明 `mode: "royale"` 时同样**必须**携带 `annihilation.artillery` 与据点绑定的出生槽（`minimumSafeRadius` 允许为 0，即最终只剩中心一格安全）。炮火参数包含首次生效轮次 `startRound`、收缩间隔 `intervalRounds`、每轮伤害 `damage` 和最终安全半径 `minimumSafeRadius`。当前内置歼灭模式地图“炮火禁区”（`artillery-zone`）支持 2、3、6 人，采用六向旋转对称出生布局，共 20 轮：第 1–4 轮争夺内圈补给点，第 5–12 轮利用额外收入扩军、外圈与内圈据点依次被炮火覆盖，第 13 轮起安全区收缩至最终半径 1、在内圈核心决胜，第 20 轮仍未分胜负则按裁决分收尾。炮火在第 4 轮预告、第 5 轮首次收缩，此后每两轮收缩一层，至第 13 轮到达最终安全半径 1。

未列在 `terrainCells` 的可用格默认为 `plain`。地图编辑器支持添加和移除地块，并可维护 2–8 个出生槽及对应人数布局；移除包含对象的格子会被阻止，避免隐式丢失配置。

每个据点必须写 `kind`：`supply`（补给站）、`forward_base`（前线基地）、`repair`（维修站）——不存在无类型的「普通据点」。`balance.controlPointTypes` 必须完整配置三种类型的 `income`、`deployDiscount`、`repairAmount`（含地图未用到的类型）。裁决分始终按据点数量计算，不按据点类型加权。

## AI 自动对战

项目支持四类 AI 玩家：

### 1. LLM AI（通过提示词）

```bash
npm run dev
node skill/ai-player.mjs --side a --name "AI A"
node skill/ai-player.mjs --side b --game <gameId> --name "AI B"
node skill/ai-player.mjs --side player_c --game <gameId> --token <playerToken>
```

AI 默认会持续轮询并自动处理后续己方回合，直到游戏结束、达到 `--max-turns`，或命令被停止。只有明确想让它只行动一个己方回合时才使用 `--once`。

常用参数：

| 参数 | 说明 |
|---|---|
| `--url <url>` | API 地址，默认 `http://localhost:3100` |
| `--side <a-h|player_a-player_h>` | 选择玩家席位 |
| `--game <gameId>` | 加入或重连已有对局 |
| `--token <token>` | 用已有 token 重连指定席位 |
| `--map <mapId>` | 创建对局时选择地图，默认 `default` |
| `--max-turns <n>` | 最多处理多少个己方回合，默认 `80` |
| `--once` | 只处理当前或下一个己方回合 |

AI 在标准模式中的策略优先级：击毁总部、击杀低血单位、治疗友军、战略部署、抢占据点/推进总部。第 8 回合后或拥有 3 个据点时优先转入总部压力；第 12 回合后按裁决分优化行动。歼灭模式改为优先脱离炮火预警/危险区并向最近敌军推进，不再寻找总部或以占点裁决为主目标。行动失败时会记录 API 错误并尝试下一个候选动作，不会在同一个非法动作上紧密重试。

### 2. 强化学习 AI

服务器会自动扫描 `rl/models/` 目录下的 `.zip` 模型文件。在玩家控制台创建对局时，房主可通过"添加 AI"对话框选择强化模型，服务器会在开局时自动启动对应的 Python 运行器。

强化学习 AI 基于 Stable-Baselines3 PPO 算法训练，支持多个版本的动作空间和观测空间。模型文件名应包含版本号（如 `v3.0.0`），服务器会自动选择匹配的运行器。

训练和评估：

```bash
# 训练新模型
python rl/train.py --episodes 10000

# 评估模型
python rl/evaluate.py --model rl/models/model.zip
```

### 3. 算法 AI

纯规则/搜索算法编写的 JavaScript AI，无需训练模型。房主在"添加 AI"对话框的"算法脚本"标签中选择算法类型，服务器会自动启动 Node.js 运行器。

**算法按对局模式注册，不同模式不能混用**：每个算法在注册表（`algorithms/registry.mjs` 的 `ALGORITHM_META.modes`）声明支持的模式，大厅添加、命令行运行器与竞技场评估都会按此校验；前端"算法类型"下拉只列出当前对局模式可用的算法。

当前内置算法（未标注者为标准模式）。每条只写定位，实测战绩与评分以 `/arena.html` 榜单为准，实现细节见各自档案：

- **贪心算法（Greedy）**：按固定优先级选择动作——可击杀目标 > 治疗受伤友军 > 爆破障碍 > 战略部署 > 向目标移动。[档案](algorithms/docs/algorithms/greedy.md)
- **随机算法（Random）**：从所有合法动作中均匀随机选择。[档案](algorithms/docs/algorithms/random.md)
- **蒙特卡洛树搜索（MCTS）**：UCB1 选择 + 定次模拟推演的通用搜索，移动采样偏向 `movementGoal`，支持据点占领与入口部署。[档案](algorithms/docs/algorithms/mcts.md)
- **威胁感知算法（Threat）**：效用 AI + 威胁影响图，把攻击/治疗/移动/部署/爆破换算到同一效用尺度逐步选最优，无需搜索或模拟。[档案](algorithms/docs/algorithms/threat.md)
- **势场算法（Field）**：人工势场——斥力井 + 引力井 + 波前距离场塑形走位，无需搜索。[档案](algorithms/docs/algorithms/field.md)
- **裁决线算法（Verdict）**：反向规划——先从终局倒推「哪条线能赢、还差几回合」，再让全军向该线的期限收束。[档案](algorithms/docs/algorithms/verdict.md)
- **同时随机算法（Random-Sim，仅同时回合模式）**：从合法计划动作中随机入队，支持同单位跨行动点连续行动，作为对照基线与模式隔离冒烟。[档案](algorithms/docs/algorithms/random-sim.md)
- **落点概率算法（Destination Probability，仅同时回合模式）**：为敌军建立落点概率分布做预测射击，并把目的格冲突计入移动/部署成功率。[档案](algorithms/docs/algorithms/dest-prob.md)
- **兵棋推演算法（Kriegspiel，仅同时回合模式）**：在镜像分步结算器上做整份计划的蒙特卡洛 rollout，按「均值 − λ·标准差」选择并邻域爬山精修。[档案](algorithms/docs/algorithms/kriegspiel.md)
- **矩阵均衡算法（Matrix Equilibrium，仅同时回合模式）**：把每轮升维成计划组合的矩阵博弈，用 CFR 自我对弈求均衡混合策略并抽样输出。[档案](algorithms/docs/algorithms/matrix-eq.md)
- **棱镜算法（Prism，仅同时回合模式）**：整轮联合队列搜索 + 分步结算镜像 + 风险约束终局评分，对多种对手行为假设做稳健选择。[档案](algorithms/docs/algorithms/prism.md)
- **时序掌控算法（Tempo，仅同时回合模式）**：把队列位置当作结算拍，预测敌方剧本、构建威胁时间线，再按裁决权重把动作排进具体拍。[档案](algorithms/docs/algorithms/tempo.md)
- **经纬算法（Tempo-Weave，仅同时回合模式）**：以「单位完成什么任务、几个行动点、能否存活」为决策单位，在共享行动点预算内按收益/成本竞价排程。[档案](algorithms/docs/algorithms/tempo-weave.md)
- **视界算法（Horizon，仅同时回合模式）**：把一轮结算后的棋盘投影到终局估胜率，用同构对手场景与对抗探针检验计划，再做逐行动点束搜索。[档案](algorithms/docs/algorithms/horizon.md)

添加算法 AI 时可自定义玩家名，默认预填所选算法的中文名。

手动运行算法 AI：

```bash
# 启动服务器
npm run dev

# 在浏览器中创建游戏（模式需与算法匹配），获取 gameId 和 playerToken

# 运行贪心算法（标准模式）
node algorithms/runner.mjs \
  --algorithm greedy \
  --url http://localhost:3100 \
  --game <gameId> \
  --token <playerToken> \
  --side player_a

# 运行同时随机算法（同时回合模式地图，如 standoff / molten-throne）
node algorithms/runner.mjs \
  --algorithm random-sim \
  --url http://localhost:3100 \
  --game <gameId> \
  --token <playerToken> \
  --side player_b
```

可用参数：

| 参数 | 说明 |
|---|---|
| `--algorithm <name>` | 算法名称（greedy, random, mcts, threat, field, verdict, random-sim, dest-prob, kriegspiel, matrix-eq, prism, tempo, tempo-weave） |
| `--url <url>` | API 地址，默认 `http://localhost:3100` |
| `--game <id>` | 游戏 ID |
| `--token <token>` | 玩家 token |
| `--side <id>` | 玩家席位 ID（player_a, player_b, ...） |
| `--poll-seconds <n>` | 轮询间隔秒数，默认 0.5 |
| `--max-turns <n>` | 最多处理多少个己方回合，默认 120 |
| `--once` | 只处理一个回合后退出 |
| `--quiet` | 减少日志输出 |

算法开发指南见 `algorithms/builtin/README.md`。该目录包含完整的算法接口文档、游戏工具函数和开发示例。

强度标定与合法性回归用 `scripts/algorithm-arena.mjs`（headless 自博弈，直接驱动引擎，不经 HTTP）：

```bash
npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --games 40 --map default
npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --games 12 --map multiplayer-ring --players 4
npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --map random --games 20 --strict   # 有非法动作即退出码 1
```

### 4. 外部 LLM（通过提示词）

房主可在"添加 AI"对话框的"对战提示词"标签生成并复制提示词，发送给外部 AI（如 Claude、GPT-4）。提示词包含服务器地址、对局 ID、地图信息和 API 调用指令，AI 会自己调用 `/join` 加入对局并开始游戏。

局后总结经验（复盘）同理：提示词让 AI 拉取 `GET http://<服务器>:3123/api/skill/files/review.md` 并按它执行即可，无需本地文件。复盘规范与玩法 skill 同源下发（`skill/review.md` 入口按模式路由到 `review-standard.md` / `review-annihilation.md` / `review-simultaneous.md` / `review-royale.md`），AI 读房主提供的回放写复盘 MD 到 `records/V3/`；**回放 JSON 由房主在观战页导出归档**（默认名 `tg_0_{日期}.json`，归档时把占位 `0` 改成真实顺序号），不由 AI 生成——同局多个 AI 各写一份复盘时互不冲突。文件名中的对局顺序号在提示词里给出（如"对局顺序号 199"→ `tg_0199_…`）。

## 回放与记录

- 观战页可以从在线对局导出回放 JSON 或离线 HTML。
- 导出的 JSON 可在观战页重新导入并按事件流回放。
- 历史对战记录放在 `records/V1`、`records/V2` 和 `records/V3`；V2/V3 记录包含 `schemaVersion`，便于后续回放兼容。历史回放的 `schemaVersion` 表示导出时的回放格式，不随应用版本批量改写。
- 对局 agent 的复盘规范也经 `/api/skill/files/:name` 下发（`review.md` + 各模式文件），保证远程 agent 与本地玩家遵循同一套复盘格式。

## 测试

```bash
npm run build
npm test
```
