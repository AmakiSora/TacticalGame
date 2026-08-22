// src/engine/result.ts
import type { ApiErrorCode } from '../types.js';

export type Result<T = void> =
  | { ok: true; data?: T }
  | { ok: false; code: ApiErrorCode; message: string };

/** 仅供失败分支使用的返回类型，可赋给任意 Result<T>。 */
export type Failure = { ok: false; code: ApiErrorCode; message: string };
