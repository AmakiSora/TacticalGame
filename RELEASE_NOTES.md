# TacticalGame 版本说明

本文档按版本倒序整理主要改动。仓库当前没有 git tag，因此版本边界以 `release/*` 分支或明确的版本基线提交为准。

自 3.0.0 起按 [docs/RELEASE_NOTES_SPEC.md](docs/RELEASE_NOTES_SPEC.md) 编写：每个版本小节内按 **新增 / 变更 / 修复 / 移除 / 测试与验证** 分类，分类与语义化版本号（SemVer 2.0.0）递增的对应关系见规范文件。3.0.0 之前的小节保持原始格式；3.x 各版本号沿用发布时的实际编号，为保持既有引用不回改。

## 3.5.6

### 新增

- **经验复盘规范 skill 化，局后总结不再依赖本地文件**：此前局后总结提示词引用仓库本地的 `records/tactical-game总结经验规范-*.md`，agent 换个工作区（远程/沙箱）就读不到；现在三份模式复盘规范迁入 `skill/`（原路径不再保留副本），新增入口 `skill/review.md`，与玩法 skill 同源经 `/api/skill/files/:name` 下发、`/api/skill/manifest` 自动收录。
  - **模式路由**：入口按回放里 `game_start` 事件的 mode 拉取唯一一份模式文件；三份模式文件只保留写作内容（规范版本 3.1），原「V3 文件命名」小节改为指向入口，避免多份拷贝漂移。
  - **回放由房主提供，agent 只读不写**：回放 JSON 统一由房主从前端观战页导出归档（默认名 `tg_0_{日期}.json`，归档时把占位 `0` 改成真实顺序号），agent 绝不自行组装、下载或覆盖——同局多个 AI 都要写复盘时，争写同一份回放会互相冲突。
  - **产物与命名**：复盘 MD 是 agent 唯一交付物，双人局 `tg_{顺序号4位}_{win|lose|draw}_{AGENT}@{模型短名}.md`、多人局 `tg_{顺序号4位}_rank{NN}_{AGENT}@{模型短名}.md`（按 `game_over.payload.rankings` 判名次）。
  - **顺序号来自提示词**：文件名中的 4 位顺序号由用户给出（如"对局顺序号 199"→ `tg_0199_…`）。
  - **产物位置**：写入 `records/V3/`（用户指定目录优先），明确豁免 Scratch files 的 `temp/` 暂存规则。
  - **入口引导**：`skill/SKILL.md` 新增 "Post-game review (复盘)" 一节；局后提示词只需一句——拉取 `${BASE_URL}/api/skill/files/review.md` 按它执行，对局顺序号 N。

### 测试与验证

- `tests/api/skill.test.ts` 的 manifest 清单补入 `review.md` 与三份模式文件，断言其经 `/api/skill/manifest` 暴露且 `sha256`/`bytes` 与磁盘一致。

## 3.5.5

### 新增

- **无限回合地图（`balance.maxTurns: null`）成为一等公民**：此前「打到一方全灭为止」只能把 `maxTurns` 设成极大值来近似，代价是带上假的终局裁定预期、误导内置 bot 的终局启发式、并与 skill 规范不一致。现在 `null` 是无上限的唯一哨兵：`src/engine/engine.ts` 的 `adjudicateAtTurnLimit()` 在 `maxTurns === null` 时直接返回 false，回合边界永不裁定——standard / annihilation / simultaneous 三模式共用这一个函数（`simultaneous.ts` 的回合边界走同一条路径），一处修复覆盖三模式。**不新增 `GameOverReason`**：无上限对局只靠淘汰（`last_player_standing`、总部/军力被毁）或房主 `POST /api/games/:id/force-adjudicate`（`forced_adjudication_score|draw`）收尾，无上限图上 `turn_limit_score|turn_limit_draw` 自此不再出现。校验侧 `src/config/loader.ts` 为 `maxTurns` 单开分支：`null` 放行、缺字段仍报 `balance.maxTurns is required`（必填语义不变）、`0` / `-3` / `NaN` / `Infinity` / 字符串照旧拒绝，`assertNumber` 本身不放宽（否则会连带放行其他 balance 键的 Infinity/NaN）。类型三处 widening 成 `number | null`（`MapConfig.balance.maxTurns`、`MapPreview.maxTurns`、`src/types.ts` 的 `AdjudicationSnapshot.maxTurns`），`GET /api/games/:id` 原样序列化给客户端。新演示地图 **`maps/whirlpool.json`（星海漩涡）**（规格见下方专条）。追赶补给不受影响：裁定在 `grantComebackSupplies` 之前，null 提前返回不改变该顺序，无上限图每轮照发。
- **新演示地图 `maps/whirlpool.json`（星海漩涡）**：standard、半径 8、217 格六旋臂异形布局（`playableCells` 显式声明，离总部越远土地越肥沃的扩张压力图），12 个类型化据点（6 `forward_base` + 6 `supply`），经济 60/7/8（初始补给/基础收入/据点收入）、每回合 4 行动点、6 出生位各 4 单位（步兵×2 + 侦察 + 重装）、总部 200 血防 5；总部紧贴涡心且 `balance.deployFromHq: false`，开局没有总部部署口，夺下据点才能增兵；`balance.maxTurns: null` 无回合上限，只能打到全灭或房主强制裁决。裁决权重 5/0.6/50/0.5/0/4（有效行动 4，`supplies` 为 0）。首页「代表地图」与 README 内置地图清单同步收录。
- **前端 `∞` 显示**：四个客户端（`public/app.js` / `play.js` / `play-m.js` / `spectator-m.js`，源码文本测试要求各自持有一份实现，不可合并）的 `maxTurnsLabel()` 显示 `∞ 无上限`、`turnProgressLabel()` 显示 `16/∞`；`=== null` 分支必须排在 `Number.isFinite` 守卫之前，否则无上限局与「配置未加载」同形。地图大厅卡片（`play.js` / `play-m.js`）在 `preview?.maxTurns === null` 时渲染 `⏱ ∞`，取代此前 `?? '-'` 把无上限显示成数据损坏的读法。
- **地图编辑器可编辑无上限图**：`public/map-editor.js` 新增「无回合上限」复选框（`unlimited-turns-enabled`，沿用「启用追赶补给」的 `toggle-field` + draft 先例）——勾选把 `config.balance.maxTurns` 置 `null` 并把数值框禁用清空，取消勾选还原草稿值。`normalizeImportedMap` / `serializeMapConfig` / `validateMapConfig` 三处的 null 特判缺一不可：否则导入一张无上限图会被 `numberOrDefault(null, 15)` 静默改成 15、导出被 `Number(raw ?? 0)` 静默改成 0——`public/**` 无类型检查、无运行时报错，唯一表现就是用户的地图被悄悄改掉。
- **地图级开关 `balance.deployFromHq` 控制总部能否作为部署起点**：此前 standard / simultaneous 的部署起点恒为「己方总部或己方据点」，想在某张图上强制「夺据点才有兵」只能靠改引擎。现在地图可在 `balance` 里设 `deployFromHq: false` 禁止从总部部署（**缺省/true 允许**，除本版新图 `whirlpool` 之外的 10 张内置地图与随机图行为不变；annihilation 本就无总部、只认据点，不受影响）。判定收敛为 `src/engine/validation.ts` 的 `deployOriginFor()`：原 `deployment.ts`（standard 逐行动）与 `planning.ts`（simultaneous 计划期）各有一份逐字相同的私有 `deployOrigin`，现已删除并以共用版替换——simultaneous 结算器不在结算期复查起点，计划期拦下即覆盖全部路径。校验侧 `src/config/loader.ts` 拒绝非布尔值（`0` / `'false'` / `null` 均 `balance.deployFromHq must be boolean`），`GET /api/games/:id` 随完整 config 原样下发。前端 `play.js` / `play-m.js`：开关关闭时点击己方总部不再弹部署菜单（落到普通选中信息），总部卡片备注从「部署源」改为「本图总部不可部署」；`public/map-editor.js` 非歼灭模式新增「总部可部署」复选框（`hq-deploy-enabled`）——勾选删键保持 JSON 干净（缺省即允许），取消勾选才落 `false`，`normalizeImportedMap` / `serializeMapConfig` / `validateMapConfig` 三处同步（教训同上一条 maxTurns：少一处导入导出就会悄悄吞字段）。内置算法共用入口 `algorithms/lib/game-utils.mjs` 的 `deployOrigins()` 同步过滤总部，六个内置算法（threat / greedy / field / verdict / mcts / random）经它或 `deployDecision()` 全部遵守开关，不会再在禁部署图上浪费动作试探总部起点。skill 规范同步：`skill/standard.md` 的 Deploy origins 与部署决策项、`skill/simultaneous.md` 的入队清单注明 `config.balance.deployFromHq` 语义（禁用图上 HQ 起点被 `invalid_deploy` 拒绝），README 部署规则一条补说明。**注意 rl/ 动作空间未跟随**：RL 环境的部署点语义不含此开关，禁部署图上 RL 模型选择总部部署会被引擎原样拒绝（起点判定先于行动点扣除 / 入队，不消耗 AP，仅浪费一次决策步），后续把此类图纳入训练前需先在 `rl/envs/env.py` 读取该配置。

- **RL 从零训练前置（v4.0.0 世代）——算法教师蒸馏通道**：`rl/training/distill.py` 新增 `collect-algo` 子命令，用 `threat` / `greedy` / `field` 三个内置算法经 `decide` 通道当教师采集样本，**不加载任何历史模型**，从零世代因此有了不依赖旧权重的冷启动数据源。算法输出的是引擎动作对象而非动作索引，故新增 `_algo_action_index` 三级匹配把它映射回当前 155 动作表：精确匹配 → 同单位/同兵种的最近落点 → `None` 回退（丢弃该样本）；4 局冒烟 fallback 率 **2.32%**。
- **`RL_NO_AUTO_ANCHOR=1`（`rl/training/train.py`）**：从零世代不再被 `champion_model_path()` 悄悄塞进 v2.7/v2.8 历史锚点——自动锚点在续训世代是便利，在「证明新配方能从零学会」的世代则是污染源。
- **随机域联合边角采样 `RL_RANDOM_CORNER_BOOST`（`rl/envs/env.py`，JSON 形如 `{"p":0.18}`）**：连续两代 `forge` 0:48 的根因不是边缘分布太窄，而是**各维边缘已拓宽但联合命中率 << 1%**——`forge` 的生态位是「短局 × 低 HQ × 多据点 × 满编开局」四件事同时发生。现在按 `p` 对随机域内部的这组联合边角做重要性采样，配套在 `src/config/randomMap.ts` 新增 `startingUnitCount` 随机参数（`DEFAULT_RANGES` 为 `[0, 4]`）以支持固定满编开局。2×128 架构冒烟 1.44M 参数、单环境 68fps。
- **v4.1.0 训练设施开关**（均在 `rl/training/train.py`）：`PYTORCH_ALLOW_TF32=1`（cuda/rocm 通用，update 阶段本地实测 **+18%**）、`RL_TORCH_COMPILE=1`（`reduce-overhead` / cuda graph；启用前做两次探测前向，triton 缺失等环境下回退 eager 而**不终止训练**，Windows 原生 torch 无 triton 故该项只在 linux 有意义）；`RL_RESOURCE_MONITOR=1`（缺省关闭，以保证在途 v4.0.0 恢复后日志逐字节一致）按 `RL_EXPLORE_LOG_EVERY` 帧把 `resource` / `gpu_mem_gb` / `sys_mem_pct` 写 tb + stdout。`rl/training/eval_worker.py` 的 `evaluate()` 补 `torch.set_num_threads(1)`——训练 worker 早已单线程化而评估侧漏了，8 核服务器上评估进程曾吃掉 5.3 核、把 rollout 从 165fps 压到 46fps。
- **算法场景可进 best 选择键 `RL_EVAL_ALGO_IN_SELECTION`**：`rl/training/eval_worker.py` 的 `build_scenarios` 新增 `algo_in_selection` 参数（命令行 `--algo-in-selection`）决定算法场景是否计入 `_selection`，`rl/training/train.py` 透传并在启动日志显式打印；默认 `False` 保持「只记录、不参与选择」的历史行为。开启门槛是**对算法胜率已稳定过 40%**（v4.0.0 S2 交付点实测 threat 41% / greedy 49% / field 59%），在此之前开启会让选择键被「对模型强、对算法弱」的早期断点主导。
- **v4.0.0 结项文档**：新增 `rl/docs/plans/v4.0.0_conclusion.md`（结项结论）与 `rl/docs/models/v4.0.0.md`（单模型档案，含 A/B/C 三类踩坑清单）；`rl/docs/MODELS_NOTES.md` 的状态总表、版本演进表、交付断点表各加行，「共同限制与后续方向」补 5 条跨代教训。

### 变更

- **内置 bot 不再把 `null` 读成「15 回合封顶」**：`algorithms/builtin/{threat,field,verdict}.mjs` 的三处 `balance.maxTurns ?? 15` 改为 `=== null ? Infinity : (… ?? 15)`。原写法在无上限图上从第 13 回合起就挂上假的终局紧迫加成（`LATE_GAME_UTILITY` / `LATE_GAME_BONUS` 各 +80）并按 15 回合计价据点收入，恰好是无限局里最错的打法。`Infinity` 由下游既有的截断兜住（`Math.min(turnsLeft, CP_INCOME_TURNS_CAP / CP_INCOME_CAP)`、`Math.min(MAX_SIEGE_ROUNDS = 40, …)`），晚期加成条件 `turnNo >= Infinity - 2` 恒 false；已在源码就地标注，同文件今后若新增第 5 处裸用需注意。`greedy` / `mcts` / `random` 无 `maxTurns` 引用，不受影响。
- **skill 规范措辞更新（`/api/skill/files/*` 原样下发，即 agent 契约）**：`skill/SKILL.md` 的终局条件补「无上限地图回合永不耗尽，只有淘汰或房主 `POST /api/games/:id/force-adjudicate` 结束」、`maxTurns === null` 时自动裁定永不触发（须盯住实时 `adjudication` 并准备强制收尾），并把「Near max round」小节限定为「有限图」；`skill/annihilation.md` 注明收缩圈按 roundNumber 自饱和、与 `maxTurns` 无关，因此无上限不可与歼灭图叠加（现有歼灭图全为有限）；`skill/simultaneous.md` 注明无上限图的 `round_resolved.gameOver` 在淘汰前恒为 `false`；`algorithms/docs/algorithms/threat.md` 同步 `maxTurns − 2` 加成在 `null` 下不触发。
- **持久化按局兜底，明确不升 `PERSISTENCE_SCHEMA_VERSION`**：`loadFromDisk` 从不重跑地图校验，因此对每局做逐局收敛——`null` 原样保留，非法值（缺字段 / `0` / `"15"` / `NaN` / `Infinity`）回落有限默认 15 并打 `game:persist` warn 日志（带 gameId 与原值），回落静默会让「长局为何在第 15 回合被裁定」无从排查。缺了这层，手改或降级档案里的非法 `maxTurns` 会让 `roundNumber < undefined` 恒 false，在下一个回合边界把线上对局误判结束。不升 schema 版本是刻意的：版本不匹配触发 archive-and-clear，会把 `runtime/games.json` 约 200 局、34 MB 的线上状态整体清空。**运维注意：本版本不可直接回滚**——旧二进制读到 `maxTurns: null` 会在第 1 回合误裁定，回滚前需先清理存档中的无上限对局。

- **交付模型命名由四段式改三段式**（`refactor(rl)!`）：`hex_ppo_<版本>_<日期>_<地图>_<对手>_<步数>.zip` → **`hex_ppo_<版本>_<日期>_<步数>.zip`**，步数段直接写**交付断点**（`70K` / `8.8M`，与榜单 `shortName` 同一公式），于是「文件名 / 展示名 / zip 内 `num_timesteps`」三者恒等，`MODEL_DELIVERED_STEPS` 镜像表退休；训练地图与对手改由 `MODEL_META_BY_VERSION` 按版本查表，UI 展示不变。解析侧新增 `parseStepTag`，`parseModelFile` 的地图/对手改查表。**影响面**：`rl/models/` 20 个交付 zip + `deprecated/` 5 个作废 zip 全部重命名；`arena/matches.jsonl` 48,648 局历史玩家名批量改写（Bradley-Terry 评分逐版本比对 **24/24 零变化**）；8 个 runner 的 glob 同步（`run_model_v100.py` 原先依赖的 `*random_opponent*` 在改名前就已完全失效，一并修好）；`rl/training/train.py` 的 `latest_model_path` / `opponent_model_path` / `champion_model_path` 后两者改按版本匹配；`arena/model-status.json` 三个过期模型的 `file` 字段；测试里的模型名常量与一处 short 断言（`v2.2.0` → `v2.2.0@120K`，旧 `_best` 后缀停用）。**不改观测/动作/奖励语义，`bots.ts` 路由不变**，但模型文件名是 `POST /api/games/:id/bots/rl` 的 `model` 取值（经 `GET /api/rl/models` 发现），**硬编码旧文件名的调用方需一并更新**；本地 `rl/models/` 与代码/脚本必须同批升级，混用会表现为「模型未发现」。
- **v4.0.0 中间产物归档**：`hex_ppo_v4.0.0_s1_6000000.zip`（S1 交付，内部 5.7M）与 `hex_ppo_v4.0.0_distilled.zip`（蒸馏冷启动断点）移入 `rl/models/_archive_v4.0.0/`（与 `_archive_v3.2.0` 同构，未删除），顶层只留候选件 `hex_ppo_v4.0.0_s2_14000000.zip`（内部 11.4M）。这两个归档件文件名缺日期段，榜单 `collectRegistry` 按旧格式排除（收录 0 条），符合「未过验收不参评」定位；日后若要参评需改名补日期段。

### 修复

- **Docker 镜像缺 `script/modelStatus.mjs`，容器启动即 `ERR_MODULE_NOT_FOUND`**：`src/api/bots.ts` 对它是**静态 import**（过期模型名单唯一来源），`tsc` 又因仓库无 `allowJs` 需要 `script/modelStatus.d.mts`，而两阶段镜像的 COPY 清单都没带上——3.5.4 引入该 import 时漏改 Dockerfile，此后构建出的镜像 `npm start` 直接起不来（构建期 `npm run build` 与 CI 的 `docker build` 都发现不了）。构建期补 COPY `.mjs` + `.d.mts`，运行期补 COPY `script/modelStatus.mjs`（`dist/api/bots.js` 里保留的是相对路径 `../../script/modelStatus.mjs`）与 `arena/model-status.json`：该模块按自身位置回推项目根读登记表，而镜像缺登记表时 `bots.ts` 按「无过期」降级，会让 v2.3.2 / v2.6.0 / v2.5.0 三个过期模型重新出现在线上「添加 AI」列表（它们的 zip 随 `COPY rl` 进镜像）。
- **评估控制台在未携带跑批链路的部署上只报一句读不懂的 500**：`/api/arena/eval/start` 与 `/api/arena/leaderboard/regenerate` 会 spawn `rl/evaluation/round_robin.py` 与 `script/generateArenaLeaderboard.mjs` / `generateArenaStats.mjs`，后两者按设计不进镜像（评估跑批是本地开发功能），线上点按钮得到的是 spawn ENOENT 冒成的 500。现在两个写接口在链路缺件时返回 **501 `arena_eval_unavailable`** 并说明原因，只读的 `/api/arena/participants` 不受影响（镜像里仍可列模型与算法）。
- **构建上下文瘦身**：`.dockerignore` 补 `arena/details` 与 `arena/matches.jsonl`——此前只靠 Dockerfile 的选择性 COPY 排除，2GB+ 的本地分析数据每次构建仍要完整传一遍上下文。

### 测试与验证

