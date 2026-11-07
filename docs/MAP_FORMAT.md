# 地图格式

本文档描述 `maps/*.json` 的结构与校验规则。地图文件名就是 `mapId`（例如 `default.json` 对应 `mapId: "default"`），服务启动时加载并校验；`GET /api/maps` 返回可选地图。

浏览器地图编辑器位于 `http://localhost:3100/map-editor.html`。它只做本地导入、可视化编辑和导出 JSON；导出的文件需要手动放入 `maps/`，再重启服务或重新加载配置后使用。

```json
{
  "grid": "hex",
  "orientation": "pointy",
  "radius": 8,
  "terrainCells": [{ "q": 0, "r": 1, "terrain": "water" }],
  "controlPoints": [{ "id": "cp_c", "name": "中央阵地", "q": 0, "r": 0, "kind": "supply" }],
  "headquarters": {
    "player_a": { "q": -8, "r": 0 },
    "player_b": { "q": 8, "r": 0 }
  },
  "startingUnits": [{ "owner": "player_a", "type": "infantry", "q": -7, "r": 0 }],
  "units": {},
  "headquartersSpec": { "hp": 180, "defense": 6 },
  "balance": {
    "startingSupplies": 80,
    "baseIncome": 10,
    "controlPointTypes": {
      "supply": { "income": 12, "deployDiscount": 0, "repairAmount": 0 },
      "forward_base": { "income": 8, "deployDiscount": 8, "repairAmount": 0 },
      "repair": { "income": 8, "deployDiscount": 0, "repairAmount": 10 }
    },
    "damageVarianceRange": 3,
    "minimumDamage": 1,
    "healVarianceRange": 6,
    "actionsPerTurn": 5,
    "maxTurns": 15,
    "komi": { "supplies": 10 },
    "adjudicationWeights": { "enemyHqDamage": 5, "ownHqHp": 2, "controlPoint": 90, "armyValue": 2, "supplies": 1 }
  }
}
```

## 异形地图

异形地图可另外声明 `"playableCells": [{ "q": 0, "r": 0 }, { "q": 1, "r": 0 }]`。该字段可选；省略时，加载器按 `max(abs(q), abs(r), abs(-q-r)) <= radius` 展开完整六边形。声明时可组成任意凹形、凸形、带孔洞边界，也允许断开成多座互不相连的岛（地图编辑器同样支持开裂），但每个坐标仍须位于 `radius` 包络内，岛间格子天然无法互相移动。加载后所有地图都会得到完整权威格子列表，移动、部署、爆破、寻路和绘图都以该列表为准。`GET /api/maps` 的 `preview.cells` 也始终返回已经解析并带地形的预览格子。

## 无回合上限

`balance.maxTurns` 接受 `>= 1` 的有限数字，或写成 `null` 表示**无回合上限**：引擎不会在回合边界做轮数裁决，对局仅由一方全灭、总部/军力被毁或房主 `POST /api/games/:id/force-adjudicate` 结束。前端回合角标此时显示 `当前轮/∞`，地图卡片显示 `⏱∞`，地图编辑器可用「无回合上限」开关切换。

## 先手贴目

顺序模式（`standard` / `annihilation`）里，先手方第一回合**不结算收入**，其余每个座位在自己第一次行动前**直接获得 `komi.supplies` 点补给**——这笔一次性补偿叫「先手贴目」，**代替**该回合的收入结算（不再按据点算钱）。用金币口径是为了能直接标定：写 12 就是 12 补给，与地图收入结构无关。

- `"komi": { "supplies": 0 }`：不贴目，所有人第一次收入都在各自第 2 回合，开局完全对称。
- `"komi": { "supplies": 12 }`：2 人局里后手第一次行动前 +12；N 人局里除先手外每个座位各 +12。
- 取值必须是 `0..999` 的整数。

**缺省字段 = 历史口径**：老地图 / 老存档没写 `komi` 时，仍按 3.9.5 之前的「一次开局收入」结算（当回合的 `baseIncome` + 出生据点收入），行为不变；新图请显式写 `supplies`。内置顺序图已全部显式声明：`trench-run` 12、`artillery-zone` 12、`default` / `breach` / `dual-lanes` 10、`whirlpool` 7、`danger-close` / `multiplayer-ring` 6（这些值正好等于各图旧口径的一跳开局收入，所以平衡不变）。

