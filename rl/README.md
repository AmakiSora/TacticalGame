# 强化学习训练与部署

强化学习相关改动记录见 [rl/docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md)。以后修改训练环境、奖励、动作空间、模型部署或训练参数时，都要先在该文件顶部追加记录。

这个目录提供标准双人顺序模式的 PPO 训练环境：训练直接调用 TypeScript
引擎，不需要启动 HTTP 游戏服务器。v3.0 默认使用 6715 维观测（含候选描述）、155 个分层动作、
Transformer 棋盘编码器、混合地图、后台配对评估和蒸馏冷启动；旧模型继续通过版本快照运行。

## 目录结构

| 目录 | 职责 |
| --- | --- |
| `rl/envs/` | 训练环境。`env.py` 是当前版本（v3.0）；`env_vNN.py` 是各历史迭代的**不可变快照**，只服务于旧模型的观测编码，不得修改 |
| `rl/runners/` | 推理入口。`run_model.py` 对应当前环境；`run_model_vNN.py` 与同名 env 快照配对，由 `src/api/bots.ts` 按动作空间路由 |
| `rl/training/` | 训练与数据管线：`train.py`（PPO 主循环）、`distill.py`（老师采样/蒸馏冷启动）、`local_env.py` + `local-worker.ts`（进程内调用 TS 引擎）、`extractors.py`（网络结构）、`eval_worker.py`（后台配对评估） |
| `rl/evaluation/` | 离线评估：`evaluate_cross.py`（跨版本对战）、`round_robin.py`（循环赛） |
| `rl/docs/` | `RELEASE_NOTES.md`（改动记录，必读）、`MODELS_NOTES.md`（模型档案） |
| `rl/models/`、`rl/checkpoints/`、`rl/tb/`、`rl/selfplay/`、`rl/distill/`、`rl/leaderboard/` | 训练产物（模型 zip、断点、TensorBoard 日志、自对弈快照、蒸馏数据、榜单），均已 gitignore |
| `rl/test-output/` | 本地实验区：`scripts/`（一次性诊断与评估脚本）、`launchers/`（.bat 训练配方）、`logs/`、`stats/`、`models/`、`checkpoints/`，已 gitignore |

根目录只保留 `README.md` 与 `requirements.txt`。

### 导入约定

各子目录内的模块**仍用扁平名相互导入**（如 `from env_v22 import HexGameEnv`），不写 `rl.envs.` 前缀。为兼容这一点，每个可执行入口都在文件头部把四个代码目录挂上 `sys.path`：

```python
_RL_ROOT = Path(__file__).resolve().parent.parent
for _sub in ("envs", "runners", "training", "evaluation"):
    _p = str(_RL_ROOT / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)
```

新增入口脚本时必须带上这段 bootstrap，否则扁平导入会失败。`python -m rl.xxx` 的包模式则由 `try/except ImportError` 回退分支覆盖（回退路径要写全，如 `rl.envs.env_v22`）。

另外，子目录内的脚本推导项目根需上溯**三**级（`Path(__file__).resolve().parent.parent.parent`），因为它们位于 `rl/<子目录>/` 而非 `rl/`。

## 安装

```powershell
python -m pip install -r rl/requirements.txt
```

训练环境的 Python 单元测试（动作空间/掩码/候选一致性/v2.7 映射）：

```powershell
npm run test:rl        # 等价于 rl/.venv/Scripts/python.exe -m pytest tests/rl -q
```

## 安装项目依赖

在项目根目录运行：

```powershell
npm install
```

`npm run dev` 只用于打开网页或测试 REST 版环境；直接训练时不需要保持服务器运行。

## 运行训练

```powershell
python rl/training/train.py
```

2.1.4 训练默认会加载旧的 v2.0.0 模型作为部分对手，建议先用 800000 步：

```powershell
$env:RL_MODEL_VERSION = "v2.1.4"
$env:RL_TIMESTEPS = "800000"
$env:RL_MODEL_OPPONENT_PROB = "0.5"
python rl/training/train.py
```

想先做一个快速冒烟测试，可以把步数临时调小：

```powershell
$env:RL_TIMESTEPS = "16"
python rl/training/train.py
```

正式训练建议至少 500000 步；默认值已经是 500000，可以按电脑速度调整。

