# HexZero v5.0.0

独立的 Expert Iteration + Gumbel/PUCT + 分层优先回放实现。v5 只支持双人
standard，使用真实 TypeScript 规则引擎的隔离分支；旧的 `rl/envs`、`rl/training`
和 v4 runner 不会被导入或修改。

```powershell
rl/.venv/Scripts/python.exe -m rl.v5.train_v5 --config rl/v5/configs/s0.json --run-id s0
```

上面的命令只写清单和 schema，不训练。以后明确加 `--execute --steps N` 才会创建
checkpoint/replay。产物默认写入已忽略的 `rl/test-output/v5/`。真实评估必须显式提供
`--checkpoint`，并记录配对种子；没有 v5 checkpoint 不会伪装成评估结果。