- **星海漩涡地图**：`tests/config/loader.test.ts` 新增用例钉住本图兵种表克制关系（任何单位都扛得住步兵的最坏一击、远程最坏一击必秒侦察、重装无一击秒杀、每点成本耐久不超过步兵 1.35 倍、可占点兵种（步兵/侦察）必须比重装/远程便宜）；本图 `supplies` 裁决权重为 0，`tests/engine/unlimited-turns.test.ts` 的追赶补给用例显式补 `supplies: 1` 后再验证每轮照发。
- **deployFromHq 开关**：`tests/engine/v2-rules.test.ts` 加 2 条（开关关闭后 HQ 起点部署得 `invalid_deploy` 且不扣行动点不生成单位；同图据点起点照常部署成功）；`tests/engine/simultaneous.test.ts` 加计划期变体（HQ 起点 `invalid_deploy`、同请求里据点起点照常入队，队列恰 1 条）；`tests/config/loader.test.ts` 加 5 条（`false`/`true` 放行且 `getMapConfig` 读回一致；`0`/`'false'`/`null` 报 `must be boolean`）；`tests/public/map-editor.test.ts` 加往返 3 条（serialize 输出 `"deployFromHq": false` 且 validate 无告警、normalize 保留 false、缺省图序列化不落键导入后仍 `undefined`，另有非布尔校验 1 条）；新增 `tests/algorithms/game-utils.test.ts` 钉住 `deployOrigins()` 的开关语义（缺省含 HQ，`false` 时只剩己方据点）。
- **无回合上限**：新增 `tests/engine/unlimited-turns.test.ts`（4 用例：越过旧上限连打 20+ 整轮仍 `phase:'active'`、无 `game_over` 事件、`adjudicateAtTurnLimit()` 恒 false、随后 `forceAdjudication` 得 `forced_adjudication_*`；含无上限图每轮照发追赶补给）；`tests/config/loader.test.ts` 加 `null` 放行、`0`/`-3`/`'15'`/`true` 拒绝、`whirlpool` 作为无上限 standard 图被收录 3 条；`tests/engine/simultaneous.test.ts` 加无上限变体（连解 16 轮，`round_resolved.gameOver` 恒 `false`）；`tests/state/store.test.ts` 加存档兜底（一份文件里 5 局：`null` 保留、`0`/`"15"`/缺字段收敛为 15、有限 12 不动）——这条是防「第 1 回合误裁定」真正复发的关键测试；`tests/public/map-editor.test.ts` 加 null 往返三条（normalize 保留、serialize 输出 `"maxTurns": null`、validate 接受 null 且仍拒绝缺失与 `0`）；`tests/public/score-panel.test.ts` 把四个客户端都纳入 `maxTurnsLabel` 循环并钉住 `∞` 文案；`tests/algorithms/{threat,field,verdict}.test.ts` 各加一条决策等价测试（同一场景下 `maxTurns: null` 与极大有限上限**同解**、与 `15` **不同解**），三个测试 helper 里的 `options.maxTurns ?? 15` 同步改成 `=== undefined` 判断——否则测试自己就把 `null` 吃成了 15。四道关键防线做过变异验证（分别撤掉引擎 null 守卫、store 兜底、map-editor normalize 特判、把 bot 改回 `?? 15`），每次都只有对应用例失败、不误伤其他用例。
- **端到端实测（whirlpool）**：`GET /api/maps` 收录 `whirlpool` 且 `preview.maxTurns: null`；开局 `adjudication.maxTurns` 为 `null`，跳到第 17 回合仍 `phase:"active"`、16 条 `round_end`、0 条 `game_over`；`POST /api/games/:id/force-adjudicate` 返回 `forced_adjudication_draw`；浏览器实测观战页回合角标 `16/∞`、大厅地图卡片 `⏱ ∞ 最大回合数`、地图编辑器勾选后导出 JSON 含 `"maxTurns": null` 且再导入复选框保持勾选。有限图回归：`default` 等 10 张图打满各自上限照常 `turn_limit_score|draw`。
- **v4.0.0 结项读数**：对 v3.1.1 46.6%（榜单口径 41.7%）、对 v3.0.3 53.6%（48.6%）、算法三场景 41%/48%/53%，全图 `default` / `breach` / `desert` 三张静态图 **0%**（验收一票否决）、`danger-close` 96/96，能力序 **v3.1.1 > v4.0.0 > v3.0.3**，判定未通过验收并结项。两条硬结论：① arena 榜单上「对算法 16.5%」是 7 图聚合假象——同一把尺子放到随机图，v3.1.1 对同批算法是 41%/45%/64%，静态图（desert 17% / breach 33%）拉低了总数，即「静态图崩塌」与「对算法弱」是同一个病（训练分布覆盖不足）；② S3 消融（算法 40% + lr 8e-05）第四次复现「收敛后继续训练 = 退化」，同步骤对照自 11.6M 起两条轨迹分叉并单调拉开。
- **服务器实测（pai-dsw a10，8c/28g/24g）**：瓶颈是 Xeon 8369B 的 vcpu 单核性能（整机 CPU 仅 35%），8 环境稳态 48fps；据此修正预算为 s1 8M + s2 4M 累计 12M 帧。
- **本次收口验证**：`npm run build` 通过；`npm run check-version` 3.5.5 全部引用一致；`npm test` 62 文件 / 588 用例全绿（含新增的评估链路缺件 501 用例，与无回合上限一并收口）；CI 在 `docker build` 之后新增**容器启动冒烟**（`docker run` + 轮询 `/readyz` 必须返回 `{"status":"ready"}`）——上面那条镜像漏件正是「构建全绿但容器起不来」的形态，只有真把容器起来才能钉住。
- **竞技场脚本冒烟测试不再依赖本机 `rl/models/`，CI 恢复绿**：3.5.4 引入的 3 个 spawn 真脚本用例（`generateArenaStats` / `generateArenaLeaderboard` / `expireArenaModels`）以仓库根为 cwd 走默认模型目录，而 `rl/models/` 是 gitignored 的本机产物，CI 全新检出上不存在——表现为「无法读取模型目录」或注册表缺模型条目（`reading 'status'` TypeError），CI 自 3.5.4 起连续红。两个生成脚本的 main() 补 `--models-dir` 参数（`expireArenaModels.mjs` 原本就有），三个用例改为自建临时模型目录传参；本地把 `rl/models` 暂时改名模拟干净检出，3 文件 31 用例全过、恢复后 63 文件 / 601 用例全绿。

## 3.5.4

### 新增

- **Verdict 裁决线算法（内置算法 AI 第 6 个）**：新增 `algorithms/builtin/verdict.mjs`，把前向打分换成**反向规划**——先回答"这局我用哪条线赢"，再从那个终局倒推回本回合每个单位该干什么。三步：①**裁决账本**，引擎终局裁决分（`src/engine/engine.ts` `scorePlayer`）是可解析的，每个动作都折算成"能改变多少裁决分"，攻击/占点/治疗/移动/部署第一次在同一个货币里可比（`default` 图直接读出：游侠一炮打总部 190 分 vs 打步兵 21.6 分，差 9 倍；一个中立据点 90 分 = 击杀一个满血步兵；部署一个步兵净赚 45 分；权重随地图走，`danger-close` 的 20/1/30/1/0 会自动读出另一套结论）；②**三条裁决线**——斩首（总部归零即胜）/ 磨平（打不光就换总分）/ 裁定（守住分差到期末）；③**反向排程**：从"敌方总部归零"逐回合倒推一个微缩攻城战（行动点先供赶路、再给到位单位开火，单发高的先吃行动点），得到攻城回合数 `killRound`，`slack = 剩余回合 − killRound` 就是 tempo 预算，直接决定全军风险姿态（≥3 储备 / 0–2 压上 / 打不光 磨平换分 / 敌方排程 ≤3 回合 全线回防）。同一条排程反过来跑敌方 = **敌人的斩首线**，压力在丢失胜势**之前**就被看见。排程按"路上要穿过几格敌方打击区"折算抵达概率（`STEP_SURVIVAL^危险步数`），不是无条件上界。
- **tempo 量纲的第一版可用答案**：`ALGORITHMS_NOTES` 的「未来方向」第 8 条点名的共同短板（threat 输 danger-close 18%、field 输 multiplayer-ring 7%）在 verdict 里被拆成两个可算的量——**行动点预算建进攻程排程**（赶路与开火争抢同一份行动点，1 AP/回合的图上排程自己算出"赶路都不够"），**交换阈值不再手工配常数**（"打击分 − 原地承伤 × 姿态系数"，进攻姿态折 0.65、储备姿态折 1.35）。实测两个老短板同时补上：`danger-close` 80%（threat 18%）、`multiplayer-ring` 100%（field 7%）。
- **定位**：实现日期 2026-09-18；注册链路 `registry.mjs`（`verdict` + `v1` 展示元数据）、前端 `play.html` / `play-m.html` 下拉（`algo_verdict`；后端 `ALGORITHM_BOTS` 由注册表自动生成，未改 `bots.ts`）；档案 `algorithms/docs/algorithms/verdict.md`（含**十个必须守住的约束**与两套种子基的完整性能表）。
- **Agent 简写对照表**：`records/` 复盘文件名与对局玩家名里的 Agent 简写（`tg_0155_rank01_QD@qwen3.8Flash.md` 的 `QD`、玩家名 `seed2.1pro0915-TC` 的 `TC`）此前只能靠记忆分辨。新增唯一对照源 `AGENT_NAMES`（`script/generateStats.mjs`）：`PI`=pi、`OMP`=oh my pi、`DSH`=DeepSeek Harness、`QD`=qoder、`QW`=QoderWork、`TW`=TraeWork、`TC`=TraeCode、`CP`=CatPaw、`WB`=workbuddy、`ZC`=zcode、`CC`=ClaudeCode、`CX`=codex；`KNOWN_AGENTS` 改为由它派生，并因此补齐 `TC`/`TW`/`DSH` 三个此前不认识的简写（`seed2.1pro0915-TC`、`Dsv4Flash0731-DSH` 等玩家名从 UNKNOWN/独立模型名正确归并）。统计看板 Agent 榜单列展示「简写 + 全名」（`stats.json` 新增顶层 `agentNames`）；README「Agent 简写对照」节给出人读对照表。
- **AI 竞技场「模型过期」（expired）机制与过期流程**：竞技场参与者已达 24 个，每训出一代新模型都要跟全部旧模型互打一轮，评估时长被已经沉底的「陪跑」模型主导。为此在「在役」与「作废」之间引入第三态 **过期**：过期模型的 zip **仍留在 `rl/models/`**（不像作废那样物理归档）、**历史对局继续进 Bradley-Terry 评分池照常计分**（所以它的分数是跟着池子一起漂移的，不是冻结在过期那一刻），但**不再参与新一轮评估**、前端默认隐藏、玩家大厅「添加 AI」也不可选。榜单数据因此保持连续——过期 3 个模型不会让其余参与者的评分发生跳变。单一事实来源是新增的 `arena/model-status.json`（按版本登记 `expiredAt` / `reason` / `evidence`），读取模块 `script/modelStatus.mjs`（类型声明 `script/modelStatus.d.mts`）同时供 JS 脚本、服务端 TS 与 Python 编排器使用，任何一处都不再另写版本名单；结构非法一律抛错，不静默降级（否则过期模型会悄悄回到评估池）。**过期流程**落在新增的 `script/expireArenaModels.mjs`（npm 脚本 `arena-expire`）：`--analyze` 按「每张地图都排在该图池子后半段、且没有任何一张图挤进该图前 25%」判定「全图倒数」（某一两张图特别优秀的偏科模型不算过期，且会列出淘汰原因），打印逐图名次表与候选；`--expire v2.3.2,v2.6.0,v2.5.0 --reason "…"` 写登记表并打印回填 checklist；另有 `--restore` 回滚与 `--list` 查看。首批过期 **v2.3.2@340K / v2.6.0@3.6M / v2.5.0@2M** —— 三者同时是全局评分最低的三个模型（1237 / 1318 / 1328），逐图名次分别为 21/15/21/21/21/19/21、20/20/19/18/19/21/18、18/18/20/12/20/20/20，均无突出图；综合评分榜从 23 行收敛到 **20 行**（与「过期模型不评估后其余模型的评分会不会被拖低」的疑问一并做了模拟验证：过期模型与它历史上输过的在役模型之间每对 168 局直接对战把相对强弱钉死，池子扩容只会让两边同时下移，连续加入 3 代新模型后两者差距稳定在 22~32 分、不会倒挂）。

### 变更

- **过期模型在评估链路里被剔除**：`rl/evaluation/round_robin.py` 的 `discover_models` 新增过期分组并在启动日志里单独打印（`--models` 显式点名仍可把过期模型拉回对手池，供审计/复现，点名优先于过期排除）；`src/api/bots.ts` 的 `refreshRlModels()` 过滤掉过期版本——大厅「添加 AI」与竞技场评估控制台都由它供数，一处过滤即可覆盖两处前端（实测 `/api/rl/models` 从 19 个降到 16 个，`README` 无变化）。
- **榜单与统计脚本支持 expired 状态**：`generateArenaLeaderboard.mjs` / `generateArenaStats.mjs` 给过期模型打 `status='expired'` 并带 `expiredAt`/`expiredReason`；两者都**不**跳过注册、**不**丢弃对局（这正是与作废的差别），只在产物里新增 `expired` 归档段（含当前评分、池内名次、留存对局）与 `source.expiredMatchesKept` 计数（当前 10296 局）。
- **竞技场前端默认隐藏过期模型**：`public/arena.js` 新增 `expired` 状态样式与「显示已过期」开关（综合评分榜筛选区），过期行默认不进评分榜、对位矩阵与详情；`public/arena-stats.js` 的「每模型玩法画像」与「参与者档案」各带一个共享同一状态的开关；`public/arena.html` 在档案页新增「已过期模型」归档表（文件 / 版本 / 过期日期 / 当前评分 / 留存对局 / 过期原因），并用琥珀色 `st-expired` 与作废的红色 `st-bad` 区分。
- `package.json`：新增 `arena-expire` 脚本（`node script/expireArenaModels.mjs`）。
- **`algorithms/docs/ALGORITHMS_NOTES.md`**：算法清单新增 verdict 行（反向规划/期限排程，对 greedy 95.7%）；性能对比新增「vs greedy（verdict：各图 30 局，两套种子基）」与「vs 其他算法（各 7 图 ×30 局）」两节；三方相克小节从"threat vs field"扩到三家（新增 forge 上 threat 反打 verdict 10:20）；「未来方向」第 8 条 tempo 量纲标注为第一版已落地，并留下未算完的部分（forge 短图需要的是**兑现率**量纲，不是再配一个系数）。
- **`algorithms/builtin/README.md`**：可用算法列表新增 verdict 一行。
- **`algorithms/docs/RELEASE_NOTES.md`**：新增 3.5.4 小节，含十处结构性约束的开发记录与完整性能表。

### 修复

- **过期登记表审查收口（三处）**：① 错误处理口径统一并写实——`rl/evaluation/round_robin.py` 的 `load_expired_versions` 从「损坏只警告、降级为无过期」改为**结构非法报错退出**（损坏名单会把过期模型悄悄拉回对手池陪跑，正是本机制要省掉的开销；文件缺失仍按「无过期」），并把「JS 脚本与评估 fail-fast、仅 `src/api/bots.ts` 允许降级+告警」的两种立场写进 `script/modelStatus.mjs` 头注、`arena/model-status.json` note 与 `MODELS_NOTES`（原先「一律抛错不静默降级」的表述与 bots.ts 实际行为矛盾）；② 过期与作废**互斥显式化**——`--expire` 拒绝登记 `MODEL_STATUS_BY_VERSION` 里的已作废版本（原先仅靠「作废 zip 不在 rl/models/ 下」巧合兜底），`generateArenaLeaderboard.mjs` 新增导出断言 `assertExpiredRetiredDisjoint` 启动时兜底手工编辑的登记表（此前同一版本双登记会显示「已过期」但对局被按作废整局丢弃，语义互相抵消）；③ Python 侧校验逐条对齐 JS `parseModelStatus`（版本格式、file 版本段一致、重复登记、`expiredAt`、`reason` 非空），新增跨语言契约测试 `tests/rl/test_model_status_contract.py`（14 用例：同一份 fixture 钉死两侧接受/拒绝一致、缺失=无过期、版本正则口径一致、仓库真实登记表双侧一致）。验证：`npm run build` 通过、`npm test` 全量 61 文件 / 566 用例全绿（JS 侧新增 4 用例：`--expire` 拒登作废版本、缺 zip 仍按原路径报错、互斥断言、缺失登记表返回空名单）、`pytest tests/rl/test_model_status_contract.py` 14 passed、`round_robin.py --dry-run` 冒烟正常（过期 3 个照常剔除）。
- **过期登记表契约补漏（Python 侧正则 `$` → `\Z`）**：审查发现 `round_robin.py` 的版本/日期校验用 `$` 结尾，会放过尾部带换行的 `version`/`expiredAt`（JS `parseModelStatus` 拒绝，两侧行为分叉）——且带换行的版本号入字典后匹配不上 `discover_models` 提取的版本段，过期模型会**静默回池陪跑**，正是收口要堵的事故。两处正则改用 `\Z` 并补 2 个尾部换行 fixture（契约测试 14 → 16 用例）。验证：`pytest tests/rl/test_model_status_contract.py` 16 passed、`round_robin.py --dry-run` 冒烟正常。
- **作废名单归位 `modelStatus.mjs` + 登记表字符串字段严格类型**：① `MODEL_STATUS_BY_VERSION` / `RETIRED_VERSIONS` / `assertExpiredRetiredDisjoint` 从 `generateArenaLeaderboard.mjs` 迁入 `script/modelStatus.mjs`（过期与作废两份名单自此同住唯一事实来源），`expireArenaModels.mjs` / `generateArenaStats.mjs` 改从它导入——`expireArenaModels` 不再为取一个常量拉入榜单重模块，消除其 import 期读默认登记表、跑互斥断言的副作用（`--status-file` 指定备用登记表时不再被默认登记表的状态劫持，双登记时 `--restore` 也不再被锁死）；② 两侧解析对 `version` / `file` / `expiredAt` / `reason` 一律要求 JSON 字符串、不做 `String()`/`str()` 归一（原先 JS 会把 `version: ["v2.3.2"]`、`reason: 0` 归一成看似合法的内容放行而 Python 拒绝，两侧行为分叉；登记表是手工维护名单，类型错误应 fail-fast），契约测试补 3 个非字符串 fixture（16 → 19 用例），`modelStatus.test.ts` 同步补 2 条类型断言。验证：`npm run build` 通过、`npm test` 全量 61 文件 / 566 用例全绿、`pytest tests/rl/test_model_status_contract.py` 19 passed、`round_robin.py --dry-run` 冒烟正常。
- **补 `generateArenaLeaderboard.mjs` 漏 import 的 `MODEL_STATUS_BY_VERSION`**：迁移常量时漏改了榜单脚本 payload 组装处的裸引用（import 未携带该名字），`npm run arena-leaderboard` 一跑 main() 即 ReferenceError——现有单测只直接调用导出函数、不执行 main()，全绿属误报；已补 import。榜单/统计两脚本各新增**端到端冒烟测试**（spawn 真脚本跑 2 局 fixture：v2.2.0 走 `MODEL_STATUS_BY_VERSION` 查表 legacy 分支、v2.3.2 走 expired 分支、注册算法 builtin 分支），统计侧 `--leaderboard` 指向空路径保持隔离，堵住「只测导出函数、不跑 main」的盲区。验证：两脚本小 fixture 端到端跑通、`npm test` 全量 61 文件 / 568 用例全绿（新增 2 用例）。
- **tg_0121 模型名更正为 `GLM5.3Flash`**：该局（2026-08-22，PI 对 WB）模型的对外命名有误，实为 **GLM5.3Flash**。直接更正档案本身——回放 JSON 玩家名、复盘 MD 文件名与正文统一为 `GLM5.3Flash` / `glm5.3flash`，统计看板与娱乐数据已重新生成并归并到 `glm5.3flash` 名下。
- **`DeepseekV4Pro` 并入 `DeepseekV4ProPreview`**：两者确认为同一模型，档案统一为 Preview 命名——tg_0082 复盘 MD 更名 `OMP@DeepseekV4Pro` → `OMP@DeepseekV4ProPreview`（玩家名、对手视角引用、`tg_0083` 的跨局对照引用同步更正），`MODEL_ALIASES` 中 `deepseekv4pro` 指向改为 `DeepseekV4ProPreview`，统计看板与娱乐数据已重新生成归并。

### 测试与验证

- 新增测试两份：`tests/algorithms/verdict.test.ts`（12 场景：裁决账本优先级、稳杀集火、斩首收束、**排程单位一步只推进一格也不提前交回合**、磨平线交换裁决、紧急回防、治疗、部署、被全歼仍补员、行动点门控、已移动单位不得再移动、拆墙正反例）与 `tests/algorithms/verdict-selfplay.test.ts`（default/breach/desert/dual-lanes/danger-close/multiplayer-ring/随机地图整局**零非法动作**、对局正常结束、开局无兵时也会补员）；`npx vitest run tests/algorithms/` 6 文件 / 71 用例全绿。
- 强度标定（`scripts/algorithm-arena.mjs`，headless 自博弈、逐局交替先手、每图 30 局）：**vs greedy 7 图合计 201:9（95.7%）**，两套种子基（1000 / 3000）给出**完全相同**的合计；vs threat 161:49（76.7%）、vs field 186:24（88.6%）、vs random 24:0；8 张图（含随机地图与 4 人 four-corners）**零非法动作**。`STEP_SURVIVAL` 一维扫描 0.72/0.62/0.55/0.45/0.35 → 89.0/92.4/**95.7**/回落/回落。4 人局 four-corners 20 局仅 2/20 席位局（未标定，见档案已知限制）。
- 链路验证：`npm run build` 通过；`npm run check-version` 校验 3.5.4 全部引用一致；`GET /api/algorithms` 返回 6 个算法（含 `algo_verdict` 裁决线算法）；冒烟 `node scripts/test-algorithm-bots.mjs algo_verdict algo_random` 实跑 HTTP 对局，10 回合完赛、verdict 席位获胜。
- **过期机制链路验证**：`npx tsc --noEmit` 退出码 0（`script/modelStatus.d.mts` 供 `src/api/bots.ts` 消费，项目 `allowJs` 关闭，TS 侧只认类型声明）。新增 `tests/script/modelStatus.test.ts`（7 用例：登记表合法解析与索引；缺 `version`／`file` 与版本不匹配／非 ISO `expiredAt`／空 `reason` **一律抛错**，验证「不静默降级」）与 `tests/script/expireArenaModels.test.ts`（5 用例：逐图名次与候选判定——每图都沉底才算候选、偏科模型被排除并给出原因、已过期模型不重复入候选、`--expire`/`--restore` 往返）；`tests/script/generateArenaLeaderboard.test.ts` 新增「过期模型与作废的区别」一组（过期模型仍进 registry、对局仍进评分池、只打 `status='expired'`；作废则对局整体丢弃）。`tests/script` + `tests/public` + `tests/api` 三目录 38 文件 / 301 用例全绿（含 `tests/api/bots.test.ts` 16 用例，覆盖 `/api/rl/models` 的过期过滤），全量结果见下条。
- 产物重算与前端复核：重跑 `arena-leaderboard` + `arena-stats` 无新增告警——registry 25 条（15 legacy + 1 recommended + 6 builtin + 3 expired），评分池 23 个参与者、**可见榜 20 行**，`source.expiredMatchesKept` = 10296 局、`expiredModelCount` = 3，过期归档段带 `rating` / 池内 `rank` / `keptMatches`（1237/22、1318/21、1328/20）。`GET /api/rl/models` 返回 16 个模型（19 − v1.0.0 − 3 过期）⇒ 大厅「添加 AI」与评估控制台下拉都不再出现过期模型；`round_robin.py --dry-run` 启动日志打印「已过期 3 个」并只纳入 15 个。浏览器实测：默认榜单 20 行，勾选「显示已过期」后 23 行且过期行带琥珀色「已过期」标签，档案页「已过期模型」归档表 3 行。
- **`npm test` 全量通过**：61 个文件 / 562 个用例全绿（exit 0）。3.5.4 开发期曾出现 13 个失败用例，全部来自工作区中未提交的在建文件（`tests/script/deepStats.test.ts`、`tests/public/stats-entertainment-render.test.ts` 依赖的 `script/lib/deepMetrics.mjs` 尚未导出 `buildWeekday`/`buildNemesis` 等），与本次改动无关（改动前后失败数一致，均为 13）；这些依赖随后补齐，发布前复跑已无失败。

## 3.5.3

### 新增

