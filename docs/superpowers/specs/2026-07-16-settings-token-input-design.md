# Settings Token Input Design

## Goal

观战页与 Play 页右上角设置弹层可输入并保存凭证，使依赖 token 的前端操作有明确入口。

## Scope

- 观战：`public/spectator.html`、`public/app.js`、`public/style.css`
- Play：`public/play.html`、`public/play.js`、`public/play.css`
- 静态回归：`tests/public/`
- 不改后端鉴权、不改 control 页

## Storage

| Key | Value | Consumers |
|---|---|---|
| `localStorage.autoControlToken` | Control token 字符串 | control 页、观战删除/改名、设置保存 |
| `localStorage.tacticalGame.session` | `{ gameId, myToken, myPlayer, hostToken }` | play 现有会话 + 设置保存/恢复 |

- 输入框使用 `type="password"`，`autocomplete="off"`
- Token 不写入 URL / EventSource query / console

## Spectator

在现有 `#settings-popover` 末尾追加：

- Control token 密码输入 `#settings-control-token`
- 保存按钮 `#btn-save-control-token`

行为：

1. 打开设置时回填 `localStorage.autoControlToken`
2. 保存写入同一 key；空串表示清除
3. 删除/改名继续读取该 key（已有逻辑）

## Play

Header 右侧在 `#conn-status` 旁新增设置齿轮与弹层，字段：

- Control token + 保存
- 会话：Game ID、Player token、Host token（可选）
- 操作：保存会话、进入游戏、清除会话

行为：

1. 启动时若存在 session，回填弹层；**不**自动进局
2. 保存 Control token → `autoControlToken`
3. 保存会话 → 至少需要 Game ID；同步内存变量并 `persistSession()`
4. 进入游戏 → 用弹层值更新内存 → `persistSession()` → 现有 `enterGame()`
5. 清除会话 → 删除 localStorage key，清空内存与输入
6. 大厅创建/加入后的 `persistSession` 不变；打开设置时用当前内存回填

## UI

- 观战复用现有 popover 交互与点击外部关闭
- Play 将同等 settings 样式迁入 `play.css`（play 不引用 `style.css`）
- 弹层增加 `.setting-field` 全宽输入与分隔线，`min-width` 约 260–280px

## Testing

静态 Vitest：

- 观战 HTML/JS 含 control token 输入与 `autoControlToken` 读写
- Play HTML/JS 含 settings 弹层、session 字段、保存/清除/进入路径
- 不破坏 SSE 不把 player token 放 URL 的既有断言

## Non-goals

- 不改 API / 鉴权
- 不做跨设备同步或加密存储
- 启动时不强制自动进局
