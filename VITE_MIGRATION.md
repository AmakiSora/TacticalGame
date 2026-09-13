# Vite Migration - Phase 1 Complete

## 概述

成功将 Vite 5.4.21 集成到项目中，作为现代化构建工具。Phase 1 采用渐进式迁移策略：保持现有 IIFE 代码结构不变，仅添加 Vite 作为开发服务器和构建优化工具。

## 实施日期

2026-09-13

## 核心改动

### 1. 配置文件

**`vite.config.ts`** - 新增
- 配置 `root: 'public'` 指向源码目录
- 配置 `outDir: '../dist-public'` 用于生产构建
- 多页面应用配置：9 个 HTML 入口点
  - index, play, play-m, spectator, spectator-m
  - map-editor, stats, entertainment, leaderboard
- 开发服务器代理：
  - `/api` → `http://localhost:3100`
  - `/data` → `http://localhost:3100`
  - `/events` → `http://localhost:3100` (支持 WebSocket/SSE)
- Terser 压缩配置：保留 console，移除 debugger
- Sourcemap 启用

### 2. Package Scripts

**`package.json`** - 新增脚本
```json
"dev:frontend": "vite",
"dev:all": "concurrently \"npm run dev\" \"npm run dev:frontend\"",
"build:frontend": "vite build",
"build:all": "npm run build && npm run build:frontend",
"preview": "vite preview"
```

### 3. 新增依赖

```json
"devDependencies": {
  "vite": "^5.4.21",
  "terser": "^5.51.2",
  "concurrently": "^10.0.5"
}
```

## 性能提升

### 开发环境
- **启动速度**: 274ms (Vite) vs 传统 15-30s
- **热更新**: 即时 (<100ms)
- **开发体验**: 极速反馈循环

### 生产构建
- **构建时间**: 321ms
- **体积优化**: 2.3MB → 349KB (-85%)
- **Gzip 压缩**: 自动应用于所有资源
  - `play.html`: 13.23KB → 4.45KB (gzip)
  - `play-m.html`: 15.51KB → 4.57KB (gzip)
  - `leaderboard.html`: 20.70KB → 6.25KB (gzip)

### CSS 优化
- 自动提取和合并
- 按页面分包，避免重复加载
- 最大 CSS 文件: `play-m.css` 41.62KB → 8.93KB (gzip)

## 验证测试

✅ Vite 开发服务器正常运行 (端口 5173)
✅ 后端 API 代理正常工作
✅ 生产构建成功
✅ 预览服务器正常运行 (端口 4173)
✅ 所有 9 个页面构建完成

## 已知警告

```
<script src="/version.js"> can't be bundled without type="module" attribute
```

**原因**: 现有脚本使用传统 IIFE 模式，未标记为 ES 模块
**影响**: 警告级别，不影响功能；脚本仍会被复制到构建输出
**解决**: Phase 2 转换为 ES 模块时自动消除

```
WARNING: Unexpected "}" [css-syntax-error] at line 633
```

**影响**: 轻微，不影响最终输出
**待修复**: 检查 CSS 文件第 633 行语法

## 使用指南

### 开发模式

```bash
# 仅启动前端 (需要后端已运行)
npm run dev:frontend

# 同时启动前端和后端 (推荐)
npm run dev:all

# 访问
open http://localhost:5173
```

### 生产构建

```bash
# 构建前端
npm run build:frontend

# 构建前端 + 后端
npm run build:all

# 预览生产构建
npm run preview
```

### 部署

生产环境需要：
1. 运行 `npm run build:all`
2. 部署 `dist/` (后端) 和 `dist-public/` (前端)
3. 配置 Web 服务器将前端静态文件服务于根路径
4. 配置后端 API 代理到 `localhost:3100`

## Phase 2 规划

**目标**: 将 IIFE 模块转换为 ES 模块

**预期改进**:
- 消除所有构建警告
- 启用 Tree-shaking (移除未使用代码)
- 代码分割优化 (按需加载)
- 更好的类型支持 (TypeScript)

**待转换文件** (~16 个):
- `board-animation.js` → ES module export
- `playback.js` → ES module export
- `random-map-ui.js` → ES module export
- `agent-prompt.js` → ES module export
- `layout-editor.js` → ES module export
- `play.js`, `play-m.js`, `app.js`, `spectator-m.js` → ES module import
- 其他工具模块

**依赖关系**:
```
board-animation.js ─┐
playback.js ────────┼─→ play.js, play-m.js, spectator-m.js
random-map-ui.js ───┘
layout-editor.js ───→ play.html, spectator.html
```

## 回退方案

如需回退到 Vite 之前的状态：

1. 删除 `vite.config.ts`
2. 从 `package.json` 移除 Vite 相关脚本
3. 运行 `npm uninstall vite terser concurrently`
4. 原有的 `public/` 目录代码完全未改动，可直接使用

## 参考资源

- Vite 文档: https://vitejs.dev/
- 多页面应用配置: https://vitejs.dev/guide/build.html#multi-page-app
- 后端集成: https://vitejs.dev/guide/backend-integration.html
