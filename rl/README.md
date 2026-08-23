# 强化学习最小版本

这个目录是一个只针对 `default` 双人顺序模式的训练起点：`player_a` 是 PPO
智能体，`player_b` 由随机合法动作策略控制。训练默认直接调用 TypeScript
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

训练结果会保存为 `rl/hex_ppo_random_opponent.zip`。

## 训练其他地图

本地基线通过 `RL_MAP_ID` 选择地图。例如训练 `dual-lanes`：

```powershell
$env:RL_MAP_ID = "dual-lanes"
$env:RL_TIMESTEPS = "100000"
python rl/train.py
```

默认模型会保存为 `rl/hex_ppo_dual-lanes_random_opponent.zip`，也可以指定路径：

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

这是用于验证环境和奖励设计的基线，不是最终强度版本。下一步应把随机对手换成
`skill/ai-player.mjs` 对应的规则策略，然后再加入自我对弈。