- **AI 竞技场（Arena）模块**：排行榜与评估控制台从「RL 模型」单一域升级为 **RL 模型 × 内置算法 AI 的混合评估模块**，同一 Bradley-Terry 池内直接跨类型比较（"threat 相当于哪个模型版本"从此有量化答案）。落地形态：页面 `/leaderboard.html` → `/arena.html`（标题「AI 竞技场」，页签 排行榜/玩法统计/参与者档案/评估控制台），榜单表格与对位矩阵带「模型/算法」徽标与类型筛选器，未参评的算法按 0 局进入档案。命名空间统一：后端 `src/api/arenaEval.ts`（路由 `/api/arena/eval/*`、`/api/arena/leaderboard/regenerate`，新增 `GET /api/arena/participants` 混合清单）、评分脚本 `script/generateArenaLeaderboard.mjs` 与 `script/generateArenaStats.mjs`（npm 脚本 `arena-leaderboard` / `arena-stats`，`stats-all` 链同步）、产物 `public/data/arena-leaderboard.json` / `arena-stats.json`、对战数据目录 `rl/leaderboard/` → `arena/`（`matches.jsonl` 迁移入 git，`details/` 仍 gitignored，deploy 排除表与 `.gitignore` 同步）。
- **算法 AI 进程内对战通道**：`rl/training/local-worker.ts` 新增 `{"cmd":"decide","owner","algorithm"}` 命令——经 `algorithms/registry.mjs` 动态加载内置算法，用与线上 REST 状态同形的快照（剥离 tokens/hostToken/rngState）调 `decide(state, utils)`，每次返回一个动作或 `endTurn`（null 语义与 `algorithms/lib/interfaces.mjs` 适配器一致；playTurn 型接口显式拒绝）。worker 快照顺带对齐线上序列化：`rngState` 不再外泄。
- **混合循环赛**：`rl/evaluation/evaluate_cross.py` 新增 `--player-a/--player-b`（规格 = 模型 zip 路径或 `algo:<注册名>[@<版本>]`；`--model-a/--model-b` 保留为模型别名），新增 `AlgorithmController` 与模型控制器同接口；算法动作若被引擎拒绝，按线上 runner 语义"结束该回合并记录 `failed`"，不中断整批。`rl/evaluation/round_robin.py` 覆盖模型×模型、模型×算法、算法×算法三类对：算法清单经 node 动态读 `algorithms/registry.mjs`（不再维护第二份名单），新增 `--algorithms <names|none>`；断点续跑/换座配对/种子盐协议不变（算法参与者 id 为 `algo_<注册名>@<版本>`，与既有模型 id 天然不碰撞）；纯算法批次不加载 torch/sb3（`evaluate_cross` 推理栈改为惰性导入），启动与单局耗时显著更低。matches.jsonl 明细 `meta.models[seat]` 新增 `kind`/`algorithm`/`version` 字段，摘要行 `players` 字段格式不变。
- **算法展示元数据单一来源**：`algorithms/registry.mjs` 新增 `ALGORITHM_META`（中文名/描述/当前版本）、`listAlgorithmInfo()`、`algorithmParticipantId()`（线上 bot type）、`algorithmVersionedId()`（竞技场参与者 id），并配 `registry.d.mts` 类型声明供 TS 侧消费；`src/api/bots.ts` 的 `ALGORITHM_BOTS` 改为从注册表生成（消除历史上出过不一致的双份清单）。
- **算法版本系统**：算法与模型一样会迭代改进，为此引入版本标注并贯穿竞技场全链路。`algorithms/registry.mjs` 的 `ALGORITHM_META` 每项新增 `version` 字段（当前算法均标 `v1`；未显式标注的算法视为 `v1`），新增 `algorithmVersion()` / `algorithmVersionedId()`；竞技场参与者 id 从 `algo_<注册名>` 升级为 `algo_<注册名>@<版本>`（如 `algo_threat@v1`），算法升版后历史对局仍归属旧版本 id、新对局记入新版本 id，与模型"每个 zip 一个版本一个参与者"的口径对齐；round_robin/evaluate_cross 的算法规格相应支持 `algo:<注册名>@<版本>`（round_robin 总是从注册表带当前版本，对局明细 `meta.models[seat].version` 记 `算法 <名>@<版本>`）；两份 JSON 的算法条目新增 `version` 字段，`/arena.html` 详情面板与参与者档案算法卡片展示版本。历史 matches.jsonl 尚无算法对局，id 口径切换零迁移；线上算法 bot（`algo_greedy`）与评估控制台规格（`algo:<注册名>`）保持不带版本——它们永远指向当前实现。
- **Field 势场算法（内置算法 AI 第 5 个）**：新增 `algorithms/builtin/field.mjs`，把棋盘建成"敌军斥力井 + 据点引力井 + 波前距离场"的叠加势场，单位沿势能梯度流动。机制：斥力井以敌军"BFS 可达格 ∪ 原地"为核心、按射程环展开并向外 `0.5^环距` 衰减（半径外势为 0，每格承伤按 `actionsPerTurn` 截断且**按敌军去重**）；据点井深按剩余回合期望收入计价、**周围 2 格内每多一个己方 canCapture 友军井深 ×0.6**（认领衰减 → 多单位自动分头抢点），己方据点另有驻军轻锚；推进势用**波前距离场**（真实绕行步距）取代直线距离，直接消掉人工势场的经典局部极小值（纯直线在 breach 图 37% vs 波前 57%）；斥力环数与据点井半径按战场尺度自适应（半径 ≤6 的小图 1 环/4 格，大图 2 环/5 格）。涌现行为：远程单位自发停在射程外沿（距 5 格 → 落到距 3 格）、打完自动撤出敌方打击范围、兵力分头抢点而非挤向同一点。实测（`scripts/algorithm-arena.mjs`，逐局交替先手）：**vs greedy 7 图 ×30 局 135:75（64.3%）**、vs random 24:0、vs threat 12:18（default）。强度由行动点预算决定——danger-close（每回合 1 行动点）29:1（97%，threat 同口径仅 18%）为最强项，multiplayer-ring（7 行动点）2:28（7%）为已知短板（304 个回合里 280 次带着剩余行动点交回合）。注册链路：`registry.mjs` + 前端两处下拉（`algo_field`；`bots.ts` 由注册表自动生成）；档案 `algorithms/docs/algorithms/field.md`。
  - 开发期三处结构性 bug 与一条计费去重（均由单元测试/对拍定位，详见 `algorithms/docs/RELEASE_NOTES.md`）：反击风险误用"势能值 vs 血量"比较导致贴脸从不还手（初版 30 局 0 胜）、机会火力选完落点才补减导致单位停在射程外、孤军 cohesion 为 `Infinity` 导致只剩一个单位时不移动、同一敌军在斥力井中被重复计费（41 点承伤放大到 205）。
- **排行榜展示名采用交付断点口径**：全量核验 17 个交付 zip 的 `num_timesteps`，发现 8 个模型展示名虚标——文件名末段是训练目标/终点，zip 内实为评估 best 断点（v2.3.1@800K 实为 7 万步、v3.0.0@3M 实为 5 万步等）。`generateArenaLeaderboard.mjs` 新增 `MODEL_DELIVERED_STEPS` 覆盖表（与 `rl/docs/MODELS_NOTES.md`「文件名步数与交付断点」对照表互为镜像，两处人工同步），`shortName` 优先按交付断点生成展示名：v2.3.1@800K→@70K、v2.3.2@800K→@340K、v2.3.3@2M→@770K、v2.6.0@4M→@3.6M、v2.8.0@6M→@4.7M、v3.0.0@3M→@50K、v3.1.0@1.5M→@100K、v3.1.1@10.9M→@8.8M；两份 JSON 参与者条目新增 `deliveredSteps` 字段，`/arena.html` 详情面板区分「交付 best 与文件名训练目标」，`arena-stats.js` 的「交付步数」改按交付断点展示。`STATUS_NOTES` 新增 v2.3.2 条目（交付 34 万步 best、交付期评估早于 `--swap-sides` 座位 bug 修复，历史 7:1 属小样本噪声），档案页可见。

### 变更

- **文档修正（rl/docs，竞技场大样本复核后续）**：`MODELS_NOTES.md` 状态总表修正三行小样本过时结论——v2.3.1 行「被 v2.3.2 1:7 压制」与复核方向相反（竞技场 168 局大样本 v2.3.1 对 v2.3.2 **149:19**），v2.3.2/v2.3.3 行的 8 局互打小样本补注竞技场大样本（对 v2.3.3 79:89 持平、对 v2.4.0 73:95）；新增「文件名步数与交付断点」对照小节；补 v3.1.0 缺失的状态总表行（此前仅 RELEASE_NOTES 有记录，统计页报 without notes）；作废小节中已删除的 `generateRlLeaderboard.mjs` 引用改为现行 `generateArenaLeaderboard.mjs`。v2.3.2 档案新增「竞技场复测（2026-09-16）」节（全榜垫底 17/17、计分胜率 19.7%、静态图 11%~24% vs 随机图 38%、default 对 v2.0.0 0:8 对照实验与模板化开局行为缺陷、三条根因），一句话总结同步修正；v2.3.3 档案一句话总结同步大样本数据。

### 修复

- 修复镜像构建失败：`src/api/{bots,arenaEval}.ts` 对 `algorithms/registry.mjs` 的构建期 import 依赖 Dockerfile build 阶段携带 `algorithms/`（含类型声明 `registry.d.mts`），此前该目录只在 runtime 阶段 COPY，容器内 `tsc` 报 TS2307 模块解析失败、CI 的 docker build 步骤红灯；已补入 build 阶段，本地隐藏/恢复该目录精确复现并验证。
- 修复 `generateArenaStats.mjs` 的 `parseModelsNotes` 主表定位：原先按「非作废小节即主表」解析，MODELS_NOTES 新增「文件名步数与交付断点」对照表后，其 3 列行被误判并刷「主表行列数不足」警告；改为按「## 模型状态总表」小节定位主表，其余小节含模型文件名的表格（如交付断点对照表）静默跳过。

### 移除

- 旧命名整体退役：`/api/rl/eval/*` 与 `/api/rl/leaderboard/regenerate` 路由（前端是唯一消费方，统一切到 `/api/arena/*`；`/api/rl/models` 仍被线上"添加 AI"使用，保留）、`public/leaderboard.html/js` 与 `public/rl-stats.js`、`script/generateRl*.mjs`、npm 脚本 `rl-leaderboard`/`rl-stats`、产物 `public/data/rl-leaderboard.json`/`rl-stats.json`、数据目录 `rl/leaderboard/`。旧 `matches.jsonl` 历史数据无需迁移（模型 id 不带 `algo_` 前缀即按 kind=model 处理）。

### 测试与验证

- `npm run build && npm test` 通过（55 个测试文件 / 496 个用例）；`npm run check-version` 校验 3.5.3 全部引用一致。
- 竞技场链路实测：worker decide 通道单测（threat/greedy/random 整回合动作全部被引擎接受、null→endTurn、未知算法报错）；`round_robin.py --dry-run` 三类配对（模型×模型/模型×算法/算法×算法）齐全；实跑纯算法批 2 局（0.9 局/s，未加载 torch）与模型×算法 2 局（含换座配对，双方各胜一局）；`/api/arena/eval/start` 混合 participants 经 dry-run 正确翻译为 `--models v3.1.1 --algorithms threat,greedy`；`/arena.html` 浏览器验证：算法行徽标与未参评展示、类型筛选、详情面板、控制台算法分组默认勾选、参与者档案算法卡片均正常。
- 算法 AI 进榜跑批已完成：`round_robin.py --jobs 4` 全量 455 批（算法×模型 17×4 对、算法×算法 6 对 × 7 图 × 24 局）新增 10920 局、0 失败批（1h18m，2.3 局/s），断点续跑在两次中断后正确跳过已跑局数；历史模型数据无需迁移。**结果：三个规则算法包揽前三**——威胁感知算法 1860±38（86.1% 胜率）、贪心算法 1833±34、蒙特卡洛树搜索 1704±25，最强的 RL 模型 v3.0.4@8.4M 仅列第 4（1663±22），随机算法如预期垫底（759）；每参与者 3360 局大样本，"规则算法在当前 RL 模型池中仍占优"首次有了量化答案。
- 展示名修正与文档复核链路：zip `num_timesteps` 与文件名步数全量比对（17 个模型，8 个差 ≥10 万步入覆盖表，其余在 rollout 边界/舍入噪声内）；竞技场 head-to-head 大样本核对（`arena/matches.jsonl` 每对 168 局）；`npm run arena-leaderboard` / `arena-stats` 重新生成两份 JSON 警告清零，抽查 v2.3.2 `short`/`deliveredSteps`/`statusNote` 与 v3.1.0 档案挂接正确；`npm run build && npm test` 通过（55 个测试文件 / 497 个用例，新增「主表外小节表格不参与档案匹配」用例，两个内联夹具补「模型状态总表」标题适配主表定位契约）。
- 算法版本系统链路：`round_robin.py --dry-run --algorithms threat,greedy` 参评算法显示 `greedy@v1, threat@v1`、35 个批次的配对 id 均带版本；实跑 `evaluate_cross.py --player-a algo:greedy@v1 --player-b algo:threat@v1` 1 局，摘要行 `players` 记 `algo_greedy@v1`/`algo_threat@v1`；`npm run arena-leaderboard` / `arena-stats` 重新生成两份 JSON（算法条目 id 带版本并新增 `version` 字段，模型条目不受影响）；`npm run build && npm test` 通过（55 个测试文件 / 498 个用例，新增「不带版本的旧式算法 id 不在注册表中」用例，算法混池/档案用例改按 `algo_<name>@v1` 断言）。
- 版本化算法跑批与页面复核：全量跑批 10920 局的对局记录全部以 `algo_<名>@v1` 落盘；两份 JSON 重新生成警告清零（35280 计分局 / 22 档案）；`/arena.html` 浏览器验证排行榜「版本」列、详情面板（标题带 `algo_threat@v1`、注册名无版本后缀）、参与者档案算法卡片（评分 1860 / 胜率 86.1% / 版本 v1）均正确。

## 3.5.2

### 变更

- **修复 agent 对局开局丢失玩家秘钥导致席位作废的问题**（`skill/SKILL.md`）：create/join 响应是服务端唯一一次下发 token 的时机——此后所有读状态接口都剥离 `tokens`/`hostToken`（`src/api/auth.ts` 的 `sanitizeGameForResponse`），开局后重 join 返回 `game_already_started`，lobby 阶段重 join 会新发席位新 token 而非恢复原席位，且无任何找回接口。原 skill 既无强制保存步骤，"Prefer not saving at all" 还在反向劝阻，叠加 shell 变量跨命令不存活，agent 开局经常不保存秘钥、后续操作 401 卡死。现新增 `Player token (mandatory)` 章节：create/join 成功后第一件事将 token 落盘到 `$SCRATCH/token.txt`（参赛 host 同时保存 `host.txt`），给出 jq 提取命令与 node 兜底写法（Windows Git Bash 通常无 jq），并用空文件判定错误响应；`wait-turn.mjs` 与后续所有调用的示例统一改为 `--token "$(cat "$SCRATCH/token.txt")"` 从文件回读；"Prefer not saving at all" 与 "never print tokens" 两条规则均注明 token 落盘豁免。`.pi`/`.qoder` 下的 skill 拷贝已同步（`.pi` 此前停留在 3.4.9，一并以 `skill/` 全量覆盖）。
- `AGENTS.md` 补充 Windows `/tmp` 路径陷阱约束：Git Bash 的 `/tmp` 实际指向 `AppData\Local\Temp`，而 node 把 `/tmp/x` 解析为 `C:\tmp\x`（旧会话残留处），`curl > /tmp/a.json` 后用 node 读取会拿到陈旧数据、表象是服务端状态交替。要求状态快照用 `curl | node` 管道直读；确需落盘时写 `temp/` 相对路径或 `C:/` 绝对路径，并在读回前校验 gameId。

### 测试与验证

- `npm run build && npm test` 通过（55 个测试文件 / 481 个用例）；`npm run check-version` 校验 3.5.2 全部引用一致。
- token 提取命令实测：jq 语义复核无误（`.player.token // empty` 对错误响应得空文件）；node 兜底单行在正确响应下提取 token、错误响应下得空文件，`$(cat …)` 剥离尾部换行。

## 3.5.1

### 新增

- **Threat 威胁感知算法**：新增效用 AI `algorithms/builtin/threat.mjs`。核心机制：为每个存活敌军构建两级威胁图（原地射程环权重 0.85 / 机动后覆盖权重 0.45），把攻击、治疗、移动、部署、爆破全部候选动作换算到统一效用尺度（1 点期望伤害 ≈ 6 效用）逐步选全局最优——攻击含斩杀奖励（稳杀全额、大概率 ×0.6）与反击风险（稳杀目标从威胁图中扣除），对敌方总部伤害项加压制系数；移动与原地比较增量，含抢点（收入按据点 kind 取实际值，接近回合上限附加裁定分 +80）、走位火力投射、连续化威胁惩罚 `min(0.8×单位价值, Σ前N次打击×0.8×残血疲劳)`——**落点承伤按 `actionsPerTurn` 截断**（再多也只算敌方本回合真能开火的次数），移出敌人当前打击范围即显著降罚，残血单位自动脱离贴脸位置；support 的走位目标改为最受伤友军/己方总部保持后排；爆破只拆"确实更接近目标"的墙；部署与战斗动作同尺度比较（`DEPLOY_UTILITY`）。单步决策 p50 0.25ms / p99 3.6ms（比 MCTS 快三个数量级：无搜索无模拟，威胁图一次构建后查表）。实测口径为 headless 引擎自博弈、逐局交替先手：**vs greedy 7 张标准地图 × 40 局 197:82（70.6%）**、vs 初版 31:9、vs mcts 14:6（mcts 未播种有批次波动）、vs random 24:0、随机地图 17:15；已知短板 `danger-close`（每回合 1 行动点）7:33，以及 3-4 人席位未标定（实测不优于 greedy）。与 MCTS 互为镜像互补——threat 有对手威胁建模但无回应链推演，MCTS 有推演但走位不看威胁。注册链路：`registry.mjs` / `src/api/bots.ts`（`algo_threat`）/ 前端两处下拉；档案 `algorithms/docs/algorithms/threat.md`。算法 AI 从 3 个扩展到 4 个（greedy / random / mcts / threat）。
  - **标定与踩坑（初版从未发布，故不单列修复条目）**：初版实测只有 41.1%、`breach` 图 0 胜 40 局，三处原因用竞技场逐条对照实验定位并修正——① 攻击/治疗/爆破未按行动点预算门控（20 局里 15 局返回 `action_limit_reached`，runner 遇错即作废整回合）；② 结束回合门槛 4 恰与"推进一格"的效用 4 碰磁，把还能推进的回合整局掐掉；③ 威胁惩罚 `THREAT_SCALE=2.2` 过高且对所有敌军线性求和，导致过度保守。另有两处判据随实测收紧：拆墙只要求"墙比脚下更接近目标"（旧判据还要求墙后是空地 → 隘口图永不拆墙），据点收入按 kind 取实际值（部分图的 `controlPointIncome` 配为 0）。修正后 70.6%。
- **MCTS 算法实现**：新增蒙特卡洛树搜索算法 `algorithms/builtin/mcts.mjs`。核心特性：UCB1 选择策略平衡探索与利用、每个决策 100 次模拟推演、最大深度 8 层、目标导向动作采样（移动取最贴近 `movementGoal` 的可达格，`canCapture` 单位对可达中立/敌方据点生成显式占领动作，采样未覆盖到可动单位时回退贪心移动避免提前结束回合）、部署决策由入口按补给/兵力状况先行判断、手工评估函数综合我方单位价值/据点/总部血量/敌方存活单位价值/敌方总部伤害与阵亡判定。决策耗时 0.5-1 秒，符合实时对战要求。实测对 random 全胜（12 局）、对 greedy 胜率 26.7%（30 局 8:22）：攻击/抢点/部署等宏观指标与 greedy 持平，差距在集火补刀效率，详见 `algorithms/docs/`。
- **算法竞技场**：新增 `scripts/algorithm-arena.mjs`，headless 自博弈评测工具——直接驱动引擎（不经 HTTP），逐局交替席位、审计每个动作是否被引擎接受（`--strict` 可作 CI 门禁）、输出裁定分项与决策耗时分位（p50/p95/p99），支持 `--players 2-8` 多席位与 `--map random` 随机图。本文档中 threat 的全部战绩（7 图 ×40 局等）均以该工具口径测得。
- **算法冒烟脚本**：新增 `scripts/test-algorithm-bots.mjs`，本地服务器运行时一键验证算法 bot 对局推进（默认 mcts vs random，可传参指定任意两个 `algo_*` 组合）。
- **算法注册与前端集成**：`algorithms/registry.mjs` 新增 `mcts` 注册；`src/api/bots.ts` 的 `ALGORITHM_BOTS` 新增 `algo_mcts` 配置；`public/play.html` 和 `public/play-m.html` 的"算法脚本"下拉菜单新增"蒙特卡洛树搜索（MCTS）"选项。算法 AI 从 2 个扩展到 3 个（greedy / random / mcts），用户可在前端直接选择。算法 AI 支持自定义玩家名：弹窗新增名称输入框，默认预填所选算法的中文名（类型切换时同步刷新），服务端 `/bots/algorithm` 接受可选 `name`（截断至 50 字符），缺省用算法中文名（`algo_mcts` 默认名为"蒙特卡洛树搜索"）；移动端 `play-m.html` 同步完整支持算法页签（页签切换、名称输入、确认添加）。
- **算法文档体系**：仿照 RL 文档结构创建完整算法文档 `algorithms/docs/`——`ALGORITHMS_NOTES.md` 算法开发笔记（系统概览、接口设计、工具函数、算法清单、性能对比、历史里程碑）；`RELEASE_NOTES.md` 版本发布记录（3.5.0/3.5.1 完整变更、性能测试、技术要点、已知限制）；`algorithms/greedy.md` / `mcts.md` / `random.md` 单算法详细档案（身份信息、原理详解、实现细节、性能表现、决策时间、使用方式、改进方向、一句话总结）。文档模板与 `rl/docs/models/*.md` 完全对齐，包含详细的性能数据、技术分析和使用指南。

### 变更

- 清理重复文档（根目录 IMPROVEMENTS.md），RL 训练规划迁至 `docs/`；勘误 3.5.0 验证记录（引擎复核确认双人局淘汰必判胜，"Winner: Draw" 为记录失真）。

### 修复

