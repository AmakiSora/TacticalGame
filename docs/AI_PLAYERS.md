# AI 自动对战

项目支持四类 AI 玩家：提示词驱动的 LLM AI、强化学习模型、内置算法与外部 LLM 提示词。

## 1. LLM AI（通过提示词）

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
| `--side <a-h\|player_a-player_h>` | 选择玩家席位 |
| `--game <gameId>` | 加入或重连已有对局 |
| `--token <token>` | 用已有 token 重连指定席位 |
| `--map <mapId>` | 创建对局时选择地图，默认 `default` |
| `--max-turns <n>` | 最多处理多少个己方回合，默认 `80` |
| `--once` | 只处理当前或下一个己方回合 |

AI 的决策顺序遵循对应模式 skill 的 Decision order（[standard](../skill/standard.md) / [annihilation](../skill/annihilation.md) / [simultaneous](../skill/simultaneous.md) / [royale](../skill/royale.md)），本文不复写。行动失败时会记录 API 错误并尝试下一个候选动作，不会在同一个非法动作上紧密重试。

## 2. 强化学习 AI

服务器会自动扫描 `rl/models/` 目录下的 `.zip` 模型文件。在玩家控制台创建对局时，房主可通过「添加 AI」对话框选择强化模型，服务器会在开局时自动启动对应的 Python 运行器。

强化学习 AI 基于 Stable-Baselines3 PPO 算法训练，支持多个版本的动作空间和观测空间。模型文件名应包含版本号（如 `v3.0.0`），服务器会自动选择匹配的运行器。

训练和评估：

```bash
# 训练新模型
python rl/train.py --episodes 10000

# 评估模型
python rl/evaluate.py --model rl/models/model.zip
```

模型与训练细节见 [rl/README.md](../rl/README.md)。

## 3. 算法 AI

纯规则/搜索算法编写的 JavaScript AI，无需训练模型。房主在「添加 AI」对话框的「算法脚本」标签中选择算法类型，服务器会自动启动 Node.js 运行器。

**算法按对局模式注册，不同模式不能混用**：每个算法在注册表（`algorithms/registry.mjs` 的 `ALGORITHM_META.modes`）声明支持的模式，大厅添加、命令行运行器与竞技场评估都会按此校验；前端「算法类型」下拉只列出当前对局模式可用的算法。

当前内置算法（未标注者为标准模式）。每条只写定位，实测战绩与评分以 `/arena.html` 榜单为准，实现细节见各自档案：

