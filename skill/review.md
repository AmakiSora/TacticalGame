---
name: review-hex-api-game
description: Use when a TacticalGame hex match has ended and the user asks the agent to 总结经验 / 复盘 / 写总结 (post-game battle review). Routes by game mode to the mode-specific review spec and writes the review markdown into records/V3. The replay JSON is exported and archived by the host from the web UI — agents never generate, download, or overwrite it.
---

# TacticalGame 对局复盘（经验总结）规范

一局结束后，用户要求写总结经验 / 复盘时使用本文件。它只做两件事：**按模式路由到对应的复盘规范、规定复盘产物的位置与命名**；写什么内容完全由模式文件决定。

**回放由房主提供，agent 只读不写（mandatory）：** 本局回放 JSON 由房主从前端观战页导出并归档。同一局常有多个参与 agent 各自写复盘——回放只有一份，归房主管；任何 agent 自己组装、下载或覆盖回放都会互相冲突。因此：**绝不**调事件接口（`/api/games/:id/events`）拼装回放，**绝不**写 `tg_*.json`。找不到回放文件时停下向房主要，不要自行补。

**来源即权威：** 本规范与三份模式文件都由游戏服务器经 `/api/skill/files/*` 提供。你是从 `${BASE_URL}/api/skill/files/review.md` 拉到本文的，它就是权威版本；若读的是本地安装副本，先按 play skill（`SKILL.md`）的 Canonical fetch 用 `GET ${BASE_URL}/api/skill/manifest` 校验新鲜度，不一致才重新拉全文。

## 输入清单

开工前确认下列输入，缺哪项就向用户要，不要猜：

| 输入 | 来源 |
|---|---|
| 回放 JSON 路径 | 房主在提示词中给出；或已按归档命名放在 `records/V3/` 里（见下文命名表） |
| 对局顺序号 | 用户提示里给出的整数（如 `199`），用于复盘 MD 命名 |
| 你的席位与玩家名 | 你加入对局时用的 `player_x` 席位和名字 |
| `BASE_URL` | 服务器地址（IP → `http://<IP>:3123`），用于拉取模式规范文件；本地已有 skill 拷贝时可省 |

## 模式路由（mandatory）

1. 读回放 JSON 里首个 `game_start` 事件的 `payload.mode`（或 `payload.config.mode`）。
2. **只**拉取并遵循对应的一份模式文件（始终从服务器拉）：
   - `standard` → `GET ${BASE_URL}/api/skill/files/review-standard.md`
   - `annihilation` → `GET ${BASE_URL}/api/skill/files/review-annihilation.md`
   - `simultaneous` → `GET ${BASE_URL}/api/skill/files/review-simultaneous.md`
3. 模式缺失或未知 → 停下说明，不要套用别的模式的模板（例如给歼灭局写 HQ 分析）。

## 取证：只从回放读

回放是复盘的唯一数据源：顶层元数据（`gameId` / `mapId` / `playerNames` / `finalResult`）、`game_start` 配置和全部事件（含 `game_over.payload.rankings`）都在其中。不要调游戏 API 重新拉事件；对局中的记忆只能用于定性描述，所有数字必须出自回放文件，统计不了的如实写"无法可靠统计"。

## 产物与命名（mandatory）

复盘 MD 是你**唯一的交付物**：写入用户提示指定的目录；未指定时写入当前工作目录的 `records/V3/`（先 `mkdir -p`）。它**不适用** play skill 的 Scratch files（`temp/`）规则。

顺序号不足 4 位左侧补 0（`199` → `0199`）。`AGENT` 用你自己的 agent 名**全大写**；`模型短名` 用你运行所在的模型名缩写，风格与 `records/V3` 已有文件保持一致（小写去空格，如 `hy3`、`gpt5.6sol`）。

| 产物 | 命名 | 谁写 |
|---|---|---|
| 回放 JSON | `tg_{顺序号4位}_{YYYYMMDD}.json`（观战页导出的默认名是 `tg_0_{日期}.json`，`0` 为占位，由房主归档时改成真实顺序号；房主另给路径时以提示词为准） | 房主 |
| 复盘 MD（双人局） | `tg_{顺序号4位}_{win\|lose\|draw}_{AGENT}@{模型短名}.md` | 你 |
| 复盘 MD（多人局） | `tg_{顺序号4位}_rank{两位名次}_{AGENT}@{模型短名}.md`，名次取 `rankings` 里你的 `rank`（01–08） | 你 |

`win` / `lose` / `draw` 按你自己的席位判：`game_over.payload.rankings` 中你是唯一 `rank: 1` → `win`；`reason` 为 `turn_limit_draw` 或多人并列第一 → `draw`；其余 → `lose`。被淘汰也要写复盘，名次照 `rankings`。

写完后在汇报里给出复盘 MD 的完整路径和一句话总结。

## 离线兜底

服务器不可达时：若本地有 skill 安装副本，可读对应 `review-<mode>.md` 继续写作；回放与历史对局都是本地文件，不受影响。