- 修复生产 Docker 镜像缺少 `algorithms/` 目录导致算法 AI 无法启动的问题。
- 修复 deploy 脚本误传 `dist-public/` 构建产物与 `temp/` 本地暂存目录的问题。
- 修复算法 runner 等待轮询无容错、瞬时网络错误导致进程退出的问题。
- 修复算法 API 客户端对非 JSON 响应抛裸 SyntaxError、掩盖真实状态码的问题。
- 修复 `ALLOWED_ORIGINS` 含空格时源匹配失败的问题。
- 修复非法 `LOG_LEVEL` 静默吞掉全部日志的问题。
- 修复大厅可加入多个同名 AI 座位、无法区分的问题（重名自动追加序号）。

- 修复 greedy / mcts / random 攻击、治疗、爆破、移动未做行动点预算门控的同类问题：引擎里每个单位每回合最多消耗 1 点行动（已激活的单位再动免费），此前这三个算法都可能在行动点耗尽后仍返回需耗点的动作，实测 greedy 约每局 1 次 `action_limit_reached`、mcts 与 random 亦然；runner 收到动作失败会 break 掉整个回合，等于白丢剩余行动点。修正后 headless 自博弈三方零非法动作，历史基线按新口径重测（mcts vs greedy 由 8:22 变为 5:15）。

## 3.5.0

### 新增

- **Vite 构建系统集成**：引入 Vite 5.4.21 作为前端构建工具（Phase 1：零破坏性接入，保持现有 IIFE 代码结构）。开发服务器启动时间从 15-30s 降至 274ms，生产构建体积减少 85%（2.3MB → 349KB），自动 gzip 压缩、Terser 压缩、sourcemap 生成。新增 `vite.config.ts` 配置多页应用架构（9 个 HTML 入口），开发模式下 Vite 代理 `/api`、`/data`、`/events` 到后端 3100 端口。npm 脚本新增 `dev:frontend`、`dev:all`、`build:frontend`、`build:all`、`preview`。所有 449 测试通过，生产就绪。Phase 2（IIFE → ES modules）留待后续迭代。
- **算法 AI 系统上线**：新增第三类 AI 玩家——纯规则/搜索算法编写的 JavaScript AI，与强化学习模型、LLM AI 并列，支持服务器自动管理。房主在"添加 AI"对话框的"算法脚本"标签中选择算法类型，服务器在开局时自动启动 Node.js 子进程运行算法，直至对局结束。
- **算法基础设施**：`algorithms/runner.mjs` 通用运行器（加载算法、轮询游戏状态、执行决策）；`algorithms/registry.mjs` 算法注册表（管理可用算法模块，支持外部扩展注册）；`algorithms/lib/api-client.mjs` REST API 客户端（封装游戏 API 调用，支持 429 限流自动重试）；`algorithms/lib/game-utils.mjs` 游戏工具函数库（六边形距离计算、A* 寻路、可达格子、目标评分、击杀判定等）；`algorithms/lib/interfaces.mjs` 算法接口适配器（支持策略接口与完整控制接口两种算法模式）。Windows 路径修复：`registry.mjs` 的动态 import 改用 `file://` URL 格式，解决 Windows 下 `C:\` 路径被误识别为协议的 ESM 加载错误。
- **内置算法**：`algorithms/builtin/greedy.mjs` 贪心算法（决策优先级：攻击可击杀目标 > 治疗受伤友军 > 爆破障碍 > 战略部署 > 向目标移动，早期优先侦察/步兵，多单位受伤时优先部署支援，第 6 回合后才考虑爆破）；`algorithms/builtin/random.mjs` 随机算法（从所有合法动作中随机选择，用于基准对比）；`algorithms/builtin/README.md` 算法开发指南（接口文档、工具函数说明、开发示例）。
- **服务器集成**：`src/api/bots.ts` 扩展 `POST /api/games/:id/bots/algorithm` 端点（房主通过 `X-Host-Token` 鉴权，请求体 `{ botType: 'algo_greedy' | 'algo_random' }` 指定算法类型）；服务器自动 spawn `node algorithms/runner.mjs` 子进程并传入游戏 ID、玩家 token、算法名称等参数；进程生命周期管理（stdout/stderr 日志转发、错误监控、退出清理、对局删除时终止进程）；算法 bot 注册表与强化学习 bot 并行管理，支持同时运行多种类型 AI。
- **前端界面**：`public/play.html` 与 `public/play.js` 修改——"添加 AI"对话框从 2 标签页（强化模型 / 对战提示词）扩展为 3 标签页（强化模型 / **算法脚本** / 对战提示词）；算法脚本标签提供下拉框选择算法类型（贪心算法 / 随机算法），确认后 POST 到算法 bot 端点；标签切换逻辑、元素引用、事件监听全部适配；移动端 `play-m.html` 同步。
- **手动运行支持**：算法 AI 可独立于服务器自动管理手动运行，用于开发调试或自定义场景。命令行参数：`--algorithm <name>`（算法名称）、`--url <url>`（服务器地址）、`--game <id>`（游戏 ID）、`--token <token>`（玩家 token）、`--side <id>`（玩家席位）、`--poll-seconds <n>`（轮询间隔，默认 0.5）、`--max-turns <n>`（最多处理回合数，默认 120）、`--once`（只处理一个回合后退出）、`--quiet`（减少日志输出）。
- **文档更新**：README.md 新增"算法 AI"章节，与强化学习 AI、LLM AI 并列说明；包含功能介绍、内置算法列表、手动运行示例、完整参数说明、算法开发指南链接；AI 自动对战章节重组为四类 AI 玩家（LLM AI / 强化学习 AI / **算法 AI** / 外部 LLM）。
- **自动游玩脚本**：新增 `scripts/auto-standard-game.mjs`——标准模式自动游玩演示脚本，可在单进程内同时驱动多个 AI 席位，支持全自动对战（AI vs AI）或与真人玩家混合对战；决策逻辑来自 `skill/standard.md`，内建 rate_limit 退避处理；用于快速演示、回归测试或无头环境批量对局。

### 测试与验证

- 端到端验证：创建标准模式 2 人游戏，添加贪心算法和随机算法 AI，游戏自动运行并在 30 秒内结束，贪心算法成功淘汰随机算法（Phase: game_over, Winner: Draw, Players: 贪心算法 (active), 随机算法 (eliminated)）；算法加载、REST API 通信、决策执行、进程管理、前端集成全流程通过。

## 3.4.9

### 新增

- **skill 新增 Scratch files 强制约定，AI 玩家临时文件一律写 `temp/<gameId>/<玩家名>/`**：此前 agent 对局把下载的 `wait-turn.mjs`、模式文件、状态快照、事件 dump 等直接落在工作目录根，根目录垃圾只能靠 .gitignore 逐条打补丁。现 SKILL.md 新增强制节：create/join 拿到 gameId 与玩家名后先 `mkdir -p "temp/<gameId>/<playerName>"`（玩家名含空格等 shell 敏感字符时改用座位号 `player_a`…），对局全程所有持久化文件只能写进该目录，明确禁止写入当前目录根、`$HOME` 等其他位置；能 pipe/`jq` 直读的响应不落盘。Canonical fetch 与 Polling decision 两处 `wait-turn.mjs` 下载/运行命令同步改为 `$SCRATCH/wait-turn.mjs`。配套：AGENTS.md「玩游戏」节补一句指引、「约束」节 gitignored 列表加 `temp/`，`.gitignore` 新增 `/temp/` 整目录忽略；`.pi`/`.qoder`/`.zcode`（junction→`~/.claude/skills/skill`）三处本地拷贝同步。
- **skill 补上战斗数学：伤害掷骰公式与击杀阈值**。此前 skill 全套文档从未写明攻击伤害含随机成分（唯一暗示是 simultaneous.md 的 "damage roll" 字眼），照 skill 玩的 agent 只能按 `attack − defense` 期望规划，把"需正骰才够杀"的低概率刀当稳杀——回放取证佐证：150 局中 0 次 HQ 最后一刀依赖骰子，但 2 局裁定险胜局分差小于一次靠正骰完成的击杀价值（tg_0022 分差 12 / tg_0108 分差 63，单杀摇摆均 ~90），且 `tg_0042` 有需满骰杀 15 血 HQ 掷出 −2 的 miss。SKILL.md「Units — read stats every game」新增第 4 条：伤害公式 `max(minimumDamage, attack − defense + uniformInt(−damageVarianceRange, +damageVarianceRange))`（现行全图 ±3、保底 1，同时回合结算同式）、三档击杀判定（`attack − defense − damageVarianceRange ≥ hp` 稳杀；`attack − defense ≥ hp` 在 ±3 下仍有 3/7 概率差口气；需正骰时成功概率 `(range − needed + 1)/(2·range + 1)`，翻盘级交换不许裸押、需留补刀）、治疗只向上浮动 `healPower + uniformInt(0, healVarianceRange)`；standard.md 优先级第 2 条 "Attack killable" 补 killable 定义与回链。`.pi`/`.qoder`/`.zcode` 三处本地拷贝同步。

### 变更

- **娱乐数据页大改版：视觉并入站点设计体系，数据全部重挖**。视觉上放弃独立的「杂志风」`entertainment.css`，改为复用 `stats.css`（面板/KPI 卡/表格/条形/导航同 stats、leaderboard 页），页面私有样式（战报导语、动作构成条、节奏曲线、势头卡、名场面卡、纪录柜、兵种双条、战术档案、趋势区）收进重写的精简版 `entertainment.css`，`body` 改为 `stats-shell entertainment-shell` 双类。数据上重写 `script/generateFunStats.mjs`，新增三条挖掘线：**combat**（攻击事件逐条累计伤害/击杀/承伤/治疗量/落空/失误，`tallyEvent` 扩出 damageDealt/damageTaken/damageToHq/kills/attackMisses/healsHp/failedActions/deathsByType 八个字段，`extractMatch` 把原始事件流与单位归属索引透传给娱乐脚本做序列分析）；**pace 回合节奏曲线**（3.4.8 铺路的 `roundAttribution.mjs` 正式消费——逐回合聚合操作/伤害/击杀/占领，分母为「到达该回合的对局数」，早期无 `round_end` 锚点的 V2 schema 2.0.0 回放整局剔除防 R1 堆叠，归属来源分布 directShare 随数据产出供页面标注可信度）；**momentum 势头学**（一血转化率 64%（76/119，平均第 5.1 回合、最快 21.4 秒）、首点转化率 54%、翻盘补给 22 次触发仅 5% 胜率与最大分差 1297 未翻盘纪录）。前端 `entertainment.js` 全量重写：战报导语（数据驱动标题——伤害峰值回合）、8 卡 KPI、动作构成条、回合节奏 SVG（柱=场均操作、线=场均伤害、柱透明度=样本量）、势头三卡、可排序战斗群像表（场均伤害/承伤/击杀/阵亡/KD/治疗/落空/失误，<3 场灰显）、兵种部署 vs 阵亡双条、战地速报（funFacts 落页面）、经济+最狠烧钱+相爱相杀、六张名场面、三页签纪录柜（对局/战斗/单项，新增最快胜利/现实最快/最重一击/单人击杀/单场总伤害/节奏最密）、战术档案（基准维度扩至 8 项含伤害与击杀）、趋势区与地图舞台（补常胜模型行）。
- **统计页（stats.html）整修**：`generateStats.mjs` 的对局摘要新增 `durationSec` 字段，KPI 区「全量事件」卡替换为「平均耗时」（筛选内墙钟均值 + 有效样本数，跟随筛选实时重算）。`stats.css` 共享层打磨：main 间距 14→16、KPI 卡 10→12 并加 hover 浮起、表格滚动条细暗化、新增 `.chart-box` 共享样式与 focus-visible 焦点环。

### 移除

- **文档清理**：删除 `docs/superpowers/` 下 14 份历史 plan/spec（2026-06～07 战术棋迭代过程文档，结论已沉淀进代码与 README）。

### 测试与验证

- 测试：`tests/script/generateFunStats.test.ts` 扩至 15 例（战斗字段过层、兵种部署/阵亡合并且 garrison-only 兵种保留、一血/首点转化率与最快一血、翻盘补给按局×座位计次与最大分差、pace 逐回合场均与无锚点剔除、最重一击/最快分胜负/单场总伤害——平局局不进最快胜利）；新增 `tests/public/entertainment.test.ts` 与 `tests/public/stats-runtime.test.ts`（node:vm 桩 DOM + 真实数据 JSON 执行页面脚本，断言全部区块渲染与榜单表渲染）——前端页面首次获得运行时回归保护。全量 52 文件 / 449 测试通过。

## 3.4.8

### 新增

- **RL 排行榜页新增「玩法统计」「模型档案」页签**：把 `matches.jsonl` 的 derived 派生统计与 `MODELS_NOTES.md` 的模型档案搬上前端。新增生成器 `script/generateRlStats.mjs`（`npm run rl-stats`，并入 `stats-all` 链尾，产出 `public/data/rl-stats.json` 约 32KB、0.4s）：复用排行榜的注册表与作废/旧格式过滤口径（参评 22,728 局、作废对局丢弃 2,352 与榜单计数一致），聚合玩法统计（结局原因分布、回合数/耗时直方图、全局兵种部署与阵亡占比、经济体征——场均收入 407 / 控制点收入占 66.8% / 场均占领 8.51 / 翻盘补给触发率 6.7%、每模型 13 列玩法画像、分地图概览）与模型档案（registry 全量含未参评 + 文件大小 + 合并榜单评分/CI/胜率 + 解析 MODELS_NOTES.md 状态总表「说明」列与作废表「作废原因」，未收录文件显示占位提示，表格行解析容错只留 warning 不炸脚本）。前端新增 `public/rl-stats.js` 渲染两个页签：页签栏扩为 模型榜单/玩法统计/模型档案/评估控制台，`#stats`/`#models`/`#console` hash 直达；页签容器的 flex gap 与 `[hidden]` 显式隐藏规则同步扩展到新页签（同 09-06 的潜伏坑）。两个数据语义修正沉淀进口径：`killsByType` 实为对手的 `lossesByType`（unit_death 事件不带击杀方，见 `evaluate_cross.py`），全局聚合后恒等于 losses——全局兵种表只保留部署/阵亡占比，K/D 仅保留在每模型画像（该粒度下语义正确）；heavy 阵亡 6,229 ≫ 部署 55 源于 breach 等图的预置守军而非统计错误，表头加注。直方图桶定档为左闭右开（末桶闭区间兜底），消除 1.0s 同时落在 '<1s' 与 '1–2s' 标签范围的边界歧义。服务端联动：「重算榜单」接口与跑批结束自动重算改为依次执行 榜单+统计 两个脚本（`rlEval.ts` 的 regenLeaderboard 拆出 runRegenScript 串行执行，任一失败即失败）。
- **新增存量回放回合重建工具 `script/lib/roundAttribution.mjs`**：引擎侧修复只对新对局生效，V2 + V3 已归档的 144 份历史回放仍需重建才能被按回合图表消费。提供三级归属策略：(1) `payload.roundNumber` 显式存在时优先采用；(2) `round_end` / `round_start` 作为锚点校准内部计数器；(3) 其余无 `roundNumber` 的事件顺推当前回合。关键边界：`round_resolved`（simultaneous 模式，携带刚结束的回合号）与 `comeback_supply`（standard 模式，携带触发回合号）都是「旧回合号」，工具对 `currentRound` 施加单调递增约束（`if (rn >= currentRound) currentRound = rn`），防止这类事件把计数器拉回导致后续 income / attack 被错误归属。导出 `attributeRounds`（逐条重建，含 `source: 'payload' | 'anchor' | 'carry' | 'none'` 溯源标记）、`tallyByRound`（按回合聚合计数）、`attributionCoverage`（无法归属事件占比，供页面标注数据可信度）三个纯函数，`docs/superpowers/specs/2026-09-11-stats-entertainment-redesign.md` 中的按回合图表重构可直接消费。

### 变更

- **v2.1.1 作废归档**：round_robin 复盘其全榜胜率仅 12.4%（random 图 2.7%），诊断为训练环境双重缺陷——v2.1.0 引入、v2.1.6 才修复的「移动只走一格」bug（策略按爬行节奏学习）+ v2.1.0 的奖励结算时序 bug（v2.1.7 修复）使占点（裁决分最大项）从未进入奖励信号，叠加家族内最弱配方（500k × mixed 规则对手）。模型 zip/断点/档案移入 `deprecated/`，`generateRlLeaderboard.mjs` 标记 retired，榜单重算后不再展示。同步收敛模型库：v3.0.4 复测收敛为 8.44M 单交付（288 局 157:131 胜训练期 best，落选文件已删）、v3.1.0 蒸馏中间产物按惯例删除。
- **RL 榜单全量数据刷新**：全 field round_robin 跑批（17 模型 × 7 图 × 24 局，新增 7440 局，5 批失败待补跑），v3.0.4/v3.1.0/v3.1.1 首次获得全 field BT 评分——v3.0.4（1670）与 v3.1.1（1658）分列总榜前二，现役 champion v3.0.3 退居第三（1621），「单图门禁 champion」与「总分最强」出现正面分歧（详见 `rl/docs/RELEASE_NOTES.md` 2026-09-12 条目）。

### 修复

- **RL 排行榜页布局与交互整修**：`.two-col` 用 `1.2fr 1fr` 布局，而 `fr` 轨道的自动最小尺寸是内容 min-content——对位矩阵 14+ 列不换行表格（`#h2h-table` min-width 720px，实际 1300px+）把左轨道撑爆，右侧「模型详情」面板被挤成约 40px 宽、标题竖排一字一行，视觉上全部粘连。修复：`stats.css` 的 `.two-col` 改为 `minmax(0, 1.2fr) minmax(0, 1fr)`（0 下限让 `.table-wrap` 的横向滚动接管，统计页同布局一并受益）。**模型详情与对位矩阵改为上下堆叠**（详情在上、矩阵全宽在下，`board-stack` 单列网格），配合矩阵列头从「v3.0.4@8.4M」精简为纯版本号「v3.0.4」（版本号撞车回退全名，完整文件 id 保留在悬停提示），17 列矩阵在 1440 宽下完全放下、无横向滚动条（实测 tableW=wrapW=1324px）。矩阵模型列 `position: sticky; left: 0`（窄屏滚动时行头常驻）；≤720px 窄屏排除 stats.css 对全部 `.data-table` 的卡片化改造（表头隐藏 + 行拆卡片对矩阵是破坏性的）。**面板竖向 0 间距粘连的真凶**是页签容器——内容包进 `#tab-board`/`#tab-console` div 后，`main` 的 flex gap 只作用于 div 本身、不再作用于内部 section（09-06 加页签时引入的潜伏问题），页签容器补 `display:flex; flex-direction:column; gap:18px` 接管间距；同时该 `display:flex` 会压过 UA 的 `[hidden]` 默认隐藏规则（与 `.eval-mini-strip` 同款坑），补 `#tab-board[hidden]/#tab-console[hidden] { display:none }` 修复页签无法切换。页面卡片间距整体放宽（main gap 14→18px、KPI 卡 10→12px）。
- **MODEL_STATUS_BY_VERSION 同步 v3.0.3 当前推荐**：榜单脚本的状态表仍标 v2.7.0 为 recommended，而 MODELS_NOTES.md 已明确生产 champion 为 v3.0.3（代码注释本就要求两处人工同步维护），新上线的模型档案页签把矛盾直接摆上页面。修正为 v3.0.3 recommended 后重算榜单，模型榜单详情面板与档案页签的状态徽标统一（v2.7.0 降为历史）。
- **修复事件 `roundNumber` schema 不一致导致按回合聚合全部堆到 R0 的 bug**：标准/歼灭模式（`src/engine/combat.ts`）的行动事件（attack / move / deploy / heal / demolish / income / unit_death 等）payload 不写 `roundNumber`，而同时回合模式（`src/engine/simultaneous.ts`）显式写入——同一类型的事件在两种模式下 schema 不一致。下游任何按回合聚合都会把无法归属的事件全部堆到 R0：实测 V2 全量回放共 1827 次 attack 落 R0、R1 仅 1 次、R2 仅 37 次，「伤害曲线 / 节奏拐点 / 每回合行动密度」等按回合趋势图彻底失真。引擎侧根治：`src/engine/events.ts` 的 `appendEvent` 内部对局开始后（`phase !== 'lobby'`）自动为 payload 补齐 `roundNumber = game.turn.roundNumber`（已有则不覆盖，避免破坏 `simultaneous.ts` 原有的显式写入），一处修改覆盖全部事件类型，未来新增事件也自动带上；lobby 阶段（如 `player_joined`）保持不注入，`game_start` 因触发时已进入 active 阶段自然拿到 R1。

### 移除

- **评分榜移除「状态」列**：历史/当前推荐徽标与版本列信息重复，表格瘦身一列；状态信息保留在点击模型行后的「模型详情」面板中。

### 测试与验证

- 测试：`tests/script/generateRlStats.test.ts` 新增 11 例（作废/同模型/旧格式三类过滤计数、derived 字段保留、总览/结局/直方图/兵种/经济/每模型/分地图聚合数学含左闭右开边界、空数据除零防护、MODELS_NOTES 两表解析含 basename 匹配与无链接档案列 stripMd 回退、列数不足容错、主表重复行 warning、档案组装评分降序与 v3.0.3 recommended 映射、榜单缺失时档案仍完整）；`tests/api/rl-eval.test.ts` 适配双脚本串行重算（新增统计脚本 spawn 断言与退出事件序列）。全量 50 文件 / 440 测试通过。
- 测试：`tests/engine/events.test.ts` 新增 5 例覆盖自动注入行为（对局中未携带时注入 `game.turn.roundNumber`、显式值不被覆盖、lobby 阶段跳过、`game_start` 注入 R1、跨 `round_end` 递增追踪），并修正原有 1 例严格断言（`toEqual` → `toMatchObject`）以适配 payload 自动补齐；新增 `tests/script/roundAttribution.test.ts` 13 例覆盖三级归属策略（含 simultaneous `round_resolved` 与 standard `comeback_supply` 不回退、pre-anchor 事件归 R1 且 `source='none'`、原始 `seq` 保留与自增补位、C3 场景复现——老 standard 回放攻击事件被正确归入 R1/R2/R3 而非堆积 R0）。全量 49 文件 / 430 测试通过。

## 3.4.7

### 新增