## GPU 训练

训练脚本默认使用 `RL_DEVICE=auto`：如果 PyTorch 检测到 CUDA 就用 GPU，否则使用 CPU。
也可以强制指定：

```powershell
$env:RL_DEVICE = "cuda"  # 或 cpu / auto
python rl/training/train.py
```

先检查当前环境：

```powershell
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"
```

如果 `torch.cuda.is_available()` 是 `False`，说明当前安装的是 CPU 版 PyTorch。以
NVIDIA 显卡为例，需要按 PyTorch 官网对应版本安装 CUDA wheel，例如：

```powershell
python -m pip uninstall torch -y
python -m pip install torch --index-url https://download.pytorch.org/whl/cu128
```

安装后重新检查，训练日志应显示 `device=cuda` 和 `Using cuda device`。不过当前单环境
训练的主要瓶颈是 TypeScript 游戏模拟，不是神经网络；GPU 能加速 PPO 更新，但要明显
提速还需要并行多个训练环境。

新环境训练结果默认按以下格式命名：

```text
hex_ppo_<版本号>_<训练日期>_<地图名>_<对手类型>_<步数>.zip
```

例如：

```text
rl/models/hex_ppo_v2.1.4_20260826_default_modelmix_800000.zip
```

版本号具体到三级（如 `v2.0.4`），默认值与 `rl/docs/RELEASE_NOTES.md` 顶部条目一致，
变更训练环境时同步更新；也可用 `RL_MODEL_VERSION` 临时覆盖。v2.1 使用 `Discrete(54)` 动作空间，
不能加载 v2.0 或更旧模型；请从零训练一个新模型。可用 `$env:RL_OPPONENT_STYLE = "aggressive"`
等值固定对手风格，默认 `mixed` 每局随机选择。

2.1.4 默认会自动寻找 v2.0.0 模型作为模型对手。也可以指定路径和比例：

```powershell
$env:RL_OPPONENT_MODEL = "rl/models/hex_ppo_default_rule_v2.0.0_20260824_500000.zip"
$env:RL_MODEL_OPPONENT_PROB = "0.5"
```

如果 PowerShell 之前设置过旧的 `RL_LOAD_MODEL`，先清除它：

```powershell
Remove-Item Env:RL_LOAD_MODEL -ErrorAction SilentlyContinue
```

训练脚本还支持断点续训、checkpoint 和评估：

```powershell
$env:RL_LOAD_MODEL = "rl/models/hex_ppo_v2.1.0_20260825_default_rule_mixed_500000"
$env:RL_TIMESTEPS = "50000"          # 续训增加 50000 步
$env:RL_SAVE_FREQ = "20000"           # 每 20000 步保存 checkpoint
$env:RL_EVAL_FREQ = "10000"           # 每 10000 步评估
$env:RL_EVAL_EPISODES = "8"
python rl/training/train.py
```

设置 `$env:RL_LOAD_MODEL = "latest"` 会自动加载该地图最近生成的 v2 模型，并把续训结果
保存为新命名的文件；`auto` 只检查当前 `RL_MODEL_PATH`。默认不会覆盖已有模型，若确实
要覆盖，显式设置 `$env:RL_ALLOW_OVERWRITE = "1"`。
评估最优模型保存在 `rl/checkpoints/<map>/best/best_model.zip`。TensorBoard 是可选的：

```powershell
python -m pip install tensorboard
tensorboard --logdir rl/tb
```

## 训练其他地图

本地基线通过 `RL_MAP_ID` 选择地图。例如训练 `dual-lanes`：

```powershell
$env:RL_MAP_ID = "dual-lanes"
$env:RL_TIMESTEPS = "100000"
python rl/training/train.py
```

默认模型会保存为 `rl/models/hex_ppo_v2.1.0_<日期>_dual-lanes_rule_mixed_<步数>.zip`，也可以指定路径：

```powershell
$env:RL_MODEL_PATH = "rl/models/dual-lanes-ppo"
python rl/training/train.py
```

当前这套基线要求地图是“普通顺序模式”且支持 2 人布局。`standoff` 的同时回合
规则、`artillery-zone` 的殱灭/炮火规则，以及只支持 3/4/6 人的地图，需要单独
扩展环境，不能只改地图名。

## 训练随机地图（v2.3）