- **贪心算法（Greedy）**：按固定优先级选择动作——可击杀目标 > 治疗受伤友军 > 爆破障碍 > 战略部署 > 向目标移动。[档案](../algorithms/docs/algorithms/greedy.md)
- **随机算法（Random，仅标准模式）**：从所有合法动作中均匀随机选择。[档案](../algorithms/docs/algorithms/random.md)
- **歼灭随机算法（Random Annihilation，仅歼灭模式）**：同一轮流枚举，并按引擎口径跳过炮火危险区内的部署与治疗；走进危险区仍合法。[档案](../algorithms/docs/algorithms/random-annihilation.md)
- **缩圈推演算法（Shrink Roll，仅歼灭模式）**：回合内束搜索，按缩圈时间线推演安全区并投影轮界裁决，多人局压制领先者。[档案](../algorithms/docs/algorithms/shrinkroll.md)
- **旋涡算法（Vortex，仅歼灭模式）**：炮火收缩圈预判疏散、威胁图稳杀集火、走位风筝与激进补员。[档案](../algorithms/docs/algorithms/vortex.md) · [设计与评估](../algorithms/docs/ALGORITHMS_NOTES.md#vortex旋涡算法)
- **熔炉算法（Crucible，仅歼灭模式）**：整回合束搜索、对抗集火回推与缩圈时间线逃逸推演。[档案](../algorithms/docs/algorithms/crucible.md)
- **统御算法（Sovereign，仅歼灭模式）**：概率齐射竞价、多轮炮火逃逸、协同让行与移动爆破，按本局配置权衡兵力和部署窗口。[档案](../algorithms/docs/algorithms/sovereign.md)
- **大逃杀随机算法（Random Royale，仅大逃杀模式）**：从合法计划动作中随机入队（枚举与 random-sim 同源），随后提交。[档案](../algorithms/docs/algorithms/random-royale.md)
- **雁阵算法（Echelon，仅大逃杀模式）**：逐拍效用决策——敌军落点扩散预报、精确击杀概率与集火、炮火圈生存调度、爆破距离场开路（重装拆墙进入被隔断的安全区）。[档案](../algorithms/docs/algorithms/echelon.md) · [设计与评估](../algorithms/docs/ALGORITHMS_NOTES.md#echelon雁阵算法)
- **绝境算法（Apex，仅大逃杀模式）**：缩圈时空寻路、兵力配比、多情境同步束搜索与对抗校验。[档案](../algorithms/docs/algorithms/apex.md)
- **蒙特卡洛树搜索（MCTS）**：UCB1 选择 + 定次模拟推演的通用搜索，移动采样偏向 `movementGoal`，支持据点占领与入口部署。[档案](../algorithms/docs/algorithms/mcts.md)
- **威胁感知算法（Threat）**：效用 AI + 威胁影响图，把攻击/治疗/移动/部署/爆破换算到同一效用尺度逐步选最优，无需搜索或模拟。[档案](../algorithms/docs/algorithms/threat.md)
- **势场算法（Field）**：人工势场——斥力井 + 引力井 + 波前距离场塑形走位，无需搜索。[档案](../algorithms/docs/algorithms/field.md)
- **裁决线算法（Verdict）**：反向规划——先从终局倒推「哪条线能赢、还差几回合」，再让全军向该线的期限收束。[档案](../algorithms/docs/algorithms/verdict.md)
- **同时随机算法（Random-Sim，仅同时回合模式）**：从合法计划动作中随机入队，支持同单位跨行动点连续行动，作为对照基线与模式隔离冒烟。[档案](../algorithms/docs/algorithms/random-sim.md)
- **落点概率算法（Destination Probability，仅同时回合模式）**：为敌军建立落点概率分布做预测射击，并把目的格冲突计入移动/部署成功率。[档案](../algorithms/docs/algorithms/dest-prob.md)
- **兵棋推演算法（Kriegspiel，仅同时回合模式）**：在镜像分步结算器上做整份计划的蒙特卡洛 rollout，按「均值 − λ·标准差」选择并邻域爬山精修。[档案](../algorithms/docs/algorithms/kriegspiel.md)
- **矩阵均衡算法（Matrix Equilibrium，仅同时回合模式）**：把每轮升维成计划组合的矩阵博弈，用 CFR 自我对弈求均衡混合策略并抽样输出。[档案](../algorithms/docs/algorithms/matrix-eq.md)
- **棱镜算法（Prism，仅同时回合模式）**：整轮联合队列搜索 + 分步结算镜像 + 风险约束终局评分，对多种对手行为假设做稳健选择。[档案](../algorithms/docs/algorithms/prism.md)
- **时序掌控算法（Tempo，仅同时回合模式）**：把队列位置当作结算拍，预测敌方剧本、构建威胁时间线，再按裁决权重把动作排进具体拍。[档案](../algorithms/docs/algorithms/tempo.md)
- **经纬算法（Tempo-Weave，仅同时回合模式）**：以「单位完成什么任务、几个行动点、能否存活」为决策单位，在共享行动点预算内按收益/成本竞价排程。[档案](../algorithms/docs/algorithms/tempo-weave.md)
- **视界算法（Horizon，仅同时回合模式）**：把一轮结算后的棋盘投影到终局估胜率，用同构对手场景与对抗探针检验计划，再做逐行动点束搜索。[档案](../algorithms/docs/algorithms/horizon.md)

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
| `--algorithm <name>` | 算法名称（greedy, random, random-annihilation, shrinkroll, vortex, crucible, sovereign, random-royale, echelon, apex, mcts, threat, field, verdict, random-sim, dest-prob, kriegspiel, matrix-eq, prism, tempo, tempo-weave, horizon） |
| `--url <url>` | API 地址，默认 `http://localhost:3100` |
| `--game <id>` | 游戏 ID |
| `--token <token>` | 玩家 token |
| `--side <id>` | 玩家席位 ID（player_a, player_b, ...） |
| `--poll-seconds <n>` | 轮询间隔秒数，默认 0.5 |
| `--max-turns <n>` | 最多处理多少个己方回合，默认 120 |
| `--once` | 只处理一个回合后退出 |
| `--quiet` | 减少日志输出 |

算法开发指南见 [`algorithms/builtin/README.md`](../algorithms/builtin/README.md)，其中包含完整的算法接口文档、游戏工具函数和开发示例。

强度标定与合法性回归用 [`scripts/algorithm-arena.mjs`](../scripts/algorithm-arena.mjs)（headless 自博弈，直接驱动引擎，不经 HTTP）：

```bash
npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --games 40 --map default
npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --games 12 --map multiplayer-ring --players 4
npx tsx scripts/algorithm-arena.mjs --a threat --b greedy --map random --games 20 --strict   # 有非法动作即退出码 1
```

## 4. 外部 LLM（通过提示词）

房主可在「添加 AI」对话框的「对战提示词」标签生成并复制提示词，发送给外部 AI（如 Claude、GPT-4）。提示词包含服务器地址、对局 ID、地图信息和 API 调用指令，AI 会自己调用 `/join` 加入对局并开始游戏。

局后总结走同一套 skill：让 AI 拉取 `GET http://<服务器>:3123/api/skill/files/review.md` 并按它执行即可，无需本地文件。复盘规范与玩法 skill 同源下发（`skill/review.md` 入口按模式路由到 `review-standard.md` / `review-annihilation.md` / `review-simultaneous.md` / `review-royale.md`），AI 读房主提供的回放写复盘 MD 到 `records/V3/`；**回放 JSON 由房主在观战页导出归档**（默认名 `tg_0_{日期}.json`，归档时把占位 `0` 改成真实顺序号），不由 AI 生成——同局多个 AI 各写一份复盘时互不冲突。文件名中的对局顺序号在提示词里给出（如「对局顺序号 199」→ `tg_0199_…`）。