- **新增站点首页 `/`**：此前根路径没有落地页，访客只能从某个功能页直接进入。新增纯静态 `public/index.html`（`@fastify/static` 缺省 index.html 自动服务 `/`），复用统计看板设计体系（背景 `#11161a`、面板 `#161e26`、导航药丸、版本徽标）：英雄区（Slogan + `/version.js` 版本徽标 + 纯 JS 按半径 2 尖顶六角格坐标实时生成的 SVG 装饰棋盘——地形/据点/双方单位配色与游戏内 token 一致）、三种游戏模式卡片（标准/歼灭/同时，色标与统计页 `mode-std`/`mode-anni`/`mode-simul` 同源）、五兵种速览（CSS 复刻游戏内 `token-icon` 图元：十字准星/三角/实心方块/菱形/医疗十字，数值与 README 兵种表同源）、七个功能入口卡片；`/api/maps` 实时回填内置地图计数。自带响应式（≤720px 导航横滑），不做移动版镜像页。全部 8 个既有页面导航（含 `play-m`/`spectator-m` 移动抽屉切换器）前置「首页」链接；`tests/public/page-navigation.test.ts` 扩展两个用例：每个桌面页面导航含 `/` 回链、首页自身 active。README 页面表补入首页行。

### 变更

- **随机地图默认域大幅拓宽并覆盖全部静态图规则空间**：此前默认域实为「以 default 为模板的小范围抖动」（半径 6-10、行动点 3-8、补给 60-120、总部 120-240、据点 3-5 个且收入 8-16），极端静态图全部在域外——danger-close（1 行动点/20 补给/零据点收入/30 回合）、dual-lanes（0 初始单位/208 补给）、forge（100 血总部/6 据点）等一张都生成不到，RL 侧三代模型的静态图 whack-a-mole（v3.0.2 塌 danger-close → v3.0.3 塌 breach/desert → v3.0.4 塌 dual-lanes → v3.1.0 塌 forge）根因即此。现默认域拓宽为：半径 5-10、行动点 **1-8**、回合 10-30、初始补给 **20-220**、基础收入 6-14、据点收入 **0-16**、据点 **2-6** 个、总部 **80-240**；同时新增三个此前硬编码的随机维度：**裁决权重**（敌 HQ 伤害 3-20 / 己方 HQ 血 1-2 / 据点 30-90 / 军队价值 1-2 / 补给 0-1，覆盖 danger-close 的 20/1/30/1/0 到 default 的 5/2/90/2/1）、**据点类型收入**（supply 8-20 / forward_base 0-8 / repair 0-8，覆盖 danger-close 的 8/0/0 与 breach 的 20/8/8）、**初始单位数量与构成**（每方 0-4 个、按池抽取，全员共享同一构成保证公平，覆盖 dual-lanes 的 0 单位开局与 forge 的 4 单位全兵种开局）。玩家随机图从此可能刷出 1 行动点攻城局、零初始单位爆兵局等极端规则，`RL_RANDOM_OPTIONS` 与前端面板的固定值/区间覆盖不受影响。修复同时顺带改掉两个潜伏缺陷：对称据点放置改为原子 `claimPair`（旧写法 mirror 失败会留下不对称单点）；环形落点退避从「只往近处缩」改为「距离近→远→更近 × 角度扫满半圆」+ 全局扫描兜底（小半径下可放格子集中在远离出生轴的边缘，旧逻辑会产出 0 据点图，实测 seed coverage-87 即触发）。300 种子实测默认域：据点 2-6、行动点 1-8、补给 23-220、总部 81-240、0 单位开局 17%、4 单位开局 21%。前端 `random-map-ui.js` 默认域显示同步更新。

### 移除

- **下线全息观战台（`spectator2.html`）**：该页为独立「星云全息」主题的单文件界面，画风与站点其余页面（统计看板设计体系）不一致。删除页面本体及全部入口——5 处桌面导航链接（首页/统计/RL 排行榜/娱乐数据/地图编辑）、首页功能入口卡、README 页面表行；同步清理 5 个测试文件引用（回放客户端清单 `annihilation-mode`/`simultaneous-ui`、强制裁决覆盖页 `settings-token`、布局编辑器反向断言、导航测试放行断言）。实时观战与回放复盘由观战台 `spectator.html` 与移动版 `spectator-m.html` 继续提供；历史 RELEASE_NOTES 中该页面的发布记录按版本史惯例保留。

## 3.4.6

### 新增

- **「添加 AI」弹框新增「对战提示词」页签**：此前该弹框只能添加强化学习模型，现在分「强化模型」「对战提示词」两个页签。提示词页签按当前对局自动填充服务器地址（`location.origin`）、对局 ID、地图名（经 `/api/maps` 中文名解析）与人数，房主输入 AI 玩家名后实时替换模板中的名字；文本可手动编辑（再次改名或改勾选会重新生成），一键复制（`navigator.clipboard` 之外附带 `execCommand` 降级——生产为 http 部署、非安全上下文没有异步剪贴板 API）。「对方 AI 本地已安装 skill」勾选项把【规则获取】拆成两种变体、省掉接收方 agent 的分路判断：默认不勾按未安装生成（直接 `GET /api/skill` 拉全文——对方其实装了 skill 也照样能玩，是安全默认），勾选后走本地 `/api/skill/manifest` 校验、省一次全文重读。模板含禁用 `ai-player.mjs` 代打与 `wait-turn.mjs` 前台轮询守则。桌面（`play`）与移动（`play-m`）两端同构实现，共享逻辑抽在 `public/agent-prompt.js`（`window.AgentPromptUI`，node:vm 可单测）。
- **Agent 工作指引**：新增仓库根 `AGENTS.md`——面向 AI agent 的精简工作说明：常用命令、目录结构速览、硬红线（单副本架构、`skill/` 为规范源由 `/api/skill/*` 分发、gitignored 清单）、版本号随分支规则（`release/x.y.z` 分支版本必须等于 `x.y.z`，经 `npm run version` 对齐全部引用处）、agent 经 REST API 对战的规范流程（按对局模式从服务器拉取对应模式文件，勿用 `ai-player.mjs` 代打）。

### 变更

- **Skill 新鲜度检查改为比对优先**：Canonical fetch 从「无条件重新拉取 SKILL.md 全文」改为「先 `GET /api/skill/manifest`（几百字节）比对本地副本——sha256 优先，哈希一致即字节级相同、直接用本地副本，省掉一次全文重复读取；无法哈希时退化为 `appVersion` 比对；不一致才 `GET /api/skill` 拉全文」。以 sha256 为主信号的原因：版本号比对在同版本号改内容时会漏判（本条改动本身就是实例）。模式文件与 `wait-turn.mjs` 本来就是每局现拉、无重复读取问题，维持始终从服务器获取。同步 `.zcode`/`.pi`/`.qoder` 三处 IDE 拷贝（此前 `.zcode` 落后在 3.4.4、`.pi` 落后在 3.3.3，正是版本漂移问题的现役实例）。

## 3.4.5

### 新增

- **部署日志**：每次部署落盘 `deploy/logs/deploy-<时间戳>.log`（控制台双写，保留最近 30 份，gitignored 且不上传）：按阶段（连接/文件传输/写入 .env/构建启动/健康检查）计时；远端构建输出逐行带时间戳，卡住时日志尾部即现场；结尾汇总各阶段耗时与成功/失败结论，失败定位到阶段，Ctrl+C 与未预期异常同样走失败汇总并记录 traceback。SSH keepalive 30s 防 NAT 静默断连导致的假死。

### 变更

- **部署脚本增量化传输**：`deploy/deploy.py` 此前每次全量 SFTP 重传约 240MB（其中 `rl/models` 约 227MB 且日常不变），现传前 `stat` 对比远端 size+mtime 只传变更文件，put 后 `utime` 回写时间戳（SFTP put 不保留 mtime，回写是增量判定的前提），日常部署传输量降至 MB 级；改造后首次部署会全量重传一次建立时间戳基线。
- **部署脚本安全加固**：`CONTROL_TOKEN` 必填，不再随部署轮换或明文打印进部署日志，依赖 token 的调用方（脚本/agent）不受重新部署影响；SSH 弃用 `AutoAddPolicy` 改为 known_hosts 校验 + 首连 TOFU 交互确认（非交互环境未知指纹直接中止）；新增 `DEPLOY_KEY_PATH` 密钥认证（密码认证保留为 fallback）；部署末尾 `/healthz`、`/readyz` 校验改为断言 200，失败退出码非 0；可选 `DEPLOY_PRUNE=1` 清理远端已不在本地的残留文件（保护 `.env` 与 `backups/`）。
- **镜像与运行时配套**：Dockerfile 逐条 `COPY --chown` 取代 COPY 后 `chown -R`（消除 node_modules+rl 整层复制，镜像瘦身数百 MB）；compose 增加 `mem_limit: 1536m` 防 RL 子进程拖垮 2GB VPS 宿主、json-file 日志轮转上限；`.dockerignore` 补 `rl/leaderboard/details`（2GB/轮）、`rl/models/deprecated` 等缺口对齐部署排除清单。
- **文档**：`DEPLOYMENT.md` 按 SFTP 实际流程重写（增量语义、部署日志、prune 用法），原 VPS 上 git clone/checkout 流程与实际不符已删除；回滚改为本地切 commit 重部署。

### 修复

- **上传排除清单补齐**：补 `.pi`/`.zcode`/`.qoder`/`.pytest_cache` 等本地工具目录（与 .gitignore 对齐）及 `events.json`/`body.json`/`nul`/`sshpass.exe` 调试残留，不再推上服务器；`sshpass.exe` 同时移出 git。

## 3.4.4

### 新增

- **Skill 改由游戏服务器 API 分发**：解决 agent 各自持有 skill 本地拷贝、忘记同步导致加载旧版本的问题（`.zcode` 拷贝曾落后一个版本）。新增只读路由 `src/api/skill.ts`：`GET /api/skill`（SKILL.md 全文，裸 agent 的最短引导路径）、`GET /api/skill/manifest`（`appVersion` + 每文件 `bytes`/`sha256`）、`GET /api/skill/files/:name`（单文件下载，启动时扫描出的文件名白名单、天然免疫路径穿越，带 `ETag`/`If-None-Match` 304 与 `Cache-Control: no-cache`）。启动时一次性读入内存（deploy 重建重启即生效，无需文件监听）；无鉴权（agent 入局前就需要它）、不计入 POST 速率限制；skill 目录缺失时仅该组接口降级 503，不影响游戏。
- **SKILL.md 自愈式刷新**：顶部新增 Freshness 声明与「Canonical fetch (mandatory)」一节——无论从哪个来源读到本文件（包括旧的本地安装拷贝），都被引导先与服务器版本对齐；模式文件（standard/annihilation/simultaneous）改经 `GET /api/skill/files/<name>` 拉取，`wait-turn.mjs` 改为 `curl` 下载后用 `node` 执行（可按 manifest 校验 sha256），本地副本降级为离线 fallback。裸 agent 无需安装 skill，prompt 给一个 `http://<IP>:3123/api/skill` 即可开局。
- **部署配套**：Dockerfile 增加 `COPY skill ./skill`（此前镜像内无 skill 目录）；`deploy/deploy.py` 本就不排除 `skill/`，无需改动。本地 `.zcode`/`.qoder` 拷贝已做最后一次手动同步（带入 Canonical fetch 指令后即转为非权威 fallback）。
- **战斗掷骰接入可注入 RNG，同种子整局逐值可重放**：`startGame(game, bus, random)` 注入的随机源此前只用于开局洗牌/起始玩家，伤害浮动（`combat.ts` `rollVariance`）与治疗量（`combat.ts` 与 `simultaneous.ts` 两处 `rollHeal`）仍直接调 `Math.random()`，注入设计只做了一半。现改为对局状态携带可 JSON 序列化的 mulberry32 状态整数 `GameState.rngState`（新增 `src/engine/random.ts`，`nextGameRandom` 每次掷骰步进状态、`seedGameRandom` 从注入的 random 播种），三处掷骰全部改走它；同种子 + 同动作序列可逐值重放整局，为动作级回放验证器与可复现评估铺路。`rngState` 随 `runtime/games.json` 落盘，服务器重启后掷骰序列无缝延续；旧档案没有该字段时按固定种子惰性初始化（未走 `startGame` 的 `createInitialGame`/`joinGame` 测试构造路径同此，测试从此默认确定性），持久化 schema 版本不变。`sanitizeGameForResponse` 随 tokens 一并剔除 `rngState`，避免玩家预测后续掷骰；开局洗牌与起始玩家抽取仍按原样消费注入的 `random`（播种放在最后），传 `() => 0` 的旧测试观察到的开局行为完全不变；伤害/治疗分布不变，RL 训练与 round-robin 榜单统计等价。

### 变更

- **玩家名称上限加长 30 → 50，常量归位领域层**：`MAX_PLAYER_NAME_LEN` 原先定义在 `src/state/store.ts`（持久化层），属于业务规则而非持久化配置，现移至 `src/types.ts`（与 `PLAYER_IDS` 等领域常量同处，全仓无循环依赖）。长度同步加长到 50：后端截断点（建房/加入 `src/api/games.ts`、添加 AI `src/api/bots.ts`、默认名生成 `store.ts` `createPlayer`）与前端输入框（`public/play.html`/`play-m.html` 各 3 处 `maxlength`）全部对齐；前端为静态 HTML 无法 import TS 常量，该同步点已在常量注释中标注。改名/加名行为不变：仍是 trim 后超长静默截断。

### 测试与验证

- 测试：新增 `tests/api/skill.test.ts` 5 例（manifest 哈希与磁盘一致、ETag 304、单文件 content-type、未知文件与 `..%2F` 路径穿越 404）；`tests/skill/ai-player.test.ts` 一处断言适配 SKILL.md 新措辞；新增 `tests/engine/rng.test.ts` 5 例（RNG 序列确定性与值域、种子分叉、同种子两局 5 次攻击逐值一致、JSON 持久化往返后续掷、客户端响应不含 rngState）。全量 405 例通过。

## 3.4.3

### 新增

- **排行榜页新增 RL 评估控制台**：把 3.4.2 的 round_robin 跑批从命令行搬进网页——在 `/leaderboard.html` 即可启动/监控/停止批量对战，结束后自动重算榜单，形成「网页编排 → 跑批 → 榜单更新」闭环。不改观测/动作/奖励语义，`rl/evaluation/round_robin.py` 本身零改动，只是加了一层 Web 管控；依赖本机 `rl/.venv`，Docker 容器内不可用（面板明示）。
- **新增评估 API `src/api/rlEval.ts`**（`server.ts` 注册为 `rlEvalRoutes`）：`GET /api/rl/eval/status`（状态徽标、批次计划、待跑/已完成局数、本次新增局数、输出尾、knownMaps；快照含命令行与本地路径，读接口同样鉴权）；`POST /api/rl/eval/start`（maps/models 子串过滤、每对×每图目标局数、并发数、种子盐、dry-run，参数校验通过后 spawn `rl/.venv` 的 python 运行 `round_robin.py`，已有跑批进行中拒绝重复启动）；`POST /api/rl/eval/stop`（Windows 下 `taskkill /T /F` 终止整棵进程树——round_robin 下挂着 evaluate_cross 子进程与 tsx 引擎进程，必须整树杀灭否则残留）；`POST /api/rl/leaderboard/regenerate`（按需重跑 `script/generateRlLeaderboard.mjs`）。全部接口统一经 `authorizeControlRequest` 鉴权（AUTO_CONTROL_TOKEN 或仅限本机请求），前端状态轮询同样携带令牌头，401 时徽标显示「无权限」。
- **状态持久化与断点续跑衔接**：跑批状态落盘 `runtime/rl-eval-state.json`，服务器重启后恢复展示，上次仍在运行的批次标记为 interrupted 并提示用同参数重跑断点续跑（固定 `--salt` 才会跳过已有局数）；跑批正常结束或失败后自动重算榜单，无需手动执行 `npm run rl-leaderboard`。
- **前端「评估控制台」面板**（`public/leaderboard.html` + `leaderboard.js`）：地图池 chip 勾选、参评模型复选列表（全选/清空/已选计数，不勾选 = 全部可对战模型）、目标局数/并发/种子盐输入、dry-run 试跑；3 秒轮询驱动状态徽标、进度条与实时输出尾；「开始跑批 / 停止 / 重算榜单」操作按钮；跑批结束自动刷新页面榜单数据。地图 chip 以服务端 knownMaps 为准且仅在变化时重绘，保留用户已勾选项。

### 变更

- **作废模型归档**：v2.1.4–v2.1.8 四个作废模型的 zip、训练断点与单模型档案移入各自目录的 `deprecated/` 子目录（文件全部保留）。用户可见变化：「+ 添加 AI」下拉不再提供作废模型；round_robin 自动发现 18→14；RL 排行榜重算后不再出现作废模型（评分榜/热力矩阵/单模型详情全量排除，其历史对局不计分，数据仍保留在 `matches.jsonl`）；部署上传排除归档目录，详见 `rl/docs/RELEASE_NOTES.md` 顶部条目。

### 测试与验证

- 测试：新增 `tests/api/rl-eval.test.ts` 13 例（状态快照与默认地图、参数校验、启动后进度跟踪与结束自动重算榜单、并发启动拒绝、停止置 stopped、重启后 running 标记 interrupted、控制令牌鉴权含状态接口、按需重算榜单、真实格式输出行解析、统计文件变化后的局数重计、进程无法启动时回落 failed 而非幽灵 running、服务器关闭时杀进程树并标记 interrupted；全部注入伪进程，不触发真实跑批）；Python 侧新增 `tests/rl/test_event_collector.py` 锁定事件流合并去重与 seq 空洞检测不变量。

## 3.4.2

### 新增

- **RL 模型批量对战与排行榜系统**：解决多代强化学习模型无法系统性对比实力的问题，新增「编排 → 评分 → 展示」完整闭环。
- **Round-robin 编排器 `rl/evaluation/round_robin.py`**：自动发现 `rl/models/` 下全部 15 个可对战模型（排除 2 个 v1.0.0 的 512 动作旧格式），两两配对 × 全地图池（`random` + 6 张标准双人图 default/breach/danger-close/desert/dual-lanes/forge）批量对战；底层以既有 `evaluate_cross.py --swap-sides` 子进程运行（配对换座协议不变，跨版本观测/动作路由零侵入复用）。支持断点续跑（启动时按 模型对×地图 统计 `rl/leaderboard/matches.jsonl` 已有局数，`need = 目标 − 已有` 且取偶保证换座对称，同命令重跑全部 skip）、`--jobs N` 并发子进程、`--models` 过滤、`--dry-run` 预演；随机图重跑经新 `--salt`（时间戳+随机 hex）生成全新地图。全量 105 对 × 7 图 × 24 局 ≈ 1.76 万局（单局实测 ~3.5s）。
- **评分生成器 `script/generateRlLeaderboard.mjs`**（`npm run rl-leaderboard`，已并入 `stats-all` 链尾）：从累积 JSONL 生成 `public/data/rl-leaderboard.json`，纯 Node 无依赖。评分为 **Bradley-Terry MLE（MM 迭代）**：平局记 0.5、每已交手模型对附加 1 局虚拟平局先验（防全败模型发散到 −∞），Elo 映射 `1500 + 400/ln10 × ln p`、几何均值归一化保证顺序无关；95% 置信区间用按（对,图）分层有放回 bootstrap（mulberry32 固定种子，同输入两次输出逐字节一致），小样本另附 Wilson 下界参考列（复用 `generateStats.mjs` 导出）；全局与分图榜单独立计算，先手/后手仅做展示统计不进评分。正确性经三层验证：2 模型解析解精确吻合（9:1 → 评分差 320.65 = 400·log10(9.5/1.5)）、A>B>C>A 循环局势三者精确 1500、不均局数合成数据方向与幅度合理。开发期间发现并修复 MM 迭代公式多乘一项 `p` 导致的评分发散 bug。
- **排行榜页面 `/leaderboard.html`**（复用 stats.css，无图表库）：KPI 总览（总局数/参评模型/平局率/平均回合/局数覆盖度）、可排序主表（排名/模型/评分±CI/胜-负-平/局数/胜率/Wilson/先手·后手胜率/平均回合/状态标签，未出分显示「—」）、地图筛选下拉（切换整份预计算视图）、对位胜率热力矩阵（红→灰→绿插值，悬停显示 W-L-D）、单模型详情（vs 各对手战绩 + 分地图明细）、方法论说明与未参评模型区；v2.0.0 行标注「player_b 座位观测失真，成绩仅供参考」。玩家/观战/全息观战/地图编辑/统计/娱乐数据六页 page-nav 加入「RL 排行榜」入口。
- **文档**：`rl/README.md` 新增「批量对战与排行榜」章节（用法、断点续跑、评分协议），`rl/docs/RELEASE_NOTES.md` 顶部追加条目。

### 测试与验证

- 验证：round_robin 冒烟（3 模型 × default × 2 局跑通，JSONL 记录格式与座位逐局交替正确；同命令重跑全部 skip；`--games 4` 只补差值且座位 2/2 均衡）；页面经浏览器实测无控制台报错，排序/筛选/矩阵/详情交互正常。首轮冒烟 12 局真实对局已计入正式数据（v2.7.0 1691±122 > v2.2.0 1569 > v2.4.0 1240，与实测胜负一致），全量跑批按 `--maps random` 先行、静态图逐张补齐。

## 3.4.1

### 新增

