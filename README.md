# 战棋多人对战游戏

现代军事题材的回合制战棋游戏。玩家通过 REST API 控制势力，建造兵营/采矿器，生产单位，攻击敌方总部。

## 启动

```bash
npm install
```
```bash
npm run dev
```
服务器默认监听 3000 端口。

## 简单 API 流程

1. `POST /api/games` — 创建对局，得到 `gameId` 和 `playerAToken`
2. `POST /api/games/:id/join` — 另一玩家加入，得到 `playerBToken`
3. 操作时在请求头加 `X-Player-Token: <token>`
4. `POST /api/games/:id/build` — 建造（`type`, `x`, `y`）
5. `POST /api/games/:id/produce` — 生产单位
6. `POST /api/games/:id/move` — 移动单位
7. `POST /api/games/:id/attack` — 攻击
8. `POST /api/games/:id/heal` — 医疗兵治疗
9. `POST /api/games/:id/end-turn` — 结束回合

观战：浏览器访问 `http://localhost:3000/`。

## 测试

```bash
npm test
```

## 文档

详细规格见 `docs/superpowers/specs/2026-06-03-tactical-game-design.md`。
