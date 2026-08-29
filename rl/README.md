# 强化学习最小版本

强化学习相关改动记录见 [rl/RELEASE_NOTES.md](RELEASE_NOTES.md)。以后修改训练环境、奖励、动作空间、模型部署或训练参数时，都要先在该文件顶部追加记录。

这个目录是一个只针对 `default` 双人顺序模式的训练起点：`player_a` 是 PPO
智能体，`player_b` 由一个简单的规则 AI 控制。训练默认直接调用 TypeScript
引擎，不需要启动 HTTP 游戏服务器。

## 安装

```powershell
python -m pip install -r rl/requirements.txt
```

## 安装项目依赖

在项目根目录运行：

```powershell
npm install
```

`npm run dev` 只用于打开网页或测试 REST 版环境；直接训练时不需要保持服务器运行。

## 运行训练

```powershell
python rl/train.py
```

2.1.4 训练默认会加载旧的 v2.0.0 模型作为部分对手，建议先用 800000 步：

```powershell
$env:RL_MODEL_VERSION = "v2.1.4"
$env:RL_TIMESTEPS = "800000"
$env:RL_MODEL_OPPONENT_PROB = "0.5"
python rl/train.py
```

想先做一个快速冒烟测试，可以把步数临时调小：

```powershell
$env:RL_TIMESTEPS = "16"
python rl/train.py
```

正式训练建议至少 500000 步；默认值已经是 500000，可以按电脑速度调整。

## GPU 训练

训练脚本默认使用 `RL_DEVICE=auto`：如果 PyTorch 检测到 CUDA 就用 GPU，否则使用 CPU。
也可以强制指定：

```powershell
$env:RL_DEVICE = "cuda"  # 或 cpu / auto
python rl/train.py
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

版本号具体到三级（如 `v2.0.4`），默认值与 `rl/RELEASE_NOTES.md` 顶部条目一致，
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
python rl/train.py
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
python rl/train.py
```

默认模型会保存为 `rl/models/hex_ppo_v2.1.0_<日期>_dual-lanes_rule_mixed_<步数>.zip`，也可以指定路径：

```powershell
$env:RL_MODEL_PATH = "rl/models/dual-lanes-ppo"
python rl/train.py
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
python rl/train.py
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
$env:RL_NUM_ENVS = "4"     # 默认 4；建议不超过物理核数，留余量给系统与引擎启动
python rl/train.py
```

注意：并行下 `RL_TIMESTEPS` 仍是总帧数（跨环境累计），同一目标步数的墙钟时间约为单环境的 1/N；
每轮 rollout 收集 `n_steps × RL_NUM_ENVS` 帧，默认 `RL_N_STEPS=256`、`RL_BATCH_SIZE=64` 对任意环境数都整除。

## 自对弈（RL_SELF_PLAY_PROB，v2.3.2）

随机地图训练默认 60% 的局让智能体打自己的历史策略快照（对手强度随训练一起提升），其余局打 mixed 规则对手；
静态地图默认关闭（`RL_SELF_PLAY_PROB=0`）。

```powershell
$env:RL_MAP_ID = "random"
$env:RL_SELF_PLAY_PROB = "0.6"   # 默认值；设 0 关闭自对弈回到纯规则对手训练
python rl/train.py
```

机制：训练每 `RL_SNAPSHOT_FREQ`（默认 5000 次回调）存一个快照到 `RL_SNAPSHOT_DIR`（默认 `rl/selfplay/<地图>`），
只保留最近 `RL_SNAPSHOT_KEEP`（默认 20）个；环境每局从最近 8 个快照里随机选一个当对手。
训练初期目录为空时自动用规则对手；快照损坏/被清理时当局降级为 mixed 规则。
评估环境始终只用规则对手，保证训练期胜率与历史模型可比。

## 在真实对局中使用模型

先启动服务器并创建/加入一局游戏，拿到该座位的 player token。然后运行：

```powershell
python rl/run_model.py `
  --url http://127.0.0.1:3100 `
  --game <gameId> `
  --token <playerToken> `
  --side player_a
```

模型会等待轮到自己的回合，自动执行动作，直到游戏结束。只测试一次动作：

```powershell
python rl/run_model.py --game <gameId> --token <playerToken> --once
```

这是 v2 训练环境：规则对手会优先攻击、治疗、部署和靠近据点。它仍不是最终强度
版本，后续可以再加入自我对弈和更复杂的战术目标。

## 版本兼容策略

环境每次迭代都会改变动作空间或观测语义（v1=512，v2.0.0=38，v2.1=54；v2.3 仍 54 动作但观测扩为 5974 维），但历史模型必须始终可玩：

- `rl/env_v100.py` 保存 v1 随机对手模型时期的 env.py 快照，
  `rl/run_model_v100.py` 专门运行 512 动作模型。

- `rl/env_v200.py` 保存 v2.0.0 时期 env.py 的原样快照（编码/合法动作逻辑），
  请勿按新版本逻辑修改它。
- `rl/env_v22.py` 保存 v2.2.1 时期 env.py 的快照（54 动作 / 3922 维观测），
  `rl/run_model_v22.py` 承载全部 v2.1.x/v2.2.x 模型；它同时作为 v2.3 训练时旧模型对手的观测降级编码器。
- `src/api/bots.ts` 的路由：38 → `run_model_v200.py`，512 → `run_model_v100.py`；
  54 动作按文件名版本分流：≥ v2.3 → `run_model.py`（当前 5974 维环境），
  否则 → `run_model_v22.py`（3922 维快照）。
  环境出新版时：先复制一份旧环境为不可变快照、实现对应运行器，再在注册表里加一行；
  旧条目不得改写。若新版本沿用相同动作数但改变编码语义（如 v2.3），也必须使用独立运行器，
  不要复用旧动作空间条目。
- 前端下拉列表只展示已识别且有快照运行器的模型，并带版本标签；无法识别的模型会被服务端拒绝。
- 在随机地图上评估模型：`rl/evaluate_cross.py --map random`（每局一张对称随机图，种子 `cross-<局序>` 可复现）。

注意：v2.0.0 观测按固定 player_a 视角编码（当时实现），旧模型坐 player_b
属于训练分布之外，强度会失真但仍可正常对局（运行器会打印警告）。

## 跨版本模型对战（离线评估）

`rl/evaluate_cross.py` 让两代模型在进程内引擎上互打（无需游戏服务器），
每个座位使用其训练时期的编码与合法动作逻辑：

```powershell
rl/.venv/Scripts/python.exe rl/evaluate_cross.py `
  --model-a rl/models/hex_ppo_v2.0.0_20260824_default_rule_500000.zip `
  --model-b rl/models/hex_ppo_v2.1.1_20260825_default_rule_mixed_500000.zip `
  --games 4
```

常用参数：`--games` 对局数；`--stochastic` 按策略采样（默认确定性）；`--max-rounds`
单局回合上限（超过记平局）；`--verbose` 打印每步动作。

注意：v2.0.0 的观测按固定 player_a 视角编码，因此旧模型固定坐 player_a；
`--swap-sides` 每局交换座位，但交换后旧模型处于训练分布之外，结果会失真。
