// src/config/randomMapCache.ts
// 随机地图预览/创建共用缓存：同一 (参数, 人数, 种子, 生成器版本) 只生成一次。
// 缓存只存不可变模板；读取时深拷贝，避免对局内的 demolish 等修改污染后续对局。
import type { MapConfig } from './loader.js';
import type { RandomMapOptions, RandomParamValues } from './randomMap.js';
import { RANDOM_MAP_GENERATOR_VERSION } from './randomMap.js';

export interface CachedRandomMap {
  config: MapConfig;
  values: RandomParamValues;
}

const CACHE_LIMIT = 32;
const cache = new Map<string, CachedRandomMap>();

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function randomMapCacheKey(options: RandomMapOptions, maxPlayers: number): string {
  return `${RANDOM_MAP_GENERATOR_VERSION}|${maxPlayers}|${stableValue(options)}`;
}

export function getCachedRandomMap(options: RandomMapOptions, maxPlayers: number): CachedRandomMap | null {
  const key = randomMapCacheKey(options, maxPlayers);
  const hit = cache.get(key);
  if (!hit) return null;
  // 刷新 LRU 顺序。
  cache.delete(key);
  cache.set(key, hit);
  return {
    config: structuredClone(hit.config),
    values: { ...hit.values },
  };
}

export function setCachedRandomMap(
  options: RandomMapOptions,
  maxPlayers: number,
  config: MapConfig,
  values: RandomParamValues,
): void {
  const key = randomMapCacheKey(options, maxPlayers);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { config: structuredClone(config), values: { ...values } });
}

export function clearRandomMapCache(): void {
  cache.clear();
}
