# Map System Design

## Context

The game currently has a single hardcoded map (20x20 grid, fixed HQ/mining positions) with all balance values in `game-balance.json`. We need a multi-map system where each map is a complete independent JSON config with its own layout, terrain, and balance values. Players browse available maps before creating a game.

## Map File Format

Each map is a JSON file in `maps/` with the same structure as the current `game-balance.json`, plus new fields:

```json
{
  "name": "沙漠战场",
  "description": "矿产稀缺的沙漠地图",
  "units": { ... },
  "buildings": { ... },
  "canProduce": { ... },
  "economy": { "startingGold": 80, "minerIncome": 10, "baseIncome": 3 },
  "map": {
    "width": 25,
    "height": 25,
    "buildRange": 2,
    "headquartersPositions": {
      "player_a": { "x": 3, "y": 12 },
      "player_b": { "x": 21, "y": 12 }
    },
    "miningPoints": [
      { "x": 8, "y": 8 }, { "x": 8, "y": 16 },
      { "x": 16, "y": 8 }, { "x": 16, "y": 16 }
    ],
    "terrain": [
      [0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      ...
    ]
  },
  "combat": { ... }
}
```

### Terrain values

| Value | Type | Passable | Buildable | Visual |
|-------|------|----------|-----------|--------|
| 0 | empty | yes | yes | (none) |
| 1 | wall | no | no | dark gray block |
| 2 | water | no | no | blue block |

### File naming

- `maps/default.json` — current game-balance.json moved here (20x20, no terrain)
- `maps/desert.json` — example new map
- Map ID = filename without `.json` extension

## API Changes

### GET /api/maps

Returns list of available maps (no full config, just metadata):

```json
{
  "maps": [
    { "id": "default", "name": "默认地图", "description": "标准20x20对称地图" },
    { "id": "desert", "name": "沙漠战场", "description": "矿产稀缺的沙漠地图" }
  ]
}
```

### POST /api/games

New optional `mapId` body parameter:

```json
{ "mapId": "desert" }
```

If omitted or empty, uses `default`. If mapId not found, returns 400 error.

### GET /api/config (removed)

This global endpoint is removed. Config is per-game and delivered via the `game_start` event payload. The client no longer needs to fetch config separately — it comes with the game data. Server-side `getConfig()` is replaced by `getMapConfig(id)` for internal use.

### game_start event

Add `terrain` and `mapId` to the payload:

```json
{
  "mapWidth": 25,
  "mapHeight": 25,
  "miningPoints": [...],
  "terrain": [[0,0,1,...], ...],
  "mapId": "desert",
  "buildings": [...],
  "firstPlayer": "player_a"
}
```

## Server-Side Changes

### config/loader.ts

- `loadMaps(mapsDir?)`: scans `maps/` directory, reads all `.json` files, validates each, caches as `Map<string, GameBalanceConfig>`
- `getMapConfig(id: string)`: returns config for a specific map
- `listMaps()`: returns `[{ id, name, description }]` for all loaded maps
- `getDefaultMapConfig()`: returns the `default` map config (backward compat)
- Keep `getConfig()` as alias for `getDefaultMapConfig()` for existing code that uses global config
- Validate `terrain` array dimensions match `width x height`

### types.ts

- Add `mapId: string` to `GameState`
- Add terrain type: `type TerrainType = 0 | 1 | 2` (empty/wall/water)

### state/store.ts

- `createInitialGame(id, mapId?)`: accept optional mapId, load that map's config, use it for all initialization
- Store `mapId` on GameState

### engine/validation.ts

- Add `getTerrain(game, x, y)`: returns terrain type at position (from game state, not config)
- Add `isPassable(game, x, y)`: terrain is 0 (empty)
- Add `isBuildable(game, x, y)`: terrain is 0 (empty)
- Terrain data stored on GameState as `terrain: number[][]`

### engine/building.ts

- `startBuild()`: add `isBuildable()` check before allowing construction

### engine/units.ts

- `moveUnit()`: check all cells along the path are passable (for now, just the destination cell)

### engine/engine.ts

- `joinGame()`: include terrain in game_start event payload

### api/games.ts

- `POST /api/games`: accept `mapId` from body, pass to `createInitialGame()`
- Validate mapId exists in loaded maps

### api/config.ts

- Remove or repurpose. If kept, return per-game config based on game's mapId.

## Client-Side Changes

### Map selection UI (play.js)

- On page load, fetch `GET /api/maps` to get map list
- Show a dropdown/select for map selection in the join panel
- When creating a game, send selected `mapId` in POST body

### Terrain rendering (play.js + app.js)

In `drawBoard()`, before drawing entities, iterate terrain grid:

```js
for (let y = 0; y < state.mapHeight; y++) {
  for (let x = 0; x < state.mapWidth; x++) {
    const t = state.terrain[y]?.[x] || 0;
    if (t === 1) {
      ctx.fillStyle = '#3a3a3a'; // wall
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    } else if (t === 2) {
      ctx.fillStyle = '#1a4a6a'; // water
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}
```

### State reconstruction (play.js + app.js)

- `createEmptyState()`: add `terrain: []`
- `applyEvent()` game_start handler: extract `terrain` from payload
- Remove `/api/config` fetch dependency — config comes from game_start event

### Export HTML (app.js)

- Embed terrain data in exported HTML alongside events

## File Structure

```
game/
  maps/
    default.json      ← moved from game-balance.json
    desert.json       ← new example map
  game-balance.json   ← deleted
```

## Migration

- Move `game-balance.json` → `maps/default.json` (add name/description, add empty terrain)
- All existing tests should pass with default map
- Existing game creation (no mapId) uses default map

## Verification

1. `npm test` — all tests pass
2. `GET /api/maps` — returns map list
3. Create game with `mapId: "default"` — works as before
4. Create game with `mapId: "desert"` — uses desert config
5. Terrain renders correctly on both clients
6. Units cannot move onto wall/water cells
7. Buildings cannot be placed on wall/water cells
8. Export HTML includes terrain data and renders offline