训练环境（`env.py` / `local_env.py`）已接入游戏侧的随机地图生成器：每局由引擎现生成一张
**对称随机图**（半径 6–10，地形/复活点/据点/回合数/行动点/兵种数值/经济与总部全部随机，
连通性由服务端硬保证）。用于训练泛化能力，防止过拟合固定地图布局：

```powershell
$env:RL_MAP_ID = "random"
$env:RL_TIMESTEPS = "800000"
python rl/training/train.py
```

- 观测为 v2.3 编码（331 格标准定序 × 18 特征 + 16 全局 = 5,974 维），**与所有旧模型不兼容**，
  必须从零训练；模型命名 `hex_ppo_v2.3.0_<日期>_random_modelmix_<步数>.zip`。
- 每局地图种子从环境随机源派生，`env.reset(seed=...)` 可复现整条训练序列。
- 随机域可用 `RL_RANDOM_OPTIONS`（JSON）覆盖，例如固定半径与回合数：
  `$env:RL_RANDOM_OPTIONS = '{"radius": 8, "maxTurns": 15}'`。
- 随机地图上 v2.0.0 模型对手属分布外，默认只用规则对手；需要时用 `$env:RL_MODEL_OPPONENT_PROB = "0.5"` 显式开启。
- 静态地图训练行为不变（`RL_MAP_ID=default` 等）。

## 并行训练（RL_NUM_ENVS）

训练吞吐的瓶颈是 TypeScript 引擎模拟（单进程单线程）。`RL_NUM_ENVS` 用 `SubprocVecEnv`
并行多个训练环境，每个环境一个独立的引擎 worker 进程，样本吞吐成倍提升；GPU 负责 PPO 更新：

```powershell
$env:RL_MAP_ID = "random"
$env:RL_NUM_ENVS = "8"     # v2.8 默认 8；6 物理核机器实测 4→170 fps、8→238 fps
python rl/training/train.py
```

注意：并行下 `RL_TIMESTEPS` 仍是总帧数（跨环境累计），同一目标步数的墙钟时间约为单环境的 1/N；
每轮 rollout 收集 `n_steps × RL_NUM_ENVS` 帧，v2.8 默认 `RL_N_STEPS=512`、`RL_BATCH_SIZE=256`。

## 训练管线（v2.8.0）

v2.8 不改观测/动作/奖励语义（v2.7 断点可续训），只让训练更快、更稳：

- **后台评估** `RL_EVAL_MODE=async`（默认）：每 `RL_EVAL_FREQ`（v3.0.2 起默认 **100000**，原 50000）步把当前策略交给
  `rl/training/eval_worker.py` 子进程跑 3 个场景 × `RL_EVAL_EPISODES`（v3.0.2 起默认 **96**，原 48）局配对换座，训练不停。
  总评估开销不变（同样每步 0.96 局），但单次决策的抽样噪声减半：48 局胜率标准差约 ±23pt，
  实测 `default_champion` 在 14 次评估中出现过 27%~79%。
  上一次评估未完时本次跳过并记日志。`RL_EVAL_MODE=inline` 回到 v2.7 的主进程串行评估。
- **best 断点按 Wilson 下界选**：选择键 (最弱场景 95% 下界, **后手座合并下界**, 平均下界, 占点, 回报)。
  原始胜率噪声太大；后手座进第二位是因为 v3.0.1 实测 350k 与 480k 断点总分同为噪声内
  （49:47 vs 50:46）而后手座差 10pt（39.6% vs 50.0%），只看总分会挑中座位严重不对称的断点。
- **PPO 稳定性**：`RL_TARGET_KL`（默认 0.02，设 `off` 关闭）提前截断 KL 超标的更新轮次；续训时 n_steps/batch/target_kl 都以本次环境变量为准。
- **PFSP 自对弈采样**：快照对手按 (1 − 智能体对其胜率)² 加权抽取，输得多的多打；锚点仍按 `RL_ANCHOR_PROB` 固定出场。
- **对手随机采样** `RL_OPPONENT_STOCHASTIC_PROB`（默认 0.3）：该比例的模型对手局按策略分布采样动作，防止只学会针对贪心走法。
- **引擎往返减半**：`local_env.py` 复用 `apply`/`reset` 回传的快照，不再每步多发 `state`；worker `reset` 支持 `eventTail: 0` 省掉事件序列化。

