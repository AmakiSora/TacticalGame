// algorithms/registry.d.mts
//
// registry.mjs 的类型声明（无 allowJs，src/ 下的 TS 模块经此消费注册表）。

export interface AlgorithmDisplayMeta {
  displayName: string;
  description: string;
  version: string;
}

export interface AlgorithmModule {
  name: string;
  description?: string;
  decide?: (game: unknown, utils: unknown) => Promise<{ type: string; payload?: Record<string, unknown> } | null>;
  playTurn?: (game: unknown, apiClient: unknown, utils: unknown) => Promise<void>;
}

export interface AlgorithmMeta {
  name: string;
  path: string;
  displayName: string;
  description: string;
  version: string;
}

export declare const ALGORITHMS: Record<string, string>;
export declare const ALGORITHM_META: Record<string, AlgorithmDisplayMeta>;

export declare function loadAlgorithm(name: string): Promise<AlgorithmModule>;
export declare function listAlgorithms(): string[];
export declare function listAlgorithmInfo(): Array<{ name: string; displayName: string; description: string; version: string }>;
export declare function algorithmVersion(name: string): string;
export declare function algorithmParticipantId(name: string): string;
export declare function algorithmVersionedId(name: string): string;
export declare function getAlgorithmMeta(name: string): AlgorithmMeta | null;
export declare function registerAlgorithm(name: string, path: string): void;