- **随机地图系统**（面向 AI 训练）：服务端新增可播种子的随机地图生成器 `src/config/randomMap.ts`，`POST /api/games` 支持 `mapId: "random"` + `random` 参数字段，按请求现场生成完整地图配置（不写入静态地图表、不进 `/api/maps` 列表，配置随对局状态持久化，重启可恢复）；生成结果必须通过与静态地图完全相同的 `validateMap` 校验（新导出 `validateGeneratedMap`），可玩性硬保证。
- **参数可随机可固定**：地图半径（默认 6–10）、地形障碍密度（水域/障碍占比，出生区/中心/据点周边设保护区）、据点数量与类型（补给/前哨/维修轮转）、最大回合数（10–25）、每回合行动点（3–8）、兵种数值浮动比例（围绕默认基准）、初始补给/基础收入/据点收入、总部血量/防御，每项支持省略（默认范围随机）/固定数值/`[min, max]` 区间；**公平模式可选**：`symmetric`（默认）时地形/出生位/据点类型/初始单位布局严格中心镜像，关闭则完全随机；支持 2–8 人，多人局自动抬升最小半径。
- **种子复现**：同种子产出逐字节一致的地图，非法/越界参数由 `sanitizeRandomOptions` 收敛或 400 拒收；模式固定 `standard`（与 RL 本地基线一致），`rl/envs/env.py` 后续只需在创建请求里加 `"mapId": "random", "random": {...}` 即可接入。
- **地形连通性**：地形抽样后从出生位 BFS 校验**全部可通行格连通**（出生位/据点必为 plain），失败自动重抽并逐步降密度，兜底清空障碍，任何种子都不会生成被地形卡死的地图。
- **前端双端接入**：桌面/移动玩家页地图选择器首位新增「随机地图」卡片，选中展开参数面板（对称开关、种子框、11 组参数的随机/固定切换与区间/单值输入，留空走服务端默认）；人数下拉对随机图放开 2–8。共享模块 `public/random-map-ui.js`，`store.ts` 新增 `createLobbyWithConfig` 支持运行时配置建局，静态地图创建链路零改动。
- **地图预览（所见即所得）**：新增 `POST /api/maps/random/preview`（`loader.ts` 提取 `previewForConfig` 与静态地图列表共用），按当前参数现场生成并返回同构预览数据；面板底部预览区复用静态卡片同一套 SVG 渲染，选中随机地图即自动预览、参数/人数变化防抖刷新、「换一张」一键重抽；未填种子时服务端代抽并回填种子框，保证预览图与随后创建的对局完全一致；预览同步刷新选择器卡片缩略图。

### 测试与验证

- 测试：新增 `tests/config/randomMap.test.ts`（种子确定性、镜像对称、固定/区间参数、2–8 人×6 种子校验冒烟、高密度连通性、参数清洗）、`tests/api/random-map.test.ts`（随机图创建/同种子复现/开局可玩/预览即所得/非法参数 400）、`tests/public/random-map-ui.test.ts`（双端接线与模块形状），共 20 个新用例；浏览器端到端实测桌面/移动双端创建与预览流程。

## 3.4.0

### 新增

- **强化学习 AI 正式上线**：引入 `rl/` 本地 RL 训练全套——PPO 训练脚本与 `standoff` 同时回合环境（`rl/training/train.py`、`rl/envs/env.py` 等）、按版本命名的模型库 `rl/models/`（档案见 `rl/docs/MODELS_NOTES.md`）、按模型版本路由的代打脚本（`run_model.py` 系列，兼容 v1 512 动作空间与 v2.0 旧模型）；训练交付改用评估选出的 best 断点。v2.1.0–v2.2.1 迭代陆续修复回合交替损坏、奖励结算时机、对手动作语义错位等问题，并引入对手模型训练与座位随机化，详见 `rl/docs/RELEASE_NOTES.md`。
- **一键添加强化学习 AI 玩家**（房主专用）：桌面/移动端玩家页「等待开局」大厅新增「+ 添加 AI」入口，可自定义名称并从下拉框选择 `rl/models/` 中的训练模型；开局后服务器自动拉起 `rl/runners/run_model.py` 子进程代打该座位直至终局（`X-Host-Token` 鉴权，token 仅服务器持有、任何响应不回传）。服务端新增 `src/api/bots.ts`：`GET /api/rl/models` 返回模型列表（含动作空间大小），`POST /api/games/:id/bots` 添加 AI 时校验大厅阶段、双人顺序对局限制与模型动作空间兼容性（非 54 拒选）；踢出 AI 同步清理登记、删除对局终止运行中的 AI 进程。
- 部署：Docker 镜像内置 Python RL 运行时（独立 venv + CPU 版 torch/SB3）与 `rl/models/` 模型库，容器内可直接拉起强化 AI；`deploy/deploy.py` 上传时排除 `.venv`/`checkpoints`/`tb` 等训练产物。

### 测试与验证

- 测试：新增 `tests/api/bots.test.ts` 覆盖模型列表、token 鉴权、兼容性拒选、开局后 409 与注册表清理；桌面/移动双端新增「添加 AI」功能标记一致性断言。

## 3.3.5

### 新增

- 桌面玩家页与观战页新增**布局自定义**：右上角设置新增「改变布局」入口，进入布局编辑模式后，左右两侧的卡片框（单位状态、资源、分数排行榜、回合、当前操作、事件流；玩家页另有操作说明、本回合计划、快捷操作）可在 左侧 / 右侧 / 底部 三个区域间自由拖放（卡片虚线描边、空区域显示拖放提示框、插入位置随指针实时指示）；拖动地图框右下角新增的手柄可变更地图框整体大小（是框体尺寸变更而非地图缩放，双击手柄重置）。顶部工具栏提供完成 / 重置为默认 / 取消（Esc 也可取消）。布局仅保存在浏览器本地 `localStorage`（`tgLayout.play.v1` / `tgLayout.spectator.v1`），不上传服务器；无保存数据的浏览器页面保持默认布局。实现上新增共享模块 `public/layout-editor.js` + `layout-editor.css`（玩家/观战两端复用，按 `body` 壳类名识别页面），主栅格列由 CSS 变量 `--tg-grid` 驱动、JS 按各分区是否有卡片动态重组列数与卡片落列；底部区域与地图同处一个网格列，卡片与地图同宽并置于地图正下方。`spectator2.html`、移动 `-m` 页面及其他页面不受影响。

### 变更

- 去除玩家页与观战页右侧卡片的独立滚动条：侧栏 `#sidebar` 自身的 `max-height`/`overflow-y` 滚动条（含观战页侧栏的粘性定位）与事件流 `#events` 列表的高度上限全部移除，两页改为仅使用整页统一滚动条，避免自定义布局后出现滚动条嵌套。

### 修复

- 布局编辑器健壮性修复：卡片拖出 `#sidebar` 进入左侧/底部区域后不再丢失卡片框样式（背景/边框/圆角/内边距的选择器由 `#sidebar section` 扩展为同时覆盖 `.tg-zone section`）；单位状态卡片原本固定 200px 宽，现在与同分区其他卡片同宽；拖动地图手柄时同步实时更新网格列宽，修复地图框缩小后因 `max-width:100%` 按旧列宽钳制而再也无法拉大的问题。

### 测试与验证

- 新增 `tests/public/layout-editor.test.ts`：覆盖设置入口与脚本/样式引入、移动端页面不启用、localStorage 持久化与拖拽/缩放要素、卡片独立滚动条移除、`--tg-grid` 栅格变量与卡片框样式不丢失等静态断言。

## 3.3.4

### 新增

- 同时模式回合卡片新增全端计划提交状态：玩家页与观战页（桌面、移动及全息观战台）展示按玩家阵营着色的圆形状态图标，已提交显示同色勾号、未提交显示空心圆，并显示已提交人数，计划事件回放与新回合状态同步重置；补充前端回归断言。

### 变更

- 经验复盘规范按 `standard`、`annihilation`、`simultaneous` 三种模式拆分为独立文件：标准模式聚焦 HQ 攻防、行动顺序与裁决分；歼灭模式聚焦据点部署、炮火安全区、军力存活和 `army_destroyed`；同时回合模式聚焦秘密计划、预测攻击、目的格冲突、净 HP 与统一结算阶段。每份规范均补齐模式判定、取证顺序、账本模板、文件命名和质量检查，删除旧的混合规范以避免误用。
- 基于 `tg_0122` 调整 standoff 平衡：初始补给 150→120、基础收入 15→8、外围 supply 收入 12→8、中心 repair 收入 8→6、追赶补给 20→12；军力/补给裁决权重降为 0.35/0.25，有效行动权重升为 6。同时模式攻击命中改为每 10 HP 贡献 1 点行动功勋，部署/治疗等其他效果仍沿用 20 HP 桶，降低屯兵收益并提高主动交战收益。
- standoff 兵种重新定价并压低耐久：步兵 90 HP/31 攻/7 防/55 费，侦察 60 HP/42 费，重装 140 HP/40 攻/9 防/100 费，游侠 68 HP/38 攻/80 费，支援 76 HP/20 治疗/68 费；同步保留对峙之地已移除的部分障碍物布局。

## 3.3.3

### 变更

- standoff「对峙之地」地形重构（六重对称障碍群）：移除中央区域原有的 6 格环形障碍，中心高地完全开阔、无掩体可依托；在每个出生扇区外侧新增一组 3 格障碍（六重对称共 18 格），遮蔽相邻出生位之间的沿边走廊与直通路线，开局抢点路径随出生方向产生差异；六个出生位的起始单位站位随之微调避开新障碍格（构成不变：每出生位 2 步兵 + 1 侦察）。
- standoff 控制点类型化：全部 7 个据点标注 `kind` 并新增 `balance.controlPointTypes` 配置——六个外围哨点显式为 `supply`（每点收入 12，与原统一控制点收入一致，兜底字段 `controlPointIncome: 12` 保留）；中央点由「中央高地的争夺焦点」更名为「中心维修站」并设为 `repair` 类型：收入 12→8，回合边界改为修复其相邻一格内**所有受伤友军**各 10 HP（炮火危险区内单位跳过、每单位每回合至多结算一次，同时模式回合边界同样生效），全场占满总收入 84→80，中央据点从纯经济点转为续航点；配置同时预置 `forward_base` 类型（收入 8 + 自该点部署折扣 8）供后续调整使用。
- standoff 数值微调：侦察兵移动力 4→3——此前侦察是全场唯一 4 移动单位，降速后削弱其开局抢中立点、占点后被锁定仍能轻松拉开距离的能力，与主力梯队（移动力 2）的差距收窄；地图 `balance.adjudicationWeights` 显式写入 `effectiveActions: 2`（与标准模式引擎默认一致），不再依赖隐式默认值。

### 测试与验证

- 测试适配新地图：引擎用例中原硬编码旧 standoff 坐标的断言同步更新——部署上限用例的第三个移动目标改为 `(2,1)`、队列撞格用例的第二单位改取新出生位 `(4,1)`、爆破阻挡格改用新障碍群 `(3,1)→(3,2)`；游侠锁定逃逸用例的逃离点改为移动力 3 内可达且能脱离射程圈的 `(4,-3)`；API 层「排队/撤回」用例改为两轮结构——新版出生布局占满总部全部可部署邻格（首回合无处部署），首回合先挪开步兵腾位并确认结算，次回合再验证 `/deploy` 回显与 `plan/revoke`。

## 3.3.2

### 新增

- 同时模式兵种改造（反风筝平衡）：攻击/治疗引入**可配置覆盖形状**（地图 `units.<type>.attackShape / healShape`，`single` 单格 / `line` 定向直线 / `arc` 定向相邻三格扇形，`length` 可调，未配置默认单格、旧地图零影响）。对峙之地新配置：步兵沿方向轰击前两格（线上所有敌人各自独立结算伤害）、重装横扫周围三格扇形、支援兵区域治疗三格（`/heal` 请求体改为 `{ supportId, q, r }`，覆盖格内所有受伤友军各自掷量）；远程兵新增**锁定**能力（`attackLock`）：计划时点击格上有敌人则锁定该单位，结算时未逃出射程圈必命中、逃出才落空（`missed` reason `target_escaped`）。同步下调移动力（步/重/游/支 3→2、侦察 5→4）、步兵射程 1→2，多格覆盖 + 锁定让"侧移一格"与射程圈内机动不再能白嫖躲避，纯风筝无法取胜。攻击事件新增 `shape/locked` 字段，`round_resolved` 结果含每次命中的目标明细；前端桌面/移动端攻击与治疗高亮改为形状感知（射线/扇形格），观战端事件兼容；skill 规则书、AI 演示 bot 与 README 同步更新；新增线形双杀、扇形三杀、锁定命中/逃逸、区域群疗、形状校验等引擎用例；地图编辑器导入/导出保留新形状字段，standoff 往返校验不丢失。
- 兵种主题战斗特效（结算演出）：共享动画层 `public/board-animation.js` 新增六种特效——步兵**定向突刺**（pierce，弹体沿线飞行逐格炸环）、侦察兵**精确打击**（strike，十字标定）、重装**扇形挥砍**（slash，旋转刀身 + 刀光残影 + 逐格错峰劈痕）、**范围治疗波**（healWave，波纹 + 目标格上升光点）、**受击闪白**（hitFlash）与**伤害/治疗数字**（damageText，带描边上浮）；同时模式攻击事件 payload 补 `aimQ/aimR`（计划时瞄准格，miss 分支同样携带），前端以与服务端 `coveredCellsFor` 逐行等价的镜像推导（`HEX_DIRECTIONS` 顺序一致、不做射程校验——事件已结算直接信任）重建 line/arc 覆盖格，空格落空也播范围演出，旧事件无 `aimQ` 回退用 `q/r`。演出去重与聚合：同攻击者同回合的多目标事件只播第一次形状特效（key `attackerId|roundNumber`，8s TTL），受击特效不去重；同支援兵同回合的多条 heal 聚合为一次治疗波（60ms 收集窗）。旧模式（无 `shape`）按兵种类型缩为单格主题特效；`spectator2.html` 内联同款副本，四个 `BoardAnimation` 调用方（`app.js`/`play.js`/`play-m.js`/`spectator-m.js`）传 `unitSpec` 回调读取形状配置；特效并发上限 24→64，`prefers-reduced-motion` 下特效时长压为 1ms；新增多目标去重、空格扇形、旧模式单格等前端用例与 `aimQ/aimR` 引擎断言。
- 玩家页**结算按序回放**：新增共享模块 `public/playback.js`（`window.PlaybackQueue`，桌面/移动玩家页共用），SSE 结算爆发不再同一 tick 全量应用（此前单位瞬移、特效齐炸）。**阶段分组**节奏（紧凑）：部署/移动/爆破及其伴随失败同拍齐动（600ms，符合同时模式"移动本就同时"的语义），攻击（480ms）/治疗（340ms）/阵亡（420ms）/HQ 摧毁（520ms）/淘汰（340ms）逐事件播放，占领 260ms，回合边界与经济事件同拍快进（140ms），典型回合 3~5 秒；首批延迟一个宏任务应用，保证爆发完整入队后移动组整拍齐动，顺序模式单事件回合体感不变。回放期间棋盘点击与「确认行动」门控（`canActNow()`）、回合徽标显示"结算回放中…"；桌面侧栏与移动底栏提供**「跳过结算」按钮**——剩余事件静默应用（不补播特效）、视图吸附终态并同步权威计划。顺带修复 SSE 重连重放导致的特效重播（按 seq 入队去重），页面切后台时节拍自动归零防浏览器限流拖慢；新增 10 个 vm 注入式定时器的行为用例（分组节奏/跳过静默/seq 去重/reset）与双客户端接线、脚本加载顺序断言。

### 变更

- standoff 短局化与数值平衡（15 回合轻开局）：回合上限 18→15；初始兵精简为每出生位 2 步兵 + 1 侦察，重装/游侠/支援全部转为部署兵种（阵容构成成为经济决策）；伤害侧修复游侠锁定零反制处决（攻 44→36，双游侠集火 65 血单位平均恰好差 1 血存活）、重装对步兵近乎无敌（防 13→10，步兵 3 单位 2-3 轮可解决）、步兵主力微升（攻 30→32）；HQ 血量 180→200 抑制速拆；经济侧控制点收入 10→12 补偿短局总收入并强化占点核心玩法（开局补给 150 与基础收入 15 保持，第 1 回合即可部署重装或双游侠）。

### 修复

- 修复三个观战端的同时模式回放：不再虚构当前玩家，按玩家队列位置恢复 AP（含失败动作），并校验导入事件序列与旧版格式；导入后再次导出时保留原回放元数据。

## 3.3.1

### 新增

- 地图编辑器支持 `simultaneous` 模式：新增「同时模式」切换项，导入/导出保留模式字段与多人出生布局，standoff 地图可正常往返校验。
- 统计看板补齐同时模式展示：新增中文模式标签、独立颜色与未知模式兜底，筛选局数 KPI 的模式摘要纳入同时对局。
- Skill 规则说明补充同时模式的收入时点、AP 统计口径、固定结算阶段、失败动作扣费及强制结算后的状态处理，降低 AI 执行歧义。

### 修复

- 修复同时模式兼容构造器 `createInitialGame()`：现在正确创建总部、初始化空计划队列，并将当前玩家字段设为空，避免通过该入口创建出混合的顺序/歼灭状态；新增初始化回归测试。

## 3.3.0

### 新增

- 新增**同时回合模式**（`config.mode === "simultaneous"`）与专用地图 `standoff`（对峙之地，2/3/6 人六重对称布局）：解决逐人轮流带来的先手优势与多人等待问题。所有玩家在计划阶段通过既有动作接口（`deploy/move/attack/heal/demolish`）把指令**入队而不执行**，响应回显自己的计划队列；`plan/revoke` 撤回单条、`plan/clear` 清空、`end-turn` 确认锁定；全员确认（或房主 `host/force-resolve` 强制）后由服务器**严格同时结算**。旧行为零改动：顺序模式与歼灭模式的代码路径不变，全部既有测试原样通过。
- 同时模式核心规则：**每单位每回合仅一个动作**（移动/攻击/治疗/爆破四选一，部署独立计点、每动作 1 行动点）；**攻击改为指定格子**（`{ attackerId, q, r }`，射程内任意格预测性开火，命中移动/部署后格内的敌方单位或总部，友军免伤、落空即浪费）；**目的格冲突全部失败**（跨玩家移动/部署撞格全败不返还，自己队列内重复目标入队即拒）；**净血量同时结算**（先治疗后按序扣伤等价同时，同回合互杀成立、阵亡者炮弹仍落地）；移动按计划时刻棋盘寻路；爆破地形移动后生效；治疗按目标终点复核射程；第 1 回合无收入、第 2 回合起回合边界全员同发收入与维修；结算顺序恒按开局随机 `turnOrder`，确定性可回放。
- 计划保密：`GET /api/games/:id` 脱敏后仅返回 `plan.myQueue`（请求者自己的队列）与 `plan.committed`（公开的已确认名单），其他玩家的队列内容绝不外泄；计划期房主淘汰玩家会清出其计划状态，若剩余玩家已全员确认则立即自动结算。
- 新事件类型 `plan_committed` / `round_start` / `round_resolved`（含每个玩家每条指令的 `executed/failed/missed/fizzled` 结果汇总）/ `action_failed`（冲突落空及原因），既有事件（`move/attack/heal/deploy/demolish/unit_death/...`）复用并增量扩展 payload（`attack` 新增 `q/r/hit`），观战端、回放导入导出与重启统计重建（`restoreActionStats` 按玩家累计 `actionsUsed`）全部兼容。
- 前端五端齐适配：桌面 `play.html/play.js` 与移动 `play-m.html/play-m.js` 新增计划队列面板（指令列表 + 撤销按钮 + AP 余量）、「确认行动」按钮与全员确认进度、计划阶段行动门槛（已排队单位禁止二次下令）、同时模式攻击改为射程内任意格可点；三个观战端（`app.js`、`spectator-m.js`、`spectator2.html`）补齐新事件中文标签、`round_start` 回合计数与攻击落空展示；地图选择器新增「同时」模式徽标。
- Skill 适配：`SKILL.md` 模式路由新增 `simultaneous → simultaneous.md`（完整规则书：回合循环、硬规则、对峙之地数值、计划清单与决策序）；`wait-turn.mjs` 在同时模式下退出码 `0` 语义为「计划窗口开启且自己未确认」（顺序模式契约不变）；演示 bot `ai-player.mjs` 支持同时模式（预测射击/治疗/移动排队后确认）。
- 引擎新增 `src/engine/planning.ts`（计划阶段校验：每单位一动作、队列长度=行动点、补给跨队列累计、自家目标格查重）与 `src/engine/simultaneous.ts`（五阶段结算器：部署/移动共享目的格声明池 → 同时落位 → 拆除/格子攻击/治疗净血量 → 占点 → 回合边界），全部复用既有引擎函数（仅新增导出），不修改任何顺序模式逻辑；`maps/standoff.json`：半径 5（91 格）、中心 + 六轴共 7 据点、每出生位 HQ + 2 步兵 + 1 侦察 + 1 重装、AP 5 / 18 回合 / 开局 150 补给、自第 4 回合起翻盘补给。新增 38 个引擎/API 用例与 11 个前端/skill 用例覆盖冲突、预测射击、净血量、强制结算、计划期淘汰、持久化重启与脱敏。

## 3.2.13

### 新增

- 统一版本号变更脚本：应用版本号分散硬编码在 `package.json`、`package-lock.json`（顶层与 `packages['']` 两处）、`public/version.js`、`README.md`、`skill/SKILL.md`、`.qoder/skills/play-hex-api-game/SKILL.md`（skill 的 IDE 拷贝）与 `tests/public/import-export.test.ts` 的版本断言共 7 个位置，发版时手工逐个改极易漏改——`3.2.13` 提升时就漏改了 `README.md`、`package-lock.json` 与测试断言，导致 CI 在 `tests/skill/ai-player.test.ts` 与 `tests/public/import-export.test.ts` 两处版本一致性断言上失败。新增 `script/bump-version.mjs` 统一管理：传版本号一键提升全部位置（同时把 `public/*.html` 中与旧版本一致的脚本缓存参数 `?v=` 提升，并在 `RELEASE_NOTES.md` 插入新版本占位小节）、无参以 `package.json` 为基准同步其余位置（修复漏改）、`--check` 只校验一致性并输出 `OK`/`DRIFT` 清单（不一致退出码 1）；`board-animation.js?v=3.2.6` 这类独立维护的缓存参数不受影响。
- `package.json` 新增 `sync-version`、`check-version` 脚本，并挂 `version` 生命周期钩子使 `npm version <x>` 自动触发同步；CI（`.github/workflows/ci.yml`）在 `npm test` 之前新增 `npm run check-version` 步骤，版本漂移会在 1 秒内以清晰清单报出，而不是埋在测试失败日志里。以后所有版本变更一律经 `node script/bump-version.mjs <version>` 完成。

### 变更

- Hex API Game Skill 回合等待强制前台执行：多个 AI 使用该 skill 时习惯把 `skill/wait-turn.mjs` 放到后台运行，导致 agent 丢失对局跟踪、结束回合后不再响应。为此 `SKILL.md` 的「Polling decision」小节与脚本 `--help` 文案由原先的 "blocking/background wait" 改为强制**前台阻塞执行**——必须等待脚本退出并读取退出码后再继续；明确禁止 `&`、`nohup`、"后台运行" 模式、分离 shell 等一切后台方式，并将后台化标注为已知故障模式；若 harness 的前台命令超时短于 `--timeout-s`，要求调小 `--timeout-s` 适配并在退出码 `4`（timeout）时重跑脚本，而不是转后台。手动回合循环（Manual Turn Loop）第 5、10 步同步加上「前台执行、禁止后台」字样，覆盖 AI 最常读到的两处操作清单。