## v3.0：分层动作、结构化编码器与蒸馏冷启动

v3.0 把 v2.x 写死在规则里的“去哪、打谁”交给策略，并换掉纯 MLP：

- **动作 `Discrete(155)`**：每单位槽 7 个移动候选（趋近目标格 + 六方向最远格）、3 个攻击候选（启发式 / 最低血 / 最高攻）、
  治疗、特殊；部署每兵种 2 个落点（贴敌总部 / 贴无主据点）。重复候选被掩码屏蔽。
- **观测 6715 维**：前 6205 维同 v2.7，尾部 510 维描述每个候选（坐标、到据点距离、目标血量/攻击、是否总部）。
- **编码器** `RL_EXTRACTOR=hex_transformer`（默认，`RL_TF_LAYERS`/`RL_TF_DIM` 调深宽）或 `mlp`（v2.4 同构，对照用）。
- **奖励**：胜负 ±5、塑形 ×0.5、无固定动作加分（`RL_REWARD_WIN` / `RL_REWARD_SHAPING_SCALE` / `RL_REWARD_*_BONUS`）。
- **冷启动**：不能加载任何 v2 权重，改用 v2.7.0 老师蒸馏：

```powershell
rl/.venv/Scripts/python.exe rl/training/distill.py collect --teacher rl/models/hex_ppo_v2.7.0_20260901_random_selfplay_4000000.zip --games 400
rl/.venv/Scripts/python.exe rl/training/distill.py train --out rl/models/hex_ppo_v3.0.0_<日期>_distilled
$env:RL_MAP_ID = "random"; $env:RL_LOAD_MODEL = "rl/models/hex_ppo_v3.0.0_<日期>_distilled.zip"; $env:RL_TIMESTEPS = "3000000"
rl/.venv/Scripts/python.exe rl/training/train.py
```

老师的 54 动作与 v3.0 每槽的候选 0 一一对应（`env.map_v27_action`），因此 v2.7/v2.8 模型可以直接当自对弈锚点；
`RL_ANCHOR_MODEL` 未设时默认取最新 v2.7 模型。完整流程见 `rl/test-output/launchers/run_train_v301.bat`。

**蒸馏的价值头必须与 PPO 同尺度。** `distill.py` 在【未缩放】回报上训练价值头，结束时打印保留集 RMSE
与回报 std；RMSE 必须远小于 std 才能续训。v3.0.0 曾把目标除以 std，交付断点的 std(V)/std(return) 只有 0.16，
PPO 首轮 GAE 拿到系统性错误的优势估计，把克隆策略的胜率从 74% 打到 11%、两百万帧后才爬回来。
续训架构以断点内保存的 `policy_kwargs` 为准，此时 `RL_EXTRACTOR`/`RL_TF_LAYERS`/`RL_NET_WIDTH` 不再生效
（要换编码器必须重新蒸馏）；PPO 阶段建议初始学习率 5e-5 保护克隆策略。

### v3.0.2：打破蒸馏造成的探索死锁

v3.0.1 训练中断后做离线探针（`rl/test-output/scripts/probe_action_dist.py`）发现：新增候选**几乎从未被使用**。

| 断点 | move 候选 1-6 合法时选用率 | attack 候选 1-2 | deploy 候选 1 | 实测策略熵 |
|---|---|---|---|---|
| v3.0.1 蒸馏断点（PPO 前） | **0.00%** | 0.00% | 0.00% | 0.943 nats |
| v3.0.1 35 万步 best | 0.15%（候选 5/6 各 2 次） | 0.00% | 0.00% | 1.149 nats |
| v3.0.1 64 万步 | **0.00%** | 0.00% | 1.05%（1 次） | 0.854 nats |

平均合法动作 25-28 个，均匀分布熵应为 3.2-3.3 nats；而且 64 万步的熵比 35 万步**更低**，训练在持续压缩策略。
结论：**155 动作空间在行为上退化回 54 动作**，模型本质是 v2.7.0 的克隆——这解释了 v2.8/v3.0.0/v3.0.1
三代为何都只能与老师打平（43:53 / 51:45 / 49:47）。

