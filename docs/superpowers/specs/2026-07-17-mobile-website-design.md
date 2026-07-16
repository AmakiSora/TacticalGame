# 手机观战页与玩家页设计

**日期：** 2026-07-17  
**分支：** `feature/mobile-website`  
**范围：** 仅玩家控制台与观战页的手机体验；不改后端 API。

## 背景

桌面 `play.html` / `spectator.html` 为三栏网格 + 鼠标悬停选格，缺少 viewport，触控几乎不可用。需要接近 App 的手机壳：棋盘优先、底栏与抽屉、拖移与捏合。

## 决策

| 项 | 选择 |
|---|---|
| 架构 | 独立 m 页：`play-m.*` / `spectator-m.*`（从桌面复制后改） |
| 入口 | 桌面页 `max-width: 820px` 时 `location.replace` 到 m 页，保留 query |
| 布局 | 棋盘优先 + 底栏 + 抽屉；横屏不恢复桌面三栏 |
| 手势 | Pointer：轻点选格、单指拖、双指捏合；`+/-` 按钮 |
| 大厅 | 含在 `play-m` |
| 后端 | 同一套 REST / SSE，零协议变更 |

## 玩家 m 页

- 大厅：大触控表单与地图卡
- 对局：回合条 → 棋盘 viewport → 选中摘要 → 底栏（信息 / 取消 / 结束回合 / 更多）
- 取消不再依赖右键；Esc 与底栏「取消」均可

## 观战 m 页

- 顶栏：标题 + 对局摘要 + 设置
- 棋盘 + 当前操作摘要 + 固定回放条
- 底栏：对局 / 局势 / 事件 → 抽屉

## 棋盘坐标

viewport 内对 `board-world` 使用 `translate(pan) scale(scale)`。  
`eventToCanvasPoint`：相对 viewport 减去 pan 再除以 scale，再 `pixelToHex`。

## 非目标

- control / map-editor 深度适配  
- PWA / Service Worker  
- 桌面页改成同一响应式壳  
- 抽取共享打包模块（v1 双份维护）

## 文件

- `public/play-m.html|css|js`
- `public/spectator-m.html|css|js`
- 桌面 `play.html` / `spectator.html`：viewport + 跳转
- `tests/public/mobile-pages.test.ts`
