# 统计与数据看板

统计页与娱乐数据页都是纯静态页面，分别读取 `public/data/stats.json` 与 `public/data/fun-stats.json`，不访问对局 API。数据由脚本扫描 `records/V2` 与 `records/V3` 回放生成：

```bash
npm run stats
# 等价于 node script/generateStats.mjs

npm run fun-stats
# 等价于 node script/generateFunStats.mjs

npm run stats-all
# 依次刷新回放统计两份 + 竞技场榜单与玩法统计
```

新增或更新回放后运行 `npm run stats-all` 即可同时刷新两个看板。

## 竞技场数据

竞技场数据独立成链：对战记录在 `arena/matches.jsonl`（由 `rl/evaluation/round_robin.py` 累积，页面内评估控制台可网页发起跑批——标准模式跑模型与算法混合循环赛，其余三种模式跑该模式注册的算法，大逃杀可用 random-royale / apex、歼灭可用 random-annihilation / shrinkroll / vortex 组批）。跑批依赖仓库里的 `round_robin.py`、`script/generateArena*.mjs` 与本地模型，属本地开发功能，Docker 镜像不携带，线上相关写接口返回 `501 arena_eval_unavailable`。榜单与统计由 `npm run arena-leaderboard` / `npm run arena-stats` 生成，详见 [rl/README.md](../rl/README.md)「AI 竞技场」节。

## 性能基线

`npm run bench` 覆盖持久化全量写、状态响应、引擎可达格、随机地图与回放解析；结果写入 `temp/perf/latest.json`（`temp/` 不入库）。

## Agent 简写对照

对战记录文件名与玩家名中的 Agent 简写（如 `tg_0155_rank01_QD@qwen3.8Flash.md` 里的 `QD`）按表对照全名；唯一来源是 [`script/generateStats.mjs`](../script/generateStats.mjs) 的 `AGENT_NAMES`，新增 Agent 时补 `AGENT_NAMES` 并同步本表：

| 简写 | 全名 | 简写 | 全名 |
|---|---|---|---|
| `PI` | Pi | `CP` | CatPaw |
| `OMP` | Oh My Pi | `WB` | WorkBuddy |
| `DSH` | DeepSeek Harness | `ZC` | zcode |
| `QD` | Qoder | `CC` | ClaudeCode |
| `QW` | QoderWork | `CX` | Codex |
| `TW` | TraeWork | `WEB` | WebAgent |
| `TC` | TraeCode | `TE` | Trae |
| `OC` | OpenCode | | |

`SCRIPT` 只用于脚本自动对战的旧记录，不是 Agent 产品名，不进对照表。