死锁机制：蒸馏标签全部来自老师（54 动作经 `map_v27_action` → v3.0 候选 0），纯交叉熵把其余 101 个新动作
的 logit 反复下压；而 PPO 的策略梯度只对**采样到的**动作有信号，概率≈0 → 采样不到 → 无梯度 → 永远为 0。
`ent_coef=0.01` 的熵正则量级拉不动 12 轮克隆形成的 logit 差距。

三处修复：

- **掩码标签平滑** `rl/training/distill.py train --label-smoothing 0.15`（默认）：目标分布 = 0.85·老师动作 + 0.15·合法动作上的均匀分布，
  新候选在 PPO 起点就保留可采样的概率质量。蒸馏轮数同时由 12 降到 8 弱化克隆强度。
  ⚠️ **不能**用 `F.cross_entropy(..., label_smoothing=eps)`：它把 eps 均分给全部 155 类（含被
  `masked_fill(-1e9)` 的非法类），`log(≈0)` 量级的项会让 loss 直接爆炸；必须在合法集内手工构造目标分布。
- **熵系数**：v3.0.2 配方用 `RL_ENT_COEF=0.03`（原 0.01）。默认值未改，由启动脚本显式设定。
- **探索监控** `ActionDiversityCallback`：每 `RL_EXPLORE_LOG_EVERY`（默认 20000）帧把 `explore/new_candidate_rate`
  （候选序号 ≥1 的合法时选用率）、分意图选用率、`explore/legal_actions_mean` 写入 TB 并打印。
  该读数持续为 0 说明参数仍不足以打破死锁，应立即止损调参而不是白烧几小时。

验证标签平滑是否生效要看**概率质量**而不是动作分布：确定性 argmax 下即使新候选已有 15% 概率也照样选候选 0，
只看动作分布会误判为“没改善”。`probe_action_dist.py` 因此打印「新候选概率质量均值」（eps=0.15 期望 ≈10%-15%）。

`env.py` 新增公共函数 `classify_action(index) -> (意图, 候选序号)`，供训练回调与离线探针共用。
观测/动作/奖励语义未变，**无需新快照，`bots.ts` 路由不变**（仍是 155 动作 → `run_model.py`）。
完整配方见 `rl/test-output/launchers/run_train_v302.bat`。

## 自对弈（RL_SELF_PLAY_PROB）

随机地图训练默认 60% 的局让智能体打自己的历史策略快照（对手强度随训练一起提升），其余局打 mixed 规则对手；
静态地图默认关闭（`RL_SELF_PLAY_PROB=0`）。

```powershell
$env:RL_MAP_ID = "random"
$env:RL_SELF_PLAY_PROB = "0.6"   # 默认值；设 0 关闭自对弈回到纯规则对手训练
python rl/training/train.py
```

机制：训练每 `RL_SNAPSHOT_FREQ`（默认 5000 次回调）存一个快照到 `RL_SNAPSHOT_DIR`（默认 `rl/selfplay/<地图>/<模型版本>`，按版本隔离），
只保留最近 `RL_SNAPSHOT_KEEP`（默认 20）个；环境每局从最近 16 个快照（按保存时间）里选一个当对手，
v2.7 均匀采样，v2.8 起改为 PFSP 按输给谁最多加权（见上节）。
训练初期目录为空时自动用规则对手；快照损坏/被清理时当局降级为 mixed 规则。
评估环境始终只用规则对手，保证训练期胜率与历史模型可比。
自 v2.3.3 起支持锚点对手 `RL_ANCHOR_MODEL`（常驻强基准，防策略漂移；续训时默认为被续训的模型自身）；
v2.7 起锚点按 `RL_ANCHOR_PROB`（默认 40%）在自对弈局中固定出场，早期无快照时直接当老师。
学习率从 `RL_LEARNING_RATE` 线性衰减到 `RL_LR_END`（默认 3e-4→3e-5）。

## 网络容量（RL_NET_WIDTH，v2.4.0）

策略/价值网络宽度可配，默认 256（此前固定默认 64）。6024 维观测压进 64 宽是信息瓶颈，
256×256 参数量约 320 万。仅对从零训练生效，续训以模型内保存的架构为准；
不同宽度的断点互不兼容。大网络建议配套 `RL_N_STEPS=512`、`RL_BATCH_SIZE=256`、`RL_SNAPSHOT_FREQ=10`。

