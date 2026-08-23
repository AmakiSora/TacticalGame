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

新环境训练结果默认会保存为 `rl/hex_ppo_v2_default_rule_opponent.zip`。

这是 v2 动作空间，不能加载旧的 `hex_ppo_default_random_opponent.zip`；请从零训练
一个新模型。

训练脚本还支持断点续训、checkpoint 和评估：

```powershell
$env:RL_LOAD_MODEL = "rl/hex_ppo_v2_default_rule_opponent"
$env:RL_TIMESTEPS = "50000"          # 续训增加 50000 步
$env:RL_SAVE_FREQ = "20000"           # 每 20000 步保存 checkpoint
$env:RL_EVAL_FREQ = "10000"           # 每 10000 步评估
$env:RL_EVAL_EPISODES = "8"
python rl/train.py
```

设置 `$env:RL_LOAD_MODEL = "auto"` 时，如果最终模型存在就自动续训，否则从零开始。
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

默认模型会保存为 `rl/hex_ppo_v2_dual-lanes_rule_opponent.zip`，也可以指定路径：

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
