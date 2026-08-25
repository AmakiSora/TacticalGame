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
hex_ppo_<地图名>_<对手类型>_<版本号>_<训练日期>_<步数>.zip
```

例如：

```text
rl/models/hex_ppo_default_rule_mixed_v2.1.1_20260825_500000.zip
```

版本号具体到三级（如 `v2.0.4`），默认值与 `rl/RELEASE_NOTES.md` 顶部条目一致，
变更训练环境时同步更新；也可用 `RL_MODEL_VERSION` 临时覆盖。v2.1 使用 `Discrete(54)` 动作空间，
不能加载 v2.0 或更旧模型；请从零训练一个新模型。可用 `$env:RL_OPPONENT_STYLE = "aggressive"`
等值固定对手风格，默认 `mixed` 每局随机选择。

如果 PowerShell 之前设置过旧的 `RL_LOAD_MODEL`，先清除它：

```powershell
Remove-Item Env:RL_LOAD_MODEL -ErrorAction SilentlyContinue
```

训练脚本还支持断点续训、checkpoint 和评估：

```powershell
$env:RL_LOAD_MODEL = "rl/models/hex_ppo_default_rule_mixed_v2.1.0_20260825_500000"
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

默认模型会保存为 `rl/models/hex_ppo_dual-lanes_rule_mixed_v2.1.0_<日期>_<步数>.zip`，也可以指定路径：

```powershell
$env:RL_MODEL_PATH = "rl/models/dual-lanes-ppo"
python rl/train.py
```

当前这套基线要求地图是“普通顺序模式”且支持 2 人布局。`standoff` 的同时回合
规则、`artillery-zone` 的歼灭/炮火规则，以及只支持 3/4/6 人的地图，需要单独
扩展环境，不能只改地图名。

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