## 对手动作历史（v2.5.0，已在 v2.6 回退）

曾在观测尾部追加 50 维对手上一回合动作历史（共 6024 维）：
6 个动作槽 × 8 维（类型 one-hot + 目标位置/10 + 强度归一化）+ 2 维汇总（动作数、总伤害）。
数据源是对局事件日志（`state.events`）：REST 响应与本地训练 worker 同源，
回合边界取最近一条 previousOwner == 己方的 turn_end；编码只依赖 owner/opponent，
相对视角在换座与自对弈对手场景自动生效。
**经真换边 24 局复测确认无提升（9:15 败于 v2.4.0），v2.6 已回退观测到 5974 维；
该环境固化在 `env_v25.py` 快照（服务存量 v2.5 模型）**。

## 对手生态加压（v2.6.0）

观测回退 5974 维（同 v2.3/v2.4 编码），棋力提升改从对手生态入手：
自对弈比例默认 85%（`RL_SELF_PLAY_PROB`），快照采样近期加权（几何权重），
锚点按 `RL_ANCHOR_PROB`（默认 15%）固定出场。配套建议：步数 400 万、锚点选上一代最强模型。
静态地图维持纯验证集，不混入训练分布（明确决策）。

## 在真实对局中使用模型

先启动服务器并创建/加入一局游戏，拿到该座位的 player token。然后运行：

```powershell
python rl/runners/run_model.py `
  --url http://127.0.0.1:3100 `
  --game <gameId> `
  --token <playerToken> `
  --side player_a
```

模型会等待轮到自己的回合，自动执行动作，直到游戏结束。只测试一次动作：

```powershell
python rl/runners/run_model.py --game <gameId> --token <playerToken> --once
```

这是 v2 训练环境：规则对手会优先攻击、治疗、部署和靠近据点。它仍不是最终强度
版本，后续可以再加入自我对弈和更复杂的战术目标。

## 版本兼容策略

环境每次迭代都会改变动作空间或观测语义（v1=512，v2.0.0=38，v2.1–v2.8=54，v3.0=155；v2.3/v2.4/v2.6=5974 维，v2.5=6024 维，v2.7/v2.8=6205 维，v3.0=6715 维），但历史模型必须始终可玩：

- `rl/envs/env_v100.py` 保存 v1 随机对手模型时期的 env.py 快照，
  `rl/runners/run_model_v100.py` 专门运行 512 动作模型。

- `rl/envs/env_v200.py` 保存 v2.0.0 时期 env.py 的原样快照（编码/合法动作逻辑），
  请勿按新版本逻辑修改它。
- `rl/envs/env_v22.py` 保存 v2.2.1 时期 env.py 的快照（54 动作 / 3922 维观测），
  `rl/runners/run_model_v22.py` 承载全部 v2.1.x/v2.2.x 模型；它同时作为新版训练时旧模型对手的观测降级编码器。
- `rl/envs/env_v24.py` 保存 v2.4.x 时期 env.py 的快照（54 动作 / 5974 维观测）；`rl/envs/env_v26.py` 为 v2.6 兼容别名，
  `rl/runners/run_model_v24.py` 承载全部 v2.3.x/v2.4.x 模型。
- `rl/envs/env_v25.py` 保存 v2.5.x 时期 env.py 的快照（54 动作 / 6024 维观测，对手动作历史），
  `rl/runners/run_model_v25.py` 承载 v2.5.x 模型。
- `rl/envs/env_v27.py` 保存 v2.7/v2.8 时期 env.py 的快照（54 动作 / 6205 维观测），
  `rl/runners/run_model_v27.py` 承载全部 v2.7.x/v2.8.x 模型；它同时是 v3.0 训练时老师/锚点的编码器。
- `src/api/bots.ts` 的路由：155 → `run_model.py`（当前 v3.0 环境），38 → `run_model_v200.py`，512 → `run_model_v100.py`；
  54 动作按文件名版本五代分流：≥ v2.7 → `run_model_v27.py`（6205 维快照），v2.6 → `run_model_v26.py`,
  v2.5 → `run_model_v25.py`（6024 维快照），v2.3/v2.4 → `run_model_v24.py`（5974 维快照），
  其余 → `run_model_v22.py`（3922 维快照）。
  环境出新版时：先复制一份旧环境为不可变快照、实现对应运行器，再在注册表里加一行；
  旧条目不得改写。若新版本沿用相同动作数但改变编码语义（如 v2.3），也必须使用独立运行器，
  不要复用旧动作空间条目。
- 前端下拉列表只展示已识别且有快照运行器的模型，并带版本标签；无法识别的模型会被服务端拒绝。
- 在随机地图上评估模型：`rl/evaluation/evaluate_cross.py --map random --swap-sides`；每两局共享同一地图种子并交换座位，`--seed-prefix` 可隔离不同批次。
- **评估协议（v2.5.0 验收教训固化）**：确定性策略互打方差极高，单次 8 局无统计意义（同配置复测可在 6:2↔4:4 摆动）；
  某些地图还有系统性座位效应（default 上随机图世代模型先手全崩）。验收必须：
  初筛累计 ≥24 局；正式晋级建议 ≥96 局（用 `--stats-file` 跨运行累积），并检查总体与分座位 95% Wilson 区间。

注意：v2.0.0 观测按固定 player_a 视角编码（当时实现），旧模型坐 player_b
属于训练分布之外，强度会失真但仍可正常对局（运行器会打印警告）。

## 跨版本模型对战（离线评估）

`rl/evaluation/evaluate_cross.py` 让两代模型在进程内引擎上互打（无需游戏服务器），
每个座位使用其训练时期的编码与合法动作逻辑：

```powershell
rl/.venv/Scripts/python.exe rl/evaluation/evaluate_cross.py `
  --model-a rl/models/hex_ppo_v2.0.0_20260824_default_rule_500000.zip `
  --model-b rl/models/hex_ppo_v2.1.1_20260825_default_rule_mixed_500000.zip `
  --games 4
```