## 3.2.12

### 新增

- Hex API Game Skill 轮询优化：新增专用回合等待脚本 `skill/wait-turn.mjs`，AI 在 `/end-turn` 后以后台阻塞方式轮询对局状态，按退出码契约返回结果（`0` 轮到自己 / `2` 对局结束 / `3` 被淘汰 / `4` 超时），瞬时错误（网络、502/503、429 rate_limit）指数退避后继续轮询，token 仅放请求头不落盘不打印；
- `SKILL.md` 新增强制的「Polling decision」小节，要求开局前按用户提示词将意图分类为整局/单回合，整局意图下每次结束回合后必须继续等待直至终局或被淘汰，意图模糊时默认按整局继续轮询，Manual Turn Loop 同步改为禁止手写 GET 循环，解决多个 AI 使用该 skill 时结束回合后不自动轮询的问题。

### 变更

- 观战对局选择体验优化：对局列表改为按创建时间倒序排列，最新对局始终显示在顶部，避免对局数量增加后需要滚动到底部；`/api/games` 返回服务端权威的 `createdAt` 并统一排序，桌面端、移动端与全息观战页面同步适配。
- 观战对局状态标签差异化配色：等待中使用橙色、进行中使用绿色、已结束使用灰色，并同步覆盖桌面端、移动端和全息观战页面，提升状态辨识度。
- 观战页事件中文化：桌面端（`app.js`）与移动端（`spectator-m.js`）新增全量事件类型中文标签映射（`EVENT_LABELS`），「当前操作」区不再裸显 `reset_actions`、`round_end` 等英文事件名，改为「结束回合」「轮次结束」等中文彩色徽章；`reset_actions`/`player_joined`/`player_left`/`name_rename` 等此前回落为英文原文的事件流摘要补齐中文描述，部署事件的单位类型与对局列表的 `phase`（进行中/等待中/已结束）同步中文化。
- 「当前操作」详情区重排版：中文徽章 + 序号 + 灰色小字原始类型名 + 一行中文摘要，原始 payload JSON 收入可折叠的「原始数据」区，不再占满屏幕；为新事件类型补齐事件流色条与徽章配色（炮火系列橙红警示色、结束回合青蓝色），观战页脚本缓存版本号同步提升。

## 3.2.11

### 变更

- 统计模型评分按赛制拆分：双人局仍用胜 1 / 平 0.5 / 负 0 的 Wilson 下限；3 人及以上按名次百分位单独计分（第一名 1、末名 0，中间线性折算），再单独做 Wilson 下限。
- 统计看板拆成双人/多人两套列：双人场次、胜-负-平、胜率、评分与多人场次、名次分、评分分开展示，默认按双人评分排序，无对应赛制样本显示为 —，不再给出混合总评分。

## 3.2.10

### 变更

- 放宽玩家名称长度上限：后端创建/加入大厅的名称截断由 20 提升到 30，并抽出 `MAX_PLAYER_NAME_LEN` 常量供 `src/state/store.ts`、`src/api/games.ts` 与桌面/移动端创建/加入表单统一引用，避免前后端阈值脱节。
- 统计采集层共享化与模型规范化扩充：`script/generateStats.mjs` 
- 将回放目录扫描、`collectMatches`、`durationSec`/`MAX_DURATION_SEC`、`round1`/`round2` 等抽取为导出 API，`script/generateFunStats.mjs` 改为复用同一采集层，删除两份重复的目录遍历与时长判定逻辑；

## 3.2.9

### 新增

- 统计看板支持游戏模式维度：解析层从 `game_start.payload.mode` 提取模式（旧回放默认 `standard`），每局摘要与总览新增 `mode` / `modeDist`；看板新增「模式」筛选、对局列表模式列与红/蓝模式徽章，移动端排序同步支持模式。按模式筛选后，模型榜均分、均 HQ 伤等指标只反映该模式数据，不再混算标准与歼灭的分值量级。
- 歼灭模式炮火统计：解析层追踪 `artillery_damage` 事件（命中数 + 累计伤害）并逐席位输出 `artilleryDamage`，模型榜新增场均受炮火伤害聚合，歼灭特色生存压力进入看板。

### 变更

- 地图编辑器区分歼灭模式出生锚点：歼灭地图中出生槽的 `headquarters` 字段仅为出生元数据（运行时 `game.headquarters` 恒为空），编辑器此前沿用总部图标与「总部」称呼，易误解为歼灭模式也有总部。现在歼灭模式下画布改绘旗标出生点图标，工具按钮、选中面板、状态提示与校验错误文案统一改为「出生点」，规则页隐藏无运行时作用的总部 HP/防御字段；普通模式保持总部原样，切换模式时文案与图标随动。
- 「炮火禁区」地图数据迁移至出生槽（`spawnSlots`）格式并移除原有水域/障碍地形，战场变为全开放平原；同步完成平衡性微调：**重装兵**移动力 3→2、攻击 40→38（修正 2 击秒杀游侠的关键阈值），**游侠**移动力 2→3、成本 78→72（恢复其在开放地形上的风筝能力与性价比，与 four-corners / multiplayer-ring 家族基准对齐）；布局对称性、炮火缩圈覆盖与三阶段经济节奏经引擎源码核验保持公平，未作改动。
- 同步提升版本号为 3.2.9，并补齐地图编辑器与版本同步回归测试。
- 战术复盘规范升级至 2.1：以 `game_start.payload.config.mode` 区分标准总部战与歼灭战；歼灭复盘明确无 HQ、最后单位死亡以 `army_destroyed` 淘汰、仅可从己方据点部署，并要求记录炮火预警/收缩/伤害事件和安全区决策。裁决账本由五项补全为含 `actionScore` 的六项，模板、质量检查与反例同步覆盖歼灭模式。

### 修复

- 结束原因文案补全：`mutual_annihilation`（同归于尽）、`army_destroyed`（全军覆没）、`artillery_destroyed`（炮火歼灭）、`host_eliminated`（主机淘汰）不再以英文 key 裸显。
- 统计模型归一化修复：`qwen3.8max` 不再归并到 `Qwen3.8MaxPreview`，正式版 `Qwen3.8Max` 与预览版作为两个独立模型条目分别统计（3.1.6 曾将回放中的 `qwen3.8max` 统一更名为 `Qwen3.8MaxPreview`，正式版发布后两个名字代表不同模型），模型榜不再把最新一局的 `Qwen3.8Max-PI` / `Qwen3.8Max-QD` 混入 `Qwen3.8MaxPreview` 的战绩。

## 3.2.8

### 新增

- 娱乐数据看板新增三大数据维度：**战场经济**（补给总收入 / 部署总花费 / 转化率与模型花钱榜）、**终结者榜**（`player_eliminated` 击杀、被淘汰与相互淘汰的「宿敌」配对）、**地图舞台**（每张地图登场次数、场均轮数与场均占点强度）。
- 新增**趋势观察**区块：对局增长曲线（每日对局柱状 + 累计折线，含峰值日摘要）、模型登场时间线（甘特式活跃区间与「新面孔」标记）、月度节奏（按月对局数 / 操作量 / 轮次 / 活跃模型数）与回放版本演进时间线。
- 统计解析层新增补给账本：回放中的 `income`、`deploy` 实际花费与 `comeback_supply` 逐席位累计，`stats.json` 与 `fun-stats.json` 同步受益；每日时间线补充 `cumulativeMatches` / `cumulativeActions` 累计字段。
- 娱乐数据页交互增强：战场脉搏新增「每轮操作」卡片（仅统计含整轮记录的对局，避免旧回放轮次缺失稀释均值），名场面新增「最烧钱」卡片；区块编号重排为 01–09，响应式布局同步适配。

### 测试与验证

- 新增统计模块回归测试（经济账本、终结者 / 宿敌、地图舞台、累计时间线、月度分组、模型登场窗口）；脚本测试 13 项全部通过。

## 3.2.7

### 变更

- 重构 Hex API Game Skill 为「短主文档 + 按模式分册」：`SKILL.md` 只保留远程服务器、API、公共规则与强制 mode 路由；标准总部战写入 `standard.md`，歼灭战写入 `annihilation.md`。
- 对局进入 `active` 后必须先读 `game.config.mode`，再用 `read` 加载对应模式文件，且仅以当前模式文件为检查清单与决策序权威，避免两套规则在同一上下文里互相覆盖。
- `annihilation.md` 明确硬禁与运行时事实：不创建 HQ、`fromId` 只能是已占领据点、炮火危险区禁止部署/治疗/据点维修；`artillery-zone` 裁决权重下实质分为 `armyValue + actionScore`，终局优先保军力与有效行动而非虚构 HQ/据点分。
- `standard.md` 保留总部战完整路径：从 HQ 或据点部署、优先打击敌方总部、临近裁决按 HQ 伤害与据点等权重抢分。
- 补全 Skill 裁决分说明：总分六项为 HQ 伤、己方 HQ、据点、军队、补给与 **`actionScore`**；写明 `actionScore = actionMerit × effectiveActions`（歼灭默认 10、标准默认 2）、merit 来源（部署/拆墙/占点/伤害与治疗折算）以及纯移动不计分，避免终局囤补给或空移动。
- 歼灭 Skill / 示例 AI 的炮火节奏改为读配置与运行时状态：`config.annihilation.artillery`（`startRound` / `intervalRounds` / `damage` / `minimumSafeRadius`）与 `game.artillery`（`safeRadius` / `dangerCells` / `warningCells` / `nextShrinkRound`）；阶段用 `round < startRound` 推导，不再写死「前 4 回合 / 第 5 回合」。明确 danger 在回合边界结算伤害、warning 仅预告下一圈、危险区禁止部署/治疗/据点维修。
- Skill 强制每次先读 `game.config.units` 与单位实例字段再算射程/移速/造价/`canCapture`，并写明常见能力坑：仅 infantry/scout 占点、ranger 远距输出、仅 support 可治疗友军、仅 heavy 可拆除邻格 blocker；禁止沿用跨地图记忆数值。

### 修复

- 修正歼灭模式 skill 串台：此前开头已写明无总部 / 全灭出局，后半仍沿用「打 HQ、从总部部署、按 HQ 伤害抢分」的标准决策，导致 `artillery-zone` 上出现空转找 HQ、错误 `fromId`、终局乱抢据点分等问题。
- 修复统计脚本在 Vitest 下的加载问题：去掉 `generateStats.mjs` / `generateFunStats.mjs` 文件头 shebang，避免作为模块导入时被误解析。

## 3.2.6

### 变更

- 保留管理鉴权：删除对局、强制裁决、管理员改名仍由 `AUTO_CONTROL_TOKEN` / 本机访问保护；导航与文档同步去掉自动控制入口。
- 此前所有 deepseekv4flash 以及 deepseekv4pro 统一加上后缀 Preview。

### 修复

- 修复 `src/config/loader.ts` 的 TypeScript `TS18046` 类型错误。

### 移除

- 移除自动控制体系：删除服务端 `AutoControlController`、`/api/control/*` 路由、自动对战控制台 `control.html`，以及 `script/autoRunPi` 调度脚本与相关测试。

## 3.2.5

### 新增

- 地图编辑器完整支持歼灭地图：可新建或切换玩法模式、编辑炮火开始轮次/收缩间隔/伤害/最小安全半径，并为每个出生槽绑定唯一出生据点；模式切换、地图缩放、据点改名或删除时会同步维护相关配置，前端校验规则与服务端保持一致。

### 变更

- 地图编辑器重构为桌面三栏工作台：左侧集中编辑工具与放置参数，中央画布独立缩放和滚动，右侧通过对象、地图、出生、规则、单位标签切换属性；校验结果固定显示，选中对象和玩法切换会自动进入对应属性页。
- 地图编辑器视觉风格对齐观战玩家页：头部改为同款品牌标题 + 版本徽章 + 副标题状态行，补齐完整站点导航（玩家 / 观战 / 全息观战 / 控制台 / 地图编辑 / 统计 / 娱乐数据）；卡片、按钮、标签切换统一为观战页设计令牌（深蓝灰底、圆角卡片、绿色激活态、红色危险态），画布配色（地形、棋盘底、网格线、hover 高亮、出生槽阵营色）与实战棋盘完全一致，编辑器中预览即游戏呈现效果。

### 移除

- 移除地图必须至少有 1 个据点的限制：前后端校验均不再强制要求 `controlPoints` 非空，0 据点的地图可以正常导入和加载；歼灭模式出生槽的据点绑定仅在存在据点时才要求填写，允许无据点的纯歼灭地图。

## 3.2.4

### 新增

- 裁决分新增有效行动分：纯移动不计分，部署/爆破记 1 点贡献值，实际伤害/治疗每 20 HP 向上折算 1 点，占领据点记 2 点；普通模式每点贡献值默认 2 分、歼灭模式默认 10 分，地图可通过 `balance.adjudicationWeights.effectiveActions` 单独调整，地图编辑器同步支持该权重。
- 两种模式都会在玩家淘汰、单位与据点清理前冻结完整裁决分，并通过 `player_eliminated.payload.score` 写入事件流，避免未造成总部伤害的玩家淘汰后归零，确保终局和回放能排出稳定的后续名次。
- 加载旧持久化对局时会从部署、移动、攻击、治疗和爆破事件恢复累计行动点；旧回放缺少新统计字段时仍可兼容重建。

### 变更

- 示例 AI 在歼灭模式前 4 轮会优先争夺安全的中立补给点，第 5 轮起转向最近敌军，并继续优先撤离炮火预警区和危险区。

### 修复

- 修复歼灭模式排行榜因没有总部而无法计算分数的问题，桌面/移动玩家页、普通/移动观战页和全息观战台现在都能正确显示实时及回放排名。

### 测试与验证

- 补充普通/歼灭动作分、免费连续动作、淘汰分数冻结、旧对局恢复、地图权重校验及各前端排行榜回归测试；完整测试为 36 个测试文件共 271 项。

## 3.2.3

### 变更

- 将现有歼灭模式地图从与玩法同名的「歼灭模式」（`annihilation`）更名为「炮火禁区」（`artillery-zone`），地图身份与 `annihilation` 玩法模式正式分离，便于后续增加更多歼灭模式地图。
- 「炮火禁区」扩展为 2、3、6 人地图：新增六向旋转对称的出生据点、初始部队和水域/障碍布局；2 人对角出生、3 人隔位出生、6 人全位置出生，4/5 人仍不受支持。
- 「炮火禁区」调整为 12 轮三阶段节奏：前 4 轮争夺六个内圈补给点，中间 4 轮通过每轮 20 点基础组合收入扩充约 2–3 支部队，后 4 轮外圈出生点与内圈补给点依次被炮火覆盖；炮火伤害由 24 调整为 25，保证压缩后的对局仍能明确收束。
- 「炮火禁区」的开局侦察兵替换为第二支步兵：开局部队仍可在首回合占领本方向补给点，但无法直接进入相邻玩家的出生基地或抢占其他方向补给点；侦察兵仍可使用开局补给部署，并从下一轮开始行动。

## 3.2.2

### 新增

- 新增双人地图「歼灭模式」（`annihilation`）：双方不再拥有总部，开局各自控制一个出生据点，并拥有步兵、侦察兵和重装单位各一支；玩家失去最后一个单位时立即淘汰，最后存活者获胜。
- 新增地图级玩法类型与炮火配置：地图可声明 `mode: "annihilation"`，并通过 `annihilation.artillery` 配置首次收缩轮次、收缩间隔、伤害和最终安全半径；既有地图默认保持标准总部战规则。
- 引入缩圈炮火机制：内置歼灭地图第 4 轮预警、第 5 轮首次收缩，此后每两轮收缩一层，最终安全半径为 2；危险区单位在整轮结算时同时受到 24 点无视防御伤害，避免先后手结算偏差。
- 完善危险区行动限制与终局判定：单位仍可主动进入危险区，但危险区内禁止部署、治疗和据点自动维修；炮火同时消灭所有剩余玩家时以 `mutual_annihilation` 判定同归于尽，20 轮上限继续作为极端僵局的兜底裁决。
- 桌面/移动玩家页、普通观战页和全息观战台完整支持歼灭模式事件与回放，地图预览不再绘制内部出生锚点为伪总部；炮火预警和危险区覆盖层按地形、炮火、据点、单位的稳定顺序绘制，缩圈后不会被棋盘重绘擦除或遮挡单位标记。
- 地图加载器、持久化和地图编辑器支持玩法类型、出生据点关联及炮火参数的校验、导入和导出；歼灭局运行态保持 `headquarters: {}`，每个出生槽通过 `controlPointId` 关联默认归属据点。

### 变更

- 更新 Hex API Game Skill 与示例 AI：AI 会识别炮火安全区、避开危险部署和治疗位置，并主动向最近敌军推进，减少守点囤兵和消极拖延。

### 测试与验证

- 新增歼灭规则、炮火结算、同归于尽、地图编辑器和前端回放覆盖测试；完整 TypeScript 构建通过，36 个测试文件共 250 项测试通过。

## 3.2.1

### 新增

- 娱乐数据页新增动作构成展示、模型选择与全场均值对照、对局/单项纪录切换，并优化数据范围摘要、加载状态、重新加载入口及桌面和移动端响应式布局；继续复用现有 `fun-stats.json` 数据源。
- 为桌面玩家页、桌面普通观战页、移动玩家页和移动观战页新增共享 Canvas 棋盘动画，覆盖移动、攻击、治疗、部署、阵亡、总部摧毁、据点占领/中立化及地块拆除等事件。
- 动画层支持单位和总部位置、生命值及透明度插值，沿用既有页面的颜色、棋子造型、缩放和平移逻辑；同时适配 `prefers-reduced-motion`，并在空闲时停止持续重绘以控制 Canvas 开销。

### 变更

- 重做娱乐数据看板的信息架构与视觉布局：从传统面板堆叠调整为战报式阅读体验，重新组织战场脉搏、本期名场面、战术观察、兵种选择、模型战术档案和纪录柜，让关键趋势与代表性对局更易浏览。
- 区分实时事件与完整状态同步：SSE 和逐步回放播放动画，首次加载、刷新、切换对局及回放跳转直接定位，避免历史事件重复播放或刷新时出现错误过渡。

### 测试与验证

- 新增共享动画层的运行时和页面接入测试，覆盖桌面/移动页面、事件效果、动画状态。

## 3.2.0

### 新增

- 新增娱乐数据看板 `entertainment.html`：集中展示对局与动作总览、自动生成的趣味事实、模型行为画像、单位部署偏好、极限记录、每日时间线和回放 Schema 演进，并在玩家页、观战页和统计页补充入口。
- 新增 `script/generateFunStats.mjs`、`npm run fun-stats` 与 `npm run stats-all`：复用主统计脚本的回放解析能力，扫描 `records/V2`、`records/V3` 后生成前端只读的 `public/data/fun-stats.json`，支持单独或一次性刷新两类统计数据。

### 变更

- 加强模型名称规范化：复盘文件中的冗余 Agent 后缀会在统一入口剥离，避免同一模型被拆成多个排行榜条目。
- 统一对局时长有效性口径：平均时长、时间线与时长极值共同排除超过三天或时间戳无效的异常记录，避免跨日空闲时间成为误导性的极限数据。
- 调整行为画像标签规则：仅当模型的每局动作率严格高于全体参赛席位均值时生成相应风格标签，不再为全维度低于均值的模型强制贴标签。

### 修复

- 修复无显式 `owner` 的攻击事件被重复归属到模型的问题；总览与模型画像的移动、攻击、部署、治疗、爆破、占领和阵亡统计现在保持逐项一致。

### 测试与验证

- 补充统计生成回归测试，覆盖攻击归属、模型名规范化、风格标签和异常时长规则；重新生成 `stats.json` 与 `fun-stats.json`。

## 3.1.9

### 新增

- 新增异形地图支持：地图配置新增可选字段 `playableCells`，可显式声明任意连通区域（支持凹形、凸形、带孔洞），未声明时沿用原有 `radius` 完整六边形展开逻辑；移动/部署/爆破/寻路/绘图与前端渲染统一以 `playableCells` 为权威边界，`radius` 仅保留为显示与兼容元数据。
- 新增四角交锋（`four-corners`）4 人异形地图：半径 9 的矩形战场，四方出生区双轴严格镜像，近端补给点与中央前线基地驱动各方快速向中心集结交战，仅支持 4 人对局。
- `GET /api/maps` 预览新增 `preview.cells` 字段，返回已解析并带地形的完整可用格列表，前端无需再按 `radius` 自行推断棋盘形状。
- 地图编辑器升级：新增「添加地块」「移除地块」工具直接编辑 `playableCells`，删除含对象的格子会被阻止；新增「出生布局」面板支持 2–8 个出生槽及多人人数布局的可视化编辑与维护，旧双人图自动转换为 `spawnSlots`/`layouts` 格式。

### 变更

- 重构地图加载器：新增 `src/config/geometry.ts` 提供格子展开、连通性校验与地形合成；加载时校验 `playableCells` 非空、去重、连通，并强制所有 HQ、据点、初始单位、出生槽对象必须位于可用格内；多人布局（`layouts`）增加出生点重叠与不可通行地形占位校验。
- 引擎边界判定统一：`isInBounds` 与寻路通行判定改为基于 `game.cells`（即加载后展开的可用格列表），不再用半径公式推断；Skill 文档与 `ai-player.mjs` 示例同步更新，要求 AI 在行动前以 `game.cells` 确认目标坐标存在。

## 3.1.8

### 新增

- 新增受 Control token 保护的强制裁决接口 `POST /api/games/:id/force-adjudicate`，可在对局已明显失去悬念时按当前存活玩家的裁决分立即结束对局。
- 桌面观战页、手机版观战页和新版全息观战台新增“强制裁决”按钮，提交前显示当前排名并二次确认；对局结束后自动写入 `game_over` 事件并同步回放、持久化状态。
- 强制裁决区分唯一最高分胜出与最高分并列平局，新增 `forced_adjudication_score` 和 `forced_adjudication_draw` 结束原因，并同步玩家页、统计页和回放展示。
- 部署脚本支持在 `.env.deploy` 中预配置 `CONTROL_TOKEN`，设置后部署时将使用固定控制token，未配置时仍沿用每次部署自动生成随机token的原有逻辑。

