#!/usr/bin/env node
// 把新格式（runtime/store/*.json 快照）导出为旧版 runtime/games.json，便于回滚/迁移。
import { GameStore } from '../src/state/store.js';

const store = new GameStore();
store.loadFromDisk();
const games = store.list();
store.flush();
console.log(`Exported ${games.length} game(s) to the legacy games.json layout.`);