常用参数：`--games` 对局数；`--stochastic` 按策略采样（默认确定性）；`--max-rounds`
单局回合上限（超过记平局）；`--verbose` 打印每步动作；`--stats-file <路径>` 把每局结果追加到
JSONL 并输出跨运行累计的分座位统计（同一模型对与地图的记录自动合并，验收用）。

注意：v2.0.0 的观测按固定 player_a 视角编码，因此旧模型固定坐 player_a；
`--swap-sides` 每局交换座位，但交换后旧模型处于训练分布之外，结果会失真。

## 批量对战与排行榜

`rl/evaluation/round_robin.py` 自动发现 `rl/models/` 下全部可对战模型（排除 v1.0.0 的 512 动作格式），
两两 × 全地图批量对战，结果累积写入 `rl/leaderboard/matches.jsonl`：

```powershell
# 先小规模冒烟（只跑 default 图、3 个模型、每对 2 局）
rl/.venv/Scripts/python.exe rl/evaluation/round_robin.py --maps default --models v2.7.0,v2.4.0,v2.2.0 --games 2

# 全量跑批（120 对 × 7 图 × 24 局 ≈ 2 万局，建议先跑随机图约 3 小时出第一版榜单）
rl/.venv/Scripts/python.exe rl/evaluation/round_robin.py --maps random
rl/.venv/Scripts/python.exe rl/evaluation/round_robin.py --maps default,breach,danger-close,desert,dual-lanes,forge
```

要点：

- **断点续跑**：启动时统计 JSONL 里已有局数，`need = 目标 − 已有`（取偶保证换座对称），
  已跑对局不重复浪费；同命令重跑全部 skip。随机图重跑会通过新 `--salt` 生成全新地图。
- **并行**：`--jobs N` 并发多个 evaluate_cross 子进程（每个独立加载模型，显存/内存有限时保持 1）。
- **评分**：跑完执行 `npm run rl-leaderboard`（已并入 `stats-all`），
  从 JSONL 生成 `public/data/rl-leaderboard.json`，页面 `/leaderboard.html` 展示。
- **评分协议**：Bradley-Terry MLE（MM 迭代，平局记 0.5，已交手对附加 1 局虚拟平局先验防发散），
  Elo 映射 `1500 + 400/ln10 × ln p`；95% CI 为按（对,图）分层 bootstrap（固定种子可复现）；
  小样本另附 Wilson 下界参考列。先手/后手只做展示统计，不进评分。
  各地图独立出分图榜单（局数少，CI 更宽）。