没写 `komi` 的图在地图编辑器里仍会预填「先手贴目（补给）」输入框，值就是这套历史折算（`baseIncome` + 出生据点收入）：各座出生据点同类型时该值等价于旧口径，**类型不一致时按最低额度预填并在标签里标出区间**，因为单个 `supplies` 无法同时等于多个座位的第一跳。预填只用于回显，不改动输入框就不会写入 `komi`，导出后依旧走历史结算。

贴目只对顺序模式生效（同时回合 / 大逃杀没有先手位置，地图写了 `komi` 会被加载器拒绝，地图编辑器切到这两种模式时也不再写出该字段）；**同一张图的所有人数共用同一个 `supplies`**，2 人与 6 人局不会分别标定。贴目记为一条带 `komi: true` 的 `income` 事件（`base = amount`、`control = 0`、`breakdown = []`），事件流显示「收入 +N（先手贴目）」，规则速查里以「先手贴目」chip 展示档位。见 [skill/annihilation.md](../skill/annihilation.md)。

## 模型评估开关

竞技场跑批（`rl/evaluation/round_robin.py`）默认让全部模型参与每张标准图。地图可以用顶层 `"modelEval": false` 退出模型评估：含模型的批次在组批阶段被跳过并在日志里注明原因，不计成失败批次，算法对算法照跑；`"modelEvalNote": "..."` 是可选的说明文本，原样写进跑批日志。字段只影响竞技场评估链路，引擎、建房与对局规则不受影响；缺省视为参与。

`whirlpool`（星海漩涡）是首例：无回合上限 + 只能从港口出兵 + 六条旋臂被 blocker 隔断（纯陆地连通分量 7 块，两个总部之间至少砸穿 4 面墙），当前模型的策略不会先破墙再进攻，模型对局跑满回合全是平局。背景见 [rl/docs/RELEASE_NOTES.md](../rl/docs/RELEASE_NOTES.md) 2026-10-31 两条记录。

## 歼灭与大逃杀字段

歼灭模式地图另外声明 `mode: "annihilation"`、`annihilation.artillery`，并让每个 `spawnSlots[]` 通过 `controlPointId` 关联一个唯一出生据点；大逃杀模式地图声明 `mode: "royale"` 时同样**必须**携带 `annihilation.artillery` 与据点绑定的出生槽（`minimumSafeRadius` 允许为 0，即最终只剩中心一格安全）。

炮火参数包含首次生效轮次 `startRound`、收缩间隔 `intervalRounds`、每轮伤害 `damage` 和最终安全半径 `minimumSafeRadius`。内置地图 `artillery-zone`（炮火禁区）支持 2、3、6 人，采用六向旋转对称出生布局，共 20 轮：第 1–4 轮争夺内圈补给点，第 5–12 轮利用额外收入扩军、外圈与内圈据点依次被炮火覆盖，第 13 轮起安全区收缩至最终半径 1、在内圈核心决胜，第 20 轮仍未分胜负则按裁决分收尾。炮火在第 4 轮预告、第 5 轮首次收缩，此后每两轮收缩一层，至第 13 轮到达最终安全半径 1。地图编辑器为这两类地图提供缩圈预览滑块，拖动可按轮次查看危险区与下一轮将被覆盖的那一圈；预览只是编辑器里的本地视图，不写入导出 JSON。

## 地形与据点

未列在 `terrainCells` 的可用格默认为 `plain`。地图编辑器支持添加和移除地块，并可维护 2–8 个出生槽及对应人数布局；移除包含对象的格子会被阻止，避免隐式丢失配置。

每个据点必须写 `kind`：`supply`（补给站）、`forward_base`（前线基地）、`repair`（维修站）——不存在无类型的「普通据点」。`balance.controlPointTypes` 必须完整配置三种类型的 `income`、`deployDiscount`、`repairAmount`（含地图未用到的类型）。裁决分始终按据点数量计算，不按据点类型加权。