## 3.1.7

### 新增

- `/api/maps` 预览字段新增 `actionsPerTurn`（每回合行动点），供前端地图卡片和 tooltip 使用；地图类型定义与后端序列化同步更新。

### 变更

- 重做大厅选图卡片布局：卡片改为 flex 固定高度（桌面 110px / 窄屏 104px），移除不定长描述文字避免参差不齐，hover/focus 时浮出深色 tooltip 面板展示地图名、完整描述和带中文含义的统计项。
- 地图卡片信息层级重构：中文名（15px 加粗）加灰色英文 ID 副标；标签从「半径 X」「X 据点」中文标签改为紧凑图标前缀 `⊘ ⬡ ⚑ ♟ ⏱`，依次表示地图半径、据点数、玩家数、每回合行动点、最大回合数，统一视觉风格。
- 新建房间表单重新排版：「你的名称」「最大玩家数」「房主参战」三个控件改为 grid 一行布局（`2fr 1fr auto`），名称输入框占最大宽度，玩家数下拉居中，底部对齐；窄屏（≤720px）和移动端自动堆叠为单列。
- 「房主参战」从原生 checkbox 替换为深色主题滑动开关：开启时深绿背景配绿色滑块，关闭时深灰背景配灰滑块，带 0.2s 过渡动画；移动端改为行内「文字在左、开关在右」布局，开关尺寸放大到 44×26px 便于触控。

## 3.1.6

### 新增

- 新增移动端玩家页与观战页：桌面端页面检测窄屏后自动跳转至 `/play-m.html` / `/spectator-m.html`，移动版适配触控操作与紧凑布局。
- 移动端导航与统计 UI 优化：header 和统计入口适配小屏，样式统一深色卡片风格。
- 大厅新增可加入对局列表：创建/加入页下方展示当前服务器公开大厅，显示地图、人数和状态，支持一键刷新并加入尚未开局的公开对局，替代手动输入 Game ID。

### 变更

- 裁决权重跨地图重平衡：`default` / `desert` 改为 5/2/90/2/1，`breach` 己方总部权重从 5 降至 2，`forge` 改为 7/2/75/2/1，`multiplayer-ring` 据点权重 100→75，`dual-lanes` 与 `danger-close` 维持原配置。
- 模型名称修正：回放记录中的 `qwen3.8max` 统一更名为 `Qwen3.8MaxPreview`。

## 3.1.5

### 新增

- 对局状态 API 增加权威 live 裁决计分板：`GET /api/games/:id` 在剥离 token 后附加 `adjudication`（`maxTurns`、`weights`、`scores`、`rankings`、`leaders`、`margin`），由引擎 `buildAdjudicationSnapshot` 统一计算。
- Hex API Game Skill 说明 AI 应信任服务端 `adjudication` 总分，breakdown 仅用于优先级判断；补充对应文档与 API/前端契约测试。

### 变更

- 玩家页优先展示服务端裁决总分，并在加载完整状态、SSE 事件与操作成功后合并刷新；终局平局时按存活并列 top 填充 `leaders`，避免写成空数组。
- 观战页继续用事件重建本地计分，终局优先 `result.scores` / `result.rankings`，不额外伪造半残 `adjudication` 快照。
- 重平衡多张地图的 `adjudicationWeights`，让限回合裁决更偏向「压总部 / 推进」而非纯占点囤兵：`default`/`desert` 改为 5/2/90/2/1；`breach` 将 `ownHqHp` 从 5 降到 2；`forge` 改为 7/2/75/2/1；`multiplayer-ring` 据点权重 100→75。`dual-lanes`、`danger-close` 维持原配置。
- README 裁决说明改为按地图权重计算，不再写死 ×4/×120；示例 JSON 与 default 对齐。历史 `records/` 回放仍保留导出时权重，不批量改写。

## 3.1.4

### 新增

- 新增离线统计看板 `stats.html`：以模型排行为主体，展示胜率、前三率、均名次、Wilson 评分、对位矩阵、Agent 排行、地图/结束原因分布与对局列表。
- 新增 `script/generateStats.mjs` 与 `npm run stats`：扫描 `records/V2`、`records/V3` 回放及复盘文件名，生成前端只读的 `public/data/stats.json`，统计数据与运行时 API 解耦。
- 统计页支持版本/地图/人数/模型筛选与搜索；兼容早期仅含 winner 的回放，并从 companion 复盘文件补全 agent/model 身份。
- 玩家页与观战页补充统计入口；README 增加统计页与数据生成说明。

## 3.1.3

### 新增

- 新增双人短局地图「危险距离」(danger-close)：半径5，双方HQ仅隔4格但被空心墙阻断，重装单位必须爆破开路；1行动点/回合的慢节奏攻城对决。

### 修复

- 修复「危险距离」地图补给据点缺失收入配置问题：补充 `controlPointTypes.supply` 定义(收入8)，使其据点正常提供补给。
- 玩家页复制按钮增加 Toast 反馈：复制成功/失败时弹出提示，不再静默吞掉错误。

## 3.1.2

### 变更

- 重做双人短局地图「熔炉重铸」：半径扩大至6，总部间距增加到10格，拉长战线减少开局rush。
- 中央改为十字熔炉墙阻断直通路线，重装爆破战术价值提升；6个据点完全对称分布，消除中央据点先手优势。
- 平衡性调整：初始补给+5，据点裁决权重下调至100；新增15%分差追赶补给机制，降低滚雪球效应。

## 3.1.1

### 新增

- 新增 `spectator2.html` 全息观战台：提供新版棋盘、事件时间轴、实时 SSE 观战、回放导入/导出、据点与排行榜信息展示。
- 新版观战台支持多玩家、类型化据点、总部与单位状态、事件详情和 Control token 管理操作。
- 大厅新增房主踢出玩家功能：大厅玩家列表追加踢出按钮（对房主自身隐藏），新增 `DELETE /api/games/:id/players/:playerId` 踢出接口并在开局后拒绝执行；被踢玩家自动退出大厅并收到通知，补充对应 API 与 UI 测试。
- 新增 `deploy/deploy.py` 远程部署脚本：通过 SFTP + Docker Compose 将项目同步到远程服务器并自动重启。

### 修复

- 服务端启动入口改用 `pathToFileURL` 替代 `'file://' + resolve()` 字符串拼接，修复 Windows 下 `isMain` 判断失败的路径格式问题。

## 3.1.0

### 新增

- 观战页右上角设置弹层新增 Control token 输入与保存，写入 `localStorage.autoControlToken`，与自动控制台共用，支持删除对局、改名等管理操作。
- 玩家页右上角新增设置弹层：可保存 Control token，并提供完整会话恢复字段（Game ID、Player token、可选 Host token）。
- 玩家页支持从设置保存/清除会话、进入游戏；启动时回填本地会话但不自动进局，避免错误凭证刷 401。
- 新增单机部署栈：`Dockerfile`、`compose.yml`、`.env.example`、`deploy/DEPLOYMENT.md` 与 CI 工作流，应用直接暴露 `0.0.0.0:3123`。

### 变更

- 运行时升级到 Node.js 24：`package.json` engines、`Dockerfile`、CI 与 `@types/node` 同步调整。
- SSE 事件流加固：25 秒 heartbeat、连接清理、`x-accel-buffering: no` 与 `reply.hijack()`，降低长连接被中间层缓冲或挂起的风险。
- Hex API / AI 工具改为面向远程部署：要求显式 `--url` 或 `TACTICAL_GAME_URL`，不再默认连接本机 `localhost`。

### 测试与验证

- 补充部署相关服务端、SSE 与 skill 测试覆盖。

## 3.0.3

### 新增

- 新增地图可选的百分比分差追赶补给 `balance.comebackSupply`，使用 `(最高裁决分 - 玩家裁决分) / 最高裁决分` 判断弱方，避免固定分数阈值无法适配不同地图计分规模。
- 追赶资格在非终局整轮结束后基于同一份发放前分数快照统一判断；所有达标存活弱方均可获得补给，领先者、并列领先者和已淘汰玩家不参与，终局轮直接裁决不发放。
- 新增 `comeback_supply` 事件，玩家页和观战回放会同步资源并显示实际分差；旧地图、旧存档和旧回放未配置该机制时保持原有行为。
- 地图编辑器增加追赶补给启用开关、开始轮次、分差百分比和每轮补给量，完善整数、范围、关闭状态及导入导出校验。
- Hex API Game Skill 补充触发公式、结算时机、事件字段和追赶补给后的重建策略，并增加对应文档测试。

### 变更

- 「六方环线」从第 3 轮起启用 40% 分差阈值与每轮 20 补给，保持 15 回合上限及现有经济、行动点、兵种、计分和地形参数不变。

## 3.0.2

### 新增

- 新增多人 `rank01`-`rank08` 与 `draw` 复盘命名方式，同时保留双人 `win/lose` 历史兼容规则。

### 变更

- 地图 `multiplayer-ring` 平衡性改动，削弱堆兵战术，鼓励进攻，减少补给
- 将战术复盘写作规范升级为面向 V3 多人对局的 2.0 版，覆盖 `player_a`-`player_h` 席位、整轮/席位回合、淘汰制、最终排名和真实平局。
- 重写第一名、非第一名和平局模板，要求按 `game_start` 与 `game_over` 事件取证，并从本局配置读取行动点、据点效果和裁决权重，避免沿用 2.x 固定数值。
- 更新复盘质量检查和反例，强化多人对手区分、补给与五项裁决分账本、淘汰后果、房主管理干预和无法可靠统计时的显式标注。

## 3.0.1

### 新增

- 自动对战控制台支持 2-8 席位：配置区按人数动态生成 `player_a`–`player_h` 表单，保留未展示席位配置缓存，手动指令可选多人席位。
- AI 技能与脚本完善多人流程：`skill/SKILL.md` 与 `skill/ai-player.mjs` 覆盖大厅创建/加入/开局、`a-h` 席位、淘汰停止行动与多人对手策略，示例脚本同步更新。
- 创建对局的地图卡片补充「最大回合数」标签；`/api/maps` 预览字段新增 `maxTurns`。

### 变更

- `multiplayer-ring` 更名为「六方环线」：半径缩为 8，仅保留 2/3/6 人对称布局；出生位落在六边形六个顶点，2 人对位、3 人隔位、6 人全开；4/5/7/8 人不再受支持。
- 玩家页/观战页回合展示改为 `当前/上限` 进度样式，行动玩家名靠右；观战侧栏移除据点 chip 条，资源区更紧凑。

### 修复

- 补齐多人前端事件回放：`app.js` 同步 `players`、回合轮转、`round_end` / `turn_skipped`、淘汰与据点中立等事件，排行榜可显示淘汰状态并优先采用服务端排名。
- 裁决计分对齐服务端：攻击敌方总部时累计 `headquartersDamage`，回放与实时观战分数不再依赖“当前敌方总部缺口”估算。

### 测试与验证

- 测试覆盖补强：新增/扩展多人 API、引擎淘汰与轮转、控制台 UI、排行榜、回合进度与 AI 席位解析相关测试，降低 3.0.0 多人链路回归风险。

## 3.0.0

### 新增

- 核心玩法从双人对战升级为 2-8 人多人混战：新增大厅阶段、玩家席位 `player_a` 至 `player_h`、地图支持人数校验、随机/分散出生位分配，以及房主可选择是否参战的创建流程。
- 新增多人大厅与房主管理 API：创建对局返回 `hostToken` 与可选玩家 token；新增公开大厅查询、加入、离开、开局、踢出大厅玩家、房主跳过当前回合和房主淘汰玩家等接口，玩家改名改为玩家 token 鉴权。
- 前端创建/加入流程重做为多人大厅体验：创建时选择地图与人数，进入等待大厅后可复制房主/玩家凭证、查看席位、开始游戏；观战页和对局列表支持多人状态、玩家数量、淘汰和回合轮转事件。
- 地图体系扩展：新增 `multiplayer-ring`（现名「六方环线」，初版为八方环线）作为多人环形战场，新增 `forge`（熔炉之心）作为短局双人地图；移除实验性的 `blitz` 地图。
- 回放与历史记录补充多人事件结构：`game_start` 包含玩家列表、出生分配和行动顺序，新增 `player_joined`、`player_left`、`round_end`、`turn_skipped`、`player_eliminated`、`control_point_neutralized` 等事件。

### 变更

- 胜负规则改为淘汰制：总部归零不再立即结束整局，而是淘汰该玩家、移除其单位、将其据点转为中立并冻结资源；仅剩一名存活玩家时以 `last_player_standing` 结束。
- 回合与裁决逻辑适配多人：按 `turnOrder` 在存活玩家中轮转，新增整轮结束事件；达到地图最大轮数时只对存活玩家按累计总部伤害、己方总部 HP、据点、军力和补给计分，并输出完整排行榜。
- 计分展示从双方面板升级为排行榜：玩家页和观战页按存活状态与分数展示多名玩家，结果页包含排名、胜者、淘汰状态和裁决分明细。
- AI 与自动对战工具适配多人席位：`skill/ai-player.mjs` 支持 `a-h` / `player_a-player_h` 席位，控制台和自动控制器适配大厅创建、开局、多人 token 与存活玩家回合循环。

### 测试与验证

- 测试覆盖同步扩展：补充多人 API、持久化、地图人数校验、回合/淘汰规则、AI 席位解析和排行榜 UI 测试，降低从 2.4.2 迁移到 3.0.0 的回归风险。

## 2.4.2

- 新增对局本地持久化：服务端会将内存中的对局保存到 `runtime/games.json`，启动时自动恢复；支持通过 `TACTICAL_GAME_STATE_FILE` 覆盖保存路径，测试环境默认禁用持久化。
- 新增对局删除机制：提供 `DELETE /api/games/:id`，复用自动控制台的控制 token / 本机访问权限；删除后同步移除内存状态、持久化记录和事件订阅，避免持久化文件无限增长。
- 优化默认观战页对局选择体验：将原生下拉框替换为自定义对局列表，展示短 ID、阶段、回合与地图信息，并在观战页提供删除当前对局入口。
- 修复爆破地形回放/重置状态：玩家页和观战页会克隆初始地图数据，再按 `terrain_demolished` 事件更新地形，避免反复播放或重置时污染原始地图。
- 强化爆破与占点规则一致性：爆破目标距离校验改为先接受同格/相邻距离再交给地形与占用校验拦截非法目标；据点占领改为读取单位 `canCapture` 能力，避免后续单位类型扩展时遗漏。
- 地图与回放工具链细节补齐：服务端启动提示增加地图编辑器入口，观战页 JSON 导出文件名改为 `tg_0_YYYYMMDD.json` 风格，V2 历史对战记录统一为 `tg_` 命名格式。

## 2.4.1

- 新增浏览器地图编辑器 `map-editor.html`：支持本地新建、导入、可视化编辑、导出和复制 `maps/*.json`，并在 README 中补充入口与使用说明。
- 地图编辑器覆盖 V2 地图主要配置：地形、总部、类型化据点、初始单位、单位规格、总部规格、经济/行动/裁决平衡参数和据点类型参数均可编辑，并在导出前执行结构校验。
- 地图编辑器实体视觉与玩家页/观战页对齐：单位、总部和类型化据点使用一致的 canvas 字形与选择面板图标，减少编辑和实战展示之间的识别差异。
- 更新 Hex API game skill：以通用 agent 口吻描述操作流程，补充重装单位爆破 `/demolish` 接口、约束、行动点消耗和策略优先级，并增加对应文档测试。
- 补充地图编辑器、实体标记和爆破地形相关设计/计划文档，便于追踪 2.4.x 地图工具链与规则扩展。
- breach地图平衡性改动

## 2.4.0

- 新增重装单位爆破玩法：重装可将相邻阻挡地形变为平地，打开新的推进路线；服务端规则、行动 API、玩家页操作、事件流和回放均支持该地形变化。
- 完善爆破校验与回放兼容：禁止爆破地图外坐标，回放会按 `terrain_demolished` 事件重建地形变化，避免观战/导入时地图状态丢失。
- 面板实体标记可视化：棋盘上的单位、总部、据点从英文缩写改为 canvas 字形标记，选择面板从纯文字 token 改为 CSS 图标 + 中文短名双行视觉 token。
- 新增地图 `breach`（破障行动）：中央石墙阻断直通路线，重装单位必须爆破开路；三种类型化据点分布在两翼，并经过镜像对称和平衡调整。

## 2.3.1

- 玩家页与观战页 UI 优化：统一深色卡片风格，侧栏资源/回合/据点改为栅格卡片布局，顶部工具栏分组显示，棋盘加面板外框，header 吸顶。
- 创建对局时的地图选择改为可视化卡片：每张地图附 SVG 缩略预览（地形、据点、HQ 位置）、半径/据点数量标签，支持键盘选择，替代原先的文本下拉框。
- 观战页移除独立 HTML 回放导出按钮，仅保留 JSON 导出/导入；相应清理不可达的嵌入回放加载分支。
- 修复玩家页攻击范围提示：敌方目标格与半径范围使用不同透明度区分，点击空地/友军/水域不再被静默吞掉，点击敌方单位前增加客户端所属校验，避免多余的服务端报错往返。
- 地图列表接口补充轻量预览几何字段（半径、地形格、据点、HQ 坐标），供前端卡片预览使用。

## 2.3.0

- 引擎统一支持类型化据点：`supply`、`forward_base`、`repair` 可分别配置收入、部署折扣和维修量；未写 `kind` 的旧地图继续走旧规则。
- 新增地图 `dual-lanes`（双线抉择），使用上下双线结构和平衡后的类型化据点数值；该图不提供免费初始单位，双方以 208 补给自行部署开局。
- 前端和回放支持类型化据点标签、据点详情、折扣部署费用，以及 `control_point_repair` 维修事件。
- AI 技能识别类型化据点：经济路线优先补给站、进攻路线利用前线基地、受伤单位可向维修站靠拢，裁决分仍只按据点数量评估。

## 2.2.2

- 将 V2 对局裁决上限从 20 回合缩短到 15 回合，并同步更新前端事件文案、结果展示和规则测试。
- 调整默认图与沙漠图的核心平衡：总部降至 180 HP / 6 防御，据点收入降为 12，并微调步兵、侦察兵、重装、游骑兵和支援单位数值。
- 前端据点详情改为读取地图配置中的据点收入，避免继续使用旧的硬编码收入默认值。
- 补充 V2 第 23 局回放记录和胜负双方复盘，用于对照 15 回合平衡调整前的实战表现。
- 重写 Hex API game skill 的定位：保留规则、API 和策略参考，但要求 AI 逐步读取状态、思考并调用 REST 操作，不再把 `skill/ai-player.mjs` 作为默认代打入口。

## 2.2.1

- 将自动对战控制台优化为双标签运维仪表盘，分离运行监控和配置管理。
- 强化控制台运行反馈：启动前自动保存配置、运行状态下禁用不适用操作，并新增配置未保存提示。
- 改进日志排错体验：新增日志搜索、等级筛选组合过滤、复制当前过滤结果，以及“自动滚动”开关。

## 2.2.0

- 新增自动对战控制台 `control.html`，支持在浏览器中配置双边 pi 会话、启动/暂停/恢复/停止自动对战，并查看实时日志。
- 新增控制 API `/api/control/*`，支持控制台配置持久化、手动指令发送、状态查询和日志 SSE 流；远程访问可通过 `AUTO_CONTROL_TOKEN` 保护。
- 新增服务端 `AutoControlController`，可在服务器内 bootstrap 对局、注入双方 token，并在回合结束事件后自动触发对应玩家行动。
- 新增 `script/autoRunPi.mjs` 与核心工具，支持基于观战事件轮询调度双边 pi、断点恢复、bootstrap 创建/加入对局和超时重试。

## 2.1.4

- 修复画布缩放或存在边框时，玩家页与观战/回放页鼠标悬停、选格和弹窗定位偏移的问题。
- 服务端在创建对局成功时输出 `gameId` 和 `playerAToken`，便于玩家 A 丢失 token 后从服务器日志恢复。
- 服务端在玩家 B 加入成功时输出 `gameId` 和 `playerBToken`，便于加入方丢失 token 后继续对局。

## 2.1.3

- 新增统一版本说明文件 `RELEASE_NOTES.md`。
- 整理所有 release 分支的主要改动，便于查看版本演进。
- 刷新 README，补充当前版本、回放记录、地图、AI 自动对战和版本说明入口。
- 前端展示版本与包版本同步到 `2.1.3`。

## 2.1.2

- 新增 `public/version.js`，集中管理前端版本号展示。
- `play.html` 与 `spectator.html` 统一引用版本脚本，减少页面内重复版本文本。
- 补充前端导入/导出与计分面板测试。

## 2.1.1

- 包版本升级到 `2.1.1`。
- 补充 AI 自动对战技能说明中的回合循环与等待逻辑。
- 更新相关测试期望，覆盖 AI 等待脚本说明。

## 2.1.0

- 增加 20 回合上限后的优势分裁决：总部伤害、己方总部血量、据点、军力价值、剩余补给共同决定胜负。
- 调整默认/沙漠地图与单位数值，降低总部耐久并平衡重装、游侠等单位。
- 前端新增裁决分展示、回放导出增强和相关 UI 样式。
- 补录 V2 第 15 局回放，并为历史记录补齐 `schemaVersion`。

## 2.0.0

- 将游戏重构为 V2 六边形据点战：尖顶六边形、轴坐标、多地图、地形与据点系统。
- 引入行动点上限、补给经济、据点部署、总部摧毁胜利等核心规则。
- 重做玩家页与观战页，增加回放、导出、玩家改名、设置弹窗、深色观战界面等体验。
- 增加 AI 自动对战技能与大量 V1/V2 对战记录。
- 加强安全与稳定性：配置校验、XSS 输入处理、SSE 鉴权/连接控制、事件深拷贝。

## 1.0.0

- 建立 Fastify + TypeScript + Vitest 项目基础。
- 实现游戏创建/加入、玩家鉴权、行动 API、事件轮询与 SSE。
- 实现单位生产、采矿收入、移动、攻击、治疗、回合结束和事件记录。
- 增加浏览器玩家页与观战页，支持地图点击、范围提示、回放时间线、动画、血条和导出。
- 调整早期平衡：地图缩小、矿点位置、出生方向、基础收入、兵营生产限制等。
